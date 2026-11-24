/**
 * Face landmark constants shared by the inference worker and the pure
 * estimation code.
 *
 * Canonical coordinates and Procrustes weights were extracted from
 * `geometry_pipeline_metadata_landmarks.binarypb` inside the pinned
 * `face_landmarker.task` bundle (MediaPipe canonical face model, centimetres,
 * +X = subject's left = image right, +Y up, +Z towards the camera).
 */

/** All pixel quantities in the estimator are expressed for a raw frame scaled to this width. */
export const REFERENCE_FRAME_WIDTH = 640;

/** Inter-pupillary distance of the canonical face model (and our default assumption), metres. */
export const REFERENCE_IPD_M = 0.063;

/**
 * Rigid upper-face landmarks used for the scale / pose fit: MediaPipe's own
 * Procrustes basis minus the jaw and cheek points (132, 136, 147, 205 and
 * their mirrors), which move when people talk, laugh or smile.
 * Columns: landmark id, weight, x, y, z (canonical centimetres).
 */
const BASIS_CM: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [4, 0.07091, 0.0, -0.4632, 7.5866],
  [6, 0.0321, 0.0, 2.4733, 5.7886],
  [10, 0.00845, 0.0, 8.2618, 4.4815],
  [33, 0.05872, -4.4459, 2.664, 3.1734],
  [54, 0.00767, -6.2793, 6.6154, 1.4259],
  [67, 0.00908, -3.524, 8.006, 3.7292],
  [117, 0.00979, -5.2587, 0.9458, 2.9743],
  [119, 0.01457, -3.3007, 0.8616, 3.8728],
  [121, 0.01859, -1.8207, 1.468, 4.2241],
  [127, 0.0052, -7.7431, 2.365, -2.0052],
  [129, 0.12063, -1.7858, -0.9783, 4.8505],
  [133, 0.05329, -1.8564, 2.5852, 3.7579],
  [143, 0.01482, -6.4076, 2.236, 1.5608],
  [198, 0.02546, -1.2468, 0.2303, 5.681],
  [263, 0.05872, 4.4459, 2.664, 3.1734],
  [284, 0.00767, 6.2793, 6.6154, 1.4259],
  [297, 0.00908, 3.524, 8.006, 3.7292],
  [346, 0.00979, 5.2587, 0.9458, 2.9743],
  [348, 0.01457, 3.3007, 0.8616, 3.8728],
  [350, 0.01859, 1.8207, 1.468, 4.2241],
  [356, 0.0052, 7.7431, 2.365, -2.0052],
  [358, 0.12063, 1.7858, -0.9783, 4.8505],
  [362, 0.05329, 1.8564, 2.5852, 3.7579],
  [372, 0.01482, 6.4076, 2.236, 1.5608],
  [420, 0.02546, 1.2468, 0.2303, 5.681],
];

/** Eye corner landmark ids ("right"/"left" are the subject's right/left). */
export const EYE_CORNERS = { rightOuter: 33, rightInner: 133, leftInner: 362, leftOuter: 263 } as const;

/** Iris centres (only used for the preview overlay; gaze must not move the viewpoint). */
export const IRIS_CENTERS = { right: 468, left: 473 } as const;

/** Extra outline points that are only drawn in the calibration preview. */
const OUTLINE_IDS = [152, 234, 454, 1, 61, 291] as const;

export interface BasisPoint {
  id: number;
  /** Normalised weight (weights sum to 1). */
  weight: number;
  /** Canonical position in metres. */
  x: number;
  y: number;
  z: number;
}

const weightSum = BASIS_CM.reduce((sum, row) => sum + row[1], 0);

export const FACE_BASIS: readonly BasisPoint[] = BASIS_CM.map(([id, w, x, y, z]) => ({
  id,
  weight: w / weightSum,
  x: x * 0.01,
  y: y * 0.01,
  z: z * 0.01,
}));

/**
 * Landmarks the inference backends copy out of each MediaPipe result, in this
 * order. Each face is packed as TRACKED_LANDMARK_IDS.length × 3 floats
 * (normalised x, y and MediaPipe's relative z).
 */
export const TRACKED_LANDMARK_IDS: readonly number[] = (() => {
  const ids: number[] = [];
  const add = (id: number) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const p of FACE_BASIS) add(p.id);
  add(EYE_CORNERS.rightOuter);
  add(EYE_CORNERS.rightInner);
  add(EYE_CORNERS.leftInner);
  add(EYE_CORNERS.leftOuter);
  add(IRIS_CENTERS.right);
  add(IRIS_CENTERS.left);
  for (const id of OUTLINE_IDS) add(id);
  return ids;
})();

export const FLOATS_PER_LANDMARK = 3;
export const FLOATS_PER_FACE = TRACKED_LANDMARK_IDS.length * FLOATS_PER_LANDMARK;

/** Highest landmark index we read; results with fewer landmarks are rejected. */
export const MAX_LANDMARK_ID = TRACKED_LANDMARK_IDS.reduce((m, id) => Math.max(m, id), 0);

const slotById = new Map<number, number>(TRACKED_LANDMARK_IDS.map((id, slot) => [id, slot]));

/** Slot (index into a packed face) of a landmark id. Throws for ids that are not tracked. */
export function slotOf(id: number): number {
  const slot = slotById.get(id);
  if (slot === undefined) throw new Error(`landmark ${id} is not part of TRACKED_LANDMARK_IDS`);
  return slot;
}

/** Slots of the basis points, parallel to FACE_BASIS. */
export const BASIS_SLOTS: readonly number[] = FACE_BASIS.map((p) => slotOf(p.id));

export const EYE_CORNER_SLOTS: readonly number[] = [
  slotOf(EYE_CORNERS.rightOuter),
  slotOf(EYE_CORNERS.rightInner),
  slotOf(EYE_CORNERS.leftInner),
  slotOf(EYE_CORNERS.leftOuter),
];

/** Canonical position (metres) of the midpoint of the four eye corners. */
export const CANONICAL_EYE_MID: readonly [number, number, number] = (() => {
  const ids = [EYE_CORNERS.rightOuter, EYE_CORNERS.rightInner, EYE_CORNERS.leftInner, EYE_CORNERS.leftOuter];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    const p = FACE_BASIS.find((b) => b.id === id)!;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return [x / ids.length, y / ids.length, z / ids.length] as const;
})();

/** Weighted centroid of the basis (metres). */
export const BASIS_CENTROID: readonly [number, number, number] = (() => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of FACE_BASIS) {
    x += p.weight * p.x;
    y += p.weight * p.y;
    z += p.weight * p.z;
  }
  return [x, y, z] as const;
})();
