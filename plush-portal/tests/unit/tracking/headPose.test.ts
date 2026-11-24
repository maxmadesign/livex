import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import { defaultSettings } from '../../../src/settings/spec';
import { mountMatrix } from '../../../src/tracking/cameraTransform';
import { createMeasurement, measureFace } from '../../../src/tracking/eyeEstimator';
import { uprightFrame } from '../../../src/tracking/frameGeometry';
import {
  HEAD_DEADZONE,
  HEAD_MAX_ANGLE,
  directionToCentre,
  headDirectionScreen,
  headOffset,
  headRelativeToCentre,
  shapeHeadAngle,
} from '../../../src/tracking/headPose';
import { mapToViewpoint } from '../../../src/tracking/viewMapping';
import { focalForHfov, synthFace } from './syntheticFace';

const DEG = Math.PI / 180;

/** Camera-space yaw / pitch (estimator convention) of a face whose nose points along screen direction `d`. */
export function cameraAnglesFor(d: Readonly<Vec3>, matrix: Float64Array): { yaw: number; pitch: number } {
  // Inverse rotation (transpose) of the camera → screen matrix.
  const x = matrix[0]! * d[0] + matrix[3]! * d[1] + matrix[6]! * d[2];
  const y = matrix[1]! * d[0] + matrix[4]! * d[1] + matrix[7]! * d[2];
  const z = matrix[2]! * d[0] + matrix[5]! * d[1] + matrix[8]! * d[2];
  const n = Math.hypot(x, y, z);
  return { yaw: Math.atan2(x / n, -z / n), pitch: Math.asin(-y / n) };
}

/** Screen direction for a head turned by yaw (+ right) / pitch (+ up) from facing the screen (−Z). */
function screenDir(yaw: number, pitch: number): Vec3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

describe('head direction in screen space', () => {
  it('flips the camera yaw for an ideally mounted camera (camera +X = viewer left)', () => {
    const m = mountMatrix({ pos: [0, 0, 0], pitchDeg: 0, yawDeg: 0, rollDeg: 0 });
    const h = headDirectionScreen(20 * DEG, 10 * DEG, m);
    expect(h.yaw / DEG).toBeCloseTo(-20, 6);
    expect(h.pitch / DEG).toBeCloseTo(10, 6);
  });

  it('undoes a tilted / turned / rolled camera mount', () => {
    for (const mount of [
      { pitchDeg: 18, yawDeg: 0, rollDeg: 0 },
      { pitchDeg: -10, yawDeg: 12, rollDeg: 4 },
      { pitchDeg: 4, yawDeg: -25, rollDeg: -3 },
    ]) {
      const m = mountMatrix({ pos: [0, 0.9, 0], ...mount });
      for (const [yaw, pitch] of [[0, 0], [25, -10], [-30, 15]] as const) {
        const cam = cameraAnglesFor(screenDir(yaw * DEG, pitch * DEG), m);
        const h = headDirectionScreen(cam.yaw, cam.pitch, m);
        expect(h.yaw / DEG, JSON.stringify(mount)).toBeCloseTo(yaw, 6);
        expect(h.pitch / DEG, JSON.stringify(mount)).toBeCloseTo(pitch, 6);
      }
    }
  });

  it('matches the estimator: a synthetic face turned 20° to the player’s right reads +20° in screen space', () => {
    const frame = uprightFrame(640, 480, 0, false);
    const focal = focalForHfov(63);
    const m = mountMatrix({ pos: [0, 0.16, 0], pitchDeg: 4, yawDeg: 0, rollDeg: 0 });
    // Eye 0.62 m in front of the camera, nose turned to the player's right and up.
    const cam = cameraAnglesFor(screenDir(20 * DEG, 8 * DEG), m);
    const face = synthFace({ eye: [0, 0.02, 0.62], yaw: cam.yaw, pitch: cam.pitch, frame, focal });
    const meas = measureFace(face, 0, frame, focal, createMeasurement())!;
    const h = headDirectionScreen(meas.yaw, meas.pitch, m);
    expect(h.yaw / DEG).toBeGreaterThan(18);
    expect(h.yaw / DEG).toBeLessThan(22);
    expect(h.pitch / DEG).toBeGreaterThan(6);
    expect(h.pitch / DEG).toBeLessThan(10);
  });

  it('measures relative to looking at the middle of the window, from anywhere', () => {
    for (const eye of [[0, 0, 0.6], [0.2, -0.1, 0.5], [-0.3, 0.4, 1.0]] as Vec3[]) {
      const toCentre = directionToCentre(eye);
      const rel = headRelativeToCentre(toCentre, eye);
      expect(Math.abs(rel.yaw)).toBeLessThan(1e-9);
      expect(Math.abs(rel.pitch)).toBeLessThan(1e-9);
    }
    // To look at the middle from the right, you turn left (negative yaw); from above, you look down.
    const c = directionToCentre([0.2, 0.3, 0.6]);
    expect(c.yaw).toBeLessThan(0);
    expect(c.pitch).toBeLessThan(0);
    // Turning the head 15° further to the right than the middle reads +15°.
    const rel = headRelativeToCentre({ yaw: c.yaw + 15 * DEG, pitch: c.pitch }, [0.2, 0.3, 0.6]);
    expect(rel.yaw / DEG).toBeCloseTo(15, 9);
  });
});

describe('head-turn offset', () => {
  it('has a continuous dead zone and a limit', () => {
    expect(shapeHeadAngle(HEAD_DEADZONE * 0.99)).toBe(0);
    expect(shapeHeadAngle(-HEAD_DEADZONE)).toBe(0);
    expect(shapeHeadAngle(HEAD_DEADZONE + 0.01)).toBeCloseTo(0.01, 12);
    expect(shapeHeadAngle(-(HEAD_DEADZONE + 0.01))).toBeCloseTo(-0.01, 12);
    expect(shapeHeadAngle(2)).toBe(HEAD_MAX_ANGLE);
    expect(shapeHeadAngle(Number.NaN)).toBe(0);
  });

  it('shifts the view in the direction the head turns, scaled by weight and viewing distance', () => {
    const out = headOffset(20 * DEG, -10 * DEG, 0.4, 0.62);
    expect(out[0]).toBeCloseTo(0.4 * 0.62 * Math.sin(20 * DEG - HEAD_DEADZONE), 12);
    expect(out[0]).toBeGreaterThan(0.07); // a modest ~8 cm for a 20° turn on a desktop
    expect(out[0]).toBeLessThan(0.09);
    expect(out[1]).toBeLessThan(0);
    // Larger installation, larger lever.
    expect(headOffset(20 * DEG, 0, 0.4, 0.95)[0]).toBeGreaterThan(out[0]);
    // Off.
    expect(headOffset(20 * DEG, 10 * DEG, 0, 0.62)).toEqual([0, 0]);
  });

  it('enters the view mapping before the gains and the soft limits', () => {
    const view = { ...defaultSettings().profiles.desktop.view, calibrated: true, calNeutral: [0, 0.14, 0.62] as Vec3 };
    const at: Vec3 = [0, 0.14, 0.62];
    expect(mapToViewpoint(at, view)).toEqual(mapToViewpoint(at, view, [0, 0, 0], null));
    const turned = mapToViewpoint(at, view, [0, 0, 0], [0.08, 0.03]);
    expect(turned[0] - view.eye[0]).toBeCloseTo(0.08, 9);
    expect(turned[1] - view.eye[1]).toBeCloseTo(0.03, 9);
    expect(turned[2]).toBeCloseTo(view.eye[2], 9);
    // Gain 0 switches the axis off completely, the limit always holds.
    expect(mapToViewpoint(at, { ...view, gainX: 0 }, [0, 0, 0], [0.08, 0])[0]).toBeCloseTo(view.eye[0], 9);
    expect(mapToViewpoint(at, view, [0, 0, 0], [5, 0])[0] - view.eye[0]).toBeLessThanOrEqual(view.maxOffset[0]);
    // Movement and head turn add up.
    const both = mapToViewpoint([0.05, 0.14, 0.62], view, [0, 0, 0], [0.03, 0]);
    expect(both[0] - view.eye[0]).toBeCloseTo(0.08, 9);
  });
});
