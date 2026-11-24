import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import type { Vec3 } from '../../../src/core/types';
import { depthKFromFocal, effectiveFocalRef, eyeInCamera, measureFace } from '../../../src/tracking/eyeEstimator';
import { uprightFrame } from '../../../src/tracking/frameGeometry';
import { EYE_CORNER_SLOTS, FLOATS_PER_LANDMARK, REFERENCE_FRAME_WIDTH, REFERENCE_IPD_M } from '../../../src/tracking/landmarks';
import { focalForHfov, synthFace } from './syntheticFace';

const DEG = Math.PI / 180;
const frame = uprightFrame(640, 480, 0, false);
const focal = focalForHfov(63);

function estimate(eye: Vec3, extra: Partial<Parameters<typeof synthFace>[0]> = {}, f = focal, fr = frame): Vec3 {
  const packed = synthFace({ eye, frame: fr, focal: f, ...extra });
  const m = measureFace(packed, 0, fr);
  expect(m).not.toBeNull();
  return eyeInCamera(m!, fr, f);
}

/** Depth from the plain 2D inter-ocular distance (what a naive tracker would do). */
function naiveDepth(packed: Float32Array, f: number): number {
  const xy = (slot: number) => [packed[slot * FLOATS_PER_LANDMARK]! * frame.width, packed[slot * FLOATS_PER_LANDMARK + 1]! * frame.height] as const;
  const [ro, ri, li, lo] = EYE_CORNER_SLOTS.map(xy) as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  const rx = (ro[0] + ri[0]) / 2, ry = (ro[1] + ri[1]) / 2;
  const lx = (li[0] + lo[0]) / 2, ly = (li[1] + lo[1]) / 2;
  return (f * REFERENCE_IPD_M) / Math.hypot(lx - rx, ly - ry);
}

describe('effectiveFocalRef', () => {
  it('derives the focal length from the horizontal field of view when uncalibrated', () => {
    expect(effectiveFocalRef(90, 0)).toBeCloseTo(REFERENCE_FRAME_WIDTH / 2, 6);
    expect(effectiveFocalRef(63, 0)).toBeCloseTo(320 / Math.tan(31.5 * DEG), 6);
  });
  it('lets the calibration constant take precedence over hfov', () => {
    const k = depthKFromFocal(700);
    expect(effectiveFocalRef(63, k)).toBeCloseTo(700, 9);
    expect(effectiveFocalRef(120, k)).toBeCloseTo(700, 9);
  });
});

describe('measureFace + eyeInCamera (synthetic pinhole camera)', () => {
  it('recovers the eye position of a frontal face at several distances', () => {
    for (const z of [0.4, 0.6, 0.9, 1.4, 2.5]) {
      const got = estimate([0, 0, z]);
      expect(Math.abs(got[2] - z) / z).toBeLessThan(0.012);
      expect(Math.abs(got[0])).toBeLessThan(0.003);
      expect(Math.abs(got[1])).toBeLessThan(0.004);
    }
  });

  it('recovers lateral and vertical offsets with the correct sign', () => {
    const cases: Vec3[] = [
      [0.3, 0, 0.9],
      [-0.3, 0, 0.9],
      [0, 0.2, 0.9],
      [0, -0.2, 0.9],
      [0.25, -0.15, 1.3],
      [-0.12, 0.1, 0.5],
    ];
    for (const eye of cases) {
      const got = estimate(eye);
      expect(Math.abs(got[0] - eye[0])).toBeLessThan(0.012);
      expect(Math.abs(got[1] - eye[1])).toBeLessThan(0.012);
      expect(Math.abs(got[2] - eye[2]) / eye[2]).toBeLessThan(0.025);
      if (eye[0] !== 0) expect(Math.sign(got[0])).toBe(Math.sign(eye[0]));
      if (eye[1] !== 0) expect(Math.sign(got[1])).toBe(Math.sign(eye[1]));
    }
  });

  it('halving the distance doubles the measured scale (depth ∝ 1 / scale)', () => {
    const near = measureFace(synthFace({ eye: [0, 0, 0.6], frame, focal }), 0, frame)!;
    const far = measureFace(synthFace({ eye: [0, 0, 1.2], frame, focal }), 0, frame)!;
    expect(near.pxPerM / far.pxPerM).toBeGreaterThan(1.96);
    expect(near.pxPerM / far.pxPerM).toBeLessThan(2.04);
    expect(near.ipdPx).toBeCloseTo(near.pxPerM * REFERENCE_IPD_M, 9);
  });

  it('turning or nodding the head in place does not fake a depth change', () => {
    const z = 0.8;
    const frontal = estimate([0, 0, z])[2];
    let worst = 0;
    let worstNaive = 0;
    for (const yawDeg of [-35, -25, -15, 0, 15, 25, 35]) {
      for (const pitchDeg of [-25, -12, 0, 12, 25]) {
        const options = { eye: [0, 0, z] as Vec3, yaw: yawDeg * DEG, pitch: pitchDeg * DEG, frame, focal };
        const packed = synthFace(options);
        const m = measureFace(packed, 0, frame)!;
        const depth = eyeInCamera(m, frame, focal)[2];
        worst = Math.max(worst, Math.abs(depth - frontal) / frontal);
        worstNaive = Math.max(worstNaive, Math.abs(naiveDepth(packed, focal) - frontal) / frontal);
      }
    }
    // The rigid fit stays within a few percent over ±35° yaw / ±25° pitch …
    expect(worst).toBeLessThan(0.03);
    // … where the plain inter-ocular distance is off by well over 15 %.
    expect(worstNaive).toBeGreaterThan(0.15);
  });

  it('the eye midpoint follows the real eyes when the head turns (orientation is not the viewpoint)', () => {
    // Head yaw rotates about the eye midpoint in this generator, so the true eye position stays put.
    for (const yawDeg of [-30, 30]) {
      const got = estimate([0.1, -0.05, 0.9], { yaw: yawDeg * DEG });
      expect(Math.abs(got[0] - 0.1)).toBeLessThan(0.012);
      expect(Math.abs(got[1] + 0.05)).toBeLessThan(0.012);
    }
  });

  it('reports head yaw / pitch / roll with the documented signs', () => {
    const m1 = measureFace(synthFace({ eye: [0, 0, 0.8], yaw: 20 * DEG, frame, focal }), 0, frame)!;
    expect(m1.yaw / DEG).toBeGreaterThan(16);
    expect(m1.yaw / DEG).toBeLessThan(24);
    expect(Math.abs(m1.pitch / DEG)).toBeLessThan(4);
    const m2 = measureFace(synthFace({ eye: [0, 0, 0.8], pitch: 15 * DEG, frame, focal }), 0, frame)!;
    expect(m2.pitch / DEG).toBeGreaterThan(11);
    expect(m2.pitch / DEG).toBeLessThan(19);
    const m3 = measureFace(synthFace({ eye: [0, 0, 0.8], roll: 12 * DEG, frame, focal }), 0, frame)!;
    expect(m3.roll / DEG).toBeGreaterThan(10);
    expect(m3.roll / DEG).toBeLessThan(14);
    const m4 = measureFace(synthFace({ eye: [0, 0, 0.8], yaw: -20 * DEG, frame, focal }), 0, frame)!;
    expect(m4.yaw).toBeLessThan(0);
  });

  it('ignores MediaPipe landmark z completely', () => {
    const rng = makeRng(7);
    const a = synthFace({ eye: [0.1, 0.05, 0.7], yaw: 0.3, frame, focal });
    const b = synthFace({ eye: [0.1, 0.05, 0.7], yaw: 0.3, frame, focal, zFill: () => (rng() - 0.5) * 50 });
    const ma = measureFace(a, 0, frame)!;
    const mb = measureFace(b, 0, frame)!;
    expect(mb.pxPerM).toBe(ma.pxPerM);
    expect(mb.eyeX).toBe(ma.eyeX);
    expect(mb.eyeY).toBe(ma.eyeY);
    expect(mb.yaw).toBe(ma.yaw);
  });

  it('a mirrored camera image yields the same true eye position and yaw sign', () => {
    const mirrored = uprightFrame(640, 480, 0, true);
    const eye: Vec3 = [0.22, -0.08, 0.85];
    const plain = measureFace(synthFace({ eye, yaw: 0.25, roll: 0.1, frame, focal }), 0, frame)!;
    const flipped = measureFace(synthFace({ eye, yaw: 0.25, roll: 0.1, frame: mirrored, focal }), 0, mirrored)!;
    expect(flipped.eyeX).toBeCloseTo(plain.eyeX, 3);
    expect(flipped.eyeY).toBeCloseTo(plain.eyeY, 3);
    expect(flipped.pxPerM).toBeCloseTo(plain.pxPerM, 3);
    expect(flipped.yaw).toBeCloseTo(plain.yaw, 4);
    expect(flipped.roll).toBeCloseTo(plain.roll, 4);
    // The face centre used for association / preview stays in delivered (mirrored) coordinates.
    expect(flipped.centerU).toBeCloseTo(1 - plain.centerU, 4);
    const got = eyeInCamera(flipped, mirrored, focal);
    expect(Math.abs(got[0] - eye[0])).toBeLessThan(0.012);
  });

  it('works for an upright frame from a rotated sensor (portrait frame)', () => {
    const portrait = uprightFrame(640, 480, 90, false);
    expect(portrait.width).toBeCloseTo(480, 9);
    expect(portrait.height).toBeCloseTo(640, 9);
    const eye: Vec3 = [0.1, 0.25, 0.9];
    const got = estimate(eye, {}, focal, portrait);
    expect(Math.abs(got[0] - eye[0])).toBeLessThan(0.012);
    expect(Math.abs(got[1] - eye[1])).toBeLessThan(0.012);
    expect(Math.abs(got[2] - eye[2]) / eye[2]).toBeLessThan(0.025);
  });

  it('is resolution independent (reference pixels)', () => {
    const hd = uprightFrame(1280, 720, 0, false);
    const a = measureFace(synthFace({ eye: [0.05, 0, 0.8], frame, focal }), 0, frame)!;
    const b = measureFace(synthFace({ eye: [0.05, 0, 0.8], frame: hd, focal }), 0, hd)!;
    expect(b.pxPerM).toBeCloseTo(a.pxPerM, 6);
    expect(b.eyeX - hd.width / 2).toBeCloseTo(a.eyeX - frame.width / 2, 6);
  });

  it('a face with different proportions only changes a constant scale factor, not the rotation robustness', () => {
    const shape: Vec3 = [1.08, 0.93, 1.15]; // wider, shorter face with a more prominent nose
    const z = 0.8;
    const base = measureFace(synthFace({ eye: [0, 0, z], frame, focal, shape }), 0, frame)!;
    // The person's own constant (what calibration absorbs).
    const k = base.pxPerM;
    let worst = 0;
    for (const yawDeg of [-30, -15, 15, 30]) {
      for (const pitchDeg of [-20, 0, 20]) {
        const m = measureFace(synthFace({ eye: [0, 0, z], yaw: yawDeg * DEG, pitch: pitchDeg * DEG, frame, focal, shape }), 0, frame)!;
        worst = Math.max(worst, Math.abs(m.pxPerM - k) / k);
      }
    }
    expect(worst).toBeLessThan(0.05);
    expect(base.anisotropy).toBeGreaterThan(1.1);
  });

  it('stays precise with realistic landmark noise', () => {
    const rng = makeRng(42);
    const depths: number[] = [];
    for (let i = 0; i < 300; i++) {
      const m = measureFace(synthFace({ eye: [0, 0, 0.8], frame, focal, noisePx: 0.5, rng }), 0, frame)!;
      depths.push(eyeInCamera(m, frame, focal)[2]);
    }
    const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
    const std = Math.sqrt(depths.reduce((a, b) => a + (b - mean) ** 2, 0) / depths.length);
    expect(Math.abs(mean - 0.8) / 0.8).toBeLessThan(0.015);
    expect(std / mean).toBeLessThan(0.02);
  });

  it('gives a small fit residual for a real face shape and a large one for garbage', () => {
    const good = measureFace(synthFace({ eye: [0, 0, 0.8], frame, focal }), 0, frame)!;
    expect(good.residual).toBeLessThan(0.03);
    const rng = makeRng(3);
    const junk = new Float32Array(synthFace({ eye: [0, 0, 0.8], frame, focal }).length);
    for (let i = 0; i < junk.length; i++) junk[i] = rng();
    const bad = measureFace(junk, 0, frame);
    expect(bad === null || bad.residual > 0.5).toBe(true);
  });

  it('returns null for degenerate landmarks', () => {
    const zeros = new Float32Array(synthFace({ eye: [0, 0, 0.8], frame, focal }).length);
    expect(measureFace(zeros, 0, frame)).toBeNull();
  });
});
