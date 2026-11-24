import { describe, expect, it } from 'vitest';
import { ambientTarget, lightScale, particleScale, scaledCount } from '../../../src/scene/fx/budget';
import { MODE, SHAPE, spriteCode } from '../../../src/scene/fx/constants';
import { EXIT, PRESETS, additiveAlphas, makeFx, run } from './helpers';

const BEAM = spriteCode(SHAPE.BEAM, MODE.AXIAL);
const FLASH = spriteCode(SHAPE.FLASH, MODE.BILLBOARD);

function spawnedBy(opts: Parameters<typeof makeFx>[0], act: (fx: ReturnType<typeof makeFx>) => void): number {
  const fx = makeFx(opts);
  act(fx);
  const n = fx.liveCount();
  fx.dispose();
  return n;
}

describe('fx budgets', () => {
  it('scale follows the decor budget, the intensity and reduced motion', () => {
    expect(particleScale(60, 1, false)).toBeCloseTo(1, 6);
    expect(particleScale(20, 0.5, false)).toBeCloseTo(0.26, 2);
    expect(particleScale(150, 1.2, false)).toBeCloseTo(2.08, 2);
    expect(particleScale(300, 1.5, false)).toBeCloseTo(3.94, 2);
    expect(particleScale(60, 1, true)).toBeCloseTo(0.4, 6);
    expect(particleScale(0, 1, false)).toBe(0);
    expect(particleScale(60, 0, false)).toBe(0);
    expect(particleScale(9999, 99, false)).toBeCloseTo(particleScale(300, 1.5, false), 6);
    expect(scaledCount(10, 0)).toBe(0);
    expect(scaledCount(10, 0.01)).toBe(1);
    expect(scaledCount(10, 2.04)).toBe(20);
    expect(lightScale(0)).toBe(0);
    expect(lightScale(1)).toBe(1);
    expect(lightScale(1.5)).toBe(1.25);
    expect(ambientTarget(300, false)).toBe(40);
    expect(ambientTarget(300, true)).toBe(6);
  });

  it('celebrations use more particles at higher intensity', () => {
    const at = (intensity: number) => spawnedBy({ intensity }, (fx) => fx.celebrate('epic', EXIT));
    const low = at(0.5);
    const mid = at(1);
    const high = at(1.5);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(mid / low).toBeGreaterThan(1.6);
    expect(high / mid).toBeGreaterThan(1.3);
  });

  it('celebrations follow the graphics tier (decor budget and intensity of each preset)', () => {
    const counts = Object.values(PRESETS).map((p) => spawnedBy(p, (fx) => fx.celebrate('legendary', EXIT)));
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
    // Safe stays small, Ultra stays inside the pools.
    expect(counts[0]).toBeLessThan(150);
    expect(counts[3]).toBeLessThan(2560 + 1280);
  });

  it('intensity 0 turns particles, beams, flashes and LED energy off', () => {
    const fx = makeFx({ intensity: 0 });
    fx.lightShow('attract');
    fx.celebrate('legendary', EXIT);
    for (const kind of ['grab', 'drop', 'score', 'cta'] as const) fx.burst(kind, { x: 0, y: 0.3, z: -0.3 });
    let seen = 0;
    run(fx, 3, () => {
      const s = fx.fxState();
      seen += s.beams + (s.flash ? 1 : 0) + s.ledEnergy;
      const families = fx.familyCounts();
      seen += Object.entries(families).filter(([k]) => k !== 'ambient').reduce((a, [, v]) => a + v, 0);
    });
    expect(seen).toBe(0);
    fx.dispose();
  });

  it('a decor budget of 0 keeps the light show but spawns no particles', () => {
    const fx = makeFx({ budget: 0 });
    fx.celebrate('epic', EXIT);
    run(fx, 1);
    expect(fx.familyCounts().confetti).toBe(0);
    expect(fx.familyCounts().sparkle).toBe(0);
    expect(fx.fxState().beams).toBeGreaterThan(0);
    fx.dispose();
  });

  it('light show disabled: celebrations still get particles, but no beams, flash or LED energy', () => {
    const fx = makeFx({ lightShow: false });
    fx.lightShow('attract');
    fx.celebrate('legendary', EXIT);
    let beams = 0;
    let flash = false;
    let led = 0;
    run(fx, 4.5, () => {
      const s = fx.fxState();
      beams += s.beams;
      flash ||= s.flash;
      led += s.ledEnergy;
      expect(s.lightShowActive).toBe('off');
    });
    expect(beams).toBe(0);
    expect(flash).toBe(false);
    expect(led).toBe(0);
    expect(fx.fxState().lightShow).toBe('attract');
    // Particles were there.
    const fx2 = makeFx({ lightShow: false });
    fx2.celebrate('legendary', EXIT);
    expect(fx2.liveCount()).toBeGreaterThan(200);
    fx.dispose();
    fx2.dispose();
  });

  it('burst scale multiplies the count of a burst', () => {
    const one = spawnedBy({}, (fx) => fx.burst('combo', { x: 0, y: 0.4, z: -0.3 }, { scale: 1 }));
    const three = spawnedBy({}, (fx) => fx.burst('combo', { x: 0, y: 0.4, z: -0.3 }, { scale: 3 }));
    expect(three).toBeGreaterThan(one * 2.5);
  });

  it('every burst kind produces something at the reference settings', () => {
    for (const kind of ['grab', 'contact', 'lift', 'slip', 'drop', 'restock', 'combo', 'score', 'cta'] as const) {
      const fx = makeFx();
      fx.burst(kind, { x: 0, y: 0.4, z: -0.3 }, { tier: 'rare' });
      run(fx, 0.3);
      expect(fx.liveCount() + fx.fxState().emitters, kind).toBeGreaterThan(0);
      fx.dispose();
    }
  });
});

describe('fx reduced motion', () => {
  it('uses fewer particles', () => {
    const normal = spawnedBy({}, (fx) => fx.celebrate('legendary', EXIT));
    const reduced = spawnedBy({ reducedMotion: true }, (fx) => fx.celebrate('legendary', EXIT));
    expect(reduced).toBeGreaterThan(0);
    expect(reduced / normal).toBeLessThan(0.5);
  });

  it('never flashes or strobes during a jackpot', () => {
    for (const reducedMotion of [false, true]) {
      const fx = makeFx({ reducedMotion });
      fx.lightShow('attract');
      fx.celebrate('legendary', EXIT);
      let flashes = 0;
      let maxJump = 0;
      let prev: number[] | null = null;
      run(fx, 4, (frame) => {
        flashes += additiveAlphas(fx, FLASH).length;
        const beams = additiveAlphas(fx, BEAM);
        if (frame > 60 && prev && prev.length === beams.length) {
          for (let i = 0; i < beams.length; i++) maxJump = Math.max(maxJump, Math.abs(beams[i]! - prev[i]!) / Math.max(1e-4, prev[i]!));
        }
        prev = beams;
      });
      if (reducedMotion) {
        expect(flashes).toBe(0);
        // Beam brightness only eases (a few % per frame), it never jumps.
        expect(maxJump).toBeLessThan(0.1);
      } else {
        expect(flashes).toBeGreaterThan(0);
        // With motion allowed the jackpot beams do alternate (at 3 Hz).
        expect(maxJump).toBeGreaterThan(1);
      }
      fx.dispose();
    }
  });

  it('flashes are rate limited to well under three per second', () => {
    const fx = makeFx();
    let flashStarts = 0;
    let wasVisible = false;
    run(fx, 2, (frame) => {
      if (frame % 6 === 0) fx.celebrate('rare', EXIT);
      const visible = additiveAlphas(fx, FLASH).some((a) => a > 0.2);
      if (visible && !wasVisible) flashStarts++;
      wasVisible = visible;
    });
    expect(flashStarts).toBeLessThanOrEqual(5);
    fx.dispose();
  });
});
