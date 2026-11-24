import { Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import { OffAxisCamera } from '../../../src/perspective/OffAxisCamera';
import { offAxisFrustum } from '../../../src/perspective/offAxis';

/** A window like the 86" layout: centre below the origin, 1.06 × 1.884 world units, in the plane z = 0. */
const WIN = { x: 0, y: -0.038, z: 0, w: 1.06, h: 1.884 };

function makeCamera(eye: [number, number, number] = [0, 0.45, 0.95]): OffAxisCamera {
  const camera = new OffAxisCamera();
  camera.setWindow(WIN.x, WIN.y, WIN.z, WIN.w, WIN.h);
  camera.setEyeWorld(eye[0], eye[1], eye[2]);
  return camera;
}

const corners = (win = WIN): [Vector3, number, number][] => [
  [new Vector3(win.x - win.w / 2, win.y - win.h / 2, win.z), -1, -1],
  [new Vector3(win.x + win.w / 2, win.y - win.h / 2, win.z), 1, -1],
  [new Vector3(win.x - win.w / 2, win.y + win.h / 2, win.z), -1, 1],
  [new Vector3(win.x + win.w / 2, win.y + win.h / 2, win.z), 1, 1],
];

function expectCornersPinned(camera: OffAxisCamera, win = WIN): void {
  for (const [point, x, y] of corners(win)) {
    const ndc = point.clone().project(camera);
    expect(ndc.x).toBeCloseTo(x, 6);
    expect(ndc.y).toBeCloseTo(y, 6);
  }
}

function randomEyes(count: number): [number, number, number][] {
  const rng = makeRng(17);
  const eyes: [number, number, number][] = [];
  for (let i = 0; i < count; i++) eyes.push([(rng() - 0.5) * 2, (rng() - 0.5) * 2.4, 0.2 + rng() * 3]);
  return eyes;
}

describe('OffAxisCamera', () => {
  it('pins the window corners to the screen corners for every eye position', () => {
    const camera = makeCamera();
    for (const eye of randomEyes(150)) {
      camera.setEyeWorld(eye[0], eye[1], eye[2]);
      expectCornersPinned(camera);
    }
  });

  it('keeps every point of the window plane fixed while the scene behind it shows parallax', () => {
    const camera = makeCamera([0, 0.45, 0.95]);
    const onGlass = new Vector3(0.2, 0.3, 0);
    const front = new Vector3(0.2, 0.3, -0.1);
    const back = new Vector3(0.2, 0.3, -0.8);
    const a = [onGlass, front, back].map((p) => p.clone().project(camera).x);
    camera.setEyeWorld(0.25, 0.45, 0.95); // viewer moves right
    const b = [onGlass, front, back].map((p) => p.clone().project(camera).x);
    expect(b[0]! - a[0]!).toBeCloseTo(0, 9);
    const shiftFront = b[1]! - a[1]!;
    const shiftBack = b[2]! - a[2]!;
    expect(shiftFront).toBeGreaterThan(0.01);
    expect(shiftBack).toBeGreaterThan(shiftFront * 2);
  });

  it('uses exactly makePerspective(left, right, top, bottom, near, far) of the off-axis frustum', () => {
    const camera = makeCamera([0.3, 0.6, 1.1]);
    const local = camera.getEyeLocal();
    const f = offAxisFrustum(local.x, local.y, local.z, WIN.w, WIN.h, camera.near, camera.far);
    const expected = new Matrix4().makePerspective(f.left, f.right, f.top, f.bottom, f.near, f.far);
    for (let i = 0; i < 16; i++) expect(camera.projectionMatrix.elements[i]).toBeCloseTo(expected.elements[i]!, 12);
    // Off-centre eye ⇒ asymmetric projection.
    expect(Math.abs(camera.projectionMatrix.elements[8]!)).toBeGreaterThan(0.1);
    expect(Math.abs(camera.projectionMatrix.elements[9]!)).toBeGreaterThan(0.1);
  });

  it('keeps projectionMatrixInverse, matrixWorld and matrixWorldInverse in sync', () => {
    const camera = makeCamera();
    for (const eye of randomEyes(25)) {
      camera.setEyeWorld(eye[0], eye[1], eye[2]);
      const identity = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.projectionMatrixInverse);
      const viewIdentity = new Matrix4().multiplyMatrices(camera.matrixWorld, camera.matrixWorldInverse);
      const reference = new Matrix4();
      for (let i = 0; i < 16; i++) {
        expect(identity.elements[i]).toBeCloseTo(reference.elements[i]!, 8);
        expect(viewIdentity.elements[i]).toBeCloseTo(reference.elements[i]!, 10);
      }
    }
  });

  it('sits at the eye and never rotates: its axes stay aligned with the window', () => {
    const camera = makeCamera([0.4, -0.3, 0.7]);
    const e = camera.matrixWorld.elements;
    // Rotation part is the identity (no lookAt towards the window centre).
    expect([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // Translation is the eye.
    expect([e[12], e[13], e[14]]).toEqual([0.4, -0.3, 0.7]);
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(0, 12);
    expect(direction.z).toBeCloseTo(-1, 12);
    expect(camera.matrixAutoUpdate).toBe(false);
  });

  it('cannot be reset to a symmetric frustum by updateProjectionMatrix() (resize handlers, passes)', () => {
    const camera = makeCamera([0.35, 0.7, 0.9]);
    const before = camera.projectionMatrix.clone();
    // What a generic resize handler or post-processing pass typically does:
    camera.aspect = 16 / 9;
    camera.fov = 50;
    camera.zoom = 2;
    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    for (let i = 0; i < 16; i++) expect(camera.projectionMatrix.elements[i]).toBeCloseTo(before.elements[i]!, 12);
    expectCornersPinned(camera);
    // The informational fields are restored from the window geometry.
    expect(camera.aspect).toBeCloseTo(WIN.w / WIN.h, 12);
    expect(camera.near).toBeLessThan(0.9);
    // The renderer's per-frame matrix update does not disturb anything either.
    camera.updateMatrixWorld(true);
    expectCornersPinned(camera);
    expect(camera.position.toArray()).toEqual([0.35, 0.7, 0.9]);
  });

  it('follows a window resize: the new window is pinned, the eye does not move in the world', () => {
    const camera = makeCamera([0.2, 0.5, 1.0]);
    const eyeBefore = camera.position.clone();
    const wide = { x: 0, y: -0.22, z: 0, w: 2.31, h: 1.3 }; // landscape layout
    camera.setWindow(wide.x, wide.y, wide.z, wide.w, wide.h);
    expect(camera.position.equals(eyeBefore)).toBe(true);
    expectCornersPinned(camera, wide);
    expect(camera.getWindow()).toEqual({ x: 0, y: -0.22, z: 0, width: 2.31, height: 1.3 });
    // The eye relative to the window centre changed because the centre moved, not the eye.
    expect(camera.getEyeLocal().y).toBeCloseTo(0.5 + 0.22, 12);
    // Objects in the world keep their world positions: only their projection changed.
    const world = new Vector3(0.1, 0.2, -0.4);
    const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
    expect(view.x).toBeCloseTo(0.1 - 0.2, 12);
    expect(view.y).toBeCloseTo(0.2 - 0.5, 12);
    expect(view.z).toBeCloseTo(-0.4 - 1.0, 12);
  });

  it('keeps near in front of the window plane and far behind the cabinet', () => {
    const camera = makeCamera();
    for (const eye of randomEyes(40)) {
      camera.setEyeWorld(eye[0], eye[1], eye[2]);
      const ez = camera.getEyeLocal().z;
      expect(camera.near).toBeGreaterThan(0);
      expect(camera.near).toBeLessThan(ez);
      expect(camera.far).toBeGreaterThanOrEqual(ez + camera.sceneDepth);
      // A point on the glass and one at the back of the cabinet are both inside the clip range.
      for (const z of [0, -0.85, -5]) {
        const ndc = new Vector3(0, 0, z).project(camera);
        expect(ndc.z).toBeGreaterThan(-1);
        expect(ndc.z).toBeLessThan(1);
      }
    }
  });

  it('keeps the eye in front of the window even for invalid input', () => {
    const camera = makeCamera();
    camera.setEyeWorld(0.1, 0.1, -3);
    expect(camera.position.z).toBeGreaterThan(WIN.z);
    for (const v of camera.projectionMatrix.elements) expect(Number.isFinite(v)).toBe(true);
    camera.setEyeWorld(0.1, 0.1, 0);
    expect(camera.position.z).toBeGreaterThan(WIN.z);
    for (const v of camera.projectionMatrixInverse.elements) expect(Number.isFinite(v)).toBe(true);
  });

  it('un-projects and ray-casts consistently (picking through the window)', () => {
    const camera = makeCamera([0.3, 0.2, 0.8]);
    // The ray through NDC (1, 1) passes through the top-right corner of the window.
    const near = new Vector3(1, 1, -1).unproject(camera);
    const far = new Vector3(1, 1, 1).unproject(camera);
    const t = (0 - near.z) / (far.z - near.z);
    const hit = near.clone().lerp(far, t);
    expect(hit.x).toBeCloseTo(WIN.x + WIN.w / 2, 6);
    expect(hit.y).toBeCloseTo(WIN.y + WIN.h / 2, 6);
    // Raycaster uses matrixWorld + projectionMatrixInverse.
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(-0.5, 0.25), camera);
    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;
    expect(origin.x).toBeCloseTo(0.3, 9);
    expect(origin.y).toBeCloseTo(0.2, 9);
    expect(origin.z).toBeCloseTo(0.8, 9);
    const s = (0 - origin.z) / direction.z;
    expect(origin.x + direction.x * s).toBeCloseTo(WIN.x - 0.25 * WIN.w, 6);
    expect(origin.y + direction.y * s).toBeCloseTo(WIN.y + 0.125 * WIN.h, 6);
  });

  it('works for a window that is not at z = 0', () => {
    const camera = new OffAxisCamera();
    const win = { x: 0.2, y: 0.1, z: -0.5, w: 1.2, h: 0.8 };
    camera.setWindow(win.x, win.y, win.z, win.w, win.h);
    camera.setEyeWorld(0.5, 0.4, 0.3);
    expectCornersPinned(camera, win);
    expect(camera.getEyeLocal().z).toBeCloseTo(0.8, 12);
  });

  it('is usable right after construction (before any window / eye was set)', () => {
    const camera = new OffAxisCamera();
    for (const v of camera.projectionMatrix.elements) expect(Number.isFinite(v)).toBe(true);
    expect(camera.isPerspectiveCamera).toBe(true);
    // Default: unit window at the origin, eye one unit in front.
    const ndc = new Vector3(0.5, 0.5, 0).project(camera);
    expect(ndc.x).toBeCloseTo(1, 9);
    expect(ndc.y).toBeCloseTo(1, 9);
  });
});
