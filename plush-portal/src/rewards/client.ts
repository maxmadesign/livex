/**
 * Browser side of the prize-claim API (src/rewards/protocol.ts): asks the game's own server for the
 * rewards status and for one claim code per won round.
 *
 * Failures never throw: they come back as one of the reasons the win card can explain honestly
 * (RewardUiState.reason). Nothing personal is sent: a random id of this page load, the round, the
 * plush and the owner's offer settings.
 */
import type { RewardUiState } from '../app/gameStore';
import {
  CODE_ALPHABET,
  MAX_ISSUED_URL_CHARS,
  REWARD_LIMITS,
  REWARD_OPTIONS,
  cleanDisplayText,
  isSafeHttpUrl,
  type ClaimReach,
  type IssueRequestBody,
  type IssueResponseBody,
  type RewardErrorBody,
  type RewardsStatusBody,
} from './protocol';

export type RewardFailure = NonNullable<RewardUiState['reason']>;

export type RewardResult<T> = { ok: true; body: T } | { ok: false; reason: RewardFailure };

/** What the game sends for a win; the client adds the session id. */
export type IssueInput = Omit<IssueRequestBody, 'session'>;

export interface RewardClientOptions {
  fetchImpl?: typeof fetch;
  /** '' = same origin (the kiosk page is served by the API server or proxied to it). */
  baseUrl?: string;
  /** Issue timeout (ISSUE_TIMEOUT_MS by default). */
  issueTimeoutMs?: number;
  statusTimeoutMs?: number;
  /** Session id override (tests); by default one random id per page load. */
  session?: string;
}

export interface RewardClient {
  /** Random id of this page load, sent with every issue request (the server's dedup key). */
  readonly session: string;
  status(): Promise<RewardResult<RewardsStatusBody>>;
  /**
   * Requests the code for `input.roundId`. At most one request per round: a second call for the
   * same round returns the first call's promise (also when it failed), so a retry can never mint a
   * second code for one win.
   */
  issue(input: IssueInput): Promise<RewardResult<IssueResponseBody>>;
}

/**
 * The issue request may take this long. The code is usually issued in milliseconds, but the timer
 * also runs while the kiosk's main thread is busy rendering (software GL, a weak GPU): with 4 s a
 * code the server had stored was reported as unavailable. A late answer for a round that has moved
 * on is ignored by the flow anyway.
 */
export const ISSUE_TIMEOUT_MS = 8000;
const STATUS_TIMEOUT_MS = 6000;
const REACHES: readonly ClaimReach[] = ['external', 'lan', 'loopback'];

/** 20 random Crockford characters (100 bits): unguessable, short, and inside maxSessionChars. */
export function randomSessionId(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += CODE_ALPHABET[bytes[i]! & 31];
  return out;
}

/** Cryptographically random bytes where the platform has them. */
export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

let pageSession: string | null = null;
/** The session id of this page load (created on first use, never stored). */
export function pageSessionId(): string {
  if (!pageSession) pageSession = randomSessionId();
  return pageSession;
}

/** Maps an HTTP answer that is not a success to the reason shown on the card. */
export function failureFromResponse(status: number, body: unknown): RewardFailure {
  const code = (body as Partial<RewardErrorBody> | null)?.error?.code;
  switch (code) {
    case 'rewards_off':
      return 'rewards_off';
    case 'forbidden':
      return 'forbidden';
    case 'rate_limited':
      return 'rate_limited';
    case 'storage':
      return 'storage';
    default:
      break;
  }
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  // No answer from the API itself: a server without the rewards routes (404 with no error body),
  // or a proxy that could not reach it. Either way no code can be issued here.
  if (!code && (status === 404 || status === 502 || status === 503 || status === 504)) return 'offline';
  return 'error';
}

/** True when `body` is a usable issue answer (a code the QR may show), false for anything else. */
export function validIssueResponse(body: unknown): body is IssueResponseBody {
  const b = body as Partial<IssueResponseBody> | null;
  if (!b || typeof b !== 'object') return false;
  if (typeof b.code !== 'string' || b.code.length !== REWARD_LIMITS.codeLength) return false;
  for (const ch of b.code) if (!CODE_ALPHABET.includes(ch)) return false;
  // A filled-in owner template may be longer than the template itself (the settings allow 300).
  if (typeof b.url !== 'string' || !isSafeHttpUrl(b.url, MAX_ISSUED_URL_CHARS)) return false;
  if (!REACHES.includes(b.reach as ClaimReach)) return false;
  if (!(REWARD_OPTIONS as readonly string[]).includes(b.options as string)) return false;
  return typeof b.expiresAt === 'string';
}

function validStatus(body: unknown): body is RewardsStatusBody {
  const b = body as Partial<RewardsStatusBody> | null;
  return !!b && typeof b === 'object' && typeof b.enabled === 'boolean' && typeof b.canIssue === 'boolean' && typeof b.claimBase === 'string' && REACHES.includes(b.reach as ClaimReach);
}

export function createRewardClient(options: RewardClientOptions = {}): RewardClient {
  const session = (options.session ?? pageSessionId()).slice(0, REWARD_LIMITS.maxSessionChars);
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const issued = new Map<number, Promise<RewardResult<IssueResponseBody>>>();

  async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number, valid: (b: unknown) => b is T): Promise<RewardResult<T>> {
    const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return { ok: false, reason: 'offline' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        // The timeout fired while the body was still arriving: the server was too slow, not wrong.
        if (controller.signal.aborted) return { ok: false, reason: 'offline' };
        data = null;
      }
      if (!response.ok) return { ok: false, reason: failureFromResponse(response.status, data) };
      return valid(data) ? { ok: true, body: data } : { ok: false, reason: 'error' };
    } catch {
      // Network failure or the timeout fired: the server could not be reached in time.
      return { ok: false, reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    session,
    status: () => call('GET', '/api/rewards/status', undefined, options.statusTimeoutMs ?? STATUS_TIMEOUT_MS, validStatus),
    issue(input) {
      const pending = issued.get(input.roundId);
      if (pending) return pending;
      // Text the server would refuse (controls, bidi overrides, an empty name) is cleaned here, so a
      // stray character in a setting can never make every claim fail.
      const body: IssueRequestBody = {
        ...input,
        session,
        prizeName: cleanDisplayText(input.prizeName, REWARD_LIMITS.maxPrizeNameChars) || input.prizeId,
        discountText: cleanDisplayText(input.discountText, REWARD_LIMITS.maxDiscountTextChars),
        claimUrl: input.claimUrl.trim(),
        swagUrl: input.swagUrl.trim(),
      };
      const request = call('POST', '/api/rewards/issue', body, options.issueTimeoutMs ?? ISSUE_TIMEOUT_MS, validIssueResponse);
      issued.set(input.roundId, request);
      return request;
    },
  };
}
