/**
 * Building blocks of `npm run assets:import` (tools/plush/import-generated.ts): turns a raw
 * textured model (one mesh, POSITION / NORMAL / TEXCOORD_0, PBR textures — e.g. from an
 * image-to-3D generator) into the game's textured plush format:
 *
 *   1. read + flatten + weld/clean                     readRawModel, cleanMesh
 *   2. fit to the character (yaw, uniform scale, base)  fitToReference, transformMesh
 *   3. per-vertex softness / fur / sheen / AO            transferAttributes
 *   4. compare with the collision proxies                measureOutside, proxyGaps
 *   5. LODs with seam-preserving simplification          buildLods
 *   6. texture variants (WebP)                           textureVariants
 *   7. GLB with EXT_texture_webp + meshopt               writeTexturedGlb
 *
 * Everything here is deterministic (seeded sampling), so re-running the import on the same raw
 * file writes the same output.
 */
import { Document, NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { Vec3 } from '../../src/core/types';
import type { ProxyShape, TextureTier } from '../../src/plush/manifest';

/* ------------------------------------------------------------------ types */

export interface TexMesh {
  count: number;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** softness, fur length, sheen, ambient occlusion (0..1 each). Filled by `transferAttributes`. */
  aux: Float32Array;
  indices: Uint32Array;
}

export interface RawTextures {
  baseColor: Uint8Array | null;
  normal: Uint8Array | null;
  /** glTF metallic-roughness texture (G = roughness, B = metalness). */
  metallicRoughness: Uint8Array | null;
}

export interface RawModel {
  mesh: TexMesh;
  textures: RawTextures;
  /** Number of primitives merged and other facts for the report. */
  info: { primitives: number; triangles: number; vertices: number; materials: number };
}

/** Per-vertex data of the procedural model, used as the reference shape and attribute source. */
export interface ReferenceMesh {
  position: Float32Array;
  indices: Uint32Array;
  softness: Float32Array;
  fur: Float32Array;
  sheen: Float32Array;
  ao: Float32Array;
}

/* -------------------------------------------------------------- utilities */

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function bounds(position: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = position[i + c]!;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
  }
  return { min, max };
}

/** Static k-d tree over a point set (k-nearest queries). */
export class PointIndex {
  private readonly order: Uint32Array;
  private readonly axis: Uint8Array;
  private readonly heapIdx: Int32Array;
  private readonly heapD: Float64Array;
  private k = 1;
  private found = 0;
  private qx = 0;
  private qy = 0;
  private qz = 0;

  constructor(readonly points: Float32Array, maxK = 8) {
    const n = points.length / 3;
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.axis = new Uint8Array(n);
    this.heapIdx = new Int32Array(maxK);
    this.heapD = new Float64Array(maxK);
    this.build(0, n);
  }

  private build(lo: number, hi: number): void {
    // Iterative over the larger half would save stack; depth is only ~log2(n) here.
    if (hi - lo <= 1) return;
    const p = this.points;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = lo; i < hi; i++) {
      const o = this.order[i]! * 3;
      const x = p[o]!, y = p[o + 1]!, z = p[o + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (lo + hi) >> 1;
    this.select(lo, hi - 1, mid, axis);
    this.axis[mid] = axis;
    this.build(lo, mid);
    this.build(mid + 1, hi);
  }

  /** Quickselect: order[k] gets the k-th smallest coordinate of [left, right]. */
  private select(left: number, right: number, k: number, axis: number): void {
    const o = this.order;
    const p = this.points;
    while (right > left) {
      const pivot = p[o[(left + right) >> 1]! * 3 + axis]!;
      let i = left, j = right;
      while (i <= j) {
        while (p[o[i]! * 3 + axis]! < pivot) i++;
        while (p[o[j]! * 3 + axis]! > pivot) j--;
        if (i <= j) {
          const t = o[i]!;
          o[i] = o[j]!;
          o[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) right = j;
      else if (k >= i) left = i;
      else return;
    }
  }

  /**
   * Finds up to `k` nearest points. Results are written to `outIdx` / `outD2` sorted by distance;
   * returns the number found.
   */
  nearest(x: number, y: number, z: number, k: number, outIdx: Int32Array | number[], outD2: Float64Array | number[]): number {
    this.k = Math.min(k, this.heapIdx.length);
    this.found = 0;
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.search(0, this.order.length);
    for (let i = 0; i < this.found; i++) {
      outIdx[i] = this.heapIdx[i]!;
      outD2[i] = this.heapD[i]!;
    }
    return this.found;
  }

  private search(lo: number, hi: number): void {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    const id = this.order[mid]!;
    const p = this.points;
    const dx = this.qx - p[id * 3]!, dy = this.qy - p[id * 3 + 1]!, dz = this.qz - p[id * 3 + 2]!;
    this.offer(id, dx * dx + dy * dy + dz * dz);
    const axis = this.axis[mid]!;
    const diff = axis === 0 ? dx : axis === 1 ? dy : dz;
    if (diff < 0) {
      this.search(lo, mid);
      if (this.found < this.k || diff * diff < this.heapD[this.found - 1]!) this.search(mid + 1, hi);
    } else {
      this.search(mid + 1, hi);
      if (this.found < this.k || diff * diff < this.heapD[this.found - 1]!) this.search(lo, mid);
    }
  }

  /** Sorted insertion into the small result list. */
  private offer(id: number, d2: number): void {
    if (this.found === this.k && d2 >= this.heapD[this.found - 1]!) return;
    let i = this.found < this.k ? this.found++ : this.found - 1;
    while (i > 0 && this.heapD[i - 1]! > d2) {
      this.heapD[i] = this.heapD[i - 1]!;
      this.heapIdx[i] = this.heapIdx[i - 1]!;
      i--;
    }
    this.heapD[i] = d2;
    this.heapIdx[i] = id;
  }
}

/** Area-weighted random points on a triangle mesh (deterministic for a given seed). */
export function samplePoints(position: Float32Array, indices: Uint32Array, count: number, seed = 1): Float32Array {
  const tris = indices.length / 3;
  const cdf = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    total += triangleArea(position, indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!);
    cdf[t] = total;
  }
  const out = new Float32Array(count * 3);
  const random = rng(seed);
  for (let s = 0; s < count; s++) {
    const r = random() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m]! < r) lo = m + 1;
      else hi = m;
    }
    let u = random(), v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const a = indices[lo * 3]! * 3, b = indices[lo * 3 + 1]! * 3, c = indices[lo * 3 + 2]! * 3;
    for (let k = 0; k < 3; k++) out[s * 3 + k] = position[a + k]! + (position[b + k]! - position[a + k]!) * u + (position[c + k]! - position[a + k]!) * v;
  }
  return out;
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
  const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
  const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/* ------------------------------------------------------------ 1. reading */

function io(): NodeIO {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

function readAttribute(prim: Primitive, semantic: string, size: number, count: number): Float32Array | null {
  const accessor = prim.getAttribute(semantic);
  if (!accessor) return null;
  const out = new Float32Array(count * size);
  const el: number[] = [];
  for (let i = 0; i < count; i++) {
    accessor.getElement(i, el);
    for (let c = 0; c < size; c++) out[i * size + c] = el[c] ?? 0;
  }
  return out;
}

/**
 * Reads a raw generated model: every triangle primitive of the default scene, with node
 * transforms applied, merged into one mesh. All primitives must share one material (the game
 * draws a textured toy with one material).
 */
export async function readRawModel(data: Uint8Array): Promise<RawModel> {
  await MeshoptDecoder.ready;
  const doc = await io().readBinary(data);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const parts: { position: Float32Array; normal: Float32Array | null; uv: Float32Array | null; indices: Uint32Array }[] = [];
  const materials = new Set<unknown>();
  let primitives = 0;
  const textures: RawTextures = { baseColor: null, normal: null, metallicRoughness: null };
  const visit = (node: ReturnType<typeof root.listNodes>[number]) => {
    const mesh = node.getMesh();
    if (mesh) {
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // TRIANGLES only
        const posAcc = prim.getAttribute('POSITION');
        if (!posAcc) continue;
        primitives++;
        const count = posAcc.getCount();
        const position = readAttribute(prim, 'POSITION', 3, count)!;
        const normal = readAttribute(prim, 'NORMAL', 3, count);
        const uv = readAttribute(prim, 'TEXCOORD_0', 2, count);
        for (let i = 0; i < count; i++) {
          const x = position[i * 3]!, y = position[i * 3 + 1]!, z = position[i * 3 + 2]!;
          position[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          position[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          position[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (normal) {
            // Uniform-scale / rotation transforms only (generators export unscaled nodes); renormalised below.
            const nx = normal[i * 3]!, ny = normal[i * 3 + 1]!, nz = normal[i * 3 + 2]!;
            const tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz;
            const len = Math.hypot(tx, ty, tz) || 1;
            normal[i * 3] = tx / len;
            normal[i * 3 + 1] = ty / len;
            normal[i * 3 + 2] = tz / len;
          }
        }
        const idxAcc = prim.getIndices();
        const indices = new Uint32Array(idxAcc ? idxAcc.getCount() : count);
        if (idxAcc) for (let i = 0; i < indices.length; i++) indices[i] = idxAcc.getScalar(i);
        else for (let i = 0; i < count; i++) indices[i] = i;
        parts.push({ position, normal, uv, indices });
        const material = prim.getMaterial();
        materials.add(material);
        if (material && !textures.baseColor) {
          textures.baseColor = material.getBaseColorTexture()?.getImage() ?? null;
          textures.normal = material.getNormalTexture()?.getImage() ?? null;
          textures.metallicRoughness = material.getMetallicRoughnessTexture()?.getImage() ?? null;
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const node of scene ? scene.listChildren() : root.listNodes()) visit(node);
  if (parts.length === 0) throw new Error('the file contains no triangle mesh');
  if (materials.size > 1) throw new Error(`the model uses ${materials.size} materials; only single-material models can be imported`);
  if (parts.some((p) => !p.uv)) throw new Error('the model has no TEXCOORD_0');

  const count = parts.reduce((n, p) => n + p.position.length / 3, 0);
  const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);
  const mesh: TexMesh = {
    count,
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    uv: new Float32Array(count * 2),
    aux: new Float32Array(count * 4),
    indices: new Uint32Array(indexCount),
  };
  let v = 0, t = 0;
  let missingNormals = false;
  for (const p of parts) {
    mesh.position.set(p.position, v * 3);
    if (p.normal) mesh.normal.set(p.normal, v * 3);
    else missingNormals = true;
    mesh.uv.set(p.uv!, v * 2);
    for (let i = 0; i < p.indices.length; i++) mesh.indices[t + i] = p.indices[i]! + v;
    v += p.position.length / 3;
    t += p.indices.length;
  }
  if (missingNormals) computeNormals(mesh);
  return { mesh, textures, info: { primitives, triangles: indexCount / 3, vertices: count, materials: materials.size } };
}

/** Area-weighted vertex normals over welded positions (used when the source has none). */
export function computeNormals(mesh: TexMesh): void {
  const remap = positionRemap(mesh.position);
  const acc = new Float64Array(mesh.count * 3);
  const p = mesh.position;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
    const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const r = remap[v]!;
      acc[r * 3] += nx;
      acc[r * 3 + 1] += ny;
      acc[r * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < mesh.count; v++) {
    const r = remap[v]!;
    const len = Math.hypot(acc[r * 3]!, acc[r * 3 + 1]!, acc[r * 3 + 2]!) || 1;
    mesh.normal[v * 3] = acc[r * 3]! / len;
    mesh.normal[v * 3 + 1] = acc[r * 3 + 1]! / len;
    mesh.normal[v * 3 + 2] = acc[r * 3 + 2]! / len;
  }
}

/** For each vertex, the first vertex with a bitwise identical position (seam wedges share it). */
export function positionRemap(position: Float32Array): Uint32Array {
  const n = position.length / 3;
  const remap = new Uint32Array(n);
  const seen = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const key = `${position[v * 3]},${position[v * 3 + 1]},${position[v * 3 + 2]}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, v);
      remap[v] = v;
    } else remap[v] = first;
  }
  return remap;
}

/**
 * Welds and cleans a mesh:
 *  - positions closer than `epsilon` (relative to the model size) snap to one value, so UV-seam
 *    wedges share a bitwise identical position (the simplifier then keeps seams intact);
 *  - fully identical vertices (position, normal, UV) are merged;
 *  - degenerate triangles (repeated vertex or zero area) and unreferenced vertices are dropped.
 */
export function cleanMesh(mesh: TexMesh, epsilon = 1e-6): { mesh: TexMesh; removedTriangles: number; mergedVertices: number } {
  const b = bounds(mesh.position);
  const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9);
  const cell = extent * epsilon;
  // 1. Snap near-identical positions together (grid hash; neighbours checked so values straddling a cell border still merge).
  const position = new Float32Array(mesh.position);
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let v = 0; v < mesh.count; v++) {
    const x = position[v * 3]!, y = position[v * 3 + 1]!, z = position[v * 3 + 2]!;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
    let target = -1;
    for (let dx = -1; dx <= 1 && target < 0; dx++) {
      for (let dy = -1; dy <= 1 && target < 0; dy++) {
        for (let dz = -1; dz <= 1 && target < 0; dz++) {
          const list = grid.get(keyOf(gx + dx, gy + dy, gz + dz));
          if (!list) continue;
          for (const o of list) {
            if (Math.abs(position[o * 3]! - x) <= cell && Math.abs(position[o * 3 + 1]! - y) <= cell && Math.abs(position[o * 3 + 2]! - z) <= cell) {
              target = o;
              break;
            }
          }
        }
      }
    }
    if (target >= 0) {
      position[v * 3] = position[target * 3]!;
      position[v * 3 + 1] = position[target * 3 + 1]!;
      position[v * 3 + 2] = position[target * 3 + 2]!;
    } else {
      const key = keyOf(gx, gy, gz);
      const list = grid.get(key);
      if (list) list.push(v);
      else grid.set(key, [v]);
    }
  }
  // 2. Merge identical vertices.
  const remap = new Uint32Array(mesh.count);
  const unique = new Map<string, number>();
  let mergedVertices = 0;
  for (let v = 0; v < mesh.count; v++) {
    const key = `${position[v * 3]},${position[v * 3 + 1]},${position[v * 3 + 2]}|${mesh.normal[v * 3]!.toFixed(4)},${mesh.normal[v * 3 + 1]!.toFixed(4)},${mesh.normal[v * 3 + 2]!.toFixed(4)}|${mesh.uv[v * 2]!.toFixed(6)},${mesh.uv[v * 2 + 1]!.toFixed(6)}`;
    const first = unique.get(key);
    if (first === undefined) {
      unique.set(key, v);
      remap[v] = v;
    } else {
      remap[v] = first;
      mergedVertices++;
    }
  }
  // 3. Drop degenerate triangles.
  const kept: number[] = [];
  let removedTriangles = 0;
  const areaEps = (extent * 1e-7) ** 2;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!, b2 = remap[mesh.indices[t + 1]!]!, c = remap[mesh.indices[t + 2]!]!;
    const pa = positionRemapKey(position, a), pb = positionRemapKey(position, b2), pc = positionRemapKey(position, c);
    if (a === b2 || b2 === c || a === c || pa === pb || pb === pc || pa === pc || triangleArea(position, a, b2, c) <= areaEps) {
      removedTriangles++;
      continue;
    }
    kept.push(a, b2, c);
  }
  const cleaned = compact({ ...mesh, position }, Uint32Array.from(kept));
  return { mesh: cleaned, removedTriangles, mergedVertices };
}

const positionRemapKey = (p: Float32Array, v: number) => `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;

/** Keeps only referenced vertices (in first-use order). */
export function compact(mesh: TexMesh, indices: Uint32Array): TexMesh {
  const remap = new Int32Array(mesh.count).fill(-1);
  let next = 0;
  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]!;
    if (remap[v] === -1) remap[v] = next++;
    outIdx[i] = remap[v]!;
  }
  const out: TexMesh = {
    count: next,
    position: new Float32Array(next * 3),
    normal: new Float32Array(next * 3),
    uv: new Float32Array(next * 2),
    aux: new Float32Array(next * 4),
    indices: outIdx,
  };
  for (let v = 0; v < mesh.count; v++) {
    const n = remap[v]!;
    if (n < 0) continue;
    out.position.set(mesh.position.subarray(v * 3, v * 3 + 3), n * 3);
    out.normal.set(mesh.normal.subarray(v * 3, v * 3 + 3), n * 3);
    out.uv.set(mesh.uv.subarray(v * 2, v * 2 + 2), n * 2);
    out.aux.set(mesh.aux.subarray(v * 4, v * 4 + 4), n * 4);
  }
  return out;
}

/* -------------------------------------------------------------- 2. fitting */

export interface Fit {
  yawDeg: number;
  scale: number;
  /** Applied after rotation and scaling: x, y (base on 0), z. */
  offset: Vec3;
  /** Centre of the raw model's bounding box (removed before rotating). */
  rawCentre: Vec3;
  /** Chamfer score per candidate yaw (metres, height-normalised placement), for the report. */
  yawScores: Record<string, number>;
  /** Mean / 95th percentile surface distance to the reference after the fit, metres. */
  shapeMean: number;
  shapeP95: number;
}

/** Applies a fit to a point list (x, y, z triples), returning a new array. */
export function transformPoints(points: Float32Array, fit: Pick<Fit, 'yawDeg' | 'scale' | 'offset' | 'rawCentre'>): Float32Array {
  const out = new Float32Array(points.length);
  const a = (fit.yawDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]! - fit.rawCentre[0], y = points[i + 1]! - fit.rawCentre[1], z = points[i + 2]! - fit.rawCentre[2];
    out[i] = (cos * x + sin * z) * fit.scale + fit.offset[0];
    out[i + 1] = y * fit.scale + fit.offset[1];
    out[i + 2] = (-sin * x + cos * z) * fit.scale + fit.offset[2];
  }
  return out;
}

/** Applies a fit to a whole mesh (normals are rotated). */
export function transformMesh(mesh: TexMesh, fit: Pick<Fit, 'yawDeg' | 'scale' | 'offset' | 'rawCentre'>): TexMesh {
  const a = (fit.yawDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const normal = new Float32Array(mesh.normal.length);
  for (let i = 0; i < normal.length; i += 3) {
    const x = mesh.normal[i]!, z = mesh.normal[i + 2]!;
    normal[i] = cos * x + sin * z;
    normal[i + 1] = mesh.normal[i + 1]!;
    normal[i + 2] = -sin * x + cos * z;
  }
  return { ...mesh, position: transformPoints(mesh.position, fit), normal, uv: new Float32Array(mesh.uv), aux: new Float32Array(mesh.aux), indices: new Uint32Array(mesh.indices) };
}

/** Distances from every point of `a` to its nearest neighbour in `index`. */
function nearestDistances(a: Float32Array, index: PointIndex): Float64Array {
  const out = new Float64Array(a.length / 3);
  const id = [0], d2 = [0];
  for (let i = 0; i < out.length; i++) {
    index.nearest(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!, 1, id, d2);
    out[i] = Math.sqrt(d2[0]!);
  }
  return out;
}

function percentile(values: Float64Array | number[], q: number): number {
  const sorted = Float64Array.from(values).sort();
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Symmetric chamfer distance, trimmed at the 90th percentile in each direction (robust to small extra parts). */
function chamfer(a: Float32Array, aIndex: PointIndex, b: Float32Array, bIndex: PointIndex): number {
  const trimmedMean = (d: Float64Array) => {
    const cut = percentile(d, 0.9);
    let s = 0, n = 0;
    for (const v of d) if (v <= cut) {
      s += v;
      n++;
    }
    return n > 0 ? s / n : 0;
  };
  return 0.5 * (trimmedMean(nearestDistances(a, bIndex)) + trimmedMean(nearestDistances(b, aIndex)));
}

export interface FitOptions {
  /** Force a yaw instead of choosing one. */
  yawDeg?: number;
  /** Extra uniform scale factor applied after the automatic fit. */
  scaleBias?: number;
  /** How much better (ratio) another yaw must score than 0° to be chosen. Generators normally face +Z. */
  yawMargin?: number;
  samples?: number;
}

/**
 * Finds the yaw (multiples of 90°), uniform scale and placement that best align a raw model with
 * the procedural reference surface: the raw model starts scaled to the reference height, standing
 * on y = 0 and centred on the reference's footprint, then scale (±12 %) and the horizontal offset
 * are refined to minimise the surface distance. Never stretches non-uniformly.
 */
export function fitToReference(raw: TexMesh, reference: ReferenceMesh, options: FitOptions = {}): Fit {
  const samples = options.samples ?? 2500;
  const refPts = samplePoints(reference.position, reference.indices, samples, 7);
  const refIndex = new PointIndex(refPts, 1);
  const rb = bounds(reference.position);
  const refHeight = rb.max[1] - Math.min(0, rb.min[1]);
  const refCx = (rb.min[0] + rb.max[0]) / 2, refCz = (rb.min[2] + rb.max[2]) / 2;
  const b = bounds(raw.position);
  const rawCentre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const rawPts = samplePoints(raw.position, raw.indices, samples, 11);

  const place = (yawDeg: number, scale: number, ox: number, oz: number) => {
    const pts = transformPoints(rawPts, { yawDeg, scale, offset: [0, 0, 0], rawCentre });
    // Base on y = 0, centred on the reference's footprint plus the refinement offset.
    const pb = bounds(pts);
    const dx = refCx - (pb.min[0] + pb.max[0]) / 2 + ox, dy = -pb.min[1], dz = refCz - (pb.min[2] + pb.max[2]) / 2 + oz;
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] += dx;
      pts[i + 1] += dy;
      pts[i + 2] += dz;
    }
    return { pts, offset: [dx, dy, dz] as Vec3 };
  };

  const yawScores: Record<string, number> = {};
  const candidates = options.yawDeg !== undefined ? [options.yawDeg] : [0, 90, 180, 270];
  for (const yaw of candidates) {
    // Height after rotation does not depend on yaw.
    const s = refHeight / Math.max(1e-9, b.max[1] - b.min[1]);
    const { pts } = place(yaw, s, 0, 0);
    yawScores[String(yaw)] = chamfer(pts, new PointIndex(pts, 1), refPts, refIndex);
  }
  let yawDeg = candidates[0]!;
  if (options.yawDeg === undefined) {
    const margin = options.yawMargin ?? 0.75;
    const base = yawScores['0']!;
    let best = 0;
    for (const yaw of candidates) if (yawScores[String(yaw)]! < yawScores[String(best)]!) best = yaw;
    yawDeg = yawScores[String(best)]! < base * margin ? best : 0;
  }

  // Refine: scale on a grid, horizontal offset by a few closest-point (ICP translation) steps.
  const s0 = refHeight / Math.max(1e-9, b.max[1] - b.min[1]);
  let bestScore = Infinity, bestScale = s0, bestOx = 0, bestOz = 0;
  const id = [0], d2 = [0];
  for (let k = -6; k <= 6; k++) {
    const scale = s0 * (1 + k * 0.02);
    let ox = 0, oz = 0;
    let score = Infinity;
    for (let iter = 0; iter < 4; iter++) {
      const { pts } = place(yawDeg, scale, ox, oz);
      const idx = new PointIndex(pts, 1);
      score = chamfer(pts, idx, refPts, refIndex);
      // Mean residual of mutual closest points (x, z only: the base stays on the floor).
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pts.length; i += 3) {
        refIndex.nearest(pts[i]!, pts[i + 1]!, pts[i + 2]!, 1, id, d2);
        sx += refPts[id[0]! * 3]! - pts[i]!;
        sz += refPts[id[0]! * 3 + 2]! - pts[i + 2]!;
        n++;
      }
      for (let i = 0; i < refPts.length; i += 3) {
        idx.nearest(refPts[i]!, refPts[i + 1]!, refPts[i + 2]!, 1, id, d2);
        sx += refPts[i]! - pts[id[0]! * 3]!;
        sz += refPts[i + 2]! - pts[id[0]! * 3 + 2]!;
        n++;
      }
      const stepX = sx / n, stepZ = sz / n;
      if (Math.hypot(stepX, stepZ) < 1e-4) break;
      ox += stepX;
      oz += stepZ;
    }
    if (score < bestScore) {
      bestScore = score;
      bestScale = scale;
      bestOx = ox;
      bestOz = oz;
    }
  }
  const scale = bestScale * (options.scaleBias ?? 1);
  const { offset } = place(yawDeg, scale, bestOx, bestOz);
  // Final placement of the full mesh (the base of the full mesh may sit lower than the samples).
  const full = transformPoints(raw.position, { yawDeg, scale, offset, rawCentre });
  const fb = bounds(full);
  offset[1] -= fb.min[1];
  const fitted = transformPoints(rawPts, { yawDeg, scale, offset, rawCentre });
  const d = nearestDistances(fitted, refIndex);
  const back = nearestDistances(refPts, new PointIndex(fitted, 1));
  const all = Float64Array.from([...d, ...back]);
  const shapeMean = all.reduce((s, v) => s + v, 0) / all.length;
  return { yawDeg, scale, offset, rawCentre, yawScores, shapeMean, shapeP95: percentile(all, 0.95) };
}

/* ---------------------------------------------------- 4. collision proxies */

type DistanceFn = (x: number, y: number, z: number) => number;

/**
 * Distance outside the union of the collision proxies (≤ 0 inside). For convex hulls this is the
 * largest plane distance — exact over faces, a slight under-estimate near edges and corners.
 */
export function proxyDistance(proxies: readonly ProxyShape[]): DistanceFn {
  const fns: DistanceFn[] = proxies.map((proxy) => {
    const [px, py, pz] = proxy.pos;
    const [qx, qy, qz, qw] = proxy.rot;
    // Rotate a world point into the proxy frame with the inverse quaternion.
    const local = (x: number, y: number, z: number): Vec3 => {
      const vx = x - px, vy = y - py, vz = z - pz;
      const ix = -qx, iy = -qy, iz = -qz;
      const tx = 2 * (iy * vz - iz * vy), ty = 2 * (iz * vx - ix * vz), tz = 2 * (ix * vy - iy * vx);
      return [vx + qw * tx + (iy * tz - iz * ty), vy + qw * ty + (iz * tx - ix * tz), vz + qw * tz + (ix * ty - iy * tx)];
    };
    const g = proxy.geometry;
    if (g.type === 'ball') return (x, y, z) => Math.hypot(...local(x, y, z)) - g.r;
    if (g.type === 'capsule') {
      return (x, y, z) => {
        const [lx, ly, lz] = local(x, y, z);
        const cy = Math.max(-g.halfHeight, Math.min(g.halfHeight, ly));
        return Math.hypot(lx, ly - cy, lz) - g.r;
      };
    }
    if (g.type === 'cuboid') {
      return (x, y, z) => {
        const [lx, ly, lz] = local(x, y, z);
        const dx = Math.abs(lx) - g.hx, dy = Math.abs(ly) - g.hy, dz = Math.abs(lz) - g.hz;
        return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - g.round;
      };
    }
    const pts: Vector3[] = [];
    for (let i = 0; i < g.points.length; i += 3) pts.push(new Vector3(g.points[i], g.points[i + 1], g.points[i + 2]));
    const hull = new ConvexHull().setFromPoints(pts);
    const planes = hull.faces.map((f) => [f.normal.x, f.normal.y, f.normal.z, f.constant] as const);
    return (x, y, z) => {
      const [lx, ly, lz] = local(x, y, z);
      let d = -Infinity;
      for (const [nx, ny, nz, c] of planes) {
        const v = nx * lx + ny * ly + nz * lz - c;
        if (v > d) d = v;
      }
      return d;
    };
  });
  return (x, y, z) => {
    let d = Infinity;
    for (const fn of fns) {
      const v = fn(x, y, z);
      if (v < d) d = v;
    }
    return d;
  };
}

export interface OutsideStats {
  /** Area share of the surface lying more than `threshold` outside the proxies. */
  share: number;
  p95: number;
  max: number;
}

/** How far a surface sticks out of the collision proxies (area-weighted samples). */
export function measureOutside(position: Float32Array, indices: Uint32Array, proxies: readonly ProxyShape[], threshold = 0.01, samples = 6000): OutsideStats {
  const dist = proxyDistance(proxies);
  const pts = samplePoints(position, indices, samples, 3);
  const d = new Float64Array(samples);
  let outside = 0, max = 0;
  for (let i = 0; i < samples; i++) {
    const v = Math.max(0, dist(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!));
    d[i] = v;
    if (v > threshold) outside++;
    if (v > max) max = v;
  }
  return { share: outside / samples, p95: percentile(d, 0.95), max };
}

/** Generalised winding number (> 0.5 inside a closed surface). */
export function windingNumber(position: Float32Array, indices: Uint32Array, x: number, y: number, z: number): number {
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ax = position[a]! - x, ay = position[a + 1]! - y, az = position[a + 2]! - z;
    const bx = position[b]! - x, by = position[b + 1]! - y, bz = position[b + 2]! - z;
    const cx = position[c]! - x, cy = position[c + 1]! - y, cz = position[c + 2]! - z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const div = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (ax * cx + ay * cy + az * cz) * lb + (bx * cx + by * cy + bz * cz) * la;
    total += 2 * Math.atan2(det, div);
  }
  return total / (4 * Math.PI);
}

/**
 * Proxy points (hull vertices) that lie outside the visual surface: places where the toy would
 * collide with nothing visible. Returns the 95th percentile and maximum gap in metres.
 */
export function proxyGaps(position: Float32Array, indices: Uint32Array, proxies: readonly ProxyShape[]): { p95: number; max: number; points: number } {
  const surface = new PointIndex(samplePoints(position, indices, 20000, 5), 1);
  const gaps: number[] = [];
  const id = [0], d2 = [0];
  let points = 0;
  for (const proxy of proxies) {
    if (proxy.geometry.type !== 'hull') continue;
    const [px, py, pz] = proxy.pos;
    const [qx, qy, qz, qw] = proxy.rot;
    const p = proxy.geometry.points;
    // Every few points is enough for a statistic and keeps the winding-number cost down.
    for (let i = 0; i < p.length; i += 3 * 3) {
      const vx = p[i]!, vy = p[i + 1]!, vz = p[i + 2]!;
      const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
      const x = vx + qw * tx + (qy * tz - qz * ty) + px, y = vy + qw * ty + (qz * tx - qx * tz) + py, z = vz + qw * tz + (qx * ty - qy * tx) + pz;
      points++;
      surface.nearest(x, y, z, 1, id, d2);
      const d = Math.sqrt(d2[0]!);
      if (d < 0.004) {
        gaps.push(0);
        continue;
      }
      gaps.push(windingNumber(position, indices, x, y, z) > 0.5 ? 0 : d);
    }
  }
  return { p95: percentile(gaps, 0.95), max: gaps.reduce((m, v) => Math.max(m, v), 0), points };
}

/* --------------------------------------------- 3. per-vertex attributes */

/** Bilinear sample of one channel of a raw RGBA/RGB image at glTF UV coordinates (origin top-left). */
export function sampleChannel(image: { data: Uint8Array; width: number; height: number; channels: number }, u: number, v: number, channel: number): number {
  const { data, width, height, channels } = image;
  const fx = Math.min(Math.max(u - Math.floor(u), 0), 1) * width - 0.5;
  const fy = Math.min(Math.max(v - Math.floor(v), 0), 1) * height - 0.5;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const at = (x: number, y: number) => data[(y * width + x) * channels + channel]!;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return (top * (1 - ty) + bottom * ty) / 255;
}

export interface TransferOptions {
  /** Roughness image (glTF metallic-roughness texture decoded to raw pixels), optional. */
  roughness?: { data: Uint8Array; width: number; height: number; channels: number } | null;
  proxies?: readonly ProxyShape[];
}

/**
 * Fills `mesh.aux` = (softness, fur length, sheen, ambient occlusion):
 *  - transferred from the procedural model of the same character (inverse-distance weighted
 *    nearest neighbours), which carries the designed softness (floppy ears and tails, firm body),
 *    fur coverage (none on satin bows and bead eyes), sheen and baked contact occlusion;
 *  - where the generated surface is far from the procedural one, softness falls back to the
 *    collision proxies: appendage hulls are soft, the outer layer of the body gets softer with
 *    distance from the core hulls;
 *  - fur and sheen fade out on glossy texels (low roughness: eyes, beads) of the generated texture;
 *  - finally smoothed twice over the mesh so nothing steps at triangle scale.
 */
export function transferAttributes(mesh: TexMesh, reference: ReferenceMesh, options: TransferOptions = {}): void {
  const index = new PointIndex(reference.position, 6);
  const ids = new Int32Array(6), d2 = new Float64Array(6);
  const dist = options.proxies && options.proxies.length > 0 ? proxyDistance(options.proxies) : null;
  const appendage = options.proxies?.filter((p) => p.role === 'appendage') ?? [];
  const appendageDist = appendage.length > 0 ? proxyDistance(appendage) : null;
  const core = options.proxies?.filter((p) => p.role === 'core') ?? [];
  const coreDist = core.length > 0 ? proxyDistance(core) : null;
  for (let v = 0; v < mesh.count; v++) {
    const x = mesh.position[v * 3]!, y = mesh.position[v * 3 + 1]!, z = mesh.position[v * 3 + 2]!;
    const found = index.nearest(x, y, z, 6, ids, d2);
    let ws = 0, soft = 0, fur = Infinity, sheen = 0, ao = 0;
    for (let i = 0; i < found; i++) {
      const w = 1 / (Math.sqrt(d2[i]!) + 1e-4);
      const r = ids[i]!;
      ws += w;
      soft += reference.softness[r]! * w;
      // Fur only where every nearby design point is furry: bows, eyes and patches keep clean edges.
      fur = Math.min(fur, reference.fur[r]!);
      sheen += reference.sheen[r]! * w;
      ao += reference.ao[r]! * w;
    }
    soft /= ws;
    if (!Number.isFinite(fur)) fur = 1;
    sheen /= ws;
    ao /= ws;
    // Far from the procedural surface: the transferred values are less trustworthy.
    const near = Math.sqrt(d2[0] ?? 0);
    const trust = 1 - smoothstep(0.012, 0.03, near);
    if (dist && coreDist) {
      const outsideCore = Math.max(0, coreDist(x, y, z));
      let proxySoft = 0.12 + 0.5 * smoothstep(0, 0.04, outsideCore);
      if (appendageDist && appendageDist(x, y, z) < 0.004 && outsideCore > 0.004) proxySoft = Math.max(proxySoft, 0.7);
      soft = soft * trust + proxySoft * (1 - trust);
    }
    fur = fur * trust + 1 * (1 - trust);
    sheen = sheen * trust + 1 * (1 - trust);
    ao = ao * trust + 1 * (1 - trust);
    if (options.roughness) {
      const r = sampleChannel(options.roughness, mesh.uv[v * 2]!, mesh.uv[v * 2 + 1]!, 1);
      const fabric = smoothstep(0.28, 0.48, r);
      fur *= fabric;
      sheen *= 0.35 + 0.65 * fabric;
    }
    mesh.aux[v * 4] = Math.min(1, Math.max(0, soft));
    mesh.aux[v * 4 + 1] = Math.min(1, Math.max(0, fur));
    mesh.aux[v * 4 + 2] = Math.min(1, Math.max(0, sheen));
    // The base colour of a generated model already carries some shading: use half of the baked contact occlusion.
    mesh.aux[v * 4 + 3] = Math.min(1, Math.max(0, 1 - (1 - ao) * 0.6));
  }
  smoothAux(mesh, 2);
}

/** Averages `aux` over welded neighbours (seam wedges stay identical). */
export function smoothAux(mesh: TexMesh, iterations: number): void {
  const remap = positionRemap(mesh.position);
  const n = mesh.count;
  // Adjacency over canonical vertices.
  const neighbours = new Map<number, Set<number>>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = remap[mesh.indices[t + e]!]!, b = remap[mesh.indices[t + ((e + 1) % 3)]!]!;
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      if (!neighbours.has(b)) neighbours.set(b, new Set());
      neighbours.get(a)!.add(b);
      neighbours.get(b)!.add(a);
    }
  }
  const value = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) if (remap[v] === v) value.set(mesh.aux.subarray(v * 4, v * 4 + 4), v * 4);
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(value);
    for (const [v, set] of neighbours) {
      for (let c = 0; c < 4; c++) {
        let s = value[v * 4 + c]! * 2;
        for (const o of set) s += value[o * 4 + c]!;
        next[v * 4 + c] = s / (set.size + 2);
      }
    }
    value.set(next);
  }
  for (let v = 0; v < n; v++) mesh.aux.set(value.subarray(remap[v]! * 4, remap[v]! * 4 + 4), v * 4);
}

/* ------------------------------------------------------------------ 5. LODs */

export const TEXTURED_LOD_TRIANGLES = [42000, 12000, 4000] as const;
/** LOD 0 keeps the generated mesh unless it has more triangles than this. */
export const LOD0_MAX_TRIANGLES = 45000;

/**
 * Simplifies with meshoptimizer's attribute-aware simplifier. UV seams survive because seam
 * wedges share bitwise identical positions (see `cleanMesh`): the simplifier only collapses
 * along a seam, never across it. Normals and UVs are kept from the original vertices.
 */
export function simplifyMesh(mesh: TexMesh, targetTriangles: number): { mesh: TexMesh; error: number; seams: 'kept' | 'relaxed' } {
  if (mesh.indices.length / 3 <= targetTriangles) return { mesh, error: 0, seams: 'kept' };
  const stride = 7;
  const attrs = new Float32Array(mesh.count * stride);
  for (let v = 0; v < mesh.count; v++) {
    attrs[v * stride] = mesh.normal[v * 3]!;
    attrs[v * stride + 1] = mesh.normal[v * 3 + 1]!;
    attrs[v * stride + 2] = mesh.normal[v * 3 + 2]!;
    attrs[v * stride + 3] = mesh.uv[v * 2]!;
    attrs[v * stride + 4] = mesh.uv[v * 2 + 1]!;
    attrs[v * stride + 5] = mesh.aux[v * 4]!;
    attrs[v * stride + 6] = mesh.aux[v * 4 + 1]!;
  }
  const target = Math.floor(targetTriangles) * 3;
  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(mesh.indices, mesh.position, 3, attrs, stride, [0.5, 0.5, 0.5, 1.2, 1.2, 0.3, 0.2], null, target, 0.05, []);
  if (indices.length <= target * 1.2) return { mesh: compact(mesh, indices), error, seams: 'kept' };
  // Generated atlases have many small UV charts (often ~45 % of all positions lie on a seam), so
  // with every seam kept the simplifier gets stuck far above a low target and spends its error
  // budget on the open areas (faceted look). Allow collapses across seams instead, with a high UV
  // weight so that they happen only where the texture barely changes; used for the low LODs.
  const [relaxed, relaxedError] = MeshoptSimplifier.simplifyWithAttributes(mesh.indices, mesh.position, 3, attrs, stride, [0.5, 0.5, 0.5, 8, 8, 0.3, 0.2], null, target, 0.05, ['Permissive']);
  return { mesh: compact(mesh, relaxed), error: relaxedError, seams: 'relaxed' };
}

/** Reorders vertices and triangles for vertex-cache locality and compression. */
export function optimizeOrder(mesh: TexMesh): TexMesh {
  const indices = new Uint32Array(mesh.indices);
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
  const out: TexMesh = {
    count: unique,
    position: new Float32Array(unique * 3),
    normal: new Float32Array(unique * 3),
    uv: new Float32Array(unique * 2),
    aux: new Float32Array(unique * 4),
    indices,
  };
  for (let v = 0; v < mesh.count; v++) {
    const n = remap[v]!;
    if (n === 0xffffffff) continue;
    out.position.set(mesh.position.subarray(v * 3, v * 3 + 3), n * 3);
    out.normal.set(mesh.normal.subarray(v * 3, v * 3 + 3), n * 3);
    out.uv.set(mesh.uv.subarray(v * 2, v * 2 + 2), n * 2);
    out.aux.set(mesh.aux.subarray(v * 4, v * 4 + 4), n * 4);
  }
  return out;
}

/**
 * LOD 0 keeps the generated mesh (simplified to the first target only above LOD0_MAX_TRIANGLES);
 * every further level is simplified from the full mesh so errors do not accumulate.
 */
export async function buildLods(mesh: TexMesh, targets: readonly number[] = TEXTURED_LOD_TRIANGLES): Promise<{ lods: TexMesh[]; errors: number[]; seams: ('kept' | 'relaxed')[] }> {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const lods: TexMesh[] = [];
  const errors: number[] = [];
  const seams: ('kept' | 'relaxed')[] = [];
  for (let i = 0; i < targets.length; i++) {
    const limit = i === 0 ? Math.max(targets[0]!, LOD0_MAX_TRIANGLES) : targets[i]!;
    const result = mesh.indices.length / 3 > limit ? simplifyMesh(mesh, targets[i]!) : { mesh, error: 0, seams: 'kept' as const };
    lods.push(optimizeOrder(result.mesh));
    errors.push(result.error);
    seams.push(result.seams);
  }
  return { lods, errors, seams };
}

/* -------------------------------------------------------------- 6. textures */

export interface EncodedTextures {
  size: number;
  baseColor: Buffer;
  normal: Buffer;
  roughness: Buffer;
}

export const TEXTURE_QUALITY = { baseColor: 88, normal: 90, roughness: 90 } as const;
/** Roughness varies slowly over a plush: its map is capped at this size (saves a third of the 2K tier's GPU memory). */
export const ROUGHNESS_MAX_SIZE = 1024;

/**
 * Which texels of a `size`² atlas belong to a UV chart: every texel within `marginPx` of a
 * triangle of the mesh's UV layout (glTF convention: v = 0 is the first image row).
 */
export function chartCoverage(uv: Float32Array, indices: Uint32Array, size: number, marginPx = 0.75): Uint8Array {
  const mask = new Uint8Array(size * size);
  for (let t = 0; t < indices.length; t += 3) {
    const ax = uv[indices[t]! * 2]! * size, ay = uv[indices[t]! * 2 + 1]! * size;
    const bx = uv[indices[t + 1]! * 2]! * size, by = uv[indices[t + 1]! * 2 + 1]! * size;
    const cx = uv[indices[t + 2]! * 2]! * size, cy = uv[indices[t + 2]! * 2 + 1]! * size;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const sign = area > 0 ? 1 : -1;
    // Edge functions normalised to pixel distances (positive inside).
    const edges = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [cx, cy, ax, ay],
    ].map(([x0, y0, x1, y1]) => {
      const len = Math.hypot(x1! - x0!, y1! - y0!) || 1;
      return [x0!, y0!, (x1! - x0!) / len, (y1! - y0!) / len] as const;
    });
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) - marginPx)), maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) + marginPx));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) - marginPx)), maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) + marginPx));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (mask[y * size + x]) continue;
        const px = x + 0.5, py = y + 0.5;
        let inside = true;
        for (const [x0, y0, dx, dy] of edges) {
          if (sign * (dx * (py - y0) - dy * (px - x0)) < -marginPx) {
            inside = false;
            break;
          }
        }
        if (inside) mask[y * size + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * For every texel, the index of the texel to take its colour from: itself inside a chart, the
 * nearest chart texel (breadth-first, 8-neighbourhood) in the gaps between charts.
 */
export function paddingSource(mask: Uint8Array, size: number): Int32Array {
  const source = new Int32Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  let head = 0, tail = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    source[i] = i;
    queue[tail++] = i;
  }
  if (tail === 0) {
    for (let i = 0; i < source.length; i++) source[i] = i;
    return source;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % size, y = (i - x) / size;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= size) continue;
        const n = ny * size + nx;
        if (source[n] !== -1) continue;
        source[n] = source[i]!;
        queue[tail++] = n;
      }
    }
  }
  return source;
}

/**
 * Re-fills the gaps between UV charts from each chart's own edge. Generators fill those gaps with
 * colours that may belong to a neighbouring chart; once the texture is downsampled or mipmapped
 * they bleed into the chart border as thin lines along every UV seam.
 */
async function padTexture(image: Uint8Array, layout: { uv: Float32Array; indices: Uint32Array }, cache: Map<number, Int32Array>): Promise<ReturnType<typeof sharp>> {
  const { data, info } = await sharp(Buffer.from(image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  let source = cache.get(info.width);
  if (!source) {
    source = paddingSource(chartCoverage(layout.uv, layout.indices, info.width), info.width);
    cache.set(info.width, source);
  }
  const out = Buffer.alloc(data.length);
  const c = info.channels;
  for (let i = 0; i < source.length; i++) {
    const from = source[i]! * c;
    for (let k = 0; k < c; k++) out[i * c + k] = data[from + k]!;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: c } });
}

/**
 * Resized WebP variants of the three PBR textures. With the mesh's UV `layout`, the gaps between
 * charts are re-padded from each chart's own edge first (see `padTexture`). A missing normal map
 * becomes a flat one, a missing metallic-roughness map a uniform fabric roughness; metalness is
 * cleared (fabric).
 */
export async function textureVariants(
  textures: RawTextures,
  tiers: readonly { tier: TextureTier; size: number }[],
  layout?: { uv: Float32Array; indices: Uint32Array },
): Promise<Map<TextureTier, EncodedTextures>> {
  if (!textures.baseColor) throw new Error('the model has no base colour texture');
  const sourceSize = (await sharp(Buffer.from(textures.baseColor)).metadata()).width ?? 2048;
  const flat = (size: number, rgb: [number, number, number]) => sharp({ create: { width: size, height: size, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } });
  // Full-resolution sources, padded once (encoded losslessly so every tier resizes the same pixels).
  const cache = new Map<number, Int32Array>();
  const prepare = async (img: Uint8Array | null) => {
    if (!img) return null;
    if (!layout) return Buffer.from(img);
    return (await padTexture(img, layout, cache)).png({ compressionLevel: 1 }).toBuffer();
  };
  const sources = { baseColor: (await prepare(textures.baseColor))!, normal: await prepare(textures.normal), metallicRoughness: await prepare(textures.metallicRoughness) };
  const out = new Map<TextureTier, EncodedTextures>();
  for (const { tier, size: wanted } of tiers) {
    const size = Math.min(wanted, sourceSize);
    const resize = (img: Buffer) => sharp(img).resize(size, size, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha();
    const baseColor = await resize(sources.baseColor).webp({ quality: TEXTURE_QUALITY.baseColor, smartSubsample: true, effort: 5 }).toBuffer();
    const normal = await (sources.normal ? resize(sources.normal) : flat(size, [128, 128, 255])).webp({ quality: TEXTURE_QUALITY.normal, effort: 5 }).toBuffer();
    let rough: ReturnType<typeof sharp>;
    if (sources.metallicRoughness) {
      // Keep R (occlusion slot, unused) and G (roughness); clear B (metalness): plush is fabric.
      const roughSize = Math.min(size, ROUGHNESS_MAX_SIZE);
      const { data, info } = await sharp(sources.metallicRoughness).resize(roughSize, roughSize, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += info.channels) data[i + 2] = 0;
      rough = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    } else rough = flat(Math.min(size, ROUGHNESS_MAX_SIZE), [255, 230, 0]);
    const roughness = await rough.webp({ quality: TEXTURE_QUALITY.roughness, effort: 5 }).toBuffer();
    out.set(tier, { size, baseColor, normal, roughness });
  }
  return out;
}

/** Decodes the roughness texture to raw pixels for per-vertex sampling. */
export async function decodeImage(image: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(Buffer.from(image)).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: info.channels };
}

/* ------------------------------------------------------------------- 7. GLB */

const u8n = (src: Float32Array) => {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(src[i]! * 255)));
  return out;
};
const i8n = (src: Float32Array) => {
  const out = new Int8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(src[i]! * 127)));
  return out;
};
const u16n = (src: Float32Array) => {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round(src[i]! * 65535)));
  return out;
};

/**
 * Writes the LOD meshes (nodes / meshes `LOD0`…) with one PBR material whose textures are the
 * given (smallest) variant, embedded as WebP (EXT_texture_webp). Geometry is meshopt-compressed
 * and quantised (KHR_mesh_quantization): normals int8, UVs uint16, `_AUX` uint8 and — unless
 * `floatPositions` — positions int16 over the shared bounding box, dequantised by the node
 * transform (about 4 µm steps for a 20 cm toy). The game's loader bakes that transform into the
 * geometry, so the shader still works in metres.
 */
export async function writeTexturedGlb(lods: TexMesh[], textures: EncodedTextures, extras: Record<string, unknown>, options: { floatPositions?: boolean } = {}): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'plush-portal tools/plush/import-generated';
  const buffer = doc.createBuffer();
  const scene = doc.createScene(String(extras.id ?? 'plush'));
  scene.setExtras(extras);
  doc.getRoot().setDefaultScene(scene);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const tex = (name: string, image: Buffer) => doc.createTexture(name).setImage(new Uint8Array(image)).setMimeType('image/webp');
  const material = doc
    .createMaterial('Plush')
    .setBaseColorTexture(tex('baseColor', textures.baseColor))
    .setNormalTexture(tex('normal', textures.normal))
    .setMetallicRoughnessTexture(tex('metallicRoughness', textures.roughness))
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setDoubleSided(false);
  // One quantisation grid for all LODs (shared bounding box → identical node transforms).
  const all = bounds(lods[0]!.position);
  for (const mesh of lods.slice(1)) {
    const b = bounds(mesh.position);
    for (let c = 0; c < 3; c++) {
      all.min[c] = Math.min(all.min[c]!, b.min[c]!);
      all.max[c] = Math.max(all.max[c]!, b.max[c]!);
    }
  }
  const centre: Vec3 = [0, 1, 2].map((c) => (all.min[c]! + all.max[c]!) / 2) as Vec3;
  const half = Math.max(1e-6, ...[0, 1, 2].map((c) => (all.max[c]! - all.min[c]!) / 2));
  const quantise = (src: Float32Array) => {
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(((src[i]! - centre[i % 3]!) / half) * 32767)));
    return out;
  };
  lods.forEach((mesh, lod) => {
    const uvInRange = mesh.uv.every((v) => v >= 0 && v <= 1);
    const prim = doc.createPrimitive().setMaterial(material);
    prim.setAttribute(
      'POSITION',
      options.floatPositions
        ? doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.position)).setBuffer(buffer)
        : doc.createAccessor().setType('VEC3').setArray(quantise(mesh.position)).setNormalized(true).setBuffer(buffer),
    );
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(i8n(mesh.normal)).setNormalized(true).setBuffer(buffer));
    prim.setAttribute(
      'TEXCOORD_0',
      uvInRange
        ? doc.createAccessor().setType('VEC2').setArray(u16n(mesh.uv)).setNormalized(true).setBuffer(buffer)
        : doc.createAccessor().setType('VEC2').setArray(new Float32Array(mesh.uv)).setBuffer(buffer),
    );
    prim.setAttribute('_AUX', doc.createAccessor().setType('VEC4').setArray(u8n(mesh.aux)).setNormalized(true).setBuffer(buffer));
    const indices = mesh.count > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
    const gltfMesh = doc.createMesh(`LOD${lod}`).addPrimitive(prim);
    const node = doc.createNode(`LOD${lod}`).setMesh(gltfMesh);
    if (!options.floatPositions) node.setTranslation(centre).setScale([half, half, half]);
    scene.addChild(node);
  });
  return io().writeBinary(doc);
}

/* --------------------------------------------------------- reference model */

/** Reads LOD 0 of a procedural plush GLB (tools/plush/bake.ts output) as the fitting reference. */
export async function readReference(data: Uint8Array, meshName = 'LOD0'): Promise<ReferenceMesh> {
  await MeshoptDecoder.ready;
  const doc = await io().readBinary(data);
  const node = doc.getRoot().listNodes().find((n) => n.getName() === meshName && n.getMesh()) ?? doc.getRoot().listNodes().find((n) => n.getMesh());
  const prim = node?.getMesh()?.listPrimitives()[0];
  if (!prim) throw new Error('the procedural model has no mesh');
  const count = prim.getAttribute('POSITION')!.getCount();
  const position = readAttribute(prim, 'POSITION', 3, count)!;
  const color = readAttribute(prim, 'COLOR_0', 4, count);
  const surf = readAttribute(prim, '_SURF', 4, count);
  const aux = readAttribute(prim, '_AUX', 4, count);
  const idxAcc = prim.getIndices()!;
  const indices = new Uint32Array(idxAcc.getCount());
  for (let i = 0; i < indices.length; i++) indices[i] = idxAcc.getScalar(i);
  const pick = (src: Float32Array | null, size: number, c: number, fallback: number) => {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = src ? src[i * size + c]! : fallback;
    return out;
  };
  return {
    position,
    indices,
    softness: pick(aux, 4, 0, 0.2),
    fur: pick(surf, 4, 3, 1),
    sheen: pick(surf, 4, 1, 1),
    ao: pick(color, 4, 3, 1),
  };
}
