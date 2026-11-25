import { describe, expect, it } from 'vitest';
import {
  BIN_FOOTPRINT,
  CLASSIC_FIELD,
  CLASSIC_OPENING,
  fixtureBounds,
  floorWithHole,
  openingCenter,
  overOpening,
  validateGeometry,
  type FieldGeometry,
  type Rect,
} from '../../../src/physics/fieldGeometry';
import { BIN, CHUTE, CHUTE_CENTER, CLAW, FIELD, PRIZE_SENSOR, isOverChute } from '../../../src/physics/fieldSpec';
import { BRIDGE_GEOMETRY, SHELF_GEOMETRY } from './designGeometry';

const W = FIELD.halfWidth;
const D = FIELD.depth;
const T = FIELD.floorThickness;

function rectOf(b: { center: number[]; half: number[] }): Rect {
  return { xMin: b.center[0]! - b.half[0]!, xMax: b.center[0]! + b.half[0]!, zMin: b.center[2]! - b.half[2]!, zMax: b.center[2]! + b.half[2]! };
}
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)) * Math.max(0, Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin));
const area = (r: Rect) => (r.xMax - r.xMin) * (r.zMax - r.zMin);

describe('classic field geometry', () => {
  it('is exactly the fieldSpec cabinet', () => {
    expect(CLASSIC_FIELD.floor).toEqual({ kind: 'classic' });
    expect(CLASSIC_FIELD.chuteGuard).toBe(true);
    expect(CLASSIC_FIELD.fixtures).toEqual([]);
    expect(CLASSIC_FIELD.home).toEqual({ x: CLAW.homeX, z: CLAW.homeZ });
    expect(CLASSIC_OPENING).toEqual({
      xMin: PRIZE_SENSOR.xMin,
      xMax: PRIZE_SENSOR.xMax,
      zMin: PRIZE_SENSOR.zMin,
      zMax: PRIZE_SENSOR.zMax,
      sensorTop: PRIZE_SENSOR.yTop,
      sensorBottom: PRIZE_SENSOR.yBottom,
      awardComY: PRIZE_SENSOR.awardComY,
      overMargin: 0.02,
    });
    expect(BIN_FOOTPRINT).toEqual({ xMin: BIN.xMin, xMax: BIN.xMax, zMin: BIN.zMin, zMax: BIN.zMax });
    expect(validateGeometry(CLASSIC_FIELD)).toEqual([]);
  });

  it('answers "over the opening" exactly like isOverChute, and anchors effects where Game.ts does', () => {
    for (const [x, z] of [[-0.35, -0.15], [-0.19, -0.1], [-0.21, -0.31], [-0.17, -0.1], [0, 0], [-0.5, -0.02]] as const) {
      expect(overOpening(CLASSIC_OPENING, x, z), `${x},${z}`).toBe(isOverChute(x, z, 0.02));
      expect(overOpening(CLASSIC_OPENING, x, z, 0), `${x},${z}`).toBe(isOverChute(x, z));
    }
    expect(openingCenter(CLASSIC_OPENING)).toEqual({ x: CHUTE_CENTER.x, y: PRIZE_SENSOR.yTop + 0.04, z: CHUTE_CENTER.z });
  });
});

describe('floorWithHole', () => {
  it('gives the two classic floor boxes, in the classic order, for the chute hole', () => {
    const boxes = floorWithHole(CHUTE);
    expect(boxes).toEqual([
      { center: [(CHUTE.xMax + W) / 2, -T / 2, -D / 2], half: [(W - CHUTE.xMax) / 2, T / 2, D / 2] },
      { center: [(CHUTE.xMin + CHUTE.xMax) / 2, -T / 2, (-D + CHUTE.zMin) / 2], half: [(CHUTE.xMax - CHUTE.xMin) / 2, T / 2, (D + CHUTE.zMin) / 2] },
    ]);
  });

  for (const [name, hole] of [
    ['bridge pit', { xMin: -0.42, xMax: 0.02, zMin: -0.38, zMax: -0.06 }],
    ['shelf trough', { xMin: -0.5, xMax: 0, zMin: -0.3, zMax: 0 }],
    ['middle', { xMin: -0.1, xMax: 0.1, zMin: -0.5, zMax: -0.3 }],
  ] as const) {
    it(`covers the slab minus the hole with no overlap (${name})`, () => {
      const boxes = floorWithHole(hole);
      expect(boxes.length).toBeLessThanOrEqual(4);
      const rects = boxes.map(rectOf);
      for (const b of boxes) {
        expect(b.center[1]).toBe(-T / 2);
        expect(b.half[1]).toBe(T / 2);
      }
      for (let i = 0; i < rects.length; i++) {
        expect(overlapArea(rects[i]!, hole), `box ${i} over the hole`).toBeCloseTo(0, 12);
        for (let j = i + 1; j < rects.length; j++) expect(overlapArea(rects[i]!, rects[j]!), `boxes ${i}/${j}`).toBeCloseTo(0, 12);
        expect(rects[i]!.xMin).toBeGreaterThanOrEqual(-W - 1e-12);
        expect(rects[i]!.xMax).toBeLessThanOrEqual(W + 1e-12);
        expect(rects[i]!.zMin).toBeGreaterThanOrEqual(-D - 1e-12);
        expect(rects[i]!.zMax).toBeLessThanOrEqual(1e-12);
      }
      const total = rects.reduce((sum, r) => sum + area(r), 0);
      expect(total).toBeCloseTo(2 * W * D - area(hole), 10);
    });
  }
});

describe('validateGeometry', () => {
  const variant = (patch: Partial<FieldGeometry>): FieldGeometry => ({ ...BRIDGE_GEOMETRY, ...patch });

  it('accepts the designed bridge and shelf layouts', () => {
    expect(validateGeometry(BRIDGE_GEOMETRY)).toEqual([]);
    expect(validateGeometry(SHELF_GEOMETRY)).toEqual([]);
  });

  it('rejects an opening outside the prize bin footprint', () => {
    const opening = { ...BRIDGE_GEOMETRY.opening, xMin: 0.1, xMax: 0.3 };
    const problems = validateGeometry(variant({ opening, floor: { kind: 'hole', hole: { xMin: 0.1, xMax: 0.3, zMin: -0.38, zMax: -0.06 } } }));
    expect(problems.some((p) => p.includes('outside the prize bin footprint'))).toBe(true);
  });

  it('rejects a hole that does not contain the opening', () => {
    const problems = validateGeometry(variant({ floor: { kind: 'hole', hole: { xMin: -0.3, xMax: 0, zMin: -0.38, zMax: -0.06 } } }));
    expect(problems).toContain('floor: the hole does not contain the opening');
  });

  it('rejects a fixture above the travel clearance or outside the glass', () => {
    const tall = { ...BRIDGE_GEOMETRY.fixtures[0]!, id: 'tower', center: [0.2, 0.435, -0.5] as [number, number, number] };
    expect(validateGeometry(variant({ fixtures: [tall] })).some((p) => p.includes('above the claw'))).toBe(true);
    const out = { ...BRIDGE_GEOMETRY.fixtures[2]!, id: 'out', center: [0.6, 0.08, -0.2] as [number, number, number] };
    expect(validateGeometry(variant({ fixtures: [out] }))).toContain('fixture out: outside the glass');
    expect(validateGeometry(variant({ fixtures: [BRIDGE_GEOMETRY.fixtures[0]!, BRIDGE_GEOMETRY.fixtures[0]!] }))).toContain('fixture barL: duplicate id');
  });

  it('rejects a home outside the claw reach', () => {
    expect(validateGeometry(variant({ home: { x: 0.45, z: -0.4 } }))).toContain('home: outside the claw reach');
    expect(validateGeometry(variant({ home: { x: 0, z: -0.05 } }))).toContain('home: outside the claw reach');
  });

  it('rejects the chute guard on a floor with its own hole', () => {
    expect(validateGeometry(variant({ chuteGuard: true }))).toContain('chuteGuard: the guard walls only fit the classic floor');
  });

  it('rejects non-finite numbers', () => {
    expect(validateGeometry(variant({ opening: { ...BRIDGE_GEOMETRY.opening, awardComY: Number.NaN } }))).toContain('opening: non-finite number');
    expect(validateGeometry(variant({ home: { x: Number.POSITIVE_INFINITY, z: -0.4 } }))).toContain('home: non-finite');
    const bad = { ...BRIDGE_GEOMETRY.fixtures[0]!, center: [0, Number.NaN, 0] as [number, number, number] };
    expect(validateGeometry(variant({ fixtures: [bad] }))).toContain('fixture barL: non-finite number');
  });

  it('bounds rotated fixtures exactly (the shelf gutter climbs from y 0.02 to 0.10)', () => {
    const gutter = SHELF_GEOMETRY.fixtures.find((f) => f.id === 'gutter')!;
    const b = fixtureBounds(gutter);
    expect(b.max[1]).toBeCloseTo(0.0998, 3);
    expect(b.min[0]).toBeCloseTo(-0.0016, 3);
    const bar = BRIDGE_GEOMETRY.fixtures[0]!;
    const bb = fixtureBounds(bar);
    expect(bb.min[2]).toBeCloseTo(-0.22 - 0.162, 9);
    expect(bb.max[2]).toBeCloseTo(-0.22 + 0.162, 9);
    expect(bb.max[1]).toBeCloseTo(0.112, 9);
  });
});
