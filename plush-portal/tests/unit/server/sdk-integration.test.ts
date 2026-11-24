/**
 * Wire-level check: the real `openai` SDK client (HTTP + Realtime WebSocket
 * helper) talking to local mock servers. This proves that the proxy's request
 * shapes survive the SDK unchanged and that the Realtime session really runs
 * over a socket. It does NOT prove that OpenAI accepts them: no key exists in
 * the build environment (see docs/AI.md, "Verified / not verified").
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { createApp, type OpenAILike } from '../../../server/app';
import { loadConfig } from '../../../server/config';
import { createLogger } from '../../../server/log';
import { openAiRealtimeConnect } from '../../../server/speech';
import { SPEECH_HEADERS, type LineResponseBody } from '../../../src/ai/protocol';

const KEY = 'sk-test-INTEGRATION-0123456789';
type Json = Record<string, unknown>;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
const listen = (server: Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

function makeCert(): { key: string; cert: string; dir: string } | null {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'plush-cert-'));
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      { cwd: dir, stdio: 'ignore' },
    );
    return { key: readFileSync(path.join(dir, 'key.pem'), 'utf8'), cert: readFileSync(path.join(dir, 'cert.pem'), 'utf8'), dir };
  } catch {
    return null; // no openssl on this machine: the Realtime socket test is skipped
  }
}

/* --------------------------------------------------------------- REST mock */

const rest = {
  requests: [] as { method: string; url: string; auth: string; body: Json | null }[],
  responsesStatus: 200,
  server: null as Server | null,
  port: 0,
};

beforeAll(async () => {
  rest.server = createHttpServer(async (req, res) => {
    const raw = await readBody(req);
    let body: Json | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Json) : null;
    } catch {
      body = null;
    }
    rest.requests.push({ method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body });
    const send = (status: number, payload: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof payload === 'string' || payload instanceof Uint8Array ? payload : JSON.stringify(payload));
    };
    if (req.method === 'POST' && req.url === '/v1/responses') {
      if (rest.responsesStatus !== 200) {
        send(rest.responsesStatus, { error: { message: `Incorrect API key provided: ${KEY}`, type: 'invalid_request_error', code: 'invalid_api_key', param: null } });
        return;
      }
      send(200, {
        id: 'resp_mock',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'gpt-6-luna-mock',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', annotations: [], text: JSON.stringify({ text: 'You got it! Cream Bunny is joining your collection.', emotion: 'cheer', shouldSpeak: true }) }],
          },
        ],
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/audio/speech') {
      send(200, new Uint8Array(1500).fill(3), 'audio/mpeg');
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      send(200, { object: 'list', data: [{ id: 'gpt-6-luna', object: 'model', created: 1, owned_by: 'openai' }, { id: 'gpt-realtime-2.1-mini', object: 'model', created: 1, owned_by: 'openai', shutdown_date: null }] });
      return;
    }
    send(404, { error: { message: 'not found', type: 'invalid_request_error', code: 'not_found' } });
  });
  rest.port = await listen(rest.server);
});
afterAll(() => {
  rest.server?.close();
});

function restApp(env: Record<string, string> = {}) {
  const config = loadConfig({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `http://127.0.0.1:${rest.port}/v1`, ...env });
  const logs: string[] = [];
  const client = new OpenAI({ apiKey: KEY, baseURL: config.baseUrl ?? undefined, maxRetries: 0 });
  const app = createApp({ config, client: client as unknown as OpenAILike, realtimeConnect: null, logger: createLogger('debug', [KEY], (l) => logs.push(l)) });
  return { app, logs, config };
}
const post = (app: ReturnType<typeof restApp>['app'], url: string, body: unknown) =>
  app.request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const WIN_BODY = {
  event: { type: 'prize_won', facts: { phase: 'RESULT', demo: false, attempts: 3, wins: 1, lossStreak: 0, outcome: 'won', toy: { typeId: 'cream_bunny', name: 'Cream Bunny', kind: 'bunny' }, newCharacter: true } },
  theme: 'sakura',
  lang: 'en',
  recentLines: [],
  length: 'short',
  temperature: 0.9,
};

describe('real OpenAI SDK client against a local mock (HTTP)', () => {
  it('sends a well-formed Responses API request and returns the structured line', async () => {
    rest.requests.length = 0;
    rest.responsesStatus = 200;
    const { app } = restApp();
    const response = await post(app, '/api/ai/line', WIN_BODY);
    expect(response.status).toBe(200);
    const line = (await response.json()) as LineResponseBody;
    expect(line).toMatchObject({ text: 'You got it! Cream Bunny is joining your collection.', emotion: 'cheer', shouldSpeak: true, model: 'gpt-6-luna-mock' });

    const sent = rest.requests[0]!;
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('/v1/responses');
    expect(sent.auth).toBe(`Bearer ${KEY}`);
    const body = sent.body!;
    expect(Object.keys(body).sort()).toEqual(['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'temperature', 'text']);
    expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, temperature: 0.9, reasoning: { effort: 'none' }, max_output_tokens: 240 });
    const format = (body.text as { format: Json }).format;
    expect(Object.keys(format).sort()).toEqual(['description', 'name', 'schema', 'strict', 'type']);
    expect(format).toMatchObject({ type: 'json_schema', name: 'momo_line', strict: true });
    expect(typeof body.input).toBe('string');
    expect(JSON.parse(body.input as string)).toMatchObject({ event: 'prize_won', facts: { toy: { name: 'Cream Bunny' }, newCharacter: true } });
  });

  it('maps a real SDK authentication error without leaking the upstream message', async () => {
    rest.requests.length = 0;
    rest.responsesStatus = 401;
    const { app, logs } = restApp();
    const response = await post(app, '/api/ai/line', WIN_BODY);
    rest.responsesStatus = 200;
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'upstream_auth' } });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('Incorrect API key');
    expect(logs.join('\n')).not.toContain(KEY);
    expect(rest.requests).toHaveLength(1); // 401 is not retried
  });

  it('calls the Speech API with a TTS model when that API is configured', async () => {
    rest.requests.length = 0;
    const { app } = restApp({ OPENAI_SPEECH_API: 'speech' });
    const response = await post(app, '/api/ai/speech', { text: 'Nice catch!', lang: 'en', voice: 'coral', speed: 1.1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get(SPEECH_HEADERS.api)).toBe('speech');
    expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(1500);
    const sent = rest.requests[0]!;
    expect(sent.url).toBe('/v1/audio/speech');
    expect(sent.auth).toBe(`Bearer ${KEY}`);
    expect(Object.keys(sent.body!).sort()).toEqual(['input', 'instructions', 'model', 'response_format', 'speed', 'voice']);
    expect(sent.body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Nice catch!', response_format: 'mp3', speed: 1.1 });
  });

  it('lists models through the SDK pager', async () => {
    rest.requests.length = 0;
    const { app } = restApp();
    const response = await app.request('http://localhost/api/ai/models');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      text: [{ id: 'gpt-6-luna', shutdownDate: null, sampling: 'temperature', reasoning: 'none' }],
      speech: [{ id: 'gpt-realtime-2.1-mini', api: 'realtime', shutdownDate: null }],
    });
    expect(rest.requests[0]!.url).toMatch(/^\/v1\/models/);
  });
});

/* ---------------------------------------------------- Realtime (wss) mock */

const tls = makeCert();

describe.skipIf(tls === null)('real OpenAI Realtime WebSocket helper against a local mock (wss)', () => {
  const seen = { url: '', auth: '', events: [] as Json[], behaviour: 'speak' as 'speak' | 'error' | 'hangup' };
  let httpsServer: ReturnType<typeof createHttpsServer> | null = null;
  let wss: WebSocketServer | null = null;
  let port = 0;

  beforeAll(async () => {
    httpsServer = createHttpsServer({ key: tls!.key, cert: tls!.cert });
    wss = new WebSocketServer({ server: httpsServer });
    wss.on('connection', (socket, req) => {
      seen.url = req.url ?? '';
      seen.auth = String(req.headers.authorization ?? '');
      const send = (event: Json) => socket.send(JSON.stringify(event));
      send({ type: 'session.created', event_id: 'ev_0', session: { type: 'realtime', model: 'gpt-realtime-2.1-mini' } });
      socket.on('message', (data) => {
        const event = JSON.parse(String(data)) as Json;
        seen.events.push(event);
        if (event.type === 'session.update') send({ type: 'session.updated', event_id: 'ev_1', session: event.session });
        if (event.type === 'response.create') {
          if (seen.behaviour === 'hangup') {
            socket.close();
            return;
          }
          if (seen.behaviour === 'error') {
            send({ type: 'error', event_id: 'ev_e', error: { type: 'invalid_request_error', code: 'rate_limit_exceeded', message: `slow down ${KEY}` } });
            return;
          }
          const pcm = Buffer.alloc(2400, 2).toString('base64');
          send({ type: 'response.created', event_id: 'ev_2', response: { id: 'resp_1', status: 'in_progress' } });
          for (let i = 0; i < 3; i++) {
            send({ type: 'response.output_audio.delta', event_id: `ev_d${i}`, response_id: 'resp_1', item_id: 'item_1', output_index: 0, content_index: 0, delta: pcm });
          }
          send({ type: 'response.output_audio_transcript.done', event_id: 'ev_t', response_id: 'resp_1', item_id: 'item_1', output_index: 0, content_index: 0, transcript: 'Nice catch!' });
          send({ type: 'response.output_audio.done', event_id: 'ev_3', response_id: 'resp_1', item_id: 'item_1', output_index: 0, content_index: 0 });
          send({ type: 'response.done', event_id: 'ev_4', response: { id: 'resp_1', status: 'completed', output: [] } });
        }
      });
    });
    port = await listen(httpsServer as unknown as Server);
  });
  afterAll(() => {
    wss?.close();
    httpsServer?.close();
    if (tls) rmSync(tls.dir, { recursive: true, force: true });
  });

  function realtimeApp() {
    const config = loadConfig({ OPENAI_API_KEY: KEY, PLUSH_SPEECH_TIMEOUT_MS: '4000', OPENAI_REALTIME_REASONING_EFFORT: 'low' });
    const logs: string[] = [];
    const client = new OpenAI({ apiKey: KEY, baseURL: `https://localhost:${port}/v1`, maxRetries: 0 });
    const app = createApp({
      config,
      client: client as unknown as OpenAILike,
      realtimeConnect: openAiRealtimeConnect(client, { ca: tls!.cert }),
      logger: createLogger('debug', [KEY], (l) => logs.push(l)),
    });
    return { app, logs };
  }

  it('runs a text-in / audio-out session and returns a WAV', async () => {
    seen.events.length = 0;
    seen.behaviour = 'speak';
    const { app } = realtimeApp();
    const response = await post(app, '/api/ai/speech', { text: 'Nice catch!', lang: 'en', voice: 'cedar', speed: 0.9 });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get(SPEECH_HEADERS.api)).toBe('realtime');
    expect(response.headers.get(SPEECH_HEADERS.voice)).toBe('cedar');
    const wav = new Uint8Array(await response.arrayBuffer());
    expect(wav.byteLength).toBe(44 + 3 * 2400);
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF');
    expect(wav[44]).toBe(2);

    // The SDK opened wss://…/v1/realtime?model=… with the server-side key.
    expect(seen.url).toBe('/v1/realtime?model=gpt-realtime-2.1-mini');
    expect(seen.auth).toBe(`Bearer ${KEY}`);
    expect(seen.events.map((e) => e.type)).toEqual(['session.update', 'conversation.item.create', 'response.create']);
    expect(seen.events[0]!.session).toEqual({
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: expect.stringContaining('Read the given line exactly as written'),
      audio: { input: { turn_detection: null }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'cedar', speed: 0.9 } },
      reasoning: { effort: 'low' },
    });
    expect(seen.events[1]!.item).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Read this line aloud exactly as written:\nNice catch!' }],
    });
    expect(seen.events[2]!.response).toEqual({ output_modalities: ['audio'] });
  });

  it('maps an API error event and a dropped connection', async () => {
    seen.behaviour = 'error';
    const first = realtimeApp();
    const failed = await post(first.app, '/api/ai/speech', { text: 'Hello again!', lang: 'en' });
    expect(failed.status).toBe(503);
    const text = await failed.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'upstream_rate_limited' } });
    expect(text).not.toContain(KEY);
    expect(first.logs.join('\n')).not.toContain(KEY);

    seen.behaviour = 'hangup';
    const second = realtimeApp();
    const dropped = await post(second.app, '/api/ai/speech', { text: 'Are you there?', lang: 'en' });
    expect(dropped.status).toBe(502);
    expect(JSON.parse(await dropped.text())).toMatchObject({ error: { code: 'upstream_error' } });
    seen.behaviour = 'speak';
  });

  it('reports a server that refuses the socket', async () => {
    const config = loadConfig({ OPENAI_API_KEY: KEY, PLUSH_SPEECH_TIMEOUT_MS: '3000' });
    // Nothing listens for TLS on the REST mock's port, so the handshake fails.
    const client = new OpenAI({ apiKey: KEY, baseURL: `https://127.0.0.1:${rest.port}/v1`, maxRetries: 0 });
    const app = createApp({ config, client: client as unknown as OpenAILike, realtimeConnect: openAiRealtimeConnect(client), logger: createLogger('silent') });
    const response = await post(app, '/api/ai/speech', { text: 'Hi', lang: 'en' });
    expect(response.status).toBe(502);
    expect(JSON.parse(await response.text())).toMatchObject({ error: { code: 'upstream_error' } });
  });
});
