import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../../src/core/types';
import { FAMILY, MODE, SHAPE, spriteCode } from '../../../src/scene/fx/constants';
import { motifOf } from '../../../src/scene/fx/palette';
import type { FxTier } from '../../../src/scene/fx/api';
import { THEMES } from '../../../src/themes/themes';
import { EXIT, additiveColors, additivePositions, internals, makeFx, run } from './helpers';

const RING = spriteCode(SHAPE.RING, MODE.FLAT);
const RAINBOW = spriteCode(SHAPE.RAINBOW_RING, MODE.FLAT);
const STAR = spriteCode(SHAPE.STAR, MODE.BILLBOARD);
const HELD = { x: 0.1, y: 0.55, z: -0.35 };

function auraFor(tier: FxTier, reducedMotion = false) {
  const fx = makeFx({ budget: 0, reducedMotion });
  for (let i = 0; i < 30; i++) {
    fx.aura(HELD, tier);
    fx.update(1 / 60);
  }
  return fx;
}

describe('rarity aura', () => {
  it('is coloured by tier: common white, rare blue, epic purple, legendary rainbow', () => {
    const common = additiveColors(auraFor('common'), RING)[0]!;
    expect(Math.abs(common[0] - common[2])).toBeLessThan(0.05);
    const rare = additiveColors(auraFor('rare'), RING)[0]!;
    expect(rare[2]).toBeGreaterThan(rare[0] * 3);
    const epic = additiveColors(auraFor('epic'), RING)[0]!;
    expect(epic[0]).toBeGreaterThan(epic[1] * 3);
    expect(epic[2]).toBeGreaterThan(epic[1] * 3);
    const legendary = auraFor('legendary');
    expect(additiveColors(legendary, RAINBOW).length).toBeGreaterThanOrEqual(2);
    expect(additiveColors(legendary, RING).length).toBe(0);
  });

  it('has more orbiting sparkles for rarer toys and they circle the toy', () => {
    const counts = (['common', 'rare', 'epic', 'legendary'] as const).map((t) => additivePositions(auraFor(t), STAR).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
    const stars = additivePositions(auraFor('epic'), STAR);
    for (const [x, , z] of stars) expect(Math.hypot(x - HELD.x, z - HELD.z)).toBeLessThan(0.13);
    expect(auraFor('epic').fxState().aura).toBe('epic');
  });

  it('follows the toy and hides on null (or when the game stops calling it)', () => {
    const fx = auraFor('rare');
    fx.aura({ x: -0.2, y: 0.6, z: -0.5 }, 'rare');
    fx.update(1 / 60);
    const ring = additivePositions(fx, RING)[0]!;
    expect(ring[0]).toBeCloseTo(-0.2, 5);
    expect(ring[2]).toBeCloseTo(-0.5, 5);
    fx.aura(null);
    run(fx, 1);
    expect(fx.fxState().aura).toBeNull();
    expect(additivePositions(fx, RING).length).toBe(0);
    const stale = auraFor('epic');
    run(stale, 1.5);
    expect(stale.fxState().aura).toBeNull();
  });

  it('stands still with reduced motion', () => {
    const fx = auraFor('legendary', true);
    const a = additivePositions(fx, STAR);
    fx.aura(HELD, 'legendary');
    run(fx, 0.5, () => fx.aura(HELD, 'legendary'));
    const b = additivePositions(fx, STAR);
    expect(b).toEqual(a);
  });

  it('epic and legendary auras shed sparkle trails into the pool', () => {
    const fx = makeFx({ budget: 60 });
    run(fx, 1, () => fx.aura(HELD, 'legendary'));
    expect(fx.familyCounts().trail).toBeGreaterThan(3);
    fx.dispose();
  });
});

describe('theme motifs', () => {
  const expected: Record<string, number[]> = {
    sakura: [SHAPE.PETAL],
    storybook: [SHAPE.PAPER_STAR],
    ocean: [SHAPE.BUBBLE],
    cosmic: [SHAPE.GLOW, SHAPE.STAR],
    gpu: [SHAPE.PIXEL],
  };

  it('every theme has a motif (GPU Party: green data bits)', () => {
    expect(THEME_IDS.map((id) => motifOf(THEMES[id]))).toEqual(['petals', 'paper', 'bubbles', 'stardust', 'bits']);
  });

  for (const id of THEME_IDS) {
    it(`${id}: celebrations carry the theme motif`, () => {
      const fx = makeFx({ theme: id });
      fx.celebrate('common', EXIT);
      const { addPool, normPool } = internals(fx);
      const shapes = new Set<number>();
      for (const pool of [addPool, normPool]) for (let i = 0; i < pool.count; i++) if (pool.tag[i] === FAMILY.MOTIF) shapes.add(pool.shape[i]!);
      expect(shapes.size).toBeGreaterThan(0);
      for (const s of shapes) expect(expected[id]).toContain(s);
      fx.dispose();
    });
  }
});
