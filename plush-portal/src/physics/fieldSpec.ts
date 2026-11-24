/**
 * Geometry of the play field in world space (metres). The physics, the claw
 * and the renderer all read these numbers; they never depend on the display
 * profile or the graphics quality, so gameplay is identical everywhere.
 *
 *   +X right, +Y up, +Z towards the viewer.
 *   The top of the play floor is y = 0, the inside of the front glass is z = 0,
 *   the field is centred on x = 0 and extends to z = -DEPTH.
 */
export const FIELD = {
  halfWidth: 0.5,
  depth: 0.8,
  /** Height of the gantry rails above the floor. */
  gantryY: 0.85,
  /** Inner height of the glass box. */
  ceilingY: 0.98,
  /** Thickness of the floor slab the chute passes through. */
  floorThickness: 0.06,
} as const;

/** Prize chute: a walled hole in the front-left corner of the floor. */
export const CHUTE = {
  xMin: -0.5,
  xMax: -0.2,
  zMin: -0.3,
  zMax: 0,
  /** Height of the clear guard walls that keep toys from rolling in. */
  wallHeight: 0.2,
  wallThickness: 0.012,
} as const;

export const CHUTE_CENTER = {
  x: (CHUTE.xMin + CHUTE.xMax) / 2,
  z: (CHUTE.zMin + CHUTE.zMax) / 2,
} as const;

/** Volume under the chute that counts as "really in the prize exit". */
export const PRIZE_SENSOR = {
  xMin: CHUTE.xMin,
  xMax: CHUTE.xMax,
  zMin: CHUTE.zMin,
  zMax: CHUTE.zMax,
  yTop: -0.1,
  yBottom: -0.3,
  /** The toy's centre of mass must be below this height to be awarded. */
  awardComY: -0.06,
} as const;

/** Prize bin below the floor (only its depth depends on the display layout). */
export const BIN = {
  xMin: -0.5,
  xMax: 0.02,
  zMin: -0.42,
  zMax: 0,
  /** Shallowest / deepest allowed bin floor. */
  minFloorY: -1.3,
  maxFloorY: -0.34,
} as const;

export const CLAW = {
  /** Where the rope leaves the trolley. */
  anchorY: FIELD.gantryY - 0.05,
  homeX: 0.06,
  homeZ: -0.4,
  /** Reachable area of the trolley (inset so open fingers clear the glass). */
  minX: -0.37,
  maxX: 0.37,
  minZ: -0.67,
  maxZ: -0.13,
  /** Drop position above the chute. */
  dropX: -0.345,
  dropZ: -0.155,
  ropeMin: 0.1,
  ropeMax: 0.64,
  hubRadius: 0.042,
  hubHalfHeight: 0.03,
  /** Rope attachment point above the hub centre. */
  hubTop: 0.04,
  knuckleRadius: 0.046,
  knuckleDrop: 0.012,
  /** Finger profile in the closed pose: [radial, down] relative to the knuckle. */
  elbow: [0.056, 0.082] as const,
  tip: [-0.024, 0.172] as const,
  fingerRadius: 0.0085,
  tipRadius: 0.0135,
  /** Hinge angle (rad) of the fully open claw; 0 is fully closed. */
  openAngle: 0.46,
  /** Azimuth of the three fingers (rad, measured from +X towards +Z). */
  fingerAzimuth: [Math.PI / 2 + Math.PI, Math.PI / 6, (5 * Math.PI) / 6] as const,
  hubMass: 0.3,
  fingerMass: 0.05,
  /** Centre of the grasp volume below the hub centre. */
  gripDrop: 0.105,
} as const;

/** Collision group bits. */
export const GROUP = {
  STATIC: 0x0001,
  TOY: 0x0002,
  CLAW: 0x0004,
  SENSOR: 0x0008,
  /** Mass-only colliders (never collide). */
  NONE: 0x0000,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const FIXED_DT = 1 / 120;

/** True when (x, z) lies above the chute opening. */
export function isOverChute(x: number, z: number, margin = 0): boolean {
  return x > CHUTE.xMin - margin && x < CHUTE.xMax + margin && z > CHUTE.zMin - margin && z < CHUTE.zMax + margin;
}

export function clampBinFloor(y: number): number {
  return Math.min(BIN.maxFloorY, Math.max(BIN.minFloorY, y));
}
