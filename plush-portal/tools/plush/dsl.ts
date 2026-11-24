/**
 * Authoring vocabulary for plush characters. A design is a list of layers
 * (separately meshed surfaces such as the furry body, a felt hat or a glossy
 * helmet), paint regions (crisp appliqué colours evaluated per pixel) and
 * patches (embroidered / sewn-on features projected onto the surface).
 *
 * Units: centimetres. Axes: +Y up, +Z = the character's front, origin at the
 * centre of the base it sits on.
 */
import type { AssetStatus } from '../../src/plush/manifest';
import type { Lang, ThemeId } from '../../src/core/types';
import { ellipsoid, mirrorX, roundBox, roundCone, roundCylinder, sphere, torus, tube, type DistFn, type V3 } from './sdf';

export type SurfaceKind =
  | 'fur' // long plush pile
  | 'shortfur' // velour / minky
  | 'felt' // matte felt appliqué
  | 'thread' // embroidery
  | 'bead' // glossy safety eye
  | 'satin' // ribbon
  | 'gloss' // shiny vinyl / hard plastic
  | 'knit' // scarf wool
  | 'metal';

export interface PartDef {
  name: string;
  fn: DistFn;
  color: string;
  /** Blend radius in cm used when this part is merged into the layer. */
  k: number;
  /** 0 = firm, 1 = very floppy (ears, tails, tentacles). */
  soft: number;
  /** Physical role. `none` parts get no collider of their own. */
  collide: 'core' | 'appendage' | 'none';
  /** Carves the part out of the layer instead of adding it. */
  subtract: boolean;
  /** Sewn piece id: junctions between different pieces get a seam line. */
  piece: string;
  /** Where a floppy part is attached; softness grows with the distance from here. */
  root?: V3;
  /** Distance from `root` at which the part is fully soft (cm). */
  reach?: number;
  /** Collider group: parts sharing a group are wrapped by one hull. Defaults to the part name. */
  group: string;
}

export interface PartOptions {
  k?: number;
  soft?: number;
  collide?: PartDef['collide'];
  subtract?: boolean;
  piece?: string;
  root?: V3;
  reach?: number;
  group?: string;
}

export function part(name: string, fn: DistFn, color: string, o: PartOptions = {}): PartDef {
  return {
    name,
    fn,
    color,
    k: o.k ?? 1.6,
    soft: o.soft ?? 0.06,
    collide: o.collide ?? 'none',
    subtract: o.subtract ?? false,
    piece: o.piece ?? name,
    root: o.root,
    reach: o.reach,
    group: o.group ?? name,
  };
}

/** Ellipsoid part. `rot` is XYZ Euler degrees. */
export function ell(name: string, center: V3, radii: V3, color: string, o: PartOptions & { rot?: V3 } = {}): PartDef {
  return part(name, ellipsoid(center, radii, o.rot), color, o);
}

/** Tapered capsule part from `a` (radius r1) to `b` (radius r2). */
export function cone(name: string, a: V3, b: V3, r1: number, r2: number, color: string, o: PartOptions = {}): PartDef {
  return part(name, roundCone(a, b, r1, r2), color, { root: a, reach: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + r2, ...o });
}

export function ball(name: string, center: V3, r: number, color: string, o: PartOptions = {}): PartDef {
  return part(name, sphere(center, r), color, o);
}

export function box(name: string, center: V3, half: V3, round: number, color: string, o: PartOptions & { rot?: V3 } = {}): PartDef {
  return part(name, roundBox(center, half, round, o.rot), color, o);
}

export function cyl(name: string, center: V3, radius: number, halfHeight: number, round: number, color: string, o: PartOptions & { rot?: V3 } = {}): PartDef {
  return part(name, roundCylinder(center, radius, halfHeight, round, o.rot), color, o);
}

export function ring(name: string, center: V3, ringRadius: number, tubeRadius: number, color: string, o: PartOptions & { rot?: V3 } = {}): PartDef {
  return part(name, torus(center, ringRadius, tubeRadius, o.rot), color, o);
}

export function pipe(name: string, points: V3[], radii: number[] | number, color: string, o: PartOptions = {}): PartDef {
  const first = points[0]!;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return part(name, tube(points, radii), color, { root: first, reach: length, ...o });
}

/** Mirrors a part built for the +X side to both sides ("…R" on +X, "…L" on −X). */
export function pair(p: PartDef): PartDef[] {
  const left: PartDef = {
    ...p,
    name: `${p.name}L`,
    fn: mirrorX(p.fn),
    piece: p.piece === p.name ? `${p.name}L` : p.piece,
    group: p.group === p.name ? `${p.name}L` : p.group,
    root: p.root ? [-p.root[0], p.root[1], p.root[2]] : undefined,
  };
  const right: PartDef = {
    ...p,
    name: `${p.name}R`,
    piece: p.piece === p.name ? `${p.name}R` : p.piece,
    group: p.group === p.name ? `${p.name}R` : p.group,
  };
  return [right, left];
}

export interface LayerDef {
  name: string;
  surface: SurfaceKind;
  parts: PartDef[];
  /** Cut the layer at y = 0 with this edge rounding (cm) so the toy sits flat. */
  flatBase?: number;
  /** Fur length factor 0..1 for shell fur (0 for non-fur surfaces). */
  fur?: number;
  /** Draw seam lines where different sewn pieces meet. */
  seams?: boolean;
  /** Relative mesh density (1 = default). Thin or detailed layers can ask for more. */
  detail?: number;
  /** Share of the per-LOD triangle budget (defaults to surface area). */
  budget?: number;
}

export interface PaintDef {
  name: string;
  channel: 0 | 1 | 2 | 3;
  /** Inside (negative) = painted. Evaluated on the vertices of `layer`. */
  fn: DistFn;
  color: string;
  /** Embroidered stitches along the border (true = slightly darker than the paint colour). */
  stitch?: boolean | string;
  /** Layer the paint applies to (default "body"). */
  layer?: string;
}

interface PatchBase {
  /** Layer the patch is projected onto (default "body"). */
  layer?: string;
  color: string;
  surface: SurfaceKind;
  /** Height above the surface in cm. */
  lift?: number;
  /** Also create the mirror image on the other side (x → −x). */
  mirror?: boolean;
}

/** Elliptical patch (eyes, cheeks, noses, buttons). `dome` raises the middle (fraction of the radius). */
export interface DiscPatch extends PatchBase {
  kind: 'disc';
  /** A point on or near the surface. */
  at: V3;
  rx: number;
  ry?: number;
  /** In-plane rotation in degrees. */
  rot?: number;
  dome?: number;
}

/** Embroidered line through points near the surface (mouths, closed eyes, whiskers, stripes). */
export interface StrokePatch extends PatchBase {
  kind: 'stroke';
  points: V3[];
  width: number;
  closed?: boolean;
  /** Thin the ends. */
  taper?: boolean;
}

/** Appliqué with an arbitrary outline given in the tangent plane (cm), star-shaped around its centre. */
export interface PolyPatch extends PatchBase {
  kind: 'poly';
  at: V3;
  outline: [number, number][];
  rot?: number;
  scale?: number;
  dome?: number;
}

/** Small folded fabric tag sewn into a seam. */
export interface TagPatch {
  kind: 'tag';
  at: V3;
  /** Direction the tag sticks out. */
  out: V3;
  color: string;
  accent: string;
  width?: number;
  length?: number;
}

export type PatchDef = DiscPatch | StrokePatch | PolyPatch | TagPatch;

export interface PlushDesign {
  slug: string;
  theme: ThemeId;
  name: Record<Lang, string>;
  kind: Record<Lang, string>;
  status: AssetStatus;
  note: string;
  /** Final height of the finished toy in cm; the model is scaled uniformly to match. */
  height: number;
  /** Mass in kg. */
  mass: number;
  layers: LayerDef[];
  paints?: PaintDef[];
  patches?: PatchDef[];
  deform?: { dentRadius?: number; sag?: number; squash?: number; sway?: number };
}

/* ----------------------------------------------------------- face helpers */

export interface EyeOptions {
  /** Position of the +X eye. */
  at: V3;
  r: number;
  style?: 'bead' | 'sleepy' | 'happy' | 'sparkle' | 'dot';
  color?: string;
  /** Vertical stretch of the eye (1 = round). */
  tall?: number;
  layer?: string;
}

/** A mirrored pair of eyes with the usual plush-toy details. */
export function eyes(o: EyeOptions): PatchDef[] {
  const color = o.color ?? '#1b1420';
  const style = o.style ?? 'bead';
  const [x, y, z] = o.at;
  const out: PatchDef[] = [];
  if (style === 'sleepy' || style === 'happy') {
    // Embroidered arc: "‿" for sleepy, "⌒" for happy.
    const sign = style === 'happy' ? 1 : -1;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6 - 0.5;
      pts.push([x + t * 2 * o.r, y + sign * (0.25 - t * t) * o.r * 1.5, z]);
    }
    out.push({ kind: 'stroke', points: pts, width: o.r * 0.34, color, surface: 'thread', mirror: true, taper: true, layer: o.layer });
    return out;
  }
  const tall = o.tall ?? 1;
  if (style === 'dot') {
    out.push({ kind: 'disc', at: o.at, rx: o.r, ry: o.r * tall, color, surface: 'thread', mirror: true, dome: 0.18, lift: 0.05, layer: o.layer });
    return out;
  }
  out.push({ kind: 'disc', at: o.at, rx: o.r, ry: o.r * tall, color, surface: 'bead', mirror: true, dome: 0.5, lift: 0.04, layer: o.layer });
  // Highlights are sewn on top of the bead: both eyes catch the light from the same side.
  const hl = (sx: number): PatchDef => ({
    kind: 'disc',
    at: [sx * x + o.r * 0.3, y + o.r * 0.36 * tall, z + o.r * 0.52],
    rx: o.r * 0.26,
    color: '#ffffff',
    surface: 'gloss',
    lift: o.r * 0.42,
    dome: 0.3,
    layer: o.layer,
  });
  out.push(hl(1), hl(-1));
  if (style === 'sparkle') {
    const small = (sx: number): PatchDef => ({
      kind: 'disc',
      at: [sx * x - o.r * 0.32, y - o.r * 0.34 * tall, z + o.r * 0.5],
      rx: o.r * 0.13,
      color: '#ffffff',
      surface: 'gloss',
      lift: o.r * 0.4,
      dome: 0.3,
      layer: o.layer,
    });
    out.push(small(1), small(-1));
  }
  return out;
}

/** Rosy felt cheeks. */
export function blush(at: V3, rx: number, ry: number, color: string, layer?: string): PatchDef {
  return { kind: 'disc', at, rx, ry, color, surface: 'felt', mirror: true, lift: 0.03, layer };
}

/** Embroidered smile: a shallow arc centred on x = 0. `curve` > 0 smiles, < 0 frowns. */
export function smile(at: V3, halfWidth: number, curve: number, width: number, color = '#3a2a2e', layer?: string): PatchDef {
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 - 0.5;
    pts.push([at[0] + t * 2 * halfWidth, at[1] - (0.25 - t * t) * 4 * curve, at[2]]);
  }
  return { kind: 'stroke', points: pts, width, color, surface: 'thread', taper: true, layer };
}

/** Cat-style "ω" mouth. */
export function wMouth(at: V3, halfWidth: number, depth: number, width: number, color = '#3a2a2e', layer?: string): PatchDef[] {
  const side = (s: number): PatchDef => {
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([at[0] + s * t * halfWidth, at[1] - Math.sin(t * Math.PI) * depth, at[2]]);
    }
    return { kind: 'stroke', points: pts, width, color, surface: 'thread', taper: true, layer };
  };
  return [side(1), side(-1)];
}

export function nose(at: V3, rx: number, ry: number, color: string, layer?: string): PatchDef {
  return { kind: 'disc', at, rx, ry, color, surface: 'thread', dome: 0.35, lift: 0.05, layer };
}

/** Regular star outline with `points` tips. */
export function starOutline(points: number, outer: number, inner: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

export function heartOutline(size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([(x / 17) * size, ((y + 2) / 17) * size]);
  }
  return out;
}

/** Five-petal blossom outline. */
export function flowerOutline(petals: number, outer: number, inner: number): [number, number][] {
  const out: [number, number][] = [];
  const steps = petals * 8;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 + Math.PI / 2;
    const lobe = Math.abs(Math.cos((a - Math.PI / 2) * petals * 0.5));
    const r = inner + (outer - inner) * Math.pow(1 - lobe, 0.55);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

export function boltOutline(size: number): [number, number][] {
  return (
    [
      [0.18, 1],
      [-0.55, 0.05],
      [-0.08, 0.05],
      [-0.3, -1],
      [0.55, 0.22],
      [0.06, 0.22],
    ] as [number, number][]
  ).map(([x, y]) => [x * size, y * size]);
}

export function ovalOutline(rx: number, ry: number, n = 20): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return out;
}

/** Union of several mask shapes (for paint regions made of more than one blob). */
export function anyOf(...fns: DistFn[]): DistFn {
  return (x, y, z) => {
    let d = Infinity;
    for (const f of fns) {
      const v = f(x, y, z);
      if (v < d) d = v;
    }
    return d;
  };
}

/** Both mirror images of a mask shape. */
export function bothSides(fn: DistFn): DistFn {
  return (x, y, z) => Math.min(fn(x, y, z), fn(-x, y, z));
}

export { ellipsoid, roundCone, sphere, roundBox, roundCylinder, torus, tube, mirrorX } from './sdf';
export type { DistFn, V3 } from './sdf';
