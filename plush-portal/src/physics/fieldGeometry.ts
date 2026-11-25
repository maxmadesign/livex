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
import { BIN, CLAW, PRIZE_SENSOR } from './fieldSpec';

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

/** Problems found ([] = ok): opening outside BIN_FOOTPRINT, a hole that does not contain the opening, a fixture
 *  above y 0.44 or outside the glass, home outside the claw reach, guard with a non-classic floor, NaN. */
export function validateGeometry(g: FieldGeometry): string[] {
  void g;
  throw new Error('WS-A: validateGeometry');
}
/** Up to four floor boxes (y -0.06..0) around a rectangular hole. */
export function floorWithHole(hole: Rect): { center: Vec3; half: Vec3 }[] {
  void hole;
  throw new Error('WS-A: floorWithHole');
}
export function overOpening(o: PrizeOpening, x: number, z: number, margin = o.overMargin): boolean {
  return x > o.xMin - margin && x < o.xMax + margin && z > o.zMin - margin && z < o.zMax + margin;
}
/** Where effects and popups anchor (replaces Game.ts:88 EXIT_POS for non-classic machines). */
export function openingCenter(o: PrizeOpening): { x: number; y: number; z: number } {
  return { x: (o.xMin + o.xMax) / 2, y: o.sensorTop + 0.04, z: (o.zMin + o.zMax) / 2 };
}
