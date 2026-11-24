/**
 * Naive Surface Nets over a regular grid, followed by projection of every
 * vertex onto the exact zero set. Produces a welded, mostly-quad mesh with far
 * fewer slivers than marching cubes, which simplifies and shades better.
 */
import { gradient, type DistFn, type V3 } from './sdf';

export interface RawMesh {
  /** xyz per vertex. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: V3;
  max: V3;
}

/** Edge table: the 12 edges of a cube as pairs of corner indices (corner bit i: x = i&1, y = i>>1&1, z = i>>2&1). */
const CUBE_EDGES: [number, number][] = [];
for (let i = 0; i < 8; i++) {
  for (let axis = 0; axis < 3; axis++) {
    const j = i | (1 << axis);
    if (i !== j) CUBE_EDGES.push([i, j]);
  }
}

export function surfaceNets(fn: DistFn, bounds: Bounds, cell: number): RawMesh {
  const pad = cell * 2;
  const ox = bounds.min[0] - pad, oy = bounds.min[1] - pad, oz = bounds.min[2] - pad;
  const nx = Math.ceil((bounds.max[0] - bounds.min[0] + 2 * pad) / cell) + 1;
  const ny = Math.ceil((bounds.max[1] - bounds.min[1] + 2 * pad) / cell) + 1;
  const nz = Math.ceil((bounds.max[2] - bounds.min[2] + 2 * pad) / cell) + 1;
  const values = new Float32Array(nx * ny * nz);
  let p = 0;
  for (let k = 0; k < nz; k++) {
    const z = oz + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * cell;
      for (let i = 0; i < nx; i++) values[p++] = fn(ox + i * cell, y, z);
    }
  }
  const at = (i: number, j: number, k: number) => values[i + nx * (j + ny * k)]!;

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of CUBE_EDGES) {
          const va = corner[a]!, vb = corner[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        cellVertex[i + cx * (j + cy * k)] = positions.length / 3;
        positions.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
      }
    }
  }

  const indices: number[] = [];
  const cellAt = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)]!;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  // One quad per grid edge that crosses the surface, joining the four cells around that edge.
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = at(i, j, k);
        const inside = v0 < 0;
        if (inside !== at(i + 1, j, k) < 0) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), !inside);
        }
        if (inside !== at(i, j + 1, k) < 0) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), !inside);
        }
        if (inside !== at(i, j, k + 1) < 0) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), !inside);
        }
      }
    }
  }

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(pos.length);
  // Project onto the exact surface and take normals from the field.
  const g: V3 = [0, 0, 0];
  const eps = cell * 0.4;
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
    for (let it = 0; it < 3; it++) {
      const d = fn(x, y, z);
      gradient(fn, x, y, z, eps, g);
      const gl2 = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (4 * eps * eps);
      if (gl2 < 1e-10) break;
      // Limit the step so thin features cannot throw vertices across the model.
      const s = Math.max(-cell, Math.min(cell, d / Math.sqrt(gl2))) / Math.sqrt(gl2) / (2 * eps);
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    gradient(fn, x, y, z, eps, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    pos[v] = x;
    pos[v + 1] = y;
    pos[v + 2] = z;
    nrm[v] = g[0] / l;
    nrm[v + 1] = g[1] / l;
    nrm[v + 2] = g[2] / l;
  }
  return { positions: pos, normals: nrm, indices: new Uint32Array(indices) };
}

/** Removes degenerate triangles and makes sure triangle winding agrees with the field normals. */
export function cleanMesh(mesh: RawMesh): RawMesh {
  const { positions: p, normals: n, indices } = mesh;
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    if (a === b || b === c || a === c) continue;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const area2 = fx * fx + fy * fy + fz * fz;
    if (area2 < 1e-14) continue;
    const dot = fx * (n[a * 3]! + n[b * 3]! + n[c * 3]!) + fy * (n[a * 3 + 1]! + n[b * 3 + 1]! + n[c * 3 + 1]!) + fz * (n[a * 3 + 2]! + n[b * 3 + 2]! + n[c * 3 + 2]!);
    if (dot < 0) out.push(a, c, b);
    else out.push(a, b, c);
  }
  return { positions: p, normals: n, indices: new Uint32Array(out) };
}
