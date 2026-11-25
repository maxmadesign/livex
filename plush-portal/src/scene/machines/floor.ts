/**
 * The play floor of a machine whose floor has its own hole (docs/design/machines.md, section 5.1):
 * mat slabs around the hole (from the same `floorWithHole` boxes the physics uses), a dark collar
 * through the slab on every edge of the hole that is not the glass, a light lip just inside it, and
 * the chrome front lip with its light strip along the front edge. Classic keeps Cabinet's own floor.
 */
import { BoxGeometry } from 'three';
import { floorWithHole, type Rect } from '../../physics/fieldGeometry';
import { FIELD } from '../../physics/fieldSpec';
import { worldUV, type CabinetBuilder } from '../builder';
import type { CabinetMaterials } from '../materials';
import type { DressContext } from './fixtures';

/** Mat pattern scale of the floor (the same as Cabinet's classic floor). */
export const MAT_TILES_PER_METRE = 2.6;

/** Edges of a hole that lie inside the field (an edge on the glass or the front needs no collar). */
export function innerEdges(hole: Rect): ('left' | 'right' | 'back' | 'front')[] {
  const W = FIELD.halfWidth, D = FIELD.depth, eps = 1e-6;
  const out: ('left' | 'right' | 'back' | 'front')[] = [];
  if (hole.xMax < W - eps) out.push('right');
  if (hole.zMin > -D + eps) out.push('back');
  if (hole.xMin > -W + eps) out.push('left');
  if (hole.zMax < -eps) out.push('front');
  return out;
}

/** Spans [x0, x1] of the floor's front edge (z = 0) that are not over the hole. */
export function frontSpans(hole: Rect): [number, number][] {
  const W = FIELD.halfWidth;
  if (hole.zMax < -1e-6) return [[-W, W]];
  const out: [number, number][] = [];
  if (hole.xMin > -W + 1e-6) out.push([-W, hole.xMin]);
  if (hole.xMax < W - 1e-6) out.push([hole.xMax, W]);
  return out;
}

export function buildHoleFloor(b: CabinetBuilder, M: CabinetMaterials, hole: Rect, ctx: DressContext): void {
  const T = FIELD.floorThickness, HW = FIELD.halfWidth;
  // Mat slabs: world-projected UVs, so the pattern runs on across the pieces.
  for (const part of floorWithHole(hole)) {
    const g = new BoxGeometry(2 * part.half[0], 2 * part.half[1], 2 * part.half[2]);
    g.translate(part.center[0], part.center[1], part.center[2]);
    b.add(M.mat, worldUV(g, 'xz', MAT_TILES_PER_METRE), 0, 0, 0, 0, 0, 0, { receive: true });
  }
  // Dark collar through the slab and a light lip just inside the hole, on its inner edges.
  const xLen = hole.xMax - hole.xMin, zLen = hole.zMax - hole.zMin;
  const xMid = (hole.xMin + hole.xMax) / 2, zMid = (hole.zMin + hole.zMax) / 2;
  for (const edge of innerEdges(hole)) {
    if (edge === 'right' || edge === 'left') {
      const x = edge === 'right' ? hole.xMax : hole.xMin;
      const inward = edge === 'right' ? -1 : 1;
      b.add(M.dark, ctx.box(0.004, T, zLen), x + inward * 0.002, -T / 2, zMid);
      b.add(M.leds[0]!, ctx.box(0.003, 0.009, Math.max(0.01, zLen - 0.01)), x + inward * 0.0055, -0.011, zMid);
    } else {
      const z = edge === 'back' ? hole.zMin : hole.zMax;
      const inward = edge === 'back' ? 1 : -1;
      b.add(M.dark, ctx.box(xLen, T, 0.004), xMid, -T / 2, z + inward * 0.002);
      b.add(M.leds[0]!, ctx.box(Math.max(0.01, xLen - 0.01), 0.009, 0.003), xMid, -0.011, z + inward * 0.0055);
    }
  }
  // Front lip with a light strip underneath, along the front edge wherever there is floor.
  for (const [x0, x1] of frontSpans(hole)) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    b.add(M.chrome, ctx.box(w + 0.004, 0.014, 0.012, 0.004), cx, 0.004, -0.008);
    if (w > 0.06) b.add(M.leds[0]!, ctx.box(w - 0.04, 0.006, 0.004), cx, -0.012, -0.0015);
  }
  b.add(M.accent, ctx.box(2 * HW, T - 0.012, 0.01, 0.003), 0, -T / 2 - 0.004, -0.007);
}
