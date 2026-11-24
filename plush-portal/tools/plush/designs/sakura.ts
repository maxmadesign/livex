/**
 * Sakura Kawaii — cream white, cherry-blossom pink, mint and a touch of lemon.
 * Boutique Japanese crane-game plushies: big heads, tiny limbs, calm faces.
 */
import {
  anyOf,
  ball,
  blush,
  boltOutline,
  bothSides,
  box,
  cone,
  cyl,
  ell,
  ellipsoid,
  eyes,
  heartOutline,
  nose,
  pair,
  part,
  ring,
  roundCone,
  smile,
  sphere,
  wMouth,
  type DistFn,
  type PartDef,
  type PatchDef,
  type PlushDesign,
  type V3,
} from '../dsl';
import { applyMatrix, eulerMatrix, rotated, scaled, tube } from '../sdf';

/* ------------------------------------------------------------ theme palette */

const CREAM = '#fff1dc';
const WHITE = '#fffaf3';
const PINK = '#ffc2d4';
const ROSE = '#ff8fb0';
const BLUSH = '#ffb3c8';
const MINT = '#a9ead6';
const MINT_DEEP = '#7fdcc2';
const LEMON = '#ffe27a';
const BIRIBI_YELLOW = '#ffdc55';
const INK = '#3a2a2e';

/* ------------------------------------------------------------------ helpers */

const RAD = Math.PI / 180;

/** A point on the front (+Z) of an ellipsoid at the given x / y, nudged outwards so patches project cleanly. */
function onFront(c: V3, r: V3, x: number, y: number, push = 0.05): V3 {
  const u = (x - c[0]) / r[0];
  const v = (y - c[1]) / r[1];
  const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  return [x, y, c[2] + r[2] * w + push];
}

/** Surface point and outward normal of an ellipsoid in direction `dir` from its centre. */
function onEllipsoid(c: V3, r: V3, dir: V3): { p: V3; n: V3 } {
  const t = 1 / Math.hypot(dir[0] / r[0], dir[1] / r[1], dir[2] / r[2]);
  const p: V3 = [c[0] + dir[0] * t, c[1] + dir[1] * t, c[2] + dir[2] * t];
  const g: V3 = [(p[0] - c[0]) / (r[0] * r[0]), (p[1] - c[1]) / (r[1] * r[1]), (p[2] - c[2]) / (r[2] * r[2])];
  const l = Math.hypot(g[0], g[1], g[2]);
  return { p, n: [g[0] / l, g[1] / l, g[2] / l] };
}

function lift(p: V3, n: V3, d: number): V3 {
  return [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
}

/**
 * A local frame at `center` whose +Z axis points along `normal`, rolled about
 * that axis by `roll` degrees. Used for sewn-on accessories (bows, blossoms,
 * leaves) that are easier to model flat around the origin.
 */
function frame(center: V3, normal: V3, roll = 0) {
  const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n: V3 = [normal[0] / l, normal[1] / l, normal[2] / l];
  const rx = -Math.asin(Math.max(-1, Math.min(1, n[1]))) / RAD;
  const ry = Math.atan2(n[0], n[2]) / RAD;
  const tilt = eulerMatrix(rx, ry, 0);
  const spin = eulerMatrix(0, 0, roll);
  return {
    /** Places a shape that was modelled around the origin. */
    wrap(fn: DistFn): DistFn {
      const moved: DistFn = (x, y, z) => fn(x - center[0], y - center[1], z - center[2]);
      return rotated(rotated(moved, center, [0, 0, roll]), center, [rx, ry, 0]);
    },
    /** Local point → model space. */
    point(v: V3): V3 {
      const w = applyMatrix(tilt, applyMatrix(spin, v));
      return [center[0] + w[0], center[1] + w[1], center[2] + w[2]];
    },
  };
}

/** Smooth tube through control points (Catmull-Rom), so cables, tails and ears have no kinks. */
function smoothTube(points: V3[], radii: number[], perSpan = 4): DistFn {
  const n = points.length;
  const get = (i: number) => points[Math.max(0, Math.min(n - 1, i))]!;
  const outP: V3[] = [];
  const outR: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const r1 = radii[Math.min(i, radii.length - 1)]!, r2 = radii[Math.min(i + 1, radii.length - 1)]!;
    for (let k = 0; k < perSpan; k++) {
      const t = k / perSpan, t2 = t * t, t3 = t2 * t;
      outP.push(
        [0, 1, 2].map(
          (a) => 0.5 * (2 * p1[a]! + (-p0[a]! + p2[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t2 + (-p0[a]! + 3 * p1[a]! - 3 * p2[a]! + p3[a]!) * t3),
        ) as V3,
      );
      outR.push(r1 + (r2 - r1) * t);
    }
  }
  outP.push(points[n - 1]!);
  outR.push(radii[Math.min(n - 1, radii.length - 1)]!);
  return tube(outP, outR);
}

/** Flattens a shape modelled around the origin along its local Z axis. */
const flatZ = (fn: DistFn, thickness: number): DistFn => scaled(fn, [0, 0, 0], [1, 1, thickness]);

/** Ribbon bow: knot, two puffy loops and two short tails, lying in the local XY plane. */
function bow(center: V3, normal: V3, roll: number, s: number, color: string): PartDef[] {
  const f = frame(center, normal, roll);
  const loop = (side: number) => flatZ(roundCone([0.35 * s * side, 0.04 * s, 0], [2.35 * s * side, 0.42 * s, 0], 0.42 * s, 1.16 * s), 0.52);
  const tail = (side: number) => flatZ(roundCone([0.16 * s * side, -0.3 * s, 0], [1.15 * s * side, -2.25 * s, 0], 0.36 * s, 0.66 * s), 0.36);
  const dimple = (side: number) => ellipsoid([1.55 * s * side, 0.28 * s, 0.62 * s], [0.62 * s, 0.4 * s, 0.26 * s], [0, 0, 10 * side]);
  const o = { k: 0.22, soft: 0.55, piece: 'bow' };
  return [
    part('bowTailR', f.wrap(tail(1)), color, o),
    part('bowTailL', f.wrap(tail(-1)), color, o),
    part('bowLoopR', f.wrap(loop(1)), color, o),
    part('bowLoopL', f.wrap(loop(-1)), color, o),
    part('bowKnot', f.wrap(ellipsoid([0, 0, 0.16 * s], [0.6 * s, 0.7 * s, 0.58 * s])), color, { ...o, k: 0.12 }),
    part('bowDimpleR', f.wrap(dimple(1)), color, { subtract: true, k: 0.3 }),
    part('bowDimpleL', f.wrap(dimple(-1)), color, { subtract: true, k: 0.3 }),
  ];
}

/** Five-petal cherry blossom with notched petals, lying in the local XY plane. */
function blossom(prefix: string, center: V3, normal: V3, roll: number, s: number, petal: string, core: string): PartDef[] {
  const f = frame(center, normal, roll);
  const parts: PartDef[] = [];
  for (let i = 0; i < 5; i++) {
    const a = 90 + i * 72;
    const ca = Math.cos(a * RAD), sa = Math.sin(a * RAD);
    parts.push(
      part(`${prefix}Petal${i}`, f.wrap(ellipsoid([ca * 1.12 * s, sa * 1.12 * s, 0.14 * s], [0.86 * s, 1.14 * s, 0.3 * s], [0, 0, a - 90])), petal, {
        k: 0.16,
        soft: 0.6,
        piece: prefix,
      }),
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = 90 + i * 72;
    parts.push(part(`${prefix}Notch${i}`, f.wrap(sphere([Math.cos(a * RAD) * 2.42 * s, Math.sin(a * RAD) * 2.42 * s, 0.14 * s], 0.34 * s)), petal, { subtract: true, k: 0.12 }));
  }
  parts.push(part(`${prefix}Core`, f.wrap(ellipsoid([0, 0, 0.32 * s], [0.5 * s, 0.5 * s, 0.36 * s])), core, { k: 0.08, soft: 0.6, piece: prefix }));
  return parts;
}

/** Like `pair`, but both parts of each side share one collider group ("<group>R" / "<group>L"). */
function pairGrouped(p: PartDef, group: string): PartDef[] {
  return pair(p).map((side) => ({ ...side, group: `${group}${side.name.endsWith('R') ? 'R' : 'L'}`, piece: `${group}${side.name.endsWith('R') ? 'R' : 'L'}` }));
}

/** A fabric tag on the toy's left side seam. */
const sideTag = (y: number, x: number, accent: string): PatchDef => ({ kind: 'tag', at: [-x, y, 0.3], out: [-1, -0.25, 0.1], color: '#ffffff', accent });

/* ------------------------------------------------------------------- bunny */

const BUNNY_HEAD_C: V3 = [0, 13.9, 0.5];
const BUNNY_HEAD_R: V3 = [7.1, 6.3, 6.5];
const bunnyBowSpot = onEllipsoid(BUNNY_HEAD_C, BUNNY_HEAD_R, [3.6, 4.1, 3.7]);

export const bunny: PlushDesign = {
  slug: 'bunny',
  theme: 'sakura',
  name: { en: 'Mochi Bunny', zh: '麻薯长耳兔', ja: 'もちうさぎ' },
  kind: { en: 'cream lop-eared bunny with a ribbon bow', zh: '戴蝴蝶结的奶油色垂耳兔', ja: 'リボンをつけたクリーム色のたれ耳うさぎ' },
  status: 'original',
  note: 'Original character.',
  height: 20.5,
  mass: 0.23,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 5.4, 0], [6.3, 5.9, 5.7], CREAM, { collide: 'core', k: 2.2 }),
        ell('head', BUNNY_HEAD_C, BUNNY_HEAD_R, CREAM, { collide: 'core', k: 2.4 }),
        // Lop ears: leave the head at the side, arc outwards and hang down past the cheeks.
        ...pair(
          part(
            'ear',
            scaled(
              smoothTube(
                [
                  [5.3, 16.4, -0.2],
                  [8.2, 15.5, 0.1],
                  [9.4, 12.2, 0.6],
                  [9.3, 8.2, 1.0],
                ],
                [1.4, 1.8, 2.15, 2.3],
              ),
              [7.6, 13, 0.4],
              [1, 1, 0.5],
            ),
            CREAM,
            { soft: 0.95, collide: 'appendage', k: 1.5, root: [5.3, 16.4, -0.2], reach: 12 },
          ),
        ),
        ...pair(cone('arm', [5.0, 8.9, 2.4], [6.4, 5.9, 4.5], 1.7, 1.9, CREAM, { soft: 0.5, k: 1.3, collide: 'none' })),
        ...pair(ell('foot', [3.7, 1.7, 5.0], [2.5, 1.9, 3.3], CREAM, { soft: 0.3, k: 1.2, collide: 'none', group: 'body' })),
        ball('tail', [0, 3.6, -5.9], 2.1, '#ffffff', { soft: 0.4, k: 0.9 }),
      ],
    },
    {
      name: 'bow',
      surface: 'satin',
      seams: false,
      detail: 1.9,
      parts: bow(lift(bunnyBowSpot.p, bunnyBowSpot.n, 0.5), bunnyBowSpot.n, -8, 1, ROSE),
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([9.15, 11.2, 1.75], [1.35, 3.9, 1.0], [0, 0, -2])), color: PINK, stitch: true },
    { name: 'belly', channel: 1, fn: ellipsoid([0, 5.2, 5.2], [3.5, 3.7, 2.4]), color: WHITE, stitch: '#f1ddc4' },
    { name: 'pads', channel: 2, fn: bothSides(ellipsoid([3.7, 1.8, 8.1], [1.35, 1.2, 1.2])), color: PINK },
  ],
  patches: [
    ...eyes({ at: onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 2.75, 13.7), r: 0.78, style: 'sparkle' }),
    nose(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 0, 12.75), 0.48, 0.36, ROSE),
    ...wMouth(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 0, 12.3), 0.95, 0.42, 0.17),
    blush(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 4.55, 12.35), 1.05, 0.7, BLUSH),
    sideTag(4.4, 6.2, ROSE),
  ],
  deform: { sag: 0.65, sway: 0.9, squash: 0.6 },
};

/* ------------------------------------------------------------------ biribi */

const BIRIBI_HEAD_C: V3 = [0, 12.4, 0.4];
const BIRIBI_HEAD_R: V3 = [7.3, 5.9, 6.6];
const BIRIBI_BODY_C: V3 = [0, 5.5, 0];
const BIRIBI_BODY_R: V3 = [7.0, 5.9, 6.3];
const CABLE = '#bfeee0';

export const biribi: PlushDesign = {
  slug: 'biribi',
  theme: 'sakura',
  name: { en: 'Biribi', zh: '噼哩比', ja: 'ビリビ' },
  kind: {
    en: 'lemon-yellow electric hamster sprite with a power-plug tail',
    zh: '拖着插头尾巴的柠檬黄电气仓鼠精灵',
    ja: 'プラグのしっぽがついたレモン色の電気ハムスター',
  },
  status: 'original-replaceable',
  note: 'Original "electric cutie" designed for PLUSH PORTAL (round mint-lined ears, mint cheeks, plug tail). This slot is intentionally replaceable: a licensed character model can be swapped in through the manifest without touching the game.',
  height: 21.4,
  mass: 0.25,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', BIRIBI_BODY_C, BIRIBI_BODY_R, BIRIBI_YELLOW, { collide: 'core', k: 2.4 }),
        ell('head', BIRIBI_HEAD_C, BIRIBI_HEAD_R, BIRIBI_YELLOW, { collide: 'core', k: 2.6 }),
        // Hamster cheek pouches.
        ...pair(ell('cheek', [5.1, 10.7, 3.0], [2.7, 2.3, 2.6], BIRIBI_YELLOW, { k: 1.8, piece: 'head', group: 'head' })),
        ...pair(ell('ear', [4.7, 17.5, 0.1], [2.15, 2.05, 0.95], BIRIBI_YELLOW, { k: 0.9, soft: 0.5, collide: 'none', group: 'head' })),
        ...pair(cone('arm', [5.7, 8.3, 2.7], [6.9, 6.0, 4.7], 1.55, 1.7, BIRIBI_YELLOW, { soft: 0.45, k: 1.2, collide: 'none', group: 'body' })),
        ...pair(ell('foot', [3.6, 1.5, 5.3], [2.3, 1.6, 3.0], BIRIBI_YELLOW, { soft: 0.3, k: 1.1, collide: 'none', group: 'body' })),
      ],
    },
    {
      // The tail is a stuffed power cable that swings round to the side and ends in a plug.
      name: 'cable',
      surface: 'shortfur',
      seams: false,
      detail: 1.6,
      parts: [
        part(
          'cable',
          smoothTube(
            [
              [0.4, 3.4, -5.4],
              [3.6, 2.5, -7.9],
              [7.5, 3.3, -7.5],
              [9.8, 6.4, -5.5],
              [10.2, 9.6, -3.9],
            ],
            [0.64],
            5,
          ),
          CABLE,
          { k: 0.2, soft: 0.85, root: [0.4, 3.4, -5.4], reach: 17, collide: 'none' },
        ),
        box('plug', [10.25, 11.2, -3.55], [1.5, 1.4, 1.0], 0.55, WHITE, { k: 0.25, soft: 0.5, collide: 'appendage', rot: [0, 0, -4] }),
        ring('plugBand', [10.2, 10.05, -3.65], 0.98, 0.26, MINT_DEEP, { k: 0.08, soft: 0.5 }),
      ],
    },
    {
      name: 'prongs',
      surface: 'metal',
      seams: false,
      detail: 2.2,
      parts: [
        cyl('prongR', [10.98, 13.2, -3.55], 0.29, 0.85, 0.12, '#dfe3ea', { k: 0.05, rot: [0, 0, -4] }),
        cyl('prongL', [9.72, 13.29, -3.55], 0.29, 0.85, 0.12, '#dfe3ea', { k: 0.05, rot: [0, 0, -4] }),
      ],
    },
    {
      name: 'antenna',
      surface: 'shortfur',
      seams: false,
      detail: 2,
      parts: [
        part(
          'stalk',
          tube(
            [
              [0, 17.6, 0.4],
              [0.35, 19.3, 0.5],
              [1.15, 20.5, 0.45],
            ],
            [0.42, 0.36, 0.34],
          ),
          MINT_DEEP,
          { k: 0.1, soft: 0.9, root: [0, 17.6, 0.4], reach: 4 },
        ),
        ball('spark', [1.45, 20.95, 0.45], 0.82, MINT, { k: 0.2, soft: 0.9, root: [0, 17.6, 0.4], reach: 4 }),
      ],
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([4.75, 17.45, 1.0], [1.3, 1.22, 0.8])), color: MINT, stitch: MINT_DEEP },
    { name: 'belly', channel: 1, fn: ellipsoid([0, 5.2, 5.7], [3.7, 3.7, 2.5]), color: '#fff7dc', stitch: '#f0dca0' },
    { name: 'pads', channel: 2, fn: bothSides(ellipsoid([3.6, 1.6, 8.2], [1.25, 1.05, 1.15])), color: MINT },
    {
      // A zigzag "spark" stripe across the back of the head.
      name: 'spark',
      channel: 3,
      fn: anyOf(
        ellipsoid([-2.5, 11.7, -5.6], [1.55, 0.5, 2.4], [0, 0, 30]),
        ellipsoid([0, 11.7, -5.9], [1.55, 0.5, 2.4], [0, 0, -30]),
        ellipsoid([2.5, 11.7, -5.6], [1.55, 0.5, 2.4], [0, 0, 30]),
      ),
      color: MINT,
    },
  ],
  patches: [
    ...eyes({ at: onFront(BIRIBI_HEAD_C, BIRIBI_HEAD_R, 2.9, 13.3), r: 0.74, style: 'sparkle' }),
    nose(onFront(BIRIBI_HEAD_C, BIRIBI_HEAD_R, 0, 12.15), 0.42, 0.3, '#e59a5a'),
    ...wMouth(onFront(BIRIBI_HEAD_C, BIRIBI_HEAD_R, 0, 11.7), 0.82, 0.36, 0.15),
    // Two little hamster teeth.
    { kind: 'disc', at: onFront(BIRIBI_HEAD_C, BIRIBI_HEAD_R, 0.24, 11.08), rx: 0.2, ry: 0.3, color: '#ffffff', surface: 'felt', lift: 0.05, mirror: true },
    // Mint cheeks (never red).
    { kind: 'disc', at: [5.0, 10.8, 5.75], rx: 1.25, ry: 0.95, color: MINT_DEEP, surface: 'felt', mirror: true, lift: 0.03 },
    // Bolt emblem on the tummy.
    { kind: 'poly', at: onFront(BIRIBI_BODY_C, BIRIBI_BODY_R, 0, 5.4), outline: boltOutline(1.55), color: MINT_DEEP, surface: 'felt', lift: 0.04 },
    sideTag(4.6, 6.9, MINT_DEEP),
  ],
  deform: { sag: 0.55, sway: 0.8, squash: 0.65 },
};

/* --------------------------------------------------------------- sakuracat */

const CAT_PINK = '#ffd0dc';
const CAT_DEEP = '#ff9fba';
const CAT_HEAD_C: V3 = [0, 13.3, 0.5];
const CAT_HEAD_R: V3 = [7.5, 6.0, 6.3];
const catBlossomSpot = onEllipsoid(CAT_HEAD_C, CAT_HEAD_R, [-3.3, 4.0, 3.8]);
const catFace = (x: number, y: number, push = 0.05) => onFront(CAT_HEAD_C, CAT_HEAD_R, x, y, push);

export const sakuracat: PlushDesign = {
  slug: 'sakuracat',
  theme: 'sakura',
  name: { en: 'Sakura Neko', zh: '樱花猫', ja: 'さくらねこ' },
  kind: { en: 'cherry-blossom pink cat with a flower on its head', zh: '头戴樱花的粉色小猫', ja: '頭に桜をのせたピンクのねこ' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.22,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.3,
      parts: [
        ell('body', [0, 5.3, 0], [6.0, 5.7, 5.5], CAT_PINK, { collide: 'core', k: 2.2 }),
        ell('head', CAT_HEAD_C, CAT_HEAD_R, CAT_PINK, { collide: 'core', k: 2.4 }),
        ...pair(
          part('ear', scaled(roundCone([4.2, 16.6, 0.2], [5.9, 20.3, 0.0], 2.5, 0.8), [5, 18.3, 0.1], [1, 1, 0.5]), CAT_PINK, {
            soft: 0.55,
            collide: 'appendage',
            k: 1.2,
            root: [4.2, 16.6, 0.2],
            reach: 4.6,
          }),
        ),
        // Front legs straight down, the classic sitting cat.
        ...pair(cone('arm', [3.2, 8.2, 3.3], [3.0, 2.1, 5.5], 1.7, 1.95, CAT_PINK, { soft: 0.3, k: 1.4, collide: 'none', group: 'body' })),
        ...pair(ell('foot', [5.2, 1.5, 2.4], [2.3, 1.6, 3.1], CAT_PINK, { soft: 0.3, k: 1.2, collide: 'none', group: 'body' })),
        // Tail curls round the body along the floor (two segments so each gets a snug collider).
        part(
          'tailA',
          smoothTube(
            [
              [-0.4, 2.7, -4.9],
              [-4.6, 2.3, -6.6],
              [-7.9, 2.3, -4.3],
              [-8.8, 2.35, -0.4],
            ],
            [1.55, 1.5, 1.45, 1.4],
          ),
          CAT_PINK,
          { soft: 0.75, collide: 'appendage', k: 1.2, piece: 'tail', root: [-0.4, 2.7, -4.9], reach: 17 },
        ),
        part(
          'tailB',
          smoothTube(
            [
              [-8.5, 2.3, -2.6],
              [-8.8, 2.35, -0.4],
              [-8.4, 2.4, 1.6],
              [-7.4, 2.4, 3.2],
            ],
            [1.42, 1.4, 1.35, 1.28],
          ),
          CAT_PINK,
          { soft: 0.75, collide: 'appendage', k: 1.0, piece: 'tail', root: [-0.4, 2.7, -4.9], reach: 17 },
        ),
      ],
    },
    {
      name: 'collar',
      surface: 'satin',
      seams: false,
      detail: 1.5,
      parts: [ring('collar', [0, 8.75, 0.25], 5.05, 0.5, MINT, { k: 0.1 })],
    },
    {
      name: 'bell',
      surface: 'metal',
      seams: false,
      detail: 2,
      parts: [ball('bell', [0, 8.05, 5.55], 0.9, '#f3cf62', { k: 0.1 })],
    },
    {
      name: 'blossom',
      surface: 'felt',
      seams: false,
      detail: 2,
      parts: blossom('blossom', lift(catBlossomSpot.p, catBlossomSpot.n, 0.18), catBlossomSpot.n, 14, 0.92, '#fffafc', LEMON),
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([4.95, 18.2, 1.05], [1.15, 1.75, 0.85], [0, 0, -24])), color: CAT_DEEP, stitch: true },
    { name: 'bib', channel: 1, fn: ellipsoid([0, 6.3, 4.9], [2.7, 3.0, 2.3]), color: '#fff7f4', stitch: '#f6d3dc' },
    { name: 'socks', channel: 2, fn: anyOf(bothSides(sphere([3.0, 1.3, 5.9], 2.35)), bothSides(sphere([5.3, 1.3, 4.7], 1.75))), color: '#fffaf7' },
    { name: 'tailTip', channel: 3, fn: sphere([-7.3, 2.4, 3.6], 2.3), color: CAT_DEEP },
  ],
  patches: [
    ...eyes({ at: catFace(3.0, 13.2), r: 0.8, style: 'sparkle', tall: 1.12 }),
    { kind: 'poly', at: catFace(0, 12.35), outline: [[-0.46, 0.26], [0, 0.3], [0.46, 0.26], [0.12, -0.24], [0, -0.32], [-0.12, -0.24]], color: '#ff7fa5', surface: 'thread', dome: 0.3, lift: 0.05 },
    ...wMouth(catFace(0, 11.98), 0.85, 0.38, 0.15),
    // Whiskers.
    { kind: 'stroke', points: [catFace(4.5, 12.25), catFace(5.5, 12.45), catFace(6.4, 12.75)], width: 0.11, color: '#e58fa8', surface: 'thread', mirror: true, taper: true },
    { kind: 'stroke', points: [catFace(4.5, 11.75), catFace(5.5, 11.6), catFace(6.3, 11.35)], width: 0.11, color: '#e58fa8', surface: 'thread', mirror: true, taper: true },
    blush(catFace(4.75, 11.15), 0.95, 0.6, '#ffaec4'),
    // A single petal on the forehead.
    { kind: 'poly', at: catFace(0, 16.45), outline: heartOutline(0.72), color: CAT_DEEP, surface: 'felt', lift: 0.04 },
    sideTag(4.2, 5.9, ROSE),
  ],
  deform: { sag: 0.6, sway: 0.75, squash: 0.6 },
};

/* ---------------------------------------------------------------- capybara */

const CAPY = '#dcb184';
const CAPY_DARK = '#b98b62';
const CAPY_INK = '#7a5642';
const CAPY_HEAD_C: V3 = [0, 10.9, 3.2];
const YUZU = '#ffd95a';

export const capybara: PlushDesign = {
  slug: 'capybara',
  theme: 'sakura',
  name: { en: 'Yuzu Capy', zh: '柚子水豚', ja: 'ゆずカピバラ' },
  kind: { en: 'sleepy capybara balancing a yuzu on its head', zh: '头顶柚子的瞌睡水豚', ja: '頭にゆずをのせた眠そうなカピバラ' },
  status: 'original',
  note: 'Original character.',
  height: 20.2,
  mass: 0.29,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.5,
      parts: [
        // A long, low loaf of a body with the big head carried forward.
        ell('body', [0, 6.1, -2.1], [6.8, 6.0, 7.5], CAPY, { collide: 'core', k: 2.6 }),
        box('head', CAPY_HEAD_C, [5.5, 4.5, 5.0], 3.0, CAPY, { collide: 'core', k: 2.8 }),
        // The blunt, boxy muzzle.
        box('snout', [0, 9.3, 7.7], [3.5, 2.75, 2.5], 1.9, CAPY, { k: 1.6, piece: 'head', group: 'head' }),
        ...pair(ell('ear', [4.15, 15.2, 1.7], [1.3, 1.15, 0.8], CAPY, { k: 0.6, soft: 0.5, collide: 'none', group: 'head' })),
        ...pair(ell('pawF', [3.4, 1.4, 5.5], [2.1, 1.6, 2.6], CAPY, { soft: 0.3, k: 1.1, collide: 'none', group: 'body' })),
        ...pair(ell('pawB', [4.3, 1.5, -5.2], [2.2, 1.7, 2.6], CAPY, { soft: 0.3, k: 1.1, collide: 'none', group: 'body' })),
      ],
    },
    {
      name: 'yuzu',
      surface: 'shortfur',
      seams: false,
      detail: 1.4,
      parts: [
        ell('yuzu', [0, 17.25, 2.9], [2.45, 2.15, 2.45], YUZU, { collide: 'appendage', k: 0.3, soft: 0.25 }),
        ball('yuzuDimple', [0, 19.65, 2.9], 0.55, YUZU, { subtract: true, k: 0.5 }),
      ],
    },
    {
      name: 'leaf',
      surface: 'felt',
      seams: false,
      detail: 2,
      parts: [
        cyl('stem', [0.05, 19.45, 2.9], 0.2, 0.42, 0.1, '#8a6a45', { k: 0.05 }),
        part('leaf', scaled(roundCone([0.2, 19.65, 2.9], [2.5, 19.95, 3.1], 0.95, 0.3), [1.2, 19.75, 3.0], [1, 0.26, 1]), '#8fd6a6', {
          k: 0.08,
          soft: 0.7,
          root: [0.2, 19.65, 2.9],
          reach: 2.6,
        }),
      ],
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([4.15, 15.2, 2.35], [0.8, 0.72, 0.6])), color: CAPY_DARK },
    { name: 'chest', channel: 1, fn: ellipsoid([0, 3.6, 5.2], [3.8, 3.1, 2.8]), color: '#efd6b4', stitch: '#d9b78c' },
    { name: 'toes', channel: 2, fn: anyOf(bothSides(sphere([3.4, 1.2, 7.9], 1.25)), bothSides(sphere([4.5, 1.2, -7.6], 1.25))), color: CAPY_DARK },
  ],
  patches: [
    // Sleepy closed eyes high on the head, above the muzzle.
    ...eyes({ at: [3.4, 13.05, 8.0], r: 0.86, style: 'sleepy', color: CAPY_INK }),
    // Nostrils and the little split mouth on the front of the muzzle.
    { kind: 'disc', at: [1.05, 10.55, 10.15], rx: 0.3, ry: 0.22, color: CAPY_INK, surface: 'thread', mirror: true, lift: 0.04, dome: 0.2 },
    { kind: 'stroke', points: [[0, 9.9, 10.2], [0, 9.3, 10.25], [0, 8.8, 10.2]], width: 0.15, color: CAPY_INK, surface: 'thread' },
    smile([0, 8.78, 10.2], 0.95, 0.3, 0.16, CAPY_INK),
    blush([4.6, 10.4, 7.2], 1.0, 0.68, '#ffb7c2'),
    sideTag(4.6, 6.7, '#ffb24d'),
  ],
  deform: { sag: 0.45, sway: 0.4, squash: 0.7 },
};

/* ------------------------------------------------------------------ tanuki */

const TAN = '#c9a37c';
const TAN_MASK = '#80604a';
const TAN_PALE = '#fbead0';
const TAN_TIP = '#735240';
const TANUKI_HEAD_C: V3 = [0, 13.7, 0.4];
const TANUKI_HEAD_R: V3 = [7.3, 6.0, 6.8];
const tanukiFace = (x: number, y: number, push = 0.05) => onFront(TANUKI_HEAD_C, TANUKI_HEAD_R, x, y, push);
const tanukiLeafSpot = onEllipsoid(TANUKI_HEAD_C, TANUKI_HEAD_R, [1.3, 5.6, 1.5]);
const tanukiLeaf = frame(lift(tanukiLeafSpot.p, tanukiLeafSpot.n, 0.32), tanukiLeafSpot.n, 24);

export const tanuki: PlushDesign = {
  slug: 'tanuki',
  theme: 'sakura',
  name: { en: 'Pon Tanuki', zh: '砰砰狸猫', ja: 'ぽんぽこたぬき' },
  kind: { en: 'round-bellied tanuki with a lucky leaf on its head', zh: '头顶树叶的圆肚子狸猫', ja: '頭に葉っぱをのせたまんまるおなかのたぬき' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        // Body, feet and tail follow the generated model (deeper tummy, feet reaching forward, a big
        // tail lying on the floor behind), so the collision hulls match what is drawn.
        ell('body', [0, 5.9, 0.3], [6.7, 6.2, 7.0], TAN, { collide: 'core', k: 2.3 }),
        ell('head', TANUKI_HEAD_C, TANUKI_HEAD_R, TAN, { collide: 'core', k: 2.5 }),
        // Fluffy cheek tufts give the wide tanuki face.
        ...pair(cone('tuft', [5.5, 12.0, 0.9], [7.3, 11.0, 0.7], 1.9, 1.05, TAN, { k: 1.4, soft: 0.45, piece: 'head', group: 'head', collide: 'none' })),
        ...pair(ell('ear', [4.5, 18.5, 0.1], [2.0, 2.1, 1.0], TAN, { k: 0.9, soft: 0.5, collide: 'none', group: 'head' })),
        // Paws resting on the tummy, ready to drum.
        ...pair(cone('arm', [5.7, 9.0, 2.0], [4.9, 6.3, 5.3], 1.6, 1.75, TAN, { soft: 0.4, k: 1.3, collide: 'none', group: 'body' })),
        ...pair(ell('foot', [3.7, 1.7, 6.0], [2.4, 1.8, 3.4], TAN, { soft: 0.3, k: 1.2, collide: 'none', group: 'body' })),
        ell('tail', [4.4, 4.7, -9.2], [3.4, 5.8, 3.6], TAN, { rot: [-58, 0, -24], k: 1.6, soft: 0.7, collide: 'appendage', root: [2.2, 3.0, -5.2], reach: 11 }),
      ],
    },
    {
      name: 'leaf',
      surface: 'felt',
      seams: false,
      detail: 2,
      parts: [
        part('leaf', tanukiLeaf.wrap(flatZ(roundCone([-1.5, 0, 0], [1.7, 0, 0], 1.3, 0.32), 0.2)), '#86d19b', { k: 0.05, soft: 0.6 }),
        part('leafStem', tanukiLeaf.wrap(roundCone([-2.0, 0, 0.05], [-3.0, 0.15, 0.12], 0.2, 0.16)), '#6fbf86', { k: 0.1, soft: 0.6 }),
      ],
    },
  ],
  paints: [
    { name: 'mask', channel: 0, fn: bothSides(ellipsoid([3.15, 13.85, 6.0], [2.55, 1.8, 1.9], [0, 0, -18])), color: TAN_MASK },
    { name: 'muzzle', channel: 1, fn: anyOf(ellipsoid([0, 11.85, 6.4], [2.75, 2.1, 1.9]), ellipsoid([0, 15.4, 5.7], [0.95, 2.4, 1.9])), color: TAN_PALE },
    { name: 'belly', channel: 2, fn: ellipsoid([0, 5.5, 5.7], [3.9, 4.1, 2.5]), color: TAN_PALE, stitch: '#e3c9a0' },
    {
      name: 'tips',
      channel: 3,
      fn: anyOf(bothSides(sphere([4.9, 20.0, 0.1], 1.55)), sphere([4.6, 7.4, -13.4], 3.2), bothSides(sphere([3.7, 1.4, 8.8], 1.5)), bothSides(sphere([4.75, 6.0, 5.9], 1.45))),
      color: TAN_TIP,
    },
  ],
  patches: [
    ...eyes({ at: tanukiFace(2.95, 13.85), r: 0.78, style: 'sparkle' }),
    nose(tanukiFace(0, 12.75), 0.56, 0.4, '#4d362b'),
    ...wMouth(tanukiFace(0, 12.25), 0.85, 0.38, 0.15, '#4d362b'),
    blush(tanukiFace(5.0, 11.75), 0.95, 0.62, '#ffb7c5'),
    // Leaf vein.
    { kind: 'stroke', layer: 'leaf', points: [tanukiLeaf.point([-1.9, 0, 0.3]), tanukiLeaf.point([0, 0, 0.3]), tanukiLeaf.point([1.6, 0, 0.2])], width: 0.2, color: '#4f9a69', surface: 'thread', taper: true },
    sideTag(4.8, 6.6, '#86d19b'),
  ],
  deform: { sag: 0.55, sway: 0.7, squash: 0.65 },
};

/* ----------------------------------------------------------------- monster */

const MON_SPOT = '#7fd8bd';
const MON_C: V3 = [0, 7.1, 0];
const MON_R: V3 = [7.4, 7.3, 7.0];
const monFace = (x: number, y: number, push = 0.05) => onFront(MON_C, MON_R, x, y, push);

export const monster: PlushDesign = {
  slug: 'monster',
  theme: 'sakura',
  name: { en: 'Marumon', zh: '圆滚滚小怪兽', ja: 'まるもん' },
  kind: { en: 'round mint monster with tiny horns and one tooth', zh: '长着小角和一颗牙的薄荷色圆球怪兽', ja: '小さなツノと一本歯のミント色まんまるモンスター' },
  status: 'original',
  note: 'Original character.',
  height: 17.5,
  mass: 0.24,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.6,
      parts: [
        ell('body', MON_C, MON_R, MINT, { collide: 'core', k: 2.0 }),
        ...pair(cone('horn', [3.2, 13.1, 0.7], [4.2, 15.9, 0.5], 1.35, 0.72, CREAM, { soft: 0.5, k: 0.7, collide: 'appendage' })),
        // A soft lemon crest running down the back.
        cone('crestA', [0, 14.0, -1.6], [0, 15.8, -2.2], 0.95, 0.42, LEMON, { soft: 0.6, k: 0.6, collide: 'none' }),
        cone('crestB', [0, 13.0, -3.9], [0, 14.6, -5.0], 0.95, 0.42, LEMON, { soft: 0.6, k: 0.6, collide: 'none' }),
        cone('crestC', [0, 11.1, -5.7], [0, 12.2, -7.2], 0.9, 0.4, LEMON, { soft: 0.6, k: 0.6, collide: 'none' }),
        // Little two-lobed wings.
        ...pairGrouped(ell('wing', [8.4, 10.1, -2.8], [3.0, 2.15, 0.52], PINK, { rot: [0, -18, 30], k: 0.5, soft: 0.8, collide: 'appendage', root: [6.3, 9.6, -2.6], reach: 4.8 }), 'wing'),
        // Scalloped trailing edge, like a tiny bat wing.
        ...pair(ball('wingCutA', [8.05, 7.75, -2.8], 1.0, PINK, { subtract: true, k: 0.25 })),
        ...pair(ball('wingCutB', [10.0, 8.45, -3.0], 1.0, PINK, { subtract: true, k: 0.25 })),
        ...pair(ell('arm', [6.5, 6.4, 3.3], [1.5, 1.9, 1.5], MINT, { rot: [0, 0, -22], k: 1.0, soft: 0.4, collide: 'none', group: 'body' })),
        ...pair(ell('foot', [3.4, 1.3, 5.5], [2.3, 1.5, 2.7], MINT, { soft: 0.3, k: 1.0, collide: 'none', group: 'body' })),
        cone('tail', [0, 2.7, -6.0], [0, 4.6, -9.0], 1.5, 0.5, MINT, { soft: 0.7, k: 1.0, collide: 'appendage' }),
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 4.9, 6.5], [4.2, 3.6, 2.7]), color: '#fff6e2', stitch: '#e9dcb4' },
    {
      name: 'spots',
      channel: 1,
      fn: anyOf(sphere([-4.9, 12.2, 3.1], 1.3), sphere([-2.6, 13.9, 1.6], 0.75), sphere([5.6, 11.5, 2.0], 0.95), sphere([-5.5, 9.0, -4.0], 1.4), sphere([3.6, 12.0, -4.6], 1.2), sphere([5.9, 5.0, -3.6], 1.1)),
      color: MON_SPOT,
    },
    { name: 'toes', channel: 2, fn: bothSides(ellipsoid([3.4, 1.4, 8.0], [1.5, 1.0, 1.0])), color: '#fff6e2' },
  ],
  patches: [
    ...eyes({ at: monFace(2.9, 10.1), r: 1.0, style: 'sparkle', tall: 1.08 }),
    smile(monFace(0, 8.3), 2.5, 0.72, 0.2, INK),
    // One proud tooth.
    { kind: 'poly', at: monFace(1.35, 7.25), outline: [[-0.55, 0.42], [0.55, 0.42], [0.16, -0.5], [0, -0.58], [-0.16, -0.5]], color: '#ffffff', surface: 'felt', dome: 0.28, lift: 0.05 },
    blush(monFace(4.9, 8.6), 1.05, 0.7, BLUSH),
    sideTag(5.2, 7.2, ROSE),
  ],
  deform: { sag: 0.5, sway: 0.7, squash: 0.8 },
};

export const sakuraDesigns: PlushDesign[] = [bunny, biribi, sakuracat, capybara, tanuki, monster];
