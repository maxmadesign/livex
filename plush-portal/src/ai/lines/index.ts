/**
 * Local line bank: what Momo says when GPT is off, not configured, too slow or
 * unreachable. Every line is chosen from physics facts, so the same honesty
 * rules hold as for the model: "so close" only after real contact, direction
 * hints only from the measured offset, no promise of a win, and a claim QR is
 * only mentioned while facts.reward says one is on screen.
 */
import type { GuideEmotion, GuideEvent } from '../../core/contracts';
import type { Lang } from '../../core/types';
import { brandPoolFor, rewardFor, usableBrand } from '../brand';
import { directionKey } from './direction';
import { en } from './en';
import { ja } from './ja';
import type { BrandPoolId, DirKey, LangBank, LineEntry, LineKey } from './types';
import { zh } from './zh';

export { directionKey } from './direction';
export { BRAND_POOL_IDS, LINE_KEYS } from './types';
export type { BrandPoolId, DirKey, LangBank, LineEntry, LineKey, LinePool } from './types';

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
  /** Event flavour that replaces the theme pool (facts.brand of a kit that allows names), or null. */
  brand: BrandPoolId | null;
}

const REWARD_KEYS: Record<'both' | 'prize' | 'swag', LineKey> = {
  both: 'win.reward',
  prize: 'win.reward.prize',
  swag: 'win.reward.swag',
};

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
  const brand = brandPoolFor(event.themeId, event.facts.brand);
  const at = (keys: LineKey[], dir: DirKey | null = null): LineSituation => ({ keys, dir, brand });
  const f = event.facts;
  switch (event.type) {
    case 'welcome':
      return at(['welcome']);
    case 'first_play':
      return at(['first_play']);
    case 'idle_hint':
      return at(f.headTracking ? ['idle', 'idle.tracking'] : ['idle']);
    case 'aim_help':
      return at(['aim']);
    case 'grab_started':
      return at(['grab']);
    case 'empty_grab': {
      if (f.demo) return at(['miss.demo']);
      // Real contact of any kind: "so close" wording is allowed.
      if (f.contact === 'touched' || f.contact === 'gripped' || f.contact === 'lifted') {
        return at(['empty.touched']);
      }
      const dir = directionKey(f.nearest);
      return dir ? at(['empty.dir'], dir) : at(['empty.none']);
    }
    case 'slipped_after_grip': {
      if (f.demo) return at(['miss.demo']);
      // Reasons this build does not know (newer game versions) fall back to the generic pool.
      const key = (f.slipReason && KNOWN_SLIP_KEYS[f.slipReason]) || 'slip.generic';
      return at([key]);
    }
    case 'prize_won': {
      if (f.demo) return at(['win.demo']);
      // A claim QR on screen is what the player has to act on now, so it beats "new character".
      const reward = rewardFor(event.type, f);
      if (reward) return at([REWARD_KEYS[reward.options] ?? 'win.reward']);
      return at([f.newCharacter ? 'win.new' : 'win']);
    }
    case 'theme_changed':
      return at(['theme']);
    case 'retry_prompt':
      if (rewardFor(event.type, f)) return at(['retry.reward']);
      return at([f.lossStreak >= 3 ? 'retry.streak' : 'retry']);
    case 'user_requested_tip':
      return at(f.headTracking ? ['tip', 'tip.tracking'] : ['tip']);
    default:
      return at(['tip']);
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

/** Where a line comes from: the event (brand) pool, the theme pool or the generic pool. */
export type Flavour = 'brand' | 'theme' | 'generic';
/**
 * Pick weights. Event lines are the most likely so the booth sounds like the event, theme lines
 * next; generic lines stay in the mix for variety (they never contradict either).
 */
const FLAVOUR_WEIGHT: Record<Flavour, number> = { brand: 3, theme: 2, generic: 1 };

interface Candidate extends LocalLine {
  flavour: Flavour;
}

function buildCandidates(event: GuideEvent, lang: Lang): Candidate[] {
  const bank = LINE_BANKS[lang];
  const situation = resolveSituation(event);
  const facts = event.facts;
  const toyName = facts.toy?.name?.trim() || bank.toyFallback;
  const brand = situation.brand ? usableBrand(event.themeId, facts.brand) : null;
  const values: Record<string, string | null> = {
    toy: toyName,
    dir: situation.dir ? bank.dir[situation.dir] : null,
    // {near} lines are only eligible when the game told us which toy was nearest.
    near: facts.nearest?.name?.trim() || null,
    // {event} / {host} only exist while a kit that allows names dresses the theme.
    event: brand?.event || null,
    host: brand?.host || null,
  };
  const out: Candidate[] = [];
  const push = (entries: readonly LineEntry[] | undefined, key: LineKey, flavour: Flavour): number => {
    if (!entries) return 0;
    let added = 0;
    for (const [template, emotion] of entries) {
      const text = fill(template, values);
      if (text !== null) {
        out.push({ text, emotion, key, flavour });
        added++;
      }
    }
    return added;
  };
  for (const key of situation.keys) {
    const pool = bank.lines[key];
    // Event lines replace the theme's own flavour (a GTC booth host is not a "GPU Party" host).
    const branded = situation.brand ? push(pool[situation.brand], key, 'brand') : 0;
    if (branded === 0) push(pool[event.themeId], key, 'theme');
    push(pool.all, key, 'generic');
  }
  // A theme change should always sound like the theme (or event) when it has lines of its own.
  if (event.type === 'theme_changed' && out.some((c) => c.flavour !== 'generic')) return out.filter((c) => c.flavour !== 'generic');
  return out;
}

/** Every line that could be said for this event (after placeholders are filled). */
export function localCandidates(event: GuideEvent, lang: Lang): LocalLine[] {
  return buildCandidates(event, lang).map(({ text, emotion, key }) => ({ text, emotion, key }));
}

/** Like localCandidates, plus where each line comes from (tests, diagnostics). */
export function localCandidatesWithFlavour(event: GuideEvent, lang: Lang): (LocalLine & { flavour: Flavour })[] {
  return buildCandidates(event, lang);
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

export interface PickOptions {
  /** Recently spoken lines; they are avoided when alternatives exist. */
  recent?: readonly string[];
  rng?: () => number;
}

/** Picks one line, weighted by flavour (event lines 3, theme lines 2, generic lines 1). */
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
  for (const c of pool) total += FLAVOUR_WEIGHT[c.flavour];
  let roll = Math.min(0.999999, Math.max(0, rng())) * total;
  for (const c of pool) {
    roll -= FLAVOUR_WEIGHT[c.flavour];
    if (roll < 0) return { text: c.text, emotion: c.emotion, key: c.key };
  }
  const last = pool[pool.length - 1]!;
  return { text: last.text, emotion: last.emotion, key: last.key };
}
