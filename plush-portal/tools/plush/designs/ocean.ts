/**
 * Ocean Dream — pearl white, sea-salt blue, light purple and soft aqua.
 * Sleepy, rounded sea creatures in huggable plush form. Every toy sits upright
 * on a wide flat base and keeps a rounded top the claw can close around.
 */
import {
  anyOf,
  ball,
  blush,
  bothSides,
  cone,
  ell,
  ellipsoid,
  eyes,
  nose,
  ovalOutline,
  pair,
  part,
  pipe,
  roundBox,
  roundCone,
  smile,
  sphere,
  starOutline,
  torus,
  wMouth,
  type DistFn,
  type PartDef,
  type PartOptions,
  type PatchDef,
  type PlushDesign,
  type V3,
} from '../dsl';
import { scaled, smax } from '../sdf';

const DEG = Math.PI / 180;

const PEARL = '#f7f3ee';
const SEA_BLUE = '#9fcdea';
const LILAC = '#c9b6f2';
const AQUA = '#a6e2e4';
const ROSE = '#f6b3cc';
const INK = '#2f2a3c';

/* ----------------------------------------------------------------- helpers */

/** z of the front (+1) or back (−1) surface of an ellipsoid at (x, y). */
function zOn(center: V3, radii: V3, x: number, y: number, side = 1): number {
  const u = 1 - ((x - center[0]) / radii[0]) ** 2 - ((y - center[1]) / radii[1]) ** 2;
  return center[2] + side * radii[2] * Math.sqrt(Math.max(0.02, u));
}

/** Cylindrical coordinates around the vertical axis: 0° = front (+Z), 90° = the toy's +X side. */
function polar(rho: number, y: number, deg: number): V3 {
  return [rho * Math.sin(deg * DEG), y, rho * Math.cos(deg * DEG)];
}

/** Keeps only the part of a shape above `yCut` (rounded edge of radius ~k). */
function cutBelow(fn: DistFn, yCut: number, k: number): DistFn {
  return (x, y, z) => smax(fn(x, y, z), yCut - y, k);
}

/** Keeps only the part of a shape behind `zCut`. */
function cutFront(fn: DistFn, zCut: number, k: number): DistFn {
  return (x, y, z) => smax(fn(x, y, z), z - zCut, k);
}

/** Horizontal ring whose radius ripples in and out: a scalloped frill. */
function scallopRing(center: V3, ringRadius: number, tubeRadius: number, lobes: number, depth: number, tall = 1): DistFn {
  const [cx, cy, cz] = center;
  return (x, y, z) => {
    const dx = x - cx, dz = z - cz;
    const a = Math.atan2(dx, dz);
    const rr = ringRadius + depth * Math.cos(lobes * a);
    return Math.hypot(Math.hypot(dx, dz) - rr, (y - cy) / tall) - tubeRadius;
  };
}

/** A limb given as [rho, y, radius] stations in a vertical plane at azimuth `az`, optionally spiralling sideways. */
function radialArm(name: string, az: number, curl: number, profile: [number, number, number][], twist: number[], color: string, o: PartOptions): PartDef {
  const points = profile.map(([rho, y], i) => polar(rho, y, az + curl * (twist[i] ?? 0)));
  return pipe(name, points, profile.map((p) => p[2]), color, o);
}

/** Like `pair`, but both sides get their own collider group "<group>R" / "<group>L". */
function sidePair(p: PartDef, group: string): PartDef[] {
  const [right, left] = pair(p);
  return [
    { ...right!, group: `${group}R` },
    { ...left!, group: `${group}L` },
  ];
}

/** Small sewn-on dot (cheap polygon instead of a full disc patch). */
function dot(at: V3, r: number, color: string, mirror = true, layer?: string): PatchDef {
  return { kind: 'poly', at, outline: ovalOutline(r, r, 8), color, surface: 'felt', mirror, lift: 0.03, layer };
}

/** Lifts embroidery a little higher so it stays readable above long shell fur. */
function raised<T extends PatchDef>(patch: T, lift = 0.06): T {
  return patch.kind === 'tag' ? patch : { ...patch, lift };
}

/** Closed, smiling "⌒" eyes as bold embroidered arcs (mirrored pair). */
function arcEyes(at: (x: number, y: number) => V3, x: number, y: number, r: number, width: number): PatchDef {
  const points: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6 - 0.5;
    points.push(at(x + t * 2 * r, y + (0.25 - t * t) * r * 1.5));
  }
  return { kind: 'stroke', points, width, color: INK, surface: 'thread', mirror: true, taper: true, lift: 0.07 };
}

/* ------------------------------------------------------------------- whale */

const WHALE_C: V3 = [0, 6.0, 0.2];
const WHALE_R: V3 = [8.0, 8.6, 8.6];
const whaleSmileY = (x: number) => 5.5 + 0.05 * x * x;
const whaleBellyBlob = ellipsoid([0, 3.0, 4.6], [7.4, 6.6, 6.8]);
/** Pale belly whose upper border is the whale's long smile. */
const whaleBelly: DistFn = (x, y, z) => Math.max(whaleBellyBlob(x, y, z), (y - whaleSmileY(x)) / Math.sqrt(1 + (0.1 * x) ** 2));
const whaleFront = (x: number, y: number): V3 => [x, y, zOn(WHALE_C, WHALE_R, x, y) + 0.1];

function whalePleats(): PatchDef[] {
  const out: PatchDef[] = [];
  for (const x0 of [-3.6, -1.8, 0, 1.8, 3.6]) {
    const top = whaleSmileY(x0) - 0.85;
    const points: V3[] = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      points.push(whaleFront(x0 * (1 - 0.14 * t), top + (0.9 - top) * t));
    }
    out.push({ kind: 'stroke', points, width: 0.16, color: '#cbd9e6', surface: 'thread', taper: true });
  }
  return out;
}

function whaleMouth(): PatchDef {
  const points: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = -5.3 + (10.6 * i) / 10;
    points.push(whaleFront(x, whaleSmileY(x)));
  }
  return { kind: 'stroke', points, width: 0.22, color: '#46698a', surface: 'thread', taper: true, lift: 0.06 };
}

export const whale: PlushDesign = {
  slug: 'whale',
  theme: 'ocean',
  name: { en: 'Bubble Whale', zh: '泡泡鲸', ja: 'あわくじら' },
  kind: { en: 'chubby sea-salt blue whale', zh: '圆滚滚的海盐蓝鲸鱼', ja: 'まんまるな水色のくじら' },
  status: 'original',
  note: 'Original character.',
  height: 18,
  mass: 0.3,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.6,
      // Junction seams are left off: with the current seam rendering they read as hairline cracks.
      parts: [
        ell('body', WHALE_C, WHALE_R, SEA_BLUE, { collide: 'core', k: 2.4 }),
        ...pair(
          ell('flipper', [8.3, 4.5, 2.2], [1.05, 3.0, 2.2], SEA_BLUE, {
            rot: [0, 0, 38],
            soft: 0.75,
            collide: 'appendage',
            k: 1.1,
            root: [7.2, 6.4, 2.0],
            reach: 5.5,
          }),
        ),
        cone('tail', [0, 4.2, -6.6], [0, 9.4, -10.0], 2.7, 1.5, SEA_BLUE, { soft: 0.7, collide: 'appendage', k: 2.0, group: 'tail', piece: 'tail' }),
        ...pair(
          ell('fluke', [2.7, 10.4, -10.4], [3.0, 0.95, 1.9], SEA_BLUE, {
            rot: [15, -15, 20],
            soft: 0.9,
            collide: 'appendage',
            k: 1.2,
            group: 'tail',
            piece: 'tail',
            root: [0, 9.4, -10.0],
            reach: 5,
          }),
        ),
      ],
    },
    {
      name: 'spout',
      surface: 'shortfur',
      seams: false,
      detail: 2,
      budget: 800,
      parts: [
        cone('spoutStem', [0, 14.0, 0.2], [0, 15.9, 0.2], 0.62, 0.5, PEARL, { soft: 0.8, k: 0.35, reach: 4 }),
        ...pair(
          pipe(
            'spoutArc',
            [
              [0, 15.7, 0.2],
              [0.55, 16.8, 0.2],
              [1.35, 17.35, 0.2],
              [2.25, 17.25, 0.2],
              [2.8, 16.55, 0.2],
            ],
            [0.48, 0.5, 0.52, 0.56, 0.6],
            AQUA,
            { soft: 0.95, k: 0.35, root: [0, 14.2, 0.2], reach: 5 },
          ),
        ),
        ...pair(ball('spoutDrop', [2.95, 16.0, 0.2], 0.82, AQUA, { soft: 0.95, k: 0.5, root: [0, 14.2, 0.2], reach: 5 })),
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: whaleBelly, color: PEARL, stitch: '#d5dfe8' },
    {
      name: 'speckles',
      channel: 1,
      fn: anyOf(
        sphere([-3.2, 13.2, -2.6], 1.15),
        sphere([2.6, 13.9, -1.4], 0.95),
        sphere([4.9, 11.0, -4.4], 1.05),
        sphere([-5.2, 10.2, -4.0], 0.9),
        sphere([0.4, 12.2, -5.6], 1.2),
        sphere([-2.0, 8.6, -7.6], 0.95),
      ),
      color: '#c3e1f3',
    },
  ],
  patches: [
    ...eyes({ at: whaleFront(4.3, 8.9), r: 0.72, style: 'sparkle' }),
    blush(whaleFront(5.9, 8.0), 0.95, 0.55, ROSE),
    whaleMouth(),
    ...whalePleats(),
    { kind: 'tag', at: [-7.4, 3.0, -0.5], out: [-1, -0.25, -0.1], color: '#ffffff', accent: SEA_BLUE },
  ],
  deform: { sag: 0.5, sway: 0.7, squash: 0.7 },
};

/* ----------------------------------------------------------------- octopus */

const OCTO_C: V3 = [0, 10.6, 0];
const OCTO_R: V3 = [7.1, 7.3, 6.9];
const OCTO_ARM: [number, number, number][] = [
  [3.4, 3.2, 2.1],
  [5.7, 1.9, 1.9],
  [7.6, 1.55, 1.55],
  [8.9, 1.9, 1.25],
  [9.5, 3.0, 1.0],
  [9.4, 4.1, 0.85],
];
/** Sideways sweep (degrees) along an arm; arms on the same side sweep the same way so tips never cross. */
const OCTO_TWIST = [0, 0, 3, 7, 11, 14];
const octoFront = (x: number, y: number): V3 => [x, y, zOn(OCTO_C, OCTO_R, x, y) + 0.1];

function octoArms(): PartDef[] {
  const arms: PartDef[] = [];
  for (let i = 0; i < 8; i++) {
    const az = 22.5 + 45 * i;
    arms.push(
      radialArm(`arm${i}`, az, i < 4 ? 1 : -1, OCTO_ARM, OCTO_TWIST, LILAC, {
        soft: 0.85,
        collide: 'appendage',
        k: 1.4,
        piece: 'arms',
        group: `arms${'ABCD'[Math.floor(i / 2)]}`,
      }),
    );
  }
  return arms;
}

/** Sucker dots on the outward side of the upturned tips of the two front-right arms (mirrored to the left). */
function octoSuckers(): PatchDef[] {
  const out: PatchDef[] = [];
  for (const i of [0, 1]) {
    const az = 22.5 + 45 * i;
    const at = (rho: number, y: number, k: number): V3 => polar(rho, y, az + OCTO_TWIST[k]!);
    out.push(dot(at(10.05, 2.0, 3), 0.4, '#fde6ef'), dot(at(10.45, 3.1, 4), 0.36, '#fde6ef'), dot(at(10.2, 4.25, 5), 0.3, '#fde6ef'));
  }
  return out;
}

function octoMouth(): PatchDef {
  const points: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    points.push(octoFront(Math.cos(a) * 0.5, 8.45 + Math.sin(a) * 0.48));
  }
  return { kind: 'stroke', points, width: 0.2, color: '#5c4691', surface: 'thread', closed: true, lift: 0.06 };
}

export const octopus: PlushDesign = {
  slug: 'octopus',
  theme: 'ocean',
  name: { en: 'Pom Octopus', zh: '啵啵章鱼', ja: 'ぽむたこ' },
  kind: { en: 'lavender octopus with curly arms', zh: '卷卷触手的薰衣草紫章鱼', ja: 'くるくる足のラベンダー色のたこ' },
  status: 'original',
  note: 'Original character.',
  height: 18,
  mass: 0.22,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.2,
      // Junction seams are left off: with the current seam rendering they read as hairline cracks.
      parts: [
        ell('head', OCTO_C, OCTO_R, LILAC, { collide: 'core', k: 2.6, group: 'body', piece: 'mantle' }),
        ell('base', [0, 2.8, 0], [5.4, 3.4, 5.4], LILAC, { collide: 'core', k: 2.2, group: 'body', piece: 'mantle' }),
        ...octoArms(),
      ],
    },
  ],
  paints: [
    {
      name: 'spots',
      channel: 0,
      fn: anyOf(
        ellipsoid([-3.6, 15.8, 2.6], [1.5, 1.5, 1.5]),
        ellipsoid([3.9, 16.2, -0.6], [1.2, 1.2, 1.2]),
        ellipsoid([-1.2, 17.3, -2.4], [1.3, 1.3, 1.3]),
        ellipsoid([4.6, 13.2, -4.6], [1.4, 1.4, 1.4]),
        ellipsoid([-5.2, 12.6, -3.8], [1.2, 1.2, 1.2]),
      ),
      color: '#e4d9fb',
    },
  ],
  patches: [
    ...eyes({ at: octoFront(2.7, 10.3), r: 0.95, style: 'sparkle', tall: 1.12 }),
    blush(octoFront(4.7, 8.8), 0.95, 0.6, ROSE),
    octoMouth(),
    ...octoSuckers(),
    { kind: 'tag', at: [-5.6, 4.2, 0], out: [-1, -0.2, 0], color: '#ffffff', accent: LILAC },
  ],
  deform: { sag: 0.6, sway: 0.85, squash: 0.65 },
};

/* ----------------------------------------------------------------- axolotl */

const AX_PINK = '#f7cfe0';
const AX_GILL = '#b99cf0';
const AX_HEAD_C: V3 = [0, 12.6, 0.6];
const AX_HEAD_R: V3 = [7.0, 5.5, 6.1];
const axFront = (x: number, y: number): V3 => [x, y, zOn(AX_HEAD_C, AX_HEAD_R, x, y) + 0.1];
const AX_GILL_ROOT: V3 = [6.0, 13.4, -0.8];

function axGill(name: string, tip: V3): PartDef[] {
  const center: V3 = [(AX_GILL_ROOT[0] + tip[0]) / 2, (AX_GILL_ROOT[1] + tip[1]) / 2, (AX_GILL_ROOT[2] + tip[2]) / 2];
  return sidePair(
    part(name, scaled(roundCone(AX_GILL_ROOT, tip, 1.1, 0.85), center, [1, 1, 0.75]), AX_GILL, {
      soft: 0.85,
      collide: 'appendage',
      k: 0.9,
      root: AX_GILL_ROOT,
      reach: 5.2,
    }),
    'gill',
  );
}

const AX_TAIL: V3[] = [
  [0, 2.3, -4.6],
  [3.8, 1.9, -6.6],
  [7.0, 1.4, -4.6],
  [8.2, 0.95, -1.2],
];
const AX_TAIL_TIP: V3[] = [
  [8.2, 0.95, -1.2],
  [7.9, 0.7, 1.7],
];

export const axolotl: PlushDesign = {
  slug: 'axolotl',
  theme: 'ocean',
  name: { en: 'Dewy Axolotl', zh: '露露蝾螈', ja: 'つゆウーパー' },
  kind: { en: 'pink axolotl with lilac gills', zh: '长着淡紫外鳃的粉色蝾螈', ja: 'ラベンダーのエラをもつピンクのウーパールーパー' },
  status: 'original',
  note: 'Original character.',
  height: 19,
  mass: 0.21,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.3,
      // Junction seams are left off: with the current seam rendering they read as hairline cracks.
      parts: [
        ell('body', [0, 4.4, 0], [5.9, 6.0, 5.5], AX_PINK, { collide: 'core', k: 2.2 }),
        ell('head', AX_HEAD_C, AX_HEAD_R, AX_PINK, { collide: 'core', k: 2.2 }),
        ...axGill('gillUp', [8.9, 17.8, -1.2]),
        ...axGill('gillMid', [10.5, 14.2, -1.0]),
        ...axGill('gillLow', [9.5, 10.5, -0.6]),
        ...pair(cone('arm', [4.6, 8.0, 2.6], [6.2, 5.4, 4.5], 1.5, 1.6, AX_PINK, { soft: 0.5, k: 1.2 })),
        ...pair(ell('foot', [3.4, 1.5, 4.5], [2.2, 1.6, 2.9], AX_PINK, { soft: 0.3, k: 1.1 })),
        part('tail', scaled(pipe('t', AX_TAIL, [2.3, 1.9, 1.4, 0.95], AX_PINK).fn, [4, 0, -3], [1, 1.4, 1]), AX_PINK, {
          soft: 0.8,
          collide: 'appendage',
          k: 1.6,
          root: [0, 3, -4.6],
          reach: 14,
        }),
        part('tailTip', scaled(pipe('t', AX_TAIL_TIP, [0.95, 0.68], AX_GILL).fn, [4, 0, -3], [1, 1.4, 1]), AX_GILL, {
          soft: 0.95,
          k: 0.6,
          piece: 'tail',
          group: 'tail',
          root: [0, 3, -4.6],
          reach: 14,
        }),
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 4.5, 5.0], [3.3, 3.7, 2.4]), color: '#fff0f4', stitch: '#f1c9d8' },
    {
      name: 'backSpots',
      channel: 1,
      fn: anyOf(sphere([0, 16.2, -3.9], 0.95), sphere([0, 9.6, -5.3], 1.05), sphere([0, 5.6, -5.6], 0.95), bothSides(sphere([3.0, 16.7, -2.6], 0.8))),
      color: '#e6c3ef',
    },
  ],
  patches: [
    ...eyes({ at: axFront(4.2, 13.3), r: 0.6, style: 'bead' }),
    raised(smile(axFront(0, 11.9), 3.2, 0.55, 0.2, '#7a4a63')),
    blush(axFront(5.3, 11.7), 0.9, 0.55, '#f59dbd'),
    dot(axFront(1.3, 15.9), 0.2, '#f3a9c6'),
    dot(axFront(2.6, 16.1), 0.17, '#f3a9c6'),
    { kind: 'tag', at: [-5.7, 3.8, 0.4], out: [-1, -0.25, 0.1], color: '#ffffff', accent: AX_GILL },
  ],
  deform: { sag: 0.6, sway: 0.9, squash: 0.6 },
};

/* --------------------------------------------------------------- jellyfish */

const JELLY_C: V3 = [0, 10.8, 0];
const JELLY_R: V3 = [7.5, 7.7, 7.5];
const JELLY_ARM: [number, number, number][] = [
  [3.2, 8.8, 1.6],
  [4.4, 5.8, 1.55],
  [5.3, 3.2, 1.45],
  [6.9, 1.5, 1.3],
  [8.4, 1.25, 1.1],
  [9.3, 2.0, 0.92],
  [9.4, 3.2, 0.8],
];
const JELLY_TWIST = [0, 4, 8, 12, 15, 17, 18];
const jellyFront = (x: number, y: number): V3 => [x, y, zOn(JELLY_C, JELLY_R, x, y) + 0.1];

function jellyArms(): PartDef[] {
  const arms: PartDef[] = [];
  for (let i = 0; i < 8; i++) {
    // Mirror-symmetric colours: lilac / pearl alternate from the front pair backwards.
    const lilac = Math.min(i, 7 - i) % 2 === 0;
    arms.push(
      radialArm(`arm${i}`, 22.5 + 45 * i, i < 4 ? 1 : -1, JELLY_ARM, JELLY_TWIST, lilac ? '#cbbcf3' : '#f4f0fb', {
        soft: 0.9,
        collide: 'appendage',
        k: 1.2,
        group: `arms${'ABCD'[Math.floor(i / 2)]}`,
      }),
    );
  }
  return arms;
}

export const jellyfish: PlushDesign = {
  slug: 'jellyfish',
  theme: 'ocean',
  name: { en: 'Moon Jelly', zh: '月光水母', ja: 'つきくらげ' },
  kind: { en: 'aqua jellyfish with a frilly bell', zh: '花边伞盖的水色水母', ja: 'フリルのかさの水色くらげ' },
  status: 'original',
  note: 'Original character.',
  height: 18.5,
  mass: 0.19,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.1,
      // Junction seams are left off: with the current seam rendering they read as hairline cracks.
      parts: [
        part('bell', cutBelow(ellipsoid(JELLY_C, JELLY_R), 9.6, 1.2), AQUA, { collide: 'core', k: 1.6 }),
        part('frill', scallopRing([0, 9.5, 0], 7.3, 1.15, 10, 0.5), PEARL, { soft: 0.6, k: 0.8 }),
        ell('stalk', [0, 4.8, 0], [4.2, 5.6, 4.2], PEARL, { collide: 'core', k: 1.8, group: 'body' }),
        ...jellyArms(),
      ],
    },
  ],
  paints: [
    {
      name: 'spots',
      channel: 0,
      fn: anyOf(
        sphere([0.4, 18.2, 1.6], 1.25),
        sphere([-3.9, 16.6, 1.8], 1.3),
        sphere([3.7, 16.8, -1.6], 1.45),
        sphere([-1.0, 17.4, -3.6], 1.2),
        sphere([5.2, 14.2, -4.4], 1.3),
        sphere([-5.4, 14.0, -3.6], 1.4),
      ),
      color: '#effbfb',
    },
  ],
  patches: [
    arcEyes(jellyFront, 2.55, 13.2, 0.85, 0.34),
    raised(smile(jellyFront(0, 12.3), 0.9, 0.36, 0.26, '#3f6276'), 0.09),
    blush(jellyFront(4.3, 12.2), 0.95, 0.58, ROSE),
    { kind: 'tag', at: [-4.2, 5.2, -1.0], out: [-1, -0.2, -0.2], color: '#ffffff', accent: AQUA },
  ],
  deform: { sag: 0.7, sway: 1, squash: 0.75 },
};

/* -------------------------------------------------------------------- seal */

const SEAL_WHITE = '#f6f4f1';
const SEAL_HEAD_C: V3 = [0, 13.6, 1.0];
const SEAL_HEAD_R: V3 = [6.2, 5.5, 5.9];
const sealFront = (x: number, y: number): V3 => [x, y, zOn(SEAL_HEAD_C, SEAL_HEAD_R, x, y) + 0.1];
const SEAL_NECK: V3 = [0, 10.3, -0.1];
const SCARF = '#8ed8d4';

export const seal: PlushDesign = {
  slug: 'seal',
  theme: 'ocean',
  name: { en: 'Snowy Seal', zh: '雪团海豹', ja: 'ゆきあざらし' },
  kind: { en: 'white baby seal in an aqua scarf', zh: '围着水色围巾的白色小海豹', ja: '水色マフラーの白いあざらしの赤ちゃん' },
  status: 'original',
  note: 'Original character.',
  height: 19,
  mass: 0.26,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.5,
      parts: [
        ell('body', [0, 5.6, -0.4], [7.3, 7.4, 7.4], SEAL_WHITE, { collide: 'core', k: 3.4, piece: 'skin' }),
        ell('head', SEAL_HEAD_C, SEAL_HEAD_R, SEAL_WHITE, { collide: 'core', k: 3.6, piece: 'skin' }),
        ell('muzzle', [0, 12.3, 6.0], [2.7, 1.9, 1.9], SEAL_WHITE, { k: 1.3, piece: 'skin' }),
        ...pair(
          ell('flipper', [6.7, 5.0, 3.2], [1.15, 3.3, 2.3], SEAL_WHITE, {
            rot: [-20, 0, 30],
            soft: 0.75,
            collide: 'appendage',
            k: 1.2,
            root: [6.0, 7.4, 2.4],
            reach: 5.5,
          }),
        ),
        ...pair(
          ell('tailFin', [2.2, 1.3, -8.0], [2.3, 1.15, 3.2], SEAL_WHITE, {
            rot: [0, -18, 0],
            soft: 0.8,
            collide: 'appendage',
            k: 1.4,
            group: 'tail',
            piece: 'tail',
            root: [0, 2.0, -6.0],
            reach: 5,
          }),
        ),
      ],
    },
    {
      name: 'scarf',
      surface: 'knit',
      seams: false,
      detail: 1.5,
      budget: 2600,
      parts: [
        part('scarfRing', scaled(torus(SEAL_NECK, 6.1, 1.1), SEAL_NECK, [1, 1.3, 1.04]), SCARF, { k: 0.4, soft: 0.3 }),
        ball('scarfKnot', [2.4, 10.1, 6.3], 1.3, SCARF, { k: 0.5, soft: 0.4 }),
        part('scarfEnd', scaled(roundCone([2.6, 9.8, 6.4], [3.4, 6.2, 7.3], 1.15, 1.35), [3, 8, 6.9], [1, 1, 0.55]), SCARF, {
          soft: 0.9,
          k: 0.5,
          root: [2.6, 9.8, 6.4],
          reach: 4.5,
        }),
      ],
    },
  ],
  paints: [
    {
      name: 'spots',
      channel: 0,
      fn: anyOf(
        ellipsoid([-2.7, 18.2, -1.4], [1.3, 1.3, 1.3]),
        ellipsoid([2.9, 17.4, -2.8], [1.5, 1.5, 1.5]),
        ellipsoid([0.3, 14.4, -5.0], [1.3, 1.3, 1.3]),
        ellipsoid([-3.6, 8.2, -6.4], [1.7, 1.7, 1.7]),
        ellipsoid([3.4, 6.0, -7.0], [1.6, 1.6, 1.6]),
        ellipsoid([-0.6, 3.6, -7.6], [1.3, 1.3, 1.3]),
      ),
      color: '#d7e0ec',
    },
    {
      name: 'scarfStripes',
      channel: 1,
      layer: 'scarf',
      fn: anyOf(roundBox([3.2, 7.2, 7], [2.4, 0.3, 2.4], 0.05), roundBox([3.0, 8.4, 7], [2.4, 0.3, 2.4], 0.05)),
      color: PEARL,
    },
  ],
  patches: [
    ...eyes({ at: sealFront(2.75, 14.4), r: 0.95, style: 'sparkle', tall: 1.1 }),
    nose([0, 13.1, 8.0], 0.62, 0.42, '#3b3340'),
    ...wMouth([0, 12.55, 8.0], 0.9, 0.38, 0.18).map((p) => raised(p)),
    blush(sealFront(4.5, 12.9), 0.9, 0.55, '#f8c6d6'),
    dot([1.35, 12.45, 7.6], 0.14, '#6b6470'),
    dot([1.95, 12.1, 7.2], 0.14, '#6b6470'),
    dot([1.3, 11.75, 7.5], 0.14, '#6b6470'),
    dot(sealFront(2.3, 16.3), 0.22, '#8d8795'),
    { kind: 'tag', at: [-6.7, 3.6, 0], out: [-1, -0.3, 0.1], color: '#ffffff', accent: SCARF },
  ],
  deform: { sag: 0.55, sway: 0.75, squash: 0.7 },
};

/* ------------------------------------------------------------------ turtle */

const SKIN = '#b4e6c6';
const SHELL = '#c8b7f1';
const SCUTE = '#a9d5f0';
const PLASTRON = '#fdf4d8';
const TURTLE_HEAD_C: V3 = [0, 14.2, 1.0];
const TURTLE_HEAD_R: V3 = [6.2, 5.6, 5.9];
const SHELL_C: V3 = [0, 6.0, -2.4];
const SHELL_R: V3 = [7.5, 6.9, 5.7];
const turtleFront = (x: number, y: number): V3 => [x, y, zOn(TURTLE_HEAD_C, TURTLE_HEAD_R, x, y) + 0.1];
const shellBack = (x: number, y: number): V3 => [x, y, zOn(SHELL_C, SHELL_R, x, y, -1)];

function shellRing(): DistFn {
  const fns: DistFn[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (30 + 60 * i) * DEG;
    fns.push(sphere(shellBack(4.5 * Math.cos(a), 6.6 + 4.2 * Math.sin(a)), 1.75));
  }
  return anyOf(...fns);
}

export const turtle: PlushDesign = {
  slug: 'turtle',
  theme: 'ocean',
  name: { en: 'Pebble Turtle', zh: '鹅卵石海龟', ja: 'こいしがめ' },
  kind: { en: 'mint sea turtle with a lilac shell', zh: '背着淡紫龟壳的薄荷绿海龟', ja: 'ラベンダーのこうらのミント色うみがめ' },
  status: 'original',
  note: 'Original character.',
  height: 20,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.3,
      // Junction seams are left off: with the current seam rendering they read as hairline cracks.
      parts: [
        ell('body', [0, 4.6, 0.6], [5.7, 6.0, 5.2], SKIN, { collide: 'core', k: 2.0 }),
        ell('head', TURTLE_HEAD_C, TURTLE_HEAD_R, SKIN, { collide: 'core', k: 2.0 }),
        ...pair(
          ell('flipper', [6.4, 7.2, 3.0], [1.1, 3.2, 2.2], SKIN, {
            rot: [-25, 0, 42],
            soft: 0.7,
            collide: 'appendage',
            k: 1.2,
            root: [5.2, 9.0, 2.4],
            reach: 5.5,
          }),
        ),
        ...pair(ell('foot', [4.4, 1.3, 4.6], [2.3, 1.25, 3.0], SKIN, { rot: [0, 25, 0], soft: 0.5, k: 1.2 })),
        cone('tail', [0, 1.6, -7.6], [0, 1.2, -9.8], 1.1, 0.5, SKIN, { soft: 0.7, k: 0.8 }),
      ],
    },
    {
      name: 'shell',
      surface: 'shortfur',
      flatBase: 1.2,
      seams: false,
      parts: [
        part('shell', cutFront(ellipsoid(SHELL_C, SHELL_R), 1.2, 0.8), SHELL, { collide: 'core', group: 'body', k: 1.0 }),
        part('rim', scaled(torus([0, 6.0, 1.0], 6.95, 0.7, [90, 0, 0]), [0, 6.0, 1.0], [1.04, 0.96, 1]), '#efe9fb', { k: 0.5 }),
      ],
    },
  ],
  paints: [
    { name: 'plastron', channel: 0, fn: ellipsoid([0, 4.6, 5.0], [3.6, 4.0, 2.2]), color: PLASTRON, stitch: '#e6d7a6' },
    { name: 'scuteCentre', channel: 1, layer: 'shell', fn: sphere(shellBack(0, 6.6), 2.5), color: SCUTE, stitch: true },
    { name: 'scuteRing', channel: 2, layer: 'shell', fn: shellRing(), color: '#e6dcfb' },
  ],
  patches: [
    ...eyes({ at: turtleFront(2.6, 14.7), r: 0.72, style: 'bead' }),
    raised(smile(turtleFront(0, 13.3), 1.15, 0.44, 0.2, '#3f6b55')),
    blush(turtleFront(4.4, 13.3), 0.9, 0.55, ROSE),
    { kind: 'stroke', points: [[-2.3, 3.4, 5.9], [0, 3.3, 6.0], [2.3, 3.4, 5.9]], width: 0.15, color: '#e3d3a2', surface: 'thread', taper: true },
    { kind: 'stroke', points: [[-2.5, 5.8, 5.7], [0, 5.7, 5.9], [2.5, 5.8, 5.7]], width: 0.15, color: '#e3d3a2', surface: 'thread', taper: true },
    { kind: 'poly', at: [3.5, 18.3, 3.4], outline: starOutline(5, 1.25, 0.62), rot: 12, color: '#f8a9bf', surface: 'felt', dome: 0.12, lift: 0.05 },
    { kind: 'tag', at: [-5.4, 2.6, 1.9], out: [-1, -0.2, 0.15], color: '#ffffff', accent: SHELL },
  ],
  deform: { sag: 0.5, sway: 0.7, squash: 0.6 },
};

export const oceanDesigns: PlushDesign[] = [whale, octopus, axolotl, jellyfish, seal, turtle];

