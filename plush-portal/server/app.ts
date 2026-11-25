/**
 * HTTP app of the PLUSH PORTAL API proxy. It is the only place that holds the
 * OpenAI key. The game works without it: when no key is configured the paid
 * routes answer `no_key` and the browser uses its local lines.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  AI_LIMITS,
  SPEECH_HEADERS,
  type CredentialResponseBody,
  type CredentialStatus,
  type KeyCheckResult,
  type ModelsResponseBody,
  type StatusResponseBody,
  type TestResponseBody,
} from '../src/ai/protocol';
import { BRAND_KITS } from '../src/brand/kits';
import { classifyModel, textCapability, type LearnedOverride } from './capabilities';
import { makeClientKey } from './clientKey';
import type { ServerConfig } from './config';
import { ApiFailure, mapUpstreamError } from './errors';
import { FORWARDING_HEADERS, createKeyManager, isLocalRequest, maskKey, validateKeyFormat, type KeyManager } from './keys';
import { createLogger, type Logger } from './log';
import { createRateLimiter } from './rateLimit';
import {
  createBrandAssets,
  createClaimRoutes,
  createMemoryRewardStorage,
  createRewardApiRoutes,
  createRewardsService,
  createStaffRoutes,
  initialClaimTarget,
  type AdminTokenCheck,
  type BrandAssets,
  type RewardRouteDeps,
  type RewardAuthDeps,
  type RewardsService,
} from './rewards';
import { LineRequestSchema, SpeechRequestSchema, TestRequestSchema, describeIssue, type LineRequest } from './schemas';
import {
  SpeechCache,
  createRealtimeSpeechProvider,
  createSpeechApiProvider,
  createSpeechService,
  type RealtimeConnect,
  type ServerSpeechProvider,
  type SpeechApiClient,
  type SpeechService,
} from './speech';
import { createStaticHandler } from './static';
import { generateLine, type ResponsesClient } from './text';

export interface ModelsClient {
  models: { list(): AsyncIterable<{ id: string; shutdown_date?: string | null }> };
}

/** Everything the app needs from the OpenAI SDK client. The real client satisfies it; tests inject a fake. */
export type OpenAILike = ResponsesClient & SpeechApiClient & ModelsClient;

/** The clients built for one key. */
export interface ClientBundle {
  client: OpenAILike;
  /** Opens Realtime sessions; null when not available. */
  realtimeConnect: RealtimeConnect | null;
}

/** Checks a key against OpenAI without using it for anything else. */
export type KeyChecker = (key: string, signal: AbortSignal) => Promise<KeyCheckResult>;

export interface AppDeps {
  config: ServerConfig;
  /**
   * Run-time key handling (default key from .env, replacement from Settings).
   * When omitted, `client` / `realtimeConnect` are used as a fixed key and the
   * key routes refuse to change it.
   */
  keys?: KeyManager<ClientBundle>;
  /** Fixed client when `keys` is omitted; null = no API key configured. */
  client?: OpenAILike | null;
  /** Opens Realtime sessions for the fixed client; omit / null when there is no key. */
  realtimeConnect?: RealtimeConnect | null;
  /** Checks new keys (default: GET {base}/models through the global fetch). */
  checkKey?: KeyChecker;
  logger?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Prize claim codes (server/rewards). index.ts passes one backed by `<dataDir>/rewards.json` and
   * shares it with the LAN claim listener; when omitted (tests, embedders) codes live in memory.
   */
  rewards?: RewardsService;
  /** Brand logo / font files of the claim pages (default: looked up in config.rewards.assetDirs). */
  brandAssets?: BrandAssets;
}

const MODELS_CACHE_MS = 5 * 60_000;
const MAX_LISTED_MODELS = 600;
/**
 * Wrong admin tokens per client and minute. Once they are used up the token is not even compared
 * for a moment (the right one is refused too), so no route can serve as a fast oracle for it:
 * GET /api/rewards/status answers `canIssue` and is not rate-limited otherwise.
 */
export const ADMIN_TOKEN_FAILURES_PER_MIN = 10;

/** Constant-time comparison that does not reveal the token's length either (digests are compared). */
export function sameToken(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Asks OpenAI whether a key works: GET {baseUrl}/models with that key only.
 * 401 = rejected; 403 = valid but restricted (e.g. a key without the models
 * permission); 429 = valid but rate limited / out of quota; anything else
 * (network, timeout, 5xx) = could not be checked right now.
 */
export function openAiKeyChecker(baseUrl: string | null, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): KeyChecker {
  const url = `${(baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`;
  return async (key, signal) => {
    try {
      const response = await fetchImpl(url, { headers: { authorization: `Bearer ${key}` }, signal });
      void response.body?.cancel().catch(() => {});
      if (response.ok) return 'ok';
      if (response.status === 401) return 'rejected';
      if (response.status === 403) return 'restricted';
      if (response.status === 429) return 'quota';
      return 'unreachable';
    } catch {
      return 'unreachable';
    }
  };
}

export function createApp(deps: AppDeps): Hono {
  const { config } = deps;
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? createLogger(config.logLevel, [config.apiKey, config.adminToken]);
  const limiter = createRateLimiter(config.ratePerMin, now);
  const learned = new Map<string, LearnedOverride>();

  // A fixed key (tests, embedders) behaves like a key that can not be replaced.
  const fixedClient = deps.client ?? null;
  const keys: KeyManager<ClientBundle> =
    deps.keys ??
    createKeyManager<ClientBundle>({
      envKey: fixedClient ? (config.apiKey ?? 'fixed-client') : null,
      store: null,
      createClients: () => ({ client: fixedClient!, realtimeConnect: deps.realtimeConnect ?? null }),
    });
  const keyManagement = deps.keys ? config.keyManagement : 'off';
  const checkKey = deps.checkKey ?? openAiKeyChecker(config.baseUrl);
  const activeKey = keys.active().key;
  if (activeKey) logger.addSecret?.(activeKey);

  // Speech providers belong to one key: rebuilt when the key changes. The audio cache is shared.
  const speechCache = new SpeechCache();
  let speechState: { generation: number; service: SpeechService } | null = null;
  const speechService = (): SpeechService => {
    const active = keys.active();
    if (!speechState || speechState.generation !== active.generation) {
      const providers: Partial<Record<'speech' | 'realtime', ServerSpeechProvider>> = {};
      if (active.clients) {
        providers.speech = createSpeechApiProvider(active.clients.client);
        if (active.clients.realtimeConnect) {
          providers.realtime = createRealtimeSpeechProvider(active.clients.realtimeConnect, { reasoningEffort: config.realtimeReasoningEffort });
        }
      }
      speechState = { generation: active.generation, service: createSpeechService({ config, providers, logger, cache: speechCache }) };
    }
    return speechState.service;
  };
  const activeClient = (): OpenAILike | null => keys.active().clients?.client ?? null;
  let modelsCache: { at: number; generation: number; body: ModelsResponseBody } | null = null;

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
    // Staff pages set their own (same-origin, see server/rewards/routes.ts); everything else gets none.
    if (!c.res.headers.has('referrer-policy')) c.header('referrer-policy', 'no-referrer');
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

  // Requests that announce a foreign origin are refused outright (CORS headers alone would still let them run)…
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !originAllowed(c, origin)) throw new ApiFailure(403, 'forbidden', 'This origin is not allowed to use this API.');
    await next();
  });
  // …and allowed cross-origin browsers get the CORS headers they need.
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => (origin && originAllowed(c, origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: Object.values(SPEECH_HEADERS),
      maxAge: 600,
    }),
  );
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: AI_LIMITS.maxBodyBytes,
      onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } }, 413),
    }),
  );

  const clientKey = makeClientKey(config.trustProxy);
  const rateLimit = (c: Context, cost = 1): void => {
    const result = limiter.take(clientKey(c), cost);
    if (!result.ok) {
      throw new ApiFailure(429, 'rate_limited', 'Too many requests. Please slow down.', { 'retry-after': String(result.retryAfterSec) });
    }
  };
  const tokenFailures = createRateLimiter(ADMIN_TOKEN_FAILURES_PER_MIN, now);
  // One verdict per request and token, so a route that asks twice does not count a wrong token twice.
  const tokenVerdicts = new WeakMap<Request, Map<string, AdminTokenCheck>>();
  /** Compares a presented admin token, counting wrong ones per client (see ADMIN_TOKEN_FAILURES_PER_MIN). */
  const checkAdminToken = (c: Context, value: string): AdminTokenCheck => {
    if (!config.adminToken) return 'wrong';
    let verdicts = tokenVerdicts.get(c.req.raw);
    const known = verdicts?.get(value);
    if (known) return known;
    const key = clientKey(c);
    let verdict: AdminTokenCheck;
    if (tokenFailures.available(key) < 1) verdict = 'locked';
    else if (sameToken(value, config.adminToken)) verdict = 'ok';
    else {
      tokenFailures.take(key);
      verdict = 'wrong';
    }
    if (!verdicts) tokenVerdicts.set(c.req.raw, (verdicts = new Map()));
    verdicts.set(value, verdict);
    return verdict;
  };
  const hasAdminToken = (c: Context): boolean => {
    if (!config.adminToken) return false;
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    return !!match && checkAdminToken(c, match[1]!) === 'ok';
  };
  const isAdmin = (c: Context): boolean => !config.adminToken || hasAdminToken(c);
  /** Client prompt / persona need PLUSH_ALLOW_CLIENT_PROMPT; model overrides additionally need the admin token when one is set. */
  const modelOverrideAllowed = (c: Context): boolean => config.allowClientPrompt && isAdmin(c);

  /** Socket peer of the request (undefined in in-process tests without a socket). */
  const socketAddress = (c: Context): string | null => {
    try {
      return getConnInfo(c).remote.address ?? null;
    } catch {
      return null;
    }
  };
  /** A request made on this machine (see isLocalRequest); shared by the key routes and the prize-claim routes. */
  const isLocalCaller = (c: Context): boolean =>
    isLocalRequest({
      socketAddress: socketAddress(c),
      host: c.req.header('host') ?? null,
      origin: c.req.header('origin') ?? null,
      forwarded: FORWARDING_HEADERS.map((name) => c.req.header(name)),
      forwardedHost: c.req.header('x-forwarded-host') ?? null,
    });
  /**
   * Who may replace / test / restore the key: with PLUSH_KEY_MANAGEMENT=local
   * (default) a request made on this machine, or anyone with the admin token;
   * with "token" only the admin token; with "off" nobody.
   */
  const canManageKey = (c: Context): boolean => {
    if (keyManagement === 'off') return false;
    if (hasAdminToken(c)) return true;
    if (keyManagement === 'token') return false;
    return isLocalCaller(c);
  };
  const requireKeyManagement = (c: Context): void => {
    if (keyManagement === 'off') {
      throw new ApiFailure(403, 'key_management_off', 'Replacing the key is switched off on this server; it only reads OPENAI_API_KEY.');
    }
    if (!canManageKey(c)) {
      throw new ApiFailure(
        403,
        'forbidden',
        keyManagement === 'token'
          ? 'Changing the OpenAI key needs the admin token (Authorization: Bearer …).'
          : 'The OpenAI key can only be changed on the server machine itself (localhost) or with the admin token.',
      );
    }
  };
  const credentialStatus = (c: Context): CredentialStatus => {
    const active = keys.active();
    return {
      source: active.source,
      fingerprint: maskKey(active.key),
      envDefault: keys.hasEnvDefault(),
      savedAt: active.savedAt,
      management: keyManagement,
      canManage: canManageKey(c),
    };
  };
  const runKeyCheck = async (c: Context, key: string): Promise<{ result: KeyCheckResult; latencyMs: number }> => {
    const started = now();
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(config.keyCheckTimeoutMs)]);
    const result = await checkKey(key, signal);
    return { result, latencyMs: Math.round(now() - started) };
  };
  const readKeyField = async (c: Context, required: boolean): Promise<string | null> => {
    const text = await c.req.text();
    if (!text.trim()) {
      if (required) throw new ApiFailure(400, 'bad_request', 'Send the key as JSON: { "key": "…" }.');
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiFailure(400, 'bad_request', 'The request body must be JSON.');
    }
    const value = raw && typeof raw === 'object' ? (raw as { key?: unknown }).key : undefined;
    if (value === undefined || value === null || value === '') {
      if (required) throw new ApiFailure(400, 'bad_request', 'Send the key as JSON: { "key": "…" }.');
      return null;
    }
    const format = validateKeyFormat(value, config.baseUrl === null);
    if (!format.ok) throw new ApiFailure(400, 'invalid_key', format.reason);
    return format.key;
  };

  const readJson = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiFailure(400, 'bad_request', 'The request body must be JSON.');
    }
  };
  const requireKey = (): OpenAILike => {
    const client = activeClient();
    if (!client) {
      throw new ApiFailure(503, 'no_key', 'No OpenAI API key is configured on the server. The game uses its local lines.');
    }
    return client;
  };

  /* -------------------------------------------------------------- routes */

  app.get('/api/health', (c) => c.json({ ok: true, service: 'plush-portal-api', version: config.version, time: new Date(now()).toISOString() }));

  app.get('/api/ai/status', (c) => {
    const body: StatusResponseBody = {
      configured: activeClient() !== null,
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
      credential: credentialStatus(c),
    };
    return c.json(body);
  });

  /* ------------------------------------------------------- the OpenAI key */

  // Status only: source and the last four characters, never the key itself.
  app.get('/api/ai/key', (c) => {
    const body: CredentialResponseBody = { ok: true, credential: credentialStatus(c) };
    return c.json(body);
  });

  // Replaces the key: format check, optional check with OpenAI, then stored server-side and used at once.
  app.post('/api/ai/key', async (c) => {
    rateLimit(c, 2);
    requireKeyManagement(c);
    const key = (await readKeyField(c, true))!;
    let check: { result: KeyCheckResult; latencyMs: number } = { result: 'skipped', latencyMs: 0 };
    if (config.keyCheck) {
      check = await runKeyCheck(c, key);
      if (check.result === 'rejected') {
        logger.info('openai key replacement refused', { reason: 'rejected by OpenAI', fingerprint: maskKey(key) });
        throw new ApiFailure(400, 'key_rejected', 'OpenAI did not accept this key (401). Nothing was saved.');
      }
    }
    try {
      keys.replace(key);
    } catch {
      logger.error('openai key could not be stored', { dir: config.dataDir });
      throw new ApiFailure(500, 'key_storage', 'The key could not be saved on the server (data folder not writable).');
    }
    logger.addSecret?.(key);
    modelsCache = null;
    logger.info('openai key replaced in settings', { fingerprint: maskKey(key), check: check.result });
    const body: CredentialResponseBody = { ok: true, credential: credentialStatus(c), check };
    return c.json(body);
  });

  // Checks a candidate key (not stored) or, without a body, the key in use.
  app.post('/api/ai/key/test', async (c) => {
    rateLimit(c, 2);
    requireKeyManagement(c);
    const candidate = await readKeyField(c, false);
    const key = candidate ?? keys.active().key;
    if (!key) {
      const body: CredentialResponseBody = {
        ok: false,
        credential: credentialStatus(c),
        code: 'no_key',
        message: 'No OpenAI API key is configured on the server.',
      };
      return c.json(body);
    }
    const check = await runKeyCheck(c, key);
    const ok = check.result === 'ok' || check.result === 'restricted' || check.result === 'quota';
    const body: CredentialResponseBody = { ok, credential: credentialStatus(c), check };
    return c.json(body);
  });

  // Back to OPENAI_API_KEY from .env (or to no key at all).
  app.delete('/api/ai/key', (c) => {
    rateLimit(c);
    requireKeyManagement(c);
    try {
      keys.restoreDefault();
    } catch {
      throw new ApiFailure(500, 'key_storage', 'The stored key could not be removed from the server.');
    }
    modelsCache = null;
    logger.info('openai key restored to the default', { source: keys.active().source });
    const body: CredentialResponseBody = { ok: true, credential: credentialStatus(c) };
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
    const result = await speechService().synthesize({
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
    // The body is optional: an empty POST runs the text test only.
    let raw: unknown = {};
    const text = await c.req.text();
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ApiFailure(400, 'bad_request', 'The request body must be JSON.');
      }
    }
    const parsed = TestRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ApiFailure(400, 'bad_request', describeIssue(parsed.error));
    const client = activeClient();
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
        const audio = await speechService().synthesize({ text: sample, lang, signal: c.req.raw.signal });
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
    const client = activeClient();
    if (!client) {
      const empty: ModelsResponseBody = { configured: false, text: [], speech: [] };
      return c.json(empty);
    }
    const generation = keys.active().generation;
    if (modelsCache && modelsCache.generation === generation && now() - modelsCache.at < MODELS_CACHE_MS) return c.json(modelsCache.body);
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
    modelsCache = { at: now(), generation, body };
    return c.json(body);
  });

  /* ------------------------------------------------------ prize claims */

  const rewards =
    deps.rewards ??
    createRewardsService({
      enabled: config.rewards.enabled,
      ttlHours: config.rewards.ttlHours,
      storage: createMemoryRewardStorage(),
      brand: BRAND_KITS[config.brand],
      claimTarget: initialClaimTarget(config),
      now,
      logger,
    });
  const rewardDeps: RewardRouteDeps & RewardAuthDeps = {
    rewards,
    assets: deps.brandAssets ?? createBrandAssets(rewards.brand, config.rewards.assetDirs, now),
    logger,
    now,
    clientKey,
    isLocal: isLocalCaller,
    hasAdminToken,
    checkAdminToken,
  };
  // Before the /api catch-all and the static fallback, which would otherwise answer these paths.
  app.route('/', createRewardApiRoutes(rewardDeps));
  app.route('/', createClaimRoutes(rewardDeps));
  app.route('/', createStaffRoutes(rewardDeps));

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
