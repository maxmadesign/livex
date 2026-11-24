import type { GuideEmotion } from '../../core/contracts';
import type { ThemeId } from '../../core/types';

/**
 * Situations Momo has local lines for. Event types map onto these keys using
 * the physics facts (see `resolveLineKeys` in ./index.ts).
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
  'win.demo',
  'miss.demo',
  'theme',
  'retry',
  'retry.streak',
  'tip',
  'tip.tracking',
] as const;
export type LineKey = (typeof LINE_KEYS)[number];

/** `[template, emotion]`. Templates may contain {toy}, {dir} and {near}. */
export type LineEntry = readonly [string, GuideEmotion];

/** Lines for one situation: `all` works in every theme, the rest add theme flavour. */
export type LinePool = { all: readonly LineEntry[] } & Partial<Record<ThemeId, readonly LineEntry[]>>;

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
