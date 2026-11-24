import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import { cameraToScreen, mountMatrix, rotateToScreen, screenToCamera } from '../../../src/tracking/cameraTransform';
import { eyeInCamera, measureFace } from '../../../src/tracking/eyeEstimator';
import {
  parseRotation,
  previewNeedsFlip,
  rotateNormalized,
  trueU,
  unrotateNormalized,
  uprightFrame,
  type SensorRotation,
} from '../../../src/tracking/frameGeometry';
import { focalForHfov, synthFace } from './syntheticFace';

const ROTATIONS: SensorRotation[] = [0, 90, 180, 270];
const ideal = { pos: [0, 0, 0] as Vec3, pitchDeg: 0, yawDeg: 0, rollDeg: 0 };

describe('frame geometry (sensor rotation / mirror)', () => {
  it('parses rotation settings', () => {
    expect(parseRotation('0')).toBe(0);
    expect(parseRotation('90')).toBe(90);
    expect(parseRotation('270')).toBe(270);
    expect(parseRotation(-90)).toBe(270);
    expect(parseRotation('garbage')).toBe(0);
  });

  it('rotates normalised coordinates clockwise', () => {
    // The raw top-left corner ends up top-right after a 90° clockwise rotation.
    expect(rotateNormalized(0, 0, 90)).toEqual([1, 0]);
    // The raw top-right corner ends up bottom-right.
    expect(rotateNormalized(1, 0, 90)).toEqual([1, 1]);
    expect(rotateNormalized(0, 0, 180)).toEqual([1, 1]);
    // 270° clockwise = 90° counter-clockwise: top-left goes to bottom-left.
    expect(rotateNormalized(0, 0, 270)).toEqual([0, 1]);
    expect(rotateNormalized(0.3, 0.8, 0)).toEqual([0.3, 0.8]);
  });

  it('unrotate is the exact inverse for every rotation', () => {
    for (const rotation of ROTATIONS) {
      for (const [u, v] of [[0.1, 0.2], [0.9, 0.35], [0.5, 0.5], [0, 1]] as const) {
        const [ru, rv] = rotateNormalized(u, v, rotation);
        const [bu, bv] = unrotateNormalized(ru, rv, rotation);
        expect(bu).toBeCloseTo(u, 12);
        expect(bv).toBeCloseTo(v, 12);
      }
    }
  });

  it('four quarter turns are the identity', () => {
    let p: [number, number] = [0.2, 0.7];
    for (let i = 0; i < 4; i++) p = rotateNormalized(p[0], p[1], 90);
    expect(p[0]).toBeCloseTo(0.2, 12);
    expect(p[1]).toBeCloseTo(0.7, 12);
  });

  it('swaps the upright frame size for quarter turns and keeps pixels square', () => {
    const a = uprightFrame(1280, 720, 0, false);
    expect([a.width, a.height]).toEqual([640, 360]);
    const b = uprightFrame(1280, 720, 90, false);
    expect([b.width, b.height]).toEqual([360, 640]);
    expect([b.pixelWidth, b.pixelHeight]).toEqual([720, 1280]);
    const c = uprightFrame(640, 480, 270, true);
    expect([c.width, c.height, c.mirror]).toEqual([480, 640, true]);
  });

  it('mirrors exactly once: preview flip and un-mirroring are complementary', () => {
    // Normal camera: math uses the frame as is, the preview is flipped to look like a mirror.
    expect(trueU(0.2, false)).toBe(0.2);
    expect(previewNeedsFlip(false)).toBe(true);
    // Camera that already mirrors: math un-mirrors, the preview must NOT flip again.
    expect(trueU(0.2, true)).toBeCloseTo(0.8, 12);
    expect(previewNeedsFlip(true)).toBe(false);
  });
});

describe('camera → screen transform', () => {
  it('ideal mount: camera right is screen left, camera down is screen down, depth is +Z', () => {
    const m = mountMatrix(ideal);
    expect(cameraToScreen([0.2, 0.1, 0.9], m, [0, 0, 0])).toEqual([-0.2, -0.1, 0.9]);
    // A viewer standing to THEIR right (+X) appears on the camera's left (negative camera x).
    const viewerRight = screenToCamera([0.3, 0, 1], m, [0, 0, 0]);
    expect(viewerRight[0]).toBeCloseTo(-0.3, 12);
  });

  it('adds the camera position', () => {
    const m = mountMatrix(ideal);
    const p = cameraToScreen([0, 0, 1], m, [0.05, 0.98, 0.01]);
    expect(p[0]).toBeCloseTo(0.05, 12);
    expect(p[1]).toBeCloseTo(0.98, 12);
    expect(p[2]).toBeCloseTo(1.01, 12);
  });

  it('positive pitch tilts the optical axis down', () => {
    const m = mountMatrix({ ...ideal, pitchDeg: 20 });
    const axis = rotateToScreen([0, 0, 1], m);
    expect(axis[0]).toBeCloseTo(0, 12);
    expect(axis[1]).toBeCloseTo(-Math.sin((20 * Math.PI) / 180), 12);
    expect(axis[2]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 12);
  });

  it('positive yaw turns the optical axis towards the viewer\'s right', () => {
    const m = mountMatrix({ ...ideal, yawDeg: 15 });
    const axis = rotateToScreen([0, 0, 1], m);
    expect(axis[0]).toBeCloseTo(Math.sin((15 * Math.PI) / 180), 12);
    expect(axis[1]).toBeCloseTo(0, 12);
  });

  it('positive roll is a clockwise camera body as seen by the viewer', () => {
    const m = mountMatrix({ ...ideal, rollDeg: 90 });
    // The camera's right-hand side now points up on the screen …
    const right = rotateToScreen([1, 0, 0], m);
    expect(right[0]).toBeCloseTo(0, 12);
    expect(right[1]).toBeCloseTo(1, 12);
    // … and its "up" (camera −Y) points to the viewer's right.
    const up = rotateToScreen([0, -1, 0], m);
    expect(up[0]).toBeCloseTo(1, 12);
    expect(up[1]).toBeCloseTo(0, 12);
  });

  it('is a proper rotation and its inverse is exact', () => {
    const mount = { pos: [0.1, 0.9, 0.02] as Vec3, pitchDeg: 18, yawDeg: -7, rollDeg: 4 };
    const m = mountMatrix(mount);
    // Orthonormal rows, determinant +1.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += m[r * 3 + k]! * m[c * 3 + k]!;
        expect(dot).toBeCloseTo(r === c ? 1 : 0, 12);
      }
    }
    const det =
      m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 12);
    const p: Vec3 = [0.31, -0.22, 1.4];
    const back = screenToCamera(cameraToScreen(p, m, mount.pos), m, mount.pos);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!, 12);
  });
});

describe('full chain: screen-space truth → pinhole camera → landmarks → estimate → screen space', () => {
  const focal = focalForHfov(70);
  const mounts = [
    { pos: [0, 0.37, 0] as Vec3, pitchDeg: 8, yawDeg: 0, rollDeg: 0 },
    { pos: [0, 0.98, 0] as Vec3, pitchDeg: 18, yawDeg: 0, rollDeg: 0 },
    { pos: [0.12, 0.16, 0.01] as Vec3, pitchDeg: 4, yawDeg: -6, rollDeg: 3 },
    { pos: [0, -0.2, 0] as Vec3, pitchDeg: -12, yawDeg: 5, rollDeg: -2 },
  ];
  const eyes: Vec3[] = [
    [0, 0.2, 0.62],
    [0.25, 0.1, 0.8],
    [-0.3, 0.45, 1.1],
    [0.1, 0.55, 0.95],
  ];

  it('recovers the true eye position for tilted, offset cameras', () => {
    const frame = uprightFrame(640, 480, 0, false);
    for (const mount of mounts) {
      const m = mountMatrix(mount);
      for (const truth of eyes) {
        const pc = screenToCamera(truth, m, mount.pos);
        const packed = synthFace({ eye: pc, frame, focal });
        const meas = measureFace(packed, 0, frame, focal)!;
        const got = cameraToScreen(eyeInCamera(meas), m, mount.pos);
        for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - truth[i]!)).toBeLessThan(0.002);
      }
    }
  });

  it('a viewer moving right / up / back moves the estimate right / up / back', () => {
    const frame = uprightFrame(640, 480, 0, false);
    const mount = mounts[1]!;
    const m = mountMatrix(mount);
    const at = (truth: Vec3) => {
      const pc = screenToCamera(truth, m, mount.pos);
      const meas = measureFace(synthFace({ eye: pc, frame, focal }), 0, frame, focal)!;
      return cameraToScreen(eyeInCamera(meas), m, mount.pos);
    };
    const base = at([0, 0.5, 0.95]);
    expect(at([0.15, 0.5, 0.95])[0] - base[0]).toBeGreaterThan(0.14);
    expect(at([-0.15, 0.5, 0.95])[0] - base[0]).toBeLessThan(-0.14);
    expect(at([0, 0.6, 0.95])[1] - base[1]).toBeGreaterThan(0.09);
    expect(at([0, 0.5, 1.2])[2] - base[2]).toBeGreaterThan(0.24);
  });

  it('a sideways mounted sensor gives the same answer once its rotation is configured', () => {
    // The raw sensor axes of a camera whose image must be rotated clockwise by `rotation`
    // to become upright, expressed in the upright camera frame.
    const rawFromUpright = (p: Vec3, rotation: SensorRotation): Vec3 => {
      switch (rotation) {
        case 90:
          return [p[1], -p[0], p[2]];
        case 180:
          return [-p[0], -p[1], p[2]];
        case 270:
          return [-p[1], p[0], p[2]];
        default:
          return p;
      }
    };
    const rawW = 640;
    const rawH = 480;
    const mount = mounts[0]!;
    const m = mountMatrix(mount);
    const truth: Vec3 = [0.18, 0.3, 0.9];
    const pUpright = screenToCamera(truth, m, mount.pos);
    for (const rotation of ROTATIONS) {
      // 1. Geometry check: projecting in the raw frame and rotating the image coordinates
      //    equals projecting directly in the upright frame.
      const pRaw = rawFromUpright(pUpright, rotation);
      const uRaw = 0.5 + (focal * pRaw[0]) / pRaw[2] / rawW;
      const vRaw = 0.5 + (focal * pRaw[1]) / pRaw[2] / (rawH * (640 / rawW));
      const [u, v] = rotateNormalized(uRaw, vRaw, rotation);
      const frame = uprightFrame(rawW, rawH, rotation, false);
      const uDirect = 0.5 + (focal * pUpright[0]) / pUpright[2] / frame.width;
      const vDirect = 0.5 + (focal * pUpright[1]) / pUpright[2] / frame.height;
      expect(u).toBeCloseTo(uDirect, 9);
      expect(v).toBeCloseTo(vDirect, 9);
      // 2. End to end through the estimator with the upright frame of that sensor.
      const meas = measureFace(synthFace({ eye: pUpright, frame, focal }), 0, frame, focal)!;
      const got = cameraToScreen(eyeInCamera(meas), m, mount.pos);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - truth[i]!)).toBeLessThan(0.002);
    }
  });

  it('a mirroring camera is handled by the mirror flag alone (no double flip)', () => {
    const mount = mounts[0]!;
    const m = mountMatrix(mount);
    const truth: Vec3 = [0.22, 0.25, 0.85];
    const pc = screenToCamera(truth, m, mount.pos);
    const mirrored = uprightFrame(640, 480, 0, true);
    const meas = measureFace(synthFace({ eye: pc, frame: mirrored, focal }), 0, mirrored, focal)!;
    const got = cameraToScreen(eyeInCamera(meas), m, mount.pos);
    expect(got[0]).toBeCloseTo(truth[0], 2);
    // Forgetting the flag would put the viewer on the wrong side:
    const plain = uprightFrame(640, 480, 0, false);
    const wrong = measureFace(synthFace({ eye: pc, frame: mirrored, focal }), 0, plain, focal)!;
    const wrongScreen = cameraToScreen(eyeInCamera(wrong), m, mount.pos);
    expect(Math.sign(wrongScreen[0])).toBe(-Math.sign(truth[0]));
  });
});
