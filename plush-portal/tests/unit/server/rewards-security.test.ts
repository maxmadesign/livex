/**
 * Security review of the prize-claim server: each test below reproduces an attack that worked
 * against the first version (see docs/REWARDS.md, Security) and checks it is refused now.
 *
 *  - admin token oracle: GET /api/rewards/status answered `canIssue` for unlimited wrong guesses
 *  - PLUSH_TRUST_PROXY took the FIRST X-Forwarded-For entry, which the client chooses
 *  - IPv6 clients got one bucket per address (a phone holds a whole /64)
 *  - refused issue attempts behind a local proxy used up the kiosk's own budget
 *  - forwarding headers other than X-Forwarded-For / Forwarded / X-Real-IP were ignored
 *  - the claim form accepted posts from other sites
 *  - URLs with control characters were stored as sent
 *  - the claim listener let one device hold every file descriptor of the process
 *  - the prize desk said nothing when the rewards file was damaged at start
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN_FAILURES_PER_MIN, createApp, sameToken } from '../../../server/app';
import { addressKey, ipv6Groups } from '../../../server/clientKey';
import { loadConfig } from '../../../server/config';
import { limitConnections } from '../../../server/connLimit';
import { createLogger } from '../../../server/log';
import {
  REWARD_RATES,
  createBrandAssets,
  createClaimApp,
  createFileRewardStorage,
  createMemoryRewardStorage,
  createRewardsService,
  makeClientKey,
  startClaimListener,
  type RewardStorage,
} from '../../../server/rewards';
import { BRAND_KITS } from '../../../src/brand/kits';
import type { IssueRequestBody, RewardsStatusBody } from '../../../src/rewards/protocol';

const ADMIN = 'admin-token-SECURITY-0123456789';
const T0 = Date.parse('2026-11-24T10:00:00.000Z');

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plush-rewards-sec-'));
  temps.push(dir);
  return dir;
};

const issueBody = (overrides: Partial<IssueRequestBody> = {}): IssueRequestBody => ({
  session: 'sec12345',
  roundId: 1,
  prizeId: 'sec12345-1',
  prizeName: 'Neon Byte',
  tier: 'rare',
  themeId: 'gpu',
  lang: 'en',
  options: 'both',
  claimUrl: '',
  discountText: '',
  swagUrl: '',
  ...overrides,
});

type Init = RequestInit & { from?: string; host?: string; json?: unknown };

function build(env: Record<string, string> = {}, storage: RewardStorage = createMemoryRewardStorage()) {
  const config = loadConfig({ PLUSH_KEY_MANAGEMENT: 'off', ...env });
  const clock = { now: T0 };
  const logs: string[] = [];
  const logger = createLogger('debug', [config.adminToken], (line) => logs.push(line));
  const rewards = createRewardsService({
    enabled: true,
    ttlHours: 24,
    storage,
    brand: BRAND_KITS[config.brand],
    claimTarget: { base: 'http://192.168.1.5:8788', reach: 'lan' },
    now: () => clock.now,
    logger,
  });
  const assets = createBrandAssets(rewards.brand, config.rewards.assetDirs, () => clock.now);
  const app = createApp({ config, client: null, logger, now: () => clock.now, rewards, brandAssets: assets });
  const claimApp = createClaimApp({ rewards, assets, logger, now: () => clock.now, clientKey: makeClientKey(config.trustProxy) });
  const send = (target: { request: typeof app.request }, pathname: string, init: Init = {}) => {
    const { from = '127.0.0.1', host = '127.0.0.1:8787', json, headers, ...rest } = init;
    const all: Record<string, string> = { host, ...(headers as Record<string, string>) };
    let body = rest.body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      all['content-type'] = 'application/json';
    }
    return target.request(
      pathname,
      { ...rest, body, headers: all },
      { incoming: { socket: { remoteAddress: from, remotePort: 50000, remoteFamily: from.includes(':') ? 'IPv6' : 'IPv4' } } },
    ) as Promise<Response>;
  };
  const request = (pathname: string, init: Init = {}) => send(app, pathname, init);
  const lan = (pathname: string, init: Init = {}) => send(claimApp, pathname, { from: '192.168.1.40', host: '192.168.1.5:8788', ...init });
  return { config, clock, logs, rewards, request, lan };
}

const LAN = { from: '192.168.1.20', host: '192.168.1.5:8787' };
const status = async (response: Response) => (await response.json()) as RewardsStatusBody;
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe('admin token guessing', () => {
  it('locks a device out after a few wrong tokens, so /api/rewards/status is no oracle', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const guess = (token: string, from = LAN.from) => b.request('/api/rewards/status', { ...LAN, from, headers: { authorization: `Bearer ${token}` } });
    expect((await status(await guess(ADMIN))).canIssue).toBe(true);
    for (let i = 0; i < ADMIN_TOKEN_FAILURES_PER_MIN; i++) expect((await status(await guess(`wrong-${i}`))).canIssue).toBe(false);
    // Now even the right token is not compared: the answer no longer tells right from wrong.
    expect((await status(await guess(ADMIN))).canIssue).toBe(false);
    expect((await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), ...LAN, headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(403);
    expect((await b.request(`/staff/rewards?token=${ADMIN}`, LAN)).status).toBe(429);
    // Other devices are not affected, and the lock wears off (one more guess per 6 s).
    expect((await status(await guess(ADMIN, '192.168.1.21'))).canIssue).toBe(true);
    b.clock.now += 6_000;
    expect((await status(await guess(ADMIN))).canIssue).toBe(true);
    expect(b.logs.join('\n')).not.toContain(ADMIN);
  });

  it('counts wrong ?token= sign-ins and Authorization headers in the same budget', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    for (let i = 0; i < ADMIN_TOKEN_FAILURES_PER_MIN - 1; i++) expect((await b.request(`/staff/rewards?token=nope-${i}`, LAN)).status).toBe(403);
    expect((await b.request('/staff/rewards.csv', { ...LAN, headers: { authorization: 'Bearer nope-x' } })).status).toBe(403);
    const locked = await b.request(`/staff/rewards?token=${ADMIN}`, LAN);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).not.toBeNull();
    expect(locked.headers.get('set-cookie')).toBeNull();
    expect((await b.request('/staff/rewards', { ...LAN, headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(403);
    expect((await b.request('/staff/rewards')).status).toBe(200); // the booth machine itself needs no token
  });

  it('compares tokens without revealing their length', () => {
    expect(sameToken(ADMIN, ADMIN)).toBe(true);
    expect(sameToken(ADMIN, `${ADMIN}x`)).toBe(false);
    expect(sameToken('', ADMIN)).toBe(false);
  });
});

describe('rate-limit keys', () => {
  it('behind a trusted proxy uses the address the proxy appended, not the one the client sent', async () => {
    const b = build({ PLUSH_TRUST_PROXY: 'true' });
    const guesses: number[] = [];
    for (let i = 0; i < REWARD_RATES.claimPages + 5; i++) {
      // The client invents a new first entry every time; the proxy appends the real address.
      const response = await b.lan('/c/ZZZZZZZZ', { from: '127.0.0.1', headers: { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}, 203.0.113.7` } });
      guesses.push(response.status);
    }
    expect(guesses.filter((code) => code === 429)).toHaveLength(5);
    expect((await b.lan('/c/ZZZZZZZZ', { from: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.8' } })).status).toBe(404);
  });

  it('counts IPv6 clients by /64 and IPv4-mapped addresses as IPv4', async () => {
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(addressKey('[2001:db8:1:3::1]')).toBe('2001:db8:1:3::/64');
    expect(addressKey('fe80::1%wlan0')).toBe('fe80:0:0:0::/64');
    expect(addressKey('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(addressKey('192.168.1.20')).toBe('192.168.1.20');
    expect(addressKey('not-an-address')).toBe('not-an-address');
    expect(ipv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(ipv6Groups('1::2::3')).toBeNull();

    const b = build();
    for (let i = 0; i < REWARD_RATES.claimPages; i++) {
      expect((await b.lan('/c/ZZZZZZZZ', { from: `2001:db8:1:2::${(i + 1).toString(16)}` })).status).toBe(404);
    }
    expect((await b.lan('/c/ZZZZZZZZ', { from: '2001:db8:1:2:ffff::1' })).status).toBe(429);
    expect((await b.lan('/c/ZZZZZZZZ', { from: '2001:db8:1:3::1' })).status).toBe(404);
  });

  it('does not let refused issue attempts use up the kiosk budget', async () => {
    const b = build();
    // A phone behind the Vite dev proxy: loopback socket, its own address in X-Forwarded-For.
    for (let i = 0; i < REWARD_RATES.issue + 2; i++) {
      const refused = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ roundId: 100 + i }), headers: { 'x-forwarded-for': '192.168.1.66' } });
      expect(refused.status).toBe(403);
    }
    expect((await b.request('/api/rewards/issue', { method: 'POST', json: issueBody() })).status).toBe(200);
  });
});

describe('requests made on this machine', () => {
  it('refuses forwarded requests named by any common proxy, tunnel or CDN header', async () => {
    const b = build();
    const cases: Record<string, string>[] = [
      { 'x-forwarded-host': '192.168.1.5:5173' },
      { 'x-forwarded-host': 'localhost:5173, evil.example' },
      { 'cf-connecting-ip': '203.0.113.9' },
      { 'true-client-ip': '203.0.113.9' },
      { 'x-client-ip': '203.0.113.9' },
      { 'x-cluster-client-ip': '203.0.113.9' },
      { 'fastly-client-ip': '203.0.113.9' },
      { 'x-original-forwarded-for': '203.0.113.9' },
    ];
    for (const headers of cases) {
      const response = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), headers });
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect((await status(await b.request('/api/rewards/status', { headers }))).canIssue, JSON.stringify(headers)).toBe(false);
    }
    // The kiosk through the Vite dev proxy on this machine still works.
    const local = { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost:5173' };
    expect((await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), host: 'localhost:5173', headers: { ...local, origin: 'http://localhost:5173' } })).status).toBe(200);
    expect(b.rewards.counts().issued).toBe(1);
  });
});

describe('claim form', () => {
  it('refuses choices posted from another site', async () => {
    const b = build();
    const issued = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody() });
    const { code } = (await issued.json()) as { code: string };
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    for (const site of ['cross-site', 'same-site']) {
      const html = await b.lan(`/c/${code}/choose`, { method: 'POST', body: 'choice=swag', headers: { ...form, 'sec-fetch-site': site, origin: 'null' } });
      expect(html.status, site).toBe(403);
      expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await html.text()).toContain('This request came from another website');
      const json = await b.lan(`/c/${code}/choose`, { method: 'POST', json: { choice: 'swag' }, headers: { accept: 'application/json', 'sec-fetch-site': site } });
      expect(await errorCode(json)).toBe('forbidden');
    }
    expect(b.rewards.find(code)?.choice).toBeNull();
    // The page's own form (same-origin, Origin: null under no-referrer) and older browsers still work.
    expect((await b.lan(`/c/${code}/choose`, { method: 'POST', body: 'choice=prize', headers: { ...form, 'sec-fetch-site': 'same-origin', origin: 'null' } })).status).toBe(303);
    expect(b.rewards.find(code)?.choice).toBe('prize');
  });
});

describe('issue validation', () => {
  it('refuses URLs with control or bidi characters and trims spaces', async () => {
    const b = build();
    for (const swagUrl of ['https://shop.example/a\nb', 'https://shop.example/\t', 'https://shop.example/‮gnp.exe']) {
      const response = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ swagUrl, options: 'swag' }) });
      expect(response.status, JSON.stringify(swagUrl)).toBe(400);
    }
    const trimmed = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ swagUrl: '  https://shop.example/swag  ', claimUrl: ' https://claim.example/c/{code} ' }) });
    const body = (await trimmed.json()) as { code: string; url: string };
    expect(body.url).toBe(`https://claim.example/c/${body.code}`);
    expect(b.rewards.find(body.code)?.swagUrl).toBe('https://shop.example/swag');
  });
});

describe('prize desk', () => {
  it('tells staff when the rewards file was damaged, unreadable for this version, or newer', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'rewards.json'), '{"version":1,"records":[{"code":"ABC');
    const damaged = build({}, createFileRewardStorage(dir));
    const html = await (await damaged.request('/staff/rewards')).text();
    expect(html).toMatch(/role="alert">The rewards file was damaged when the server started\. It was kept as rewards\.json\.corrupt-[^,]+, and 0 codes were recovered/);

    const skipped = build({}, createMemoryRewardStorage(JSON.stringify({ version: 1, records: [{ code: 'nope' }, { code: 'ZZZZZZZZ' }] })));
    expect(await (await skipped.request('/staff/rewards?lang=ja')).text()).toContain('保存済みのコード 2 件をこのバージョンで読み取れませんでした');

    const newer = build({}, createMemoryRewardStorage(JSON.stringify({ version: 9, records: [] })));
    expect(await (await newer.request('/staff/rewards')).text()).toContain('no new codes are issued and no changes are saved');
    const refused = await newer.request('/api/rewards/issue', { method: 'POST', json: issueBody() });
    expect(await errorCode(refused)).toBe('storage');

    const healthy = build();
    expect(await (await healthy.request('/staff/rewards')).text()).not.toContain('role="alert"');
  });
});

describe('connection limits', () => {
  const connect = (port: number) =>
    new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => resolve(socket));
      socket.on('error', reject);
    });
  const closedSoon = (socket: net.Socket) =>
    new Promise<boolean>((resolve) => {
      if (socket.destroyed) return resolve(true);
      const timer = setTimeout(() => resolve(false), 400);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  it('caps the connections one device can hold on a listener that faces the booth network', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    // Loopback is normally exempt (the kiosk, a local tunnel); the test counts it like a phone.
    const open = limitConnections(server, { perAddress: 3, total: null }, undefined, () => false);
    const sockets = await Promise.all([1, 2, 3, 4, 5].map(() => connect(port)));
    try {
      const closed = await Promise.all(sockets.map(closedSoon));
      expect(closed.filter(Boolean)).toHaveLength(2);
      expect(open().get('127.0.0.1')).toBe(3);
      sockets[0]!.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = await connect(port);
      expect(await closedSoon(next)).toBe(false);
      next.destroy();
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('the claim listener applies its limits and short timeouts', async () => {
    const b = build();
    const claimApp = createClaimApp({ rewards: b.rewards, assets: createBrandAssets(b.rewards.brand, []), logger: createLogger('silent'), now: () => Date.now(), clientKey: makeClientKey(false) });
    const listener = startClaimListener({ app: claimApp, port: 0, host: '127.0.0.1', rewards: b.rewards, logger: createLogger('silent'), publicUrl: null, mainPort: 8787, lanAddress: () => null });
    try {
      await listener.ready;
      expect(listener.server.maxConnections).toBe(256);
      const http = listener.server as unknown as { headersTimeout: number; requestTimeout: number; keepAliveTimeout: number };
      expect(http.headersTimeout).toBe(10_000);
      expect(http.requestTimeout).toBe(20_000);
      expect(http.keepAliveTimeout).toBe(5_000);
    } finally {
      await new Promise<void>((resolve) => listener.close(resolve));
    }
  });
});
