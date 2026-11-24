/**
 * Landmarks → eye position in camera space. Pure functions (no DOM).
 *
 * Depth is NOT taken from MediaPipe's landmark z. Instead the rigid landmarks
 * of the canonical 3D face model are fitted to their 2D image positions:
 *
 *  1. The image is re-projected into a virtual camera that looks straight at
 *     the face, so the face sits on the optical axis where a scaled
 *     orthographic camera is a good first approximation.
 *  2. A 2×3 affine camera `[s·r1; s·r2]` is fitted by weighted least squares.
 *     For a rigid object r1 ⟂ r2 are unit vectors, so the scale `s` (pixels
 *     per metre at the face) is recovered for ANY head rotation: turning or
 *     nodding in place changes r1/r2, not `s`.
 *  3. A few POSIT iterations (DeMenthon & Davis) correct every point for its
 *     own depth, turning the fit into a true perspective pose.
 *
 * Distance follows from `Z = f / s`; the lateral position from the pinhole
 * model. The head orientation that falls out of the fit is only used as an
 * auxiliary correction (depth of the eyes relative to the face centre,
 * quality checks, diagnostics) – it never becomes the viewpoint.
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

/** Perspective refinement steps (POSIT) after the initial scaled-orthographic fit. */
const POSIT_ITERATIONS = 3;

/** Scratch buffers: image points in the virtual (face-centred) camera and their depth corrections. */
const IMG_X = new Float64Array(N);
const IMG_Y = new Float64Array(N);
const EPS = new Float64Array(N);

export interface FaceMeasurement {
  /** Midpoint between the eyes in camera space, metres: X to the camera's right, Y down, Z along the optical axis. */
  camX: number;
  camY: number;
  camZ: number;
  /**
   * Midpoint between the eyes in reference pixels of the TRUE (un-mirrored)
   * upright frame: x to the camera's right, y down, origin at the top-left.
   */
  eyeX: number;
  eyeY: number;
  /** Rotation-invariant face scale: reference pixels per metre at the face (along the line of sight). */
  pxPerM: number;
  /** Equivalent inter-pupillary distance in reference pixels (pxPerM × 63 mm). */
  ipdPx: number;
  /** Head orientation relative to the camera axes, radians. yaw > 0: nose towards image right; pitch > 0: nose up; roll > 0: clockwise. */
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
    camX: 0,
    camY: 0,
    camZ: 0,
    eyeX: 0,
    eyeY: 0,
    pxPerM: 0,
    ipdPx: 0,
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
 * `focalRef` is the focal length in reference pixels (see effectiveFocalRef).
 *
 * Returns null when the landmarks are degenerate.
 */
export function measureFace(
  packed: ArrayLike<number>,
  offset: number,
  frame: UprightFrame,
  focalRef: number,
  out: FaceMeasurement = createMeasurement(),
): FaceMeasurement | null {
  const W = frame.width;
  const H = frame.height;
  const cx = W / 2;
  const cy = H / 2;
  const f = focalRef;
  if (!(f > 0)) return null;

  // Weighted centroid of the face in the image, relative to the principal point.
  let rawQx = 0;
  let rawQy = 0;
  for (let i = 0; i < N; i++) {
    const o = offset + BASIS_SLOTS[i]! * FLOATS_PER_LANDMARK;
    rawQx += WEIGHT[i]! * (packed[o]! * W - cx);
    rawQy += WEIGHT[i]! * (packed[o + 1]! * H - cy);
  }
  if (!Number.isFinite(rawQx) || !Number.isFinite(rawQy)) return null;

  // Virtual camera looking straight at the face: z' along the ray to the face
  // centre, x' as horizontal as possible, y' = z' × x'.
  const zl = Math.hypot(rawQx, rawQy, f);
  const zx = rawQx / zl, zy = rawQy / zl, zz = f / zl;
  let xx = 1 - zx * zx, xy = -zx * zy, xz = -zx * zz;
  const xl = Math.hypot(xx, xy, xz);
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  // Re-project every basis landmark into the virtual camera (pure rotation = homography).
  for (let i = 0; i < N; i++) {
    const o = offset + BASIS_SLOTS[i]! * FLOATS_PER_LANDMARK;
    const px = packed[o]! * W - cx;
    const py = packed[o + 1]! * H - cy;
    const c = px * zx + py * zy + f * zz;
    IMG_X[i] = (f * (px * xx + py * xy + f * xz)) / c;
    IMG_Y[i] = (f * (px * yx + py * yy + f * yz)) / c;
    EPS[i] = 0;
  }

  let m00 = 0, m01 = 0, m02 = 0, m10 = 0, m11 = 0, m12 = 0;
  let s1 = 0, s2 = 0, scale = 0;
  let r1x = 0, r1y = 0, r1z = 0, r2x = 0, r2y = 0, r2z = 0, r3x = 0, r3y = 0, r3z = 0;
  let qx = 0, qy = 0;

  for (let pass = 0; pass <= POSIT_ITERATIONS; pass++) {
    // Weighted centroid of the depth-corrected image points.
    qx = 0;
    qy = 0;
    for (let i = 0; i < N; i++) {
      const k = WEIGHT[i]! * (1 + EPS[i]!);
      qx += k * IMG_X[i]!;
      qy += k * IMG_Y[i]!;
    }
    // B = Σ w (q - q̄)(P - P̄)ᵀ  (2×3)
    let b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0;
    for (let i = 0; i < N; i++) {
      const w = WEIGHT[i]!;
      const dx = (IMG_X[i]! * (1 + EPS[i]!) - qx) * w;
      const dy = (IMG_Y[i]! * (1 + EPS[i]!) - qy) * w;
      b00 += dx * DPX[i]!; b01 += dx * DPY[i]!; b02 += dx * DPZ[i]!;
      b10 += dy * DPX[i]!; b11 += dy * DPY[i]!; b12 += dy * DPZ[i]!;
    }
    // M = B · Σ⁻¹ : image pixels per canonical metre (rows = image x, image y).
    m00 = b00 * INV_COV[0]! + b01 * INV_COV[3]! + b02 * INV_COV[6]!;
    m01 = b00 * INV_COV[1]! + b01 * INV_COV[4]! + b02 * INV_COV[7]!;
    m02 = b00 * INV_COV[2]! + b01 * INV_COV[5]! + b02 * INV_COV[8]!;
    m10 = b10 * INV_COV[0]! + b11 * INV_COV[3]! + b12 * INV_COV[6]!;
    m11 = b10 * INV_COV[1]! + b11 * INV_COV[4]! + b12 * INV_COV[7]!;
    m12 = b10 * INV_COV[2]! + b11 * INV_COV[5]! + b12 * INV_COV[8]!;

    s1 = Math.hypot(m00, m01, m02);
    s2 = Math.hypot(m10, m11, m12);
    scale = Math.sqrt((s1 * s1 + s2 * s2) / 2);
    if (!(scale > 1e-3) || !Number.isFinite(scale) || !(s1 > 1e-6) || !(s2 > 1e-6)) return null;

    // Orthonormal rows of the object → virtual-camera rotation (X right, Y down, Z forward).
    r1x = m00 / s1; r1y = m01 / s1; r1z = m02 / s1;
    const d12 = r1x * m10 + r1y * m11 + r1z * m12;
    r2x = m10 - d12 * r1x; r2y = m11 - d12 * r1y; r2z = m12 - d12 * r1z;
    const n2 = Math.hypot(r2x, r2y, r2z) || 1;
    r2x /= n2; r2y /= n2; r2z /= n2;
    r3x = r1y * r2z - r1z * r2y;
    r3y = r1z * r2x - r1x * r2z;
    r3z = r1x * r2y - r1y * r2x;

    if (pass < POSIT_ITERATIONS) {
      // Relative depth of every basis point: ε = k·(P − P̄) / Z₀ with Z₀ = f / s.
      const invZ0 = scale / f;
      for (let i = 0; i < N; i++) {
        const e = (r3x * DPX[i]! + r3y * DPY[i]! + r3z * DPZ[i]!) * invZ0;
        EPS[i] = e > 0.5 ? 0.5 : e < -0.5 ? -0.5 : e;
      }
    }
  }

  // Residual of the rigid fit.
  let err = 0;
  for (let i = 0; i < N; i++) {
    const ex = IMG_X[i]! * (1 + EPS[i]!) - qx - (m00 * DPX[i]! + m01 * DPY[i]! + m02 * DPZ[i]!);
    const ey = IMG_Y[i]! * (1 + EPS[i]!) - qy - (m10 * DPX[i]! + m11 * DPY[i]! + m12 * DPZ[i]!);
    err += WEIGHT[i]! * (ex * ex + ey * ey);
  }

  // Eye midpoint: the measured eye corners themselves (gaze and blinks do not move them).
  let eu = 0;
  let ev = 0;
  for (let i = 0; i < EYE_CORNER_SLOTS.length; i++) {
    const o = offset + EYE_CORNER_SLOTS[i]! * FLOATS_PER_LANDMARK;
    eu += packed[o]!;
    ev += packed[o + 1]!;
  }
  eu /= EYE_CORNER_SLOTS.length;
  ev /= EYE_CORNER_SLOTS.length;
  const epx = eu * W - cx;
  const epy = ev * H - cy;

  // Eye position: ray through the eye midpoint, at the depth of the eyes in the virtual camera.
  const ec = epx * zx + epy * zy + f * zz;
  const evx = (epx * xx + epy * xy + f * xz) / ec; // X'/Z'
  const evy = (epx * yx + epy * yy + f * yz) / ec; // Y'/Z'
  const zEye = f / scale + (r3x * EYE_DX + r3y * EYE_DY + r3z * EYE_DZ);
  const vx = evx * zEye;
  const vy = evy * zEye;
  // Back to the real camera frame.
  const camX = vx * xx + vy * yx + zEye * zx;
  const camY = vx * xy + vy * yy + zEye * zy;
  const camZ = vx * xz + vy * yz + zEye * zz;

  // Face normal (canonical +Z) and inter-ocular axis (canonical +X) in real camera space.
  const nx = xx * r1z + yx * r2z + zx * r3z;
  const ny = xy * r1z + yy * r2z + zy * r3z;
  const nz = xz * r1z + yz * r2z + zz * r3z;
  const ax = xx * r1x + yx * r2x + zx * r3x;
  const ay = xy * r1x + yy * r2x + zy * r3x;

  const oR = offset + EYE_CORNER_SLOTS[0]! * FLOATS_PER_LANDMARK;
  const oL = offset + EYE_CORNER_SLOTS[3]! * FLOATS_PER_LANDMARK;
  const spanU = Math.hypot((packed[oL]! - packed[oR]!) * W, (packed[oL + 1]! - packed[oR + 1]!) * H) / W;

  // A mirrored frame shows the mirrored scene: flip X, yaw and roll back to reality.
  const sign = frame.mirror ? -1 : 1;
  out.camX = sign * camX;
  out.camY = camY;
  out.camZ = camZ;
  out.eyeX = (frame.mirror ? 1 - eu : eu) * W;
  out.eyeY = ev * H;
  out.pxPerM = scale;
  out.ipdPx = scale * REFERENCE_IPD_M;
  out.yaw = sign * Math.atan2(nx, -nz);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, -ny)));
  out.roll = sign * Math.atan2(ay, ax);
  out.residual = Math.sqrt(err) / (scale * FACE_SPAN_M);
  out.anisotropy = s1 / s2;
  out.centerU = (rawQx + cx) / W;
  out.centerV = (rawQy + cy) / H;
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

/** Copies the camera-space eye position of a measurement into a vector. */
export function eyeInCamera(m: FaceMeasurement, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = m.camX;
  out[1] = m.camY;
  out[2] = m.camZ;
  return out;
}
