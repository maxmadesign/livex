import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { FixedStepper } from '../../../src/physics/PhysicsWorld';

describe('FixedStepper', () => {
  it('produces the right number of steps for ordinary frames and keeps alpha in [0, 1)', () => {
    const s = new FixedStepper(FIXED_DT, 5);
    let total = 0;
    for (let i = 0; i < 600; i++) {
      const steps = s.advance(1 / 60);
      total += steps;
      expect(steps).toBeLessThanOrEqual(5);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThan(1);
    }
    // 10 s of frames at 60 Hz = 1200 steps at 120 Hz (± rounding of the last partial step).
    expect(Math.abs(total - 1200)).toBeLessThanOrEqual(1);
    expect(s.droppedSteps).toBe(0);
  });

  it('works for frame rates that do not divide the step rate', () => {
    for (const fps of [24, 30, 50, 75, 90, 144, 240]) {
      const s = new FixedStepper(FIXED_DT, 6);
      let total = 0;
      for (let i = 0; i < fps * 4; i++) total += s.advance(1 / fps);
      expect(Math.abs(total - 480), `${fps} fps`).toBeLessThanOrEqual(1);
    }
  });

  it('never runs more than maxSteps and drops the backlog after a long frame', () => {
    const s = new FixedStepper(FIXED_DT, 5);
    expect(s.advance(3)).toBe(5); // a 3 s hitch (tab switch) is not simulated in one burst
    expect(s.droppedSteps).toBeGreaterThan(300);
    expect(s.alpha).toBe(1);
    // The next ordinary frame is ordinary again: nothing was carried over.
    expect(s.advance(1 / 60)).toBe(2);
  });

  it('reset forgets accumulated time', () => {
    const s = new FixedStepper(FIXED_DT, 5);
    s.advance(FIXED_DT * 0.9);
    expect(s.alpha).toBeCloseTo(0.9, 5);
    s.reset();
    expect(s.alpha).toBe(1);
    expect(s.advance(FIXED_DT * 0.5)).toBe(0); // would have been a step without the reset
  });

  it('ignores zero, negative and non-finite frame times', () => {
    const s = new FixedStepper(FIXED_DT, 5);
    for (const dt of [0, -0.5, Number.NaN]) expect(s.advance(dt)).toBe(0);
    expect(s.advance(FIXED_DT)).toBe(1);
  });
});
