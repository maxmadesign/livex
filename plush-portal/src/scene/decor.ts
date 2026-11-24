import { BufferGeometry, Float32BufferAttribute, Path, Shape } from 'three';

/**
 * DOM-free geometry helpers for the cabinet and the claw: world-projected UVs (so procedural
 * detail maps keep a constant physical size and brushed grooves follow a part's length) and
 * the 2D outlines of the decor kit. Unit tested in tests/unit/scene.
 */

type Axis = 0 | 1 | 2;
const AXIS: Record<'x' | 'y' | 'z', Axis> = { x: 0, y: 1, z: 2 };

function ensureUv(g: BufferGeometry): Float32Array {
  let uv = g.getAttribute('uv');
  if (!uv || uv.count !== g.getAttribute('position').count) {
    g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    uv = g.getAttribute('uv');
  }
  return uv.array as Float32Array;
}

/** Dominant axis of the face normal of triangle `t` of a non-indexed geometry. */
function faceAxis(p: ArrayLike<number>, t: number): Axis {
  const i = t * 9;
  const ax = p[i + 3]! - p[i]!, ay = p[i + 4]! - p[i + 1]!, az = p[i + 5]! - p[i + 2]!;
  const bx = p[i + 6]! - p[i]!, by = p[i + 7]! - p[i + 1]!, bz = p[i + 8]! - p[i + 2]!;
  const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
  return nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
}

/**
 * Box projection: each triangle takes the two world axes perpendicular to its dominant normal,
 * `density` texture repeats per metre. The geometry must be non-indexed (Builder output).
 */
export function boxUV(g: BufferGeometry, density: number): BufferGeometry {
  if (g.index) throw new Error('boxUV needs a non-indexed geometry');
  const p = g.getAttribute('position').array;
  const uv = ensureUv(g);
  const tris = g.getAttribute('position').count / 3;
  for (let t = 0; t < tris; t++) {
    const axis = faceAxis(p, t);
    const [a, b] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      uv[v * 2] = p[v * 3 + a]! * density;
      uv[v * 2 + 1] = p[v * 3 + b]! * density;
    }
  }
  g.getAttribute('uv').needsUpdate = true;
  return g;
}

/**
 * Brushed-metal projection: u runs along `along` (the brushing direction), v along whichever
 * other axis lies in each triangle's plane. Grooves then follow a rail or tube on every face.
 */
export function axisUV(g: BufferGeometry, along: 'x' | 'y' | 'z', density: number): BufferGeometry {
  if (g.index) throw new Error('axisUV needs a non-indexed geometry');
  const p = g.getAttribute('position').array;
  const uv = ensureUv(g);
  const A = AXIS[along];
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== A);
  const tris = g.getAttribute('position').count / 3;
  for (let t = 0; t < tris; t++) {
    const n = faceAxis(p, t);
    const across = n === A ? others[0]! : others.find((a) => a !== n)!;
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      uv[v * 2] = p[v * 3 + A]! * density;
      uv[v * 2 + 1] = p[v * 3 + across]! * density;
    }
  }
  g.getAttribute('uv').needsUpdate = true;
  return g;
}

/**
 * Cylindrical projection for turned parts (around +y): u along y, v around the axis, both in
 * metres × density. Works on indexed or non-indexed geometry.
 */
export function cylinderUV(g: BufferGeometry, density: number, radius: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = ensureUv(g);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    uv[i * 2] = pos.getY(i) * density;
    uv[i * 2 + 1] = a * radius * density;
  }
  g.getAttribute('uv').needsUpdate = true;
  return g;
}

/** Block letters of the GPU Party decor, `h` tall (width 0.6 h, stroke 0.18 h), origin bottom-left. */
export function letterShape(ch: 'G' | 'P' | 'U', h: number): Shape {
  const s = h / 5;
  const pts = (list: number[][]) => list.map(([x, y]) => [x! * s, y! * s] as const);
  const make = (outline: readonly (readonly [number, number])[]) => {
    const shape = new Shape();
    outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    return shape;
  };
  if (ch === 'G') {
    return make(
      pts([
        [0.35, 0],
        [2.65, 0],
        [3, 0.35],
        [3, 2.4],
        [1.55, 2.4],
        [1.55, 1.55],
        [2.1, 1.55],
        [2.1, 0.9],
        [0.9, 0.9],
        [0.9, 4.1],
        [3, 4.1],
        [3, 4.65],
        [2.65, 5],
        [0.35, 5],
        [0, 4.65],
        [0, 0.35],
      ]),
    );
  }
  if (ch === 'P') {
    const shape = make(
      pts([
        [0, 0],
        [0.9, 0],
        [0.9, 1.9],
        [2.65, 1.9],
        [3, 2.25],
        [3, 4.65],
        [2.65, 5],
        [0, 5],
      ]),
    );
    const hole = new Path();
    pts([
      [0.9, 2.8],
      [2.1, 2.8],
      [2.1, 4.1],
      [0.9, 4.1],
    ]).forEach(([x, y], i) => (i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  }
  return make(
    pts([
      [0.35, 0],
      [2.65, 0],
      [3, 0.35],
      [3, 5],
      [2.1, 5],
      [2.1, 0.9],
      [0.9, 0.9],
      [0.9, 5],
      [0, 5],
      [0, 0.35],
    ]),
  );
}

/** Lightning bolt, about `r` from the centre to the tips. */
export function boltShape(r: number): Shape {
  const s = new Shape();
  const p = [
    [0.15, 1],
    [-0.45, -0.05],
    [-0.02, -0.05],
    [-0.2, -1],
    [0.48, 0.18],
    [0.05, 0.18],
    [0.35, 1],
  ];
  p.forEach(([x, y], i) => (i === 0 ? s.moveTo(x! * r, y! * r) : s.lineTo(x! * r, y! * r)));
  s.closePath();
  return s;
}

/** One swept fan blade from the hub (radius `hub`) to the rim (radius `r`). */
export function fanBladeShape(r: number, hub: number): Shape {
  const s = new Shape();
  const steps = 10;
  const sweep = 0.9;
  const lead: [number, number][] = [];
  const trail: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const rr = hub + (r - hub) * t;
    const a0 = t * sweep * 0.55;
    const width = 0.42 + 0.18 * Math.sin(Math.PI * t);
    lead.push([Math.cos(a0) * rr, Math.sin(a0) * rr]);
    trail.push([Math.cos(a0 + width) * rr, Math.sin(a0 + width) * rr]);
  }
  lead.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  for (let i = trail.length - 1; i >= 0; i--) s.lineTo(trail[i]![0], trail[i]![1]);
  s.closePath();
  return s;
}

/** Rounded square plate with a round hole (fan frame). */
export function fanFrameShape(size: number, holeR: number, segments = 32): Shape {
  const h = size / 2, c = size * 0.12;
  const s = new Shape();
  s.moveTo(-h + c, -h);
  s.lineTo(h - c, -h);
  s.quadraticCurveTo(h, -h, h, -h + c);
  s.lineTo(h, h - c);
  s.quadraticCurveTo(h, h, h - c, h);
  s.lineTo(-h + c, h);
  s.quadraticCurveTo(-h, h, -h, h - c);
  s.lineTo(-h, -h + c);
  s.quadraticCurveTo(-h, -h, -h + c, -h);
  const hole = new Path();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    if (i === 0) hole.moveTo(Math.cos(a) * holeR, Math.sin(a) * holeR);
    else hole.lineTo(Math.cos(a) * holeR, Math.sin(a) * holeR);
  }
  s.holes.push(hole);
  return s;
}

/** Tessellation per detail level (0 = Safe … 3 = Ultra). */
export const TESSELLATION = {
  /** RoundedBoxGeometry segments. */
  bevel: [2, 3, 4, 6],
  /** Radial segments of cylinders / tori / lathes. */
  radial: [12, 20, 32, 48],
  /** ExtrudeGeometry curve segments and bevel segments. */
  curve: [6, 10, 14, 20],
  bevelSegments: [1, 2, 3, 4],
} as const;
