import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, type OpenAILike } from '../../../server/app';
import { loadConfig, type ServerConfig } from '../../../server/config';
import { createLogger } from '../../../server/log';
import type { RealtimeConnect, RealtimeConnection } from '../../../server/speech';
import { resolveInside } from '../../../server/static';
import { SPEECH_HEADERS, type LineRequestBody, type LineResponseBody, type StatusResponseBody } from '../../../src/ai/protocol';

/* ------------------------------------------------------------------ helpers */

const KEY = 'sk-test-PLUSH-SECRET-0123456789abcdef';
const ADMIN = 'admin-token-ABCDEF-123456';

type Json = Record<string, unknown>;

const lineReply = (line: Json, model = 'gpt-6-luna-2026-09-01'): Json => ({
  id: 'resp_1',
  model,
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(line) }] }],
});
const GOOD_LINE = { text: 'Missed that one. Try moving the claw a bit more to the right.', emotion: 'think', shouldSpeak: true };

const upstreamError = (status: number | undefined, fields: Json = {}, message = `upstream failure with ${KEY}`) =>
  Object.assign(new Error(message), { status, ...fields });

interface FakeOpenAI {
  client: OpenAILike;
  responses: { body: Json; options?: { timeout?: number; maxRetries?: number } }[];
  speech: { body: Json }[];
  modelLists: number;
  /** Scripted answers for responses.create, consumed in order; then `fallback`. */
  script: ((body: Json) => unknown)[];
  fallback: (body: Json) => unknown;
  audioBytes: Uint8Array;
  models: { id: string; shutdown_date?: string | null }[];
}

function fakeOpenAI(): FakeOpenAI {
  const fake: FakeOpenAI = {
    responses: [],
    speech: [],
    modelLists: 0,
    script: [],
    fallback: () => lineReply(GOOD_LINE),
    audioBytes: new Uint8Array(2048).fill(7),
    models: [
      { id: 'gpt-6-luna' },
      { id: 'gpt-6.2-sol' },
      { id: 'gpt-4.1-mini', shutdown_date: '2027-01-14' },
      { id: 'gpt-realtime-2.1-mini' },
      { id: 'gpt-4o-mini-tts', shutdown_date: '2027-01-06' },
      { id: 'text-embedding-3-small' },
      { id: 'gpt-image-2' },
      { id: 'gpt-realtime-whisper' },
    ],
    client: {
      responses: {
        create: async (body, options) => {
          fake.responses.push({ body, options });
          const next = fake.script.shift() ?? fake.fallback;
          const result = next(body);
          if (result instanceof Error) throw result;
          return result;
        },
      },
      audio: {
        speech: {
          create: async (body) => {
            fake.speech.push({ body });
            return { arrayBuffer: async () => fake.audioBytes.slice().buffer };
          },
        },
      },
      models: {
        list: () =>
          (async function* () {
            fake.modelLists++;
            for (const model of fake.models) yield model;
          })(),
      },
    },
  };
  return fake;
}

interface FakeRealtime {
  connect: RealtimeConnect;
  sent: Json[];
  models: string[];
  closed: number;
  /** What the "server" does after response.create. */
  outcome: 'completed' | 'failed' | 'error' | 'silent';
  openError: Error | null;
}

function fakeRealtime(): FakeRealtime {
  const pcm = Buffer.alloc(4800, 1).toString('base64');
  const state: FakeRealtime = {
    sent: [],
    models: [],
    closed: 0,
    outcome: 'completed',
    openError: null,
    connect: (model) => {
      state.models.push(model);
      let onEvent: (event: never) => void = () => {};
      const emit = (event: Json) => queueMicrotask(() => onEvent(event as never));
      const connection: RealtimeConnection = {
        opened: state.openError ? Promise.reject(state.openError) : Promise.resolve(),
        send: (event) => {
          state.sent.push(event as unknown as Json);
          if (event.type === 'session.update') emit({ type: 'session.updated', event_id: 'e1', session: {} });
          if (event.type === 'response.create') {
            if (state.outcome === 'silent') return;
            if (state.outcome === 'error') {
              emit({ type: 'error', event_id: 'e9', error: { type: 'invalid_request_error', code: 'model_not_found', message: `no such model, key ${KEY}` } });
              return;
            }
            emit({ type: 'response.output_audio.delta', delta: pcm, event_id: 'e2', item_id: 'i', response_id: 'r', content_index: 0, output_index: 0 });
            emit({ type: 'response.output_audio.delta', delta: pcm, event_id: 'e3', item_id: 'i', response_id: 'r', content_index: 0, output_index: 0 });
            emit({ type: 'response.output_audio_transcript.done', transcript: 'Hi there!', event_id: 'e4', item_id: 'i', response_id: 'r', content_index: 0, output_index: 0 });
            emit({
              type: 'response.done',
              event_id: 'e5',
              response: state.outcome === 'completed' ? { status: 'completed' } : { status: 'failed', status_details: { type: 'failed', error: { code: 'server_error' } } },
            });
          }
        },
        onEvent: (listener) => {
          onEvent = listener as (event: never) => void;
        },
        onError: () => {},
        onClose: () => {},
        close: () => {
          state.closed++;
        },
      };
      connection.opened.catch(() => {});
      return connection;
    },
  };
  return state;
}

interface Harness {
  config: ServerConfig;
  openai: FakeOpenAI;
  realtime: FakeRealtime;
  logs: string[];
  clock: { now: number };
  request: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  /** Everything that left the server as text (bodies + logs), for leak checks. */
  transcript: string[];
}

function harness(env: Record<string, string | undefined> = {}, options: { key?: boolean; argv?: string[] } = {}): Harness {
  const withKey = options.key !== false;
  const config = loadConfig({ ...(withKey ? { OPENAI_API_KEY: KEY } : {}), PLUSH_LOG_LEVEL: 'debug', ...env }, options.argv ?? [], '9.9.9-test');
  const openai = fakeOpenAI();
  const realtime = fakeRealtime();
  const logs: string[] = [];
  const clock = { now: 1_800_000_000_000 };
  const logger = createLogger('debug', [config.apiKey, config.adminToken], (line) => logs.push(line));
  const app = createApp({
    config,
    client: withKey ? openai.client : null,
    realtimeConnect: withKey ? realtime.connect : null,
    logger,
    now: () => clock.now,
    sleep: async () => {},
  });
  const transcript: string[] = [];
  return {
    config,
    openai,
    realtime,
    logs,
    clock,
    transcript,
    request: async (pathname, init = {}) => {
      const { json: jsonBody, ...rest } = init;
      const headers = new Headers(rest.headers);
      let body = rest.body;
      if (jsonBody !== undefined) {
        body = JSON.stringify(jsonBody);
        headers.set('content-type', 'application/json');
        headers.set('content-length', String(Buffer.byteLength(body)));
      }
      const response = await app.request(`http://localhost${pathname}`, { ...rest, headers, body });
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('audio/')) transcript.push(await response.clone().text());
      transcript.push(JSON.stringify([...response.headers.entries()]));
      return response;
    },
  };
}

const lineBody = (overrides: Partial<LineRequestBody> = {}): LineRequestBody => ({
  event: {
    type: 'empty_grab',
    facts: {
      phase: 'RESULT',
      demo: false,
      attempts: 2,
      wins: 0,
      lossStreak: 2,
      outcome: 'empty',
      contact: 'none',
      nearest: { dx: 0.08, dz: -0.01, dist: 0.08, name: 'Cream Bunny' },
    },
  },
  theme: 'sakura',
  lang: 'en',
  recentLines: ['Hello there!'],
  length: 'short',
  temperature: 0.8,
  ...overrides,
});

const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

/* -------------------------------------------------------------------- tests */

describe('status and health', () => {
  it('reports configuration without any secret', async () => {
    const h = harness({ PLUSH_ADMIN_TOKEN: ADMIN });
    const health = await h.request('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    const response = await h.request('/api/ai/status');
    const status = (await response.json()) as StatusResponseBody;
    expect(status).toMatchObject({
      configured: true,
      provider: 'openai',
      textModel: 'gpt-6-luna',
      speechModel: 'gpt-realtime-2.1-mini',
      speechApi: 'realtime',
      voice: 'marin',
      allowClientPrompt: true,
      adminProtected: true,
      speechConfigError: '',
      version: '9.9.9-test',
    });
    expect(status.limits.ratePerMin).toBe(60);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const raw = h.transcript.join('\n');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(ADMIN);
    expect(Object.keys(status).join(',')).not.toMatch(/key|token|secret/i);
  });

  it('says so when no key is configured', async () => {
    const h = harness({}, { key: false });
    const status = (await (await h.request('/api/ai/status')).json()) as StatusResponseBody;
    expect(status.configured).toBe(false);
    const line = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(line.status).toBe(503);
    expect(await errorCode(line)).toBe('no_key');
    const speech = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(speech.status).toBe(503);
    expect(await errorCode(speech)).toBe('no_key');
    const test = await h.request('/api/ai/test', { method: 'POST', json: {} });
    expect(test.status).toBe(200);
    expect(await test.json()).toMatchObject({ ok: false, code: 'no_key' });
    const models = await h.request('/api/ai/models');
    expect(await models.json()).toEqual({ configured: false, text: [], speech: [] });
    expect(h.openai.responses).toHaveLength(0);
  });

  it('answers unknown API routes with JSON 404', async () => {
    const h = harness();
    const response = await h.request('/api/ai/nope');
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  });
});

describe('POST /api/ai/line', () => {
  it('returns a validated line and calls the Responses API with a strict schema', async () => {
    const h = harness();
    h.clock.now += 0;
    const response = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(response.status).toBe(200);
    const line = (await response.json()) as LineResponseBody;
    expect(line).toMatchObject({ ...GOOD_LINE, model: 'gpt-6-luna-2026-09-01' });
    expect(typeof line.latencyMs).toBe('number');

    expect(h.openai.responses).toHaveLength(1);
    const { body, options } = h.openai.responses[0]!;
    expect(body.model).toBe('gpt-6-luna');
    expect(body.store).toBe(false);
    expect(options?.maxRetries).toBe(0);
    expect(options?.timeout).toBeGreaterThan(0);
    const format = (body.text as { format: Json }).format;
    expect(format).toMatchObject({ type: 'json_schema', name: 'momo_line', strict: true });
    const schema = format.schema as { required: string[]; additionalProperties: boolean; properties: Json };
    expect(schema.required.sort()).toEqual(['emotion', 'shouldSpeak', 'text']);
    expect(schema.additionalProperties).toBe(false);
    expect((schema.properties.emotion as { enum: string[] }).enum).toEqual(['happy', 'cheer', 'think', 'oops', 'calm']);
    // Fixed rules are part of the instructions; the game context is a compact JSON document.
    expect(String(body.instructions)).toContain('Reply in English only');
    expect(String(body.instructions)).toContain('8-20 words');
    const input = JSON.parse(String(body.input)) as Json;
    expect(input.event).toBe('empty_grab');
    expect((input.facts as Json).nearest).toEqual({ dx: 0.08, dz: -0.01, dist: 0.08, name: 'Cream Bunny' });
    expect(input.recentLines).toEqual(['Hello there!']);
  });

  it('rejects invalid bodies before anything is sent upstream', async () => {
    const h = harness();
    const cases: unknown[] = [
      { ...lineBody(), theme: 'jungle' },
      { ...lineBody(), lang: 'fr' },
      { ...lineBody(), event: { type: 'made_up', facts: lineBody().event.facts } },
      { ...lineBody(), event: { type: 'welcome', facts: { demo: false } } },
      { ...lineBody(), length: 'novel' },
      { ...lineBody(), temperature: 9 },
      { ...lineBody(), model: 'gpt 6; rm -rf' },
      { ...lineBody(), recentLines: new Array(20).fill('x') },
      { ...lineBody(), systemPrompt: 'x'.repeat(5000) },
      'just a string',
      null,
    ];
    for (const body of cases) {
      const response = await h.request('/api/ai/line', { method: 'POST', json: body });
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await errorCode(response)).toBe('bad_request');
    }
    const notJson = await h.request('/api/ai/line', { method: 'POST', body: 'hello', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
    const tooBig = await h.request('/api/ai/line', { method: 'POST', body: 'a'.repeat(40_000), headers: { 'content-type': 'application/json', 'content-length': '40000' } });
    expect(tooBig.status).toBe(413);
    expect(await errorCode(tooBig)).toBe('payload_too_large');
    expect(h.openai.responses).toHaveLength(0);
  });

  it('strips anything that is not a whitelisted game fact', async () => {
    const h = harness();
    const body = lineBody() as unknown as Json;
    const facts = (body.event as { facts: Json }).facts;
    facts.faceLandmarks = [[0.1, 0.2, 0.3]];
    facts.eye = [0, 0.1, 0.6];
    body.roundId = 77;
    body.eventId = 'evt-123';
    body.cameraFrame = 'data:image/png;base64,AAAA';
    const response = await h.request('/api/ai/line', { method: 'POST', json: body });
    expect(response.status).toBe(200);
    const sent = JSON.stringify(h.openai.responses[0]!.body);
    expect(sent).not.toMatch(/faceLandmarks|cameraFrame|evt-123|roundId|eventId|"eye"/);
  });

  it('accepts slip reasons it does not know yet', async () => {
    const h = harness();
    const body = lineBody();
    body.event = { type: 'slipped_after_grip', facts: { ...body.event.facts, outcome: 'slipped', contact: 'lifted', slipReason: 'bounced_out' } };
    expect((await h.request('/api/ai/line', { method: 'POST', json: body })).status).toBe(200);
    expect(String(h.openai.responses[0]!.body.input)).toContain('bounced off the rim');
    const future = { ...body, event: { type: 'slipped_after_grip', facts: { ...body.event.facts, slipReason: 'reason_from_the_future' } } };
    expect((await h.request('/api/ai/line', { method: 'POST', json: future })).status).toBe(200);
    expect(String(h.openai.responses[1]!.body.input)).toContain('reason_from_the_future');
  });

  it('only sends sampling / reasoning parameters the model supports', async () => {
    const expectations: [string, { effort: string | undefined; temperature: boolean }][] = [
      ['gpt-6-luna', { effort: 'none', temperature: true }],
      ['gpt-6-sol', { effort: 'none', temperature: true }],
      ['gpt-6.2-sol', { effort: 'low', temperature: false }],
      ['gpt-6.2-astra', { effort: 'low', temperature: false }],
      ['gpt-6.1-terra', { effort: 'low', temperature: false }],
      ['gpt-5.6-luna', { effort: 'low', temperature: false }],
      ['gpt-5.4-mini', { effort: 'low', temperature: false }],
      ['gpt-5.2', { effort: 'none', temperature: true }],
      ['gpt-5.5-pro', { effort: undefined, temperature: false }],
      ['gpt-4.1-mini', { effort: undefined, temperature: true }],
      ['some-future-model', { effort: undefined, temperature: false }],
    ];
    for (const [model, want] of expectations) {
      const h = harness({ OPENAI_TEXT_MODEL: model });
      const response = await h.request('/api/ai/line', { method: 'POST', json: lineBody({ temperature: 0.7 }) });
      expect(response.status, model).toBe(200);
      const body = h.openai.responses[0]!.body;
      expect(body.model).toBe(model);
      expect((body.reasoning as { effort?: string } | undefined)?.effort, `${model} reasoning`).toBe(want.effort);
      expect('temperature' in body, `${model} temperature`).toBe(want.temperature);
      if (want.temperature) expect(body.temperature).toBe(0.7);
      expect('top_p' in body).toBe(false);
    }
  });

  it('learns from an "unsupported parameter" answer and stops sending the field', async () => {
    const h = harness();
    h.openai.script.push(() => upstreamError(400, { code: 'unsupported_parameter', param: 'temperature', type: 'invalid_request_error' }));
    const first = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(first.status).toBe(200);
    expect(h.openai.responses).toHaveLength(2);
    expect('temperature' in h.openai.responses[0]!.body).toBe(true);
    expect('temperature' in h.openai.responses[1]!.body).toBe(false);
    await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect('temperature' in h.openai.responses[2]!.body).toBe(false);

    const r = harness();
    r.openai.script.push(() => upstreamError(400, { code: 'unsupported_value', param: 'reasoning.effort' }));
    expect((await r.request('/api/ai/line', { method: 'POST', json: lineBody() })).status).toBe(200);
    expect((r.openai.responses[1]!.body.reasoning as { effort: string }).effort).toBe('low');
    expect('temperature' in r.openai.responses[1]!.body).toBe(false);
  });

  it('retries once on 429 / 5xx and then gives up with a mapped error', async () => {
    const h = harness();
    h.openai.script.push(() => upstreamError(429, { code: 'rate_limit_exceeded' }));
    expect((await h.request('/api/ai/line', { method: 'POST', json: lineBody() })).status).toBe(200);
    expect(h.openai.responses).toHaveLength(2);

    h.openai.script.push(
      () => upstreamError(503),
      () => upstreamError(500),
    );
    const failed = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(failed.status).toBe(502);
    expect(await errorCode(failed)).toBe('upstream_error');
    expect(h.openai.responses).toHaveLength(4);

    h.openai.script.push(
      () => upstreamError(429, { code: 'insufficient_quota' }),
      () => upstreamError(429, { code: 'insufficient_quota' }),
    );
    const limited = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(limited.status).toBe(503);
    expect(limited.headers.get('retry-after')).toBe('10');
    expect(await errorCode(limited)).toBe('upstream_rate_limited');
  });

  it('maps upstream failures without retrying hopeless ones or leaking upstream text', async () => {
    const cases: [Error, number, string][] = [
      [upstreamError(401, { code: 'invalid_api_key' }, `Incorrect API key provided: ${KEY}`), 502, 'upstream_auth'],
      [upstreamError(404, { code: 'model_not_found' }), 502, 'upstream_model'],
      [upstreamError(400, { code: 'invalid_prompt', param: 'input' }), 502, 'upstream_rejected'],
      [Object.assign(upstreamError(undefined), { name: 'APIConnectionTimeoutError' }), 504, 'timeout'],
      [Object.assign(upstreamError(undefined), { name: 'APIUserAbortError' }), 499, 'cancelled'],
    ];
    for (const [error, status, code] of cases) {
      const h = harness();
      h.openai.fallback = () => error;
      const response = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
      expect(response.status, code).toBe(status);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe(code);
      expect(body.error.message).not.toContain('Incorrect API key');
      expect(body.error.message).not.toContain('upstream failure');
      const expectedCalls = code === 'timeout' ? 2 : 1; // only the timeout is worth a second try
      expect(h.openai.responses, code).toHaveLength(expectedCalls);
      const everything = [...h.transcript, ...h.logs].join('\n');
      expect(everything).not.toContain(KEY);
    }
  });

  it('finds the structured line even when the response carries an extra message item', async () => {
    const h = harness();
    h.openai.fallback = () => ({
      model: 'gpt-6-luna',
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'Sure! Here is a line for you.' }] },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(GOOD_LINE) }] },
      ],
    });
    const response = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(response.status).toBe(200);
    expect(((await response.json()) as LineResponseBody).text).toBe(GOOD_LINE.text);
  });

  it('rejects output that breaks the schema, is refused, incomplete or far too long', async () => {
    const outputs: unknown[] = [
      lineReply({ text: 'ok', emotion: 'furious', shouldSpeak: true }),
      lineReply({ text: 'missing fields' }),
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json at all' }] }] },
      lineReply({ text: 'word '.repeat(70), emotion: 'happy', shouldSpeak: true }),
      lineReply({ text: '   ', emotion: 'happy', shouldSpeak: true }),
    ];
    for (const output of outputs) {
      const h = harness();
      h.openai.fallback = () => output;
      const response = await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
      expect(response.status).toBe(502);
      expect(await errorCode(response)).toBe('bad_output');
      expect(h.openai.responses).toHaveLength(1); // bad output is not retried
    }
  });

  it('trims a slightly long reply to whole sentences and tidies quotes', async () => {
    const h = harness();
    h.openai.fallback = () =>
      lineReply({
        text: '"Nice try! ' + 'That was honestly a very brave and careful attempt at a tricky toy. '.repeat(3) + '"',
        emotion: 'happy',
        shouldSpeak: true,
      });
    const line = (await (await h.request('/api/ai/line', { method: 'POST', json: lineBody() })).json()) as LineResponseBody;
    expect(line.text.startsWith('Nice try!')).toBe(true);
    expect(line.text.split(/\s+/).length).toBeLessThanOrEqual(24);
    expect(line.text).not.toContain('"');
  });

  it('uses client prompt and persona only when the server allows it; rules are always appended', async () => {
    const custom = lineBody({ systemPrompt: 'You are a pirate parrot.', persona: 'Grumpy but kind.' });
    const open = harness();
    await open.request('/api/ai/line', { method: 'POST', json: custom });
    const openInstructions = String(open.openai.responses[0]!.body.instructions);
    expect(openInstructions).toContain('You are a pirate parrot.');
    expect(openInstructions).toContain('Grumpy but kind.');
    expect(openInstructions).toContain('Never promise');

    const locked = harness({ PLUSH_ALLOW_CLIENT_PROMPT: 'false' });
    await locked.request('/api/ai/line', { method: 'POST', json: { ...custom, model: 'gpt-6.2-sol' } });
    const lockedInstructions = String(locked.openai.responses[0]!.body.instructions);
    expect(lockedInstructions).not.toContain('pirate');
    expect(lockedInstructions).not.toContain('Grumpy');
    expect(lockedInstructions).toContain('You are Momo');
    expect(locked.openai.responses[0]!.body.model).toBe('gpt-6-luna');
  });

  it('honours model overrides only for authorised requests and only for text models', async () => {
    const open = harness();
    await open.request('/api/ai/line', { method: 'POST', json: lineBody({ model: 'gpt-6.2-sol' }) });
    expect(open.openai.responses[0]!.body.model).toBe('gpt-6.2-sol');
    const mismatch = await open.request('/api/ai/line', { method: 'POST', json: lineBody({ model: 'gpt-realtime-2.1-mini' }) });
    expect(mismatch.status).toBe(400);
    expect(await errorCode(mismatch)).toBe('model_mismatch');

    const guarded = harness({ PLUSH_ADMIN_TOKEN: ADMIN });
    await guarded.request('/api/ai/line', { method: 'POST', json: lineBody({ model: 'gpt-6.2-sol' }) });
    expect(guarded.openai.responses[0]!.body.model).toBe('gpt-6-luna');
    await guarded.request('/api/ai/line', { method: 'POST', json: lineBody({ model: 'gpt-6.2-sol' }), headers: { authorization: 'Bearer wrong-token-000000000' } });
    expect(guarded.openai.responses[1]!.body.model).toBe('gpt-6-luna');
    await guarded.request('/api/ai/line', { method: 'POST', json: lineBody({ model: 'gpt-6.2-sol' }), headers: { authorization: `Bearer ${ADMIN}` } });
    expect(guarded.openai.responses[2]!.body.model).toBe('gpt-6.2-sol');
  });

  it('never waits longer than the client asked for', async () => {
    const h = harness();
    await h.request('/api/ai/line', { method: 'POST', json: lineBody({ timeoutMs: 1500 }) });
    expect(h.openai.responses[0]!.options?.timeout).toBeLessThanOrEqual(1500);
    await h.request('/api/ai/line', { method: 'POST', json: lineBody() });
    expect(h.openai.responses[1]!.options?.timeout).toBeLessThanOrEqual(h.config.textTimeoutMs);
  });
});

describe('POST /api/ai/speech', () => {
  it('speaks through the Realtime API by default: text in, WAV out', async () => {
    const h = harness();
    const response = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi there!', lang: 'en', speed: 1.1 } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get(SPEECH_HEADERS.api)).toBe('realtime');
    expect(response.headers.get(SPEECH_HEADERS.model)).toBe('gpt-realtime-2.1-mini');
    expect(response.headers.get(SPEECH_HEADERS.voice)).toBe('marin');
    expect(response.headers.get(SPEECH_HEADERS.cache)).toBe('miss');
    const wav = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF');
    expect(Buffer.from(wav.subarray(8, 12)).toString()).toBe('WAVE');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(9600);
    expect(wav.byteLength).toBe(44 + 9600);

    // Session is configured for audio out only, then the line is sent as text.
    expect(h.realtime.models).toEqual(['gpt-realtime-2.1-mini']);
    expect(h.realtime.sent.map((event) => event.type)).toEqual(['session.update', 'conversation.item.create', 'response.create']);
    const session = h.realtime.sent[0]!.session as Json;
    expect(session.type).toBe('realtime');
    expect(session.output_modalities).toEqual(['audio']);
    expect(session.audio).toEqual({
      input: { turn_detection: null },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin', speed: 1.1 },
    });
    expect('reasoning' in session).toBe(false);
    const item = h.realtime.sent[1]!.item as { role: string; content: { type: string; text: string }[] };
    expect(item.role).toBe('user');
    expect(item.content[0]!.type).toBe('input_text');
    expect(item.content[0]!.text).toContain('Hi there!');
    expect(h.realtime.closed).toBe(1);
    expect(h.openai.speech).toHaveLength(0);
  });

  it('caches identical requests', async () => {
    const h = harness();
    const body = { text: 'Nice catch!', lang: 'en' };
    await h.request('/api/ai/speech', { method: 'POST', json: body });
    const again = await h.request('/api/ai/speech', { method: 'POST', json: body });
    expect(again.headers.get(SPEECH_HEADERS.cache)).toBe('hit');
    expect(h.realtime.models).toHaveLength(1);
    await h.request('/api/ai/speech', { method: 'POST', json: { ...body, speed: 1.2 } });
    expect(h.realtime.models).toHaveLength(2);
  });

  it('uses the Speech API when configured, with instructions only where supported', async () => {
    const mini = harness({ OPENAI_SPEECH_API: 'speech' });
    const response = await mini.request('/api/ai/speech', { method: 'POST', json: { text: '抓到啦！', lang: 'zh', voice: 'nova' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get(SPEECH_HEADERS.api)).toBe('speech');
    expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(2048);
    const body = mini.openai.speech[0]!.body;
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', input: '抓到啦！', response_format: 'mp3', speed: 1 });
    expect(String(body.instructions)).toContain('Simplified Chinese');
    expect(mini.realtime.models).toHaveLength(0);
    const status = (await (await mini.request('/api/ai/status')).json()) as StatusResponseBody;
    expect(status.warnings.join(' ')).toMatch(/2027-01-06/);

    const classic = harness({ OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'tts-1' });
    await classic.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect('instructions' in classic.openai.speech[0]!.body).toBe(false);
  });

  it('falls back to the configured voice when the requested one does not exist for the API', async () => {
    const h = harness();
    const response = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en', voice: 'nova' } });
    expect(response.headers.get(SPEECH_HEADERS.voice)).toBe('marin'); // nova is a Speech API voice only
    const coral = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en', voice: 'coral' } });
    expect(coral.headers.get(SPEECH_HEADERS.voice)).toBe('coral');
  });

  it('refuses to put a model into the wrong speech endpoint', async () => {
    // A text model configured as speech model: nothing is ever sent upstream.
    const text = harness({ OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'gpt-6-luna' });
    const status = (await (await text.request('/api/ai/status')).json()) as StatusResponseBody;
    expect(status.speechConfigError).toContain('gpt-6-luna');
    const refused = await text.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(refused.status).toBe(503);
    expect(await errorCode(refused)).toBe('model_mismatch');
    expect(text.openai.speech).toHaveLength(0);

    // A TTS model pointed at Realtime, and a Realtime model pointed at the Speech API.
    for (const env of [
      { OPENAI_SPEECH_API: 'realtime', OPENAI_SPEECH_MODEL: 'gpt-4o-mini-tts' },
      { OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'gpt-realtime-2.1-mini' },
    ]) {
      const h = harness(env);
      const response = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
      expect(await errorCode(response)).toBe('model_mismatch');
      expect(h.openai.speech).toHaveLength(0);
      expect(h.realtime.models).toHaveLength(0);
    }

    // Per-request overrides are checked the same way.
    const open = harness();
    for (const model of ['gpt-6-luna', 'gpt-4o-mini-tts', 'tts-1']) {
      const response = await open.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en', model } });
      expect(response.status, model).toBe(400);
      expect(await errorCode(response)).toBe('model_mismatch');
    }
    expect(open.realtime.models).toHaveLength(0);
    const ok = await open.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en', model: 'gpt-realtime-2.1' } });
    expect(ok.status).toBe(200);
    expect(open.realtime.models).toEqual(['gpt-realtime-2.1']);
  });

  it('maps Realtime failures and always closes the session', async () => {
    const failed = harness();
    failed.realtime.outcome = 'failed';
    const a = await failed.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(a.status).toBe(502);
    expect(await errorCode(a)).toBe('bad_output');
    expect(failed.realtime.closed).toBe(1);

    const errored = harness();
    errored.realtime.outcome = 'error';
    const b = await errored.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(await errorCode(b)).toBe('upstream_model');
    expect(errored.realtime.closed).toBe(1);

    const refused = harness();
    refused.realtime.openError = new Error('Unexpected server response: 401');
    const c = await refused.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(await errorCode(c)).toBe('upstream_auth');

    const everything = [...failed.transcript, ...errored.transcript, ...refused.transcript, ...errored.logs].join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('no such model');
  });

  it('times out a Realtime session that never answers', async () => {
    const h = harness({ PLUSH_SPEECH_TIMEOUT_MS: '2000' });
    h.realtime.outcome = 'silent';
    const started = Date.now();
    const response = await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' } });
    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe('timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(h.realtime.closed).toBe(1);
  }, 10_000);

  it('validates the body', async () => {
    const h = harness();
    for (const body of [{ lang: 'en' }, { text: '', lang: 'en' }, { text: 'x'.repeat(400), lang: 'en' }, { text: 'Hi', lang: 'xx' }, { text: 'Hi', lang: 'en', speed: 3 }, { text: 'Hi', lang: 'en', voice: 'a b' }]) {
      const response = await h.request('/api/ai/speech', { method: 'POST', json: body });
      expect(response.status).toBe(400);
    }
    expect(h.realtime.models).toHaveLength(0);
  });
});

describe('rate limiting, origins and admin protection', () => {
  it('limits paid routes per client and tells the client when to retry', async () => {
    const h = harness({ PLUSH_RATE_LIMIT_PER_MIN: '3', PLUSH_TRUST_PROXY: 'true' });
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < 3; i++) {
      expect((await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: from('10.0.0.1') })).status).toBe(200);
    }
    const blocked = await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: from('10.0.0.1') });
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(h.openai.responses).toHaveLength(3);
    // Another client is unaffected; status and health are never limited.
    expect((await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: from('10.0.0.2') })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await h.request('/api/ai/status', { headers: from('10.0.0.1') })).status).toBe(200);
    // Tokens come back with time.
    h.clock.now += 21_000;
    expect((await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: from('10.0.0.1') })).status).toBe(200);
    expect((await h.request('/api/ai/speech', { method: 'POST', json: { text: 'Hi', lang: 'en' }, headers: from('10.0.0.1') })).status).toBe(429);
  });

  it('ignores X-Forwarded-For unless a proxy is trusted', async () => {
    const h = harness({ PLUSH_RATE_LIMIT_PER_MIN: '2' });
    await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { 'x-forwarded-for': '1.1.1.1' } });
    await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { 'x-forwarded-for': '2.2.2.2' } });
    const third = await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { 'x-forwarded-for': '3.3.3.3' } });
    expect(third.status).toBe(429);
  });

  it('refuses foreign origins and only sends CORS headers to allowed ones', async () => {
    const h = harness({ PLUSH_ALLOWED_ORIGINS: 'https://kiosk.example, https://play.example/' });
    const foreign = await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(await errorCode(foreign)).toBe('forbidden');
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect(h.openai.responses).toHaveLength(0);

    const allowed = await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { origin: 'https://play.example' } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://play.example');

    const preflight = await h.request('/api/ai/line', { method: 'OPTIONS', headers: { origin: 'https://kiosk.example', 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://kiosk.example');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');

    // Same origin (dev proxy / --serve-dist) needs no allow list entry.
    const same = await h.request('/api/ai/line', { method: 'POST', json: lineBody(), headers: { origin: 'http://localhost', host: 'localhost' } });
    expect(same.status).toBe(200);
  });

  it('protects the connection test with the admin token when one is set', async () => {
    const h = harness({ PLUSH_ADMIN_TOKEN: ADMIN });
    const anonymous = await h.request('/api/ai/test', { method: 'POST', json: {} });
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe('forbidden');
    const wrong = await h.request('/api/ai/test', { method: 'POST', json: {}, headers: { authorization: 'Bearer nope-nope-nope-nope' } });
    expect(wrong.status).toBe(401);
    expect(h.openai.responses).toHaveLength(0);
    const admin = await h.request('/api/ai/test', { method: 'POST', json: { speech: true, lang: 'ja' }, headers: { authorization: `Bearer ${ADMIN}` } });
    expect(admin.status).toBe(200);
    const body = (await admin.json()) as { ok: boolean; text: Json; speech: Json };
    expect(body.ok).toBe(true);
    expect(body.text).toMatchObject({ ok: true, model: 'gpt-6-luna-2026-09-01', sample: GOOD_LINE.text });
    expect(body.speech).toMatchObject({ ok: true, api: 'realtime', model: 'gpt-realtime-2.1-mini', bytes: 44 + 9600 });
    expect(String(h.openai.responses[0]!.body.instructions)).toContain('Japanese');
    const everything = [...h.transcript, ...h.logs].join('\n');
    expect(everything).not.toContain(ADMIN);
    expect(everything).not.toContain(KEY);
  });

  it('reports a failing round trip in the test result instead of an HTTP error', async () => {
    const h = harness();
    h.openai.fallback = () => upstreamError(401, { code: 'invalid_api_key' });
    h.realtime.openError = new Error('Unexpected server response: 401');
    const response = await h.request('/api/ai/test', { method: 'POST', json: { speech: true } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'upstream_auth',
      text: { ok: false, code: 'upstream_auth' },
      speech: { ok: false, code: 'upstream_auth' },
    });
  });
});

describe('GET /api/ai/models', () => {
  it('lists what the key can really use, classified and cached', async () => {
    const h = harness();
    const response = await h.request('/api/ai/models');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean; text: Json[]; speech: Json[] };
    expect(body.configured).toBe(true);
    expect(body.text).toEqual([
      { id: 'gpt-4.1-mini', shutdownDate: '2027-01-14', sampling: 'temperature', reasoning: null },
      { id: 'gpt-6-luna', shutdownDate: null, sampling: 'temperature', reasoning: 'none' },
      { id: 'gpt-6.2-sol', shutdownDate: null, sampling: 'none', reasoning: 'low' },
    ]);
    expect(body.speech).toEqual([
      { id: 'gpt-4o-mini-tts', api: 'speech', shutdownDate: '2027-01-06' },
      { id: 'gpt-realtime-2.1-mini', api: 'realtime', shutdownDate: null },
    ]);
    await h.request('/api/ai/models');
    expect(h.openai.modelLists).toBe(1);
    h.clock.now += 6 * 60_000;
    await h.request('/api/ai/models');
    expect(h.openai.modelLists).toBe(2);
  });
});

describe('logging', () => {
  it('never writes the key, bearer tokens or full prompts', async () => {
    const h = harness({ PLUSH_ADMIN_TOKEN: ADMIN });
    h.openai.script.push(() => upstreamError(500, {}, `boom ${KEY}`));
    await h.request('/api/ai/line', {
      method: 'POST',
      json: lineBody({ systemPrompt: 'SECRET-PROMPT '.repeat(100) }),
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    const logs = h.logs.join('\n');
    expect(logs).toContain('path="/api/ai/line"');
    expect(logs).not.toContain(KEY);
    expect(logs).not.toContain(ADMIN);
    expect(logs).not.toContain('SECRET-PROMPT');
    const logger = createLogger('debug', [KEY], (line) => h.logs.push(line));
    logger.error('upstream said', { detail: `Incorrect API key provided: ${KEY}`, header: `Bearer abcdefghijklmnop`, other: 'sk-proj-ABCDEFGH12345678', long: 'x'.repeat(500) });
    const last = h.logs[h.logs.length - 1]!;
    expect(last).not.toContain(KEY);
    expect(last).not.toContain('abcdefghijklmnop');
    expect(last).not.toContain('ABCDEFGH12345678');
    expect(last).toContain('[redacted]');
    expect(last.length).toBeLessThan(700);
  });
});

describe('static files (--serve-dist)', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'plush-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  mkdirSync(path.join(dist, 'mediapipe'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>PLUSH PORTAL</title>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'mediapipe', 'vision.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(path.join(dist, 'mediapipe', 'face_landmarker.task'), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(dist, 'bunny.glb'), Buffer.from('glTF'));
  writeFileSync(path.join(dist, 'theme.mp3'), Buffer.from([0xff, 0xfb]));
  writeFileSync(path.join(path.dirname(dist), 'plush-secret.txt'), 'outside');
  afterAll(() => {
    rmSync(dist, { recursive: true, force: true });
    rmSync(path.join(path.dirname(dist), 'plush-secret.txt'), { force: true });
  });
  const served = () => harness({ PLUSH_DIST_DIR: dist }, { argv: ['--serve-dist'] });

  it('serves the build with correct MIME types and cache headers', async () => {
    const h = served();
    const expectations: [string, string, string][] = [
      ['/', 'text/html; charset=utf-8', 'no-cache'],
      ['/index.html', 'text/html; charset=utf-8', 'no-cache'],
      ['/assets/index-abc123.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable'],
      ['/mediapipe/vision.wasm', 'application/wasm', 'public, max-age=3600'],
      ['/mediapipe/face_landmarker.task', 'application/octet-stream', 'public, max-age=3600'],
      ['/bunny.glb', 'model/gltf-binary', 'public, max-age=3600'],
      ['/theme.mp3', 'audio/mpeg', 'public, max-age=3600'],
    ];
    for (const [url, type, cache] of expectations) {
      const response = await h.request(url);
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-type'), url).toBe(type);
      expect(response.headers.get('cache-control'), url).toBe(cache);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const wasm = new Uint8Array(await (await h.request('/mediapipe/vision.wasm')).arrayBuffer());
    expect([...wasm]).toEqual([0, 97, 115, 109]);
    const head = await h.request('/bunny.glb', { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('4');
    expect(await head.text()).toBe('');
  });

  it('falls back to the app shell for routes but not for missing assets', async () => {
    const h = served();
    const route = await h.request('/collection/sakura');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('PLUSH PORTAL');
    const missing = await h.request('/assets/nope.js');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('text/plain');
    // API routes are never shadowed by the static handler.
    expect((await h.request('/api/health')).headers.get('content-type')).toContain('application/json');
    expect((await h.request('/api/unknown')).status).toBe(404);
  });

  it('never serves files outside the build directory', async () => {
    const h = served();
    for (const url of ['/%2e%2e/plush-secret.txt', '/..%2fplush-secret.txt', '/assets/..%2f..%2fplush-secret.txt', '/%00.html', '/a%5c..%5cplush-secret.txt']) {
      const response = await h.request(url);
      expect(await response.text(), url).not.toContain('outside');
      expect([400, 404], url).toContain(response.status);
    }
    expect(resolveInside(dist, '/../plush-secret.txt')).toBe(path.join(dist, 'plush-secret.txt'));
    expect(resolveInside(dist, '/assets/../../../etc/passwd')).toBe(path.join(dist, 'etc', 'passwd'));
    expect(resolveInside(dist, '/%E0%A4%A')).toBeNull();
    expect(resolveInside(dist, '/a\\b')).toBeNull();
  });

  it('explains what to do when there is no build yet', async () => {
    const h = harness({ PLUSH_DIST_DIR: path.join(dist, 'does-not-exist') }, { argv: ['--serve-dist'] });
    const response = await h.request('/');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('npm run build');
  });

  it('does not serve files at all without --serve-dist', async () => {
    const h = harness({ PLUSH_DIST_DIR: dist });
    expect((await h.request('/')).status).toBe(404);
  });
});
