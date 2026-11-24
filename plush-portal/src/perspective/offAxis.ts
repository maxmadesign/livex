/**
 * Head-coupled (off-axis) perspective math. Pure functions, no Three.js, so the
 * invariants can be unit tested in Node.
 *
 * Conventions (axis-aligned window):
 *   - the centre of the effective window is the origin and the window lies in z = 0
 *   - +X right, +Y up, +Z towards the viewer; the cabinet lives in z < 0
 *   - E = (ex, ey, ez) is the midpoint between the eyes, ez > 0
 *   - W, H are the window width / height in the same unit as E
 *   - the camera sits at E, its axes stay aligned with the window axes and it
 *     looks along -Z (it never "looks at" the window centre)
 */

export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/** Smallest eye distance we ever divide by (window units). */
export const MIN_EYE_DISTANCE = 1e-3;

/**
 * Asymmetric frustum for an eye at (ex, ey, ez) looking through a W×H window
 * centred on the origin of the z = 0 plane.
 */
export function offAxisFrustum(
  ex: number,
  ey: number,
  ez: number,
  width: number,
  height: number,
  near: number,
  far: number,
  out: Frustum = { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 },
): Frustum {
  const d = Math.max(ez, MIN_EYE_DISTANCE);
  const k = near / d;
  out.left = k * (-width / 2 - ex);
  out.right = k * (width / 2 - ex);
  out.bottom = k * (-height / 2 - ey);
  out.top = k * (height / 2 - ey);
  out.near = near;
  out.far = far;
  return out;
}

/**
 * Picks near / far for an eye `ez` in front of the window. Nothing is ever
 * drawn in front of the window plane, so the near plane can sit close to it,
 * which keeps depth precision high. `near` is always < ez.
 */
export function chooseClipPlanes(ez: number, sceneDepth: number): { near: number; far: number } {
  const d = Math.max(ez, 0.05);
  const near = Math.min(d * 0.72, Math.max(0.02, d - 0.06));
  return { near, far: d + sceneDepth };
}

/** Column-major 4×4 (OpenGL clip space, z in [-1, 1]) for an asymmetric frustum. */
export function frustumMatrix(f: Frustum, out: Float64Array | number[] = new Float64Array(16)): Float64Array | number[] {
  const { left, right, top, bottom, near, far } = f;
  const x = (2 * near) / (right - left);
  const y = (2 * near) / (top - bottom);
  const a = (right + left) / (right - left);
  const b = (top + bottom) / (top - bottom);
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  out[0] = x;  out[4] = 0;  out[8] = a;   out[12] = 0;
  out[1] = 0;  out[5] = y;  out[9] = b;   out[13] = 0;
  out[2] = 0;  out[6] = 0;  out[10] = c;  out[14] = d;
  out[3] = 0;  out[7] = 0;  out[11] = -1; out[15] = 0;
  return out;
}

/**
 * Projects a point given in window coordinates to normalised device
 * coordinates for an eye at (ex, ey, ez). Returns [ndcX, ndcY, ndcZ].
 * (View matrix is a pure translation by -E because the camera axes are
 * aligned with the window axes.)
 */
export function projectPoint(
  px: number,
  py: number,
  pz: number,
  ex: number,
  ey: number,
  ez: number,
  width: number,
  height: number,
  near: number,
  far: number,
): [number, number, number] {
  const f = offAxisFrustum(ex, ey, ez, width, height, near, far);
  const m = frustumMatrix(f);
  const vx = px - ex;
  const vy = py - ey;
  const vz = pz - ez;
  const cx = m[0]! * vx + m[8]! * vz;
  const cy = m[5]! * vy + m[9]! * vz;
  const cz = m[10]! * vz + m[14]!;
  const cw = -vz;
  return [cx / cw, cy / cw, cz / cw];
}

/* ------------------------------------------------- generalised (tilted) window */

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: V3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Generalised perspective projection (Kooima) for a window that is not axis
 * aligned. `pa`, `pb`, `pc` are the lower-left, lower-right and upper-left
 * corners of the window in world space and `pe` is the eye.
 *
 * Returns the frustum extents plus the orthonormal window basis; the view
 * matrix is  R^T · T(-pe)  with R = [vr vu vn].
 */
export function generalizedFrustum(
  pa: V3,
  pb: V3,
  pc: V3,
  pe: V3,
  near: number,
  far: number,
): { frustum: Frustum; right: [number, number, number]; up: [number, number, number]; normal: [number, number, number] } {
  const vr = normalize(sub(pb, pa));
  const vu = normalize(sub(pc, pa));
  const vn = normalize(cross(vr, vu));
  const va = sub(pa, pe);
  const vb = sub(pb, pe);
  const vc = sub(pc, pe);
  const d = Math.max(-dot(va, vn), MIN_EYE_DISTANCE);
  const k = near / d;
  return {
    frustum: {
      left: dot(vr, va) * k,
      right: dot(vr, vb) * k,
      bottom: dot(vu, va) * k,
      top: dot(vu, vc) * k,
      near,
      far,
    },
    right: vr,
    up: vu,
    normal: vn,
  };
}
