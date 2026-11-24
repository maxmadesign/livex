/**
 * Cosmic Arcade — nebula purple, cyan-blue, peach pink and a few restrained
 * neon accents. Livelier than the other themes, but every toy keeps clear
 * colours and soft plush materials.
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
  eyes,
  nose,
  pair,
  part,
  pipe,
  ring,
  roundBox,
  roundCone,
  smile,
  sphere,
  starOutline,
  wMouth,
  type DistFn,
  type PartDef,
  type PatchDef,
  type PlushDesign,
  type V3,
} from '../dsl';
import { applyMatrix, eulerMatrix, rotated, scaled, smax } from '../sdf';

/* ------------------------------------------------------------ local helpers */

/**
 * Sewn pieces. Seam lines are drawn where two different pieces meet; every layer here uses just
 * two ids, alternating with the attachment depth (body = A, parts sewn onto it = B, parts sewn
 * onto those = A again), so each junction that should show a seam separates an A from a B.
 */
const A = 'pieceA';
const B = 'pieceB';

const WHITE = '#ffffff';
const NEON_MINT = '#7dffd8';
const NEON_PINK = '#ff72cf';
const STAR_YELLOW = '#ffe067';
const INK = '#2a2440';

/** Signed distance to a regular n-pointed star in 2D (tips up). `m` in [2, n]: lower = sharper. */
function star2d(px: number, py: number, r: number, n: number, m: number): number {
  const an = Math.PI / n;
  const en = Math.PI / m;
  const acx = Math.cos(an), acy = Math.sin(an);
  const ecx = Math.cos(en), ecy = Math.sin(en);
  const ang = Math.atan2(px, py);
  const bn = (((ang % (2 * an)) + 2 * an) % (2 * an)) - an;
  const len = Math.hypot(px, py);
  let x = len * Math.cos(bn) - r * acx;
  let y = len * Math.abs(Math.sin(bn)) - r * acy;
  const t = Math.max(0, Math.min((r * acy) / ecy, -(x * ecx + y * ecy)));
  x += ecx * t;
  y += ecy * t;
  return Math.hypot(x, y) * Math.sign(x);
}

/** Star-shaped paint mask on the front of the body (extruded along z, limited to z > zMin). */
function starMask(cx: number, cy: number, r: number, zMin: number, m = 2.9): DistFn {
  return (x, y, z) => Math.max(star2d(x - cx, y - cy, r, 5, m), zMin - z);
}

/** Round paint mask on the front (a circle in the XY plane, limited to z > zMin). */
function frontCircle(cx: number, cy: number, r: number, zMin: number): DistFn {
  return (x, y, z) => Math.max(Math.hypot(x - cx, y - cy) - r, zMin - z);
}

/** Flat band shaped like a planetary ring: annulus around the local Y axis with a rounded profile. */
function flatRing(center: V3, midRadius: number, halfWidth: number, halfHeight: number, round: number, rot: V3): DistFn {
  const hw = Math.max(halfWidth - round, 1e-3), hh = Math.max(halfHeight - round, 1e-3);
  const local: DistFn = (x, y, z) => {
    const qx = Math.abs(Math.hypot(x - center[0], z - center[2]) - midRadius) - hw;
    const qy = Math.abs(y - center[1]) - hh;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round;
  };
  return rotated(local, center, rot);
}

/** Point on a tilted ring: azimuth in degrees from +X towards +Z, radius and height in the ring's own frame. */
function onRing(center: V3, rot: V3, azimuthDeg: number, radius: number, up: number): V3 {
  const a = (azimuthDeg * Math.PI) / 180;
  const p = applyMatrix(eulerMatrix(rot[0], rot[1], rot[2]), [Math.cos(a) * radius, up, Math.sin(a) * radius]);
  return [center[0] + p[0], center[1] + p[1], center[2] + p[2]];
}

/** Fabric tag sewn into the left side seam: a small vertical flag pointing back-left. */
function sideTag(at: V3, accent: string): PatchDef {
  return { kind: 'tag', at, out: [-0.85, -0.1, -0.5], color: WHITE, accent };
}

/** Closed rounded-rectangle path in the XY plane (counter-clockwise), with extra points on the long edges. */
function roundRectPath(cx: number, cy: number, hx: number, hy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [cx + hx - r, cy + hy - r, 0],
    [cx - hx + r, cy + hy - r, 90],
    [cx - hx + r, cy - hy + r, 180],
    [cx + hx - r, cy - hy + r, 270],
  ];
  corners.forEach(([ox, oy, start], c) => {
    for (let i = 0; i <= 4; i++) {
      const a = ((start + (i / 4) * 90) * Math.PI) / 180;
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
    }
    // Two extra points on the horizontal edges keep the spline straight there.
    if (c === 0) pts.push([cx + (hx - r) * 0.33, cy + hy], [cx - (hx - r) * 0.33, cy + hy]);
    if (c === 2) pts.push([cx - (hx - r) * 0.33, cy - hy], [cx + (hx - r) * 0.33, cy - hy]);
  });
  return pts;
}

/**
 * Mirrored pair of glossy bead eyes with sewn-on highlights that sit just proud of the bead
 * (both glints on the same side, as if lit by one lamp).
 */
function beadEyes(o: { at: V3; r: number; tall?: number; sparkle?: boolean; color?: string; layer?: string }): PatchDef[] {
  const tall = o.tall ?? 1;
  const [x, y, z] = o.at;
  const r = o.r;
  const dome = 0.5;
  const out: PatchDef[] = [
    { kind: 'disc', at: o.at, rx: r, ry: r * tall, color: o.color ?? '#1b1420', surface: 'bead', mirror: true, dome, lift: 0.04, layer: o.layer },
  ];
  const glint = (sx: number, dx: number, dy: number, size: number): PatchDef => ({
    kind: 'disc',
    at: [sx * x + dx * r, y + dy * r * tall, z + 0.4 * r],
    rx: size * r,
    color: WHITE,
    surface: 'gloss',
    lift: 0.06 + dome * r * Math.min(1, tall) * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)),
    dome: 0.25,
    layer: o.layer,
  });
  out.push(glint(1, 0.3, 0.36, 0.3), glint(-1, 0.3, 0.36, 0.3));
  if (o.sparkle) out.push(glint(1, -0.32, -0.34, 0.16), glint(-1, -0.32, -0.34, 0.16));
  return out;
}

/** Small glossy light / button. */
function light(at: V3, r: number, color: string, layer?: string): PatchDef {
  return { kind: 'disc', at, rx: r, color, surface: 'gloss', dome: 0.45, lift: 0.05, layer };
}

/* -------------------------------------------------------------- space bunny */

const B_FUR = '#fff4f7';
const B_SUIT = '#8468ec';
const B_SUIT_DARK = '#5e47c6';
const B_CYAN = '#4fd3f5';
const B_PINK = '#ffa8c0';
const B_NAVY = '#2f2b5e';

export const spacebunny: PlushDesign = {
  slug: 'spacebunny',
  theme: 'cosmic',
  name: { en: 'Comet Bunny', zh: '彗星太空兔', ja: 'コメットうさぎ' },
  kind: { en: 'bunny in a soft space suit', zh: '穿着软软太空服的小兔', ja: 'ふわふわ宇宙服のうさぎ' },
  status: 'original',
  note: 'Original character.',
  height: 23,
  mass: 0.24,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 5.0, 0], [6.0, 5.5, 5.5], B_SUIT, { collide: 'core', k: 2.0, piece: A }),
        ell('seat', [0, 1.9, -0.2], [5.3, 2.4, 4.9], B_SUIT, { collide: 'core', k: 1.8, piece: A, group: 'body' }),
        ell('head', [0, 13.0, 0.4], [6.7, 6.0, 6.2], B_FUR, { collide: 'core', k: 1.4, piece: B }),
        ...pair(
          part('ear', scaled(roundCone([2.6, 17.4, 0], [3.9, 22.6, -0.4], 1.8, 1.4), [3.2, 20, -0.2], [1, 1, 0.55]), B_FUR, {
            soft: 0.8,
            collide: 'appendage',
            k: 1.2,
            root: [2.6, 17.4, 0],
            reach: 6.6,
            piece: A,
          }),
        ),
        ...pair(cone('arm', [4.9, 8.3, 1.9], [6.1, 5.6, 3.0], 1.7, 1.9, B_SUIT, { soft: 0.5, k: 1.2, piece: B })),
        ...pair(ell('foot', [3.5, 1.7, 4.7], [2.5, 1.9, 3.2], B_SUIT, { soft: 0.3, k: 1.1, group: 'body', piece: B })),
        ball('tail', [0, 3.2, -5.7], 1.8, WHITE, { soft: 0.4, k: 0.8, piece: B }),
      ],
    },
    {
      name: 'gear',
      surface: 'shortfur',
      seams: false,
      parts: [
        ring('collar', [0, 9.1, 0.3], 5.15, 1.2, B_CYAN, { k: 0 }),
        box('pack', [0, 6.0, -5.5], [3.2, 3.3, 1.6], 1.1, B_SUIT_DARK, { k: 0, collide: 'core', group: 'body' }),
      ],
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([3.25, 20.2, 0.75], [0.8, 2.1, 0.7], [0, 0, -13])), color: B_PINK, stitch: true },
    { name: 'chestPanel', channel: 1, fn: roundBox([0, 5.5, 5.4], [2.4, 1.85, 2.6], 0.7), color: B_NAVY, stitch: '#8fe9ff' },
    {
      name: 'bootsMitts',
      channel: 2,
      fn: anyOf(bothSides(ellipsoid([3.5, 1.1, 5.0], [3.0, 2.3, 3.8])), bothSides(sphere([6.25, 5.3, 3.15], 2.3))),
      color: B_CYAN,
      stitch: true,
    },
  ],
  patches: [
    ...beadEyes({ at: [2.6, 13.1, 6.4], r: 0.8, sparkle: true }),
    nose([0, 12.15, 6.85], 0.45, 0.34, '#ff8fb0'),
    ...wMouth([0, 11.7, 6.8], 0.9, 0.4, 0.16),
    blush([4.4, 11.9, 5.5], 1.0, 0.65, '#ffb6c9'),
    light([-1.25, 6.1, 5.6], 0.42, STAR_YELLOW),
    light([0, 6.15, 5.75], 0.42, NEON_MINT),
    light([1.25, 6.1, 5.6], 0.42, NEON_PINK),
    {
      kind: 'stroke',
      points: [
        [-1.6, 4.7, 5.6],
        [-0.6, 4.7, 5.75],
        [-0.15, 5.15, 5.8],
        [0.4, 4.4, 5.75],
        [0.8, 4.7, 5.7],
        [1.6, 4.7, 5.6],
      ],
      width: 0.15,
      color: '#8fe9ff',
      surface: 'thread',
    },
    { kind: 'poly', layer: 'gear', at: [0, 6.1, -7.2], outline: starOutline(5, 1.35, 0.62), color: STAR_YELLOW, surface: 'felt' },
    sideTag([-5.8, 4.0, -0.4], B_CYAN),
  ],
  deform: { sag: 0.6, sway: 0.8, squash: 0.6 },
};

/* ---------------------------------------------------------------- star bear */

const SB_FUR = '#ffa98d';
const SB_CREAM = '#fff1e2';
const SB_GOLD = '#f0b93a';
const SB_BROWN = '#5a3d52';
const SB_CAP = '#6c9cff';
const CAP_ROOT: V3 = [0.8, 20.2, -0.6];

export const starbear: PlushDesign = {
  slug: 'starbear',
  theme: 'cosmic',
  name: { en: 'Twinkle Bear', zh: '眨眨星星熊', ja: 'きらぼしクマ' },
  kind: { en: 'sleepy bear with a stitched star on its belly', zh: '肚皮上缝着大星星的瞌睡小熊', ja: 'おなかに星をぬいつけたねむたいクマ' },
  status: 'original',
  note: 'Original character.',
  height: 22,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.5,
      parts: [
        ell('body', [0, 5.7, 0], [7.0, 6.2, 6.3], SB_FUR, { collide: 'core', k: 2.2, piece: A }),
        ell('head', [0, 13.9, 0.3], [6.5, 5.6, 5.9], SB_FUR, { collide: 'core', k: 2.2, piece: B }),
        ...pair(ell('ear', [4.7, 18.3, 0.1], [2.25, 2.25, 1.25], SB_FUR, { soft: 0.5, collide: 'appendage', k: 0.9, root: [4.2, 17.2, 0.1], reach: 3.2, piece: A })),
        ell('muzzle', [0, 12.6, 5.2], [2.7, 2.0, 1.8], SB_CREAM, { k: 0.8, piece: A }),
        ...pair(cone('arm', [5.6, 9.4, 2.0], [6.5, 6.4, 2.9], 1.9, 2.0, SB_FUR, { soft: 0.5, k: 1.3, piece: B })),
        ...pair(cone('leg', [3.7, 2.3, 3.2], [4.9, 2.1, 7.4], 2.5, 2.35, SB_FUR, { soft: 0.35, k: 1.4, collide: 'appendage', piece: B })),
        ball('tail', [0, 3.6, -6.1], 1.6, SB_FUR, { soft: 0.4, k: 0.8, piece: B }),
      ],
    },
    {
      // Floppy sleeping cap: sits between the ears and drapes behind the right ear, star pom at the end.
      name: 'cap',
      surface: 'shortfur',
      seams: false,
      parts: [
        ell('capBase', [0.4, 18.9, -0.3], [3.5, 2.5, 3.4], SB_CAP, { k: 0, group: 'head', collide: 'none' }),
        pipe(
          'capTail',
          [CAP_ROOT, [3.4, 21.1, -1.8], [6.0, 20.1, -3.0], [7.9, 17.7, -3.6], [8.5, 15.2, -3.4]],
          [2.2, 1.7, 1.3, 1.0, 0.8],
          SB_CAP,
          { soft: 0.95, collide: 'appendage', k: 0.9, root: CAP_ROOT, reach: 11 },
        ),
        ball('capPom', [8.6, 14.1, -3.3], 1.4, STAR_YELLOW, { soft: 0.95, k: 0.3, root: CAP_ROOT, reach: 11, collide: 'appendage', group: 'capTail' }),
        ring('capBrim', [0.4, 18.45, -0.3], 3.5, 0.82, WHITE, { k: 0.2, rot: [0, 0, -5] }),
      ],
    },
  ],
  paints: [
    { name: 'bellyStar', channel: 0, fn: starMask(0, 5.6, 3.9, 2), color: STAR_YELLOW, stitch: SB_GOLD },
    { name: 'pads', channel: 1, fn: bothSides(sphere([4.9, 2.1, 9.7], 1.6)), color: SB_CREAM },
    { name: 'innerEar', channel: 2, fn: bothSides(ellipsoid([4.7, 18.25, 1.1], [1.35, 1.35, 0.75])), color: SB_CREAM },
  ],
  patches: [
    ...eyes({ at: [2.7, 14.6, 5.6], r: 0.95, style: 'sleepy', color: SB_BROWN }),
    nose([0, 13.3, 6.95], 0.62, 0.45, SB_BROWN),
    { kind: 'stroke', points: [[0, 12.95, 7.0], [0, 12.4, 7.0]], width: 0.13, color: SB_BROWN, surface: 'thread' },
    smile([0, 12.1, 6.9], 0.85, 0.3, 0.15, SB_BROWN),
    blush([4.4, 12.9, 4.8], 1.05, 0.7, '#ff9fb2'),
    { kind: 'poly', at: [4.7, 18.3, 1.35], outline: starOutline(5, 1.0, 0.5), color: STAR_YELLOW, surface: 'felt', mirror: true },
    { kind: 'poly', layer: 'cap', at: [-1.3, 20.5, 1.9], outline: starOutline(5, 0.62, 0.3), color: STAR_YELLOW, surface: 'felt' },
    { kind: 'poly', layer: 'cap', at: [1.7, 20.2, 2.2], outline: starOutline(5, 0.48, 0.23), color: WHITE, surface: 'felt' },
    sideTag([-6.8, 4.6, -0.6], STAR_YELLOW),
  ],
  deform: { sag: 0.55, sway: 0.5, squash: 0.7 },
};

/* -------------------------------------------------------------------- alien */

const AL = '#4fdfc8';
const AL_DARK = '#2bb5a6';
const AL_BELLY = '#d6fff4';
const AL_LAV = '#b9a6ff';
const AL_EYE = '#141126';

const [bobbleR, bobbleL] = pair(ball('bobble', [4.85, 20.45, 0.35], 1.3, AL_LAV, { soft: 0.95, k: 0.35, root: [2.5, 16.4, 0], reach: 5.4, collide: 'appendage', piece: B })) as [PartDef, PartDef];
bobbleR.group = 'antennaR';
bobbleL.group = 'antennaL';

export const alien: PlushDesign = {
  slug: 'alien',
  theme: 'cosmic',
  name: { en: 'Blip', zh: '啵啵星人', ja: 'ブリップ' },
  kind: { en: 'round friendly alien with bobble antennae', zh: '顶着小触角的圆滚滚友好外星人', ja: 'ぽんぽんアンテナのまんまる宇宙人' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.2,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.3,
      parts: [
        ell('body', [0, 4.4, 0], [5.3, 4.8, 5.0], AL, { collide: 'core', k: 1.8, piece: A }),
        ell('seat', [0, 1.7, 0], [4.5, 2.1, 4.2], AL, { collide: 'core', k: 1.6, piece: A, group: 'body' }),
        ell('head', [0, 11.7, 0.3], [7.3, 5.9, 6.3], AL, { collide: 'core', k: 2.0, piece: B }),
        ...pair(cone('arm', [4.5, 6.6, 1.6], [6.3, 4.7, 3.1], 1.3, 1.5, AL, { soft: 0.55, k: 1.0, piece: B })),
        ...pair(ell('foot', [2.9, 1.4, 3.9], [2.1, 1.6, 2.7], AL_DARK, { soft: 0.3, k: 1.0, group: 'body', piece: B })),
        ...pair(
          pipe(
            'antenna',
            [
              [2.5, 16.4, 0],
              [3.3, 18.6, 0.15],
              [4.5, 20.0, 0.3],
            ],
            [0.7, 0.6, 0.55],
            AL,
            { soft: 0.95, collide: 'appendage', k: 0.7, piece: A },
          ),
        ),
        bobbleR,
        bobbleL,
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 4.4, 4.6], [3.1, 3.2, 2.2]), color: AL_BELLY, stitch: '#9fe9da' },
    {
      name: 'spots',
      channel: 1,
      fn: anyOf(sphere([-3.6, 16.6, -0.8], 1.5), sphere([3.9, 15.8, -2.6], 1.2), sphere([0.4, 16.9, -3.3], 1.0), sphere([-5.8, 13.8, -3.2], 1.1), sphere([5.9, 12.6, -3.6], 0.9)),
      color: AL_DARK,
    },
  ],
  patches: [
    { kind: 'disc', at: [2.95, 12.3, 5.9], rx: 1.45, ry: 1.95, rot: -18, color: AL_EYE, surface: 'bead', dome: 0.42, lift: 0.04, mirror: true },
    { kind: 'disc', at: [3.4, 13.05, 6.3], rx: 0.44, color: WHITE, surface: 'gloss', lift: 0.5, dome: 0.3 },
    { kind: 'disc', at: [-2.5, 13.05, 6.6], rx: 0.44, color: WHITE, surface: 'gloss', lift: 0.5, dome: 0.3 },
    { kind: 'disc', at: [2.6, 11.5, 6.4], rx: 0.2, color: WHITE, surface: 'gloss', lift: 0.5, dome: 0.3 },
    { kind: 'disc', at: [-3.3, 11.5, 6.1], rx: 0.2, color: WHITE, surface: 'gloss', lift: 0.5, dome: 0.3 },
    smile([0, 10.15, 6.5], 0.8, 0.3, 0.15, INK),
    blush([4.9, 10.5, 4.9], 0.95, 0.6, '#ff9fd8'),
    { kind: 'disc', at: [0, 4.5, 5.0], rx: 0.95, color: NEON_PINK, surface: 'felt', lift: 0.04 },
    { kind: 'stroke', points: [[-1.8, 4.0, 4.7], [0, 4.5, 5.2], [1.8, 5.0, 4.7]], width: 0.24, color: STAR_YELLOW, surface: 'thread', lift: 0.1, taper: true },
    sideTag([-5.1, 3.6, -0.5], NEON_PINK),
  ],
  deform: { sag: 0.6, sway: 1, squash: 0.65 },
};

/* ----------------------------------------------------------------- astro cat */

const AC_SUIT = '#f6f3ff';
const AC_CAT = '#ffcf6e';
const AC_STRIPE = '#f0a544';
const AC_PINK = '#ff86b8';
const AC_CYAN = '#4dd0f3';
const AC_DARK = '#3b2f52';

export const astrocat: PlushDesign = {
  slug: 'astrocat',
  theme: 'cosmic',
  name: { en: 'Nova Cat', zh: '新星宇航猫', ja: 'ノヴァねこ' },
  kind: { en: 'astronaut cat in a round helmet', zh: '戴着圆头盔的宇航小猫', ja: 'まるいヘルメットの宇宙飛行士ねこ' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.25,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 4.9, 0], [5.9, 5.3, 5.4], AC_SUIT, { collide: 'core', k: 2.0, piece: A }),
        ell('seat', [0, 1.8, -0.1], [5.2, 2.3, 4.8], AC_SUIT, { collide: 'core', k: 1.8, piece: A, group: 'body' }),
        ell('face', [0, 12.3, 3.3], [4.9, 4.7, 3.6], AC_CAT, { collide: 'core', group: 'head', k: 1.0, piece: A }),
        ...pair(cone('arm', [4.9, 7.2, 1.9], [5.9, 5.1, 2.7], 1.6, 1.85, AC_SUIT, { soft: 0.5, k: 1.2, piece: B })),
        ...pair(ell('foot', [3.3, 1.6, 4.5], [2.4, 1.8, 3.1], AC_PINK, { soft: 0.3, k: 1.0, group: 'body', piece: B })),
        pipe(
          'tail',
          [
            [1.4, 2.8, -4.5],
            [4.2, 3.3, -6.4],
            [6.5, 5.6, -6.2],
            [7.1, 8.3, -5.0],
          ],
          [1.2, 1.15, 1.05, 0.95],
          AC_CAT,
          { soft: 0.9, collide: 'appendage', k: 0.9, piece: B },
        ),
      ],
    },
    {
      name: 'helmet',
      surface: 'shortfur',
      seams: false,
      parts: [
        part('shell', sphere([0, 12.4, 0.2], 7.0), AC_SUIT, { collide: 'core', group: 'head', k: 0 }),
        ...pair(
          part('earBump', scaled(roundCone([3.2, 17.6, 0.2], [4.6, 20.6, 0.2], 2.1, 0.8), [3.9, 19, 0.2], [1, 1, 0.6]), AC_SUIT, {
            k: 1.0,
            soft: 0.35,
            piece: 'shell',
            group: 'head',
          }),
        ),
        part('opening', sphere([0, 12.2, 6.6], 4.6), AC_SUIT, { subtract: true, k: 0.5 }),
      ],
    },
    {
      name: 'trim',
      surface: 'gloss',
      seams: false,
      parts: [
        ring('rim', [0, 12.23, 5.57], 4.48, 0.62, AC_CYAN, { rot: [90, 0, 0], k: 0 }),
        ...pair(ell('knob', [6.95, 12.3, 0.2], [0.75, 1.5, 1.5], AC_CYAN, { k: 0 })),
      ],
    },
    {
      name: 'collar',
      surface: 'shortfur',
      seams: false,
      parts: [ring('collar', [0, 7.4, 0.1], 5.0, 0.95, AC_PINK, { k: 0 })],
    },
  ],
  paints: [
    { name: 'mitts', channel: 0, fn: bothSides(sphere([6.05, 4.95, 2.85], 2.2)), color: AC_PINK, stitch: true },
    {
      name: 'earPink',
      channel: 1,
      layer: 'helmet',
      fn: anyOf(bothSides(ellipsoid([3.95, 19.0, 0.95], [0.85, 1.25, 0.6], [0, 0, -25])), (x, y, z) => Math.max(star2d(x, y - 13.4, 2.3, 5, 2.9), z + 3)),
      color: AC_PINK,
    },
    { name: 'tailTip', channel: 2, fn: sphere([7.2, 8.7, -4.9], 1.75), color: WHITE },
    { name: 'chest', channel: 3, fn: roundBox([0, 4.6, 5.2], [2.1, 1.7, 2.4], 0.8), color: '#dff6ff', stitch: '#9ad9f2' },
  ],
  patches: [
    ...beadEyes({ at: [1.95, 12.8, 6.4], r: 0.72, tall: 1.15 }),
    nose([0, 11.85, 6.85], 0.36, 0.27, AC_PINK),
    ...wMouth([0, 11.5, 6.8], 0.75, 0.34, 0.14, AC_DARK),
    { kind: 'stroke', points: [[2.6, 11.75, 6.2], [3.5, 11.95, 5.6]], width: 0.1, color: AC_DARK, surface: 'thread', mirror: true },
    { kind: 'stroke', points: [[2.6, 11.35, 6.2], [3.5, 11.25, 5.6]], width: 0.1, color: AC_DARK, surface: 'thread', mirror: true },
    { kind: 'stroke', points: [[0, 15.0, 5.5], [0, 14.3, 6.1]], width: 0.22, color: AC_STRIPE, surface: 'thread', taper: true },
    { kind: 'stroke', points: [[0.75, 14.85, 5.5], [0.7, 14.35, 6.0]], width: 0.2, color: AC_STRIPE, surface: 'thread', taper: true, mirror: true },
    // paw emblem
    { kind: 'disc', at: [0, 4.35, 5.4], rx: 0.72, ry: 0.6, color: AC_PINK, surface: 'felt', lift: 0.05 },
    { kind: 'disc', at: [-0.8, 5.25, 5.4], rx: 0.3, color: AC_PINK, surface: 'felt', lift: 0.05 },
    { kind: 'disc', at: [0, 5.55, 5.45], rx: 0.3, color: AC_PINK, surface: 'felt', lift: 0.05 },
    { kind: 'disc', at: [0.8, 5.25, 5.4], rx: 0.3, color: AC_PINK, surface: 'felt', lift: 0.05 },
    sideTag([-5.7, 3.8, -0.5], AC_PINK),
  ],
  deform: { sag: 0.5, sway: 0.7, squash: 0.55 },
};

/* ------------------------------------------------------------ planet monster */

const PM = '#7f5ae6';
const PM_DARK = '#5d3ec4';
const PM_BELLY = '#e9e0ff';
const PM_RING = '#ffbd97';
const PM_BAND = '#ffe070';
const PM_HORN = '#ffa6bb';
const RING_C: V3 = [0, 3.9, 0];
const RING_ROT: V3 = [7, 0, -5];
const RING_MID = 6.2;

export const planetmonster: PlushDesign = {
  slug: 'planetmonster',
  theme: 'cosmic',
  name: { en: 'Orbit Munch', zh: '环环小怪兽', ja: 'わっかモンスター' },
  kind: { en: 'round little monster wearing a planetary ring', zh: '套着行星环的圆滚滚小怪兽', ja: 'わっかをつけたまんまるモンスター' },
  status: 'original',
  note: 'Original character.',
  height: 20,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.6,
      parts: [
        ell('body', [0, 7.4, 0], [6.2, 7.6, 6.0], PM, { collide: 'core', k: 2.0, piece: A }),
        ell('seat', [0, 1.9, 0], [5.0, 2.5, 4.8], PM, { collide: 'core', k: 2.0, piece: A, group: 'body' }),
        ...pair(cone('horn', [2.7, 13.6, 0.5], [3.7, 15.9, 0.6], 1.1, 0.55, PM_HORN, { soft: 0.6, k: 0.7, piece: B })),
        ...pair(ell('foot', [2.8, 1.2, 4.5], [1.9, 1.4, 2.5], PM_DARK, { soft: 0.3, k: 0.9, group: 'body', piece: B })),
        ...pair(cone('arm', [5.3, 7.7, 2.2], [6.3, 5.9, 3.0], 1.15, 1.2, PM, { soft: 0.5, k: 0.9, collide: 'appendage', piece: B })),
        cone('tail', [0, 6.0, -5.6], [0, 7.6, -7.2], 1.15, 0.5, PM_HORN, { soft: 0.7, k: 0.8, piece: B }),
      ],
    },
    {
      // The ring hugs the body below its widest point: open claw fingers pass outside it.
      name: 'ring',
      surface: 'felt',
      seams: false,
      parts: [part('ring', flatRing(RING_C, RING_MID, 1.3, 0.7, 0.64, RING_ROT), PM_RING, { collide: 'appendage', soft: 0.5, k: 0 })],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 6.0, 5.3], [3.1, 2.0, 2.2]), color: PM_BELLY, stitch: '#c9b6ff' },
    {
      name: 'spots',
      channel: 1,
      fn: anyOf(sphere([-2.8, 13.7, -1.6], 1.4), sphere([1.3, 14.4, -2.4], 1.0), sphere([4.1, 12.2, -3.0], 1.2), sphere([-4.9, 10.6, -3.2], 0.95)),
      color: PM_DARK,
    },
    {
      name: 'ringBand',
      channel: 2,
      layer: 'ring',
      fn: rotated((x, y, z) => Math.abs(Math.hypot(x - RING_C[0], z - RING_C[2]) - (RING_MID + 0.5)) - 0.36, RING_C, RING_ROT),
      color: PM_BAND,
    },
  ],
  patches: [
    ...beadEyes({ at: [2.6, 10.8, 5.2], r: 1.02, sparkle: true }),
    smile([0, 8.95, 5.9], 1.85, 0.65, 0.21, '#35264f'),
    {
      kind: 'poly',
      at: [1.05, 8.97, 5.9],
      outline: [
        [-0.44, -0.46],
        [0.44, -0.46],
        [0.48, -0.05],
        [0.34, 0.34],
        [0, 0.56],
        [-0.34, 0.34],
        [-0.48, -0.05],
      ],
      color: WHITE,
      surface: 'felt',
      dome: 0.22,
      lift: 0.08,
    },
    blush([4.5, 9.3, 4.4], 0.95, 0.62, '#ff9fd0'),
    { kind: 'poly', layer: 'ring', at: onRing(RING_C, RING_ROT, 62, RING_MID + 0.5, 0.78), outline: starOutline(5, 0.62, 0.3), color: WHITE, surface: 'felt' },
    { kind: 'poly', layer: 'ring', at: onRing(RING_C, RING_ROT, 118, RING_MID + 0.5, 0.78), outline: starOutline(5, 0.5, 0.24), color: WHITE, surface: 'felt' },
    { kind: 'poly', layer: 'ring', at: onRing(RING_C, RING_ROT, 24, RING_MID + 0.5, 0.78), outline: starOutline(5, 0.46, 0.22), color: WHITE, surface: 'felt' },
    sideTag([-5.2, 8.6, -2.6], PM_BAND),
  ],
  deform: { sag: 0.5, sway: 0.5, squash: 0.75 },
};

/* --------------------------------------------------------------- space robot */

const RB = '#3fbaf2';
const RB_HEAD = '#eaf3ff';
const RB_NAVY = '#27305e';
const RB_PINK = '#ff7fb6';
const RB_GREY = '#c9c2ee';
const RB_PEACH = '#ffa67c';

function robotArm(side: 1 | -1): PartDef[] {
  const name = side > 0 ? 'R' : 'L';
  const group = `arm${name}`;
  const root: V3 = [side * 5.6, 8.8, 0.5];
  const o = { soft: 0.7, collide: 'appendage' as const, group, root, reach: 7 };
  return [
    ball(`armA${name}`, [side * 5.9, 8.6, 0.5], 1.4, RB_GREY, { ...o, k: 0.5, piece: B }),
    ball(`armB${name}`, [side * 6.9, 7.3, 0.9], 1.3, RB_GREY, { ...o, k: 0.35, piece: A }),
    ball(`armC${name}`, [side * 7.4, 5.8, 1.3], 1.25, RB_GREY, { ...o, k: 0.35, piece: B }),
    ball(`hand${name}`, [side * 7.6, 4.1, 1.7], 1.6, RB_PINK, { ...o, k: 0.35, piece: A }),
  ];
}

const dome: DistFn = (() => {
  const e = ellipsoid([0, 12.6, 0], [5.8, 6.4, 5.5]);
  return (x: number, y: number, z: number) => smax(e(x, y, z), 12.3 - y, 0.9);
})();

/** Depth of the dome surface at (x, y); sign -1 gives the back of the head. */
function domeZ(x: number, y: number, sign = 1): number {
  return sign * 5.5 * Math.sqrt(Math.max(0, 1 - (x / 5.8) ** 2 - ((y - 12.6) / 6.4) ** 2));
}

const DIAL: V3 = [0, 7.1, 4.75];

function dialTicks(): PatchDef[] {
  const out: PatchDef[] = [];
  for (const deg of [150, 120, 90, 60, 30]) {
    const a = (deg * Math.PI) / 180;
    out.push({
      kind: 'stroke',
      points: [
        [DIAL[0] + Math.cos(a) * 1.3, DIAL[1] + Math.sin(a) * 1.3, DIAL[2]],
        [DIAL[0] + Math.cos(a) * 1.8, DIAL[1] + Math.sin(a) * 1.8, DIAL[2]],
      ],
      width: 0.13,
      color: RB_NAVY,
      surface: 'thread',
    });
  }
  return out;
}

export const spacerobot: PlushDesign = {
  slug: 'spacerobot',
  theme: 'cosmic',
  name: { en: 'Bolt-3', zh: '波特三号', ja: 'ボルト3ごう' },
  kind: { en: 'retro space robot with a wind-up key', zh: '带发条钥匙的复古太空机器人', ja: 'ぜんまいつきレトロ宇宙ロボ' },
  status: 'original',
  note: 'Original character.',
  height: 22,
  mass: 0.28,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.2,
      parts: [
        box('body', [0, 6.6, 0], [5.4, 4.5, 4.6], 2.0, RB, { collide: 'core', k: 0, piece: A }),
        // Thruster: a narrow nozzle under the body flaring into a wide, flat exhaust bell (the stable base).
        cyl('thruster', [0, 0.7, 0], 5.25, 0.7, 0.5, RB_PEACH, { k: 0, collide: 'core', group: 'body', piece: A }),
        cyl('nozzle', [0, 2.0, 0], 3.6, 1.2, 0.4, '#ff8f66', { k: 0.5, collide: 'core', group: 'body', piece: B }),
        cyl('neck', [0, 11.5, 0], 3.3, 0.9, 0.5, RB_GREY, { k: 0.4, piece: B }),
        part('head', dome, RB_HEAD, { collide: 'core', k: 0.5, piece: A }),
        ...pair(cyl('bolt', [5.9, 15.0, 0], 1.3, 0.75, 0.45, STAR_YELLOW, { rot: [0, 0, 90], k: 0.3, piece: B })),
        pipe('antenna', [[0, 18.4, 0], [0, 20.4, 0.1]], 0.5, RB_GREY, { soft: 0.9, k: 0.5, piece: B }),
        ball('antennaTip', [0, 21.2, 0.1], 1.15, RB_PINK, { soft: 0.9, k: 0.3, root: [0, 18.4, 0], reach: 3.4, piece: A }),
        ...robotArm(1),
        ...robotArm(-1),
      ],
    },
    {
      name: 'key',
      surface: 'felt',
      seams: false,
      detail: 1.3,
      parts: [
        // Decoration only: the generated model has no wind-up key, so it gets no collider either.
        cyl('keyStem', [0, 7.4, -5.0], 0.55, 0.8, 0.3, STAR_YELLOW, { rot: [90, 0, 0], k: 0, collide: 'none', group: 'key' }),
        ring('keyLoop', [0, 7.4, -6.5], 1.25, 0.5, STAR_YELLOW, { rot: [0, 0, 90], k: 0.3, soft: 0.4, collide: 'none', group: 'key' }),
      ],
    },
  ],
  paints: [
    { name: 'visor', channel: 0, fn: roundBox([0, 15.45, 4.4], [4.0, 1.8, 3.4], 1.3), color: RB_NAVY },
    { name: 'dial', channel: 1, fn: frontCircle(DIAL[0], DIAL[1], 2.25, 2), color: '#fff6d8', stitch: '#f0b93a' },
    { name: 'flame', channel: 2, fn: (_x, y) => y - 0.8, color: STAR_YELLOW },
  ],
  patches: [
    {
      kind: 'stroke',
      points: roundRectPath(0, 15.45, 3.62, 1.42, 0.95).map(([x, y]) => [x, y, domeZ(x, y)] as V3),
      width: 0.17,
      color: '#8fe9ff',
      surface: 'thread',
      closed: true,
    },
    { kind: 'disc', at: [1.85, 15.85, 5.2], rx: 0.92, color: STAR_YELLOW, surface: 'gloss', dome: 0.35, lift: 0.05, mirror: true },
    { kind: 'disc', at: [2.15, 16.2, 5.4], rx: 0.27, color: WHITE, surface: 'gloss', dome: 0.3, lift: 0.34 },
    { kind: 'disc', at: [-1.55, 16.2, 5.5], rx: 0.27, color: WHITE, surface: 'gloss', dome: 0.3, lift: 0.34 },
    smile([0, 14.75, 5.5], 0.95, 0.34, 0.18, NEON_MINT),
    blush([4.3, 13.3, 3.7], 0.7, 0.45, '#ffadd0'),
    ...[14.3, 15.3, 16.3].map(
      (y): PatchDef => ({
        kind: 'stroke',
        points: [-1.5, 0, 1.5].map((x) => [x, y, domeZ(x, y, -1)] as V3),
        width: 0.24,
        color: '#a9a2d6',
        surface: 'thread',
        taper: true,
      }),
    ),
    ...dialTicks(),
    { kind: 'stroke', points: [[DIAL[0], DIAL[1] - 0.2, DIAL[2]], [DIAL[0] + 0.95, DIAL[1] + 0.9, DIAL[2]]], width: 0.2, color: NEON_PINK, surface: 'thread', lift: 0.06 },
    light([DIAL[0], DIAL[1] - 0.2, DIAL[2]], 0.36, RB_NAVY),
    light([-1.5, 3.75, 4.6], 0.45, NEON_PINK),
    light([1.5, 3.75, 4.6], 0.45, NEON_MINT),
    { kind: 'disc', at: [4.25, 9.7, 3.9], rx: 0.3, color: RB_GREY, surface: 'gloss', dome: 0.4, lift: 0.04, mirror: true },
    sideTag([-5.4, 4.4, -1.6], RB_PINK),
  ],
  deform: { sag: 0.4, sway: 0.7, squash: 0.5 },
};

export const cosmicDesigns: PlushDesign[] = [spacebunny, starbear, alien, astrocat, planetmonster, spacerobot];
