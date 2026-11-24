/**
 * Strict validation of POST /api/rewards/issue. Everything in the body ends up on a public page or
 * in the staff CSV, so unknown keys, control / bidi-override characters and anything longer than
 * REWARD_LIMITS are refused rather than silently cleaned up.
 */
import { z } from 'zod';
import { LANGS, THEME_IDS } from '../../src/core/types';
import { RARITY_TIERS } from '../../src/game/rarity';
import { REWARD_CHOICES, REWARD_LIMITS, REWARD_OPTIONS, isSafeHttpUrl, type IssueRequestBody } from '../../src/rewards/protocol';

// C0 / C1 controls, line / paragraph separators and bidi overrides (which could make a staff list lie).
const span = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const UNSAFE_CHARS = new RegExp(`[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x2028, 0x2029)}${span(0x202a, 0x202e)}${span(0x2066, 0x2069)}]`);

const displayText = (max: number, min: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !UNSAFE_CHARS.test(value), 'contains control characters')
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, 'too short');

// The URL parser would quietly drop tabs and line breaks (and keep bidi overrides) that then sit in
// the stored link: refused like in display text, and surrounding spaces are trimmed.
const optionalUrl = z
  .string()
  .max(REWARD_LIMITS.maxUrlChars)
  .refine((value) => !UNSAFE_CHARS.test(value), 'contains control characters')
  .transform((value) => value.trim())
  .refine((value) => value === '' || isSafeHttpUrl(value), 'must be empty or an http(s) URL');

const token = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9._:-]+$/, 'invalid characters');

export const IssueRequestSchema = z
  .object({
    session: token(REWARD_LIMITS.maxSessionChars),
    roundId: z.number().int().min(0).max(1_000_000_000),
    prizeId: token(80),
    prizeName: displayText(REWARD_LIMITS.maxPrizeNameChars, 1),
    tier: z.enum(RARITY_TIERS),
    themeId: z.enum(THEME_IDS),
    lang: z.enum(LANGS),
    options: z.enum(REWARD_OPTIONS),
    claimUrl: optionalUrl,
    discountText: displayText(REWARD_LIMITS.maxDiscountTextChars, 0),
    swagUrl: optionalUrl,
  })
  .strict();

export type IssueRequest = IssueRequestBody;

export type IssueParse = { ok: true; request: IssueRequest } | { ok: false; message: string };

/** Short, safe description of the first problem ("prizeName: too short"); never echoes the value. */
export function parseIssueRequest(raw: unknown): IssueParse {
  const parsed = IssueRequestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, request: parsed.data };
  const issue = parsed.error.issues[0];
  if (!issue) return { ok: false, message: 'Invalid request body.' };
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  const what =
    issue.code === 'unrecognized_keys'
      ? 'unknown field'
      : issue.code === 'invalid_value'
        ? 'value not allowed'
        : issue.code === 'invalid_type'
          ? 'missing or of the wrong type'
          : issue.code === 'too_big'
            ? 'too long'
            : issue.message.slice(0, 80);
  return { ok: false, message: `${where}${what}` };
}

/** The visitor's pick from the claim form (form field `choice`). */
export const ChoiceSchema = z.enum(REWARD_CHOICES);
