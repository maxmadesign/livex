/**
 * The static layout of one machine as data (docs/design/machines.md, sections 2.2 and 2.5): the
 * floor, the prize opening with its sensor, extra fixtures (bars, fences, shelves) and the claw's
 * rest position. The same object drives physics (PhysicsWorld), rendering (Cabinet and
 * src/scene/machines), the effects' opening and the attract pilots. Classic is CLASSIC_FIELD, which
 * reproduces today's cabinet exactly.
 *
 * Physics layer: imports core and fieldSpec only.
 */
import type { Quat, Vec3 } from '../core/types';
import { BIN, CHUTE, CLAW, FIELD, PRIZE_SENSOR } from './fieldSpec';

export type FixtureKind = 'bar' | 'fence' | 'shelf' | 'lip' | 'gutter';
/** Renderer hint (src/scene/machines); physics never reads it. */
export type FixtureLook = 'chrome' | 'acrylic' | 'deck' | 'ramp' | 'hidden';
export type FixtureShape =
  | { type: 'box'; half: Vec3 }
  /** Rapier capsule along one world axis; `halfLength` is half of the straight part. */
  | { type: 'capsule'; axis: 'x' | 'y' | 'z'; halfLength: number; radius: number };

export interface Fixture {
  id: string;
  kind: FixtureKind;
  look: FixtureLook;
  shape: FixtureShape;
  /** World metres, fieldSpec frame (+Y up, floor top y = 0, front glass z = 0). */
  center: Vec3;
  rot?: Quat;
  friction: number;
  restitution: number;
  /** 'min' = this surface's (low) friction wins: the slick gutter. Default: Rapier's average. */
  frictionCombine?: 'average' | 'min';
}

export interface Rect {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** The floor hole that pays out, with the sensor volume below it. */
export interface PrizeOpening extends Rect {
  sensorTop: number; // classic -0.1
  sensorBottom: number; // classic -0.3
  /** The centre of mass must be below this (classic -0.06). */
  awardComY: number;
  /** "Over the opening" tolerance (classic 0.02, RoundController.ts:427). */
  overMargin: number;
}

export interface FieldGeometry {
  /** 'classic' = today's two floor boxes around CHUTE (PhysicsWorld.ts:184-195); 'hole' = floorWithHole(hole). */
  floor: { kind: 'classic' } | { kind: 'hole'; hole: Rect };
  /** Today's clear guard walls around CHUTE (PhysicsWorld.ts:209-212); only valid with the classic floor. */
  chuteGuard: boolean;
  opening: PrizeOpening;
  /** Extra static parts, created on their own fixed body AFTER the bin (classic: none, no body). */
  fixtures: readonly Fixture[];
  /** Trolley rest position, inside CLAW.minX..maxX / minZ..maxZ. */
  home: { x: number; z: number };
}

export const CLASSIC_OPENING: PrizeOpening = {
  xMin: PRIZE_SENSOR.xMin,
  xMax: PRIZE_SENSOR.xMax,
  zMin: PRIZE_SENSOR.zMin,
  zMax: PRIZE_SENSOR.zMax,
  sensorTop: PRIZE_SENSOR.yTop,
  sensorBottom: PRIZE_SENSOR.yBottom,
  awardComY: PRIZE_SENSOR.awardComY,
  overMargin: 0.02,
};
export const CLASSIC_FIELD: FieldGeometry = {
  floor: { kind: 'classic' },
  chuteGuard: true,
  opening: CLASSIC_OPENING,
  fixtures: [],
  home: { x: CLAW.homeX, z: CLAW.homeZ },
};
/** Round 4B rule: every opening lies inside the prize bin's footprint (the bin and lower cabinet stay as they are). */
export const BIN_FOOTPRINT: Rect = { xMin: BIN.xMin, xMax: BIN.xMax, zMin: BIN.zMin, zMax: BIN.zMax };

/** Nothing may rest higher than this: the open finger tips travel at about y 0.476 (design section 3.0). */
export const REST_CEILING_Y = 0.44;
/** Rounding slack of the geometry checks (m). */
const EPS = 1e-6;
/** A fixture may sink this far into the glass, the back wall or the floor slab (static against static: harmless). */
const WALL_SLACK = 0.005;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.xMin >= outer.xMin - EPS && inner.xMax <= outer.xMax + EPS && inner.zMin >= outer.zMin - EPS && inner.zMax <= outer.zMax + EPS;
const finite = (...values: number[]): boolean => values.every((v) => Number.isFinite(v));

/** Rotates v by the unit quaternion q (x, y, z, w). */
function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** World-space bounds of a fixture (exact for boxes and capsules, rotation included). */
export function fixtureBounds(f: Fixture): { min: Vec3; max: Vec3 } {
  const q = f.rot ?? [0, 0, 0, 1];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: Vec3, pad: number) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, f.center[i]! + p[i]! - pad);
      max[i] = Math.max(max[i]!, f.center[i]! + p[i]! + pad);
    }
  };
  if (f.shape.type === 'box') {
    const [hx, hy, hz] = f.shape.half;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) add(rotate(q, [sx * hx, sy * hy, sz * hz]), 0);
  } else {
    const h = f.shape.halfLength;
    const axis: Vec3 = f.shape.axis === 'x' ? [h, 0, 0] : f.shape.axis === 'y' ? [0, h, 0] : [0, 0, h];
    const end = rotate(q, axis);
    add(end, f.shape.radius);
    add([-end[0], -end[1], -end[2]], f.shape.radius);
  }
  return { min, max };
}

/** Problems found ([] = ok): opening outside BIN_FOOTPRINT, a hole that does not contain the opening, a fixture
 *  above y 0.44 or outside the glass, home outside the claw reach, guard with a non-classic floor, NaN. */
export function validateGeometry(g: FieldGeometry): string[] {
  const out: string[] = [];
  const o = g.opening;
  if (!finite(o.xMin, o.xMax, o.zMin, o.zMax, o.sensorTop, o.sensorBottom, o.awardComY, o.overMargin)) out.push('opening: non-finite number');
  else {
    if (!(o.xMin < o.xMax && o.zMin < o.zMax)) out.push('opening: empty rectangle');
    if (!inside(o, BIN_FOOTPRINT)) out.push('opening: outside the prize bin footprint');
    if (!(o.sensorBottom < o.sensorTop && o.sensorTop < 0)) out.push('opening: the sensor must lie below the floor, its top above its bottom');
    if (!(o.awardComY <= 0 && o.awardComY > o.sensorBottom)) out.push('opening: awardComY must be at or below the floor top and above the sensor bottom');
    if (!(o.overMargin >= 0 && o.overMargin <= 0.1)) out.push('opening: overMargin out of range');
  }
  const field: Rect = { xMin: -FIELD.halfWidth, xMax: FIELD.halfWidth, zMin: -FIELD.depth, zMax: 0 };
  if (g.floor.kind === 'classic') {
    if (!inside(o, CHUTE)) out.push('floor: the classic floor only has the chute hole, the opening must lie inside it');
  } else {
    const h = g.floor.hole;
    if (!finite(h.xMin, h.xMax, h.zMin, h.zMax)) out.push('floor: non-finite hole');
    else {
      if (!(h.xMin < h.xMax && h.zMin < h.zMax)) out.push('floor: empty hole');
      if (!inside(h, BIN_FOOTPRINT)) out.push('floor: hole outside the prize bin footprint');
      if (!inside(o, h)) out.push('floor: the hole does not contain the opening');
    }
    if (g.chuteGuard) out.push('chuteGuard: the guard walls only fit the classic floor');
  }
  const ids = new Set<string>();
  for (const f of g.fixtures) {
    const name = `fixture ${f.id}`;
    if (ids.has(f.id)) out.push(`${name}: duplicate id`);
    ids.add(f.id);
    const sizes = f.shape.type === 'box' ? [...f.shape.half] : [f.shape.halfLength, f.shape.radius];
    const rot = f.rot ?? [0, 0, 0, 1];
    if (!finite(...f.center, ...sizes, ...rot, f.friction, f.restitution)) {
      out.push(`${name}: non-finite number`);
      continue;
    }
    if (sizes.some((v) => !(v > 0))) out.push(`${name}: sizes must be positive`);
    if (Math.abs(Math.hypot(...rot) - 1) > 1e-3) out.push(`${name}: rotation is not a unit quaternion`);
    if (f.friction < 0 || f.restitution < 0 || f.restitution > 1) out.push(`${name}: friction / restitution out of range`);
    const b = fixtureBounds(f);
    if (b.max[1] > REST_CEILING_Y + EPS) out.push(`${name}: top at ${b.max[1].toFixed(3)} m is above the claw's travel clearance (${REST_CEILING_Y} m)`);
    if (b.min[0] < field.xMin - WALL_SLACK || b.max[0] > field.xMax + WALL_SLACK || b.min[2] < field.zMin - WALL_SLACK || b.max[2] > field.zMax + WALL_SLACK) out.push(`${name}: outside the glass`);
    if (b.min[1] < -FIELD.floorThickness - WALL_SLACK) out.push(`${name}: below the floor slab`);
  }
  const home = g.home;
  if (!finite(home.x, home.z)) out.push('home: non-finite');
  else if (home.x < CLAW.minX - EPS || home.x > CLAW.maxX + EPS || home.z < CLAW.minZ - EPS || home.z > CLAW.maxZ + EPS) out.push('home: outside the claw reach');
  return out;
}

/**
 * Up to four floor boxes (y -0.06..0) around a rectangular hole: right, back, left, front, empty
 * strips left out. For the classic chute this gives today's two boxes in today's order.
 */
export function floorWithHole(hole: Rect): { center: Vec3; half: Vec3 }[] {
  const W = FIELD.halfWidth;
  const D = FIELD.depth;
  const T = FIELD.floorThickness;
  const xMin = Math.max(-W, hole.xMin);
  const xMax = Math.min(W, hole.xMax);
  const zMin = Math.max(-D, hole.zMin);
  const zMax = Math.min(0, hole.zMax);
  const out: { center: Vec3; half: Vec3 }[] = [];
  const box = (cx: number, cz: number, hx: number, hz: number) => {
    if (hx > 1e-9 && hz > 1e-9) out.push({ center: [cx, -T / 2, cz], half: [hx, T / 2, hz] });
  };
  box((xMax + W) / 2, -D / 2, (W - xMax) / 2, D / 2); // right of the hole, full depth
  box((xMin + xMax) / 2, (-D + zMin) / 2, (xMax - xMin) / 2, (D + zMin) / 2); // behind it
  box((-W + xMin) / 2, -D / 2, (xMin + W) / 2, D / 2); // left of it, full depth
  box((xMin + xMax) / 2, zMax / 2, (xMax - xMin) / 2, -zMax / 2); // in front of it
  return out;
}
export function overOpening(o: PrizeOpening, x: number, z: number, margin = o.overMargin): boolean {
  return x > o.xMin - margin && x < o.xMax + margin && z > o.zMin - margin && z < o.zMax + margin;
}
/** Where effects and popups anchor (replaces Game.ts:88 EXIT_POS for non-classic machines). */
export function openingCenter(o: PrizeOpening): { x: number; y: number; z: number } {
  return { x: (o.xMin + o.xMax) / 2, y: o.sensorTop + 0.04, z: (o.zMin + o.zMax) / 2 };
}
