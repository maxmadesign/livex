/**
 * The physics side of machines: a PhysicsWorld built from FieldGeometry (classic unchanged,
 * fixtures after the bin), machine items and the toy id prefix.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CLASSIC_FIELD } from '../../../src/physics/fieldGeometry';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { boxItem, coinItem, gemItem, itemAsset } from '../../../src/physics/items';
import { PhysicsWorld, RAPIER, initRapier, type PhysicsOptions } from '../../../src/physics/PhysicsWorld';
import { BRIDGE_GEOMETRY, SHELF_GEOMETRY } from './designGeometry';

beforeAll(async () => {
  await initRapier();
});
const worlds: PhysicsWorld[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});
function world(extra: Partial<PhysicsOptions> = {}): PhysicsWorld {
  const w = new PhysicsWorld({ binFloorY: -0.6, toyFriction: 1, ...extra });
  worlds.push(w);
  return w;
}

interface ColliderRow {
  handle: number;
  body: number;
  shape: number;
  pos: number[];
  rot: number[];
  friction: number;
  restitution: number;
  sensor: boolean;
  groups: number;
  kind: string | undefined;
}
function colliders(w: PhysicsWorld): ColliderRow[] {
  const out: ColliderRow[] = [];
  w.world.forEachCollider((c) => {
    const t = c.translation();
    const r = c.rotation();
    out.push({
      handle: c.handle,
      body: c.parent()!.handle,
      shape: c.shape.type,
      pos: [t.x, t.y, t.z],
      rot: [r.x, r.y, r.z, r.w],
      friction: c.friction(),
      restitution: c.restitution(),
      sensor: c.isSensor(),
      groups: c.collisionGroups(),
      kind: w.staticKind(c.handle),
    });
  });
  return out;
}
const kinds = (w: PhysicsWorld, kind: string) => colliders(w).filter((c) => c.kind === kind);

describe('PhysicsWorld from FieldGeometry', () => {
  it('the classic world is the world built without options: same colliders, handles and numbers', () => {
    const plain = world();
    const explicit = world({ field: CLASSIC_FIELD, idPrefix: '' });
    expect(colliders(explicit)).toEqual(colliders(plain));
    expect(explicit.world.bodies.len()).toBe(plain.world.bodies.len());
    // Cabinet + bin: no fixture body on classic.
    expect(plain.world.bodies.len()).toBe(2);
    expect(kinds(plain, 'floor')).toHaveLength(2);
    expect(kinds(plain, 'chuteWall')).toHaveLength(2);
    expect(plain.field).toBe(CLASSIC_FIELD);
  });

  it('a bridge world: four floor boxes around the pit, no guard, six fixture colliders on one extra body', () => {
    const w = world({ field: BRIDGE_GEOMETRY });
    expect(w.world.bodies.len()).toBe(3);
    expect(kinds(w, 'floor')).toHaveLength(4);
    expect(kinds(w, 'chuteWall')).toHaveLength(0);
    const fixtures = [...kinds(w, 'bar'), ...kinds(w, 'fence')];
    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((c) => c.body)).size).toBe(1);
    // Created after the bin: their handles come last.
    const maxOther = Math.max(...colliders(w).filter((c) => c.kind !== 'bar' && c.kind !== 'fence').map((c) => c.handle));
    expect(Math.min(...fixtures.map((c) => c.handle))).toBeGreaterThan(maxOther);
    // A bar is a capsule turned onto the z axis.
    const bar = kinds(w, 'bar')[0]!;
    expect(bar.shape).toBe(RAPIER.ShapeType.Capsule);
    expect(bar.pos).toEqual([-0.287, 0.1, -0.22].map((v) => expect.closeTo(v, 6)));
    expect(bar.friction).toBeCloseTo(0.35, 6);
    // The sensor sits under the pit.
    const sensor = colliders(w).find((c) => c.sensor)!;
    expect(sensor.pos[0]).toBeCloseTo(-0.2, 6);
    expect(sensor.pos[1]).toBeCloseTo(-0.2, 6);
    expect(sensor.pos[2]).toBeCloseTo(-0.22, 6);
    expect(w.opening).toBe(BRIDGE_GEOMETRY.opening);
  });

  it('the shelf gutter uses the Min friction combine rule', () => {
    const w = world({ field: SHELF_GEOMETRY });
    expect(kinds(w, 'floor')).toHaveLength(2);
    const handle = kinds(w, 'gutter')[0]!.handle;
    expect(w.world.getCollider(handle).frictionCombineRule()).toBe(RAPIER.CoefficientCombineRule.Min);
    expect(w.world.getCollider(kinds(w, 'shelf')[0]!.handle).frictionCombineRule()).toBe(RAPIER.CoefficientCombineRule.Average);
  });

  it('a capsule along z really spans z: a box dropped across both bars rests on them', () => {
    const w = world({ field: BRIDGE_GEOMETRY });
    const spec = boxItem({ look: 'bridgeBox', size: [0.24, 0.1, 0.13], mass: 0.4, round: 0.004, friction: 0.6, print: 'sakura.bunny' });
    const box = w.addItem(spec, 'sakura', [-0.2, 0.125, -0.22], [0, 0, 0, 1]);
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) w.step();
    const c = box.body.worldCom();
    // Bar tops at 0.112: the box (0.10 tall) rests with its centre about 0.05 above them.
    expect(c.y).toBeGreaterThan(0.15);
    expect(c.y).toBeLessThan(0.18);
    expect(w.sensorHits.size).toBe(0);
  });
});

describe('machine items', () => {
  it('addItem builds a toy body with the item material, mass and id prefix', () => {
    const w = world({ idPrefix: 'e2-' });
    const spec = boxItem({ look: 'snackM', size: [0.075, 0.06, 0.05], mass: 0.06, round: 0.003, friction: 0.6, print: 'sakura.tanuki' });
    const toy = w.addItem(spec, 'sakura', [0.1, 0, -0.4], [0, 0, 0, 1]);
    expect(toy.id).toBe('e2-item-1');
    expect(toy.item).toBe(spec);
    expect(toy.asset.id).toBe('item.snackM');
    expect(toy.asset.model.lods).toEqual([]);
    expect(toy.scale).toBe(1);
    expect(toy.mass).toBeCloseTo(0.06, 6);
    expect(toy.body.linearDamping()).toBeCloseTo(0.3, 6);
    expect(toy.body.angularDamping()).toBeCloseTo(1.5, 6);
    for (const c of toy.colliders) {
      expect(c.collider.friction()).toBeCloseTo(0.6, 6);
      expect(c.collider.restitution()).toBeCloseTo(0.05, 6);
      expect(c.role).toBe('core');
      expect(w.toyOfCollider(c.collider.handle)).toBe(toy);
    }
    expect(w.toys.get(toy.id)).toBe(toy);
    // Plush toys of the same world carry the prefix too.
    expect(w.addToy(itemAsset(spec, 'sakura'), [0.2, 0, -0.4], [0, 0, 0, 1], 1, 1).id).toBe('e2-toy-2');
  });

  it('setToyFriction leaves items alone', () => {
    const w = world();
    const spec = gemItem({ look: 'gemRuby', radius: 0.038, mass: 0.034, value: 50 });
    const gem = w.addItem(spec, 'gpu', [0.1, 0.05, -0.4], [0, 0, 0, 1]);
    const plush = w.addToy(itemAsset(spec, 'gpu'), [0.2, 0.05, -0.4], [0, 0, 0, 1], 1, 1);
    w.setToyFriction(0.5);
    expect(gem.colliders[0]!.collider.friction()).toBeCloseTo(0.7, 6);
    expect(plush.colliders[0]!.collider.friction()).toBeCloseTo(0.45, 6);
    expect(w.toyFriction).toBe(0.5);
  });

  it('a brilliant has 17 hull points, a coin 24; both come to rest on the floor', () => {
    const gem = gemItem({ look: 'gemDiamond', radius: 0.04, mass: 0.036, value: 150 });
    const coin = coinItem({ radius: 0.026, thickness: 0.01, mass: 0.012, value: 5 });
    const pts = (s: typeof gem) => (s.proxies[0]!.geometry as { points: number[] }).points.length / 3;
    expect(pts(gem)).toBe(17);
    expect(pts(coin)).toBe(24);
    expect(gem.kind).toBe('gem');
    expect(coin.kind).toBe('coin');
    expect(gem.print).toBeNull();
    expect([gem.value, coin.value]).toEqual([150, 5]);
    const w = world();
    const a = w.addItem(gem, 'cosmic', [0.1, 0.1, -0.4], [0, 0, 0, 1]);
    const b = w.addItem(coin, 'cosmic', [0.2, 0.1, -0.4], [0, 0, 0, 1]);
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) w.step();
    for (const t of [a, b]) {
      const c = t.body.worldCom();
      expect([c.x, c.y, c.z].every(Number.isFinite)).toBe(true);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(0.05);
    }
    expect(a.mass).toBeCloseTo(0.036, 6);
  });

  it('an item dropped into the opening is seen by the prize sensor', () => {
    const w = world({ field: BRIDGE_GEOMETRY });
    const spec = boxItem({ look: 'bridgeBox', size: [0.24, 0.1, 0.13], mass: 0.4, round: 0.004, friction: 0.6, print: 'sakura.bunny' });
    // Between the bars and the left fence there is a 12 cm strip: a box on its side falls through.
    // Turned onto its side (a quarter turn about z moves the box centre 5 cm towards -x of its base).
    const box = w.addItem(spec, 'sakura', [-0.31, 0.15, -0.22], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    let seen = false;
    for (let i = 0; i < Math.round(2 / FIXED_DT) && !seen; i++) {
      w.step();
      seen = w.sensorHits.has(box) || w.isInPrizeSensor(box);
    }
    expect(seen).toBe(true);
  });
});
