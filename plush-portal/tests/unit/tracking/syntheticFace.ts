/**
 * Test helper: projects the canonical 3D face model through a true pinhole
 * camera to produce landmark sets like the ones MediaPipe returns.
 * (Not a test file itself.)
 */
import type { Vec3 } from '../../../src/core/types';
import type { UprightFrame } from '../../../src/tracking/frameGeometry';
import {
  CANONICAL_EYE_MID,
  EYE_CORNERS,
  FACE_BASIS,
  FLOATS_PER_FACE,
  FLOATS_PER_LANDMARK,
  IRIS_CENTERS,
  TRACKED_LANDMARK_IDS,
} from '../../../src/tracking/landmarks';

/** Canonical positions (metres) of every tracked landmark. */
const CANONICAL = new Map<number, Vec3>();
for (const p of FACE_BASIS) CANONICAL.set(p.id, [p.x, p.y, p.z]);
const mid = (a: number, b: number): Vec3 => {
  const pa = CANONICAL.get(a)!;
  const pb = CANONICAL.get(b)!;
  return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
};
CANONICAL.set(IRIS_CENTERS.right, mid(EYE_CORNERS.rightOuter, EYE_CORNERS.rightInner));
CANONICAL.set(IRIS_CENTERS.left, mid(EYE_CORNERS.leftInner, EYE_CORNERS.leftOuter));
// Outline points (only drawn in the preview), canonical centimetres → metres.
const OUTLINE: Record<number, Vec3> = {
  152: [0, -0.094034, 0.042645],
  234: [-0.076642, 0.006731, -0.024359],
  454: [0.076642, 0.006731, -0.024359],
  1: [0, -0.011269, 0.074756],
  61: [-0.024562, -0.043426, 0.042839],
  291: [0.024562, -0.043426, 0.042839],
};
for (const id of Object.keys(OUTLINE)) CANONICAL.set(Number(id), OUTLINE[Number(id)]!);

export interface SynthOptions {
  /** True eye midpoint in camera space (X right, Y down, Z forward), metres. */
  eye: Vec3;
  /** Head orientation (radians): yaw > 0 nose to image right, pitch > 0 nose up, roll > 0 clockwise in the image. */
  yaw?: number;
  pitch?: number;
  roll?: number;
  frame: UprightFrame;
  /** True focal length in reference pixels. */
  focal: number;
  /** Anisotropic scale of this person's face relative to the canonical model (x, y, z). */
  shape?: Vec3;
  /** Gaussian landmark noise in reference pixels. */
  noisePx?: number;
  rng?: () => number;
  /** Value written into the (unused) landmark z slots. */
  zFill?: (index: number) => number;
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Returns one packed face (FLOATS_PER_FACE floats) in the upright frame as
 * the detector would deliver it. For a mirrored frame the whole scene is
 * mirrored (position, yaw and roll flip) while landmark labels stay those of a
 * normal face – exactly what a detector does with a mirrored image.
 */
export function synthFace(options: SynthOptions, out: Float32Array = new Float32Array(FLOATS_PER_FACE), offset = 0): Float32Array {
  const { frame, focal } = options;
  const mirror = frame.mirror;
  const yaw = (options.yaw ?? 0) * (mirror ? -1 : 1);
  const pitch = options.pitch ?? 0;
  const roll = (options.roll ?? 0) * (mirror ? -1 : 1);
  const ex = options.eye[0] * (mirror ? -1 : 1);
  const ey = options.eye[1];
  const ez = options.eye[2];
  const shape = options.shape ?? [1, 1, 1];
  const rng = options.rng ?? Math.random;
  const noise = options.noisePx ?? 0;

  // R = Rz(roll) · Ry(-yaw) · Rx(-pitch) applied to base-oriented points (x, -y, -z).
  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  for (let i = 0; i < TRACKED_LANDMARK_IDS.length; i++) {
    const c = CANONICAL.get(TRACKED_LANDMARK_IDS[i]!)!;
    // Relative to the eye midpoint, with the person's own proportions.
    const bx = (c[0] - CANONICAL_EYE_MID[0]) * shape[0];
    const by = -(c[1] - CANONICAL_EYE_MID[1]) * shape[1];
    const bz = -(c[2] - CANONICAL_EYE_MID[2]) * shape[2];
    // Rx
    const x1 = bx;
    const y1 = by * cp - bz * sp;
    const z1 = by * sp + bz * cp;
    // Ry
    const x2 = x1 * cy + z1 * sy;
    const y2 = y1;
    const z2 = -x1 * sy + z1 * cy;
    // Rz
    const x3 = x2 * cr - y2 * sr;
    const y3 = x2 * sr + y2 * cr;
    const z3 = z2;
    const X = ex + x3;
    const Y = ey + y3;
    const Z = ez + z3;
    let px = frame.width / 2 + (focal * X) / Z;
    let py = frame.height / 2 + (focal * Y) / Z;
    if (noise > 0) {
      px += gaussian(rng) * noise;
      py += gaussian(rng) * noise;
    }
    const o = offset + i * FLOATS_PER_LANDMARK;
    out[o] = px / frame.width;
    out[o + 1] = py / frame.height;
    out[o + 2] = options.zFill ? options.zFill(i) : 0;
  }
  return out;
}

/** Packs several faces into one buffer, like an inference result. */
export function packFaces(faces: Float32Array[]): Float32Array {
  const out = new Float32Array(faces.length * FLOATS_PER_FACE);
  faces.forEach((face, i) => out.set(face, i * FLOATS_PER_FACE));
  return out;
}

/** Focal length in reference pixels for a horizontal field of view (raw frame). */
export function focalForHfov(hfovDeg: number): number {
  return 320 / Math.tan((hfovDeg * Math.PI) / 360);
}
