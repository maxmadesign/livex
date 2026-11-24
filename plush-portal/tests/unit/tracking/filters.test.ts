import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import type { Vec3 } from '../../../src/core/types';
import { DeadZone, MeasurementFilter, OneEuroFilter, OutlierGate, lowPassAlpha } from '../../../src/tracking/filters';

/** Runs a One Euro filter over signal(t) sampled at the given times and returns the output at each time. */
function run(filter: OneEuroFilter, times: number[], signal: (t: number) => number): number[] {
  return times.map((t) => filter.filter(signal(t), t));
}
const regular = (hz: number, seconds: number) => Array.from({ length: Math.floor(hz * seconds) + 1 }, (_, i) => i / hz);
const valueAt = (times: number[], values: number[], t: number) => {
  // linear interpolation between samples
  let i = times.findIndex((x) => x >= t);
  if (i <= 0) return values[Math.max(0, i)]!;
  const a = (t - times[i - 1]!) / (times[i]! - times[i - 1]!);
  return values[i - 1]! + (values[i]! - values[i - 1]!) * a;
};

describe('lowPassAlpha', () => {
  it('is between 0 and 1 and grows with the time step', () => {
    expect(lowPassAlpha(1, 0.001)).toBeGreaterThan(0);
    expect(lowPassAlpha(1, 0.001)).toBeLessThan(lowPassAlpha(1, 0.1));
    expect(lowPassAlpha(1, 100)).toBeLessThan(1);
  });
  it('two half steps equal one full step to first order (rate independence)', () => {
    const a1 = lowPassAlpha(2, 1 / 30);
    const a2 = lowPassAlpha(2, 1 / 60);
    expect(1 - (1 - a2) * (1 - a2)).toBeCloseTo(a1, 1);
  });
});

describe('OneEuroFilter', () => {
  it('passes the first sample through and converges to a constant', () => {
    const f = new OneEuroFilter(1.4, 6);
    expect(f.filter(0.3, 0)).toBe(0.3);
    let v = 0;
    for (let i = 1; i < 200; i++) v = f.filter(0.5, i / 30);
    expect(v).toBeCloseTo(0.5, 6);
  });

  it('responds the same way at 15 Hz, 30 Hz and 60 Hz (frame-rate independent)', () => {
    // A smooth sideways step of 20 cm that takes 0.4 s, then rest.
    const signal = (t: number) => {
      const x = Math.min(1, Math.max(0, (t - 0.5) / 0.4));
      return 0.2 * x * x * (3 - 2 * x);
    };
    const results = [15, 30, 60].map((hz) => {
      const times = regular(hz, 2.5);
      return { times, values: run(new OneEuroFilter(1.4, 6), times, signal) };
    });
    for (const t of [0.6, 0.75, 0.9, 1.1, 1.5, 2.2]) {
      const samples = results.map((r) => valueAt(r.times, r.values, t));
      const spread = Math.max(...samples) - Math.min(...samples);
      // Within 6 mm of each other during the move, sub-millimetre once settled.
      expect(spread).toBeLessThan(t > 1.4 ? 0.001 : 0.006);
    }
  });

  it('gives the same result for irregular sample times', () => {
    const rng = makeRng(11);
    const signal = (t: number) => 0.15 * Math.sin(t * 1.3);
    const irregular: number[] = [0];
    while (irregular[irregular.length - 1]! < 6) irregular.push(irregular[irregular.length - 1]! + 0.035 + rng() * 0.06);
    const a = run(new OneEuroFilter(1.4, 6), irregular, signal);
    const times = regular(18, 6);
    const b = run(new OneEuroFilter(1.4, 6), times, signal);
    for (const t of [2, 3.3, 4.1, 5.5]) {
      expect(Math.abs(valueAt(irregular, a, t) - valueAt(times, b, t))).toBeLessThan(0.004);
    }
  });

  it('suppresses jitter at rest but follows fast motion with little lag', () => {
    const rng = makeRng(5);
    const times = regular(18, 4);
    // 2 mm RMS-ish noise around a fixed position.
    const noisy = times.map(() => 0.1 + (rng() - 0.5) * 0.004);
    const f = new OneEuroFilter(1.4, 6);
    const out = times.map((t, i) => f.filter(noisy[i]!, t));
    const tail = out.slice(20);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const rmsOut = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    const rmsIn = Math.sqrt(noisy.slice(20).reduce((a, b) => a + (b - 0.1) ** 2, 0) / tail.length);
    expect(rmsOut).toBeLessThan(rmsIn * 0.6);

    // Constant 0.5 m/s sweep: the adaptive cutoff keeps the lag well below the at-rest time constant.
    const g = new OneEuroFilter(1.4, 6);
    let lag = 0;
    for (const t of regular(18, 2)) lag = 0.5 * t - g.filter(0.5 * t, t);
    const restTau = 1 / (2 * Math.PI * 1.4);
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(0.5 * restTau * 0.5);
    expect(g.velocity()).toBeGreaterThan(0.45);
  });

  it('ignores duplicate timestamps and can be re-seeded', () => {
    const f = new OneEuroFilter();
    f.filter(1, 1);
    const a = f.filter(2, 1.05);
    expect(f.filter(50, 1.05)).toBe(a);
    f.snap(7, 2);
    expect(f.current()).toBe(7);
    expect(f.velocity()).toBe(0);
    f.reset();
    expect(f.filter(3, 9)).toBe(3);
  });
});

describe('OutlierGate', () => {
  it('accepts normal movement', () => {
    const gate = new OutlierGate();
    let x = 0;
    for (let i = 0; i < 100; i++) {
      x += 0.02; // 2 cm per sample at 18 Hz = 0.36 m/s
      expect(gate.check(i * 55, [x, 0, 0.8])).toBe('accept');
    }
  });

  it('rejects a single-sample glitch and carries on', () => {
    const gate = new OutlierGate();
    expect(gate.check(0, [0, 0, 0.8])).toBe('accept');
    expect(gate.check(55, [0.01, 0, 0.8])).toBe('accept');
    expect(gate.check(110, [0.9, 0.2, 0.5])).toBe('reject');
    expect(gate.check(165, [0.02, 0, 0.8])).toBe('accept');
    // Two unrelated glitches in a row are both rejected (they do not agree with each other).
    expect(gate.check(220, [0.9, 0.2, 0.5])).toBe('reject');
    expect(gate.check(275, [-0.9, 0.2, 1.5])).toBe('reject');
    expect(gate.check(330, [0.03, 0, 0.8])).toBe('accept');
  });

  it('accepts a jump once it persists (and reports where it settled)', () => {
    const gate = new OutlierGate();
    gate.check(0, [0, 0, 0.8]);
    const decisions: string[] = [];
    for (let i = 1; i <= 6; i++) decisions.push(gate.check(i * 55, [0.6 + i * 0.001, 0, 0.8]));
    const jumpAt = decisions.indexOf('jump');
    expect(jumpAt).toBeGreaterThanOrEqual(2); // at least 3 consistent samples
    expect(decisions.slice(0, jumpAt).every((d) => d === 'reject')).toBe(true);
    expect((jumpAt + 1 - 1) * 55).toBeGreaterThanOrEqual(gate.persistMs - 55);
    expect(gate.jumpTarget()[0]).toBeGreaterThan(0.59);
    expect(decisions.slice(jumpAt + 1).every((d) => d === 'accept')).toBe(true);
  });

  it('does not treat a long gap between samples as a jump', () => {
    const gate = new OutlierGate();
    gate.check(0, [0, 0, 0.8]);
    // 0.8 m in 1 s is ordinary walking speed.
    expect(gate.check(1000, [0.8, 0, 0.8])).toBe('accept');
  });
});

describe('DeadZone', () => {
  it('holds still inside the radius and follows outside with at most `radius` offset', () => {
    const dz = new DeadZone();
    const out: Vec3 = [0, 0, 0];
    dz.apply([0, 0, 0], 0.002, out);
    dz.apply([0.0015, 0, 0], 0.002, out);
    expect(out).toEqual([0, 0, 0]);
    dz.apply([0.01, 0, 0], 0.002, out);
    expect(out[0]).toBeCloseTo(0.008, 9);
    // Moving back inside the ball around the new output does nothing.
    dz.apply([0.0085, 0.001, 0], 0.002, out);
    expect(out[0]).toBeCloseTo(0.008, 9);
    // radius 0 is a pass-through
    dz.apply([0.5, 0.5, 0.5], 0, out);
    expect(out).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('MeasurementFilter', () => {
  const config = { minCutoff: 1.4, beta: 6, deadzoneM: 0.002, outlierM: 0.35 };

  it('filters, rejects glitches and snaps on persistent jumps', () => {
    const filter = new MeasurementFilter(config);
    const out: Vec3 = [0, 0, 0];
    expect(filter.push(0, [0, 0.5, 0.9], out)).toBe('ok');
    expect(out).toEqual([0, 0.5, 0.9]);
    expect(filter.push(55, [0.004, 0.5, 0.9], out)).toBe('ok');
    const before: Vec3 = [...out];
    expect(filter.push(110, [1.2, 0.1, 0.4], out)).toBe('rejected');
    expect(out).toEqual(before); // untouched
    let result = '';
    for (let i = 3; i < 10 && result !== 'jump'; i++) result = filter.push(i * 55, [0.7, 0.5, 0.9], out);
    expect(result).toBe('jump');
    expect(out[0]).toBeCloseTo(0.7, 6);
    expect(filter.push(600, [0.702, 0.5, 0.9], out)).toBe('ok');
    expect(Math.abs(out[0] - 0.7)).toBeLessThan(0.003);
  });

  it('removes jitter of a still head', () => {
    const rng = makeRng(9);
    const filter = new MeasurementFilter(config);
    const out: Vec3 = [0, 0, 0];
    const xs: number[] = [];
    for (let i = 0; i < 120; i++) {
      filter.push(i * 55, [0.1 + (rng() - 0.5) * 0.003, 0.5 + (rng() - 0.5) * 0.003, 0.9 + (rng() - 0.5) * 0.01], out);
      if (i > 30) xs.push(out[0]);
    }
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeLessThan(0.0015);
  });

  it('reset forgets the reference so a new player is accepted immediately', () => {
    const filter = new MeasurementFilter(config);
    const out: Vec3 = [0, 0, 0];
    filter.push(0, [0, 0.5, 0.9], out);
    filter.reset();
    expect(filter.push(55, [0.9, 0.2, 1.6], out)).toBe('ok');
    expect(out).toEqual([0.9, 0.2, 1.6]);
  });
});
