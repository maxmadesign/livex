/**
 * How a machine's fixtures look (docs/design/machines.md, section 5.1). Every part goes into the
 * cabinet's existing material buckets (CabinetBuilder), so a machine adds geometry but no draw call
 * beyond the buckets it touches:
 *
 *   chrome   capsule bars (cylinder plus round ends) and chrome boxes (the shelf's lip)
 *   acrylic  clear fences with a lit top edge and chrome corner posts (as the classic chute guard)
 *   deck     the raised shelf: a printed front panel, a mat top, an accent edge and a light strip
 *   ramp     the gutter slab with arrows pointing at the trough
 *   hidden   nothing
 *
 * Purely visual: the physics builds the same fixtures from the same `FieldGeometry`.
 */
import { BufferGeometry, CylinderGeometry, Matrix4, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Fixture, FieldGeometry } from '../../physics/fieldGeometry';
import { FIELD } from '../../physics/fieldSpec';
import { shadeStrip } from '../arcadeRow';
import { worldUV, type CabinetBuilder } from '../builder';
import type { CabinetMaterials, DetailLevel } from '../materials';
import { decalUv } from '../textures';
import { MAT_TILES_PER_METRE } from './floor';

export interface DressContext {
  detail: DetailLevel;
  /** Radial segments of cylinders (the tier's tessellation). */
  radial: number;
  /** Rounded box with the tier's bevel tessellation (Cabinet.box). */
  box: (w: number, h: number, d: number, r?: number) => BufferGeometry;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);

/** World matrix of a fixture (its centre and rotation). */
function fixtureMatrix(f: Fixture): Matrix4 {
  const r = f.rot ?? [0, 0, 0, 1];
  return _m.compose(_p.set(f.center[0], f.center[1], f.center[2]), _q.set(r[0], r[1], r[2], r[3]), _s);
}

/** Adds a geometry given in the fixture's own frame. */
function addLocal(b: CabinetBuilder, material: Parameters<CabinetBuilder['add']>[0], f: Fixture, g: BufferGeometry, opts: Parameters<CabinetBuilder['add']>[8] = {}): void {
  g.applyMatrix4(fixtureMatrix(f));
  b.add(material, g, 0, 0, 0, 0, 0, 0, opts);
}

/** A capsule along +y of the given radius and straight half length (open cylinder plus two half spheres). */
export function capsuleGeometry(radius: number, halfLength: number, radial: number): BufferGeometry[] {
  const rings = Math.max(4, radial >> 2);
  const body = new CylinderGeometry(radius, radius, 2 * halfLength, radial, 1, true);
  const top = new SphereGeometry(radius, radial, rings, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, halfLength, 0);
  const bottom = new SphereGeometry(radius, radial, rings, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -halfLength, 0);
  return [body, top, bottom];
}

/** Turns a +y-aligned part onto a capsule's axis. */
function alignToAxis(g: BufferGeometry, axis: 'x' | 'y' | 'z'): BufferGeometry {
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(Math.PI / 2);
  return g;
}

function buildChrome(b: CabinetBuilder, M: CabinetMaterials, f: Fixture, all: readonly Fixture[], ctx: DressContext): void {
  if (f.shape.type === 'box') {
    const [hx, hy, hz] = f.shape.half;
    addLocal(b, M.chrome, f, ctx.box(2 * hx, 2 * hy, 2 * hz, Math.min(0.003, hy, hz)));
    return;
  }
  const { axis, halfLength, radius } = f.shape;
  // Bars cast the key light's shadow onto the pit and the floor (a strong depth cue under the box).
  for (const g of capsuleGeometry(radius, halfLength, ctx.radial)) addLocal(b, M.chrome, f, alignToAxis(g, axis), { cast: true });
  // Where a bar runs into an acrylic fence, a thin brushed flange seats it there.
  const dir = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (const sign of [-1, 1]) {
    const end = f.center[dir]! + sign * (halfLength + radius);
    const fence = all.find((o) => o.look === 'acrylic' && o.shape.type === 'box' && Math.abs(o.center[dir]! - sign * o.shape.half[dir]! - end) < 0.012);
    if (!fence || fence.shape.type !== 'box') continue;
    const face = fence.center[dir]! - sign * fence.shape.half[dir]!;
    const flange = alignToAxis(new CylinderGeometry(radius * 1.4, radius * 1.4, 0.003, ctx.radial), axis);
    const at: [number, number, number] = [f.center[0], f.center[1], f.center[2]];
    at[dir] = face - sign * 0.0015;
    b.add(M.brushed, flange, at[0], at[1], at[2]);
  }
}

function buildAcrylic(b: CabinetBuilder, M: CabinetMaterials, f: Fixture, ctx: DressContext, posts: [number, number][]): void {
  if (f.shape.type !== 'box') {
    for (const g of capsuleGeometry(f.shape.radius, f.shape.halfLength, ctx.radial)) addLocal(b, M.acrylic, f, alignToAxis(g, f.shape.axis));
    return;
  }
  const [hx, hy, hz] = f.shape.half;
  addLocal(b, M.acrylic, f, ctx.box(2 * hx, 2 * hy, 2 * hz, Math.min(0.002, hx, hy, hz)));
  // The lit top edge, as on the classic chute guard.
  const edge = ctx.box(2 * hx + 0.006, 0.008, 2 * hz + 0.006, 0.003).translate(0, hy + 0.002, 0);
  addLocal(b, M.acrylicEdge, f, edge);
  // Corner posts at both ends of the fence's long side (shared corners get one post).
  if (!f.rot) {
    const long = hx >= hz ? 0 : 2;
    for (const sign of [-1, 1]) {
      const x = long === 0 ? f.center[0] + sign * hx : f.center[0];
      const z = long === 2 ? f.center[2] + sign * hz : f.center[2];
      if (posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.02)) continue;
      posts.push([x, z]);
      const h = f.center[1] + hy + 0.006;
      b.add(M.chrome, new CylinderGeometry(0.0065, 0.0065, h, ctx.radial), x, h / 2, z);
    }
  }
}

function buildDeck(b: CabinetBuilder, M: CabinetMaterials, f: Fixture, ctx: DressContext): void {
  if (f.shape.type !== 'box') return;
  const [hx, hy, hz] = f.shape.half;
  const [cx, cy, cz] = f.center;
  const top = cy + hy, front = cz + hz, coat = 0.012;
  // Body with the printed cabinet panel facing the player, mat on top (world UVs, as the floor).
  b.add(M.fascia, worldUV(ctx.box(2 * hx, 2 * hy - coat, 2 * hz), 'xy', 2.2), cx, cy - coat / 2, cz, 0, 0, 0, { receive: true });
  const mat = ctx.box(2 * hx, coat, 2 * hz).translate(cx, top - coat / 2, cz);
  b.add(M.mat, worldUV(mat, 'xz', MAT_TILES_PER_METRE), 0, 0, 0, 0, 0, 0, { receive: true });
  // Lacquered edge along the front, a light strip under it.
  b.add(M.accent, ctx.box(2 * hx, 0.012, 0.008, 0.003), cx, top - 0.006, front + 0.002);
  b.add(M.leds[0]!, ctx.box(2 * hx - 0.04, 0.006, 0.004), cx, top - 0.026, front + 0.0015);
  // Baked occlusion where the deck meets the back wall (the floor's own strip is under the deck now).
  if (cz - hz <= -FIELD.depth + 0.01) {
    shadeStrip(b, M, cx, top + 0.0012, -FIELD.depth + 0.001, 2 * hx, 0.12, 'floor');
    shadeStrip(b, M, cx, top, -FIELD.depth + 0.0015, 2 * hx, 0.16, 'wallUp');
  }
}

function buildRamp(b: CabinetBuilder, M: CabinetMaterials, f: Fixture, ctx: DressContext): void {
  if (f.shape.type !== 'box') return;
  const [hx, hy, hz] = f.shape.half;
  addLocal(b, M.plastic, f, ctx.box(2 * hx, 2 * hy, 2 * hz, Math.min(0.003, hy)));
  // Arrows printed on the slope, pointing down it (local −x) towards the trough.
  const w = Math.min(0.11, 1.4 * hz);
  const [u0, v0, u1, v1] = decalUv('arrow');
  for (const x of [-hx * 0.45, hx * 0.35]) {
    const g = new PlaneGeometry(w, w);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    // Flat on the top face; the arrow's tip (the picture's bottom) points along local −x.
    g.rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(x, hy + 0.0008, 0);
    addLocal(b, M.decal, f, g, { keepUv: true });
  }
}

/** Adds every fixture of a machine to the cabinet's buckets. */
export function buildFixtures(b: CabinetBuilder, M: CabinetMaterials, fixtures: readonly Fixture[], ctx: DressContext): void {
  const posts: [number, number][] = [];
  for (const f of fixtures) {
    if (f.look === 'chrome') buildChrome(b, M, f, fixtures, ctx);
    else if (f.look === 'acrylic') buildAcrylic(b, M, f, ctx, posts);
    else if (f.look === 'deck') buildDeck(b, M, f, ctx);
    else if (f.look === 'ramp') buildRamp(b, M, f, ctx);
  }
}

/**
 * Where the "PRIZE" sign goes on a machine without the chute guard: on the outside of the fence
 * nearest the player, else on the shelf's front panel above the opening; null when neither exists.
 */
export function prizeSignSpot(field: FieldGeometry): { x: number; y: number; z: number } | null {
  const fences = field.fixtures.filter((f) => f.look === 'acrylic' && f.shape.type === 'box' && !f.rot);
  if (fences.length > 0) {
    const f = fences.reduce((a, c) => (c.center[2] > a.center[2] ? c : a));
    if (f.shape.type !== 'box') return null;
    // Low on the fence, under whatever sits behind it (the bridge box rests above 0.1 m).
    return { x: f.center[0], y: f.center[1] - f.shape.half[1] + 0.034, z: f.center[2] + f.shape.half[2] + 0.001 };
  }
  const deck = field.fixtures.find((f) => f.look === 'deck' && f.shape.type === 'box');
  if (deck && deck.shape.type === 'box') {
    const o = field.opening;
    return { x: (o.xMin + o.xMax) / 2, y: (deck.center[1] + deck.shape.half[1]) * 0.55, z: deck.center[2] + deck.shape.half[2] + 0.001 };
  }
  return null;
}
