import { DoubleSide } from 'three';
import { describe, expect, it } from 'vitest';
import { Effects } from '../../../src/scene/Effects';
import { ParticlePool, ParticleSpec } from '../../../src/scene/fx/ParticlePool';
import { ADDITIVE_IMMEDIATE, ADDITIVE_POOL, NORMAL_IMMEDIATE, NORMAL_POOL } from '../../../src/scene/fx/constants';
import type { FxBurstKind } from '../../../src/scene/fx/api';
import { EXIT, PRESETS, internals, makeFx, run } from './helpers';

const KINDS: FxBurstKind[] = ['grab', 'contact', 'lift', 'slip', 'drop', 'restock', 'combo', 'score', 'cta'];

describe('fx pooling', () => {
  it('pools and instance buffers never grow, however many bursts are fired', () => {
    const fx = makeFx({ theme: 'cosmic', ...{ budget: PRESETS.ultra.budget, intensity: PRESETS.ultra.intensity } });
    fx.lightShow('attract');
    const before = fx.storage();
    const buffers = [...before.buffers];
    const lengths = buffers.map((b) => b.length);
    let maxLive = 0;
    let maxInstances = 0;
    for (let round = 0; round < 60; round++) {
      for (const kind of KINDS) fx.burst(kind, { x: -0.3 + round * 0.01, y: 0.3, z: -0.3 }, { tier: 'legendary', scale: 3 });
      fx.celebrate('legendary', EXIT);
      fx.aura({ x: 0, y: 0.5, z: -0.4 }, 'legendary');
      run(fx, 0.1, () => {
        const s = fx.fxState();
        maxLive = Math.max(maxLive, s.live);
        maxInstances = Math.max(maxInstances, s.instances);
      });
    }
    const after = fx.storage();
    expect(after.capacity).toBe(before.capacity);
    expect(after.capacity).toBe(ADDITIVE_POOL + NORMAL_POOL);
    expect(after.batchCapacity).toBe(ADDITIVE_POOL + ADDITIVE_IMMEDIATE + NORMAL_POOL + NORMAL_IMMEDIATE);
    after.buffers.forEach((b, i) => {
      expect(b).toBe(buffers[i]);
      expect(b.length).toBe(lengths[i]);
    });
    expect(maxLive).toBeLessThanOrEqual(after.capacity);
    expect(maxInstances).toBeLessThanOrEqual(after.batchCapacity);
    // The pools saturated and refused spawns instead of growing.
    expect(fx.fxState().dropped).toBeGreaterThan(0);
    expect(fx.fxState().drawCalls).toBeLessThanOrEqual(2);
    fx.dispose();
  });

  it('everything drains again once the bursts stop (only ambient motes remain)', () => {
    const fx = makeFx({ budget: 60 });
    for (let i = 0; i < 20; i++) {
      for (const kind of KINDS) fx.burst(kind, { x: 0, y: 0.3, z: -0.3 });
      fx.celebrate('legendary', EXIT);
      run(fx, 0.05);
    }
    expect(fx.liveCount()).toBeGreaterThan(200);
    run(fx, 15);
    const families = fx.familyCounts();
    const nonAmbient = Object.entries(families).filter(([k]) => k !== 'ambient').reduce((a, [, v]) => a + v, 0);
    expect(nonAmbient).toBe(0);
    expect(families.ambient).toBeLessThanOrEqual(Math.round(60 * 0.22));
    expect(fx.fxState().emitters).toBe(0);
    fx.dispose();
  });

  it('a full pool drops spawns and counts them; removal keeps live particles dense', () => {
    const pool = new ParticlePool(8);
    const spec = new ParticleSpec();
    for (let i = 0; i < 12; i++) {
      spec.reset();
      spec.life = 0.1 + i * 0.1;
      spec.y = 0.5;
      pool.emit(spec, i);
    }
    expect(pool.count).toBe(8);
    expect(pool.dropped).toBe(4);
    // Lives 0.1 … 0.8: after 0.35 s the first three are gone and the rest are packed at the front.
    pool.simulate(0.35, 0);
    expect(pool.count).toBe(5);
    const lives = Array.from(pool.life.subarray(0, pool.count)).sort((a, b) => a - b);
    expect(lives[0]).toBeCloseTo(0.05, 5);
    expect(lives[4]).toBeCloseTo(0.45, 5);
  });

  it('works without a theme, ignores invalid positions and survives dispose', () => {
    const fx = new Effects();
    fx.update(1 / 60);
    const before = fx.liveCount(); // possibly one ambient mote
    fx.burst('grab', { x: Number.NaN, y: 0, z: 0 });
    fx.celebrate('epic', { x: 0, y: Number.POSITIVE_INFINITY, z: 0 });
    expect(fx.liveCount()).toBe(before);
    fx.burst('grab', { x: 0, y: 0.4, z: -0.3 }, { color: 'not-a-colour' });
    fx.burst('score', { x: 0, y: 0.4, z: -0.3 }, { scale: Number.NaN });
    expect(fx.liveCount()).toBeGreaterThan(before);
    fx.update(Number.NaN);
    fx.update(-1);
    fx.dispose();
  });

  it('draws with at most two draw calls (additive light + paper) and one shared shader', () => {
    const fx = makeFx({ theme: 'storybook' });
    fx.lightShow('attract');
    fx.celebrate('legendary', EXIT);
    fx.setAim(true, 0, -0.3, 0.1, 0.8);
    fx.aura({ x: 0.1, y: 0.5, z: -0.3 }, 'epic');
    run(fx, 0.5);
    const s = fx.fxState();
    expect(s.drawCalls).toBe(2);
    const { addBatch, normBatch } = internals(fx);
    expect(addBatch.material.vertexShader).toBe(normBatch.material.vertexShader);
    expect(addBatch.material.fragmentShader).toBe(normBatch.material.fragmentShader);
    // Flat rings seen from above and half of the axial streaks have clockwise winding on screen.
    expect(addBatch.material.side).toBe(DoubleSide);
    expect(normBatch.material.side).toBe(DoubleSide);
    // Only the effect meshes are in the group: no per-effect objects are created.
    expect(fx.group.children.length).toBe(2);
    fx.dispose();
  });

  it('paper sprites are opaque; light sprites hide at most part of the background', () => {
    const fx = makeFx({ theme: 'storybook' });
    fx.lightShow('jackpot');
    fx.celebrate('legendary', EXIT);
    fx.setAim(true, 0, -0.3, 0.1, 0.8);
    run(fx, 0.6);
    const { addBatch, normBatch } = internals(fx);
    const coverOf = (batch: typeof addBatch) => {
      const meta = batch.buffers()[3]!;
      const out: number[] = [];
      for (let i = 0; i < batch.n; i++) out.push(meta[i * 3 + 2]!);
      return out;
    };
    const paper = coverOf(normBatch);
    const light = coverOf(addBatch);
    expect(paper.length).toBeGreaterThan(0);
    expect(paper.every((c) => c === 1)).toBe(true);
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((c) => c >= 0 && c < 0.6)).toBe(true);
    // The aim helpers stay purely additive, as before.
    expect(light.filter((c) => c === 0).length).toBeGreaterThanOrEqual(3);
    fx.dispose();
  });

  it('the aim reticle and beam are drawn inside the additive batch', () => {
    const fx = makeFx({ budget: 0 });
    fx.setAim(true, 0.1, -0.3, 0.12, 0.8);
    fx.update(1 / 60);
    // Ring + dot + beam.
    expect(fx.fxState().instances).toBe(3);
    expect(fx.fxState().drawCalls).toBe(1);
    fx.showBeam = false;
    fx.setAim(true, 0.1, -0.3, 0.12, 0.8);
    fx.update(1 / 60);
    expect(fx.fxState().instances).toBe(2);
    fx.setAim(false, 0, 0, 0, 0);
    fx.update(1 / 60);
    expect(fx.fxState().instances).toBe(0);
    expect(fx.fxState().drawCalls).toBe(0);
    fx.dispose();
  });
});
