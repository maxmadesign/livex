import { describe, expect, it } from 'vitest';
import { COUNTDOWN_SFX, MULTI_DROP_SFX, STAFF_RESET_SFX, SWITCH_SFX, TIME_UP_SFX, WIN_VOICE, impactSfx, itemScoredSfx, rankSfx } from '../../../src/app/machineSfx';
import { SFX_NAMES } from '../../../src/core/contracts';
import { GENRE_IDS } from '../../../src/game/machines/ids';

describe('machine sounds map onto the existing SFX (design 4.10)', () => {
  it('impacts: fixtures and gems have their own mapping, everything classic keeps the classic one', () => {
    expect(impactSfx('bar', { kind: 'box' })).toEqual({ name: 'glass_tap', pitch: 0.62, volume: 1 });
    expect(impactSfx('fence', { kind: 'box' })).toEqual({ name: 'glass_tap', pitch: 0.9, volume: 1 });
    expect(impactSfx('shelf', { kind: 'snack' })).toEqual({ name: 'plush_land', pitch: 1.2, volume: 1 });
    expect(impactSfx('lip', { kind: 'snack' })!.name).toBe('plush_land');
    expect(impactSfx('gutter', { kind: 'snack' })).toEqual({ name: 'plush_land', pitch: 1.35, volume: 0.5 });
    expect(impactSfx('floor', { kind: 'gem' })).toEqual({ name: 'score_count', pitch: 1.4, volume: 0.35 });
    expect(impactSfx('glass', { kind: 'coin' })!.name).toBe('score_count');
    // Plush toys (no item) against the classic statics: null, Game's own mapping runs unchanged.
    for (const against of ['floor', 'glass', 'backWall', 'ceiling', 'chuteWall', 'bin', 'toy', 'claw', 'unknown'] as const) {
      expect(impactSfx(against, undefined)).toBeNull();
    }
    expect(impactSfx('floor', { kind: 'snack' })).toBeNull();
  });

  it('every cue uses a real SFX name', () => {
    const names = new Set<string>(SFX_NAMES);
    const cues = [
      ...itemScoredSfx({ kind: 'snack', value: 0 }),
      ...itemScoredSfx({ kind: 'gem', value: 150 }),
      ...itemScoredSfx({ kind: 'coin', value: 5 }),
      MULTI_DROP_SFX,
      COUNTDOWN_SFX,
      TIME_UP_SFX,
      STAFF_RESET_SFX,
      SWITCH_SFX,
      rankSfx(1)!,
      rankSfx(2)!,
      rankSfx(7)!,
    ];
    for (const cue of cues) expect(names.has(cue.name), cue.name).toBe(true);
    for (const against of ['bar', 'fence', 'shelf', 'lip', 'gutter'] as const) expect(names.has(impactSfx(against, { kind: 'box' })!.name)).toBe(true);
  });

  it('item scores: a box drops, a gem sparkles higher with its value, a coin clinks', () => {
    expect(itemScoredSfx({ kind: 'snack', value: 0 }).map((c) => c.name)).toEqual(['chute_drop', 'score_count']);
    const emerald = itemScoredSfx({ kind: 'gem', value: 10 })[0]!;
    const diamond = itemScoredSfx({ kind: 'gem', value: 150 })[0]!;
    expect(emerald.name).toBe('sparkle');
    expect(diamond.options!.pitch!).toBeGreaterThan(emerald.options!.pitch!);
    expect(itemScoredSfx({ kind: 'coin', value: 5 })).toEqual([{ name: 'score_count', options: { pitch: 1.25 } }]);
  });

  it('rank cues: #1 jackpot, top 3 firework, top 10 sparkle, otherwise none', () => {
    expect(rankSfx(1)!.name).toBe('jackpot');
    expect(rankSfx(3)!.name).toBe('firework');
    expect(rankSfx(10)!.name).toBe('sparkle');
    expect(rankSfx(11)).toBeNull();
    expect(rankSfx(null)).toBeNull();
  });

  it('win voices: classic and the bridge print speak, items machines do not', () => {
    for (const g of GENRE_IDS) expect(typeof WIN_VOICE[g]).toBe('boolean');
    expect(WIN_VOICE).toEqual({ classic: true, bridge: true, shelf: false, rush: false });
  });
});
