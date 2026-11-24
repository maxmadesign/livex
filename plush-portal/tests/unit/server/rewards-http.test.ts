/**
 * Prize claim routes over HTTP: who may issue codes, validation and rate limits, the public claim
 * pages (escaping, CSP and other headers, choose once, languages, expiry), the staff page (auth,
 * token cookie, same-origin redeem, CSV) and the LAN claim listener (claim routes only).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../server/app';
import { loadConfig } from '../../../server/config';
import { createLogger } from '../../../server/log';
import {
  createBrandAssets,
  createClaimApp,
  createMemoryRewardStorage,
  createRewardsService,
  makeClientKey,
  preferredLang,
  rootOf,
  startClaimListener,
  type BrandAssets,
} from '../../../server/rewards';
import { BRAND_KITS } from '../../../src/brand/kits';
import { formatCode, type IssueRequestBody, type IssueResponseBody, type RewardsStatusBody } from '../../../src/rewards/protocol';

const ADMIN = 'admin-token-REWARDS-0123456789';
const T0 = Date.parse('2026-11-24T10:00:00.000Z');

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plush-rewards-http-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const issueBody = (overrides: Partial<IssueRequestBody> = {}): IssueRequestBody => ({
  session: 'k3x9q2ab',
  roundId: 4,
  prizeId: 'k3x9q2ab-4',
  prizeName: 'Neon Byte',
  tier: 'legendary',
  themeId: 'gpu',
  lang: 'en',
  options: 'both',
  claimUrl: '',
  discountText: '20% off all swag',
  swagUrl: '',
  ...overrides,
});

type Init = RequestInit & { from?: string; host?: string; json?: unknown; form?: Record<string, string> };

function build(env: Record<string, string> = {}, options: { assets?: BrandAssets; level?: 'debug' | 'info' } = {}) {
  const config = loadConfig({ PLUSH_KEY_MANAGEMENT: 'off', ...env });
  const clock = { now: T0 };
  const logs: string[] = [];
  const logger = createLogger(options.level ?? 'debug', [config.adminToken], (line) => logs.push(line));
  const storage = createMemoryRewardStorage();
  const rewards = createRewardsService({
    enabled: config.rewards.enabled,
    ttlHours: config.rewards.ttlHours,
    storage,
    brand: BRAND_KITS[config.brand],
    claimTarget: { base: 'http://192.168.1.5:8788', reach: 'lan' },
    now: () => clock.now,
    logger,
  });
  const assets = options.assets ?? createBrandAssets(rewards.brand, config.rewards.assetDirs, () => clock.now);
  const app = createApp({ config, client: null, logger, now: () => clock.now, rewards, brandAssets: assets });
  const claimApp = createClaimApp({ rewards, assets, logger, now: () => clock.now, clientKey: makeClientKey(false) });

  const send = (target: { request: typeof app.request }, pathname: string, init: Init = {}) => {
    const { from = '127.0.0.1', host = '127.0.0.1:8787', json, form, headers, ...rest } = init;
    const all: Record<string, string> = { host, ...(headers as Record<string, string>) };
    let body = rest.body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      all['content-type'] = 'application/json';
    }
    if (form) {
      body = new URLSearchParams(form).toString();
      all['content-type'] = 'application/x-www-form-urlencoded';
    }
    return target.request(
      pathname,
      { ...rest, body, headers: all },
      { incoming: { socket: { remoteAddress: from, remotePort: 50000, remoteFamily: from.includes(':') ? 'IPv6' : 'IPv4' } } },
    ) as Promise<Response>;
  };
  const request = (pathname: string, init: Init = {}) => send(app, pathname, init);
  const lan = (pathname: string, init: Init = {}) => send(claimApp, pathname, { from: '192.168.1.40', host: '192.168.1.5:8788', ...init });
  const issue = async (overrides: Partial<IssueRequestBody> = {}) => {
    const response = await request('/api/rewards/issue', { method: 'POST', json: issueBody(overrides) });
    expect(response.status).toBe(200);
    return (await response.json()) as IssueResponseBody;
  };
  return { config, clock, logs, storage, rewards, app, claimApp, request, lan, issue };
}

const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
const LAN = { from: '192.168.1.20', host: '192.168.1.5:8787' };
const JSON_ACCEPT = { accept: 'application/json' };
const SAME_ORIGIN = { origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' };

/* ------------------------------------------------------------------- API */

describe('GET /api/rewards/status', () => {
  it('reports the claim base and whether this caller may issue codes', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const local = (await (await b.request('/api/rewards/status')).json()) as RewardsStatusBody;
    expect(local).toEqual({ enabled: true, canIssue: true, claimBase: 'http://192.168.1.5:8788', reach: 'lan', ttlHours: 24 });
    const lan = (await (await b.request('/api/rewards/status', LAN)).json()) as RewardsStatusBody;
    expect(lan.canIssue).toBe(false);
    const admin = (await (await b.request('/api/rewards/status', { ...LAN, headers: { authorization: `Bearer ${ADMIN}` } })).json()) as RewardsStatusBody;
    expect(admin.canIssue).toBe(true);
    const off = (await (await build({ PLUSH_REWARDS: 'off' }).request('/api/rewards/status')).json()) as RewardsStatusBody;
    expect(off).toMatchObject({ enabled: false, canIssue: true });
  });
});

describe('POST /api/rewards/issue', () => {
  it('issues one code per session + round to the kiosk on this machine', async () => {
    const b = build();
    const first = await b.issue();
    expect(first).toMatchObject({ url: `http://192.168.1.5:8788/c/${first.code}`, reach: 'lan', options: 'both', repeated: false });
    const again = await b.issue();
    expect(again).toMatchObject({ code: first.code, repeated: true });
    const next = await b.issue({ roundId: 5 });
    expect(next.code).not.toBe(first.code);
  });

  it('refuses LAN callers, forwarded phones and foreign pages; the admin token works from anywhere', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const lan = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), ...LAN });
    expect(lan.status).toBe(403);
    expect(await errorCode(lan)).toBe('forbidden');
    // The Vite dev proxy forwarding a phone: loopback socket, but the phone's address in X-Forwarded-For.
    const forwarded = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), headers: { 'x-forwarded-for': '192.168.1.20' } });
    expect(forwarded.status).toBe(403);
    const foreign = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    const rebinding = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), host: 'evil.example:8787' });
    expect(rebinding.status).toBe(403);
    const wrong = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), ...LAN, headers: { authorization: 'Bearer nope-nope-nope-nope' } });
    expect(wrong.status).toBe(403);
    expect(b.rewards.counts().issued).toBe(0);
    const admin = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody(), ...LAN, headers: { authorization: `Bearer ${ADMIN}` } });
    expect(admin.status).toBe(200);
    // Without PLUSH_ADMIN_TOKEN nobody off this machine can issue (no token = no bypass).
    const open = build();
    expect((await open.request('/api/rewards/issue', { method: 'POST', json: issueBody(), ...LAN })).status).toBe(403);
  });

  it('validates the body strictly and stores nothing for a bad request', async () => {
    const b = build();
    const bodies: unknown[] = [
      { ...issueBody(), extra: 1 },
      issueBody({ tier: 'mythic' as never }),
      issueBody({ claimUrl: 'javascript:alert(1)' }),
      issueBody({ swagUrl: 'ftp://x.example/' }),
      issueBody({ prizeName: 'x'.repeat(61) }),
      issueBody({ discountText: 'x'.repeat(81) }),
    ];
    for (const json of bodies) {
      const response = await b.request('/api/rewards/issue', { method: 'POST', json });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('bad_request');
    }
    const notJson = await b.request('/api/rewards/issue', { method: 'POST', body: 'session=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(await errorCode(notJson)).toBe('bad_request');
    const huge = await b.request('/api/rewards/issue', { method: 'POST', json: { ...issueBody(), pad: 'x'.repeat(5000) } });
    expect(huge.status).toBe(413);
    expect(await errorCode(huge)).toBe('bad_request');
    expect(b.storage.writes).toBe(0);
  });

  it('limits issuing to about 10 per minute and caller', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    for (let round = 1; round <= 10; round++) await b.issue({ roundId: round });
    const blocked = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ roundId: 11 }) });
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // Another caller has its own bucket; time refills it.
    const other = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ roundId: 12 }), ...LAN, headers: { authorization: `Bearer ${ADMIN}` } });
    expect(other.status).toBe(200);
    b.clock.now += 6_000;
    expect((await b.request('/api/rewards/issue', { method: 'POST', json: issueBody({ roundId: 13 }) })).status).toBe(200);
  });

  it('answers storage when the code can not be written, rewards_off when switched off', async () => {
    const b = build();
    b.storage.failWrites = true;
    const failed = await b.request('/api/rewards/issue', { method: 'POST', json: issueBody() });
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe('storage');
    expect(b.rewards.counts().issued).toBe(0);
    const off = await build({ PLUSH_REWARDS: 'off' }).request('/api/rewards/issue', { method: 'POST', json: issueBody() });
    expect(off.status).toBe(503);
    expect(await errorCode(off)).toBe('rewards_off');
    const unknown = await b.request('/api/rewards/nope');
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe('not_found');
  });
});

/* ------------------------------------------------------------ claim pages */

describe('claim page', () => {
  it('shows the logo, the plush, its rarity and one button per option', async () => {
    const b = build();
    const { code } = await b.issue();
    const response = await b.request(`/c/${code}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('src="../claim-assets/logo"');
    expect(html).toContain('alt="GTC"');
    expect(html).toContain('You caught Neon Byte!');
    expect(html).toContain('Legendary');
    expect(html).toContain('Collect your plush at the booth');
    expect(html).toContain('Get your swag discount');
    expect(html).toContain('20% off all swag');
    expect(html).toContain(formatCode(code));
    expect(html).toContain(`action="${code}/choose"`);
    expect(html).toContain('Valid for 24 more hours');
    // Typed variants of the code (lower case, dash, O for 0) open the same page.
    const typed = formatCode(code).toLowerCase().replace(/0/g, 'o');
    expect((await b.request(`/c/${typed}`)).status).toBe(200);

    const prizeOnly = await b.issue({ roundId: 9, options: 'prize' });
    const single = await (await b.request(`/c/${prizeOnly.code}`)).text();
    expect(single).toContain('Collect your plush at the booth');
    expect(single).not.toContain('Get your swag discount');
  });

  it('sends a strict CSP and the other security headers, with no script and no external request', async () => {
    const b = build();
    const { code } = await b.issue({ swagUrl: 'https://shop.example/swag' });
    const response = await b.request(`/c/${code}`);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|script-src/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).not.toMatch(/<script|\sstyle=|\son[a-z]+=/i);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    // The LAN listener sends the same headers.
    const lan = await b.lan(`/c/${code}`);
    expect(lan.headers.get('content-security-policy')).toBe(csp);
    expect(lan.headers.get('x-content-type-options')).toBe('nosniff');
    expect(lan.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('escapes prize names and discount text from the kiosk', async () => {
    const b = build();
    const { code } = await b.issue({
      prizeName: '<script>alert(1)</script>',
      discountText: '"><img src=x onerror=alert(2)>',
      swagUrl: 'https://shop.example/?q="><script>',
    });
    const html = await (await b.request(`/c/${code}`)).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
    await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    const discount = await (await b.request(`/c/${code}`)).text();
    expect(discount).not.toContain('<script>');
    expect(discount).toContain('href="https://shop.example/?q=&quot;&gt;&lt;script&gt;"');
    const staff = await (await b.request('/staff/rewards')).text();
    expect(staff).not.toContain('<script>alert');
    expect(staff).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('records the choice once with POST-redirect-GET and then shows the ticket', async () => {
    const b = build();
    const { code } = await b.issue();
    // Browsers send Origin: null on form posts from a no-referrer page; the public form does not mind.
    const chosen = await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'prize' }, headers: { origin: 'null' } });
    expect(chosen.status).toBe(303);
    expect(chosen.headers.get('location')).toBe(`../${code}`);
    const ticket = await (await b.request(`/c/${code}`)).text();
    expect(ticket).toContain('Show this screen to booth staff');
    expect(ticket).toContain(formatCode(code));
    expect(ticket).toContain('Ready to collect');
    expect(ticket).not.toContain('<form');
    // Same choice again: harmless (a double tap). A different one: refused.
    expect((await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'prize' } })).status).toBe(303);
    const other = await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    expect(other.status).toBe(409);
    const otherHtml = await other.text();
    expect(otherHtml).toContain('Your choice is already saved');
    // Pages answered from /c/CODE/choose reach their assets and the claim page one level further up.
    expect(otherHtml).toContain('href="../../claim-assets/claim.css"');
    expect(otherHtml).toContain(`href="../${code}"`);
    const json = await b.request(`/c/${code}/choose`, { method: 'POST', json: { choice: 'swag' }, headers: JSON_ACCEPT });
    expect(json.status).toBe(409);
    expect(await errorCode(json)).toBe('already_chosen');
    expect(b.rewards.find(code)?.choice).toBe('prize');
    const bad = await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'both' } });
    expect(bad.status).toBe(400);
  });

  it('shows the discount: the kiosk wording, the store button or the counter hint', async () => {
    const b = build();
    const store = await b.issue({ swagUrl: 'https://shop.example/swag' });
    await b.request(`/c/${store.code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    const withStore = await (await b.request(`/c/${store.code}`)).text();
    expect(withStore).toContain('<h1>20% off all swag</h1>');
    expect(withStore).toContain('href="https://shop.example/swag"');
    expect(withStore).toContain('Open the swag store');
    expect(withStore).toContain('rel="noopener noreferrer"');
    const counter = await b.issue({ roundId: 6, discountText: '', swagUrl: '' });
    await b.request(`/c/${counter.code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    const plain = await (await b.request(`/c/${counter.code}`)).text();
    expect(plain).toContain('Your swag discount');
    expect(plain).toContain('Show this screen at the swag counter.');
    expect(plain).not.toContain('Open the swag store');
  });

  it('speaks the language of the win, with a ?lang= override kept through the form', async () => {
    const b = build();
    const { code } = await b.issue({ lang: 'zh', prizeName: '霓虹比特' });
    const zh = await (await b.request(`/c/${code}`)).text();
    expect(zh).toContain('<html lang="zh">');
    expect(zh).toContain('你抓到了霓虹比特！');
    expect(zh).toContain('到展台领取你的玩偶');
    const ja = await (await b.request(`/c/${code}?lang=ja`)).text();
    expect(ja).toContain('<html lang="ja">');
    expect(ja).toContain('ブースでぬいぐるみを受け取る');
    expect(ja).toContain(`action="${code}/choose?lang=ja"`);
    const chosen = await b.request(`/c/${code}/choose?lang=ja`, { method: 'POST', form: { choice: 'prize' } });
    expect(chosen.headers.get('location')).toBe(`../${code}?lang=ja`);
    expect(await (await b.request(`/c/${code}?lang=ja`)).text()).toContain('この画面をブーススタッフに見せてください');
    expect(await (await b.request(`/c/${code}?lang=xx`)).text()).toContain('请向展台工作人员出示此页面');
    // Unknown codes follow the browser's language.
    expect(await (await b.request('/c/ZZZZZZZZ', { headers: { 'accept-language': 'ja-JP,ja;q=0.9' } })).text()).toContain('コードが見つかりません');
  });

  it('has friendly pages for unknown, expired and collected codes', async () => {
    const b = build();
    for (const bad of ['ZZZZZZZZ', 'short', '%3Cscript%3E', 'ABCDEFGHJ']) {
      const response = await b.request(`/c/${bad}`);
      expect(response.status, bad).toBe(404);
      const html = await response.text();
      expect(html).toContain('Code not found');
      expect(html).not.toContain('<script>');
    }
    const { code } = await b.issue();
    await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'prize' } });
    await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: SAME_ORIGIN });
    const done = await b.request(`/c/${code}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Already collected');

    const late = await b.issue({ roundId: 20 });
    b.clock.now += 24 * 3_600_000;
    const expired = await b.request(`/c/${late.code}`);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain('This code has expired');
    const choose = await b.request(`/c/${late.code}/choose`, { method: 'POST', form: { choice: 'prize' } });
    expect(choose.status).toBe(410);
    expect(await b.request(`/c/${late.code}/choose`, { method: 'POST', json: { choice: 'prize' }, headers: JSON_ACCEPT }).then(errorCode)).toBe('expired');
  });

  it('links assets relative to the page, so a path prefix in front of the server keeps working', () => {
    expect(rootOf('/c/ABCDEFGH')).toBe('../');
    expect(rootOf('/c/ABCDEFGH/choose')).toBe('../../');
    expect(rootOf('/staff/rewards')).toBe('../');
    expect(rootOf('/staff/rewards/ABCDEFGH/redeem')).toBe('../../../');
    expect(preferredLang('fr-FR,ja;q=0.8,en;q=0.5')).toBe('ja');
    expect(preferredLang('zh-Hant-TW')).toBe('zh');
    expect(preferredLang(undefined)).toBe('en');
  });

  it('rate-limits claim pages per IP', async () => {
    const b = build();
    const { code } = await b.issue();
    for (let i = 0; i < 40; i++) expect((await b.lan(`/c/${code}`)).status).toBe(200);
    const blocked = await b.lan(`/c/${code}`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect(await blocked.text()).toContain('Slow down a little');
    expect((await b.lan(`/c/${code}`, { from: '192.168.1.41' })).status).toBe(200);
  });

  it('serves the stylesheet and the kit logo as supplied; the neutral kit shows no GTC marks', async () => {
    const b = build();
    const css = await b.request('/claim-assets/claim.css');
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const sheet = await css.text();
    expect(sheet).toContain('--green:#76B900');
    expect(sheet).not.toContain('@font-face'); // no brand font files in the repo
    const logo = await b.request('/claim-assets/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/svg+xml');
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await logo.text()).toContain('Original placeholder wordmark');
    expect((await b.request('/claim-assets/host-logo')).status).toBe(404); // no official NVIDIA file: not drawn
    expect((await b.request('/claim-assets/font/400')).status).toBe(404);

    const neutral = build({ PLUSH_BRAND: 'neutral' });
    const { code } = await neutral.issue();
    const html = await (await neutral.request(`/c/${code}`)).text();
    expect(html).not.toMatch(/GTC|NVIDIA/);
    expect(html).toContain('GPU Party');
    expect(await (await neutral.request('/claim-assets/logo')).text()).toContain('GPU Party theme emblem');
  });

  it('prefers the official logo and brand font files once the owner drops them in', async () => {
    const root = tempDir();
    const brandDir = path.join(root, 'assets/brand/gtc');
    mkdirSync(path.join(brandDir, 'fonts'), { recursive: true });
    writeFileSync(path.join(brandDir, 'gtc-logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    writeFileSync(path.join(brandDir, 'nvidia-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(path.join(brandDir, 'fonts/NVIDIASans-Bold.woff2'), Buffer.from('wOF2fake'));
    const assets = createBrandAssets(BRAND_KITS.gtc, [root]);
    expect(assets.logo()).toMatchObject({ official: true, contentType: 'image/png', sitePath: 'assets/brand/gtc/gtc-logo.png' });
    expect(assets.hostLogo()).toMatchObject({ official: true, contentType: 'image/svg+xml' });
    expect(assets.fonts().map((font) => font.weight)).toEqual([700]);
    const b = build({}, { assets });
    const logo = await b.request('/claim-assets/logo');
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const sheet = await (await b.request('/claim-assets/claim.css')).text();
    expect(sheet).toContain('@font-face{font-family:"NVIDIA Sans";src:url("font/700")');
    expect(sheet).toContain('font-family:"NVIDIA Sans", ');
    expect((await b.request('/claim-assets/font/700')).headers.get('content-type')).toBe('font/woff2');
    const { code } = await b.issue();
    expect(await (await b.request(`/c/${code}`)).text()).toContain('src="../claim-assets/host-logo" alt="NVIDIA"');
  });
});

/* ------------------------------------------------------------- staff page */

describe('staff page', () => {
  it('opens on the booth machine and with the admin token, not from the LAN', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    await b.issue();
    const local = await b.request('/staff/rewards');
    expect(local.status).toBe(200);
    expect(local.headers.get('referrer-policy')).toBe('same-origin');
    expect(local.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await local.text();
    expect(html).toContain('Prize desk');
    expect(html).toMatch(/<span class="stat-n">1<\/span><span class="stat-l">Issued/);
    const lan = await b.request('/staff/rewards', LAN);
    expect(lan.status).toBe(403);
    expect(await lan.text()).toContain('Staff only');
    expect((await b.request('/staff/rewards', { ...LAN, headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
    expect((await b.request('/staff/rewards.csv', LAN)).status).toBe(403);
    // The staff page is not part of the claim listener at all.
    expect((await b.lan('/staff/rewards')).status).toBe(404);
  });

  it('turns a one-time ?token= into an HttpOnly SameSite=Strict cookie', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const wrong = await b.request('/staff/rewards?token=guess-guess-guess', LAN);
    expect(wrong.status).toBe(403);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    const signIn = await b.request(`/staff/rewards?token=${ADMIN}`, LAN);
    expect(signIn.status).toBe(303);
    expect(signIn.headers.get('location')).toBe('/staff/rewards?signed=1');
    const cookie = signIn.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^plush_staff=[A-Za-z0-9_-]{40,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/staff');
    expect(cookie).not.toContain(ADMIN);
    const session = cookie.split(';')[0]!;
    expect((await b.request('/staff/rewards?signed=1', { ...LAN, headers: { cookie: session } })).status).toBe(200);
    // Without the cookie (cross-site redirect chain): a link that finishes the sign-in.
    const pending = await b.request('/staff/rewards?signed=1', LAN);
    expect(await pending.text()).toContain('Open the prize desk');
    expect((await b.request('/staff/rewards', { ...LAN, headers: { cookie: 'plush_staff=forged' } })).status).toBe(403);
    b.clock.now += 12 * 3_600_000 + 1;
    expect((await b.request('/staff/rewards', { ...LAN, headers: { cookie: session } })).status).toBe(403);
    expect(b.logs.join('\n')).not.toContain(ADMIN);
  });

  it('redeems a chosen code once, only from a page of this origin', async () => {
    const b = build({ PLUSH_ADMIN_TOKEN: ADMIN });
    const { code } = await b.issue();
    const notChosen = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: SAME_ORIGIN });
    expect(notChosen.headers.get('location')).toBe(`/staff/rewards?q=${code}&done=bad_request`);
    await b.request(`/c/${code}/choose`, { method: 'POST', form: { choice: 'prize' } });

    const crossSite = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    const nullOrigin = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: { origin: 'null' } });
    expect(nullOrigin.status).toBe(403);
    const sameSite = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-site' } });
    expect(sameSite.status).toBe(403);
    const fromLan = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', ...LAN, headers: { origin: 'http://192.168.1.5:8787', 'sec-fetch-site': 'same-origin' } });
    expect(fromLan.status).toBe(403);
    expect(b.rewards.find(code)?.redeemedAt).toBeNull();

    const redeemed = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: SAME_ORIGIN });
    expect(redeemed.status).toBe(303);
    expect(redeemed.headers.get('location')).toBe(`/staff/rewards?q=${code}&done=redeemed`);
    const page = await (await b.request(`/staff/rewards?q=${code}&done=redeemed`)).text();
    expect(page).toContain(`${formatCode(code)} marked as redeemed.`);
    expect(page).toContain('state-redeemed');
    const twice = await b.request(`/staff/rewards/${code}/redeem`, { method: 'POST', headers: { ...SAME_ORIGIN, ...JSON_ACCEPT } });
    expect(twice.status).toBe(409);
    expect(await errorCode(twice)).toBe('already_redeemed');
    // A script with the admin token (no browser headers) may redeem too.
    const other = await b.issue({ roundId: 2 });
    await b.request(`/c/${other.code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    const scripted = await b.request(`/staff/rewards/${formatCode(other.code).toLowerCase()}/redeem`, { method: 'POST', ...LAN, headers: { authorization: `Bearer ${ADMIN}`, ...JSON_ACCEPT } });
    expect(scripted.status).toBe(200);
    expect((await b.request('/staff/rewards/ZZZZZZZZ/redeem', { method: 'POST', headers: SAME_ORIGIN })).headers.get('location')).toContain('done=not_found');
  });

  it('counts, searches and lists codes, and redeem buttons appear only for chosen ones', async () => {
    const b = build();
    const a = await b.issue({ roundId: 1 });
    const c = await b.issue({ roundId: 2 });
    const d = await b.issue({ roundId: 3 });
    await b.request(`/c/${c.code}/choose`, { method: 'POST', form: { choice: 'prize' } });
    await b.request(`/c/${d.code}/choose`, { method: 'POST', form: { choice: 'swag' } });
    await b.request(`/staff/rewards/${d.code}/redeem`, { method: 'POST', headers: SAME_ORIGIN });
    const html = await (await b.request('/staff/rewards')).text();
    for (const [label, n] of [
      ['Issued', 3],
      ['Chosen', 2],
      ['Redeemed', 1],
      ['Expired', 0],
    ] as const) {
      expect(html).toContain(`<span class="stat-n">${n}</span><span class="stat-l">${label}`);
    }
    expect(html.match(/Mark redeemed/g)).toHaveLength(1);
    expect(html).toContain(`action="/staff/rewards/${c.code}/redeem"`);
    const search = await (await b.request(`/staff/rewards?q=${encodeURIComponent(formatCode(a.code).slice(0, 6).toLowerCase())}`)).text();
    expect(search).toContain(formatCode(a.code));
    expect(search).not.toContain(formatCode(c.code));
    expect(await (await b.request('/staff/rewards?q=%3Cb%3E')).text()).not.toContain('<b>');
    const zh = await (await b.request('/staff/rewards?lang=zh')).text();
    expect(zh).toContain('奖品台');
  });

  it('exports a CSV with formulas defused', async () => {
    const b = build();
    const { code } = await b.issue({ prizeName: '=HYPERLINK("https://evil.example","x")' });
    const csv = await b.request('/staff/rewards.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="rewards-2026-11-24.csv"');
    const text = await csv.text();
    const lines = text.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lines[0]).toBe('code,status,choice,prizeName,tier,prizeId,themeId,lang,options,issuedAt,expiresAt,chosenAt,redeemedAt');
    expect(lines[1]).toContain(`"${formatCode(code)}","open",""`);
    expect(lines[1]).toContain('"\'=HYPERLINK(""https://evil.example"",""x"")"');
    expect(text).not.toContain('k3x9q2ab"'); // the session id is not exported
  });
});

/* -------------------------------------------------------- LAN listener */

describe('LAN claim listener', () => {
  it('serves claim pages and their assets only', async () => {
    const b = build();
    const { code } = await b.issue();
    expect((await b.lan(`/c/${code}`)).status).toBe(200);
    expect((await b.lan(`/c/${code}/choose`, { method: 'POST', form: { choice: 'swag' } })).status).toBe(303);
    expect((await b.lan('/claim-assets/claim.css')).status).toBe(200);
    expect((await b.lan('/claim-assets/logo')).status).toBe(200);
    for (const pathname of ['/', '/index.html', '/api/health', '/api/rewards/status', '/api/ai/status', '/staff/rewards', '/staff/rewards.csv', '/assets/index.js', '/c', '/claim-assets/../api/health']) {
      const response = await b.lan(pathname);
      expect(response.status, pathname).toBe(404);
    }
    const issue = await b.lan('/api/rewards/issue', { method: 'POST', json: issueBody({ roundId: 99 }), from: '127.0.0.1', host: '127.0.0.1:8788' });
    expect(issue.status).toBe(404);
    const redeem = await b.lan(`/staff/rewards/${code}/redeem`, { method: 'POST', from: '127.0.0.1', host: '127.0.0.1:8788' });
    expect(redeem.status).toBe(404);
    expect(b.rewards.find(code)?.redeemedAt).toBeNull();
  });

  it('listens on a free port, points the QR links at the LAN address and shares the codes', async () => {
    const b = build();
    const listener = startClaimListener({
      app: b.claimApp,
      port: 0,
      host: '127.0.0.1',
      rewards: b.rewards,
      logger: createLogger('silent'),
      publicUrl: null,
      mainPort: 8787,
      lanAddress: () => '192.168.50.7',
    });
    try {
      const port = await listener.ready;
      expect(port).toBeGreaterThan(0);
      expect(b.rewards.claimTarget()).toEqual({ base: `http://192.168.50.7:${port}`, reach: 'lan' });
      const issued = await b.issue();
      expect(issued.url).toBe(`http://192.168.50.7:${port}/c/${issued.code}`);
      const page = await fetch(`http://127.0.0.1:${port}/c/${issued.code}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('You caught Neon Byte!');
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/staff/rewards`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => listener.close(resolve));
    }
  });

  it('logs and carries on when the port is busy (the QR links keep the fallback)', async () => {
    const blocker: Server = createServer();
    const busyPort = await new Promise<number>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as { port: number }).port)));
    const b = build();
    b.rewards.setClaimTarget({ base: 'http://127.0.0.1:8787', reach: 'loopback' });
    const logs: string[] = [];
    const listener = startClaimListener({
      app: b.claimApp,
      port: busyPort,
      host: '127.0.0.1',
      rewards: b.rewards,
      logger: createLogger('info', [], (line) => logs.push(line)),
      publicUrl: null,
      mainPort: 8787,
    });
    try {
      expect(await listener.ready).toBeNull();
      expect(b.rewards.claimTarget()).toEqual({ base: 'http://127.0.0.1:8787', reach: 'loopback' });
      expect(logs.join('\n')).toMatch(/claim listener could not start.*EADDRINUSE/);
    } finally {
      listener.close();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
