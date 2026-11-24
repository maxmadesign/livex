import { describe, expect, it } from 'vitest';
import type { ViewSource } from '../../../src/core/contracts';
import type { Vec3 } from '../../../src/core/types';
import { ViewpointController, type ViewpointConfig } from '../../../src/tracking/ViewpointController';

const NEUTRAL: Vec3 = [0, 0.5, 0.95];
const config: ViewpointConfig = { neutral: NEUTRAL, lostHoldMs: 700, returnMs: 1500, reacquireMs: 450, smoothMs: 70 };

interface Frame {
  t: number;
  eye: Vec3;
  source: ViewSource;
}

/**
 * Drives a controller: `samples(t)` returns the tracked viewpoint for an
 * inference captured at t (or null for "no face"), or undefined for "no
 * inference at this time". Rendering runs at `renderHz`.
 */
function simulate(
  controller: ViewpointController,
  fromMs: number,
  toMs: number,
  sample: (t: number) => Vec3 | null | undefined,
  options: { inferenceHz?: number; renderHz?: number; latencyMs?: number } = {},
): Frame[] {
  const inferenceDt = 1000 / (options.inferenceHz ?? 18);
  const renderDt = 1000 / (options.renderHz ?? 60);
  const latency = options.latencyMs ?? 30;
  const frames: Frame[] = [];
  let nextInference = fromMs;
  const pending: { due: number; t: number; eye: Vec3 | null }[] = [];
  for (let t = fromMs; t <= toMs; t += renderDt) {
    while (nextInference <= t) {
      const eye = sample(nextInference);
      if (eye !== undefined) pending.push({ due: nextInference + latency, t: nextInference, eye });
      nextInference += inferenceDt;
    }
    while (pending.length > 0 && pending[0]!.due <= t) {
      const p = pending.shift()!;
      if (p.eye) controller.pushSample(p.t, p.eye);
      else controller.pushMiss(p.t);
    }
    const out: Vec3 = [0, 0, 0];
    const source = controller.sample(t, out);
    frames.push({ t, eye: out, source });
  }
  return frames;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const maxStep = (frames: Frame[]) => {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) worst = Math.max(worst, dist(frames[i]!.eye, frames[i - 1]!.eye));
  return worst;
};
const at = (frames: Frame[], t: number) => frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best));
/** Linearly interpolated x position at time t. */
const xAt = (frames: Frame[], t: number) => {
  const i = frames.findIndex((f) => f.t >= t);
  if (i <= 0) return frames[Math.max(0, i)]!.eye[0];
  const a = frames[i - 1]!;
  const b = frames[i]!;
  return a.eye[0] + ((b.eye[0] - a.eye[0]) * (t - a.t)) / (b.t - a.t);
};

describe('ViewpointController', () => {
  it('returns the neutral viewpoint before anything is tracked', () => {
    const c = new ViewpointController(config);
    const out: Vec3 = [9, 9, 9];
    expect(c.sample(0, out)).toBe('neutral');
    expect(out).toEqual(NEUTRAL);
    expect(c.sample(5000, out)).toBe('neutral');
    expect(out).toEqual(NEUTRAL);
    expect(c.isLive).toBe(false);
  });

  it('blends onto the first estimate instead of jumping', () => {
    const c = new ViewpointController(config);
    const target: Vec3 = [0.25, 0.42, 0.8];
    const frames = simulate(c, 0, 1500, () => target);
    expect(frames[0]!.source).toBe('neutral');
    expect(frames.some((f) => f.source === 'reacquire')).toBe(true);
    expect(frames[frames.length - 1]!.source).toBe('tracking');
    expect(dist(frames[frames.length - 1]!.eye, target)).toBeLessThan(0.001);
    // ~30 cm of travel spread over reacquireMs: never more than ~2 cm in one 60 Hz frame.
    expect(maxStep(frames)).toBeLessThan(0.022);
    // Halfway through the blend it is roughly halfway there.
    const mid = at(frames, 30 + 225);
    expect(dist(mid.eye, NEUTRAL)).toBeGreaterThan(0.05);
    expect(dist(mid.eye, target)).toBeGreaterThan(0.05);
  });

  it('holds the last viewpoint, then eases back to neutral, when the player is lost', () => {
    const c = new ViewpointController(config);
    const target: Vec3 = [0.2, 0.45, 0.85];
    const lostAt = 2000;
    const frames = simulate(c, 0, 6000, (t) => (t < lostAt ? target : null));
    const firstHold = frames.find((f) => f.source === 'hold')!;
    expect(firstHold.t).toBeGreaterThanOrEqual(lostAt);
    expect(firstHold.t).toBeLessThan(lostAt + 120);
    // During the hold nothing moves.
    const holdFrames = frames.filter((f) => f.source === 'hold');
    expect(holdFrames.length).toBeGreaterThan(30);
    for (const f of holdFrames) expect(dist(f.eye, target)).toBeLessThan(0.002);
    const holdEnd = holdFrames[holdFrames.length - 1]!.t;
    expect(holdEnd - firstHold.t).toBeGreaterThan(config.lostHoldMs - 40);
    expect(holdEnd - firstHold.t).toBeLessThan(config.lostHoldMs + 40);
    // Then a monotonic, smooth return.
    const returning = frames.filter((f) => f.source === 'returning');
    expect(returning.length).toBeGreaterThan(60);
    for (let i = 1; i < returning.length; i++) {
      expect(dist(returning[i]!.eye, NEUTRAL)).toBeLessThanOrEqual(dist(returning[i - 1]!.eye, NEUTRAL) + 1e-9);
    }
    const returnDuration = returning[returning.length - 1]!.t - returning[0]!.t;
    expect(returnDuration).toBeGreaterThan(config.returnMs - 60);
    expect(returnDuration).toBeLessThan(config.returnMs + 60);
    const last = frames[frames.length - 1]!;
    expect(last.source).toBe('neutral');
    expect(dist(last.eye, NEUTRAL)).toBeLessThan(1e-6);
    expect(maxStep(frames)).toBeLessThan(0.022);
  });

  it('re-acquires without a jump, even in the middle of the return', () => {
    const c = new ViewpointController(config);
    const a: Vec3 = [0.3, 0.4, 0.8];
    const b: Vec3 = [-0.25, 0.55, 1.1];
    // lost at 1.5 s, comes back at a different place at 3.0 s (mid-return)
    const frames = simulate(c, 0, 5000, (t) => (t < 1500 ? a : t < 3000 ? null : b));
    const back = frames.filter((f) => f.t > 3000);
    expect(back.some((f) => f.source === 'reacquire')).toBe(true);
    expect(back[back.length - 1]!.source).toBe('tracking');
    expect(dist(back[back.length - 1]!.eye, b)).toBeLessThan(0.001);
    expect(maxStep(frames)).toBeLessThan(0.03);
  });

  it('a single missed inference barely disturbs the viewpoint', () => {
    const c = new ViewpointController(config);
    const target: Vec3 = [0.1, 0.5, 0.9];
    let n = 0;
    const frames = simulate(c, 0, 3000, (t) => (t > 1000 && n++ === 0 ? null : target));
    expect(frames.some((f) => f.source === 'hold')).toBe(true);
    for (const f of frames.filter((x) => x.t > 900)) expect(dist(f.eye, target)).toBeLessThan(0.002);
    expect(frames[frames.length - 1]!.source).toBe('tracking');
  });

  it('follows constant motion smoothly at 60 Hz from 18 Hz samples', () => {
    const c = new ViewpointController(config);
    const speed = 0.3; // m/s sideways
    const truth = (t: number): Vec3 => [-0.3 + (speed * t) / 1000, 0.5, 0.9];
    const frames = simulate(c, 0, 2000, truth);
    const steady = frames.filter((f) => f.t > 1000 && f.t < 1900);
    // Per-frame steps are all close to speed / 60 (no 18 Hz stair-stepping).
    const steps: number[] = [];
    for (let i = 1; i < steady.length; i++) steps.push(steady[i]!.eye[0] - steady[i - 1]!.eye[0]);
    const ideal = speed / 60;
    for (const s of steps) {
      expect(s).toBeGreaterThan(ideal * 0.55);
      expect(s).toBeLessThan(ideal * 1.45);
    }
    // Lag behind the true position stays small (latency 30 ms + smoothing, partly extrapolated away).
    const f = at(frames, 1500);
    const lag = truth(f.t)[0] - f.eye[0];
    expect(lag).toBeGreaterThan(-0.005);
    expect(lag).toBeLessThan(0.04);
  });

  it('does not overshoot much when the head stops abruptly', () => {
    const c = new ViewpointController(config);
    const truth = (t: number): Vec3 => [Math.min(0.2, -0.2 + (0.5 * t) / 1000), 0.5, 0.9];
    const frames = simulate(c, 0, 2500, truth);
    const peak = Math.max(...frames.map((f) => f.eye[0]));
    expect(peak).toBeLessThan(0.2 + 0.012);
    expect(Math.abs(frames[frames.length - 1]!.eye[0] - 0.2)).toBeLessThan(0.001);
  });

  it('treats stalled inference like a loss (watchdog) and never extrapolates away', () => {
    const c = new ViewpointController(config);
    const truth = (t: number): Vec3 => [-0.2 + (0.4 * t) / 1000, 0.5, 0.9];
    // Samples stop arriving at 1 s without any explicit "miss".
    const frames = simulate(c, 0, 5000, (t) => (t < 1000 ? truth(t) : undefined));
    const lastTracked = truth(1000);
    const afterStall = frames.filter((f) => f.t > 1000 && f.t < 1600);
    for (const f of afterStall) expect(Math.abs(f.eye[0] - lastTracked[0])).toBeLessThan(0.05);
    expect(frames.some((f) => f.source === 'hold')).toBe(true);
    expect(frames[frames.length - 1]!.source).toBe('neutral');
  });

  it('smoothing is independent of the render frame rate', () => {
    const run = (renderHz: number) => {
      const c = new ViewpointController(config);
      return simulate(c, 0, 1200, (t) => [0.2 * Math.sin(t / 300), 0.5, 0.9], { renderHz });
    };
    const a = run(30);
    const b = run(144);
    for (const t of [500, 800, 1100]) {
      expect(Math.abs(xAt(a, t) - xAt(b, t))).toBeLessThan(0.004);
    }
  });

  it('a long pause between render frames does not cause a jump', () => {
    const c = new ViewpointController(config);
    const target: Vec3 = [0.3, 0.4, 0.8];
    simulate(c, 0, 1500, () => target);
    const out: Vec3 = [0, 0, 0];
    // The tab was hidden for 10 s: no samples, no render frames.
    const source = c.sample(11500, out);
    expect(['hold', 'returning', 'neutral']).toContain(source);
    const second: Vec3 = [0, 0, 0];
    c.sample(11516, second);
    expect(dist(out, second)).toBeLessThan(0.03);
  });

  it('a flagged jump in the measurement is cross-faded, not applied instantly', () => {
    const c = new ViewpointController(config);
    simulate(c, 0, 1000, () => [0, 0.5, 0.9]);
    const out: Vec3 = [0, 0, 0];
    c.sample(1000, out);
    c.pushSample(1000, [0.5, 0.5, 0.9], true);
    c.sample(1016, out);
    expect(out[0]).toBeLessThan(0.02);
    expect(c.source).toBe('reacquire');
  });

  it('manual test viewpoint is reported as "test" and glides in and out', () => {
    const c = new ViewpointController(config);
    const tracked: Vec3 = [0.1, 0.5, 0.9];
    simulate(c, 0, 1000, () => tracked);
    c.setTest([-0.3, 0.6, 1.2]);
    const out: Vec3 = [0, 0, 0];
    const frames: Frame[] = [];
    for (let t = 1000; t <= 2000; t += 1000 / 60) {
      c.pushSample(t, tracked); // the camera keeps tracking in the background
      const source = c.sample(t, out);
      frames.push({ t, eye: [...out] as Vec3, source });
    }
    expect(frames.every((f) => f.source === 'test')).toBe(true);
    expect(dist(frames[frames.length - 1]!.eye, [-0.3, 0.6, 1.2])).toBeLessThan(0.001);
    expect(maxStep(frames)).toBeLessThan(0.08);
    c.setTest(null);
    const after: Frame[] = [];
    for (let t = 2000; t <= 3200; t += 1000 / 60) {
      c.pushSample(t, tracked);
      const source = c.sample(t, out);
      after.push({ t, eye: [...out] as Vec3, source });
    }
    expect(after[0]!.source).not.toBe('test');
    expect(after[after.length - 1]!.source).toBe('tracking');
    expect(dist(after[after.length - 1]!.eye, tracked)).toBeLessThan(0.001);
    expect(maxStep([frames[frames.length - 1]!, ...after])).toBeLessThan(0.03);
  });

  it('release() eases back to neutral without the hold', () => {
    const c = new ViewpointController(config);
    simulate(c, 0, 1000, () => [0.3, 0.4, 0.8]);
    c.release(1000);
    const out: Vec3 = [0, 0, 0];
    expect(c.sample(1016, out)).toBe('returning');
    let source: ViewSource = 'returning';
    for (let t = 1016; t <= 3000; t += 16) source = c.sample(t, out);
    expect(source).toBe('neutral');
    expect(dist(out, NEUTRAL)).toBeLessThan(1e-6);
  });

  it('follows edits of the neutral viewpoint smoothly', () => {
    const c = new ViewpointController(config);
    const out: Vec3 = [0, 0, 0];
    c.sample(0, out);
    c.configure({ ...config, neutral: [0.2, 0.5, 0.95] });
    c.sample(16, out);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(0.05);
    for (let t = 32; t < 2000; t += 16) c.sample(t, out);
    expect(out[0]).toBeCloseTo(0.2, 4);
  });
});
