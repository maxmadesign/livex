/**
 * The cabinet dressed from a machine's FieldGeometry (docs/design/machines.md, sections 5.1 and 8.1
 * WS-E): the classic cabinet stays byte-identical, every fixture look lands in an existing material
 * bucket, no chute without the guard, the floor keeps its hole open, the opening facts the stage and
 * the effects read, and the dressing's triangle cost per tier.
 */
import { BufferGeometry, Mesh, type Group, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { bridgeGeometry, BRIDGE_DEFAULTS } from '../../../src/game/machines/bridge';
import { SHELF_DEFAULTS, shelfGeometry } from '../../../src/game/machines/shelf';
import { CLASSIC_FIELD, type FieldGeometry } from '../../../src/physics/fieldGeometry';
import { CHUTE, FIELD } from '../../../src/physics/fieldSpec';
import { frontSpans, innerEdges, openingLook, prizeSignSpot, visibleFloorShare } from '../../../src/scene/machines';
import type { DetailLevel } from '../../../src/scene/materials';
import { buildCabinet, layoutFor, triangles } from './cabinetHarness';
import { classicDigests } from './classicCabinetDigest';

/**
 * The classic cabinet as built on the tree before machine dressing existed (Cabinet.ts at 6735af9):
 * mesh count and a hash of every mesh's material, flags and attribute bytes, per layout / theme / tier.
 */
const CLASSIC_CABINET_DIGEST: Record<string, string> = {
  'desktop sakura medium': '33:4ccad227',
  'portrait32 ocean high': '33:4f8b902a',
  'mobile cosmic safe': '33:89ec0616',
  'portrait86 storybook ultra': '33:395f9152',
};

const bridge = bridgeGeometry(BRIDGE_DEFAULTS);
const shelf = shelfGeometry(SHELF_DEFAULTS);

function meshesOf(group: Group): Mesh[] {
  const out: Mesh[] = [];
  group.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function byMaterial(group: Group, name: string): Mesh[] {
  return meshesOf(group).filter((m) => (m.material as Material).name === name);
}

/** Vertices of a mesh inside a box (world coordinates: cabinet meshes are merged in world space). */
function verticesIn(meshes: Mesh[], box: { x: [number, number]; y: [number, number]; z: [number, number] }): number {
  let n = 0;
  for (const m of meshes) {
    const p = (m.geometry as BufferGeometry).getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (x > box.x[0] && x < box.x[1] && y > box.y[0] && y < box.y[1] && z > box.z[0] && z < box.z[1]) n++;
    }
  }
  return n;
}

describe('classic cabinet', () => {
  it('is byte-identical to the cabinet before machine dressing (floor, chute and every other bucket)', () => {
    expect(classicDigests()).toEqual(CLASSIC_CABINET_DIGEST);
  });

  it('passing CLASSIC_FIELD explicitly builds the same cabinet', () => {
    const a = buildCabinet({ detail: 1 });
    const b = buildCabinet({ detail: 1, field: CLASSIC_FIELD });
    const sig = (g: Group) => meshesOf(g).map((m) => `${(m.material as Material).name}:${m.geometry.getAttribute('position').count}`).join('|');
    expect(sig(b.cabinet.group)).toBe(sig(a.cabinet.group));
    expect(b.cabinet.group.userData.field).toBe(CLASSIC_FIELD);
  });
});

describe('machine cabinets', () => {
  const cases: [string, FieldGeometry][] = [
    ['bridge', bridge],
    ['shelf', shelf],
  ];

  it('add no draw call: every fixture look goes into a bucket the classic cabinet already has', () => {
    const classic = new Set(meshesOf(buildCabinet({ detail: 1 }).cabinet.group).map((m) => `${(m.material as Material).name}|${m.castShadow}|${m.receiveShadow}|${m.layers.mask}`));
    for (const [name, field] of cases) {
      const meshes = meshesOf(buildCabinet({ detail: 1, field }).cabinet.group);
      const extra = meshes.filter((m) => !classic.has(`${(m.material as Material).name}|${m.castShadow}|${m.receiveShadow}|${m.layers.mask}`));
      // The bridge's bars cast the key light's shadow: one chrome bucket with the cast flag.
      expect(extra.map((m) => (m.material as Material).name), name).toEqual(name === 'bridge' ? ['chrome'] : []);
      expect(meshes.length, name).toBeLessThanOrEqual(meshesOf(buildCabinet({ detail: 1 }).cabinet.group).length + 1);
    }
  });

  it('draws no chute guard without chuteGuard (and the classic one with it)', () => {
    const guard = { x: [CHUTE.xMax - 0.001, CHUTE.xMax + 0.014] as [number, number], y: [-0.001, 0.21] as [number, number], z: [-0.31, -0.04] as [number, number] };
    const acrylic = (field?: FieldGeometry) => byMaterial(buildCabinet({ detail: 1, field }).cabinet.group, 'acrylic');
    expect(verticesIn(acrylic(), guard)).toBeGreaterThan(0);
    for (const [name, field] of cases) expect(verticesIn(acrylic(field), guard), name).toBe(0);
  });

  it('leaves the floor hole open, with a collar on its inner edges and the front lip where there is floor', () => {
    for (const [name, field] of cases) {
      if (field.floor.kind !== 'hole') throw new Error('hole floor expected');
      const h = field.floor.hole;
      const g = buildCabinet({ detail: 1, field }).cabinet.group;
      const mat = byMaterial(g, 'mat');
      // No mat surface inside the hole at floor height (the slab is cut).
      expect(verticesIn(mat, { x: [h.xMin + 0.005, h.xMax - 0.005], y: [-0.07, 0.001], z: [h.zMin + 0.005, h.zMax - 0.005] }), name).toBe(0);
      // The dark collar runs down every inner edge.
      for (const edge of innerEdges(h)) {
        const x: [number, number] = edge === 'left' ? [h.xMin - 0.001, h.xMin + 0.006] : edge === 'right' ? [h.xMax - 0.006, h.xMax + 0.001] : [h.xMin, h.xMax];
        const z: [number, number] = edge === 'back' ? [h.zMin - 0.001, h.zMin + 0.006] : edge === 'front' ? [h.zMax - 0.006, h.zMax + 0.001] : [h.zMin, h.zMax];
        expect(verticesIn(byMaterial(g, 'dark'), { x, y: [-FIELD.floorThickness - 0.001, 0.001], z }), `${name} ${edge}`).toBeGreaterThan(0);
      }
    }
    expect(innerEdges(bridge.floor.kind === 'hole' ? bridge.floor.hole : (null as never))).toEqual(['right', 'back', 'left', 'front']);
    expect(innerEdges(shelf.floor.kind === 'hole' ? shelf.floor.hole : (null as never))).toEqual(['right', 'back']);
    expect(frontSpans(shelf.floor.kind === 'hole' ? shelf.floor.hole : (null as never))).toEqual([[0, FIELD.halfWidth]]);
    expect(frontSpans(bridge.floor.kind === 'hole' ? bridge.floor.hole : (null as never))).toEqual([[-FIELD.halfWidth, FIELD.halfWidth]]);
  });

  it('dresses the fixtures: bars in chrome, fences in acrylic with lit edges, the shelf deck, the gutter with arrows', () => {
    const b = buildCabinet({ detail: 1, field: bridge }).cabinet.group;
    const barL = bridge.fixtures.find((f) => f.id === 'barL')!;
    expect(verticesIn(byMaterial(b, 'chrome'), { x: [barL.center[0] - 0.013, barL.center[0] + 0.013], y: [0.087, 0.113], z: [-0.39, -0.05] })).toBeGreaterThan(0);
    const front = bridge.fixtures.find((f) => f.id === 'endFront')!;
    expect(verticesIn(byMaterial(b, 'acrylic'), { x: [-0.45, 0.05], y: [-0.001, 0.221], z: [front.center[2] - 0.006, front.center[2] + 0.006] })).toBeGreaterThan(0);
    expect(verticesIn(byMaterial(b, 'acrylicEdge'), { x: [-0.45, 0.05], y: [0.215, 0.23], z: [-0.4, -0.04] })).toBeGreaterThan(0);
    const s = buildCabinet({ detail: 1, field: shelf }).cabinet.group;
    // The deck: printed front panel facing the player, mat on top at the shelf height.
    expect(verticesIn(byMaterial(s, 'fascia'), { x: [-0.51, 0.51], y: [-0.001, 0.161], z: [-0.301, -0.299] })).toBeGreaterThan(0);
    expect(verticesIn(byMaterial(s, 'mat'), { x: [-0.51, 0.51], y: [0.159, 0.161], z: [-0.81, -0.29] })).toBeGreaterThan(0);
    expect(verticesIn(byMaterial(s, 'plastic'), { x: [-0.01, 0.51], y: [-0.001, 0.11], z: [-0.31, 0.01] })).toBeGreaterThan(0);
    expect(verticesIn(byMaterial(s, 'decal'), { x: [0, 0.5], y: [0.01, 0.12], z: [-0.3, 0] })).toBeGreaterThan(0);
  });

  it('hangs the PRIZE sign on the bridge front fence below the box, on the shelf front above the trough', () => {
    const b = prizeSignSpot(bridge)!;
    const front = bridge.fixtures.find((f) => f.id === 'endFront')!;
    expect(b.z).toBeGreaterThan(front.center[2]);
    expect(b.y + 0.025).toBeLessThan(BRIDGE_DEFAULTS.barY);
    const s = prizeSignSpot(shelf)!;
    expect(s.x).toBeCloseTo((shelf.opening.xMin + shelf.opening.xMax) / 2, 6);
    expect(s.z).toBeGreaterThan(SHELF_DEFAULTS.shelfFront);
    expect(s.y).toBeLessThan(SHELF_DEFAULTS.shelfY);
  });

  it('keeps the dressing cheap: extra triangles per tier', () => {
    const extra: Record<string, number[]> = {};
    for (const [name, field] of cases) {
      extra[name] = ([0, 1, 2, 3] as DetailLevel[]).map((detail) => {
        const layout = layoutFor('desktop', 1280, 720);
        return triangles(buildCabinet({ detail, layout, field }).cabinet.group) - triangles(buildCabinet({ detail, layout }).cabinet.group);
      });
    }
    // Medium (detail 1) stays far below the design's 470 k frame gate; Ultra under 40 k.
    expect(extra.bridge![1]!).toBeLessThan(12_000);
    expect(extra.shelf![1]!).toBeLessThan(12_000);
    for (const name of Object.keys(extra)) for (const n of extra[name]!) expect(n, name).toBeLessThan(40_000);
  });
});

describe('opening facts for the stage and the effects', () => {
  it('classic: the chute, its guard height, a visible floor', () => {
    const look = openingLook(CLASSIC_FIELD);
    expect(look.contactHole).toEqual({ xMin: CHUTE.xMin, xMax: CHUTE.xMax, zMin: CHUTE.zMin, zMax: CHUTE.zMax });
    expect(look.mouthY).toBeCloseTo(CHUTE.wallHeight + 0.012, 9);
    expect(look.floorVisible).toBe(true);
  });

  it('bridge: the pit, rings on top of its fences, a visible floor around it', () => {
    const look = openingLook(bridge);
    expect(look.contactHole).toEqual(bridge.floor.kind === 'hole' ? bridge.floor.hole : null);
    expect(look.mouthY).toBeGreaterThan(0.22);
    expect(look.floorVisible).toBe(true);
  });

  it('shelf: the trough, rings just above the floor, no floor left for contact shadows', () => {
    const look = openingLook(shelf);
    expect(look.mouthY).toBeCloseTo(0.012, 9);
    expect(visibleFloorShare(shelf, look.contactHole)).toBe(0);
    expect(look.floorVisible).toBe(false);
  });
});
