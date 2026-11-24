import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY_MULTIPLIER, SCORING_RULES, ScoreKeeper, comboMultiplier, isCleanGrab, scoreRound, type RoundScoreInput } from '../../../src/game/scoring';

const CENTRED = { centering: 0.95, fingers: 3 };
const OFF = { centering: 0.5, fingers: 3 };

function input(over: Partial<RoundScoreInput> = {}): RoundScoreInput {
  return { roundId: 1, outcome: 'won', typeId: 'sakura.bunny', difficulty: 'arcade', firstCatch: false, grip: OFF, demo: false, ...over };
}

describe('points for one round', () => {
  it('base points follow the rarity tier', () => {
    expect(scoreRound(input({ typeId: 'sakura.bunny' }), 0).total).toBe(100);
    expect(scoreRound(input({ typeId: 'sakura.tanuki' }), 0).total).toBe(250);
    expect(scoreRound(input({ typeId: 'sakura.monster' }), 0).total).toBe(500);
    const legendary = scoreRound(input({ typeId: 'sakura.biribi' }), 0);
    expect(legendary).toMatchObject({ tier: 'legendary', base: 1000, basePoints: 1000, total: 1000 });
    expect(scoreRound(input({ typeId: 'somewhere.unknown' }), 0)).toMatchObject({ tier: 'common', total: 100 });
  });

  it('multiplies by difficulty: easy 0.8, arcade 1, skill 1.5, custom 1', () => {
    expect(DIFFICULTY_MULTIPLIER).toEqual({ easy: 0.8, arcade: 1, skill: 1.5, custom: 1 });
    expect(scoreRound(input({ typeId: 'ocean.octopus', difficulty: 'easy' }), 0).total).toBe(200);
    expect(scoreRound(input({ typeId: 'ocean.octopus', difficulty: 'skill' }), 0).total).toBe(375);
    expect(scoreRound(input({ typeId: 'ocean.octopus', difficulty: 'custom' }), 0).total).toBe(250);
  });

  it('adds +50 % of base for a first catch and +20 % for a clean (centred) grab', () => {
    const r = scoreRound(input({ typeId: 'cosmic.starbear', firstCatch: true, grip: CENTRED, difficulty: 'skill' }), 0);
    // 250 × 1.5 + 125 + 50: the bonuses are shares of the tier's base points.
    expect(r).toMatchObject({ basePoints: 375, firstCatch: 125, cleanGrab: 50, comboMultiplier: 1, comboBonus: 0, total: 550 });
  });

  it('a clean grab needs a centred aim and all three fingers (the grip facts)', () => {
    expect(isCleanGrab({ centering: SCORING_RULES.cleanMinCentering, fingers: 3 })).toBe(true);
    expect(isCleanGrab({ centering: 0.79, fingers: 3 })).toBe(false);
    expect(isCleanGrab({ centering: 1, fingers: 2 })).toBe(false);
    expect(isCleanGrab(null)).toBe(false);
  });

  it('combo: 2nd consecutive win ×1.5, 3rd ×2, 4th and later ×3', () => {
    expect([1, 2, 3, 4, 5, 9].map(comboMultiplier)).toEqual([1, 1.5, 2, 3, 3, 3]);
    const third = scoreRound(input({ typeId: 'storybook.dino', grip: CENTRED }), 2);
    // (250 + 50) × 2
    expect(third).toMatchObject({ streak: 3, comboMultiplier: 2, comboBonus: 300, total: 600 });
  });

  it('a slip is worth 10 consolation points, an empty grab nothing; both end the combo', () => {
    expect(scoreRound(input({ outcome: 'slipped' }), 3)).toMatchObject({ total: 10, consolation: 10, streak: 0, tier: null, comboMultiplier: 1 });
    expect(scoreRound(input({ outcome: 'empty', typeId: null, grip: null }), 3)).toMatchObject({ total: 0, streak: 0, tier: null });
  });
});

describe('score keeper', () => {
  it('runs a session: combo grows with consecutive wins and resets on a slip or an empty grab', () => {
    const k = new ScoreKeeper();
    const totals: number[] = [];
    const rounds: Partial<RoundScoreInput>[] = [{}, {}, {}, {}, { outcome: 'slipped' }, {}, { outcome: 'empty', typeId: null }, {}];
    rounds.forEach((r, i) => totals.push(k.settle(input({ roundId: i + 1, ...r }))!.total));
    expect(totals).toEqual([100, 150, 200, 300, 10, 100, 0, 100]);
    expect(k.totals()).toMatchObject({ session: 960, streak: 1, best: 960, lifetime: 960 });
  });

  it('settles each round id once, however often it is reported', () => {
    const k = new ScoreKeeper();
    const first = k.settle(input({ roundId: 7, typeId: 'ocean.whale' }));
    expect(first?.total).toBe(1000);
    expect(k.settle(input({ roundId: 7, typeId: 'ocean.whale' }))).toBeNull();
    expect(k.settle(input({ roundId: 7, outcome: 'slipped' }))).toBeNull();
    expect(k.isSettled(7)).toBe(true);
    expect(k.awardFor(7)).toEqual(first);
    expect(k.totals()).toMatchObject({ session: 1000, streak: 1 });
  });

  it('demo rounds are scored for the show only: never persisted, never best or lifetime', () => {
    const persist = vi.fn();
    const k = new ScoreKeeper({ best: 500, lifetime: 2000 }, persist);
    const a = k.settle(input({ roundId: 1, demo: true, typeId: 'sakura.biribi' }))!;
    const b = k.settle(input({ roundId: 2, demo: true, typeId: 'sakura.biribi' }))!;
    expect(a).toMatchObject({ demo: true, total: 1000, newBest: false, best: 500 });
    expect(b).toMatchObject({ total: 1500, streak: 2, session: 2500 });
    expect(persist).not.toHaveBeenCalled();
    expect(k.totals(false)).toEqual({ session: 0, streak: 0, best: 500, lifetime: 2000 });
    expect(k.totals(true)).toMatchObject({ session: 2500, streak: 2 });
    // The player's combo is untouched by the demo.
    expect(k.settle(input({ roundId: 3 }))!.comboMultiplier).toBe(1);
  });

  it('tracks the best session score and the lifetime total and persists them', () => {
    const persist = vi.fn();
    const k = new ScoreKeeper({ best: 300, lifetime: 1000 }, persist);
    expect(k.settle(input({ roundId: 1, typeId: 'sakura.tanuki' }))).toMatchObject({ session: 250, newBest: false, best: 300 });
    expect(k.settle(input({ roundId: 2, typeId: 'sakura.bunny' }))).toMatchObject({ session: 400, newBest: true, best: 400 });
    expect(persist).toHaveBeenLastCalledWith({ best: 400, lifetime: 1400 });
    // An empty grab adds nothing and writes nothing.
    persist.mockClear();
    k.settle(input({ roundId: 3, outcome: 'empty', typeId: null }));
    expect(persist).not.toHaveBeenCalled();
    // A new session starts at zero; best and lifetime stay.
    k.resetSession();
    expect(k.totals()).toEqual({ session: 0, streak: 0, best: 400, lifetime: 1400 });
    expect(k.settle(input({ roundId: 4 }))).toMatchObject({ session: 100, newBest: false });
    k.resetAll();
    expect(k.totals()).toEqual({ session: 0, streak: 0, best: 0, lifetime: 0 });
    expect(persist).toHaveBeenLastCalledWith({ best: 0, lifetime: 0 });
  });

  it('awards nothing while scoring is off (and does not mark the round as settled)', () => {
    const persist = vi.fn();
    const k = new ScoreKeeper(undefined, persist);
    k.enabled = false;
    expect(k.settle(input({ roundId: 1 }))).toBeNull();
    expect(k.isSettled(1)).toBe(false);
    expect(k.totals()).toMatchObject({ session: 0, streak: 0, lifetime: 0 });
    expect(persist).not.toHaveBeenCalled();
    k.enabled = true;
    expect(k.settle(input({ roundId: 2 }))!.total).toBe(100);
  });
});
