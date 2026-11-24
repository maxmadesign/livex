/**
 * Local line bank: what Momo says when GPT is off, not configured, too slow or
 * unreachable. Every line is chosen from physics facts, so the same honesty
 * rules hold as for the model: "so close" only after real contact, direction
 * hints only from the measured offset, no promise of a win.
 */
import type { GuideEmotion, GuideEvent } from '../../core/contracts';
import type { Lang, ThemeId } from '../../core/types';
import { directionKey } from './direction';
import { en } from './en';
import { ja } from './ja';
import type { DirKey, LangBank, LineEntry, LineKey } from './types';
import { zh } from './zh';

export { directionKey } from './direction';
export { LINE_KEYS } from './types';
export type { DirKey, LangBank, LineEntry, LineKey, LinePool } from './types';

/** Every theme, GPU Party included, has its own flavour lines in each language (see the tests). */
export const LINE_BANKS: Record<Lang, LangBank> = { en, zh, ja };

export interface LocalLine {
  text: string;
  emotion: GuideEmotion;
  key: LineKey;
}

export interface LineSituation {
  /** Pools to draw from (all are merged). */
  keys: LineKey[];
  dir: DirKey | null;
}

const KNOWN_SLIP_KEYS: Record<string, LineKey> = {
  eccentric: 'slip.eccentric',
  weak_support: 'slip.weak_support',
  contact_lost: 'slip.contact_lost',
  transport_swing: 'slip.transport_swing',
  overload: 'slip.overload',
  bounced_out: 'slip.bounced_out',
};

/** Maps an event plus its facts to the pools that fit the situation. */
export function resolveSituation(event: GuideEvent): LineSituation {
  const f = event.facts;
  switch (event.type) {
    case 'welcome':
      return { keys: ['welcome'], dir: null };
    case 'first_play':
      return { keys: ['first_play'], dir: null };
    case 'idle_hint':
      return { keys: f.headTracking ? ['idle', 'idle.tracking'] : ['idle'], dir: null };
    case 'aim_help':
      return { keys: ['aim'], dir: null };
    case 'grab_started':
      return { keys: ['grab'], dir: null };
    case 'empty_grab': {
      if (f.demo) return { keys: ['miss.demo'], dir: null };
      // Real contact of any kind: "so close" wording is allowed.
      if (f.contact === 'touched' || f.contact === 'gripped' || f.contact === 'lifted') {
        return { keys: ['empty.touched'], dir: null };
      }
      const dir = directionKey(f.nearest);
      return dir ? { keys: ['empty.dir'], dir } : { keys: ['empty.none'], dir: null };
    }
    case 'slipped_after_grip': {
      if (f.demo) return { keys: ['miss.demo'], dir: null };
      // Reasons this build does not know (newer game versions) fall back to the generic pool.
      const key = (f.slipReason && KNOWN_SLIP_KEYS[f.slipReason]) || 'slip.generic';
      return { keys: [key], dir: null };
    }
    case 'prize_won':
      if (f.demo) return { keys: ['win.demo'], dir: null };
      return { keys: [f.newCharacter ? 'win.new' : 'win'], dir: null };
    case 'theme_changed':
      return { keys: ['theme'], dir: null };
    case 'retry_prompt':
      return { keys: [f.lossStreak >= 3 ? 'retry.streak' : 'retry'], dir: null };
    case 'user_requested_tip':
      return { keys: f.headTracking ? ['tip', 'tip.tracking'] : ['tip'], dir: null };
    default:
      return { keys: ['tip'], dir: null };
  }
}

function fill(template: string, values: Record<string, string | null>): string | null {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === null || value === undefined || value === '') {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : text;
}

interface Candidate extends LocalLine {
  themed: boolean;
}

function buildCandidates(event: GuideEvent, lang: Lang): Candidate[] {
  const bank = LINE_BANKS[lang];
  const situation = resolveSituation(event);
  const facts = event.facts;
  const toyName = facts.toy?.name?.trim() || bank.toyFallback;
  const values: Record<string, string | null> = {
    toy: toyName,
    dir: situation.dir ? bank.dir[situation.dir] : null,
    // {near} lines are only eligible when the game told us which toy was nearest.
    near: facts.nearest?.name?.trim() || null,
  };
  const out: Candidate[] = [];
  const push = (entries: readonly LineEntry[] | undefined, key: LineKey, themed: boolean) => {
    if (!entries) return;
    for (const [template, emotion] of entries) {
      const text = fill(template, values);
      if (text !== null) out.push({ text, emotion, key, themed });
    }
  };
  for (const key of situation.keys) {
    const pool = bank.lines[key];
    push(pool[event.themeId as ThemeId], key, true);
    push(pool.all, key, false);
  }
  // A theme change should always sound like the theme when it has lines of its own.
  if (event.type === 'theme_changed' && out.some((c) => c.themed)) return out.filter((c) => c.themed);
  return out;
}

/** Every line that could be said for this event (after placeholders are filled). */
export function localCandidates(event: GuideEvent, lang: Lang): LocalLine[] {
  return buildCandidates(event, lang).map(({ text, emotion, key }) => ({ text, emotion, key }));
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

export interface PickOptions {
  /** Recently spoken lines; they are avoided when alternatives exist. */
  recent?: readonly string[];
  rng?: () => number;
}

/** Picks one line. Theme-flavoured lines are twice as likely as generic ones. */
export function pickLocalLine(event: GuideEvent, lang: Lang, options: PickOptions = {}): LocalLine {
  const rng = options.rng ?? Math.random;
  const all = buildCandidates(event, lang);
  const recent = new Set((options.recent ?? []).map(normalize));
  const fresh = all.filter((c) => !recent.has(normalize(c.text)));
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) {
    // Can not happen with the shipped banks (covered by tests); keep the guide alive regardless.
    const fallback = LINE_BANKS[lang].lines.tip.all[0]!;
    return { text: fallback[0], emotion: fallback[1], key: 'tip' };
  }
  let total = 0;
  for (const c of pool) total += c.themed ? 2 : 1;
  let roll = Math.min(0.999999, Math.max(0, rng())) * total;
  for (const c of pool) {
    roll -= c.themed ? 2 : 1;
    if (roll < 0) return { text: c.text, emotion: c.emotion, key: c.key };
  }
  const last = pool[pool.length - 1]!;
  return { text: last.text, emotion: last.emotion, key: last.key };
}
