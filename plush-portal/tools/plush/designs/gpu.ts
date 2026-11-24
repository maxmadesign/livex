/**
 * GPU Party — plush merchandise from a graphics-card and AI-computing fan shop: matte black
 * plush, vivid lime green, grey felt and a few warm accents. Every toy is an original design
 * modelled after the theme's concept photos; no real logo, product or person is depicted
 * (the presenter is a generic "Keynote Chief").
 */
import {
  anyOf,
  ball,
  blush,
  bothSides,
  box,
  cone,
  cyl,
  ell,
  ellipsoid,
  heartOutline,
  pair,
  part,
  pipe,
  ring,
  roundBox,
  roundCone,
  roundCylinder,
  smile,
  type DistFn,
  type PartDef,
  type PatchDef,
  type PlushDesign,
  type V3,
} from '../dsl';
import { applyMatrix, eulerMatrix, rotated, smax } from '../sdf';

/* ------------------------------------------------------------ local helpers */

/** Sewn pieces: seams are drawn where an A piece meets a B piece (see cosmic.ts). */
const A = 'pieceA';
const B = 'pieceB';

const LIME = '#76b900';
const LIME_FELT = '#7fd10f';
const LIME_SOFT = '#a6e04a';
const BLACK = '#0e0e10';
const BLACK_DEEP = '#09090a';
const GREY_FELT = '#8e9095';
const GREY_DARK = '#55585d';
const WHITE = '#ffffff';
const CREAM_TAG = '#f3efe3';
const BLUSH_PINK = '#f6a3ad';
const INK = '#1b1418';

type Path2 = [number, number][];

function norm3(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function cross3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Right / up directions of a surface patch facing `n` (the same frame the bake tool uses). */
function tangents(n: V3): { t: V3; b: V3 } {
  let t = cross3([0, 1, 0], n);
  if (Math.hypot(t[0], t[1], t[2]) < 0.15) t = cross3(n, [0, 0, 1]);
  t = norm3(t);
  return { t, b: norm3(cross3(n, t)) };
}

function add3(a: V3, ...terms: [V3, number][]): V3 {
  const out: V3 = [a[0], a[1], a[2]];
  for (const [v, k] of terms) {
    out[0] += v[0] * k;
    out[1] += v[1] * k;
    out[2] += v[2] * k;
  }
  return out;
}

/**
 * One glossy safety-eye bead on a surface facing `normal`, with sewn-on highlights that sit just
 * proud of the bead. Highlights are offset in the surface frame so eyes on side faces look right.
 */
function eyeAt(at: V3, r: number, o: { normal?: V3; tall?: number; color?: string; pupil?: string; sparkle?: boolean; layer?: string } = {}): PatchDef[] {
  const n = norm3(o.normal ?? [0, 0, 1]);
  const { t, b } = tangents(n);
  const tall = o.tall ?? 1;
  const dome = 0.5;
  const out: PatchDef[] = [{ kind: 'disc', at, rx: r, ry: r * tall, color: o.color ?? INK, surface: 'bead', dome, lift: 0.04, layer: o.layer }];
  if (o.pupil) out.push({ kind: 'disc', at: add3(at, [n, 0.2 * r]), rx: r * 0.52, ry: r * 0.52 * tall, color: o.pupil, surface: 'bead', dome: 0.3, lift: 0.05 + dome * r * 0.85, layer: o.layer });
  const glint = (dx: number, dy: number, size: number): PatchDef => ({
    kind: 'disc',
    at: add3(at, [t, dx * r], [b, dy * r * tall], [n, 0.4 * r]),
    rx: size * r,
    color: WHITE,
    surface: 'gloss',
    lift: 0.07 + dome * r * Math.min(1, tall) * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)),
    dome: 0.25,
    layer: o.layer,
  });
  out.push(glint(0.3, 0.36, 0.3));
  if (o.sparkle) out.push(glint(-0.32, -0.34, 0.15));
  return out;
}

/** A mirrored pair of bead eyes on a front-facing surface (both glints on the same side). */
function eyePair(at: V3, r: number, o: { tall?: number; color?: string; pupil?: string; sparkle?: boolean; layer?: string; splay?: number } = {}): PatchDef[] {
  const splay = o.splay ?? 0.18;
  return [...eyeAt(at, r, { ...o, normal: [splay, 0, 1] }), ...eyeAt([-at[0], at[1], at[2]], r, { ...o, normal: [-splay, 0, 1] })];
}

/** Closed rounded-rectangle path in the XY plane at depth z. */
function roundRect(cx: number, cy: number, hx: number, hy: number, r: number, z: number, perCorner = 3): V3[] {
  const pts: V3[] = [];
  const corners: [number, number, number][] = [
    [cx + hx - r, cy + hy - r, 0],
    [cx - hx + r, cy + hy - r, 90],
    [cx - hx + r, cy - hy + r, 180],
    [cx + hx - r, cy - hy + r, 270],
  ];
  corners.forEach(([ox, oy, start], c) => {
    for (let i = 0; i <= perCorner; i++) {
      const a = ((start + (i / perCorner) * 90) * Math.PI) / 180;
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r, z]);
    }
    // Extra points keep the catmull-rom spline straight along the edges.
    const [nx, ny] = corners[(c + 1) % 4]!;
    const a1 = (((start + 90) * Math.PI) / 180);
    const ex = ox + Math.cos(a1) * r, ey = oy + Math.sin(a1) * r;
    const fx = nx + Math.cos(a1) * r, fy = ny + Math.sin(a1) * r;
    for (const k of [0.33, 0.67]) pts.push([ex + (fx - ex) * k, ey + (fy - ey) * k, z]);
  });
  return pts;
}

/** Closed circle path in a plane given by its centre, right and up directions. */
function circle(c: V3, r: number, t: V3 = [1, 0, 0], b: V3 = [0, 1, 0], n = 10): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(add3(c, [t, Math.cos(a) * r], [b, Math.sin(a) * r]));
  }
  return pts;
}

/** Polyline with extra points near every corner so the stroke spline keeps straight runs and tight bends. */
function traceLine(pts: Path2, z: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
    const ks = i === 0 ? [0, 0.5, 0.85] : [0.15, 0.5, 0.85];
    for (const k of ks) out.push([ax + (bx - ax) * k, ay + (by - ay) * k, z]);
  }
  const last = pts[pts.length - 1]!;
  out.push([last[0], last[1], z]);
  return out;
}

/** Fabric tag sewn into a side seam. */
function sideTag(at: V3, color: string, accent: string, out: V3 = [0.85, -0.1, -0.5]): PatchDef {
  return { kind: 'tag', at, out, color, accent };
}

/** Small glossy LED / button. */
function led(at: V3, r: number, color: string, layer?: string): PatchDef {
  return { kind: 'disc', at, rx: r, color, surface: 'gloss', dome: 0.45, lift: 0.05, layer };
}

/**
 * Curved fan blade outline (local u = across, v = along the blade, root at v < 0). The blade
 * widens towards its tip and bows to one side like a swept rotor blade.
 */
function bladeOutline(length: number, width: number, sweep: number, n = 9): Path2 {
  const lead: Path2 = [];
  const trail: Path2 = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n; // 0 root .. 1 tip
    const v = (s - 0.5) * length;
    const bow = sweep * (s - 0.5) * (s - 0.5) * 4 - sweep * 0.5;
    const w = width * (0.42 + 0.58 * s) * Math.pow(Math.sin(Math.PI * Math.min(0.97, 0.06 + s * 0.94)), 0.45);
    lead.push([bow + w * 0.5, v]);
    trail.push([bow - w * 0.5, v]);
  }
  return [...lead, ...trail.reverse()];
}

/**
 * Felt fan rotor on a surface facing `n`: grey blades around a hub, as appliqué patches.
 * `t`/`b` are the right / up directions of that surface (front-facing: +X / +Y).
 */
function rotorPatches(o: {
  c: V3;
  n: V3;
  blades: number;
  hub: number;
  tip: number;
  width: number;
  sweep: number;
  color: string;
  phase?: number;
  layer?: string;
}): PatchDef[] {
  const { t, b } = tangents(o.n);
  const out: PatchDef[] = [];
  const length = o.tip - o.hub;
  const outline = bladeOutline(length, o.width, o.sweep);
  for (let i = 0; i < o.blades; i++) {
    const theta = (o.phase ?? 90) + (i / o.blades) * 360;
    const a = (theta * Math.PI) / 180;
    const radial = o.hub + length * 0.5;
    const at = add3(o.c, [t, Math.cos(a) * radial], [b, Math.sin(a) * radial], [o.n, 0.4]);
    out.push({ kind: 'poly', at, outline, rot: theta - 90, color: o.color, surface: 'felt', dome: 0.06, lift: 0.07, layer: o.layer });
  }
  return out;
}

/* ===================================================================== chief */

const SKIN = '#f3c7a0';
const SKIN_SHADE = '#e9b591';
const HAIR = '#9a9a9e';
const HAIR_LIGHT = '#d2d2d5';
const HAIR_DARK = '#76767b';
const JACKET = '#18181b';
const TEE = '#111113';
const DENIM = '#262c3a';
const DENIM_SEAM = '#6f7d99';
const SHOE = '#19191b';
const METAL = '#c9cbd0';
const CHIEF_EYE = '#4a2c1c';

const CH_HEAD_C: V3 = [0, 17.3, 0.2];
const CH_HEAD_R: V3 = [4.9, 5.0, 4.6];

/**
 * Hair: a full cap over the head whose hairline is high on the forehead, just above the ears at
 * the sides and low at the nape, with a soft wave along the hairline.
 */
const hairCap: DistFn = (() => {
  const cap = ellipsoid([0, 17.95, -0.45], [5.45, 5.45, 5.2]);
  return (x: number, y: number, z: number) => {
    const c = (z + 0.3) / Math.max(1e-3, Math.hypot(x, z + 0.3)); // cos of the angle from the front
    const wave = 0.22 * Math.sin(Math.atan2(x, z + 0.3) * 5);
    const line = (c >= 0 ? 17.6 + 2.9 * Math.pow(c, 1.4) : 17.6 + 2.6 * c) + wave;
    return smax(cap(x, y, z), (line - y) * 0.8, 0.5);
  };
})();

/** Leather jacket body: open at the front, hem above the hips. */
const jacketBody: DistFn = (() => {
  const e = ellipsoid([0, 8.65, -0.5], [4.2, 4.4, 3.6]);
  return (x: number, y: number, z: number) => smax(e(x, y, z), 5.0 - y, 0.6);
})();

/** Moves a whole design (used to put the centre of a toy's base on the origin). */
function shifted(d: PlushDesign, off: V3): PlushDesign {
  const mv = (p: V3): V3 => [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  const fnMove = (fn: DistFn): DistFn => (x, y, z) => fn(x - off[0], y - off[1], z - off[2]);
  return {
    ...d,
    layers: d.layers.map((l) => ({ ...l, parts: l.parts.map((p) => ({ ...p, fn: fnMove(p.fn), root: p.root ? mv(p.root) : undefined })) })),
    paints: d.paints?.map((p) => ({ ...p, fn: fnMove(p.fn) })),
    patches: d.patches?.map((p): PatchDef => (p.kind === 'stroke' ? { ...p, points: p.points.map(mv) } : { ...p, at: mv(p.at) })),
  };
}

function mouthOutline(hw: number, top: number, depth: number): Path2 {
  const pts: Path2 = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    pts.push([Math.cos(a) * hw, top - Math.sin(a) * depth]);
  }
  pts.push([-hw * 0.5, top], [0, top], [hw * 0.5, top]);
  return pts;
}

/** The doll sits with its legs straight out; the design is moved back so the base is centred. */
export const chief: PlushDesign = shifted({
  slug: 'chief',
  theme: 'gpu',
  name: { en: 'Keynote Chief', zh: '主讲人', ja: 'キーノートチーフ' },
  kind: {
    en: 'keynote presenter doll in a black leather jacket',
    zh: '穿黑色皮夹克的主讲人玩偶',
    ja: '黒いレザージャケットのキーノート司会者人形',
  },
  status: 'original',
  note: 'Original character: a generic keynote presenter, not a likeness of any real person.',
  height: 23,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.2,
      parts: [
        ell('seat', [0, 2.8, -0.9], [4.4, 2.8, 3.6], DENIM, { collide: 'core', k: 1.6, group: 'body', piece: A }),
        ell('torso', [0, 8.5, -0.5], [3.75, 4.25, 3.15], TEE, { collide: 'core', k: 1.6, group: 'body', piece: A }),
        cyl('neck', [0, 12.7, -0.4], 1.5, 0.9, 0.4, SKIN, { k: 0.8, piece: B }),
        ell('head', CH_HEAD_C, CH_HEAD_R, SKIN, { collide: 'core', k: 1.2, piece: A }),
        ...pair(ell('ear', [4.7, 16.0, -0.1], [0.75, 1.15, 0.62], SKIN, { k: 0.5, piece: B, soft: 0.3 })),
        ...pair(cone('leg', [1.9, 2.2, 0.4], [3.3, 2.1, 6.6], 2.0, 1.8, DENIM, { collide: 'core', group: 'legs', k: 1.1, soft: 0.3, piece: B })),
        ...pair(ell('shoe', [3.6, 2.2, 8.2], [2.0, 2.2, 1.55], SHOE, { collide: 'core', group: 'legs', k: 0.7, soft: 0.25, piece: A, rot: [-10, 0, 0] })),
        ...pair(ball('hand', [6.15, 6.7, 1.9], 1.45, SKIN, { k: 0.4, soft: 0.5, piece: B })),
      ],
    },
    {
      name: 'hair',
      surface: 'fur',
      seams: false,
      parts: [
        part('hair', hairCap, HAIR, { collide: 'core', group: 'head', k: 0 }),
        // Swept-back pompadour with a side part, and full sides above the ears.
        ell('pompadour', [0.3, 21.75, 1.2], [4.5, 1.9, 3.4], HAIR, { collide: 'core', group: 'head', k: 1.4, rot: [-14, 0, -4] }),
        ell('wave', [-1.9, 22.2, 2.3], [2.5, 1.45, 2.1], HAIR, { collide: 'core', group: 'head', k: 1.0, rot: [-20, 0, 10] }),
        ...pair(ell('sideHair', [4.55, 19.5, -0.8], [1.45, 2.2, 3.7], HAIR, { collide: 'core', group: 'head', k: 1.1 })),
        ell('nape', [0, 16.4, -4.1], [3.9, 2.2, 1.5], HAIR, { collide: 'core', group: 'head', k: 1.4 }),
        // Locks sweeping back over the temples.
        ...pair(ell('temple', [4.3, 18.6, 1.9], [1.0, 1.5, 2.2], HAIR, { collide: 'core', group: 'head', k: 0.9, rot: [-25, 0, 8] })),
      ],
    },
    {
      name: 'jacket',
      surface: 'satin',
      parts: [
        part('jacket', jacketBody, JACKET, { collide: 'core', group: 'body', k: 0, piece: A }),
        part('opening', roundCone([0.2, 13.4, 3.55], [0.5, 4.4, 3.2], 1.55, 0.7), JACKET, { subtract: true, k: 0.35 }),
        ring('collar', [0, 12.75, -0.45], 2.2, 0.7, JACKET, { k: 0.4, piece: B, rot: [-10, 0, 0] }),
        ...pair(ell('lapel', [1.8, 11.0, 2.7], [1.3, 2.2, 0.55], JACKET, { k: 0.45, piece: B, rot: [-14, 0, -20] })),
        ...pair(cone('sleeve', [3.6, 11.35, -0.4], [5.8, 8.0, 1.35], 1.72, 1.6, JACKET, { collide: 'appendage', soft: 0.45, k: 1.0, piece: B })),
      ],
    },
  ],
  patches: [
    // Face: brown eyes behind black rectangular glasses, an open smile, rosy cheeks.
    ...eyeAt([1.85, 16.3, 4.75], 0.6, { normal: [0.32, 0, 1], tall: 1.12, color: CHIEF_EYE, pupil: INK }),
    ...eyeAt([-1.85, 16.3, 4.75], 0.6, { normal: [-0.32, 0, 1], tall: 1.12, color: CHIEF_EYE, pupil: INK }),
    ...[1, -1].map((s): PatchDef => ({ kind: 'stroke', points: roundRect(s * 1.95, 16.35, 1.35, 0.95, 0.45, 5.0), width: 0.2, color: INK, surface: 'thread', closed: true, lift: 0.06 })),
    { kind: 'stroke', points: [[-0.62, 16.62, 5.0], [0, 16.78, 5.1], [0.62, 16.62, 5.0]], width: 0.18, color: INK, surface: 'thread', lift: 0.06 },
    { kind: 'stroke', points: [[3.28, 16.55, 3.8], [3.9, 16.6, 2.9], [4.4, 16.55, 1.8]], width: 0.18, color: INK, surface: 'thread', mirror: true, lift: 0.05 },
    { kind: 'stroke', points: [[0.85, 17.75, 4.85], [1.85, 17.95, 4.7], [2.85, 17.8, 4.3]], width: 0.3, color: '#5f5f63', surface: 'thread', mirror: true, taper: true },
    { kind: 'disc', at: [0, 15.45, 4.95], rx: 0.3, ry: 0.22, color: SKIN_SHADE, surface: 'felt', dome: 0.3, lift: 0.04 },
    { kind: 'poly', at: [0, 14.55, 4.85], outline: mouthOutline(1.1, 0.3, 0.95), color: '#7a2f36', surface: 'felt', lift: 0.04 },
    { kind: 'poly', at: [0, 14.75, 4.85], outline: [[-0.88, 0.1], [0.88, 0.1], [0.74, -0.14], [-0.74, -0.14]], color: WHITE, surface: 'felt', lift: 0.08 },
    { kind: 'disc', at: [0, 14.08, 4.8], rx: 0.5, ry: 0.22, color: '#f08f9a', surface: 'felt', lift: 0.08 },
    blush([3.2, 14.75, 3.75], 0.95, 0.6, BLUSH_PINK),
    // Swept-back silver strands, light and dark.
    ...[-3.4, -2.2, -1.0, 0.2, 1.4, 2.6, 3.6].map((x, i): PatchDef => ({
      kind: 'stroke',
      layer: 'hair',
      points: [[x * 0.85, 21.2, 4.0], [x, 23.2, 2.0], [x * 1.05, 23.6, -0.6], [x * 1.12, 22.6, -3.4], [x * 1.1, 20.6, -4.9]],
      width: i % 2 ? 0.22 : 0.3,
      color: i % 2 ? HAIR_DARK : HAIR_LIGHT,
      surface: 'thread',
      taper: true,
    })),
    ...[1, -1].map((s): PatchDef => ({
      kind: 'stroke',
      layer: 'hair',
      points: [[s * 4.3, 20.9, 2.6], [s * 5.4, 20.6, 0.2], [s * 5.5, 19.6, -2.6], [s * 4.6, 18.4, -4.4]],
      width: 0.26,
      color: HAIR_LIGHT,
      surface: 'thread',
      taper: true,
    })),
    // Jacket: zipper along the opening, pocket zip, snaps, stitched cuffs and hem.
    { kind: 'stroke', layer: 'jacket', points: [[1.75, 12.0, 3.0], [1.95, 10.0, 3.4], [2.0, 8.0, 3.5], [1.85, 6.0, 3.3], [1.7, 5.3, 3.1]], width: 0.2, color: METAL, surface: 'metal' },
    { kind: 'poly', layer: 'jacket', at: [1.95, 5.75, 3.3], outline: [[-0.22, 0.32], [0.22, 0.32], [0.26, -0.5], [-0.26, -0.5]], color: METAL, surface: 'metal', lift: 0.12 },
    { kind: 'stroke', layer: 'jacket', points: [[2.55, 8.7, 3.2], [3.15, 9.3, 2.8], [3.7, 9.9, 2.2]], width: 0.17, color: METAL, surface: 'metal' },
    { kind: 'disc', layer: 'jacket', at: [2.75, 10.2, 3.0], rx: 0.22, color: METAL, surface: 'metal', dome: 0.4, lift: 0.08, mirror: true },
    { kind: 'disc', layer: 'jacket', at: [1.6, 12.35, 2.7], rx: 0.2, color: METAL, surface: 'metal', dome: 0.4, lift: 0.08, mirror: true },
    { kind: 'stroke', layer: 'jacket', points: [[-4.0, 5.6, 1.6], [-2.5, 5.45, 3.0], [-0.7, 5.4, 3.4]], width: 0.1, color: '#56565b', surface: 'thread' },
    { kind: 'stroke', layer: 'jacket', points: [[4.0, 5.6, 1.6], [2.9, 5.45, 2.8], [2.0, 5.4, 3.2]], width: 0.1, color: '#56565b', surface: 'thread' },
    { kind: 'stroke', layer: 'jacket', points: circle([5.8, 8.0, 1.35], 1.5, [0.6, 0.0, -0.8], [0.35, 0.85, 0.4], 12), width: 0.1, color: '#56565b', surface: 'thread', closed: true, mirror: true },
    // Jeans seams and shoelaces.
    { kind: 'stroke', points: [[3.6, 3.5, 0.8], [4.4, 3.4, 3.6], [5.0, 3.1, 6.4]], width: 0.12, color: DENIM_SEAM, surface: 'thread', mirror: true },
    ...[2.7, 3.3, 3.9].map((y): PatchDef => ({ kind: 'stroke', points: [[2.9, y, 9.6], [3.6, y + 0.1, 9.75], [4.3, y, 9.6]], width: 0.16, color: '#45454a', surface: 'thread', mirror: true })),
    sideTag([4.25, 3.4, -1.2], CREAM_TAG, LIME),
  ],
  deform: { sag: 0.5, sway: 0.55, squash: 0.55 },
}, [0, 0, -2.6]);

/* ====================================================================== card */

/**
 * Presentation yaw of the card (degrees). 0 = fans facing the glass, which is how the concept
 * photo reads and how the generated textured model is oriented; the helpers below keep the
 * card authorable in its own frame should it ever be posed at an angle.
 */
const CARD_YAW = 0;
const CARD_M = eulerMatrix(0, CARD_YAW, 0);
/** Card-local point → world. */
const cw = (p: V3): V3 => applyMatrix(CARD_M, p);
/** Card-local shape → world. */
const cf = (fn: DistFn): DistFn => rotated(fn, [0, 0, 0], [0, CARD_YAW, 0]);
const CARD_HALF: V3 = [9.1, 5.8, 3.3];
const CARD_C: V3 = [0, 7.4, 0];
const CARD_FRONT = CARD_C[2] + CARD_HALF[2];
const CARD_BACK = CARD_C[2] - CARD_HALF[2];
const CARD_FRONT_N = cw([0, 0, 1]);
/** Fan centres (card-local x) and radius. The narrow panel left of the fans carries the face. */
const CARD_FANS = [-2.45, 5.05];
const CARD_FAN_Y = 7.7;
const CARD_FAN_R = 3.7;

function cardStroke(points: V3[], width: number, color: string, o: { closed?: boolean; surface?: 'felt' | 'thread'; layer?: string; lift?: number } = {}): PatchDef {
  return { kind: 'stroke', points: points.map(cw), width, color, surface: o.surface ?? 'felt', closed: o.closed, layer: o.layer, lift: o.lift };
}

function cardFan(cx: number, phase: number): PatchDef[] {
  const c = cw([cx, CARD_FAN_Y, CARD_FRONT]);
  const t = cw([1, 0, 0]);
  const b: V3 = [0, 1, 0];
  return [
    { kind: 'stroke', points: circle(c, CARD_FAN_R - 0.2, t, b, 14), width: 0.55, color: GREY_FELT, surface: 'felt', closed: true, lift: 0.06 },
    ...rotorPatches({ c, n: CARD_FRONT_N, blades: 9, hub: 0.95, tip: CARD_FAN_R - 0.55, width: 1.25, sweep: 0.55, color: GREY_FELT, phase }),
    { kind: 'disc', at: add3(c, [CARD_FRONT_N, 0.3]), rx: 1.05, color: GREY_DARK, surface: 'felt', dome: 0.25, lift: 0.12 },
  ];
}

const cardFanWells: DistFn = cf((x, y, z) => Math.max(Math.min(...CARD_FANS.map((fx) => Math.hypot(x - fx, y - CARD_FAN_Y) - CARD_FAN_R)), CARD_FRONT - 1.5 - z));

/** Lime shroud lines along the top and bottom of a long face (front or back), with a step near the left. */
function cardShroudLines(z: number): PatchDef[] {
  return [
    cardStroke([[-6.0, 12.0, z], [-1.6, 12.0, z], [-0.8, 12.0, z], [0.1, 12.6, z], [1.0, 12.6, z], [8.1, 12.6, z]], 0.5, LIME_FELT),
    cardStroke([[-6.0, 3.4, z], [-5.2, 3.4, z], [-4.5, 2.85, z], [-3.6, 2.85, z], [3.0, 2.85, z], [8.1, 2.85, z]], 0.5, LIME_FELT),
  ];
}

export const card: PlushDesign = {
  slug: 'card',
  theme: 'gpu',
  name: { en: 'Twin-Fan', zh: '双风扇', ja: 'ツインファン' },
  kind: { en: 'graphics-card plush with two felt fans', zh: '带两个毛毡风扇的显卡毛绒公仔', ja: 'フェルトのファンが2つあるグラフィックカードのぬいぐるみ' },
  status: 'original',
  note: 'Original character (no real product or logo).',
  height: 13.5,
  mass: 0.25,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 0.8,
      parts: [
        part('body', cf(roundBox(CARD_C, CARD_HALF, 1.6)), BLACK, { collide: 'core', k: 0, piece: A }),
        part('pcie', cf(roundBox([-0.6, 1.35, CARD_FRONT - 1.4], [3.25, 0.65, 0.7], 0.3)), BLACK_DEEP, { k: 0.3, piece: B }),
        ...[-6.4, 6.4].map((x, i) => part(`foot${i ? 'R' : 'L'}`, cf(ellipsoid([x, 1.25, 0], [1.55, 1.35, 2.9])), LIME_FELT, { collide: 'core', group: 'body', k: 0.6, piece: B, soft: 0.25 })),
      ],
    },
    {
      // Grey felt I/O bracket on the left end, with a bent tab on top.
      name: 'bracket',
      surface: 'felt',
      seams: false,
      parts: [
        part('bracket', cf(roundBox([-10.05, 7.7, -0.3], [1.0, 5.85, 0.42], 0.32)), GREY_FELT, { collide: 'appendage', group: 'bracket', k: 0, soft: 0.2 }),
        part('bracketTab', cf(roundBox([-9.6, 13.45, -0.3], [1.5, 0.5, 0.44], 0.3)), GREY_FELT, { collide: 'appendage', group: 'bracket', k: 0.3, soft: 0.2 }),
      ],
    },
  ],
  paints: [{ name: 'fanWells', channel: 0, fn: cardFanWells, color: '#2b2c30', stitch: '#7c7e83' }],
  patches: [
    // Face on the narrow panel left of the fans.
    ...eyeAt(cw([-8.3, 8.25, CARD_FRONT]), 0.45, { normal: CARD_FRONT_N }),
    ...eyeAt(cw([-6.95, 8.25, CARD_FRONT]), 0.45, { normal: CARD_FRONT_N }),
    cardStroke([[-8.15, 7.45, CARD_FRONT], [-7.95, 7.12, CARD_FRONT], [-7.62, 7.0, CARD_FRONT], [-7.3, 7.12, CARD_FRONT], [-7.1, 7.45, CARD_FRONT]], 0.17, LIME, { surface: 'thread' }),
    // Twin fans and the lime shroud lines above and below them (front and back).
    ...cardFan(CARD_FANS[0]!, 90),
    ...cardFan(CARD_FANS[1]!, 70),
    ...cardShroudLines(CARD_FRONT),
    ...cardShroudLines(CARD_BACK),
    // Three lime stripes across the top.
    ...[-5.4, -3.6, -1.8].map((x) => cardStroke([[x + 0.45, 13.2, CARD_FRONT - 0.9], [x + 0.2, 13.25, 0], [x, 13.2, CARD_BACK + 0.9]], 0.8, LIME_FELT)),
    // Lime contacts on the edge connector.
    ...[-3.25, -2.5, -1.75, -1.0, -0.25, 0.5, 1.25, 2.0].map(
      (x): PatchDef => ({ kind: 'poly', at: cw([x, 1.3, CARD_FRONT - 0.7]), outline: [[-0.28, -0.4], [0.28, -0.4], [0.28, 0.4], [-0.28, 0.4]], color: LIME_SOFT, surface: 'felt', lift: 0.05 }),
    ),
    // Port slots in the bracket.
    ...[3.6, 5.6, 7.6, 9.6, 11.6].map(
      (y): PatchDef => ({ kind: 'poly', layer: 'bracket', at: cw([-10.05, y, 0.15]), outline: [[-0.4, -0.62], [0.4, -0.62], [0.4, 0.62], [-0.4, 0.62]], color: '#2d2e31', surface: 'felt', lift: 0.04 }),
    ),
    { kind: 'tag', at: cw([CARD_HALF[0], 7.0, 0.4]), out: cw([1, -0.15, 0.2]), color: LIME_SOFT, accent: LIME },
  ],
  deform: { sag: 0.35, sway: 0.4, squash: 0.45 },
};

/* ====================================================================== chip */

const CHIP_GREEN = '#0d3f1a';
const CHIP_GOLD = '#f2b228';
const TRACE_GOLD = '#ecbd2c';
const SILVER = '#9fa5ae';
const CHIP_C: V3 = [0, 9.9, 0];
// The body is about 1 cm deeper than the generated model (6.1 cm): thinner versions slipped out
// of centred grabs more often in the headless probe (weak support), so grip wins here.
const CHIP_HALF: V3 = [7.6, 7.6, 3.2];
const PLATE_C: V3 = [0, 10.45, CHIP_HALF[2]];
const PLATE_HALF: [number, number] = [4.1, 4.0];
const PIN_OFFSETS = [-3.9, -1.3, 1.3, 3.9];

function chipPins(): PartDef[] {
  const out: PartDef[] = [];
  const top = CHIP_C[1] + CHIP_HALF[1];
  const bottom = CHIP_C[1] - CHIP_HALF[1];
  PIN_OFFSETS.forEach((o, i) => {
    out.push(box(`pinTop${i}`, [o, top + 0.85, 0], [0.7, 1.15, 0.8], 0.45, CHIP_GOLD, { collide: 'core', group: 'body', k: 0.35, soft: 0.3 }));
    // The bottom row is deeper front to back: the pins are what the toy stands on.
    out.push(box(`pinBottom${i}`, [o, bottom - 0.8, 0], [0.75, 1.15, 2.3], 0.5, CHIP_GOLD, { collide: 'core', group: 'body', k: 0.35, soft: 0.2 }));
    out.push(box(`pinRight${i}`, [CHIP_HALF[0] + 0.85, CHIP_C[1] + o, 0], [1.15, 0.7, 0.8], 0.45, CHIP_GOLD, { collide: 'core', group: 'body', k: 0.35, soft: 0.3 }));
    out.push(box(`pinLeft${i}`, [-CHIP_HALF[0] - 0.85, CHIP_C[1] + o, 0], [1.15, 0.7, 0.8], 0.45, CHIP_GOLD, { collide: 'core', group: 'body', k: 0.35, soft: 0.3 }));
  });
  return out;
}

/** Embroidered circuit traces from the edges of the face plate to the edge of the chip, most ending in a ring. */
const CHIP_TRACES: { path: Path2; ring?: boolean }[] = [
  { path: [[-2.4, 14.45], [-2.4, 16.1]], ring: true },
  { path: [[-0.8, 14.45], [-0.8, 16.9]] },
  { path: [[0.8, 14.45], [0.8, 15.4], [2.0, 16.3]], ring: true },
  { path: [[2.4, 14.45], [2.4, 14.95], [4.9, 14.95], [5.6, 15.65]], ring: true },
  { path: [[-4.1, 13.5], [-5.3, 13.5], [-6.0, 14.2]], ring: true },
  { path: [[-4.1, 11.6], [-6.9, 11.6]] },
  { path: [[-4.1, 9.7], [-5.2, 9.7], [-5.9, 9.0]], ring: true },
  { path: [[-4.1, 7.6], [-6.1, 7.6]], ring: true },
  { path: [[4.1, 13.1], [5.5, 13.1], [6.2, 13.8]], ring: true },
  { path: [[4.1, 11.1], [6.9, 11.1]] },
  { path: [[4.1, 9.1], [5.4, 9.1], [6.1, 8.4]], ring: true },
  { path: [[4.1, 7.3], [4.9, 7.3], [4.9, 5.1], [5.6, 4.4]], ring: true },
  { path: [[-2.6, 6.45], [-2.6, 4.9], [-3.6, 3.9]], ring: true },
  { path: [[-1.0, 6.45], [-1.0, 3.1]] },
  { path: [[0.9, 6.45], [0.9, 4.3]], ring: true },
  { path: [[2.6, 6.45], [2.6, 5.0], [3.6, 4.0]], ring: true },
];

function chipTraces(): PatchDef[] {
  const out: PatchDef[] = [];
  for (const tr of CHIP_TRACES) {
    out.push({ kind: 'stroke', points: traceLine(tr.path, CHIP_HALF[2] + 0.1), width: 0.15, color: TRACE_GOLD, surface: 'thread' });
    if (tr.ring) {
      const [lx, ly] = tr.path[tr.path.length - 1]!;
      const [px, py] = tr.path[tr.path.length - 2]!;
      const d = Math.hypot(lx - px, ly - py) || 1;
      const c: V3 = [lx + ((lx - px) / d) * 0.36, ly + ((ly - py) / d) * 0.36, CHIP_HALF[2] + 0.1];
      out.push({ kind: 'stroke', points: circle(c, 0.33, [1, 0, 0], [0, 1, 0], 8), width: 0.13, color: TRACE_GOLD, surface: 'thread', closed: true });
    }
  }
  return out;
}

export const chip: PlushDesign = {
  slug: 'chip',
  theme: 'gpu',
  name: { en: 'Chippy', zh: '小芯片', ja: 'チッピー' },
  kind: { en: 'smiling processor chip with golden pins', zh: '长着金色引脚的笑脸芯片', ja: '金色のピンがついたにっこりチップ' },
  status: 'original',
  note: 'Original character.',
  height: 20,
  mass: 0.22,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      fur: 0.55,
      flatBase: 0.6,
      parts: [box('body', CHIP_C, CHIP_HALF, 2.4, CHIP_GREEN, { collide: 'core', k: 0, piece: A })],
    },
    {
      name: 'pins',
      surface: 'felt',
      flatBase: 0.5,
      parts: chipPins(),
    },
    {
      name: 'plate',
      surface: 'satin',
      seams: false,
      parts: [box('plate', PLATE_C, [PLATE_HALF[0], PLATE_HALF[1], 0.5], 0.48, SILVER, { k: 0 })],
    },
  ],
  patches: [
    { kind: 'stroke', layer: 'plate', points: roundRect(PLATE_C[0], PLATE_C[1], PLATE_HALF[0] - 0.32, PLATE_HALF[1] - 0.32, 0.55, PLATE_C[2] + 0.6), width: 0.11, color: '#9ca2ab', surface: 'thread', closed: true },
    ...eyeAt([1.7, 11.1, PLATE_C[2] + 0.55], 0.5, { layer: 'plate' }),
    ...eyeAt([-1.7, 11.1, PLATE_C[2] + 0.55], 0.5, { layer: 'plate' }),
    smile([0, 10.1, PLATE_C[2] + 0.55], 0.95, 0.28, 0.17, '#3a2522', 'plate'),
    blush([2.65, 9.85, PLATE_C[2] + 0.55], 0.72, 0.5, '#f4a3ae', 'plate'),
    { kind: 'poly', layer: 'plate', at: [1.55, 8.05, PLATE_C[2] + 0.55], outline: heartOutline(0.85), color: LIME_FELT, surface: 'felt', lift: 0.05, dome: 0.12 },
    ...chipTraces(),
    sideTag([7.55, 5.2, 0.6], CREAM_TAG, CREAM_TAG, [0.9, -0.15, 0.1]),
  ],
  deform: { sag: 0.4, sway: 0.4, squash: 0.6 },
};

/* ======================================================================= fan */

const FAN_C: V3 = [0, 10.2, 0];
const FAN_R = 8.0;
/** Half the frame's depth: the generated model is about 5.4 cm front to back. */
const FAN_DEPTH = 2.25;
const FAN_HUB = '#8fd136';

/** Thick round frame with a recessed front well and four rounded mounting corners. */
const fanFrame: DistFn = (() => {
  const disc = roundCylinder(FAN_C, FAN_R, FAN_DEPTH, 1.6, [90, 0, 0]);
  const corners = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return roundCylinder([FAN_C[0] + Math.cos(a) * 6.95, FAN_C[1] + Math.sin(a) * 6.95, 0], 1.7, FAN_DEPTH * 0.92, 1.2, [90, 0, 0]);
  });
  const well = roundCylinder([FAN_C[0], FAN_C[1], FAN_DEPTH + 0.45], 6.35, 1.45, 0.6, [90, 0, 0]);
  return (x: number, y: number, z: number) => {
    let d = disc(x, y, z);
    for (const c of corners) d = Math.min(d, c(x, y, z));
    return smax(d, -well(x, y, z), 0.55);
  };
})();

export const fan: PlushDesign = {
  slug: 'fan',
  theme: 'gpu',
  name: { en: 'Breezy', zh: '小风扇', ja: 'ブリージー' },
  kind: { en: 'cooling fan with a lime-green smiling hub', zh: '青柠绿笑脸轴心的散热风扇', ja: 'ライムグリーンのにこにこハブの冷却ファン' },
  status: 'original',
  note: 'Original character.',
  height: 20,
  mass: 0.23,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 0.9,
      parts: [
        part('frame', fanFrame, BLACK, { collide: 'core', k: 0, piece: A }),
        ...pair(ell('foot', [3.05, 1.2, 0.1], [1.7, 1.5, 2.85], BLACK, { collide: 'core', group: 'body', k: 0.9, soft: 0.25, piece: B })),
      ],
    },
    {
      name: 'hub',
      surface: 'shortfur',
      seams: false,
      parts: [cyl('hub', [FAN_C[0], FAN_C[1], FAN_DEPTH - 0.45], 2.85, 0.85, 0.55, FAN_HUB, { k: 0, rot: [90, 0, 0] })],
    },
  ],
  paints: [{ name: 'backLabel', channel: 0, fn: (x, y, z) => Math.max(Math.hypot(x - FAN_C[0], y - FAN_C[1]) - 2.6, z + FAN_DEPTH - 0.75), color: LIME, stitch: '#4f7f05' }],
  patches: [
    ...rotorPatches({ c: [FAN_C[0], FAN_C[1], FAN_DEPTH - 1.5], n: [0, 0, 1], blades: 7, hub: 2.4, tip: 6.3, width: 3.0, sweep: 1.25, color: GREY_FELT, phase: 100 }),
    { kind: 'stroke', layer: 'hub', points: circle([FAN_C[0], FAN_C[1], FAN_DEPTH + 0.4], 2.55, [1, 0, 0], [0, 1, 0], 14), width: 0.1, color: '#5e9a12', surface: 'thread', closed: true },
    ...eyeAt([0.95, 10.85, FAN_DEPTH + 0.45], 0.36, { layer: 'hub' }),
    ...eyeAt([-0.95, 10.85, FAN_DEPTH + 0.45], 0.36, { layer: 'hub' }),
    smile([0, 10.0, FAN_DEPTH + 0.45], 0.62, 0.22, 0.13, INK, 'hub'),
    blush([1.65, 9.95, FAN_DEPTH + 0.4], 0.5, 0.36, BLUSH_PINK, 'hub'),
    // Grey screw-hole rings on the mounting corners.
    ...[45, 135, 225, 315].flatMap((deg): PatchDef[] => {
      const a = (deg * Math.PI) / 180;
      const c: V3 = [FAN_C[0] + Math.cos(a) * 7.15, FAN_C[1] + Math.sin(a) * 7.15, FAN_DEPTH];
      return [
        { kind: 'stroke', points: circle(c, 0.55, [1, 0, 0], [0, 1, 0], 10), width: 0.26, color: GREY_FELT, surface: 'felt', closed: true, lift: 0.05 },
        { kind: 'disc', at: c, rx: 0.3, color: '#2a2b2e', surface: 'felt', lift: 0.04 },
      ];
    }),
    { kind: 'tag', at: [7.7, 8.2, 0.6], out: [0.95, -0.2, 0.1], color: LIME_SOFT, accent: LIME },
  ],
  deform: { sag: 0.35, sway: 0.45, squash: 0.5 },
};

/* ====================================================================== rack */

const RACK_C: V3 = [0, 11.0, 0];
const RACK_HALF: V3 = [5.0, 8.7, 4.8];
const RACK_FRONT = RACK_C[2] + RACK_HALF[2];
const BAY_YS = [14.0, 11.65, 9.3, 6.95, 4.6];
const BAY_HALF: [number, number] = [3.85, 0.88];
const LED_GREEN = '#8ee32c';

function rackBays(): PatchDef[] {
  const out: PatchDef[] = [];
  for (const y of BAY_YS) {
    for (let i = 0; i < 10; i++) {
      const x = -3.15 + i * 0.4;
      out.push({ kind: 'stroke', points: [[x, y + 0.5, RACK_FRONT], [x, y - 0.5, RACK_FRONT]], width: 0.17, color: '#17181a', surface: 'thread', lift: 0.03 });
    }
    for (const x of [1.75, 2.45, 3.15]) out.push(led([x, y, RACK_FRONT], 0.2, LED_GREEN));
  }
  return out;
}

export const rack: PlushDesign = {
  slug: 'rack',
  theme: 'gpu',
  name: { en: 'Rack Buddy', zh: '机柜宝宝', ja: 'ラックバディ' },
  kind: { en: 'server rack with blinking drive bays', zh: '带闪烁硬盘位的服务器机柜', ja: 'ランプが光るドライブベイのサーバーラック' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.26,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      fur: 0.6,
      flatBase: 1.0,
      parts: [
        box('body', RACK_C, RACK_HALF, 1.9, BLACK, { collide: 'core', k: 0, piece: A }),
        ...pair(ell('foot', [2.65, 1.45, 0.2], [1.75, 1.6, 3.2], BLACK, { collide: 'core', group: 'body', k: 0.8, soft: 0.25, piece: B })),
        ...pair(cone('arm', [4.9, 11.7, 0.3], [6.45, 9.9, 0.8], 1.3, 1.45, BLACK, { collide: 'appendage', soft: 0.55, k: 0.7, piece: B })),
      ],
    },
  ],
  paints: [
    {
      name: 'bays',
      channel: 0,
      fn: (x, y, z) => {
        let d = Infinity;
        for (const by of BAY_YS) {
          const qx = Math.abs(x) - (BAY_HALF[0] - 0.3), qy = Math.abs(y - by) - (BAY_HALF[1] - 0.3);
          d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.3);
        }
        return Math.max(d, 2.5 - z);
      },
      color: '#6d7075',
      stitch: '#9b9ea4',
    },
  ],
  patches: [
    ...eyePair([1.9, 16.95, RACK_FRONT], 0.52, { splay: 0 }),
    smile([0, 16.0, RACK_FRONT], 1.0, 0.32, 0.2, '#f6f6f2'),
    blush([3.25, 16.0, RACK_FRONT], 0.82, 0.58, BLUSH_PINK),
    ...rackBays(),
    // Rear vents.
    ...[15.5, 14.6, 13.7, 12.8].map((y): PatchDef => ({ kind: 'stroke', points: [[-2.8, y, -RACK_HALF[2]], [0, y, -RACK_HALF[2]], [2.8, y, -RACK_HALF[2]]], width: 0.2, color: '#3a3c40', surface: 'thread' })),
    led([-3.2, 5.0, -RACK_HALF[2]], 0.22, LED_GREEN),
    led([-3.2, 5.9, -RACK_HALF[2]], 0.22, LED_GREEN),
    sideTag([5.0, 5.2, 0.6], CREAM_TAG, CREAM_TAG, [0.9, -0.15, 0.1]),
  ],
  deform: { sag: 0.35, sway: 0.55, squash: 0.5 },
};

/* ======================================================================= bot */

const BOT_WHITE = '#f1f1ee';
const BOT_BLACK = '#1f1f22';
const VISOR = '#a6df2f';
const BOT_HEAD_C: V3 = [0, 14.4, 0.2];
const BOT_HEAD_R: V3 = [5.3, 4.95, 4.85];
const botHead = ellipsoid(BOT_HEAD_C, BOT_HEAD_R);

/** Satin visor: a thin lens over the front of the head, shaped as a rounded rectangle. */
const visorShell: DistFn = (() => {
  const shell = ellipsoid(BOT_HEAD_C, [BOT_HEAD_R[0] + 0.32, BOT_HEAD_R[1] + 0.32, BOT_HEAD_R[2] + 0.32]);
  const rect = (x: number, y: number) => {
    const qx = Math.abs(x) - (4.2 - 1.5), qy = Math.abs(y - 14.35) - (2.1 - 1.5);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 1.5;
  };
  return (x: number, y: number, z: number) => smax(smax(shell(x, y, z), rect(x, y), 0.35), 1.0 - z, 0.3);
})();

const ARM_A: V3 = [4.05, 8.7, 0.3];
const ARM_B: V3 = [6.05, 6.55, 1.6];

/** Black band around the upper arm. */
const armBand: DistFn = (() => {
  const ax = ARM_B[0] - ARM_A[0], ay = ARM_B[1] - ARM_A[1], az = ARM_B[2] - ARM_A[2];
  const l = Math.hypot(ax, ay, az);
  const ux = ax / l, uy = ay / l, uz = az / l;
  const c: V3 = [ARM_A[0] + ax * 0.42, ARM_A[1] + ay * 0.42, ARM_A[2] + az * 0.42];
  return (x: number, y: number, z: number) => {
    const px = Math.abs(x) - c[0], py = y - c[1], pz = z - c[2];
    const along = px * ux + py * uy + pz * uz;
    const radial = Math.hypot(px - along * ux, py - along * uy, pz - along * uz);
    return Math.max(Math.abs(along) - 0.5, radial - 2.4);
  };
})();

/**
 * Black round foot pads: the whole front of each leg end. The sole disc alone sits inside the
 * rounded end of the leg, so without this paint the feet read as white with a grey rim.
 */
const footPads: DistFn = bothSides((x, y, z) => Math.max(7.3 - z, Math.hypot(x - 2.7, y - 2.4) - 2.6));

/** Sitting robot; moved back so the base (seat to soles) is centred. */
export const bot: PlushDesign = shifted({
  slug: 'bot',
  theme: 'gpu',
  name: { en: 'Tensor Bot', zh: '张量机器人', ja: 'テンソルボット' },
  kind: { en: 'happy AI robot with a glowing lime visor', zh: '戴青柠绿发光面罩的快乐 AI 机器人', ja: 'ライムに光るバイザーのごきげん AI ロボット' },
  status: 'original',
  note: 'Original character.',
  height: 22.5,
  mass: 0.25,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.2,
      parts: [
        ell('body', [0, 6.6, 0], [4.6, 4.1, 4.0], BOT_WHITE, { collide: 'core', k: 1.6, piece: A }),
        ell('seat', [0, 2.6, -0.2], [4.3, 2.6, 3.9], BOT_WHITE, { collide: 'core', group: 'body', k: 1.6, piece: A }),
        ell('head', BOT_HEAD_C, BOT_HEAD_R, BOT_WHITE, { collide: 'core', k: 1.0, piece: B }),
        ...pair(cyl('earPad', [5.45, 14.3, 0.15], 2.0, 0.75, 0.55, BOT_BLACK, { rot: [0, 0, 90], k: 0.6, piece: A, group: 'head', collide: 'core' })),
        pipe('antenna', [[0, 18.9, 0.1], [0, 20.1, 0.05], [0.1, 20.9, 0]], [0.55, 0.5, 0.48], BOT_BLACK, { soft: 0.85, k: 0.5, collide: 'appendage', piece: A }),
        ball('pom', [0.1, 21.85, 0], 1.25, LIME_FELT, { soft: 0.9, k: 0.35, root: [0, 18.9, 0.1], reach: 4.2, collide: 'appendage', group: 'antenna', piece: B }),
        ...pair(cone('arm', ARM_A, ARM_B, 1.55, 1.75, BOT_WHITE, { soft: 0.5, k: 1.0, collide: 'appendage', piece: B })),
        ...pair(cone('leg', [2.25, 2.45, 0.8], [2.7, 2.4, 6.6], 2.15, 2.1, BOT_WHITE, { soft: 0.3, k: 1.1, collide: 'core', group: 'legs', piece: B })),
        ...pair(cyl('sole', [2.75, 2.45, 7.85], 2.05, 0.5, 0.4, BOT_BLACK, { rot: [90, 0, 0], k: 0.5, collide: 'core', group: 'legs', piece: A })),
      ],
    },
    {
      name: 'visor',
      surface: 'satin',
      seams: false,
      detail: 1.3,
      parts: [part('visor', visorShell, VISOR, { k: 0 })],
    },
  ],
  paints: [
    { name: 'cap', channel: 0, fn: (x, y, z) => Math.max(smax(Math.abs(x) - (1.45 + 0.25 * (y - 17.35)), 17.35 - y, 0.2), Math.abs(botHead(x, y, z)) - 0.5), color: BOT_BLACK },
    { name: 'earGlow', channel: 1, fn: bothSides((x, y, z) => Math.max(Math.hypot(y - 14.3, z - 0.15) - 1.15, 5.9 - x)), color: LIME_FELT },
    { name: 'chest', channel: 2, fn: (x, y, z) => Math.max(roundBox([0, 6.9, 4.2], [2.35, 1.75, 2.0], 0.9)(x, y, z), 2.5 - z), color: BOT_BLACK, stitch: '#3b3b40' },
    { name: 'bandsAndSoles', channel: 3, fn: anyOf(armBand, footPads), color: BOT_BLACK },
  ],
  patches: [
    {
      kind: 'stroke',
      layer: 'visor',
      points: roundRect(0, 14.35, 4.05, 1.97, 1.35, 6.0, 3),
      width: 0.13,
      color: '#7fb21c',
      surface: 'thread',
      closed: true,
    },
    // Closed, happy eyes: embroidered arcs.
    ...[1, -1].map((s): PatchDef => {
      const pts: V3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6 - 0.5;
        pts.push([s * 1.75 + t * 1.5, 14.75 + (0.25 - t * t) * 1.3, 5.5]);
      }
      return { kind: 'stroke', layer: 'visor', points: pts, width: 0.26, color: '#1d2a12', surface: 'thread', taper: true };
    }),
    { kind: 'poly', layer: 'visor', at: [0, 13.55, 5.4], outline: mouthOutline(0.75, 0.22, 0.7), color: '#22301a', surface: 'felt', lift: 0.05 },
    { kind: 'disc', layer: 'visor', at: [0, 13.2, 5.4], rx: 0.42, ry: 0.2, color: LIME_SOFT, surface: 'felt', lift: 0.09 },
    { kind: 'stroke', points: [[-0.9, 19.35, 0.1], [0, 19.42, 0.1], [0.9, 19.35, 0.1]], width: 0.1, color: '#d8d8d4', surface: 'thread', lift: 0.02 },
    sideTag([4.25, 3.6, -0.6], LIME_SOFT, LIME),
  ],
  deform: { sag: 0.55, sway: 0.75, squash: 0.6 },
}, [0, 0, -2.0]);

/* ===================================================================== pixel */

const PX_LIGHT = '#8fc23a';
const PX_MID = '#58a233';
const PX_DARK = '#1c6429';
/**
 * Proportions follow the concept photo and the generated model: a slightly deep cube that sits
 * on the floor (no legs under it), stub feet poking forward from its bottom edge and short arms
 * at mid-height. Base centred on the origin, front face at z = PX_HALF[2].
 */
const PX_C: V3 = [0, 7.85, 0];
const PX_HALF: V3 = [7.15, 8.15, 7.45];
const PX_CELLS = 5;
const PX_CELL: V3 = [(2 * PX_HALF[0]) / PX_CELLS, (2 * PX_HALF[1]) / PX_CELLS, (2 * PX_HALF[2]) / PX_CELLS];
const PX_FRONT_Z = PX_C[2] + PX_HALF[2];
/** Front face, top row first: 0 light, 1 mid, 2 dark (light squares under the eyes and mouth). */
const PX_FRONT = [
  [2, 1, 0, 1, 2],
  [1, 0, 1, 0, 1],
  [2, 0, 0, 0, 1],
  [1, 0, 0, 0, 2],
  [0, 2, 1, 2, 0],
];

/** Shade of a voxel of the 5×5×5 grid: 0 light, 1 mid, 2 dark (a fixed, hand-balanced scramble). */
function pxShade(i: number, j: number, k: number): number {
  // The front keeps a light patch for the face, like the concept toy.
  if (k === PX_CELLS - 1) return PX_FRONT[PX_CELLS - 1 - j]![i]!;
  const h = (i * 7 + j * 13 + k * 5 + ((i * j + j * k * 3 + k * i * 2) % 4)) % 6;
  return h < 2 ? 0 : h < 4 ? 1 : 2;
}

/** Checker paint: negative inside squares of `shade`, distance to the square's edge elsewhere (draws the seams). */
function pxChecker(shade: number): DistFn {
  return (x, y, z) => {
    const p = [x - PX_C[0], y - PX_C[1], z - PX_C[2]];
    // The face the point is on: the axis with the largest offset relative to the box's half size.
    const ax = Math.abs(p[0]!) / PX_HALF[0], ay = Math.abs(p[1]!) / PX_HALF[1], az = Math.abs(p[2]!) / PX_HALF[2];
    const face = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const idx: number[] = [];
    let edge = Infinity;
    for (let a = 0; a < 3; a++) {
      const u = (p[a]! + PX_HALF[a]!) / PX_CELL[a]!;
      const i = Math.max(0, Math.min(PX_CELLS - 1, Math.floor(u)));
      idx.push(i);
      if (a === face) continue;
      const f = u - i;
      edge = Math.min(edge, Math.min(f, 1 - f) * PX_CELL[a]!);
    }
    const inside = pxShade(idx[0]!, idx[1]!, idx[2]!) === shade;
    return inside ? -edge : edge;
  };
}

export const pixel: PlushDesign = {
  slug: 'pixel',
  theme: 'gpu',
  name: { en: 'Pixel', zh: '像素方块', ja: 'ピクセル' },
  kind: { en: 'chequered green pixel cube', zh: '绿色格子像素方块', ja: 'みどりのチェック柄ピクセルキューブ' },
  status: 'original',
  note: 'Original character.',
  height: 16,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      fur: 0.6,
      flatBase: 0.8,
      parts: [
        box('body', PX_C, PX_HALF, 2.0, PX_LIGHT, { collide: 'core', k: 0, piece: A }),
        // Stub feet poking out of the bottom front edge (the cube itself rests on the floor).
        ...pair(box('foot', [3.5, 1.9, 7.1], [2.0, 1.9, 2.4], 0.7, PX_DARK, { collide: 'appendage', k: 0.5, soft: 0.25, piece: B })),
        ...pair(box('arm', [8.0, 7.9, 1.0], [1.55, 1.9, 1.8], 0.6, PX_MID, { collide: 'appendage', soft: 0.45, k: 0.5, piece: B, rot: [0, -14, 6] })),
      ],
    },
  ],
  paints: [
    { name: 'dark', channel: 0, fn: pxChecker(2), color: PX_DARK },
    { name: 'mid', channel: 1, fn: pxChecker(1), color: PX_MID },
  ],
  patches: [
    ...eyePair([2.85, 9.3, PX_FRONT_Z], 0.64, { splay: 0 }),
    smile([0, 8.0, PX_FRONT_Z], 1.2, 0.38, 0.23, '#3a2420'),
    blush([3.45, 7.6, PX_FRONT_Z], 0.82, 0.6, BLUSH_PINK),
    sideTag([PX_HALF[0], 4.5, 0.8], LIME_SOFT, LIME_SOFT, [0.9, -0.15, 0.1]),
  ],
  deform: { sag: 0.35, sway: 0.5, squash: 0.55 },
};

/* ------------------------------------------------------------------ export */

/** GPU Party, in manifest order. */
export const gpuDesigns: PlushDesign[] = [chief, card, chip, fan, rack, bot, pixel];

