/**
 * HTTP app of the PLUSH PORTAL API proxy. It is the only place that holds the
 * OpenAI key. The game works without it: when no key is configured the paid
 * routes answer `no_key` and the browser uses its local lines.
 */
import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  AI_LIMITS,
  SPEECH_HEADERS,
  type ModelsResponseBody,
  type StatusResponseBody,
  type TestResponseBody,
} from '../src/ai/protocol';
import { classifyModel, textCapability, type LearnedOverride } from './capabilities';
import type { ServerConfig } from './config';
import { ApiFailure, mapUpstreamError } from './errors';
import { createLogger, type Logger } from './log';
import { createRateLimiter } from './rateLimit';
import { LineRequestSchema, SpeechRequestSchema, TestRequestSchema, describeIssue, type LineRequest } from './schemas';
import {
  createRealtimeSpeechProvider,
  createSpeechApiProvider,
  createSpeechService,
  type RealtimeConnect,
  type ServerSpeechProvider,
  type SpeechApiClient,
} from './speech';
import { createStaticHandler } from './static';
import { generateLine, type ResponsesClient } from './text';

export interface ModelsClient {
  models: { list(): AsyncIterable<{ id: string; shutdown_date?: string | null }> };
}

/** Everything the app needs from the OpenAI SDK client. The real client satisfies it; tests inject a fake. */
export type OpenAILike = ResponsesClient & SpeechApiClient & ModelsClient;

export interface AppDeps {
  config: ServerConfig;
  /** null = no API key configured. */
  client: OpenAILike | null;
  /** Opens Realtime sessions; omit / null when there is no key. */
  realtimeConnect?: RealtimeConnect | null;
  logger?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MODELS_CACHE_MS = 5 * 60_000;
const MAX_LISTED_MODELS = 600;

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(deps: AppDeps): Hono {
  const { config, client } = deps;
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? createLogger(config.logLevel, [config.apiKey, config.adminToken]);
  const limiter = createRateLimiter(config.ratePerMin, now);
  const learned = new Map<string, LearnedOverride>();

  const providers: Partial<Record<'speech' | 'realtime', ServerSpeechProvider>> = {};
  if (client) providers.speech = createSpeechApiProvider(client);
  if (deps.realtimeConnect) {
    providers.realtime = createRealtimeSpeechProvider(deps.realtimeConnect, { reasoningEffort: config.realtimeReasoningEffort });
  }
  const speech = createSpeechService({ config, providers, logger });
  let modelsCache: { at: number; body: ModelsResponseBody } | null = null;

  const app = new Hono();

  /* ------------------------------------------------------------ plumbing */

  app.onError((error, c) => {
    if (error instanceof ApiFailure) {
      for (const [name, value] of Object.entries(error.headers)) c.header(name, value);
      return c.json(error.body(), error.status as 400);
    }
    logger.error('unhandled error', { name: (error as Error)?.name ?? 'unknown', path: c.req.path });
    return c.json({ error: { code: 'internal', message: 'Internal server error.' } }, 500);
  });

  app.use('*', async (c, next) => {
    const started = now();
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'no-referrer');
    if (c.req.path.startsWith('/api/')) {
      c.header('cache-control', c.res.headers.get('cache-control') ?? 'no-store');
      logger.info('request', { method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(now() - started) });
    }
  });

  const isSameOrigin = (c: Context, origin: string): boolean => {
    const host = c.req.header('host');
    try {
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  };
  const originAllowed = (c: Context, origin: string): boolean => {
    const normalized = origin.replace(/\/+$/, '');
    return isSameOrigin(c, normalized) || config.allowedOrigins.includes(normalized) || config.allowedOrigins.includes('*');
  };

  // Browsers from other origins get CORS headers only when the origin is on the allow list…
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => (origin && originAllowed(c, origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: Object.values(SPEECH_HEADERS),
      maxAge: 600,
    }),
  );
  // …and requests that announce a foreign origin are refused outright (CORS alone would still run them).
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !originAllowed(c, origin)) throw new ApiFailure(403, 'forbidden', 'This origin is not allowed to use the AI proxy.');
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: AI_LIMITS.maxBodyBytes,
      onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } }, 413),
    }),
  );

  const clientKey = (c: Context): string => {
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for');
      if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64) || 'unknown';
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown'; // no socket (in-process tests)
    }
  };
  const rateLimit = (c: Context, cost = 1): void => {
    const result = limiter.take(clientKey(c), cost);
    if (!result.ok) {
      throw new ApiFailure(429, 'rate_limited', 'Too many requests. Please slow down.', { 'retry-after': String(result.retryAfterSec) });
    }
  };
  const isAdmin = (c: Context): boolean => {
    if (!config.adminToken) return true;
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    return !!match && sameToken(match[1]!, config.adminToken);
  };
  /** Client prompt / persona need PLUSH_ALLOW_CLIENT_PROMPT; model overrides additionally need the admin token when one is set. */
  const modelOverrideAllowed = (c: Context): boolean => config.allowClientPrompt && isAdmin(c);

  const readJson = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiFailure(400, 'bad_request', 'The request body must be JSON.');
    }
  };
  const requireKey = (): OpenAILike => {
    if (!client) {
      throw new ApiFailure(503, 'no_key', 'No OpenAI API key is configured on the server. The game uses its local lines.');
    }
    return client;
  };

  /* -------------------------------------------------------------- routes */

  app.get('/api/health', (c) => c.json({ ok: true, service: 'plush-portal-api', version: config.version, time: new Date(now()).toISOString() }));

  app.get('/api/ai/status', (c) => {
    const body: StatusResponseBody = {
      configured: client !== null,
      provider: 'openai',
      textModel: config.textModel,
      speechModel: config.speechModel,
      speechApi: config.speechApi,
      voice: config.voice,
      allowClientPrompt: config.allowClientPrompt,
      adminProtected: config.adminToken !== null,
      speechConfigError: config.speechConfigError,
      warnings: config.warnings,
      limits: {
        ratePerMin: config.ratePerMin,
        maxSpeechChars: AI_LIMITS.maxSpeechChars,
        maxRecentLines: AI_LIMITS.maxRecentLines,
        textTimeoutMs: config.textTimeoutMs,
        speechTimeoutMs: config.speechTimeoutMs,
      },
      version: config.version,
    };
    return c.json(body);
  });

  app.post('/api/ai/line', async (c) => {
    rateLimit(c);
    const parsed = LineRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiFailure(400, 'bad_request', describeIssue(parsed.error));
    const openai = requireKey();
    const request = parsed.data;
    const model = request.model && modelOverrideAllowed(c) ? request.model : config.textModel;
    if (model !== config.textModel && classifyModel(model) !== 'text') {
      throw new ApiFailure(400, 'model_mismatch', `"${model}" is not a text model for the Responses API.`);
    }
    const line = await generateLine(
      { client: openai, logger, now, learned, sleep: deps.sleep },
      {
        request,
        model,
        useClientPrompt: config.allowClientPrompt,
        timeoutMs: Math.min(config.textTimeoutMs, request.timeoutMs ?? config.textTimeoutMs),
        signal: c.req.raw.signal,
      },
    );
    return c.json(line);
  });

  app.post('/api/ai/speech', async (c) => {
    rateLimit(c);
    const parsed = SpeechRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiFailure(400, 'bad_request', describeIssue(parsed.error));
    requireKey();
    const request = parsed.data;
    const result = await speech.synthesize({
      text: request.text,
      lang: request.lang,
      voice: request.voice,
      speed: request.speed,
      model: request.model && modelOverrideAllowed(c) ? request.model : undefined,
      signal: c.req.raw.signal,
    });
    const audio = new Uint8Array(result.audio); // detach from the cached copy
    return new Response(audio, {
      status: 200,
      headers: {
        'content-type': result.mime,
        'content-length': String(audio.byteLength),
        'cache-control': 'no-store',
        [SPEECH_HEADERS.model]: result.model,
        [SPEECH_HEADERS.api]: result.api,
        [SPEECH_HEADERS.voice]: result.voice,
        [SPEECH_HEADERS.cache]: result.cached ? 'hit' : 'miss',
      },
    });
  });

  app.post('/api/ai/test', async (c) => {
    rateLimit(c, 3);
    if (!isAdmin(c)) throw new ApiFailure(401, 'forbidden', 'This endpoint needs the admin token (Authorization: Bearer …).');
    let raw: unknown = {};
    if ((c.req.header('content-length') ?? '0') !== '0') raw = await readJson(c);
    const parsed = TestRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ApiFailure(400, 'bad_request', describeIssue(parsed.error));
    if (!client) {
      const body: TestResponseBody = {
        ok: false,
        code: 'no_key',
        message: 'No OpenAI API key is configured on the server. The game uses its local lines.',
      };
      return c.json(body);
    }
    const lang = parsed.data.lang ?? 'en';
    const body: TestResponseBody = { ok: false };
    const probe: LineRequest = {
      event: { type: 'user_requested_tip', facts: { phase: 'READY', demo: false, attempts: 0, wins: 0, lossStreak: 0 } },
      theme: 'sakura',
      lang,
      recentLines: [],
      length: 'short',
    };
    const textStarted = now();
    try {
      const line = await generateLine(
        { client, logger, now, learned, sleep: deps.sleep },
        { request: probe, model: config.textModel, useClientPrompt: false, timeoutMs: config.textTimeoutMs, signal: c.req.raw.signal },
      );
      body.text = { ok: true, model: line.model, latencyMs: line.latencyMs, sample: line.text };
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : mapUpstreamError(error, 'text');
      body.text = { ok: false, model: config.textModel, latencyMs: Math.round(now() - textStarted), code: failure.code };
      body.code = failure.code;
      body.message = failure.message;
    }
    if (parsed.data.speech) {
      const speechStarted = now();
      const sample = lang === 'zh' ? '你好，我是Momo！' : lang === 'ja' ? 'こんにちは、モモだよ！' : "Hi, I'm Momo!";
      try {
        const audio = await speech.synthesize({ text: sample, lang, signal: c.req.raw.signal });
        body.speech = {
          ok: true,
          model: audio.model,
          api: audio.api,
          latencyMs: Math.round(now() - speechStarted),
          bytes: audio.audio.byteLength,
        };
      } catch (error) {
        const failure = error instanceof ApiFailure ? error : mapUpstreamError(error, 'speech');
        body.speech = {
          ok: false,
          model: config.speechModel,
          api: config.speechApi,
          latencyMs: Math.round(now() - speechStarted),
          code: failure.code,
        };
        body.code ??= failure.code;
        body.message ??= failure.message;
      }
    }
    body.ok = body.text?.ok === true && (!parsed.data.speech || body.speech?.ok === true);
    return c.json(body);
  });

  app.get('/api/ai/models', async (c) => {
    rateLimit(c);
    if (!client) {
      const empty: ModelsResponseBody = { configured: false, text: [], speech: [] };
      return c.json(empty);
    }
    if (modelsCache && now() - modelsCache.at < MODELS_CACHE_MS) return c.json(modelsCache.body);
    const body: ModelsResponseBody = { configured: true, text: [], speech: [] };
    try {
      let seen = 0;
      for await (const model of client.models.list()) {
        if (++seen > MAX_LISTED_MODELS) break;
        if (typeof model?.id !== 'string') continue;
        const kind = classifyModel(model.id);
        const shutdownDate = typeof model.shutdown_date === 'string' ? model.shutdown_date : null;
        if (kind === 'text') {
          const capability = textCapability(model.id, learned.get(model.id));
          body.text.push({
            id: model.id,
            shutdownDate,
            sampling: capability.temperature ? 'temperature' : 'none',
            reasoning: capability.reasoningEffort,
          });
        } else if (kind === 'speech' || kind === 'realtime') {
          body.speech.push({ id: model.id, api: kind, shutdownDate });
        }
      }
    } catch (error) {
      throw mapUpstreamError(error, 'text');
    }
    body.text.sort((a, b) => a.id.localeCompare(b.id));
    body.speech.sort((a, b) => a.id.localeCompare(b.id));
    modelsCache = { at: now(), body };
    return c.json(body);
  });

  app.all('/api/*', () => {
    throw new ApiFailure(404, 'not_found', 'Unknown API route.');
  });

  /* -------------------------------------------------------------- static */

  if (config.serveDist) {
    const serveStatic = createStaticHandler(config.distDir);
    app.all('*', async (c) => {
      const response = await serveStatic(c.req.path, c.req.method);
      return response ?? c.text('Method not allowed', 405);
    });
  }

  return app;
}
