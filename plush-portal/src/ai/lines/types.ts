import type { BrandId } from '../../brand/kits';
import type { GuideEmotion } from '../../core/contracts';
import type { ThemeId } from '../../core/types';

/**
 * Situations Momo has local lines for. Event types map onto these keys using
 * the physics facts (see `resolveSituation` in ./index.ts).
 */
export const LINE_KEYS = [
  'welcome',
  'first_play',
  'idle',
  'idle.tracking', // extra idle hints that only make sense with head tracking on
  'aim',
  'grab',
  'empty.dir', // nothing touched; {dir} says which way the nearest toy was
  'empty.none', // nothing touched and no usable direction
  'empty.touched', // the claw touched a toy but did not hold it
  'slip.eccentric',
  'slip.weak_support',
  'slip.contact_lost',
  'slip.transport_swing',
  'slip.overload',
  'slip.bounced_out',
  'slip.generic', // also used for slip reasons this build does not know yet
  'win',
  'win.new',
  'win.reward', // prize_won with a claim QR on screen that unlocks the plush prize or a swag discount
  'win.reward.prize', // ... that unlocks the plush prize only
  'win.reward.swag', // ... that unlocks a swag discount only
  'win.demo',
  'miss.demo',
  'theme',
  'retry',
  'retry.streak',
  'retry.reward', // retry_prompt while the claim QR of the win is still on screen: a nudge to scan it
  'tip',
  'tip.tracking',
] as const;
export type LineKey = (typeof LINE_KEYS)[number];

/**
 * `[template, emotion]`. Templates may contain:
 *   {toy}   name of the toy involved (falls back to `toyFallback`)
 *   {dir}   direction phrase from `dir` (only `empty.dir`)
 *   {near}  name of the nearest toy (the line is skipped when the game did not supply it)
 *   {event} {host}  event and host name from facts.brand (the line is skipped without them,
 *           and `{host}` lines are skipped for a kit without a host); used in brand pools only
 */
export type LineEntry = readonly [string, GuideEmotion];

/**
 * Brand kits that may have pools of their own: only kits whose names dialogue may use
 * (`namesAllowed`). The neutral kit has none: it is the theme's original identity.
 */
export type BrandPoolId = Exclude<BrandId, 'neutral'>;
export const BRAND_POOL_IDS: readonly BrandPoolId[] = ['gtc'];

/**
 * Lines for one situation:
 *   all      works in every theme
 *   <theme>  theme flavour (e.g. `gpu`: the original "GPU Party" voice, also used by the neutral kit)
 *   <brand>  event flavour (e.g. `gtc`), used instead of the pool of the theme that kit dresses,
 *            only while facts.brand carries that kit's names (src/ai/brand.ts)
 *
 * Why a brand-keyed pool and not gpu lines with tokens: a GTC booth host talks about the keynote,
 * sessions, labs and the show floor, which a neutral "GPU Party" must never mention, so the two
 * voices need different sentences, not just a different name. The brand lines still take the
 * names from {event} / {host} instead of spelling them out, so they follow the kit data (and the
 * neutral kit, which sends no facts.brand, can never output them).
 */
export type LinePool = { all: readonly LineEntry[] } & Partial<Record<ThemeId, readonly LineEntry[]>> &
  Partial<Record<BrandPoolId, readonly LineEntry[]>>;

export const DIR_KEYS = [
  'left',
  'right',
  'back',
  'front',
  'left_back',
  'left_front',
  'right_back',
  'right_front',
] as const;
export type DirKey = (typeof DIR_KEYS)[number];

export interface LangBank {
  lines: Record<LineKey, LinePool>;
  /** Phrase that completes "move the claw a bit more ___". */
  dir: Record<DirKey, string>;
  /** Used for {toy} / {near} when the game did not supply a name. */
  toyFallback: string;
}
