import { BufferAttribute, BufferGeometry, Color, SphereGeometry } from 'three';
import type { PlushAsset } from './manifest';

/**
 * Stand-in body used only when a model file is missing or broken: a soft
 * two-ball figure in the asset's main colour with every attribute the plush
 * shader expects. The game stays playable and diagnostics report the problem.
 */
export function createFallbackGeometry(asset: PlushAsset): BufferGeometry {
  const height = Math.max(0.08, asset.size[1]);
  const bodyR = height * 0.36;
  const headR = height * 0.3;
  const body = new SphereGeometry(bodyR, 28, 20);
  body.scale(1, 0.95, 0.95);
  body.translate(0, bodyR * 0.92, 0);
  const head = new SphereGeometry(headR, 28, 20);
  head.translate(0, height - headR, 0);
  const parts = [body, head];
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 4);
  const mask = new Float32Array(count * 4).fill(1);
  const surf = new Float32Array(count * 4);
  const aux = new Float32Array(count * 4);
  const indices: number[] = [];
  const base = new Color(asset.palette[0] ?? '#f4d9c8').convertSRGBToLinear();
  let offset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const v = offset + i;
      position.set([p.getX(i), Math.max(0, p.getY(i)), p.getZ(i)], v * 3);
      normal.set([n.getX(i), n.getY(i), n.getZ(i)], v * 3);
      color.set([base.r, base.g, base.b, 1], v * 4);
      surf.set([0.95, 1, 0, 1], v * 4);
      aux.set([0.08, 1, 0, 0], v * 4);
    }
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    offset += p.count;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(position, 3));
  out.setAttribute('normal', new BufferAttribute(normal, 3));
  out.setAttribute('color', new BufferAttribute(color, 4));
  out.setAttribute('_mask', new BufferAttribute(mask, 4));
  out.setAttribute('_surf', new BufferAttribute(surf, 4));
  out.setAttribute('_aux', new BufferAttribute(aux, 4));
  out.setIndex(indices);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
