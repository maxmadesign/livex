import { afterEach, describe, expect, it } from 'vitest';
import type { GameCore } from '../../../src/game/GameCore';
import { isFreeSpot } from '../../../src/game/ToyField';
import { CHUTE, FIELD } from '../../../src/physics/fieldSpec';
import { comOf, idle, inspectWorld, loadManifest, makeCore, themeAssets } from './harness';

const cores: GameCore[] = [];
async function core(options: Parameters<typeof makeCore>[0] = {}): Promise<GameCore> {
  const c = await makeCore(options);
  cores.push(c);
  return c;
}
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

function poses(c: GameCore): number[] {
  const out: number[] = [];
  for (const toy of c.phys.toys.values()) {
    const t = toy.body.translation();
    out.push(t.x, t.y, t.z);
  }
  return out;
}

describe('ToyField', () => {
  it('the manifest offers four themes with at least six characters each', () => {
    const manifest = loadManifest();
    for (const theme of ['sakura', 'storybook', 'ocean', 'cosmic'] as const) {
      const assets = themeAssets(theme);
      expect(assets.length, theme).toBeGreaterThanOrEqual(6);
      expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
    }
    expect(new Set(manifest.assets.map((a) => a.id)).size).toBe(manifest.assets.length);
  });

  it.each(['sakura', 'storybook', 'ocean', 'cosmic'] as const)(
    '%s: lays out the default field inside the cabinet, clear of the exit, with an even character mix',
    async (theme) => {
      const c = await core({ theme, seed: 3 });
      const toys = c.field.onField();
      expect(toys).toHaveLength(18);
      expect(c.field.inBin()).toHaveLength(0);
      expect(c.field.missing()).toBe(0);
      expect(inspectWorld(c)).toEqual([]);
      const perType = new Map<string, number>();
      for (const toy of toys) {
        const p = comOf(toy);
        // Resting on the mat, inside the walls, not over the exit.
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(0.2);
        expect(Math.abs(p.x)).toBeLessThan(FIELD.halfWidth - 0.04);
        expect(p.z).toBeLessThan(-0.04);
        expect(p.z).toBeGreaterThan(-FIELD.depth + 0.04);
        expect(p.x < CHUTE.xMax && p.z > CHUTE.zMin).toBe(false);
        // Still standing roughly upright after settling (a tidy field, not a heap).
        const r = toy.body.rotation();
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        expect(upY, toy.asset.id).toBeGreaterThan(0.75);
        perType.set(toy.asset.id, (perType.get(toy.asset.id) ?? 0) + 1);
      }
      // Every character of the theme is present, none dominates.
      const kinds = themeAssets(theme).length;
      expect(perType.size).toBe(kinds);
      expect(Math.max(...perType.values()) - Math.min(...perType.values())).toBeLessThanOrEqual(1);
      // At rest when the player first sees it: nothing is falling or sliding, and the
      // last faint rocking of a round-bottomed toy dies within a moment.
      expect(c.phys.maxToySpeed()).toBeLessThan(0.15);
      idle(c, 2);
      expect(c.phys.maxToySpeed()).toBeLessThan(0.02);
      expect(toys.map((t) => comOf(t).y).every((y) => y > 0 && y < 0.2)).toBe(true);
    },
    60_000,
  );

  it('is reproducible from the seed and different for another seed', async () => {
    const a = await core({ seed: 5 });
    const b = await core({ seed: 5 });
    const other = await core({ seed: 6 });
    expect(poses(a)).toEqual(poses(b));
    expect(poses(a)).not.toEqual(poses(other));
    expect([...a.phys.toys.values()].map((t) => t.asset.id)).toEqual([...b.phys.toys.values()].map((t) => t.asset.id));
  }, 60_000);

  it('honours count, scale and density', async () => {
    const few = await core({ count: 8 });
    expect(few.field.onField()).toHaveLength(8);
    const big = await core({ count: 10, scale: 1.15 });
    expect(big.field.onField()).toHaveLength(10);
    for (const toy of big.field.onField()) expect(toy.scale).toBeCloseTo(1.15, 6);
    // A dense field stacks a second layer; nothing leaves the cabinet while it settles.
    // The largest, densest field the settings allow stacks a second layer. Every toy
    // must end up inside the cabinet (none stranded above the ceiling or in the exit).
    for (const scale of [0.92, 1.25]) {
      const dense = await core({ count: 30, density: 1, scale });
      idle(dense, 2);
      expect(dense.phys.toys.size).toBe(30);
      expect(inspectWorld(dense)).toEqual([]);
      const ys = [...dense.phys.toys.values()].map((t) => comOf(t).y);
      expect(Math.max(...ys)).toBeLessThan(0.5);
      expect(ys.filter((y) => y > 0.13).length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('restocks one toy at a time up to the configured count and never beyond', async () => {
    const c = await core({ count: 12 });
    expect(c.field.restockOne()).toBeNull();
    const victims = c.field.onField().slice(0, 2);
    for (const toy of victims) toy.inBin = true;
    expect(c.field.inBin()).toHaveLength(2);
    expect(c.field.missing()).toBe(2);
    const removed = c.field.clearBin();
    expect(removed).toEqual(victims);
    expect(c.phys.toys.size).toBe(10);
    const first = c.field.restockOne();
    expect(first).not.toBeNull();
    const p = first!.body.translation();
    expect(p.y).toBeGreaterThan(0.4); // comes down from the hatch, it does not pop up on the mat
    expect(isFreeSpot(p.x, p.z, 0.05)).toBe(true);
    expect(c.field.restockOne()).not.toBeNull();
    expect(c.field.restockOne()).toBeNull();
    idle(c, 2.5);
    expect(c.field.onField()).toHaveLength(12);
    expect(c.field.missing()).toBe(0);
    expect(inspectWorld(c)).toEqual([]);
    for (const toy of c.field.onField()) expect(comOf(toy).y).toBeLessThan(0.3);
  }, 60_000);

  it('rebuilding the field replaces every toy and frees the old bodies', async () => {
    const c = await core({ count: 14 });
    const bodies = c.phys.world.bodies.len();
    const colliders = c.phys.world.colliders.len();
    const oldIds = new Set([...c.phys.toys.keys()]);
    for (let i = 0; i < 4; i++) c.populate(themeAssets('ocean'), 40 + i);
    expect(c.phys.toys.size).toBe(14);
    expect(c.phys.world.bodies.len()).toBe(bodies);
    for (const id of c.phys.toys.keys()) expect(oldIds.has(id)).toBe(false);
    for (const toy of c.phys.toys.values()) expect(toy.asset.theme).toBe('ocean');
    // Collider count depends on the characters' proxy parts, but must not grow from rebuild to rebuild.
    c.populate(themeAssets('ocean'), 40);
    const once = c.phys.world.colliders.len();
    c.populate(themeAssets('ocean'), 40);
    expect(c.phys.world.colliders.len()).toBe(once);
    expect(colliders).toBeGreaterThan(0);
    // An empty character list leaves an empty, playable field instead of throwing.
    c.populate([], 1);
    expect(c.phys.toys.size).toBe(0);
    expect(c.field.restockOne()).toBeNull();
  }, 60_000);

  it('isFreeSpot keeps clear of walls and the exit guard', () => {
    expect(isFreeSpot(0.1, -0.4, 0.07)).toBe(true);
    expect(isFreeSpot(FIELD.halfWidth - 0.03, -0.4, 0.07)).toBe(false);
    expect(isFreeSpot(0.1, -0.02, 0.07)).toBe(false);
    expect(isFreeSpot(0.1, -FIELD.depth + 0.02, 0.07)).toBe(false);
    expect(isFreeSpot((CHUTE.xMin + CHUTE.xMax) / 2, (CHUTE.zMin + CHUTE.zMax) / 2, 0.05)).toBe(false);
    expect(isFreeSpot(CHUTE.xMax + 0.05, CHUTE.zMin + 0.1, 0.07)).toBe(false);
    expect(isFreeSpot(CHUTE.xMax + 0.12, CHUTE.zMin + 0.1, 0.07)).toBe(true);
  });
});
