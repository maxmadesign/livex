/**
 * Wire protocol of the prize-claim flow between the game (`src/rewards`) and the API server
 * (`server/rewards`). Pure types and constants: no DOM, no Node, no secrets, no personal data.
 *
 * Flow (docs/REWARDS.md):
 *  1. A real (never a demo) win in a theme with rewards on: the kiosk asks the server for a code
 *     (POST /api/rewards/issue, loopback or admin token only, one code per session + round).
 *  2. The win card shows a QR code for `url`; the visitor scans it with their own phone.
 *  3. The claim page (GET /c/:code, also served on the LAN claim listener) lets the visitor pick
 *     ONE option: collect the plush prize at the booth, or a swag discount. The choice is final.
 *  4. Booth staff mark the code redeemed on the staff page (admin token or loopback).
 * The server stores codes only: no names, e-mail addresses, phone data or camera data.
 */
import type { RarityTier } from '../game/rarity';
import type { Lang, ThemeId } from '../core/types';

/** Crockford base32 (no I, L, O, U): easy to read aloud and to type. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const REWARD_LIMITS = {
  /** Characters in a code (8 × 5 bits = 40 bits). Shown as XXXX-XXXX. */
  codeLength: 8,
  maxPrizeNameChars: 60,
  maxDiscountTextChars: 80,
  maxUrlChars: 300,
  maxSessionChars: 40,
  maxBodyBytes: 4 * 1024,
} as const;

/** Which offers a code can be used for. */
export const REWARD_OPTIONS = ['both', 'prize', 'swag'] as const;
export type RewardOptions = (typeof REWARD_OPTIONS)[number];

/** What the visitor picked on the claim page (final once picked). */
export const REWARD_CHOICES = ['prize', 'swag'] as const;
export type RewardChoice = (typeof REWARD_CHOICES)[number];

/** Who can reach the claim page URL that is put in the QR code. */
export type ClaimReach =
  | 'external' // an owner-configured https URL (rewards.claimUrl or PLUSH_CLAIM_PUBLIC_URL)
  | 'lan' // the built-in claim listener on this machine's LAN address
  | 'loopback'; // only this machine (no LAN address found): phones can NOT open it

export interface RewardsStatusBody {
  /** False when the server has rewards switched off (PLUSH_REWARDS=off). */
  enabled: boolean;
  /** True when this caller may issue codes (loopback kiosk, or admin token). */
  canIssue: boolean;
  /** Base of the built-in claim page, e.g. http://192.168.1.20:8788 (no trailing slash). */
  claimBase: string;
  reach: ClaimReach;
  /** Hours a code stays valid. */
  ttlHours: number;
}

export interface IssueRequestBody {
  /** Random id of this page load (dedup key together with roundId). */
  session: string;
  roundId: number;
  prizeId: string;
  /** Display name of the plush in `lang` (shown on the claim page). */
  prizeName: string;
  tier: RarityTier;
  themeId: ThemeId;
  lang: Lang;
  options: RewardOptions;
  /** '' = built-in claim page; else an https URL template containing {code}. */
  claimUrl: string;
  /** Shown with the swag option, e.g. "20% off all swag"; '' = generic wording. */
  discountText: string;
  /** Swag store link on the claim page; '' = "show this screen at the swag counter". */
  swagUrl: string;
}

export interface IssueResponseBody {
  /** 8 characters from CODE_ALPHABET (display with formatCode). */
  code: string;
  /** What the QR code encodes. */
  url: string;
  reach: ClaimReach;
  /** ISO time. */
  issuedAt: string;
  expiresAt: string;
  options: RewardOptions;
  /** True when this session + round had already been issued (same code returned). */
  repeated: boolean;
}

export type RewardErrorCode =
  | 'rewards_off' // server switched rewards off
  | 'forbidden' // caller is not the kiosk (not loopback, no admin token)
  | 'bad_request'
  | 'rate_limited'
  | 'storage' // the code could not be written: nothing was issued
  | 'not_found'
  | 'expired'
  | 'already_chosen'
  | 'already_redeemed'
  | 'internal';

export interface RewardErrorBody {
  error: { code: RewardErrorCode; message: string };
}

/** One issued code as the server stores it (also the staff page / CSV row). */
export interface ClaimRecord {
  code: string;
  session: string;
  roundId: number;
  prizeId: string;
  prizeName: string;
  tier: RarityTier;
  themeId: ThemeId;
  lang: Lang;
  options: RewardOptions;
  discountText: string;
  swagUrl: string;
  issuedAt: string;
  expiresAt: string;
  choice: RewardChoice | null;
  chosenAt: string | null;
  redeemedAt: string | null;
}

/** XXXX-XXXX for display. */
export function formatCode(code: string): string {
  const c = code.toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Normalises typed input (lower case, dashes, spaces, O→0, I/L→1) to a code, or null. */
export function normalizeCode(input: string): string | null {
  const c = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (c.length !== REWARD_LIMITS.codeLength) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** Fills an owner URL template: {code} is replaced; without {code}, ?code= is appended. */
export function fillClaimTemplate(template: string, code: string): string {
  if (template.includes('{code}')) return template.split('{code}').join(encodeURIComponent(code));
  const sep = template.includes('?') ? '&' : '?';
  return `${template}${sep}code=${encodeURIComponent(code)}`;
}

/**
 * Characters the server refuses in display text (server/rewards/validate.ts): C0 / C1 controls,
 * line / paragraph separators and bidi overrides / isolates.
 */
const span = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
export const UNSAFE_TEXT_CHARS = new RegExp(`[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x2028, 0x2029)}${span(0x202a, 0x202e)}${span(0x2066, 0x2069)}]`);
const UNSAFE_TEXT_ALL = new RegExp(UNSAFE_TEXT_CHARS.source, 'g');

/**
 * Display text (plush name, discount wording) as the server accepts it: unsafe characters become
 * spaces (a tab pasted from a spreadsheet must not make every claim fail), runs of white space one
 * space, trimmed and cut to `max` without splitting a surrogate pair.
 */
export function cleanDisplayText(value: string, max: number): string {
  let text = value.replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) {
    text = text.slice(0, max);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    text = text.trim();
  }
  return text;
}

/**
 * The longest claim link a server answer may carry: an owner template of maxUrlChars grows when
 * {code} is filled in (or ?code= appended), and the code it belongs to is already stored.
 */
export const MAX_ISSUED_URL_CHARS = REWARD_LIMITS.maxUrlChars * 2;

/** True for an http(s) URL without credentials (owner-configured claim / swag links). */
export function isSafeHttpUrl(value: string, maxChars: number = REWARD_LIMITS.maxUrlChars): boolean {
  if (!value || value.length > maxChars) return false;
  try {
    const url = new URL(value.replace('{code}', 'CODE'));
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}
