/**
 * The OpenAI key at run time: store, masking, format checks, who may change it,
 * and the /api/ai/key routes. Every key in this file is a made-up test value.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, openAiKeyChecker, type ClientBundle, type KeyChecker, type OpenAILike } from '../../../server/app';
import { loadConfig } from '../../../server/config';
import {
  createFileKeyStore,
  createKeyManager,
  createMemoryKeyStore,
  forwardedAddresses,
  isLocalRequest,
  isLoopbackAddress,
  isLoopbackHostName,
  maskKey,
  validateKeyFormat,
  type KeyStore,
} from '../../../server/keys';
import { createLogger } from '../../../server/log';
import type { CredentialResponseBody, KeyCheckResult, StatusResponseBody } from '../../../src/ai/protocol';

const ENV_KEY = 'sk-test-ENVDEFAULT-000000000000wxyz';
const NEW_KEY = 'sk-test-REPLACED-1111111111111abcd';
const OTHER_KEY = 'sk-test-CANDIDATE-22222222222zzzz';
const ADMIN = 'admin-token-FOR-TESTS-123456';

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plush-keys-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------- helpers */

describe('masking and format checks', () => {
  it('shows only the last four characters', () => {
    expect(maskKey(NEW_KEY)).toBe('…abcd');
    expect(maskKey(null)).toBeNull();
    expect(maskKey('')).toBeNull();
    expect(maskKey('abc')).toBe('…');
    expect(maskKey(NEW_KEY)).not.toContain('sk-');
  });

  it('accepts OpenAI-shaped keys and refuses everything else without echoing it', () => {
    expect(validateKeyFormat(`  ${NEW_KEY}\n`)).toEqual({ ok: true, key: NEW_KEY });
    for (const bad of ['', '   ', 'hello', 'sk-short', `sk-${'x'.repeat(600)}`, 'sk-test with space-123456789', 'sk-test-ünïcode-1234567890', 42, null]) {
      const result = validateKeyFormat(bad);
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok && typeof bad === 'string' && bad.trim()) expect(result.reason).not.toContain(bad.trim().slice(0, 12));
    }
    expect(validateKeyFormat('gateway-token-123', true).ok).toBe(false);
    // With a custom OPENAI_BASE_URL (gateway) the "sk-" prefix is not required.
    expect(validateKeyFormat('gateway-token-123', false).ok).toBe(true);
  });
});

describe('file key store', () => {
  it('writes secrets.json with mode 0600 in a 0700 folder, atomically, and reads it back', () => {
    const dir = path.join(tempDir(), '.data');
    const store = createFileKeyStore(dir);
    expect(store.read()).toBeNull();
    store.write(NEW_KEY, '2026-11-24T10:00:00.000Z');
    const file = path.join(dir, 'secrets.json');
    expect(store.location).toBe(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual(['secrets.json']); // no temp file left behind
    expect(store.read()).toEqual({ key: NEW_KEY, savedAt: '2026-11-24T10:00:00.000Z' });
    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(store.read()).toBeNull();
    store.clear(); // idempotent
  });

  it('ignores a damaged or foreign file instead of crashing', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'secrets.json'), '{ not json');
    expect(createFileKeyStore(dir).read()).toBeNull();
    writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ openaiApiKey: 'has spaces in it' }));
    expect(createFileKeyStore(dir).read()).toBeNull();
  });
});

describe('key manager', () => {
  const bundle = (key: string) => ({ tag: key });

  it('uses the .env key by default, a stored replacement first, and goes back on restore', () => {
    const seen: string[] = [];
    const store = createMemoryKeyStore();
    const manager = createKeyManager({ envKey: ENV_KEY, store, createClients: bundle, onKey: (k) => seen.push(k) });
    expect(manager.active()).toMatchObject({ key: ENV_KEY, source: 'env', clients: { tag: ENV_KEY }, generation: 1, savedAt: null });
    manager.replace(NEW_KEY, new Date('2026-11-24T10:00:00Z'));
    expect(manager.active()).toMatchObject({ key: NEW_KEY, source: 'settings', clients: { tag: NEW_KEY }, generation: 2, savedAt: '2026-11-24T10:00:00.000Z' });
    expect(store.read()?.key).toBe(NEW_KEY);
    // A restart picks the stored key up again.
    const again = createKeyManager({ envKey: ENV_KEY, store, createClients: bundle });
    expect(again.active().source).toBe('settings');
    manager.restoreDefault();
    expect(manager.active()).toMatchObject({ key: ENV_KEY, source: 'env', generation: 3 });
    expect(store.read()).toBeNull();
    expect(seen).toEqual([ENV_KEY, NEW_KEY, ENV_KEY]);
  });

  it('reports no key without a default, and refuses to store when storage is off', () => {
    const manager = createKeyManager({ envKey: null, store: null, createClients: bundle });
    expect(manager.active()).toMatchObject({ key: null, source: 'none', clients: null });
    expect(manager.hasEnvDefault()).toBe(false);
    expect(() => manager.replace(NEW_KEY)).toThrow();
    manager.restoreDefault();
    expect(manager.active().source).toBe('none');
  });
});

describe('who counts as "this machine"', () => {
  it('recognises loopback addresses and host names', () => {
    for (const a of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '[::1]']) expect(isLoopbackAddress(a), a).toBe(true);
    for (const a of ['192.168.1.20', '10.0.0.1', '::ffff:192.168.1.2', 'fe80::1', '', null, undefined, '0.0.0.0']) expect(isLoopbackAddress(a), String(a)).toBe(false);
    for (const h of ['localhost', 'localhost:5173', '127.0.0.1:8787', '[::1]:8787', 'app.localhost']) expect(isLoopbackHostName(h), h).toBe(true);
    for (const h of ['192.168.1.20:5173', 'evil.example', 'localhost.evil.example', '', null]) expect(isLoopbackHostName(h), String(h)).toBe(false);
  });

  it('reads every address from the forwarding headers', () => {
    expect(forwardedAddresses(['192.168.1.20, 127.0.0.1', 'for=10.0.0.3;proto=https, for="[2001:db8::1]:4711"', '127.0.0.1'])).toEqual([
      '192.168.1.20',
      '127.0.0.1',
      '10.0.0.3',
      '2001:db8::1',
      '127.0.0.1',
    ]);
    expect(forwardedAddresses([undefined, null, ''])).toEqual([]);
  });

  it('accepts only loopback peers with loopback Host / Origin and no foreign forwarding', () => {
    const local = { socketAddress: '127.0.0.1', host: '127.0.0.1:8787', origin: null, forwarded: [] };
    expect(isLocalRequest(local)).toBe(true);
    expect(isLocalRequest({ ...local, origin: 'http://localhost:5173' })).toBe(true);
    expect(isLocalRequest({ ...local, forwarded: ['127.0.0.1'] })).toBe(true);
    // A phone on the LAN talking to the server directly.
    expect(isLocalRequest({ ...local, socketAddress: '192.168.1.20' })).toBe(false);
    // …or through the Vite dev proxy / a local reverse proxy that says who it really is.
    expect(isLocalRequest({ ...local, forwarded: ['192.168.1.20'] })).toBe(false);
    // DNS rebinding: a foreign name that resolves to 127.0.0.1.
    expect(isLocalRequest({ ...local, host: 'evil.example:8787' })).toBe(false);
    expect(isLocalRequest({ ...local, origin: 'http://evil.example:8787' })).toBe(false);
    expect(isLocalRequest({ ...local, origin: 'null' })).toBe(false);
    expect(isLocalRequest({ ...local, socketAddress: null })).toBe(false);
  });
});

/* -------------------------------------------------------------- routes */

interface Built {
  request: (pathName: string, init?: RequestInit & { from?: string; host?: string }) => Promise<Response>;
  bundles: { key: string; speechCalls: number; lines: number }[];
  checks: string[];
  store: KeyStore;
  logs: string[];
  setCheck: (result: KeyCheckResult) => void;
}

function build(env: Record<string, string> = {}, options: { store?: KeyStore } = {}): Built {
  const config = loadConfig({ OPENAI_API_KEY: ENV_KEY, OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'gpt-4o-mini-tts', PLUSH_LOG_LEVEL: 'debug', ...env });
  const logs: string[] = [];
  const logger = createLogger('debug', [config.apiKey, config.adminToken], (line) => logs.push(line));
  const bundles: Built['bundles'] = [];
  const createClients = (key: string): ClientBundle => {
    const record = { key, speechCalls: 0, lines: 0 };
    bundles.push(record);
    const client: OpenAILike = {
      responses: {
        create: async () => {
          record.lines++;
          return {
            model: 'gpt-6-luna',
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ text: 'Aim right over the tummy and try again!', emotion: 'think', shouldSpeak: true }) }] }],
          };
        },
      },
      audio: {
        speech: {
          create: async () => {
            record.speechCalls++;
            return { arrayBuffer: async () => new Uint8Array(512).fill(3).buffer };
          },
        },
      },
      models: { list: () => (async function* () {})() },
    };
    return { client, realtimeConnect: null };
  };
  const store = options.store ?? createMemoryKeyStore();
  const keys = createKeyManager<ClientBundle>({
    envKey: config.apiKey,
    store: config.keyManagement === 'off' ? null : store,
    createClients,
    onKey: (key) => logger.addSecret?.(key),
  });
  let checkResult: KeyCheckResult = 'ok';
  const checks: string[] = [];
  const checkKey: KeyChecker = async (key) => {
    checks.push(key);
    return checkResult;
  };
  const app = createApp({ config, keys, checkKey, logger });
  return {
    request: async (pathName, init = {}) => {
      const { from = '127.0.0.1', host = '127.0.0.1:8787', headers, ...rest } = init;
      return await app.request(
        pathName,
        { ...rest, headers: { host, ...(rest.body ? { 'content-type': 'application/json' } : {}), ...(headers as Record<string, string>) } },
        { incoming: { socket: { remoteAddress: from, remotePort: 50000, remoteFamily: from.includes(':') ? 'IPv6' : 'IPv4' } } },
      );
    },
    bundles,
    checks,
    store,
    logs,
    setCheck: (result) => {
      checkResult = result;
    },
  };
}

const post = (key: unknown, extra: RequestInit & { from?: string; host?: string } = {}) => ({ method: 'POST', body: JSON.stringify({ key }), ...extra });
const body = async (response: Response) => (await response.json()) as CredentialResponseBody & { error?: { code: string; message: string } };

describe('/api/ai/key routes', () => {
  it('status reports source, fingerprint and permission — never the key', async () => {
    const b = build();
    const status = (await (await b.request('/api/ai/status')).json()) as StatusResponseBody;
    expect(status.configured).toBe(true);
    expect(status.credential).toEqual({ source: 'env', fingerprint: '…wxyz', envDefault: true, savedAt: null, management: 'local', canManage: true });
    const text = JSON.stringify(status);
    expect(text).not.toContain(ENV_KEY);
    // Same rule as the end-to-end suite: no "sk-" and no field named like a key.
    expect(text).not.toMatch(/sk-|key"\s*:/i);
    const lan = (await (await b.request('/api/ai/key', { from: '192.168.1.20', host: '192.168.1.5:8787' })).json()) as CredentialResponseBody;
    expect(lan.credential.canManage).toBe(false);
  });

  it('replaces the key from this machine: checked, stored, used at once, never echoed or logged', async () => {
    const b = build();
    const saved = await b.request('/api/ai/key', post(`  ${NEW_KEY}  `));
    expect(saved.status).toBe(200);
    const result = await body(saved);
    expect(result).toMatchObject({ ok: true, check: { result: 'ok' }, credential: { source: 'settings', fingerprint: '…abcd', envDefault: true, canManage: true } });
    expect(b.checks).toEqual([NEW_KEY]);
    expect(b.store.read()?.key).toBe(NEW_KEY);
    // The next line and the next voice line use clients built for the new key.
    const line = await b.request('/api/ai/line', {
      method: 'POST',
      body: JSON.stringify({ event: { type: 'user_requested_tip', facts: { phase: 'READY' } }, theme: 'gpu', lang: 'en', recentLines: [], length: 'short' }),
    });
    expect(line.status).toBe(200);
    const speech = await b.request('/api/ai/speech', { method: 'POST', body: JSON.stringify({ text: 'Hello there!', lang: 'en' }) });
    expect(speech.status).toBe(200);
    const fresh = b.bundles.find((x) => x.key === NEW_KEY)!;
    expect(fresh.lines).toBe(1);
    expect(fresh.speechCalls).toBe(1);
    expect(b.bundles.find((x) => x.key === ENV_KEY)!.lines).toBe(0);
    const everything = [JSON.stringify(result), ...b.logs].join('\n');
    expect(everything).not.toContain(NEW_KEY);
    expect(everything).not.toContain(ENV_KEY);
    expect(b.logs.some((l) => l.includes('openai key replaced') && l.includes('…abcd'))).toBe(true);
  });

  it('restores the .env default with DELETE', async () => {
    const b = build();
    await b.request('/api/ai/key', post(NEW_KEY));
    const restored = await body(await b.request('/api/ai/key', { method: 'DELETE' }));
    expect(restored).toMatchObject({ ok: true, credential: { source: 'env', fingerprint: '…wxyz', savedAt: null } });
    expect(b.store.read()).toBeNull();
  });

  it('refuses requests that do not come from this machine (LAN, forwarded, rebinding, foreign origin)', async () => {
    const b = build();
    const cases: (RequestInit & { from?: string; host?: string })[] = [
      { from: '192.168.1.20', host: '192.168.1.5:8787' },
      { from: '127.0.0.1', headers: { 'x-forwarded-for': '192.168.1.20' } },
      { from: '127.0.0.1', headers: { forwarded: 'for=10.0.0.7' } },
      { from: '127.0.0.1', host: 'rebind.evil.example:8787' },
    ];
    for (const extra of cases) {
      for (const [route, init] of [
        ['/api/ai/key', post(NEW_KEY, extra)],
        ['/api/ai/key/test', post(NEW_KEY, extra)],
        ['/api/ai/key', { method: 'DELETE', ...extra }],
      ] as const) {
        const response = await b.request(route, init);
        expect(response.status, `${route} ${JSON.stringify(extra)}`).toBe(403);
        expect((await body(response)).error?.code).toBe('forbidden');
      }
    }
    // A page from another origin is stopped by the origin check before anything else.
    const foreign = await b.request('/api/ai/key', post(NEW_KEY, { headers: { origin: 'https://evil.example' } }));
    expect(foreign.status).toBe(403);
    expect(b.checks).toEqual([]);
    expect(b.store.read()).toBeNull();
  });

  it('accepts the admin token from anywhere, and only the token in "token" mode', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const lan = { from: '192.168.1.20', host: '192.168.1.5:8787' };
    expect((await b.request('/api/ai/key', post(NEW_KEY, { ...lan, headers: { authorization: 'Bearer wrong-token-000000' } }))).status).toBe(403);
    expect((await b.request('/api/ai/key', post(NEW_KEY, { ...lan, headers: { authorization: `Bearer ${ADMIN}` } }))).status).toBe(200);
    // Default mode: this machine still works without the token.
    expect((await b.request('/api/ai/key', { method: 'DELETE' })).status).toBe(200);

    const t = build({ PLUSH_ADMIN_TOKEN: ADMIN, PLUSH_KEY_MANAGEMENT: 'token' });
    expect((await t.request('/api/ai/key', post(NEW_KEY))).status).toBe(403);
    const status = (await (await t.request('/api/ai/key')).json()) as CredentialResponseBody;
    expect(status.credential).toMatchObject({ management: 'token', canManage: false });
    expect((await t.request('/api/ai/key', post(NEW_KEY, { headers: { authorization: `Bearer ${ADMIN}` } }))).status).toBe(200);
    expect(t.logs.join('\n')).not.toContain(ADMIN);
  });

  it('can be switched off entirely: only OPENAI_API_KEY counts, a stored key is ignored', async () => {
    const store = createMemoryKeyStore({ key: NEW_KEY, savedAt: '2026-01-01T00:00:00.000Z' });
    const b = build({ PLUSH_KEY_MANAGEMENT: 'off' }, { store });
    const status = (await (await b.request('/api/ai/status')).json()) as StatusResponseBody;
    expect(status.credential).toMatchObject({ source: 'env', fingerprint: '…wxyz', management: 'off', canManage: false });
    const response = await b.request('/api/ai/key', post(OTHER_KEY));
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe('key_management_off');
  });

  it('refuses malformed keys and keys OpenAI rejects; nothing is stored', async () => {
    const b = build();
    const malformed = await b.request('/api/ai/key', post('not a key at all'));
    expect(malformed.status).toBe(400);
    const m = await body(malformed);
    expect(m.error?.code).toBe('invalid_key');
    expect(m.error?.message).not.toContain('not a key');
    expect((await b.request('/api/ai/key', { method: 'POST', body: '{"key": ' })).status).toBe(400);
    expect((await b.request('/api/ai/key', { method: 'POST', body: '{}' })).status).toBe(400);
    b.setCheck('rejected');
    const rejected = await b.request('/api/ai/key', post(NEW_KEY));
    expect(rejected.status).toBe(400);
    expect((await body(rejected)).error?.code).toBe('key_rejected');
    expect(b.store.read()).toBeNull();
    const status = (await (await b.request('/api/ai/key')).json()) as CredentialResponseBody;
    expect(status.credential.source).toBe('env');
  });

  it('stores a key that could not be checked right now, and says so', async () => {
    const b = build();
    b.setCheck('unreachable');
    const saved = await body(await b.request('/api/ai/key', post(NEW_KEY)));
    expect(saved).toMatchObject({ ok: true, check: { result: 'unreachable' }, credential: { source: 'settings' } });
    const unchecked = build({ PLUSH_KEY_CHECK: 'false' });
    const skipped = await body(await unchecked.request('/api/ai/key', post(NEW_KEY)));
    expect(skipped.check?.result).toBe('skipped');
    expect(unchecked.checks).toEqual([]);
  });

  it('tests a candidate without storing it, or the key in use', async () => {
    const b = build();
    const candidate = await body(await b.request('/api/ai/key/test', post(OTHER_KEY)));
    expect(candidate).toMatchObject({ ok: true, check: { result: 'ok' }, credential: { source: 'env' } });
    expect(b.store.read()).toBeNull();
    const active = await body(await b.request('/api/ai/key/test', { method: 'POST' }));
    expect(active.ok).toBe(true);
    expect(b.checks).toEqual([OTHER_KEY, ENV_KEY]);
    b.setCheck('rejected');
    expect((await body(await b.request('/api/ai/key/test', { method: 'POST', body: '{}' }))).ok).toBe(false);
    const none = build({ OPENAI_API_KEY: '' });
    const noKey = await body(await none.request('/api/ai/key/test', { method: 'POST' }));
    expect(noKey).toMatchObject({ ok: false, code: 'no_key', credential: { source: 'none', fingerprint: null } });
  });

  it('a server without .env key starts with "none" and becomes configured after a replacement', async () => {
    const b = build({ OPENAI_API_KEY: '' });
    expect(((await (await b.request('/api/ai/status')).json()) as StatusResponseBody).configured).toBe(false);
    expect((await b.request('/api/ai/line', { method: 'POST', body: JSON.stringify({ event: { type: 'welcome', facts: { phase: 'READY' } }, theme: 'sakura', lang: 'en' }) })).status).toBe(503);
    await b.request('/api/ai/key', post(NEW_KEY));
    expect(((await (await b.request('/api/ai/status')).json()) as StatusResponseBody).configured).toBe(true);
    const restored = await body(await b.request('/api/ai/key', { method: 'DELETE' }));
    expect(restored.credential).toMatchObject({ source: 'none', fingerprint: null, envDefault: false });
  });

  it('works with the real file store and keeps the key out of everything it answers', async () => {
    const dir = tempDir();
    const b = build({}, { store: createFileKeyStore(dir) });
    const saved = await b.request('/api/ai/key', post(NEW_KEY));
    expect(saved.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(path.join(dir, 'secrets.json'), 'utf8')) as { openaiApiKey: string };
    expect(onDisk.openaiApiKey).toBe(NEW_KEY);
    for (const route of ['/api/ai/status', '/api/ai/key', '/api/health']) {
      expect(await (await b.request(route)).text(), route).not.toContain(NEW_KEY);
    }
  });
});

describe('checking a key with OpenAI', () => {
  it('asks GET {base}/models with only that key and maps the answer', async () => {
    const seen: { url: string; auth: string }[] = [];
    const answers: (number | Error)[] = [200, 401, 403, 429, 500, new TypeError('fetch failed')];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') ?? '' });
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return new Response('{}', { status: next });
    }) as typeof fetch;
    const check = openAiKeyChecker(null, fetchImpl);
    const results: KeyCheckResult[] = [];
    for (let i = 0; i < 6; i++) results.push(await check(NEW_KEY, new AbortController().signal));
    expect(results).toEqual(['ok', 'rejected', 'restricted', 'quota', 'unreachable', 'unreachable']);
    expect(seen[0]).toEqual({ url: 'https://api.openai.com/v1/models', auth: `Bearer ${NEW_KEY}` });
    const gateway = openAiKeyChecker('https://gateway.example/v1/', async (input) => {
      seen.push({ url: String(input), auth: '' });
      return new Response('{}', { status: 200 });
    });
    await gateway(NEW_KEY, new AbortController().signal);
    expect(seen.at(-1)!.url).toBe('https://gateway.example/v1/models');
  });
});
