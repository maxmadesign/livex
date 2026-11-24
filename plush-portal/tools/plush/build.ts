/**
 * Turns a PlushDesign into render meshes (three LODs with all custom vertex
 * attributes), collision proxies and the numbers that go into the manifest.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import type { DeformInfo, PaintRegion, ProxyShape } from '../../src/plush/manifest';
import type { Vec3 } from '../../src/core/types';
import type { DiscPatch, LayerDef, PartDef, PatchDef, PlushDesign, PolyPatch, StrokePatch, SurfaceKind, TagPatch } from './dsl';
import { cleanMesh, surfaceNets, type Bounds } from './mesher';
import { projectToSurface, smax, smin, unitNormal, type DistFn, type V3 } from './sdf';

/** Distance (cm) that maps to ±1 in the `_MASK` attribute. */
export const MASK_RANGE_CM = 2;
/** Distance (cm) that maps to 1 in the seam channel. */
export const SEAM_RANGE_CM = 1;
const EPS = 0.04;

export interface Mesh {
  count: number;
  position: Float32Array;
  normal: Float32Array;
  /** Linear RGB + baked ambient occlusion. */
  color: Float32Array;
  /** Signed distance to each paint region, normalised to ±1 over MASK_RANGE_CM. */
  mask: Float32Array;
  /** roughness, sheen, gloss, fur length. */
  surf: Float32Array;
  /** softness, signed seam distance (0.5 = on a seam, 0 / 1 = far), metalness, thread amount. */
  aux: Float32Array;
  indices: Uint32Array;
}

export interface BuiltAsset {
  lods: Mesh[];
  /** Uniform scale that was applied (model cm → final metres). */
  metresPerUnit: number;
  size: Vec3;
  footprint: number;
  comHeight: number;
  proxies: ProxyShape[];
  paint: PaintRegion[];
  palette: string[];
  materials: string[];
  deform: DeformInfo;
  /** `_MASK` range in metres after scaling. */
  maskRange: number;
}

const SURFACE: Record<SurfaceKind, { rough: number; sheen: number; gloss: number; fur: number; metal: number; thread: number }> = {
  fur: { rough: 0.96, sheen: 1, gloss: 0, fur: 1, metal: 0, thread: 0 },
  shortfur: { rough: 0.9, sheen: 0.8, gloss: 0, fur: 0.45, metal: 0, thread: 0 },
  felt: { rough: 0.98, sheen: 0.35, gloss: 0, fur: 0.08, metal: 0, thread: 0 },
  thread: { rough: 0.52, sheen: 0.3, gloss: 0, fur: 0, metal: 0, thread: 1 },
  bead: { rough: 0.06, sheen: 0, gloss: 1, fur: 0, metal: 0, thread: 0 },
  satin: { rough: 0.36, sheen: 0.5, gloss: 0.12, fur: 0, metal: 0, thread: 0.45 },
  gloss: { rough: 0.14, sheen: 0, gloss: 0.9, fur: 0, metal: 0, thread: 0 },
  knit: { rough: 0.93, sheen: 0.6, gloss: 0, fur: 0.22, metal: 0, thread: 0.7 },
  metal: { rough: 0.3, sheen: 0, gloss: 0.25, fur: 0, metal: 1, thread: 0 },
};

/* ------------------------------------------------------------------ colour */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(v, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  return `#${[ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------ fields */

interface LayerField {
  layer: LayerDef;
  fn: DistFn;
  add: PartDef[];
}

function layerField(layer: LayerDef): LayerField {
  const add = layer.parts.filter((p) => !p.subtract);
  const sub = layer.parts.filter((p) => p.subtract);
  const base = layer.flatBase;
  const fn: DistFn = (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < add.length; i++) {
      const p = add[i]!;
      const v = p.fn(x, y, z);
      d = d === Infinity ? v : smin(d, v, p.k);
    }
    for (let i = 0; i < sub.length; i++) {
      const p = sub[i]!;
      d = smax(d, -p.fn(x, y, z), p.k);
    }
    if (base !== undefined) d = smax(d, -y, base);
    return d;
  };
  return { layer, fn, add };
}

function findBounds(fn: DistFn): Bounds {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const step = 1;
  for (let z = -32; z <= 32; z += step) {
    for (let y = -6; y <= 54; y += step) {
      for (let x = -32; x <= 32; x += step) {
        if (fn(x, y, z) < step * 0.9) {
          if (x < min[0]) min[0] = x;
          if (y < min[1]) min[1] = y;
          if (z < min[2]) min[2] = z;
          if (x > max[0]) max[0] = x;
          if (y > max[1]) max[1] = y;
          if (z > max[2]) max[2] = z;
        }
      }
    }
  }
  if (min[0] === Infinity) throw new Error('empty layer');
  return { min: [min[0] - 1, min[1] - 1, min[2] - 1], max: [max[0] + 1, max[1] + 1, max[2] + 1] };
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Softness of the stuffed toy at a point (0 firm .. 1 floppy), from the parts of one layer. */
function softnessAt(field: LayerField, x: number, y: number, z: number): number {
  let total = 0;
  let acc = 0;
  let dMin = Infinity;
  const ds: number[] = [];
  for (const p of field.add) {
    const d = p.fn(x, y, z);
    ds.push(d);
    if (d < dMin) dMin = d;
  }
  for (let i = 0; i < field.add.length; i++) {
    const p = field.add[i]!;
    const w = Math.exp(-Math.max(0, ds[i]! - dMin) / 0.6);
    let s = p.soft;
    if (p.root && p.reach) {
      const dist = Math.hypot(x - p.root[0], y - p.root[1], z - p.root[2]);
      s *= sstep(0.1, 1, dist / p.reach);
    }
    acc += w * s;
    total += w;
  }
  return total > 0 ? acc / total : 0;
}

/* -------------------------------------------------------------- layer mesh */

function emptyMesh(count: number, indices: Uint32Array): Mesh {
  return {
    count,
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    color: new Float32Array(count * 4),
    mask: new Float32Array(count * 4).fill(1),
    surf: new Float32Array(count * 4),
    aux: new Float32Array(count * 4),
    indices,
  };
}

function buildLayerMesh(field: LayerField, design: PlushDesign, unionFn: DistFn, cell: number): { mesh: Mesh; dominant: Int16Array } {
  const raw = cleanMesh(surfaceNets(field.fn, findBounds(field.fn), cell));
  const count = raw.positions.length / 3;
  const mesh = emptyMesh(count, raw.indices);
  mesh.position.set(raw.positions);
  mesh.normal.set(raw.normals);
  const dominant = new Int16Array(count);
  const layer = field.layer;
  const s = SURFACE[layer.surface];
  const fur = layer.fur ?? s.fur;
  const colors = field.add.map((p) => hexToLinear(p.color));
  const paints = (design.paints ?? []).filter((p) => (p.layer ?? 'body') === layer.name);
  const ds = new Float64Array(field.add.length);
  const pieceOrder = new Map<string, number>();
  for (const p of field.add) if (!pieceOrder.has(p.piece)) pieceOrder.set(p.piece, pieceOrder.size);
  const seamPiece = new Int16Array(count).fill(-1);
  const seamNeighbours: Set<number>[] = Array.from({ length: pieceOrder.size }, () => new Set<number>());
  const aoDist = [0.5, 1.2, 2.6];
  const aoWeight = [0.5, 0.32, 0.18];

  for (let v = 0; v < count; v++) {
    const x = raw.positions[v * 3]!, y = raw.positions[v * 3 + 1]!, z = raw.positions[v * 3 + 2]!;
    const nx = raw.normals[v * 3]!, ny = raw.normals[v * 3 + 1]!, nz = raw.normals[v * 3 + 2]!;
    let dMin = Infinity;
    let iMin = 0;
    for (let i = 0; i < field.add.length; i++) {
      const d = field.add[i]!.fn(x, y, z);
      ds[i] = d;
      if (d < dMin) {
        dMin = d;
        iMin = i;
      }
    }
    dominant[v] = iMin;
    // Colour: soft-min blend of the part colours (crisp markings are done with paint masks instead).
    let r = 0, g = 0, b = 0, wSum = 0;
    for (let i = 0; i < field.add.length; i++) {
      const w = Math.exp(-Math.max(0, ds[i]! - dMin) / 0.22);
      if (w < 1e-4) continue;
      const c = colors[i]!;
      r += c[0] * w;
      g += c[1] * w;
      b += c[2] * w;
      wSum += w;
    }
    // Seam: where the two closest *different pieces* are equally near. The distance is stored
    // signed (its sign flips across the junction) so that interpolation between vertices passes
    // exactly through zero and the shader can draw a continuous line.
    let seam = SEAM_RANGE_CM;
    if (layer.seams !== false) {
      const piece = field.add[iMin]!.piece;
      let other = -1;
      for (let i = 0; i < field.add.length; i++) {
        if (field.add[i]!.piece === piece) continue;
        const gap = ds[i]! - dMin;
        if (gap < seam) {
          seam = gap;
          other = i;
        }
      }
      // The sign is assigned per piece after the adjacency of all pieces is known (see below).
      seamPiece[v] = pieceOrder.get(piece)!;
      if (other >= 0) {
        const o = pieceOrder.get(field.add[other]!.piece)!;
        seamNeighbours[seamPiece[v]!]!.add(o);
        seamNeighbours[o]!.add(seamPiece[v]!);
      }
    }
    // Ambient occlusion from the union of every layer.
    let occ = 0;
    for (let i = 0; i < aoDist.length; i++) {
      const dd = aoDist[i]!;
      const d = unionFn(x + nx * dd, y + ny * dd, z + nz * dd);
      occ += aoWeight[i]! * Math.max(0, (dd - d) / dd);
    }
    let ao = 1 - Math.min(1, occ) * 0.85;
    ao *= 0.8 + 0.2 * sstep(0, 3, y); // contact shadow near the base
    mesh.color[v * 4] = r / wSum;
    mesh.color[v * 4 + 1] = g / wSum;
    mesh.color[v * 4 + 2] = b / wSum;
    mesh.color[v * 4 + 3] = Math.max(0.25, ao);
    for (const p of paints) {
      mesh.mask[v * 4 + p.channel] = Math.max(-1, Math.min(1, p.fn(x, y, z) / MASK_RANGE_CM));
    }
    mesh.surf[v * 4] = s.rough;
    mesh.surf[v * 4 + 1] = s.sheen;
    mesh.surf[v * 4 + 2] = s.gloss;
    mesh.surf[v * 4 + 3] = fur;
    mesh.aux[v * 4] = Math.min(1, softnessAt(field, x, y, z));
    mesh.aux[v * 4 + 1] = Math.max(0, Math.min(1, seam / SEAM_RANGE_CM));
    mesh.aux[v * 4 + 2] = s.metal;
    mesh.aux[v * 4 + 3] = s.thread;
  }
  // Signed seam distance: every piece gets one sign, chosen by two-colouring the piece adjacency
  // graph (body +, parts sewn onto it −, parts sewn onto those +, …). Across a junction between
  // differently coloured pieces the value passes through zero, so the shader draws one continuous
  // line; inside a piece the sign never changes, so no stray lines appear.
  const colour = new Int8Array(pieceOrder.size);
  for (let start = 0; start < colour.length; start++) {
    if (colour[start] !== 0) continue;
    colour[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const a = queue.shift()!;
      for (const b of seamNeighbours[a]!) {
        if (colour[b] !== 0) continue;
        colour[b] = -colour[a]! as 1 | -1;
        queue.push(b);
      }
    }
  }
  for (let v = 0; v < count; v++) {
    const piece = seamPiece[v]!;
    const sign = piece >= 0 ? colour[piece]! : 1;
    mesh.aux[v * 4 + 1] = 0.5 + 0.5 * sign * mesh.aux[v * 4 + 1]!;
  }
  return { mesh, dominant };
}

/* ------------------------------------------------------------- simplifying */

function simplify(mesh: Mesh, targetTriangles: number): Mesh {
  const triCount = mesh.indices.length / 3;
  if (triCount <= targetTriangles) return mesh;
  // Attributes that matter for the look: normal (3), colour (3), masks (4), softness (1) and the
  // seam distance (1) — without it the simplifier leaves large triangles across seams and the
  // interpolated seam line turns into a zigzag.
  const stride = 12;
  const attrs = new Float32Array(mesh.count * stride);
  for (let v = 0; v < mesh.count; v++) {
    attrs.set(mesh.normal.subarray(v * 3, v * 3 + 3), v * stride);
    attrs.set(mesh.color.subarray(v * 4, v * 4 + 3), v * stride + 3);
    attrs.set(mesh.mask.subarray(v * 4, v * 4 + 4), v * stride + 6);
    attrs[v * stride + 10] = mesh.aux[v * 4]!;
    attrs[v * stride + 11] = mesh.aux[v * 4 + 1]!;
  }
  const weights = [0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.9, 0.9, 0.9, 0.9, 0.2, 1.4];
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices,
    mesh.position,
    3,
    attrs,
    stride,
    weights,
    null,
    Math.max(12, Math.floor(targetTriangles) * 3),
    0.08,
    [],
  );
  return compact(mesh, indices);
}

/** Drops unreferenced vertices. */
function compact(mesh: Mesh, indices: Uint32Array): Mesh {
  const remap = new Int32Array(mesh.count).fill(-1);
  let next = 0;
  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]!;
    if (remap[v] === -1) remap[v] = next++;
    outIdx[i] = remap[v]!;
  }
  const out = emptyMesh(next, outIdx);
  for (let v = 0; v < mesh.count; v++) {
    const n = remap[v]!;
    if (n < 0) continue;
    out.position.set(mesh.position.subarray(v * 3, v * 3 + 3), n * 3);
    out.normal.set(mesh.normal.subarray(v * 3, v * 3 + 3), n * 3);
    out.color.set(mesh.color.subarray(v * 4, v * 4 + 4), n * 4);
    out.mask.set(mesh.mask.subarray(v * 4, v * 4 + 4), n * 4);
    out.surf.set(mesh.surf.subarray(v * 4, v * 4 + 4), n * 4);
    out.aux.set(mesh.aux.subarray(v * 4, v * 4 + 4), n * 4);
  }
  return out;
}

function merge(meshes: Mesh[]): Mesh {
  const count = meshes.reduce((a, m) => a + m.count, 0);
  const indexCount = meshes.reduce((a, m) => a + m.indices.length, 0);
  const out = emptyMesh(count, new Uint32Array(indexCount));
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    out.position.set(m.position, vo * 3);
    out.normal.set(m.normal, vo * 3);
    out.color.set(m.color, vo * 4);
    out.mask.set(m.mask, vo * 4);
    out.surf.set(m.surf, vo * 4);
    out.aux.set(m.aux, vo * 4);
    for (let i = 0; i < m.indices.length; i++) out.indices[io + i] = m.indices[i]! + vo;
    vo += m.count;
    io += m.indices.length;
  }
  return out;
}

/* ----------------------------------------------------------------- patches */

class PatchBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly surf: number[] = [];
  readonly aux: number[] = [];
  readonly idx: number[] = [];

  vertex(p: V3, color: [number, number, number], kind: SurfaceKind, soft: number): number {
    const s = SURFACE[kind];
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(color[0], color[1], color[2], 1);
    this.surf.push(s.rough, s.sheen, s.gloss, 0);
    this.aux.push(soft, 1, s.metal, s.thread);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  toMesh(): Mesh {
    const count = this.pos.length / 3;
    const mesh = emptyMesh(count, new Uint32Array(this.idx));
    mesh.position.set(this.pos);
    mesh.color.set(this.col);
    mesh.surf.set(this.surf);
    mesh.aux.set(this.aux);
    // Normals from geometry (area weighted).
    const p = mesh.position, n = mesh.normal;
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t]!, b = this.idx[t + 1]!, c = this.idx[t + 2]!;
      const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        n[v * 3] = n[v * 3]! + fx;
        n[v * 3 + 1] = n[v * 3 + 1]! + fy;
        n[v * 3 + 2] = n[v * 3 + 2]! + fz;
      }
    }
    for (let v = 0; v < count; v++) {
      const l = Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!) || 1;
      n[v * 3] = n[v * 3]! / l;
      n[v * 3 + 1] = n[v * 3 + 1]! / l;
      n[v * 3 + 2] = n[v * 3 + 2]! / l;
    }
    return mesh;
  }
}

interface Frame {
  o: V3;
  t: V3;
  b: V3;
  n: V3;
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Tangent frame on the surface near `at`: t points to the character's +X ("right on screen"), b points up. */
function surfaceFrame(fn: DistFn, at: V3, rotDeg = 0): Frame {
  const o = projectToSurface(fn, at, EPS, 10);
  const n = unitNormal(fn, o[0], o[1], o[2], EPS);
  let t = cross([0, 1, 0], n);
  if (Math.hypot(t[0], t[1], t[2]) < 0.15) t = cross(n, [0, 0, 1]);
  t = norm(t);
  let b = norm(cross(n, t));
  if (rotDeg !== 0) {
    const c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
    const t2: V3 = [t[0] * c + b[0] * s, t[1] * c + b[1] * s, t[2] * c + b[2] * s];
    b = [-t[0] * s + b[0] * c, -t[1] * s + b[1] * c, -t[2] * s + b[2] * c];
    t = t2;
  }
  return { o, t, b, n };
}

function onSurface(fn: DistFn, f: Frame, u: number, v: number, height: number): V3 {
  const p = projectToSurface(fn, [f.o[0] + f.t[0] * u + f.b[0] * v, f.o[1] + f.t[1] * u + f.b[1] * v, f.o[2] + f.t[2] * u + f.b[2] * v], EPS, 6);
  const n = unitNormal(fn, p[0], p[1], p[2], EPS);
  return [p[0] + n[0] * height, p[1] + n[1] * height, p[2] + n[2] * height];
}

const LOD_LIFT = [1, 2.2, 4.5];
/**
 * Coarser LODs need extra clearance above the simplified surface. Small lifts scale as before
 * (base × LOD_LIFT); for deliberately raised details (eye highlights) only the first 0.06 cm is
 * scaled, otherwise they would fly off the eye as spikes at LOD1/LOD2.
 */
function lodLift(base: number, lod: number): number {
  return base + Math.min(base, 0.06) * (LOD_LIFT[lod]! - 1);
}

function addDisc(pb: PatchBuilder, fn: DistFn, soft: (p: V3) => number, d: DiscPatch, lod: number, mirrored: boolean): void {
  const at: V3 = mirrored ? [-d.at[0], d.at[1], d.at[2]] : d.at;
  const frame = surfaceFrame(fn, at, mirrored ? -(d.rot ?? 0) : (d.rot ?? 0));
  const rx = d.rx, ry = d.ry ?? d.rx;
  const rings = [5, 3, 2][lod]!;
  const segs = [22, 12, 8][lod]!;
  const lift = lodLift(d.lift ?? 0.04, lod);
  const dome = (d.dome ?? 0) * Math.min(rx, ry);
  const color = hexToLinear(d.color);
  const softness = soft(frame.o);
  const centre = pb.vertex(onSurface(fn, frame, 0, 0, lift + dome), color, d.surface, softness);
  let prev: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    // The outermost ring dips to the surface so the patch reads as stitched down.
    const h = lift * (r === rings ? 0.35 : 1) + dome * Math.sqrt(Math.max(0, 1 - rho * rho));
    const ring: number[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      ring.push(pb.vertex(onSurface(fn, frame, Math.cos(a) * rx * rho, Math.sin(a) * ry * rho, h), color, d.surface, softness));
    }
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (r === 1) pb.tri(centre, ring[s]!, ring[s1]!);
      else {
        pb.tri(prev[s]!, ring[s]!, ring[s1]!);
        pb.tri(prev[s]!, ring[s1]!, prev[s1]!);
      }
    }
    prev = ring;
  }
}

function addPoly(pb: PatchBuilder, fn: DistFn, soft: (p: V3) => number, d: PolyPatch, lod: number, mirrored: boolean): void {
  const at: V3 = mirrored ? [-d.at[0], d.at[1], d.at[2]] : d.at;
  const frame = surfaceFrame(fn, at, mirrored ? -(d.rot ?? 0) : (d.rot ?? 0));
  const scale = d.scale ?? 1;
  // Resample the outline so long edges follow the curved surface.
  const sub = [3, 2, 1][lod]!;
  const outline: [number, number][] = [];
  for (let i = 0; i < d.outline.length; i++) {
    const a = d.outline[i]!, b = d.outline[(i + 1) % d.outline.length]!;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      outline.push([(a[0] + (b[0] - a[0]) * t) * scale * (mirrored ? -1 : 1), (a[1] + (b[1] - a[1]) * t) * scale]);
    }
  }
  // Triangles are wound for counter-clockwise outlines: accept either winding (mirroring flips it too).
  let signedArea = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    signedArea += a[0] * b[1] - b[0] * a[1];
  }
  if (signedArea < 0) outline.reverse();
  const rings = [3, 2, 1][lod]!;
  const lift = lodLift(d.lift ?? 0.04, lod);
  let extent = 0;
  for (const [u, v] of outline) extent = Math.max(extent, Math.hypot(u, v));
  const dome = (d.dome ?? 0) * extent;
  const color = hexToLinear(d.color);
  const softness = soft(frame.o);
  const centre = pb.vertex(onSurface(fn, frame, 0, 0, lift + dome), color, d.surface, softness);
  let prev: number[] = [];
  const n = outline.length;
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    const h = lift * (r === rings ? 0.35 : 1) + dome * Math.sqrt(Math.max(0, 1 - rho * rho));
    const ring: number[] = [];
    for (let s = 0; s < n; s++) ring.push(pb.vertex(onSurface(fn, frame, outline[s]![0] * rho, outline[s]![1] * rho, h), color, d.surface, softness));
    for (let s = 0; s < n; s++) {
      const s1 = (s + 1) % n;
      if (r === 1) pb.tri(centre, ring[s]!, ring[s1]!);
      else {
        pb.tri(prev[s]!, ring[s]!, ring[s1]!);
        pb.tri(prev[s]!, ring[s1]!, prev[s1]!);
      }
    }
    prev = ring;
  }
}

function catmull(points: V3[], closed: boolean, perSpan: number): V3[] {
  const out: V3[] = [];
  const n = points.length;
  const get = (i: number) => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let k = 0; k < perSpan; k++) {
      const t = k / perSpan, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a]! + (-p0[a]! + p2[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t2 + (-p0[a]! + 3 * p1[a]! - 3 * p2[a]! + p3[a]!) * t3)) as V3);
    }
  }
  if (!closed) out.push(points[n - 1]!);
  return out;
}

function addStroke(pb: PatchBuilder, fn: DistFn, soft: (p: V3) => number, d: StrokePatch, lod: number, mirrored: boolean): void {
  const src = mirrored ? d.points.map((p) => [-p[0], p[1], p[2]] as V3) : d.points;
  const closed = d.closed ?? false;
  const line = catmull(src, closed, [5, 3, 2][lod]!).map((p) => projectToSurface(fn, p, EPS, 8));
  const count = line.length;
  const lift = lodLift(d.lift ?? 0.035, lod);
  const color = hexToLinear(d.color);
  const across = lod === 0 ? 5 : 3;
  let prev: number[] = [];
  let first: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = line[i]!;
    const a = line[closed ? (i - 1 + count) % count : Math.max(0, i - 1)]!;
    const b = line[closed ? (i + 1) % count : Math.min(count - 1, i + 1)]!;
    const n = unitNormal(fn, p[0], p[1], p[2], EPS);
    const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const side = norm(cross(n, t));
    const u = count > 1 ? i / (count - 1) : 0;
    const taper = d.taper && !closed ? 0.42 + 0.58 * Math.pow(Math.sin(Math.PI * u), 0.5) : 1;
    const half = (d.width / 2) * taper;
    const softness = soft(p);
    const row: number[] = [];
    for (let k = 0; k < across; k++) {
      const s = (k / (across - 1)) * 2 - 1; // -1..1 across the thread
      const h = lift * 0.35 + (lift * 0.65 + half * 0.45) * Math.sqrt(Math.max(0, 1 - s * s));
      row.push(
        pb.vertex([p[0] + side[0] * half * s + n[0] * h, p[1] + side[1] * half * s + n[1] * h, p[2] + side[2] * half * s + n[2] * h], color, d.surface, softness),
      );
    }
    if (i === 0) first = row;
    else {
      for (let k = 0; k < across - 1; k++) {
        pb.tri(prev[k]!, row[k]!, row[k + 1]!);
        pb.tri(prev[k]!, row[k + 1]!, prev[k + 1]!);
      }
    }
    prev = row;
  }
  if (closed && count > 2) {
    for (let k = 0; k < across - 1; k++) {
      pb.tri(prev[k]!, first[k]!, first[k + 1]!);
      pb.tri(prev[k]!, first[k + 1]!, prev[k + 1]!);
    }
  }
}

function addTag(pb: PatchBuilder, fn: DistFn, soft: (p: V3) => number, d: TagPatch): void {
  const o = projectToSurface(fn, d.at, EPS, 10);
  const n = unitNormal(fn, o[0], o[1], o[2], EPS);
  const out = norm(d.out);
  const side = norm(cross(n, out));
  const w = (d.width ?? 1.1) / 2;
  const len = d.length ?? 1.9;
  const white = hexToLinear(d.color);
  const accent = hexToLinear(d.accent);
  const softness = Math.max(0.6, soft(o));
  const rows = 4;
  const front: number[][] = [];
  const back: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    // The tag leaves the seam and droops a little.
    const cx = o[0] + out[0] * len * t - n[0] * 0.1, cy = o[1] + out[1] * len * t - 0.5 * t * t - n[1] * 0.1, cz = o[2] + out[2] * len * t - n[2] * 0.1;
    const colour = t > 0.62 ? accent : white;
    const mk = (sign: number, off: number) =>
      pb.vertex([cx + side[0] * w * sign + n[0] * off, cy + side[1] * w * sign + n[1] * off, cz + side[2] * w * sign + n[2] * off], colour, 'satin', softness);
    front.push([mk(-1, 0.03), mk(1, 0.03)]);
    back.push([mk(-1, -0.03), mk(1, -0.03)]);
  }
  for (let r = 0; r < rows; r++) {
    pb.tri(front[r]![0]!, front[r]![1]!, front[r + 1]![1]!);
    pb.tri(front[r]![0]!, front[r + 1]![1]!, front[r + 1]![0]!);
    pb.tri(back[r]![0]!, back[r + 1]![1]!, back[r]![1]!);
    pb.tri(back[r]![0]!, back[r + 1]![0]!, back[r + 1]![1]!);
  }
}

function buildPatches(design: PlushDesign, fields: Map<string, LayerField>, lod: number): Mesh | null {
  const patches = design.patches ?? [];
  if (patches.length === 0) return null;
  const pb = new PatchBuilder();
  for (const patch of patches) {
    const layerName = patch.kind === 'tag' ? 'body' : (patch.layer ?? 'body');
    const field = fields.get(layerName) ?? fields.values().next().value!;
    const soft = (p: V3) => Math.min(1, softnessAt(field, p[0], p[1], p[2]));
    if (patch.kind === 'tag') {
      if (lod < 2) addTag(pb, field.fn, soft, patch);
      continue;
    }
    const sides = patch.mirror ? [false, true] : [false];
    for (const mirrored of sides) {
      if (patch.kind === 'disc') addDisc(pb, field.fn, soft, patch, lod, mirrored);
      else if (patch.kind === 'poly') addPoly(pb, field.fn, soft, patch, lod, mirrored);
      else addStroke(pb, field.fn, soft, patch, lod, mirrored);
    }
  }
  return pb.toMesh();
}

/** Shortens the fur around sewn-on features so embroidery is not buried under shell fur. */
function trimFurNearPatches(body: Mesh, patches: Mesh): void {
  const cell = 0.5;
  const grid = new Map<string, number[]>();
  for (let v = 0; v < patches.count; v++) {
    const key = `${Math.floor(patches.position[v * 3]! / cell)},${Math.floor(patches.position[v * 3 + 1]! / cell)},${Math.floor(patches.position[v * 3 + 2]! / cell)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(v);
  }
  for (let v = 0; v < body.count; v++) {
    if (body.surf[v * 4 + 3]! <= 0) continue;
    const x = body.position[v * 3]!, y = body.position[v * 3 + 1]!, z = body.position[v * 3 + 2]!;
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
    let best = Infinity;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const list = grid.get(`${ix + a},${iy + b},${iz + c}`);
          if (!list) continue;
          for (const p of list) {
            const d = Math.hypot(patches.position[p * 3]! - x, patches.position[p * 3 + 1]! - y, patches.position[p * 3 + 2]! - z);
            if (d < best) best = d;
          }
        }
    if (best < 0.5) body.surf[v * 4 + 3] = body.surf[v * 4 + 3]! * sstep(0.08, 0.5, best);
  }
}

/* ----------------------------------------------------------------- proxies */

function fibonacci(n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963229728653;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    out.push(norm([Math.cos(a) * 0.5, -0.86, Math.sin(a) * 0.5]));
  }
  return out;
}

function buildProxies(layers: { field: LayerField; mesh: Mesh; dominant: Int16Array }[], scale: number): { proxies: ProxyShape[]; footprint: number; comHeight: number } {
  interface Group {
    role: 'core' | 'appendage';
    points: number[];
  }
  const groups = new Map<string, Group>();
  for (const { field, mesh, dominant } of layers) {
    const collidable = field.add.map((p, i) => ({ p, i })).filter((e) => e.p.collide !== 'none');
    if (collidable.length === 0) continue;
    for (let v = 0; v < mesh.count; v++) {
      let part = field.add[dominant[v]!]!;
      if (part.collide === 'none') {
        // Assign decorative parts' vertices to the nearest solid part.
        const x = mesh.position[v * 3]!, y = mesh.position[v * 3 + 1]!, z = mesh.position[v * 3 + 2]!;
        let best = Infinity;
        for (const e of collidable) {
          const d = e.p.fn(x, y, z);
          if (d < best) {
            best = d;
            part = e.p;
          }
        }
        if (best > 1.2) continue; // sticks out too far: not part of the solid shape
      }
      let g = groups.get(part.group);
      if (!g) groups.set(part.group, (g = { role: part.collide as 'core' | 'appendage', points: [] }));
      if (part.collide === 'core') g.role = 'core';
      g.points.push(mesh.position[v * 3]!, mesh.position[v * 3 + 1]!, mesh.position[v * 3 + 2]!);
    }
  }

  const dirs = fibonacci(40);
  interface Candidate {
    name: string;
    role: 'core' | 'appendage';
    hull: number[];
    centroid: V3;
    volume: number;
    maxDim: number;
  }
  const candidates: Candidate[] = [];
  let footprint = 0;
  for (const [name, g] of groups) {
    const n = g.points.length / 3;
    if (n < 12) continue;
    let cx = 0, cy = 0, cz = 0;
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = g.points[i * 3]!, y = g.points[i * 3 + 1]!, z = g.points[i * 3 + 2]!;
      cx += x;
      cy += y;
      cz += z;
      lo[0] = Math.min(lo[0], x);
      lo[1] = Math.min(lo[1], y);
      lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x);
      hi[1] = Math.max(hi[1], y);
      hi[2] = Math.max(hi[2], z);
      if (g.role === 'core' && y < 3.5) footprint = Math.max(footprint, Math.hypot(x, z));
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const seen = new Set<number>();
    const hull: number[] = [];
    // The proxy sits a little inside the visible surface: the fur gives before the body does.
    const inset = g.role === 'core' ? 0.94 : 0.9;
    for (const d of dirs) {
      let best = -Infinity;
      let bi = 0;
      for (let i = 0; i < n; i++) {
        const s = g.points[i * 3]! * d[0] + g.points[i * 3 + 1]! * d[1] + g.points[i * 3 + 2]! * d[2];
        if (s > best) {
          best = s;
          bi = i;
        }
      }
      if (seen.has(bi)) continue;
      seen.add(bi);
      const x = cx + (g.points[bi * 3]! - cx) * inset;
      const y = Math.max(0, cy + (g.points[bi * 3 + 1]! - cy) * inset);
      const z = cz + (g.points[bi * 3 + 2]! - cz) * inset;
      hull.push(x, y, z);
    }
    // Flat sitting base: the lowest centimetre of a stuffed toy spreads out on the floor, so its
    // outline is added as a ring of floor-level points. Without it the lowest hull point is a single
    // vertex and the toy rocks / leans a few degrees at rest.
    for (let a = 0; a < 12; a++) {
      const ax = Math.cos((a / 12) * Math.PI * 2);
      const az = Math.sin((a / 12) * Math.PI * 2);
      let best = -Infinity;
      let bi = -1;
      for (let i = 0; i < n; i++) {
        if (g.points[i * 3 + 1]! > 1.0) continue;
        const s = (g.points[i * 3]! - cx) * ax + (g.points[i * 3 + 2]! - cz) * az;
        if (s > best) {
          best = s;
          bi = i;
        }
      }
      if (bi >= 0) hull.push(cx + (g.points[bi * 3]! - cx) * inset, 0, cz + (g.points[bi * 3 + 2]! - cz) * inset);
    }
    if (hull.length < 12) continue;
    const dims: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    candidates.push({ name, role: g.role, hull, centroid: [cx, cy, cz], volume: dims[0] * dims[1] * dims[2] * 0.52, maxDim: Math.max(...dims) });
  }
  const cores = candidates.filter((c) => c.role === 'core');
  const extras = candidates
    .filter((c) => c.role === 'appendage' && c.maxDim >= 3)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, Math.max(0, 9 - cores.length));
  const chosen = [...cores, ...extras];
  if (cores.length === 0) throw new Error('design has no core collision part');
  let total = 0;
  const weights = chosen.map((c) => {
    // Bean filling: the bottom of the body is heavier so the toy sits upright.
    const w = c.volume * (c.role === 'core' ? 1 : 0.55) * (c.centroid[1] < 9 ? 1.5 : 1);
    total += w;
    return w;
  });
  let comHeight = 0;
  const k = scale;
  const proxies: ProxyShape[] = chosen.map((c, i) => {
    comHeight += (weights[i]! / total) * c.centroid[1] * k;
    return {
      part: c.name,
      role: c.role,
      geometry: { type: 'hull', points: c.hull.map((v) => Number((v * k).toFixed(5))) },
      pos: [0, 0, 0],
      rot: [0, 0, 0, 1],
      massFraction: Number((weights[i]! / total).toFixed(4)),
    };
  });
  return { proxies, footprint: footprint * k, comHeight };
}

/* -------------------------------------------------------------- the build */

const LOD_TRIANGLES = [15000, 5200, 1700];

export async function buildAsset(design: PlushDesign): Promise<BuiltAsset> {
  await MeshoptSimplifier.ready;
  const fields = new Map<string, LayerField>();
  for (const layer of design.layers) fields.set(layer.name, layerField(layer));
  const all = [...fields.values()];
  const unionFn: DistFn = (x, y, z) => {
    let d = Infinity;
    for (const f of all) {
      const v = f.fn(x, y, z);
      if (v < d) d = v;
    }
    return d;
  };

  // High resolution meshes of every layer.
  const built = all.map((field) => {
    const cell = 0.27 / (field.layer.detail ?? 1);
    return { field, ...buildLayerMesh(field, design, unionFn, cell) };
  });
  const patchMeshes = [0, 1, 2].map((lod) => buildPatches(design, fields, lod));
  if (patchMeshes[0]) for (const b of built) trimFurNearPatches(b.mesh, patchMeshes[0]);

  const hiTris = built.map((b) => b.mesh.indices.length / 3);
  const budgetWeights = built.map((b, i) => b.field.layer.budget ?? hiTris[i]!);
  const budgetTotal = budgetWeights.reduce((a, b) => a + b, 0);

  // Bounding box of the union → uniform scale so the toy has the designed height.
  let minY = Infinity, maxY = -Infinity, maxX = 0, minZ = Infinity, maxZ = -Infinity;
  for (const b of built) {
    for (let v = 0; v < b.mesh.count; v++) {
      const x = Math.abs(b.mesh.position[v * 3]!), y = b.mesh.position[v * 3 + 1]!, z = b.mesh.position[v * 3 + 2]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const unitHeight = maxY - Math.min(0, minY);
  const scale = (design.height / unitHeight) * 0.01; // model cm → metres

  const lods: Mesh[] = [];
  for (let lod = 0; lod < 3; lod++) {
    const patch = patchMeshes[lod];
    const patchTris = patch ? patch.indices.length / 3 : 0;
    const budget = Math.max(600, LOD_TRIANGLES[lod]! - patchTris);
    const parts: Mesh[] = built.map((b, i) => simplify(b.mesh, (budget * budgetWeights[i]!) / budgetTotal));
    if (patch) parts.push(patch);
    const merged = merge(parts);
    for (let i = 0; i < merged.position.length; i++) merged.position[i] = merged.position[i]! * scale;
    lods.push(merged);
  }

  const { proxies, footprint, comHeight } = buildProxies(built, scale);

  // Paint regions: colour + a local frame for the stitches around the border.
  const paint: PaintRegion[] = [];
  for (const p of design.paints ?? []) {
    const b = built.find((e) => e.field.layer.name === (p.layer ?? 'body'));
    if (!b) continue;
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, n = 0;
    const border: number[] = [];
    for (let v = 0; v < b.mesh.count; v++) {
      const mv = b.mesh.mask[v * 4 + p.channel]!;
      if (Math.abs(mv) < 0.12) border.push(v);
      if (mv >= 0) continue;
      cx += b.mesh.position[v * 3]!;
      cy += b.mesh.position[v * 3 + 1]!;
      cz += b.mesh.position[v * 3 + 2]!;
      nx += b.mesh.normal[v * 3]!;
      ny += b.mesh.normal[v * 3 + 1]!;
      nz += b.mesh.normal[v * 3 + 2]!;
      n++;
    }
    if (n === 0) {
      console.warn(`  ! paint "${p.name}" of ${design.slug} does not touch layer "${p.layer ?? 'body'}"`);
      continue;
    }
    const normal = norm([nx, ny, nz]);
    let u = cross([0, 1, 0], normal);
    if (Math.hypot(u[0], u[1], u[2]) < 0.2) u = cross(normal, [0, 0, 1]);
    u = norm(u);
    const v = norm(cross(normal, u));
    const stitchColor = typeof p.stitch === 'string' ? p.stitch : darken(p.color, 0.22);
    // Stitch count from the approximate perimeter (one stitch + gap every ~5 mm of real size).
    let meanRadius = 0;
    for (const bv of border) meanRadius += Math.hypot(b.mesh.position[bv * 3]! - cx / n, b.mesh.position[bv * 3 + 1]! - cy / n, b.mesh.position[bv * 3 + 2]! - cz / n);
    meanRadius = border.length > 0 ? meanRadius / border.length : 2;
    const stitches = Math.max(10, Math.round((2 * Math.PI * meanRadius * scale) / 0.005));
    paint.push({
      name: p.name,
      channel: p.channel,
      color: p.color,
      stitch: !!p.stitch,
      stitchColor,
      stitches,
      center: [(cx / n) * scale, (cy / n) * scale, (cz / n) * scale].map((x) => Number(x.toFixed(5))) as Vec3,
      axisU: u.map((x) => Number(x.toFixed(4))) as Vec3,
      axisV: v.map((x) => Number(x.toFixed(4))) as Vec3,
    });
  }

  // Palette: the colours that cover the most surface.
  const tally = new Map<string, number>();
  for (const b of built) {
    for (let v = 0; v < b.mesh.count; v += 7) {
      const part = b.field.add[b.dominant[v]!]!;
      tally.set(part.color, (tally.get(part.color) ?? 0) + 1);
    }
  }
  for (const p of design.paints ?? []) tally.set(p.color, (tally.get(p.color) ?? 0) + 40);
  const palette = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
  const materials = [...new Set([...design.layers.map((l) => l.surface as string), ...(design.patches ?? []).map((p) => (p.kind === 'tag' ? 'satin' : p.surface))])];
  const softParts = design.layers.flatMap((l) => l.parts.filter((p) => p.soft >= 0.4).map((p) => p.name));

  return {
    lods,
    metresPerUnit: scale,
    size: [maxX * 2 * scale, unitHeight * scale, (maxZ - minZ) * scale].map((v) => Number(v.toFixed(4))) as Vec3,
    footprint: Number(Math.max(footprint, 0.04).toFixed(4)),
    comHeight: Number(comHeight.toFixed(4)),
    proxies,
    paint,
    palette,
    materials,
    deform: {
      softAttribute: '_AUX.x',
      dentRadius: Number(((design.deform?.dentRadius ?? 3) * scale).toFixed(4)),
      sag: design.deform?.sag ?? 0.5,
      squash: design.deform?.squash ?? 0.5,
      sway: design.deform?.sway ?? 0.5,
      softParts,
    },
    maskRange: Number((MASK_RANGE_CM * scale).toFixed(5)),
  };
}
