import { describe, expect, it } from 'vitest';
import { IDLE_CALIBRATION } from '../../../src/core/contracts';
import type { Vec3 } from '../../../src/core/types';
import { CountdownCalibration, ROTATED, WAITING_CAMERA, baselineStats, countdownSeconds, type BaselineSample } from '../../../src/tracking/countdown';

const DEG = Math.PI / 180;

/** Deterministic pseudo random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
}

/** A synthetic stream of baseline samples (18 Hz) from `from` to `to` ms. */
function stream(
  from: number,
  to: number,
  pose: (t: number) => { eye: Vec3; yaw: number; pitch: number },
  noise = { posM: 0.002, depthM: 0.004, angle: 0.8 * DEG },
  seed = 1,
  hz = 18,
): BaselineSample[] {
  const r = rng(seed);
  const out: BaselineSample[] = [];
  for (let t = from; t <= to; t += 1000 / hz) {
    const p = pose(t);
    out.push({
      t,
      eye: [p.eye[0] + gauss(r) * noise.posM, p.eye[1] + gauss(r) * noise.posM, p.eye[2] + gauss(r) * noise.depthM],
      yaw: p.yaw + gauss(r) * noise.angle,
      pitch: p.pitch + gauss(r) * noise.angle,
    });
  }
  return out;
}

describe('CountdownCalibration', () => {
  it('counts whole seconds down 3 → 2 → 1, then captures', () => {
    const c = new CountdownCalibration();
    expect(c.status()).toBe(IDLE_CALIBRATION);
    c.start(10_000, 3);
    const seen: string[] = [];
    for (let t = 10_000; t <= 13_100; t += 50) {
      c.tick(t);
      const s = c.status();
      const label = s.phase === 'countdown' ? `${s.remaining}` : s.phase;
      if (seen[seen.length - 1] !== label) seen.push(label);
    }
    expect(seen).toEqual(['3', '2', '1', 'capturing']);
    // Boundaries: a whole second is shown for a whole second.
    const d = new CountdownCalibration();
    d.start(0, 3);
    d.tick(999);
    expect(d.status().remaining).toBe(3);
    d.tick(1000);
    expect(d.status().remaining).toBe(2);
    d.tick(2999);
    expect(d.status().remaining).toBe(1);
    d.tick(3000);
    expect(d.status().phase).toBe('capturing');
    expect(d.status().remaining).toBe(0);
  });

  it('never counts back up when ticked with a slightly older time (frame start vs timer clock)', () => {
    const c = new CountdownCalibration();
    c.start(0, 3);
    c.tick(1004); // timer tick just after the boundary
    expect(c.status().remaining).toBe(2);
    c.tick(996); // the next rendered frame started a little earlier
    expect(c.status().remaining).toBe(2);
    c.tick(3001);
    expect(c.status().phase).toBe('capturing');
    c.tick(2990);
    expect(c.status().phase).toBe('capturing');
  });

  it('reports the same status object until something changes (no store spam per frame)', () => {
    const c = new CountdownCalibration();
    c.start(0, 3);
    const a = c.status();
    expect(c.tick(100)).toBe(false);
    expect(c.tick(900)).toBe(false);
    expect(c.status()).toBe(a);
    expect(c.tick(1000)).toBe(true);
    expect(c.status()).not.toBe(a);
  });

  it('holds the countdown while the camera is still starting', () => {
    const c = new CountdownCalibration();
    c.start(0, 3, true);
    expect(c.status()).toMatchObject({ phase: 'countdown', remaining: 3, detail: WAITING_CAMERA });
    c.tick(60_000);
    expect(c.status()).toMatchObject({ phase: 'countdown', remaining: 3, detail: WAITING_CAMERA });
    c.cameraReady(60_000);
    expect(c.status()).toMatchObject({ phase: 'countdown', remaining: 3, detail: '' });
    c.tick(61_000);
    expect(c.status().remaining).toBe(2);
  });

  it('averages a steady window into the baseline (eye position and head direction)', () => {
    const truth: Vec3 = [0.05, 0.12, 0.65];
    const yaw = 5 * DEG;
    const pitch = -8 * DEG;
    const c = new CountdownCalibration();
    c.start(0, 2);
    // Frames during the countdown are ignored (the player is still getting into position).
    for (const s of stream(0, 1990, () => ({ eye: [0.3, 0, 0.4], yaw: 0.5, pitch: 0.5 }), undefined, 7)) c.push(s);
    expect(c.status().phase).toBe('countdown');
    let doneAt = -1;
    for (const s of stream(2000, 5000, () => ({ eye: truth, yaw, pitch }), undefined, 3)) {
      if (c.push(s)) {
        doneAt = s.t;
        break;
      }
    }
    expect(c.status()).toMatchObject({ phase: 'done', detail: 'ok' });
    // About the 0.7 s capture window after the countdown, not seconds.
    expect(doneAt - 2000).toBeGreaterThanOrEqual(500);
    expect(doneAt - 2000).toBeLessThan(900);
    const r = c.result!;
    expect(r.samples).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < 3; i++) expect(Math.abs(r.eye[i]! - truth[i]!)).toBeLessThan(i === 2 ? 0.004 : 0.002);
    expect(Math.abs(r.yaw - yaw) / DEG).toBeLessThan(0.6);
    expect(Math.abs(r.pitch - pitch) / DEG).toBeLessThan(0.6);
    expect(r.spread.lateral).toBeLessThan(0.005);
    // The result is shown for a moment, then the status returns to idle.
    c.tick(doneAt + 1000);
    expect(c.status().phase).toBe('done');
    c.tick(doneAt + c.options.doneHoldMs);
    expect(c.status()).toBe(IDLE_CALIBRATION);
  });

  it('works at a low phone inference rate', () => {
    const c = new CountdownCalibration();
    c.start(0, 1);
    let done = false;
    for (const s of stream(1000, 4000, () => ({ eye: [0, 0.05, 0.35], yaw: 0, pitch: 0 }), undefined, 11, 6)) if ((done = c.push(s))) break;
    expect(done).toBe(true);
    expect(c.result!.samples).toBeGreaterThanOrEqual(c.options.minSamples);
  });

  it('still completes when inference runs at only 3–4 Hz (the window stretches to hold the minimum samples, at most 1 s)', () => {
    for (const hz of [4, 3.5]) {
      const c = new CountdownCalibration();
      c.start(0, 1);
      let doneAt = -1;
      for (const s of stream(1000, 4000, () => ({ eye: [0, 0.05, 0.35], yaw: 0, pitch: 0 }), undefined, 13, hz)) {
        if (c.push(s)) {
          doneAt = s.t;
          break;
        }
      }
      expect(doneAt, `${hz} Hz`).toBeGreaterThan(0);
      expect(c.result!.samples, `${hz} Hz`).toBe(c.options.minSamples);
      // The stretched window still covers at most maxWindowMs.
      expect(doneAt - 1000, `${hz} Hz`).toBeLessThanOrEqual(c.options.maxWindowMs);
    }
    // Slower than that cannot fill the window within maxWindowMs: the capture fails instead of averaging stale samples.
    const slow = new CountdownCalibration();
    slow.start(0, 0);
    for (const s of stream(0, 3000, () => ({ eye: [0, 0.05, 0.35], yaw: 0, pitch: 0 }), undefined, 13, 2)) slow.push(s);
    slow.tick(3000);
    expect(slow.status()).toMatchObject({ phase: 'failed' });
  });

  it('fails with no_face when the player is not visible during the capture', () => {
    const c = new CountdownCalibration();
    c.start(0, 3);
    c.tick(3000);
    expect(c.status().phase).toBe('capturing');
    c.push({ t: 3100, eye: [0, 0, 0.6], yaw: 0, pitch: 0 }); // one stray detection
    c.tick(3000 + c.options.captureTimeoutMs - 1);
    expect(c.status().phase).toBe('capturing');
    c.tick(3000 + c.options.captureTimeoutMs);
    expect(c.status()).toMatchObject({ phase: 'failed', detail: 'no_face' });
    expect(c.result).toBeNull();
    // Retry: a new countdown from the failure.
    c.start(10_000, 1);
    expect(c.status()).toMatchObject({ phase: 'countdown', remaining: 1 });
  });

  it('fails with unstable when the player keeps moving or turning', () => {
    const moving = new CountdownCalibration();
    moving.start(0, 0);
    for (const s of stream(0, 4000, (t) => ({ eye: [-0.2 + (t / 1000) * 0.15, 0.1, 0.6], yaw: 0, pitch: 0 }))) moving.push(s);
    moving.tick(4000);
    expect(moving.status()).toMatchObject({ phase: 'failed', detail: 'unstable' });

    const turning = new CountdownCalibration();
    turning.start(0, 0);
    for (const s of stream(0, 4000, (t) => ({ eye: [0, 0.1, 0.6], yaw: Math.sin(t / 150) * 15 * DEG, pitch: 0 }))) turning.push(s);
    turning.tick(4000);
    expect(turning.status()).toMatchObject({ phase: 'failed', detail: 'unstable' });

    const walkingCloser = new CountdownCalibration();
    walkingCloser.start(0, 0);
    for (const s of stream(0, 4000, (t) => ({ eye: [0, 0.1, 1.2 - (t / 1000) * 0.2], yaw: 0, pitch: 0 }))) walkingCloser.push(s);
    walkingCloser.tick(4000);
    expect(walkingCloser.status()).toMatchObject({ phase: 'failed', detail: 'unstable' });
  });

  it('succeeds as soon as the player settles (sliding window)', () => {
    const c = new CountdownCalibration();
    c.start(0, 0);
    const settle: Vec3 = [0.1, 0.15, 0.7];
    let doneAt = -1;
    for (const s of stream(0, 3000, (t) => (t < 1000 ? { eye: [0.1 - (1000 - t) * 0.0003, 0.15, 0.7], yaw: 0, pitch: 0 } : { eye: settle, yaw: 0, pitch: 0 }))) {
      if (c.push(s)) {
        doneAt = s.t;
        break;
      }
    }
    expect(doneAt).toBeGreaterThan(1500);
    expect(doneAt).toBeLessThan(2000);
    expect(Math.abs(c.result!.eye[0] - settle[0])).toBeLessThan(0.002);
  });

  it('tolerates the larger noise of a far player (thresholds scale with distance)', () => {
    const c = new CountdownCalibration();
    c.start(0, 0);
    let done = false;
    for (const s of stream(0, 3000, () => ({ eye: [0, 0.4, 1.5], yaw: 0, pitch: 0 }), { posM: 0.006, depthM: 0.02, angle: 1.5 * DEG }, 5)) if ((done = c.push(s))) break;
    expect(done).toBe(true);
  });

  it('is not flaky: a steady player always passes, a slowly drifting one always fails (40 noise seeds)', () => {
    const outcome = (pose: (t: number) => { eye: Vec3; yaw: number; pitch: number }, seed: number, noise?: Parameters<typeof stream>[3]) => {
      const c = new CountdownCalibration();
      c.start(0, 0);
      for (const s of stream(0, 3200, pose, noise, seed)) if (c.push(s)) break;
      c.tick(3200);
      return c.status().phase === 'done' || c.status().phase === 'idle' ? 'done' : c.status().detail;
    };
    for (let seed = 1; seed <= 40; seed++) {
      // Typical desktop (0.6 m) and kiosk (1.0 m) noise, also with the body sway of a person holding still.
      expect(outcome(() => ({ eye: [0.02, 0.1, 0.6], yaw: 3 * DEG, pitch: -6 * DEG }), seed), `desktop ${seed}`).toBe('done');
      expect(
        outcome((t) => ({ eye: [0.004 * Math.sin(t / 700), 0.45 + 0.003 * Math.sin(t / 900), 1.0], yaw: 0, pitch: 0 }), seed, { posM: 0.003, depthM: 0.01, angle: 1.2 * DEG }),
        `kiosk ${seed}`,
      ).toBe('done');
      // Walking sideways at 6 cm/s or towards the screen at 10 cm/s is not "holding still".
      expect(outcome((t) => ({ eye: [-0.1 + (t / 1000) * 0.06, 0.1, 0.6], yaw: 0, pitch: 0 }), seed), `sideways ${seed}`).toBe('unstable');
      expect(outcome((t) => ({ eye: [0, 0.1, 1.1 - (t / 1000) * 0.1], yaw: 0, pitch: 0 }), seed), `closer ${seed}`).toBe('unstable');
    }
  });

  it('cancel returns to idle without a result; fail() reports the reason; invalid samples are ignored', () => {
    const c = new CountdownCalibration();
    c.start(0, 0);
    c.push({ t: 10, eye: [Number.NaN, 0, 0.6], yaw: 0, pitch: 0 });
    c.push({ t: 20, eye: [0, 0, 0.6], yaw: Number.POSITIVE_INFINITY, pitch: 0 });
    c.cancel();
    expect(c.status()).toBe(IDLE_CALIBRATION);
    expect(c.result).toBeNull();
    expect(c.active).toBe(false);
    c.start(0, 3, true);
    c.fail('denied');
    expect(c.status()).toMatchObject({ phase: 'failed', detail: 'denied' });
    expect(c.active).toBe(false);
  });

  it('reports a rotation prompt while idle only', () => {
    const c = new CountdownCalibration();
    c.setIdleDetail(ROTATED);
    expect(c.status()).toMatchObject({ phase: 'idle', detail: ROTATED });
    c.start(0, 3);
    expect(c.status().detail).toBe('');
    c.cancel();
    expect(c.status()).toBe(IDLE_CALIBRATION);
  });

  it('clamps the countdown length to whole seconds', () => {
    expect(countdownSeconds(3)).toBe(3);
    expect(countdownSeconds(2.6)).toBe(3);
    expect(countdownSeconds(-4)).toBe(0);
    expect(countdownSeconds(1e6)).toBe(30);
    expect(countdownSeconds(Number.NaN)).toBe(3);
    const c = new CountdownCalibration();
    c.start(0, 0);
    expect(c.status().phase).toBe('capturing');
  });

  it('baselineStats computes means and spreads', () => {
    const s = baselineStats([
      { t: 0, eye: [0, 0, 1], yaw: 0, pitch: 0 },
      { t: 1, eye: [0.02, 0, 1.02], yaw: 0.02, pitch: 0 },
    ]);
    expect(s.mean.eye[0]).toBeCloseTo(0.01, 9);
    expect(s.mean.eye[2]).toBeCloseTo(1.01, 9);
    expect(s.mean.yaw).toBeCloseTo(0.01, 9);
    expect(s.lateral).toBeCloseTo(0.01, 9);
    expect(s.depth).toBeCloseTo(0.01, 9);
    expect(s.angle).toBeCloseTo(0.01, 9);
  });
});
