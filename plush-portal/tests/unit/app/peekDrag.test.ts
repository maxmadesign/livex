import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import { dragToPeek, INERTIA, MAX_RELEASE_SPEED, PEEK_RANGE, PEEK_SHARE, PeekMotion, peekToEye, SPRING, SPRING_REDUCED, stepSpring } from '../../../src/app/PeekDrag';
import { SOFT_CLAMP_KNEE } from '../../../src/tracking/viewMapping';
import { ViewpointController } from '../../../src/tracking/ViewpointController';

/** Runs the spring from (x0, v0) for `seconds` in steps of `dt`; returns every position. */
function run(x0: number, v0: number, seconds: number, dt: number, reduced = false): number[] {
  const m = new PeekMotion();
  m.x = x0;
  m.vx = v0;
  const out: number[] = [m.x];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    m.step(dt, reduced);
    out.push(m.x);
  }
  return out;
}

describe('drag → peek mapping', () => {
  it('is zero for no movement and follows the finger in direction (content follows the finger)', () => {
    expect(dragToPeek(0, 0, 1280, 720)).toEqual({ x: 0, y: 0 });
    const right = dragToPeek(100, 0, 1280, 720);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBe(0); // no vertical movement
    // Screen y grows downwards: dragging up (dy < 0) moves the eye up.
    expect(dragToPeek(0, -100, 1280, 720).y).toBeGreaterThan(0);
    expect(dragToPeek(0, 100, 1280, 720).y).toBeLessThan(0);
  });

  it('is linear for small drags, scaled by the shorter side of the view', () => {
    const range = PEEK_RANGE * 720;
    const small = dragToPeek(range * 0.3, 0, 1280, 720);
    expect(small.x).toBeCloseTo(0.3, 10);
    // Same fraction of the shorter side on a portrait screen and on a phone held sideways.
    expect(dragToPeek(PEEK_RANGE * 1080 * 0.3, 0, 1080, 1920).x).toBeCloseTo(0.3, 10);
    expect(dragToPeek(PEEK_RANGE * 390 * 0.3, 0, 844, 390).x).toBeCloseTo(0.3, 10);
  });

  it('never leaves −1 … 1, grows monotonically and is symmetric', () => {
    let previous = -Infinity;
    for (let dx = -3000; dx <= 3000; dx += 25) {
      const { x } = dragToPeek(dx, 0, 1280, 720);
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(x).toBeGreaterThanOrEqual(previous);
      expect(dragToPeek(-dx, 0, 1280, 720).x).toBeCloseTo(-x, 12);
      previous = x;
    }
    // Past the knee it eases towards the limit instead of stopping dead.
    const knee = dragToPeek(PEEK_RANGE * 720 * SOFT_CLAMP_KNEE, 0, 1280, 720).x;
    expect(dragToPeek(PEEK_RANGE * 720 * 2, 0, 1280, 720).x).toBeGreaterThan(knee + 0.1);
  });

  it('a tiny view still needs a real drag (no hair trigger)', () => {
    expect(dragToPeek(10, 0, 20, 20).x).toBeCloseTo(10 / 40, 10);
  });

  it('maps a full peek inside the preset limits (metres), never forwards or back', () => {
    const maxOffset: Vec3 = [0.3, 0.22, 0.3];
    const eye = peekToEye(1, -1, maxOffset);
    expect(eye[0]).toBeCloseTo(0.3 * PEEK_SHARE, 12);
    expect(eye[1]).toBeCloseTo(-0.22 * PEEK_SHARE, 12);
    expect(eye[2]).toBe(0);
    expect(PEEK_SHARE).toBeLessThan(1);
  });
});

describe('spring back to neutral', () => {
  it('matches the analytic solution however the time is split into frames', () => {
    for (const p of [SPRING, SPRING_REDUCED]) {
      const one = stepSpring(0.8, -1.5, 0.6, p);
      let x = 0.8, v = -1.5;
      for (let i = 0; i < 60; i++) [x, v] = stepSpring(x, v, 0.01, p);
      expect(x).toBeCloseTo(one[0], 9);
      expect(v).toBeCloseTo(one[1], 9);
    }
  });

  it('is stable for very long frames (a stalled tab) and settles', () => {
    for (const p of [SPRING, SPRING_REDUCED]) {
      const [x, v] = stepSpring(1, 5, 10, p);
      expect(Math.abs(x)).toBeLessThan(1e-6);
      expect(Math.abs(v)).toBeLessThan(1e-6);
    }
    expect(stepSpring(0.5, 0.2, 0, SPRING)).toEqual([0.5, 0.2]);
    expect(stepSpring(0.5, 0.2, -1, SPRING)).toEqual([0.5, 0.2]);
  });

  it('springs back smoothly: settles within 0.8 s with only a small overshoot', () => {
    const xs = run(1, 0, 0.8, 1 / 60);
    expect(Math.abs(xs[xs.length - 1]!)).toBeLessThan(0.01);
    const overshoot = -Math.min(...xs);
    expect(overshoot).toBeGreaterThan(0);
    expect(overshoot).toBeLessThan(0.06);
  });

  it('reduced motion: shorter and never overshoots', () => {
    const xs = run(1, 0, 0.45, 1 / 60, true);
    expect(Math.abs(xs[xs.length - 1]!)).toBeLessThan(0.01);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThanOrEqual(0);
      expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]! + 1e-12);
    }
    // Even from a moving start it does not swing past neutral more than a hair.
    expect(Math.min(...run(0.2, -3, 1, 1 / 60, true))).toBeGreaterThan(-0.12);
  });

  it('comes to rest exactly at zero and then stays inactive', () => {
    const m = new PeekMotion();
    m.x = 0.5;
    for (let i = 0; i < 200; i++) m.step(1 / 60, false);
    expect(m.x).toBe(0);
    expect(m.vx).toBe(0);
    expect(m.active).toBe(false);
  });
});

describe('PeekMotion', () => {
  it('follows the finger while held and does not spring back until released', () => {
    const m = new PeekMotion();
    m.grab();
    m.drag(0.4, -0.2, 1);
    m.step(0.5, false);
    expect(m.x).toBe(0.4);
    expect(m.y).toBe(-0.2);
    expect(m.active).toBe(true);
    m.release(1.5, false);
    m.step(0.1, false);
    expect(m.x).toBeLessThan(0.4);
  });

  it('ignores drags when not held', () => {
    const m = new PeekMotion();
    m.drag(0.5, 0.5, 0);
    expect(m.x).toBe(0);
    expect(m.active).toBe(false);
  });

  it('keeps some of a flick as inertia (limited), but none with reduced motion', () => {
    const flick = (reduced: boolean) => {
      const m = new PeekMotion();
      m.grab();
      for (let i = 0; i <= 5; i++) m.drag(i * 0.06, 0, 1 + i * 0.01);
      m.release(1.05, reduced);
      return m;
    };
    const normal = flick(false);
    expect(normal.vx).toBeCloseTo(6 * INERTIA, 6);
    const fast = new PeekMotion();
    fast.grab();
    fast.drag(0, 0, 1);
    fast.drag(0.9, 0, 1.02);
    fast.release(1.02, false);
    expect(fast.vx).toBeCloseTo(MAX_RELEASE_SPEED * INERTIA, 6);
    expect(flick(true).vx).toBe(0);
    // A finger that rested before letting go leaves no inertia.
    const rested = new PeekMotion();
    rested.grab();
    rested.drag(0, 0, 1);
    rested.drag(0.3, 0, 1.05);
    rested.release(1.5, false);
    expect(rested.vx).toBe(0);
  });

  it('cancel returns to neutral at once (a tracked face takes the view)', () => {
    const m = new PeekMotion();
    m.grab();
    m.drag(0.7, 0.3, 0);
    m.cancel();
    expect([m.x, m.y, m.vx, m.vy, m.active, m.holding]).toEqual([0, 0, 0, 0, false, false]);
  });
});

describe('the drag view source in the viewpoint controller', () => {
  const NEUTRAL: Vec3 = [0, 0.14, 0.62];
  const make = () => new ViewpointController({ neutral: NEUTRAL, lostHoldMs: 700, returnMs: 1500, reacquireMs: 450, smoothMs: 70 });

  it('adds the offset to the neutral viewpoint and reports "drag"; null hands back to neutral', () => {
    const c = make();
    const out: Vec3 = [0, 0, 0];
    expect(c.sample(0, out)).toBe('neutral');
    c.setDrag([0.2, -0.1, 0]);
    expect(c.sample(16, out)).toBe('drag');
    expect(out[0]).toBeCloseTo(0.2, 12);
    expect(out[1]).toBeCloseTo(0.04, 12);
    expect(out[2]).toBeCloseTo(0.62, 12);
    c.setDrag(null);
    expect(c.sample(32, out)).toBe('neutral');
    expect(out).toEqual(NEUTRAL);
  });

  it('a live face wins over a drag, and takes over from the dragged view without a jump', () => {
    const c = make();
    const out: Vec3 = [0, 0, 0];
    c.sample(0, out);
    c.setDrag([0.25, 0, 0]);
    c.sample(16, out);
    expect(out[0]).toBeCloseTo(0.25, 12);
    // A face appears exactly where the dragged view is: the blend starts there, no jump.
    c.pushSample(20, [0.25, 0.14, 0.62]);
    c.setDrag(null);
    expect(c.sample(33, out)).toBe('reacquire');
    expect(out[0]).toBeCloseTo(0.25, 6);
    // Still live: a drag offset is ignored while the face drives the view.
    c.setDrag([-0.3, 0, 0]);
    c.pushSample(60, [0.25, 0.14, 0.62]);
    const source = c.sample(66, out);
    expect(source === 'reacquire' || source === 'tracking').toBe(true);
    expect(out[0]).toBeGreaterThan(0.2);
  });

  it('the test viewpoint wins over a drag', () => {
    const c = make();
    const out: Vec3 = [0, 0, 0];
    c.setTest([0.1, 0.14, 0.62]);
    c.setDrag([0.3, 0, 0]);
    let source = c.sample(0, out);
    for (let t = 16; t <= 2000; t += 16) source = c.sample(t, out);
    expect(source).toBe('test');
    expect(out[0]).toBeCloseTo(0.1, 6);
  });

  it('applies while the face is being held or returning after a loss', () => {
    const c = make();
    const out: Vec3 = [0, 0, 0];
    c.pushSample(0, [0.1, 0.14, 0.62]);
    for (let t = 0; t <= 500; t += 16) c.sample(t, out);
    c.pushMiss(510);
    expect(c.sample(520, out)).toBe('hold');
    c.setDrag([0.05, 0, 0]);
    expect(c.sample(536, out)).toBe('drag');
  });

  it('reset clears the drag', () => {
    const c = make();
    const out: Vec3 = [0, 0, 0];
    c.setDrag([0.2, 0, 0]);
    c.reset();
    expect(c.sample(0, out)).toBe('neutral');
  });
});
