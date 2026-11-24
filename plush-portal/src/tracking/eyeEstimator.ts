/**
 * Landmarks → eye position in camera space. Pure functions (no DOM).
 *
 * Depth is NOT taken from MediaPipe's landmark z. Instead a weak-perspective
 * (2×3 affine) camera is fitted between the rigid landmarks of the canonical
 * 3D face model and their 2D image positions. For a rigid object the rows of
 * that matrix are `s · r1` and `s · r2` with r1 ⟂ r2 unit vectors, so the scale
 * `s` (pixels per metre at the face) is recovered for ANY head rotation:
 * turning or nodding in place changes the rotation rows, not `s`. The same
 * fit yields the head orientation, which is only used as an auxiliary
 * correction (depth offset of the eyes, quality checks) and for diagnostics –
 * it never becomes the viewpoint.
 */
import type { Vec3 } from '../core/types';
import type { UprightFrame } from './frameGeometry';
import {
  BASIS_CENTROID,
  BASIS_SLOTS,
  CANONICAL_EYE_MID,
  EYE_CORNER_SLOTS,
  FACE_BASIS,
  FLOATS_PER_LANDMARK,
  REFERENCE_FRAME_WIDTH,
  REFERENCE_IPD_M,
} from './landmarks';

const N = FACE_BASIS.length;

/** Canonical basis points relative to their weighted centroid (metres) and weights. */
const DPX = new Float64Array(N);
const DPY = new Float64Array(N);
const DPZ = new Float64Array(N);
const WEIGHT = new Float64Array(N);

/** Inverse of the weighted covariance of the canonical basis (row-major 3×3). */
const INV_COV = new Float64Array(9);

(() => {
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const p = FACE_BASIS[i]!;
    const dx = p.x - BASIS_CENTROID[0];
    const dy = p.y - BASIS_CENTROID[1];
    const dz = p.z - BASIS_CENTROID[2];
    DPX[i] = dx;
    DPY[i] = dy;
    DPZ[i] = dz;
    WEIGHT[i] = p.weight;
    const w = p.weight;
    c[0]! += w * dx * dx; c[1]! += w * dx * dy; c[2]! += w * dx * dz;
    c[4]! += w * dy * dy; c[5]! += w * dy * dz;
    c[8]! += w * dz * dz;
  }
  c[3] = c[1]!; c[6] = c[2]!; c[7] = c[5]!;
  const [a, b, cc, d, e, f, g, h, k] = c as [number, number, number, number, number, number, number, number, number];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + cc * (d * h - e * g);
  INV_COV[0] = (e * k - f * h) / det; INV_COV[1] = (cc * h - b * k) / det; INV_COV[2] = (b * f - cc * e) / det;
  INV_COV[3] = (f * g - d * k) / det; INV_COV[4] = (a * k - cc * g) / det; INV_COV[5] = (cc * d - a * f) / det;
  INV_COV[6] = (d * h - e * g) / det; INV_COV[7] = (b * g - a * h) / det; INV_COV[8] = (a * e - b * d) / det;
})();

const EYE_DX = CANONICAL_EYE_MID[0] - BASIS_CENTROID[0];
const EYE_DY = CANONICAL_EYE_MID[1] - BASIS_CENTROID[1];
const EYE_DZ = CANONICAL_EYE_MID[2] - BASIS_CENTROID[2];

/** Approximate width of the rigid landmark set (outer eye corner to outer eye corner), metres. */
const FACE_SPAN_M = 0.089;

export interface FaceMeasurement {
  /**
   * Midpoint between the eyes in reference pixels of the TRUE (un-mirrored)
   * upright frame: x to the camera's right, y down, origin at the top-left.
   */
  eyeX: number;
  eyeY: number;
  /** Rotation-invariant face scale: reference pixels per metre at the face. */
  pxPerM: number;
  /** Equivalent inter-pupillary distance in reference pixels (pxPerM × 63 mm). */
  ipdPx: number;
  /** Depth of the eye midpoint relative to the fitted face centre along the optical axis, metres (+ = farther). */
  eyeDepthOffsetM: number;
  /** Head orientation in the true image, radians. yaw > 0: nose towards image right; pitch > 0: nose up; roll > 0: clockwise. */
  yaw: number;
  pitch: number;
  roll: number;
  /** RMS residual of the rigid fit relative to the face size (dimensionless). ~0.01–0.03 for real faces. */
  residual: number;
  /** Ratio between the horizontal and vertical scale of the fit (1 for a perfectly canonical, rigid face). */
  anisotropy: number;
  /** Face centre (as delivered, i.e. in the frame the preview shows), normalised upright coordinates. */
  centerU: number;
  centerV: number;
  /** Apparent distance between the outer eye corners, normalised by the upright frame width. */
  sizeU: number;
}

export function createMeasurement(): FaceMeasurement {
  return {
    eyeX: 0,
    eyeY: 0,
    pxPerM: 0,
    ipdPx: 0,
    eyeDepthOffsetM: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    residual: 0,
    anisotropy: 1,
    centerU: 0.5,
    centerV: 0.5,
    sizeU: 0,
  };
}

/**
 * Measures one face. `packed` holds the tracked landmarks of the face starting
 * at `offset` (normalised x, y, z per landmark, in the upright frame exactly
 * as the detector saw it, i.e. still mirrored if the camera mirrors).
 * Returns null when the landmarks are degenerate.
 */
export function measureFace(
  packed: ArrayLike<number>,
  offset: number,
  frame: UprightFrame,
  out: FaceMeasurement = createMeasurement(),
): FaceMeasurement | null {
  const W = frame.width;
  const H = frame.height;

  // Weighted centroid of the image points (reference pixels, delivered orientation).
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < N; i++) {
    const o = offset + BASIS_SLOTS[i]! * FLOATS_PER_LANDMARK;
    const w = WEIGHT[i]!;
    qx += w * packed[o]! * W;
    qy += w * packed[o + 1]! * H;
  }

  // B = Σ w (q - q̄)(P - P̄)ᵀ  (2×3)
  let b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0;
  for (let i = 0; i < N; i++) {
    const o = offset + BASIS_SLOTS[i]! * FLOATS_PER_LANDMARK;
    const w = WEIGHT[i]!;
    const dx = (packed[o]! * W - qx) * w;
    const dy = (packed[o + 1]! * H - qy) * w;
    b00 += dx * DPX[i]!; b01 += dx * DPY[i]!; b02 += dx * DPZ[i]!;
    b10 += dy * DPX[i]!; b11 += dy * DPY[i]!; b12 += dy * DPZ[i]!;
  }

  // M = B · Σ⁻¹ : image pixels per canonical metre (rows = image x, image y).
  const m00 = b00 * INV_COV[0]! + b01 * INV_COV[3]! + b02 * INV_COV[6]!;
  const m01 = b00 * INV_COV[1]! + b01 * INV_COV[4]! + b02 * INV_COV[7]!;
  const m02 = b00 * INV_COV[2]! + b01 * INV_COV[5]! + b02 * INV_COV[8]!;
  const m10 = b10 * INV_COV[0]! + b11 * INV_COV[3]! + b12 * INV_COV[6]!;
  const m11 = b10 * INV_COV[1]! + b11 * INV_COV[4]! + b12 * INV_COV[7]!;
  const m12 = b10 * INV_COV[2]! + b11 * INV_COV[5]! + b12 * INV_COV[8]!;

  const s1 = Math.hypot(m00, m01, m02);
  const s2 = Math.hypot(m10, m11, m12);
  const scale = Math.sqrt((s1 * s1 + s2 * s2) / 2);
  if (!(scale > 1e-3) || !Number.isFinite(scale) || !(s1 > 1e-6) || !(s2 > 1e-6)) return null;

  // Residual of the rigid fit.
  let err = 0;
  for (let i = 0; i < N; i++) {
    const o = offset + BASIS_SLOTS[i]! * FLOATS_PER_LANDMARK;
    const ex = packed[o]! * W - qx - (m00 * DPX[i]! + m01 * DPY[i]! + m02 * DPZ[i]!);
    const ey = packed[o + 1]! * H - qy - (m10 * DPX[i]! + m11 * DPY[i]! + m12 * DPZ[i]!);
    err += WEIGHT[i]! * (ex * ex + ey * ey);
  }

  // Orthonormal camera-space rows (X right, Y down, Z forward) from the fit.
  const r1x = m00 / s1, r1y = m01 / s1, r1z = m02 / s1;
  const d12 = r1x * m10 + r1y * m11 + r1z * m12;
  let r2x = m10 - d12 * r1x, r2y = m11 - d12 * r1y, r2z = m12 - d12 * r1z;
  const n2 = Math.hypot(r2x, r2y, r2z) || 1;
  r2x /= n2; r2y /= n2; r2z /= n2;
  const r3x = r1y * r2z - r1z * r2y;
  const r3y = r1z * r2x - r1x * r2z;
  const r3z = r1x * r2y - r1y * r2x;

  // Eye midpoint: the measured eye corners themselves (gaze and blinks do not move them).
  let ex = 0;
  let ey = 0;
  for (let i = 0; i < EYE_CORNER_SLOTS.length; i++) {
    const o = offset + EYE_CORNER_SLOTS[i]! * FLOATS_PER_LANDMARK;
    ex += packed[o]!;
    ey += packed[o + 1]!;
  }
  ex /= EYE_CORNER_SLOTS.length;
  ey /= EYE_CORNER_SLOTS.length;

  const oR = offset + EYE_CORNER_SLOTS[0]! * FLOATS_PER_LANDMARK;
  const oL = offset + EYE_CORNER_SLOTS[3]! * FLOATS_PER_LANDMARK;
  const spanU = Math.hypot((packed[oL]! - packed[oR]!) * W, (packed[oL + 1]! - packed[oR + 1]!) * H) / W;

  // Face normal (canonical +Z) expressed in camera space.
  const nx = r1z;
  const ny = r2z;
  const nz = r3z;
  const sign = frame.mirror ? -1 : 1;

  out.eyeX = (frame.mirror ? 1 - ex : ex) * W;
  out.eyeY = ey * H;
  out.pxPerM = scale;
  out.ipdPx = scale * REFERENCE_IPD_M;
  out.eyeDepthOffsetM = r3x * EYE_DX + r3y * EYE_DY + r3z * EYE_DZ;
  out.yaw = sign * Math.atan2(nx, -nz);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, -ny)));
  out.roll = sign * Math.atan2(r2x, r1x);
  out.residual = Math.sqrt(err) / (scale * FACE_SPAN_M);
  out.anisotropy = s1 / s2;
  out.centerU = qx / W;
  out.centerV = qy / H;
  out.sizeU = spanU;
  return out;
}

/**
 * Effective focal length in reference pixels. A calibration constant
 * `calDepthK` (focal × IPD) takes precedence; otherwise it is derived from the
 * horizontal field of view of the raw frame.
 */
export function effectiveFocalRef(hfovDeg: number, calDepthK: number): number {
  if (calDepthK > 0) return calDepthK / REFERENCE_IPD_M;
  const half = (Math.min(170, Math.max(5, hfovDeg)) * Math.PI) / 360;
  return REFERENCE_FRAME_WIDTH / 2 / Math.tan(half);
}

/** The calibration constant that corresponds to a focal length (reference pixels). */
export function depthKFromFocal(focalRef: number): number {
  return focalRef * REFERENCE_IPD_M;
}

/**
 * Pinhole un-projection of a measurement to camera space (metres):
 * X to the camera's right, Y down, Z along the optical axis.
 */
export function eyeInCamera(m: FaceMeasurement, frame: UprightFrame, focalRef: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const z = focalRef / m.pxPerM + m.eyeDepthOffsetM;
  out[0] = ((m.eyeX - frame.width / 2) * z) / focalRef;
  out[1] = ((m.eyeY - frame.height / 2) * z) / focalRef;
  out[2] = z;
  return out;
}

/** Normalised ray direction (x/z, y/z) of the eye midpoint for a given focal length. */
export function eyeRay(m: FaceMeasurement, frame: UprightFrame, focalRef: number): [number, number] {
  return [(m.eyeX - frame.width / 2) / focalRef, (m.eyeY - frame.height / 2) / focalRef];
}
