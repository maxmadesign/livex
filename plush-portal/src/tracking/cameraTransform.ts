/**
 * Camera space → screen space. Pure functions.
 *
 * Camera space (pinhole): +X to the camera's right (image right), +Y down,
 * +Z along the optical axis, away from the camera.
 *
 * Screen space: origin at the centre of the physical screen, +X to the
 * viewer's right, +Y up, +Z out of the screen towards the viewer.
 *
 * The camera looks at the viewer, so an ideally mounted camera has
 *   camera +X = screen −X,  camera +Y = screen −Y,  camera +Z = screen +Z.
 * Mount angles rotate the camera away from that ideal pose:
 *   pitch > 0  the optical axis tilts down (towards −Y)
 *   yaw   > 0  the optical axis turns towards the viewer's right (+X)
 *   roll  > 0  the camera body is rotated clockwise as seen by the viewer
 * applied as  R = Ry(yaw) · Rx(pitch) · Rz(−roll).
 */
import type { Vec3 } from '../core/types';

const DEG = Math.PI / 180;

export interface CameraMount {
  /** Camera position relative to the centre of the screen, metres. */
  pos: Vec3;
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
}

/** Row-major 3×3 matrix that maps camera-space vectors to screen-space vectors. */
export function mountMatrix(mount: CameraMount, out: Float64Array = new Float64Array(9)): Float64Array {
  const p = mount.pitchDeg * DEG;
  const y = mount.yawDeg * DEG;
  const r = -mount.rollDeg * DEG;
  const cp = Math.cos(p), sp = Math.sin(p);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cr = Math.cos(r), sr = Math.sin(r);

  // Rz(r)
  const z00 = cr, z01 = -sr, z10 = sr, z11 = cr;
  // Rx(p) · Rz(r)
  const a00 = z00, a01 = z01, a02 = 0;
  const a10 = cp * z10, a11 = cp * z11, a12 = -sp;
  const a20 = sp * z10, a21 = sp * z11, a22 = cp;
  // Ry(y) · (Rx · Rz)
  const m00 = cy * a00 + sy * a20, m01 = cy * a01 + sy * a21, m02 = cy * a02 + sy * a22;
  const m10 = a10, m11 = a11, m12 = a12;
  const m20 = -sy * a00 + cy * a20, m21 = -sy * a01 + cy * a21, m22 = -sy * a02 + cy * a22;

  // Multiply by the base change B = diag(−1, −1, 1) (camera axes of the ideal mount).
  out[0] = -m00; out[1] = -m01; out[2] = m02;
  out[3] = -m10; out[4] = -m11; out[5] = m12;
  out[6] = -m20; out[7] = -m21; out[8] = m22;
  return out;
}

/** Transforms a camera-space point to screen space. */
export function cameraToScreen(pc: Readonly<Vec3>, matrix: Float64Array, pos: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = pc[0], y = pc[1], z = pc[2];
  out[0] = pos[0] + matrix[0]! * x + matrix[1]! * y + matrix[2]! * z;
  out[1] = pos[1] + matrix[3]! * x + matrix[4]! * y + matrix[5]! * z;
  out[2] = pos[2] + matrix[6]! * x + matrix[7]! * y + matrix[8]! * z;
  return out;
}

/** Inverse of {@link cameraToScreen} (the matrix is orthonormal, so its inverse is its transpose). */
export function screenToCamera(ps: Readonly<Vec3>, matrix: Float64Array, pos: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = ps[0] - pos[0], y = ps[1] - pos[1], z = ps[2] - pos[2];
  out[0] = matrix[0]! * x + matrix[3]! * y + matrix[6]! * z;
  out[1] = matrix[1]! * x + matrix[4]! * y + matrix[7]! * z;
  out[2] = matrix[2]! * x + matrix[5]! * y + matrix[8]! * z;
  return out;
}

/** Rotates a camera-space direction to screen space (no translation). */
export function rotateToScreen(dc: Readonly<Vec3>, matrix: Float64Array, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = dc[0], y = dc[1], z = dc[2];
  out[0] = matrix[0]! * x + matrix[1]! * y + matrix[2]! * z;
  out[1] = matrix[3]! * x + matrix[4]! * y + matrix[5]! * z;
  out[2] = matrix[6]! * x + matrix[7]! * y + matrix[8]! * z;
  return out;
}
