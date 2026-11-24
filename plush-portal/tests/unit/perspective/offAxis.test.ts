import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import {
  MIN_EYE_DISTANCE,
  chooseClipPlanes,
  frustumMatrix,
  generalizedFrustum,
  offAxisFrustum,
  projectPoint,
} from '../../../src/perspective/offAxis';

/** Nominal 86" portrait panel (metres) – any consistent unit works. */
const W = 1.071;
const H = 1.904;

function randomEyes(count: number, seed = 1): [number, number, number][] {
  const rng = makeRng(seed);
  const eyes: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    eyes.push([(rng() - 0.5) * 2.4, (rng() - 0.5) * 2.4, 0.25 + rng() * 2.5]);
  }
  // Plus a few deliberate ones: centred, far off to each side, very close, far away.
  eyes.push([0, 0, 0.95], [0.9, 0, 0.6], [-0.9, 0.7, 0.6], [0, -1.2, 1.5], [0.3, 0.5, 0.2], [0, 0, 6]);
  return eyes;
}

const project = (p: [number, number, number], e: [number, number, number], w = W, h = H) => {
  const { near, far } = chooseClipPlanes(e[2], 14);
  return projectPoint(p[0], p[1], p[2], e[0], e[1], e[2], w, h, near, far);
};

describe('offAxisFrustum', () => {
  it('implements the documented asymmetric frustum', () => {
    const [ex, ey, ez] = [0.2, -0.1, 0.9];
    const n = 0.5;
    const f = offAxisFrustum(ex, ey, ez, W, H, n, 20);
    expect(f.left).toBeCloseTo((n * (-W / 2 - ex)) / ez, 12);
    expect(f.right).toBeCloseTo((n * (W / 2 - ex)) / ez, 12);
    expect(f.bottom).toBeCloseTo((n * (-H / 2 - ey)) / ez, 12);
    expect(f.top).toBeCloseTo((n * (H / 2 - ey)) / ez, 12);
    expect(f.near).toBe(n);
    expect(f.far).toBe(20);
  });

  it('is symmetric only when the eye is centred', () => {
    const centred = offAxisFrustum(0, 0, 1, W, H, 0.5, 20);
    expect(centred.left).toBeCloseTo(-centred.right, 12);
    expect(centred.bottom).toBeCloseTo(-centred.top, 12);
    const off = offAxisFrustum(0.3, 0.2, 1, W, H, 0.5, 20);
    expect(Math.abs(off.left)).toBeGreaterThan(Math.abs(off.right));
    expect(Math.abs(off.bottom)).toBeGreaterThan(Math.abs(off.top));
  });

  it('keeps the same width / height regardless of the eye offset', () => {
    const a = offAxisFrustum(0, 0, 0.8, W, H, 0.4, 20);
    const b = offAxisFrustum(0.5, -0.4, 0.8, W, H, 0.4, 20);
    expect(b.right - b.left).toBeCloseTo(a.right - a.left, 12);
    expect(b.top - b.bottom).toBeCloseTo(a.top - a.bottom, 12);
  });

  it('never divides by zero for an eye on the window plane', () => {
    const f = offAxisFrustum(0.1, 0.1, 0, W, H, 0.01, 10);
    for (const v of [f.left, f.right, f.top, f.bottom]) expect(Number.isFinite(v)).toBe(true);
    expect(MIN_EYE_DISTANCE).toBeGreaterThan(0);
  });
});

describe('the window is fixed on screen (head-coupled invariants)', () => {
  it('the four window corners project to NDC (±1, ±1) for every eye position', () => {
    for (const eye of randomEyes(200)) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const [x, y] = project([(sx * W) / 2, (sy * H) / 2, 0], eye);
          expect(x).toBeCloseTo(sx, 9);
          expect(y).toBeCloseTo(sy, 9);
        }
      }
    }
  });

  it('every point of the window plane keeps its screen position', () => {
    const rng = makeRng(3);
    for (const eye of randomEyes(60, 2)) {
      for (let i = 0; i < 6; i++) {
        const px = (rng() - 0.5) * W;
        const py = (rng() - 0.5) * H;
        const [x, y] = project([px, py, 0], eye);
        expect(x).toBeCloseTo((2 * px) / W, 9);
        expect(y).toBeCloseTo((2 * py) / H, 9);
      }
    }
  });

  it('holds for any window shape (desktop, 32", 86")', () => {
    for (const [w, h] of [[0.531, 0.299], [0.398, 0.708], [1.071, 1.904], [2.3, 1.3]] as const) {
      for (const eye of randomEyes(20, 5)) {
        const [x, y] = project([w / 2, -h / 2, 0], eye, w, h);
        expect(x).toBeCloseTo(1, 9);
        expect(y).toBeCloseTo(-1, 9);
      }
    }
  });
});

describe('motion parallax behind the window', () => {
  const screenX = (p: [number, number, number], e: [number, number, number]) => (project(p, e)[0] * W) / 2;
  const screenY = (p: [number, number, number], e: [number, number, number]) => (project(p, e)[1] * H) / 2;

  it('matches the similar-triangles formula  x_s = e_x + (p_x − e_x) · e_z / (e_z + d)', () => {
    const rng = makeRng(8);
    for (const eye of randomEyes(80, 4)) {
      const p: [number, number, number] = [(rng() - 0.5) * 1.0, (rng() - 0.5) * 1.6, -rng() * 0.9];
      const d = -p[2];
      const k = eye[2] / (eye[2] + d);
      expect(screenX(p, eye)).toBeCloseTo(eye[0] + (p[0] - eye[0]) * k, 9);
      expect(screenY(p, eye)).toBeCloseTo(eye[1] + (p[1] - eye[1]) * k, 9);
    }
  });

  it('points at different depths shift by different amounts, in the direction of the head movement', () => {
    const before: [number, number, number] = [0, 0.4, 0.95];
    const after: [number, number, number] = [0.2, 0.4, 0.95]; // the viewer steps 20 cm to the right
    const shift = (depth: number) => screenX([0.1, 0.2, -depth], after) - screenX([0.1, 0.2, -depth], before);
    const glass = shift(0);
    const front = shift(0.15);
    const middle = shift(0.45);
    const back = shift(0.85);
    expect(glass).toBeCloseTo(0, 12); // the glass does not move
    // Deeper objects follow the viewer more: 0 < front < middle < back < head movement.
    expect(front).toBeGreaterThan(0.01);
    expect(middle).toBeGreaterThan(front + 0.01);
    expect(back).toBeGreaterThan(middle + 0.01);
    expect(back).toBeLessThan(0.2);
    // Exact amounts: Δe · d / (e_z + d).
    expect(front).toBeCloseTo((0.2 * 0.15) / (0.95 + 0.15), 9);
    expect(back).toBeCloseTo((0.2 * 0.85) / (0.95 + 0.85), 9);
  });

  it('vertical and depth movement of the head produce the expected parallax', () => {
    const p: [number, number, number] = [0.2, -0.3, -0.6];
    // Head up → deep points move up on screen.
    expect(screenY(p, [0, 0.6, 1])).toBeGreaterThan(screenY(p, [0, 0.4, 1]));
    // Stepping closer makes deep points drift away from the eye's foot point on the screen
    // (they appear "smaller"): |x_s − e_x| shrinks as e_z shrinks.
    const near = Math.abs(screenX(p, [0, 0, 0.5]));
    const far = Math.abs(screenX(p, [0, 0, 1.5]));
    expect(near).toBeLessThan(far);
  });

  it('is independent of the unit: scaling eye, window and scene together changes nothing', () => {
    const s = 3.7; // e.g. a desktop monitor mapped onto the life-size virtual cabinet
    const eye: [number, number, number] = [0.07, 0.12, 0.6];
    const p: [number, number, number] = [0.1, -0.05, -0.2];
    const a = projectPoint(p[0], p[1], p[2], eye[0], eye[1], eye[2], 0.531, 0.299, 0.3, 10);
    const b = projectPoint(p[0] * s, p[1] * s, p[2] * s, eye[0] * s, eye[1] * s, eye[2] * s, 0.531 * s, 0.299 * s, 0.3 * s, 10 * s);
    expect(b[0]).toBeCloseTo(a[0], 10);
    expect(b[1]).toBeCloseTo(a[1], 10);
    expect(b[2]).toBeCloseTo(a[2], 10);
  });
});

describe('clip planes', () => {
  it('near is positive and strictly smaller than the eye distance; far covers the cabinet', () => {
    for (let ez = 0.03; ez < 12; ez *= 1.07) {
      const { near, far } = chooseClipPlanes(ez, 14);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThan(ez);
      expect(far).toBeGreaterThanOrEqual(ez + 14);
    }
  });

  it('window-plane points lie inside the depth range and depth increases monotonically', () => {
    for (const eye of randomEyes(30, 9)) {
      const depths = [0, 0.1, 0.5, 1, 3, 10].map((d) => project([0, 0, -d], eye)[2]);
      for (const z of depths) {
        expect(z).toBeGreaterThan(-1);
        expect(z).toBeLessThan(1);
      }
      for (let i = 1; i < depths.length; i++) expect(depths[i]!).toBeGreaterThan(depths[i - 1]!);
    }
  });
});

describe('frustumMatrix', () => {
  it('equals Three.js Matrix4.makePerspective(left, right, top, bottom, near, far)', () => {
    for (const eye of randomEyes(40, 6)) {
      const { near, far } = chooseClipPlanes(eye[2], 14);
      const f = offAxisFrustum(eye[0], eye[1], eye[2], W, H, near, far);
      const ours = frustumMatrix(f);
      const three = new Matrix4().makePerspective(f.left, f.right, f.top, f.bottom, f.near, f.far);
      for (let i = 0; i < 16; i++) expect(ours[i]).toBeCloseTo(three.elements[i]!, 12);
    }
  });

  it('has the off-axis terms exactly where expected', () => {
    const f = offAxisFrustum(0.3, -0.2, 1, W, H, 0.5, 20);
    const m = frustumMatrix(f);
    expect(m[8]).toBeCloseTo((f.right + f.left) / (f.right - f.left), 12);
    expect(m[9]).toBeCloseTo((f.top + f.bottom) / (f.top - f.bottom), 12);
    expect(m[8]).not.toBe(0);
    expect(m[11]).toBe(-1);
    expect(m[15]).toBe(0);
  });
});

describe('generalizedFrustum (tilted windows)', () => {
  it('equals the axis-aligned frustum for an untilted window', () => {
    for (const eye of randomEyes(40, 7)) {
      const { near, far } = chooseClipPlanes(eye[2], 14);
      const g = generalizedFrustum([-W / 2, -H / 2, 0], [W / 2, -H / 2, 0], [-W / 2, H / 2, 0], eye, near, far);
      const f = offAxisFrustum(eye[0], eye[1], eye[2], W, H, near, far);
      expect(g.frustum.left).toBeCloseTo(f.left, 12);
      expect(g.frustum.right).toBeCloseTo(f.right, 12);
      expect(g.frustum.bottom).toBeCloseTo(f.bottom, 12);
      expect(g.frustum.top).toBeCloseTo(f.top, 12);
      expect(g.right).toEqual([1, 0, 0]);
      expect(g.up).toEqual([0, 1, 0]);
      expect(g.normal).toEqual([0, 0, 1]);
    }
  });

  it('maps the corners of a tilted, shifted window to the NDC corners', () => {
    // A window leaning back by 20° and shifted in space.
    const tilt = (20 * Math.PI) / 180;
    const c = [0.3, 1.2, -0.4];
    const right = [1, 0, 0];
    const up = [0, Math.cos(tilt), -Math.sin(tilt)];
    const corner = (sx: number, sy: number): [number, number, number] => [
      c[0]! + (sx * W * right[0]!) / 2 + (sy * H * up[0]!) / 2,
      c[1]! + (sx * W * right[1]!) / 2 + (sy * H * up[1]!) / 2,
      c[2]! + (sx * W * right[2]!) / 2 + (sy * H * up[2]!) / 2,
    ];
    const pa = corner(-1, -1);
    const pb = corner(1, -1);
    const pc = corner(-1, 1);
    const pd = corner(1, 1);
    const eye: [number, number, number] = [0.5, 1.7, 0.9];
    const g = generalizedFrustum(pa, pb, pc, eye, 0.3, 30);
    const projection = new Matrix4().makePerspective(g.frustum.left, g.frustum.right, g.frustum.top, g.frustum.bottom, 0.3, 30);
    // View = Rᵀ · T(−eye) with R = [right up normal].
    const toNdc = (p: [number, number, number]) => {
      const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const v = [
        d[0]! * g.right[0] + d[1]! * g.right[1] + d[2]! * g.right[2],
        d[0]! * g.up[0] + d[1]! * g.up[1] + d[2]! * g.up[2],
        d[0]! * g.normal[0] + d[1]! * g.normal[1] + d[2]! * g.normal[2],
      ];
      const e = projection.elements;
      const x = e[0]! * v[0]! + e[8]! * v[2]!;
      const y = e[5]! * v[1]! + e[9]! * v[2]!;
      const w = -v[2]!;
      return [x / w, y / w];
    };
    const expectNdc = (p: [number, number, number], x: number, y: number) => {
      const n = toNdc(p);
      expect(n[0]).toBeCloseTo(x, 9);
      expect(n[1]).toBeCloseTo(y, 9);
    };
    expectNdc(pa, -1, -1);
    expectNdc(pb, 1, -1);
    expectNdc(pc, -1, 1);
    expectNdc(pd, 1, 1);
  });
});
