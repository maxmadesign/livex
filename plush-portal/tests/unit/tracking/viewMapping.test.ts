import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import {
  SOFT_CLAMP_KNEE,
  mapToViewpoint,
  neutralPoint,
  neutralViewpoint,
  offsetViewpoint,
  screenToWindow,
  softClamp,
  type ViewMappingSettings,
} from '../../../src/tracking/viewMapping';

const base: ViewMappingSettings = {
  eye: [0, 0.5, 0.95],
  mode: 'relative',
  gainX: 1,
  gainY: 1,
  gainZ: 1,
  maxOffset: [0.7, 0.5, 0.55],
  minDistance: 0.45,
  calibrated: false,
  calNeutral: [0, 0.5, 0.95],
};

describe('softClamp', () => {
  it('is the identity below the knee', () => {
    for (const d of [-0.22, -0.1, 0, 0.05, 0.3 * SOFT_CLAMP_KNEE]) expect(softClamp(d, 0.3)).toBe(d);
  });
  it('never exceeds the limit and is monotonic, odd and smooth', () => {
    let prev = -Infinity;
    for (let d = -3; d <= 3; d += 0.01) {
      const y = softClamp(d, 0.3);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.3);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(softClamp(-d, 0.3)).toBeCloseTo(-y, 12);
      prev = y;
    }
    // C¹ at the knee: slope just above the knee is ~1.
    const knee = 0.3 * SOFT_CLAMP_KNEE;
    const slope = (softClamp(knee + 1e-5, 0.3) - softClamp(knee, 0.3)) / 1e-5;
    expect(slope).toBeGreaterThan(0.999);
    expect(slope).toBeLessThanOrEqual(1.0000001);
  });
  it('handles a zero limit', () => {
    expect(softClamp(0.5, 0)).toBe(0);
  });
});

describe('view mapping', () => {
  it('uncalibrated: the measured eye is used directly (neutral = reference eye)', () => {
    expect(neutralPoint(base)).toEqual(base.eye);
    const got = mapToViewpoint([0.1, 0.55, 1.0], base);
    expect(got[0]).toBeCloseTo(0.1, 12);
    expect(got[1]).toBeCloseTo(0.55, 12);
    expect(got[2]).toBeCloseTo(1.0, 12);
  });

  it('relative + calibrated: the calibrated pose maps exactly onto the reference eye', () => {
    const view: ViewMappingSettings = { ...base, calibrated: true, calNeutral: [0.08, 0.31, 1.2] };
    expect(mapToViewpoint([0.08, 0.31, 1.2], view)).toEqual([0, 0.5, 0.95]);
    const moved = mapToViewpoint([0.18, 0.36, 1.1], view);
    expect(moved[0]).toBeCloseTo(0.1, 12);
    expect(moved[1]).toBeCloseTo(0.55, 12);
    expect(moved[2]).toBeCloseTo(0.85, 12);
  });

  it('absolute mode ignores the calibrated neutral pose', () => {
    const view: ViewMappingSettings = { ...base, mode: 'absolute', calibrated: true, calNeutral: [0.3, 0.1, 2] };
    const got = mapToViewpoint([0.1, 0.55, 1.0], view);
    expect(got[0]).toBeCloseTo(0.1, 12);
    expect(got[1]).toBeCloseTo(0.55, 12);
    expect(got[2]).toBeCloseTo(1.0, 12);
  });

  it('applies per-axis gains around the reference eye', () => {
    const view: ViewMappingSettings = { ...base, gainX: 2, gainY: 0.5, gainZ: 0 };
    const got = mapToViewpoint([0.1, 0.6, 1.3], view);
    expect(got[0]).toBeCloseTo(0.2, 12);
    expect(got[1]).toBeCloseTo(0.55, 12);
    expect(got[2]).toBeCloseTo(0.95, 12);
  });

  it('limits the offset softly and keeps the minimum viewing distance', () => {
    const far = mapToViewpoint([5, -5, 9], base);
    expect(far[0]).toBeLessThanOrEqual(base.eye[0] + base.maxOffset[0]);
    expect(far[0]).toBeGreaterThan(base.eye[0] + base.maxOffset[0] * 0.9);
    expect(far[1]).toBeGreaterThanOrEqual(base.eye[1] - base.maxOffset[1]);
    expect(far[2]).toBeLessThanOrEqual(base.eye[2] + base.maxOffset[2]);
    const near = mapToViewpoint([0, 0.5, 0.05], base);
    expect(near[2]).toBeGreaterThanOrEqual(base.minDistance);
    // A reference eye closer than the minimum distance is pushed out as well.
    expect(neutralViewpoint({ ...base, eye: [0, 0, 0.2] })[2]).toBe(base.minDistance);
  });

  it('window space is screen space minus the window centre offset', () => {
    const w = screenToWindow([0.3, 0.2, 0.8], { widthM: 0.4, heightM: 0.3, centerOffsetM: [0.1, -0.05] });
    expect(w[0]).toBeCloseTo(0.2, 12);
    expect(w[1]).toBeCloseTo(0.25, 12);
    expect(w[2]).toBeCloseTo(0.8, 12);
  });

  it('manual test offsets use the same limits', () => {
    const p = offsetViewpoint([0.1, -0.1, 0.2] as Vec3, base);
    expect(p[0]).toBeCloseTo(0.1, 12);
    expect(p[1]).toBeCloseTo(0.4, 12);
    expect(p[2]).toBeCloseTo(1.15, 12);
    const clamped = offsetViewpoint([9, 0, -9], base);
    expect(clamped[0]).toBeLessThanOrEqual(0.7);
    expect(clamped[2]).toBeGreaterThanOrEqual(base.minDistance);
  });
});
