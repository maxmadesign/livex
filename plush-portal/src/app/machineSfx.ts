/**
 * Machine moments mapped onto the existing sound effects (docs/design/machines.md, section 4.10).
 * Only names from SFX_NAMES are used: no new samples, no new synthesised fallbacks. Pure tables, so
 * the mapping is unit-tested and every genre is listed (the compiler names a missing one).
 */
import type { SfxName, SfxOptions } from '../core/contracts';
import type { GenreId } from '../game/machines/ids';
import type { ItemSpec } from '../physics/items';
import type { ImpactEvent } from '../physics/PhysicsWorld';

/** One sound to play: a name and its options (volume and pitch are multipliers). */
export interface SfxCue {
  name: SfxName;
  options?: SfxOptions;
}

/**
 * The sound of an impact on a machine, or null for the classic mapping (plush on the floor, the
 * glass, the bin). `volume` is a factor on the classic impact volume.
 *
 *   gem / coin against anything  score_count, pitch 1.4, volume 0.35
 *   bar                          glass_tap, pitch 0.62
 *   fence                        glass_tap, pitch 0.9
 *   shelf / lip                  plush_land, pitch 1.2
 *   gutter                       plush_land, pitch 1.35, volume 0.5
 */
export function impactSfx(against: ImpactEvent['against'], item: Pick<ItemSpec, 'kind'> | undefined): { name: SfxName; pitch: number; volume: number } | null {
  if (item && (item.kind === 'gem' || item.kind === 'coin')) return { name: 'score_count', pitch: 1.4, volume: 0.35 };
  switch (against) {
    case 'bar':
      return { name: 'glass_tap', pitch: 0.62, volume: 1 };
    case 'fence':
      return { name: 'glass_tap', pitch: 0.9, volume: 1 };
    case 'shelf':
    case 'lip':
      return { name: 'plush_land', pitch: 1.2, volume: 1 };
    case 'gutter':
      return { name: 'plush_land', pitch: 1.35, volume: 0.5 };
    default:
      return null;
  }
}

/**
 * An item reached the opening (shelf, rush): a box drops into the trough, a gem sparkles (higher
 * for a more valuable one), a coin clinks. The points counter ticks in every case.
 */
export function itemScoredSfx(item: Pick<ItemSpec, 'kind' | 'value'>): SfxCue[] {
  if (item.kind === 'coin') return [{ name: 'score_count', options: { pitch: 1.25 } }];
  if (item.kind === 'gem') {
    // Emerald 10 … diamond 150: pitch 0.95 … 1.35.
    const pitch = 0.95 + 0.4 * Math.min(1, Math.max(0, (item.value - 10) / 140));
    return [{ name: 'sparkle', options: { pitch } }, { name: 'score_count', options: { delay: 0.12 } }];
  }
  return [{ name: 'chute_drop', options: { volume: 0.7 } }, { name: 'score_count', options: { delay: 0.2 } }];
}

/** Two or more items in one try: the combo hit on top of the item sounds. */
export const MULTI_DROP_SFX: SfxCue = { name: 'combo', options: { delay: 0.35 } };

/** The last seconds of a timed run tick once per second. */
export const COUNTDOWN_SFX: SfxCue = { name: 'countdown_tick' };
/** The timed run's clock reached zero. */
export const TIME_UP_SFX: SfxCue = { name: 'start_game', options: { pitch: 0.8 } };
/** "Call staff" put the bridge box back. */
export const STAFF_RESET_SFX: SfxCue = { name: 'restock_drop' };
/** A machine switch finished behind the curtain. */
export const SWITCH_SFX: SfxCue = { name: 'theme_sting' };

/** A run made the local ranking: #1 the jackpot bells, the top 3 a firework, the rest of the top 10 a sparkle. */
export function rankSfx(position: number | null): SfxCue | null {
  if (position === null || !(position >= 1)) return null;
  if (position === 1) return { name: 'jackpot' };
  if (position <= 3) return { name: 'firework' };
  if (position <= 10) return { name: 'sparkle' };
  return null;
}

/** Character voices (lift, slip) on a genre: items are printed boxes and gems, they do not squeal. */
export const CHARACTER_VOICES: Readonly<Record<GenreId, { lift: boolean; slip: boolean; win: boolean }>> = {
  classic: { lift: true, slip: true, win: true },
  // The drop is the win: the printed character's own win voice plays (section 3.1).
  bridge: { lift: false, slip: false, win: true },
  shelf: { lift: false, slip: false, win: false },
  rush: { lift: false, slip: false, win: false },
};
