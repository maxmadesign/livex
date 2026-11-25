import { describe, expect, it } from 'vitest';
import { scoreItemsTry } from '../../../src/game/machines/pieces';
import { SHELF_SCORE } from '../../../src/game/machines/shelf';
import type { ScoredItem } from '../../../src/game/machines/types';
import { ScoreKeeper, applyDailyBonus, scoreRound, type RoundScoreInput, type ScoreRecord } from '../../../src/game/scoring';

const win = (roundId: number, typeId = 'sakura.bunny', demo = false): RoundScoreInput => ({ roundId, outcome: 'won', typeId, difficulty: 'arcade', firstCatch: false, grip: null, demo });
const snack = (index: number, print = 'sakura.bunny'): ScoredItem => ({ toyId: `t${index}`, kind: 'snack', look: 'snackS', print, value: 0, index });

describe('ScoreKeeper additions for machines (design 2.3)', () => {
  it('settleScored books an externally computed score exactly like settle, once per round id', () => {
    const persisted: ScoreRecord[] = [];
    const a = new ScoreKeeper({ best: 0, lifetime: 0 }, (r) => persisted.push(r));
    const b = new ScoreKeeper({ best: 0, lifetime: 0 });
    const viaSettle = a.settle(win(1));
    const viaScored = b.settleScored(1, false, scoreRound(win(1), 0));
    expect(viaScored).toEqual(viaSettle);
    expect(persisted).toHaveLength(1);
    // Idempotent per round id, whichever path booked it first.
    expect(b.settleScored(1, false, scoreRound(win(1), 0))).toBeNull();
    expect(b.settle(win(1))).toBeNull();
    // Off: nothing.
    b.enabled = false;
    expect(b.settleScored(2, false, scoreRound(win(2), 0))).toBeNull();
  });

  it('settleScored keeps demo rounds on the demo track and never persists them', () => {
    const persisted: ScoreRecord[] = [];
    const k = new ScoreKeeper({ best: 0, lifetime: 0 }, (r) => persisted.push(r));
    const items = scoreItemsTry({ roundId: 3, demo: true, difficulty: 'arcade', items: [snack(1), snack(2)], dailyBonus: 1 }, SHELF_SCORE);
    const award = k.settleScored(3, true, items)!;
    expect(award.demo).toBe(true);
    expect(k.totals(true).session).toBe(award.total);
    expect(k.totals(false).session).toBe(0);
    expect(persisted).toHaveLength(0);
    // The round id and demo flag given to settleScored win over the score object's.
    const forced = k.settleScored(4, false, { ...items, roundId: 99, demo: true })!;
    expect(forced.roundId).toBe(4);
    expect(forced.demo).toBe(false);
    expect(k.isSettled(4)).toBe(true);
    expect(k.isSettled(99)).toBe(false);
  });

  it('useRecord swaps best / lifetime and where they persist; the session starts over', () => {
    const classic: ScoreRecord[] = [];
    const shelf: ScoreRecord[] = [];
    const k = new ScoreKeeper({ best: 500, lifetime: 900 }, (r) => classic.push(r));
    k.settle(win(1));
    expect(k.totals().session).toBeGreaterThan(0);
    k.useRecord({ best: 40, lifetime: 80 }, (r) => shelf.push(r));
    expect(k.totals()).toEqual({ session: 0, streak: 0, best: 40, lifetime: 80 });
    k.settle(win(2));
    expect(shelf.at(-1)!.lifetime).toBe(80 + k.totals().session);
    expect(classic).toHaveLength(1);
    // Round ids keep counting: a round settled before the swap stays settled.
    expect(k.settle(win(1))).toBeNull();
  });

  it("applyDailyBonus multiplies once, rounds once and lists the 'daily' row; ×1 changes nothing", () => {
    const base = scoreRound(win(1, 'sakura.bunny'), 0);
    expect(applyDailyBonus(base, 1)).toBe(base);
    expect(applyDailyBonus(base, Number.NaN)).toBe(base);
    const boosted = applyDailyBonus(base, 1.5);
    expect(boosted.total).toBe(Math.round(base.total * 1.5));
    expect(boosted.dailyBonus).toBe(1.5);
    expect(boosted.extras).toEqual([{ key: 'daily', points: boosted.total - base.total }]);
    // A miss stays 0 points.
    const miss = applyDailyBonus(scoreRound({ ...win(2), outcome: 'empty', typeId: null }, 0), 1.5);
    expect(miss.total).toBe(0);
    expect(miss.extras).toEqual([]);
  });

  it("the daily bonus never reaches classic's own path: settle() has no bonus input", () => {
    const k = new ScoreKeeper();
    const award = k.settle(win(1))!;
    expect(award.dailyBonus).toBeUndefined();
    expect(award.extras).toBeUndefined();
    expect(award.items).toBeUndefined();
    expect(award).toEqual({ ...scoreRound(win(1), 0), session: award.total, best: award.total, newBest: true });
  });
});
