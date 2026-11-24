/**
 * HTTP routes of the prize-claim flow, in three groups:
 *
 *   createRewardApiRoutes  /api/rewards/status, /api/rewards/issue      kiosk only (loopback or admin token)
 *   createClaimRoutes      /c/:code, /c/:code/choose, /claim-assets/*  public (also the LAN claim listener)
 *   createStaffRoutes      /staff/rewards, .csv, /:code/redeem         booth staff (loopback, admin token or staff cookie)
 *
 * Pages carry a strict CSP (no script at all, styles / images / fonts from this origin only),
 * nosniff, no-store and a referrer policy; nothing on them loads anything from elsewhere.
 * Codes are only ever logged at debug level.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { LANGS, type Lang } from '../../src/core/types';
import { REWARD_LIMITS, formatCode, normalizeCode, type RewardErrorCode } from '../../src/rewards/protocol';
import type { Logger } from '../log';
import { createRateLimiter, type RateLimiter } from '../rateLimit';
import type { BrandAssets, BrandFile } from './assets';
import { t, type TextKey } from './i18n';
import { renderClaim, renderCsv, renderCss, renderMessage, renderStaff, renderStaffMessage, type PageContext } from './pages';
import { RewardFailure, type RewardsService } from './service';
import { ChoiceSchema, parseIssueRequest } from './validate';

export interface RewardRouteDeps {
  rewards: RewardsService;
  assets: BrandAssets;
  logger: Logger;
  now: () => number;
  /** Rate-limit key of the caller: the socket address, or X-Forwarded-For behind a trusted proxy. */
  clientKey(c: Context): string;
}

export interface RewardAuthDeps {
  /** A request made on this machine (the rule the /api/ai/key routes use). */
  isLocal(c: Context): boolean;
  /** `Authorization: Bearer <PLUSH_ADMIN_TOKEN>` (false when no token is configured). */
  hasAdminToken(c: Context): boolean;
  /** Compares a token given some other way (?token=) with PLUSH_ADMIN_TOKEN. */
  isAdminToken(value: string): boolean;
}

/** Requests per minute and client. Issuing: a kiosk wins far less than once every 6 s. */
export const REWARD_RATES = { issue: 10, claimPages: 40, claimAssets: 240, staff: 120 } as const;

/** Socket address, or the first X-Forwarded-For entry when the server sits behind a trusted proxy. */
export function makeClientKey(trustProxy: boolean): (c: Context) => string {
  return (c) => {
    if (trustProxy) {
      const forwarded = c.req.header('x-forwarded-for');
      if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64) || 'unknown';
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown'; // no socket (in-process tests)
    }
  };
}

/* ---------------------------------------------------------- headers */

const PAGE_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'";

/**
 * Claim pages say no-referrer (they link out to the swag store). Staff pages say same-origin:
 * with no-referrer a browser sends `Origin: null` on the staff's own form posts, which would make
 * the same-origin check and the loopback rule refuse the booth machine itself. Neither ever sends
 * a Referer to another site.
 */
function pageHeaders(c: Context, referrer: 'no-referrer' | 'same-origin' = 'no-referrer'): void {
  c.header('content-security-policy', PAGE_CSP);
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', referrer);
  c.header('x-frame-options', 'DENY');
  c.header('cache-control', 'no-store');
  // No Cross-Origin-Opener-Policy: browsers ignore it (with a console error) on plain-http LAN
  // origins, and a page without script has no window handle worth isolating.
  c.header('cross-origin-resource-policy', 'same-origin');
  c.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

const wantsJson = (c: Context) => (c.req.header('accept') ?? '').includes('application/json');

function failJson(c: Context, failure: RewardFailure): Response {
  for (const [name, value] of Object.entries(failure.headers)) c.header(name, value);
  c.header('cache-control', 'no-store');
  return c.json(failure.body(), failure.status as 400);
}

const jsonError = (status: number, code: RewardErrorCode, message: string, headers: Record<string, string> = {}) =>
  new RewardFailure(status, code, message, headers);

/* --------------------------------------------------------- language */

function isLang(value: string | undefined): value is Lang {
  return value !== undefined && (LANGS as readonly string[]).includes(value);
}

/** First of zh / ja / en named in Accept-Language, else en (for pages without a record). */
export function preferredLang(header: string | undefined): Lang {
  for (const part of (header ?? '').split(',')) {
    const base = part.split(';')[0]!.trim().toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

/** ?lang= wins, then the record's language, then the browser's. */
function pageLang(c: Context, recordLang?: Lang): { lang: Lang; langQuery: string } {
  const query = c.req.query('lang');
  if (isLang(query)) return { lang: query, langQuery: `?lang=${query}` };
  return { lang: recordLang ?? preferredLang(c.req.header('accept-language')), langQuery: '' };
}

/**
 * Relative path from a page's URL to the site root ('../' for /c/CODE, '../../' for /c/CODE/choose),
 * so the pages and their assets also work behind a reverse proxy that adds a path prefix.
 */
export function rootOf(pathname: string): string {
  const depth = pathname.split('/').filter(Boolean).length - 1;
  return '../'.repeat(Math.max(0, depth));
}

/* ---------------------------------------------------------- assets */

const MAX_ASSET_BYTES = 8 * 1024 * 1024;

function sendFile(c: Context, file: BrandFile | null | undefined): Response {
  if (!file || file.size > MAX_ASSET_BYTES) return c.text('Not found', 404);
  let data: Buffer;
  try {
    data = readFileSync(file.file);
  } catch {
    return c.text('Not found', 404);
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'content-type': file.contentType,
      'content-length': String(data.byteLength),
      // Short: artwork the owner drops in shows up within minutes, without a cache-busting URL.
      'cache-control': 'public, max-age=300',
      'content-security-policy': ASSET_CSP,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    },
  });
}

function limited(limiter: RateLimiter, key: string): { ok: true } | { ok: false; retryAfter: string } {
  const result = limiter.take(key);
  return result.ok ? { ok: true } : { ok: false, retryAfter: String(result.retryAfterSec) };
}

/* ------------------------------------------------------------- API */

export function createRewardApiRoutes(deps: RewardRouteDeps & RewardAuthDeps): Hono {
  const { rewards, logger } = deps;
  const limiter = createRateLimiter(REWARD_RATES.issue, deps.now);
  const canIssue = (c: Context) => deps.isLocal(c) || deps.hasAdminToken(c);
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof RewardFailure) return failJson(c, error);
    logger.error('rewards route failed', { name: (error as Error)?.name ?? 'unknown' });
    return failJson(c, jsonError(500, 'internal', 'Internal server error.'));
  });

  app.get('/api/rewards/status', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(rewards.status(canIssue(c)));
  });

  app.post(
    '/api/rewards/issue',
    bodyLimit({
      maxSize: REWARD_LIMITS.maxBodyBytes,
      onError: (c) => failJson(c, jsonError(413, 'bad_request', 'Request body is too large.')),
    }),
    async (c) => {
      if (!rewards.enabled) throw jsonError(503, 'rewards_off', 'Prize codes are switched off on this server.');
      const rate = limited(limiter, deps.clientKey(c));
      if (!rate.ok) throw jsonError(429, 'rate_limited', 'Too many codes requested. Please slow down.', { 'retry-after': rate.retryAfter });
      if (!canIssue(c)) throw jsonError(403, 'forbidden', 'Only the kiosk on this machine (or a request with the admin token) can issue prize codes.');
      let raw: unknown;
      try {
        raw = JSON.parse(await c.req.text());
      } catch {
        throw jsonError(400, 'bad_request', 'The request body must be JSON.');
      }
      const parsed = parseIssueRequest(raw);
      if (!parsed.ok) throw jsonError(400, 'bad_request', parsed.message);
      return c.json(rewards.issue(parsed.request));
    },
  );

  app.all('/api/rewards/*', () => {
    throw jsonError(404, 'not_found', 'Unknown rewards route.');
  });

  return app;
}

/* ------------------------------------------------------ claim pages */

export function createClaimRoutes(deps: RewardRouteDeps): Hono {
  const { rewards, assets, logger } = deps;
  const pageLimiter = createRateLimiter(REWARD_RATES.claimPages, deps.now);
  const assetLimiter = createRateLimiter(REWARD_RATES.claimAssets, deps.now);
  const app = new Hono();

  const context = (c: Context, recordLang?: Lang): PageContext => ({
    kit: rewards.brand,
    root: rootOf(c.req.path),
    hasLogo: assets.logo() !== null,
    hasHostLogo: assets.hostLogo() !== null,
    ...pageLang(c, recordLang),
  });
  const message = (c: Context, ctx: PageContext, status: number, title: TextKey, text: TextKey, link?: { href: string; label: string }) => {
    pageHeaders(c);
    return c.html(renderMessage(ctx, title, text, link), status as 200);
  };
  const tooMany = (c: Context, retryAfter: string) => {
    c.header('retry-after', retryAfter);
    if (wantsJson(c)) return failJson(c, jsonError(429, 'rate_limited', 'Too many requests.'));
    return message(c, context(c), 429, 'slow.title', 'slow.text');
  };

  app.onError((error, c) => {
    logger.error('claim page failed', { name: (error as Error)?.name ?? 'unknown' });
    if (wantsJson(c)) return failJson(c, jsonError(500, 'internal', 'Internal server error.'));
    return message(c, context(c), 500, 'error.title', 'error.text');
  });

  app.get('/c/:code', (c) => {
    const rate = limited(pageLimiter, deps.clientKey(c));
    if (!rate.ok) return tooMany(c, rate.retryAfter);
    const code = normalizeCode(c.req.param('code'));
    const record = code ? rewards.find(code) : null;
    if (!record) {
      if (wantsJson(c)) return failJson(c, jsonError(404, 'not_found', 'This code does not exist.'));
      return message(c, context(c), 404, 'unknown.title', 'unknown.text');
    }
    const state = rewards.stateOf(record);
    if (wantsJson(c)) {
      c.header('cache-control', 'no-store');
      return c.json({ code: record.code, state, choice: record.choice, options: record.options, expiresAt: record.expiresAt });
    }
    pageHeaders(c);
    const ctx = context(c, record.lang);
    return c.html(renderClaim(ctx, record, state, rewards.now(), rewards.ttlHours), state === 'expired' ? 410 : 200);
  });

  app.post(
    '/c/:code/choose',
    bodyLimit({ maxSize: 1024, onError: (c) => failJson(c, jsonError(413, 'bad_request', 'Request body is too large.')) }),
    async (c) => {
      const rate = limited(pageLimiter, deps.clientKey(c));
      if (!rate.ok) return tooMany(c, rate.retryAfter);
      const code = normalizeCode(c.req.param('code'));
      const record = code ? rewards.find(code) : null;
      if (!code || !record) {
        if (wantsJson(c)) return failJson(c, jsonError(404, 'not_found', 'This code does not exist.'));
        return message(c, context(c), 404, 'unknown.title', 'unknown.text');
      }
      const ctx = context(c, record.lang);
      const text = await c.req.text();
      let rawChoice: unknown = null;
      if ((c.req.header('content-type') ?? '').includes('application/json')) {
        try {
          rawChoice = (JSON.parse(text) as { choice?: unknown })?.choice;
        } catch {
          rawChoice = null;
        }
      } else {
        rawChoice = new URLSearchParams(text).get('choice');
      }
      const choice = ChoiceSchema.safeParse(rawChoice);
      const back = { href: `../${record.code}${ctx.langQuery}`, label: t(ctx.lang, 'chosen.show') };
      if (!choice.success) {
        if (wantsJson(c)) return failJson(c, jsonError(400, 'bad_request', 'choice must be "prize" or "swag".'));
        return message(c, ctx, 400, 'badChoice.title', 'badChoice.text', back);
      }
      try {
        const result = rewards.choose(record.code, choice.data);
        if (wantsJson(c)) return c.json({ ok: true, code: record.code, choice: result.record.choice, changed: result.changed });
        // POST-redirect-GET: a reload of the result page never re-posts the form.
        c.header('cache-control', 'no-store');
        return c.redirect(`../${record.code}${ctx.langQuery}`, 303);
      } catch (error) {
        if (!(error instanceof RewardFailure)) throw error;
        if (wantsJson(c)) return failJson(c, error);
        if (error.code === 'already_chosen') return message(c, ctx, 409, 'chosen.title', 'chosen.text', back);
        if (error.code === 'bad_request') return message(c, ctx, 400, 'badChoice.title', 'badChoice.text', back);
        if (error.code === 'storage') return message(c, ctx, 500, 'error.title', 'error.text', back);
        // Redeemed / expired: the claim page itself explains it.
        pageHeaders(c);
        const fresh = rewards.find(record.code) ?? record;
        return c.html(renderClaim(ctx, fresh, rewards.stateOf(fresh), rewards.now(), rewards.ttlHours), error.status as 409);
      }
    },
  );

  const asset = (handler: (c: Context) => Response) => (c: Context) => {
    const rate = limited(assetLimiter, deps.clientKey(c));
    if (!rate.ok) {
      c.header('retry-after', rate.retryAfter);
      return c.text('Too many requests', 429);
    }
    return handler(c);
  };

  app.get(
    '/claim-assets/claim.css',
    asset((c) => {
      const css = renderCss({ kit: rewards.brand, fontWeights: assets.fonts().map((font) => font.weight) });
      return c.body(css, 200, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      });
    }),
  );
  app.get('/claim-assets/logo', asset((c) => sendFile(c, assets.logo())));
  app.get('/claim-assets/host-logo', asset((c) => sendFile(c, assets.hostLogo())));
  app.get(
    '/claim-assets/font/:weight',
    asset((c) => sendFile(c, assets.fonts().find((font) => String(font.weight) === c.req.param('weight'))?.file)),
  );

  return app;
}

/* -------------------------------------------------------- staff page */

const STAFF_COOKIE = 'plush_staff';
const STAFF_SESSION_MS = 12 * 3_600_000;
const MAX_STAFF_SESSIONS = 200;

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Form posts must come from a page of this origin. Sec-Fetch-Site (set by the browser, not
 * scriptable) decides when present; otherwise Origin must name this host. A request with neither
 * is not a browser (curl, scripts), so it can not be a cross-site forgery.
 */
export function isSameOriginPost(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = c.req.header('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    return new URL(origin).host === c.req.header('host');
  } catch {
    return false;
  }
}

const STAFF_NOTICES = new Set(['redeemed', 'already_redeemed', 'expired', 'not_found', 'bad_request', 'storage', 'forbidden']);

export function createStaffRoutes(deps: RewardRouteDeps & RewardAuthDeps): Hono {
  const { rewards, assets, logger } = deps;
  const limiter = createRateLimiter(REWARD_RATES.staff, deps.now);
  const sessions = new Map<string, number>();
  const app = new Hono();

  const context = (c: Context): PageContext => ({
    kit: rewards.brand,
    root: rootOf(c.req.path),
    hasLogo: assets.logo() !== null,
    hasHostLogo: assets.hostLogo() !== null,
    ...pageLang(c, 'en'),
  });
  const hasSession = (c: Context): boolean => {
    const id = getCookie(c, STAFF_COOKIE);
    if (!id) return false;
    const until = sessions.get(id);
    if (until === undefined) return false;
    if (until <= deps.now()) {
      sessions.delete(id);
      return false;
    }
    return true;
  };
  const authorized = (c: Context) => deps.hasAdminToken(c) || hasSession(c) || deps.isLocal(c);
  const startSession = (c: Context): void => {
    const t0 = deps.now();
    for (const [id, until] of sessions) if (until <= t0) sessions.delete(id);
    while (sessions.size >= MAX_STAFF_SESSIONS) sessions.delete(sessions.keys().next().value!);
    const id = randomBytes(32).toString('base64url');
    sessions.set(id, t0 + STAFF_SESSION_MS);
    setCookie(c, STAFF_COOKIE, id, {
      path: '/staff',
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      maxAge: STAFF_SESSION_MS / 1000,
    });
  };
  const staffMessage = (c: Context, status: number, title: TextKey, text: TextKey, link?: { href: string; label: string }) => {
    pageHeaders(c, 'same-origin');
    return c.html(renderStaffMessage(context(c), title, text, link), status as 200);
  };
  const tooMany = (c: Context, retryAfter: string) => {
    c.header('retry-after', retryAfter);
    if (wantsJson(c)) return failJson(c, jsonError(429, 'rate_limited', 'Too many requests.'));
    return staffMessage(c, 429, 'slow.title', 'slow.text');
  };
  const langSuffix = (c: Context, joiner: '?' | '&') => {
    const lang = c.req.query('lang');
    return isLang(lang) && lang !== 'en' ? `${joiner}lang=${lang}` : '';
  };

  app.onError((error, c) => {
    logger.error('staff page failed', { name: (error as Error)?.name ?? 'unknown' });
    if (wantsJson(c)) return failJson(c, jsonError(500, 'internal', 'Internal server error.'));
    return staffMessage(c, 500, 'error.title', 'error.text');
  });

  app.get('/staff/rewards', (c) => {
    const rate = limited(limiter, deps.clientKey(c));
    if (!rate.ok) return tooMany(c, rate.retryAfter);
    // One-time ?token=: becomes an HttpOnly cookie and leaves the address bar (and history) at once.
    const token = c.req.query('token');
    if (token !== undefined) {
      if (!deps.isAdminToken(token)) return staffMessage(c, 403, 'staff.denied.title', 'staff.denied.text');
      startSession(c);
      c.header('cache-control', 'no-store');
      c.header('referrer-policy', 'no-referrer');
      return c.redirect(`/staff/rewards?signed=1${langSuffix(c, '&')}`, 303);
    }
    if (!authorized(c)) {
      // A cookie set during a redirect chain that began on another site is not sent back yet
      // (SameSite=Strict); a click on a link of this origin fixes that.
      if (c.req.query('signed') === '1') {
        const ctx = context(c);
        return staffMessage(c, 200, 'staff.signed.title', 'staff.signed.text', { href: `/staff/rewards${langSuffix(c, '?')}`, label: t(ctx.lang, 'staff.signed.open') });
      }
      return staffMessage(c, 403, 'staff.denied.title', 'staff.denied.text');
    }
    const query = (c.req.query('q') ?? '').slice(0, 20);
    const ctx = context(c);
    const done = c.req.query('done') ?? '';
    const typed = normalizeCode(query);
    const noticeCode = typed ? formatCode(typed) : query.toUpperCase();
    const notice = STAFF_NOTICES.has(done)
      ? { tone: done === 'redeemed' ? ('ok' as const) : ('warn' as const), text: t(ctx.lang, `staff.done.${done}` as TextKey, { code: noticeCode }) }
      : null;
    const records = rewards.list({ query, limit: 50 }).map((record) => ({ record, state: rewards.stateOf(record) }));
    pageHeaders(c, 'same-origin');
    return c.html(renderStaff(ctx, { counts: rewards.counts(), records, query, notice }));
  });

  app.get('/staff/rewards.csv', (c) => {
    const rate = limited(limiter, deps.clientKey(c));
    if (!rate.ok) return tooMany(c, rate.retryAfter);
    if (!authorized(c)) return staffMessage(c, 403, 'staff.denied.title', 'staff.denied.text');
    const rows = rewards.list({ limit: Number.MAX_SAFE_INTEGER }).map((record) => ({ record, state: rewards.stateOf(record) }));
    const day = new Date(rewards.now()).toISOString().slice(0, 10);
    return c.body(renderCsv(rows), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="rewards-${day}.csv"`,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });

  app.post('/staff/rewards/:code/redeem', async (c) => {
    const rate = limited(limiter, deps.clientKey(c));
    if (!rate.ok) return tooMany(c, rate.retryAfter);
    if (!authorized(c) || !isSameOriginPost(c)) {
      if (wantsJson(c)) return failJson(c, jsonError(403, 'forbidden', 'Staff only (loopback, admin token or staff sign-in), from this origin.'));
      return staffMessage(c, 403, 'staff.denied.title', 'staff.denied.text');
    }
    const raw = c.req.param('code');
    const code = normalizeCode(raw);
    let outcome: string;
    try {
      if (!code) throw jsonError(404, 'not_found', 'This code does not exist.');
      const record = rewards.redeem(code);
      if (wantsJson(c)) return c.json({ ok: true, code: record.code, redeemedAt: record.redeemedAt });
      outcome = 'redeemed';
    } catch (error) {
      if (!(error instanceof RewardFailure)) throw error;
      if (wantsJson(c)) return failJson(c, error);
      outcome = error.code;
    }
    const q = encodeURIComponent(code ?? raw.slice(0, 20));
    c.header('cache-control', 'no-store');
    return c.redirect(`/staff/rewards?q=${q}&done=${outcome}${langSuffix(c, '&')}`, 303);
  });

  return app;
}

/* ------------------------------------------------- LAN claim listener */

/**
 * The app of the LAN claim listener: claim pages and their assets only. The game, /api and /staff
 * are not reachable through it (404), so opening this port to the booth network exposes nothing else.
 */
export function createClaimApp(deps: RewardRouteDeps): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    c.header('x-content-type-options', 'nosniff');
    if (!c.res.headers.has('referrer-policy')) c.header('referrer-policy', 'no-referrer');
  });
  app.route('/', createClaimRoutes(deps));
  app.notFound((c) => c.text('Not found', 404));
  app.onError((error, c) => {
    deps.logger.error('claim listener request failed', { name: (error as Error)?.name ?? 'unknown' });
    return c.text('Internal server error', 500);
  });
  return app;
}
