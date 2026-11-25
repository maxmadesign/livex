import { Euler, Group, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { axisUV, boxUV } from './decor';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _v = new Vector3();

/** How a material's parts get their UVs: projected boxes, or brushed along the longest axis. */
export type UvRule = { mode: 'box' | 'axis'; density: number };

export interface AddOptions {
  receive?: boolean;
  cast?: boolean;
  /** Keep the geometry's own UVs even if the material has a projection rule. */
  keepUv?: boolean;
}

/**
 * Collects geometry per material and merges it, so the whole cabinet is a handful of draw calls.
 * Parts are bucketed by material *and* shadow flags: under variance shadow maps (High / Ultra)
 * three.js draws every shadow *receiver* into the shadow map, so a receiving riser must not turn
 * the ceiling and the frame (same lacquer) into receivers that shade the whole play field.
 */
export class CabinetBuilder {
  private readonly buckets = new Map<string, { material: Material; geometries: BufferGeometry[]; receive: boolean; cast: boolean }>();

  constructor(private readonly uvRules: Map<Material, UvRule>) {}

  /** Places a geometry in world space and applies the material's UV projection. */
  prepare(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, keepUv = false): BufferGeometry {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(_m);
    // Merging needs identical attribute sets.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const rule = keepUv ? undefined : this.uvRules.get(material);
    if (rule?.mode === 'box') boxUV(g, rule.density);
    else if (rule?.mode === 'axis') {
      // Brush along the part's longest extent.
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(_v);
      axisUV(g, size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z', rule.density);
    }
    if (g !== geometry) geometry.dispose();
    return g;
  }

  add(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, opts: AddOptions = {}): void {
    const g = this.prepare(material, geometry, x, y, z, rx, ry, rz, opts.keepUv);
    const receive = !!opts.receive, cast = !!opts.cast;
    const key = `${material.uuid}|${receive ? 'r' : ''}${cast ? 'c' : ''}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { material, geometries: [], receive, cast }));
    bucket.geometries.push(g);
  }

  build(group: Group, renderOrder: Map<Material, number>): void {
    for (const { material, ...bucket } of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const g of bucket.geometries) g.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.receiveShadow = bucket.receive;
      mesh.castShadow = bucket.cast;
      mesh.renderOrder = renderOrder.get(material) ?? 0;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
}

/** Planar UVs from world-space positions so patterns keep a constant physical size. */
export function worldUV(g: BufferGeometry, plane: 'xy' | 'xz' | 'zy', tilesPerMetre: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (plane === 'xy') uv.setXY(i, x * tilesPerMetre, y * tilesPerMetre);
    else if (plane === 'xz') uv.setXY(i, x * tilesPerMetre, -z * tilesPerMetre);
    else uv.setXY(i, -z * tilesPerMetre, y * tilesPerMetre);
  }
  return g;
}
