/**
 * The pure parts of the items genres (docs/design/machines.md, sections 3.2, 3.3 and 8.1): the
 * points of one try (multi-drop cap, handful, the daily bonus applied once), the session prizes,
 * the print pools, the piece mix and the local top-10 data shape.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import { PrintPool, rarestPrint, scaleMix, scoreItemsTry } from '../../../src/game/machines/pieces';
import { INITIALS_PATTERN, RANK_SIZE, RUSH_PIECES, RUSH_SCORE, insertRank, pieceCounts, rankPosition, rewardTier, runPoints, rushModule, rushReward, type RankEntry } from '../../../src/game/machines/rush';
import { SHELF_DEFAULTS, SHELF_SCORE, SHELF_TIER_POINTS, multiDropFactor, shelfModule, stackPlan } from '../../../src/game/machines/shelf';
import type { ScoredItem, SessionSummary, TryScoreInput } from '../../../src/game/machines/types';
import { rarityOf } from '../../../src/game/rarity';
import { themeAssets } from '../game/harness';

let nextIndex = 1;
function snack(print: string, look: ScoredItem['look'] = 'snackS'): ScoredItem {
  return { toyId: `item-${nextIndex}`, kind: 'snack', look, print, value: 0, index: nextIndex++ };
}
function piece(look: ScoredItem['look']): ScoredItem {
  const k = RUSH_PIECES.find((p) => p.look === look)!;
  return { toyId: `item-${nextIndex}`, kind: look === 'coin' ? 'coin' : 'gem', look, print: null, value: k.value, index: nextIndex++ };
}
function input(items: ScoredItem[], o: Partial<TryScoreInput> = {}): TryScoreInput {
  return { roundId: 4, demo: false, difficulty: 'arcade', items, dailyBonus: 1, ...o };
}

describe('shelf points', () => {
  it('scores each box by its print tier and size, with the multi-drop factor capped at ×2', () => {
    // common 40 × S 1, rare 100 × M 1.25, legendary 400 × L 1.5
    const one = scoreItemsTry(input([snack('sakura.bunny')]), SHELF_SCORE);
    expect(one).toMatchObject({ outcome: 'won', items: 1, base: 40, basePoints: 40, comboMultiplier: 1, total: 40, extras: [] });
    expect(scoreItemsTry(input([snack('sakura.tanuki', 'snackM')]), SHELF_SCORE).total).toBe(125);
    expect(scoreItemsTry(input([snack('sakura.biribi', 'snackL')]), SHELF_SCORE).total).toBe(600);
    expect(SHELF_TIER_POINTS).toEqual({ common: 40, rare: 100, epic: 200, legendary: 400 });
    expect([0, 1, 2, 3, 4, 5, 9].map(multiDropFactor)).toEqual([1, 1, 1.2, 1.5, 2, 2, 2]);
    const two = scoreItemsTry(input([snack('sakura.bunny'), snack('sakura.bunny')]), SHELF_SCORE);
    expect(two).toMatchObject({ basePoints: 80, comboMultiplier: 1.2, comboBonus: 16, total: 96, extras: [{ key: 'multiDrop', points: 16 }] });
    const six = scoreItemsTry(input(Array.from({ length: 6 }, () => snack('sakura.bunny'))), SHELF_SCORE);
    expect(six).toMatchObject({ basePoints: 240, comboMultiplier: 2, total: 480 });
  });

  it('applies the difficulty and the daily bonus exactly once, and never a combo across tries', () => {
    const items = [snack('sakura.tanuki'), snack('sakura.bunny'), snack('sakura.monster', 'snackM')];
    // 100 + 40 + 250 = 390 raw; skill ×1.5 = 585; three boxes ×1.5 = 878 (rounded); daily ×1.5 = 1317
    const s = scoreItemsTry(input(items, { difficulty: 'skill', dailyBonus: 1.5 }), SHELF_SCORE);
    expect(s).toMatchObject({ base: 390, difficultyMultiplier: 1.5, basePoints: 585, comboMultiplier: 1.5, total: 1317, dailyBonus: 1.5, streak: 0 });
    expect(s.extras).toEqual([
      { key: 'multiDrop', points: 878 - 585 },
      { key: 'daily', points: 1317 - 878 },
    ]);
    // The headline character is the rarest print.
    expect(s.typeId).toBe('sakura.monster');
    expect(s.tier).toBe('epic');
    // A second identical try scores the same: no streak.
    expect(scoreItemsTry(input(items, { difficulty: 'skill', dailyBonus: 1.5 }), SHELF_SCORE).total).toBe(1317);
    // A daily bonus of 1 (or a broken value) changes nothing.
    expect(scoreItemsTry(input(items, { dailyBonus: Number.NaN }), SHELF_SCORE).dailyBonus).toBe(1);
  });

  it('an empty try scores nothing', () => {
    expect(scoreItemsTry(input([], { dailyBonus: 3 }), SHELF_SCORE)).toMatchObject({ outcome: 'empty', items: 0, total: 0, tier: null, typeId: null, extras: [] });
    expect(shelfModule.scoreTry!(input([]), SHELF_DEFAULTS).total).toBe(0);
  });
});

describe('rush points', () => {
  it('sums the piece values × difficulty, +25 % for a handful of three or more, × the daily bonus once', () => {
    const two = scoreItemsTry(input([piece('gemDiamond'), piece('gemRuby')]), RUSH_SCORE);
    expect(two).toMatchObject({ basePoints: 200, comboMultiplier: 1, total: 200, extras: [] });
    const three = scoreItemsTry(input([piece('gemDiamond'), piece('gemRuby'), piece('coin')], { difficulty: 'easy', dailyBonus: 1.5 }), RUSH_SCORE);
    // 205 × 0.8 = 164; handful ×1.25 = 205; daily ×1.5 = 308 (rounded)
    expect(three).toMatchObject({ base: 205, basePoints: 164, comboMultiplier: 1.25, total: 308 });
    expect(three.extras).toEqual([
      { key: 'handful', points: 41 },
      { key: 'daily', points: 103 },
    ]);
    expect(rushModule.scoreTry!(input([piece('gemEmerald')]), rushModule.defaults).total).toBe(10);
  });

  it('the value table of section 3.3', () => {
    expect(RUSH_PIECES.map((p) => [p.look, p.value, p.count])).toEqual([
      ['gemEmerald', 10, 14],
      ['gemSapphire', 25, 10],
      ['gemRuby', 50, 6],
      ['gemDiamond', 150, 2],
      ['coin', 5, 12],
    ]);
  });

  it('a run ranks on its points without the daily bonus', () => {
    const tries = [[piece('gemDiamond'), piece('gemRuby'), piece('coin')], [], [piece('gemSapphire')]];
    // 205 × 1.25 = 256; 0; 25
    expect(runPoints(tries, 'arcade')).toBe(281);
    expect(runPoints([], 'arcade')).toBe(0);
  });
});

describe('session prizes', () => {
  const summary = (items: ScoredItem[], value = 0): SessionSummary => ({ machineId: 'shelf', sessionId: 1, tries: 5, items, value, lastRoundId: 9, reason: 'tries' });

  it('shelf: at least rewardItems boxes earn the rarest printed character, the earliest drop on a tie', () => {
    // A three-box threshold keeps the cases short; the default (5) is checked below.
    const p = { ...SHELF_DEFAULTS, rewardItems: 3 };
    expect(shelfModule.sessionReward!(summary([snack('sakura.biribi'), snack('sakura.bunny')]), p, [])).toBeNull();
    // Items carry their drop order (`index`); two rare prints tie, the earlier drop wins.
    const c = snack('sakura.bunny');
    const a = snack('sakura.tanuki');
    const b = snack('sakura.sakuracat');
    expect(shelfModule.sessionReward!(summary([c, a, b]), p, [])).toEqual({ typeId: 'sakura.tanuki' });
    const c2 = snack('sakura.bunny');
    const b2 = snack('sakura.sakuracat');
    const a2 = snack('sakura.tanuki');
    expect(shelfModule.sessionReward!(summary([c2, b2, a2]), p, [])).toEqual({ typeId: 'sakura.sakuracat' });
    expect(shelfModule.sessionReward!(summary([c, a, snack('sakura.biribi', 'snackL')]), p, [])).toEqual({ typeId: 'sakura.biribi' });
    expect(shelfModule.sessionReward!(summary([c, a, b]), { ...p, rewardItems: 4 }, [])).toBeNull();
    expect(SHELF_DEFAULTS.rewardItems).toBe(5);
    expect(shelfModule.sessionReward!(summary([c, a, b]), SHELF_DEFAULTS, [])).toBeNull();
    expect(rarestPrint([])).toBeNull();
  });

  it('rush: the raw value sets the tier band; the first character of that tier in the given order wins', () => {
    expect(rewardTier(449, 450)).toBeNull();
    expect(rewardTier(450, 450)).toBe('common');
    expect(rewardTier(675, 450)).toBe('rare');
    expect(rewardTier(900, 450)).toBe('epic');
    expect(rewardTier(1350, 450)).toBe('legendary');
    expect(rewardTier(5000, 0)).toBeNull();
    // The app orders the characters least-collected first (ties in manifest order).
    const prints = [
      { id: 'sakura.capybara', tier: 'common' as const },
      { id: 'sakura.bunny', tier: 'common' as const },
      { id: 'sakura.tanuki', tier: 'rare' as const },
      { id: 'sakura.sakuracat', tier: 'rare' as const },
      { id: 'sakura.monster', tier: 'epic' as const },
    ];
    const p = { rewardValue: 400 };
    expect(rushReward({ value: 399 }, p, prints)).toBeNull();
    expect(rushReward({ value: 400 }, p, prints)).toEqual({ typeId: 'sakura.capybara' });
    expect(rushReward({ value: 600 }, p, prints)).toEqual({ typeId: 'sakura.tanuki' });
    expect(rushReward({ value: 800 }, p, prints)).toEqual({ typeId: 'sakura.monster' });
    // No legendary character offered: the next lower tier.
    expect(rushReward({ value: 1200 }, p, prints)).toEqual({ typeId: 'sakura.monster' });
    expect(rushReward({ value: 9999 }, { rewardValue: 0 }, prints)).toBeNull();
    // Default threshold 700 (sweep with the scoop: 27 % of 48 Arcade runs reach it).
    expect(rushModule.defaults.rewardValue).toBe(700);
    expect(rushModule.sessionReward!({ ...summary([]), value: 699 }, rushModule.defaults, prints)).toBeNull();
    expect(rushModule.sessionReward!({ ...summary([]), value: 700 }, rushModule.defaults, prints)).toEqual({ typeId: 'sakura.capybara' });
  });
});

describe('local top 10 (data shape)', () => {
  const entry = (score: number, at: number, initials = 'AAA'): RankEntry => ({ initials, score, at, difficulty: 'arcade' });

  it('orders by score, keeps the older entry first on a tie and holds at most ten', () => {
    let list: RankEntry[] = [];
    for (let i = 0; i < 12; i++) list = insertRank(list, entry(100 + 10 * (i % 6), i)).entries;
    expect(list).toHaveLength(RANK_SIZE);
    expect(list.map((e) => e.score)).toEqual([150, 150, 140, 140, 130, 130, 120, 120, 110, 110]);
    expect(list[0]!.at).toBe(5);
    expect(list[1]!.at).toBe(11);
    // 110 ties the last two places: the older entries stay ahead, so a new 110 does not make it.
    expect(rankPosition(list, 110)).toBeNull();
    expect(rankPosition(list, 111)).toBe(9);
    expect(rankPosition(list, 999)).toBe(1);
    expect(rankPosition([], 0)).toBeNull();
    const { position, entries } = insertRank(list, entry(145, 20, 'ZZZ'));
    expect(position).toBe(3);
    expect(entries[2]!.initials).toBe('ZZZ');
    expect(insertRank(list, entry(50, 30)).position).toBeNull();
  });

  it('initials are three letters A-Z', () => {
    expect(INITIALS_PATTERN.test('ABC')).toBe(true);
    for (const bad of ['AB', 'ABCD', 'abc', 'A1C', '???', '']) expect(INITIALS_PATTERN.test(bad), bad).toBe(false);
  });
});

describe('field helpers', () => {
  it('scales the rush mix to the pieces setting, always with a diamond', () => {
    expect(pieceCounts(44)).toEqual([14, 10, 6, 2, 12]);
    for (const n of [24, 30, 36, 48, 10, 99]) {
      const counts = pieceCounts(n);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(Math.min(48, Math.max(24, n)));
      expect(counts[3]).toBeGreaterThanOrEqual(1);
    }
    expect(scaleMix([5, 2, 1], 8, [1, 0, 0])).toEqual([5, 2, 1]);
    expect(scaleMix([5, 2, 1], 3, [1, 0, 0]).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('lays out 8 stacks, 5 small, 2 medium and 1 large (S / M three high, L two high)', () => {
    const plan = stackPlan(SHELF_DEFAULTS, makeRng(3));
    expect(plan).toHaveLength(8);
    const by = (look: string) => plan.filter((s) => s.kind.look === look);
    expect([by('snackS').length, by('snackM').length, by('snackL').length]).toEqual([5, 2, 1]);
    expect(plan.reduce((n, s) => n + s.height, 0)).toBe(23);
    for (const s of plan) expect(s.height).toBe(s.kind.look === 'snackL' ? 2 : 3);
    // Seeded: the same seed gives the same plan, another seed another one.
    expect(stackPlan(SHELF_DEFAULTS, makeRng(3)).map((s) => s.kind.look)).toEqual(plan.map((s) => s.kind.look));
    const looks = new Set([1, 2, 4, 5, 6, 7].map((seed) => stackPlan(SHELF_DEFAULTS, makeRng(seed)).map((s) => s.kind.look).join()));
    expect(looks.size).toBeGreaterThan(1);
  });

  it('cycles evenly through the characters of the allowed tiers (any character when none fits)', () => {
    const assets = themeAssets('sakura');
    const pool = new PrintPool(assets, ['common', 'rare'], makeRng(9));
    const drawn = Array.from({ length: 8 }, () => pool.next()!);
    for (const id of drawn) expect(['common', 'rare']).toContain(rarityOf(id));
    // Two full cycles of the four common / rare characters: each exactly twice.
    const counts = new Map<string, number>();
    for (const id of drawn) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.values()]).toEqual([2, 2, 2, 2]);
    const fallback = new PrintPool(assets.filter((a) => rarityOf(a.id) === 'common'), ['legendary'], makeRng(1));
    expect(rarityOf(fallback.next())).toBe('common');
    expect(new PrintPool([], ['common'], makeRng(1)).next()).toBeNull();
  });
});
