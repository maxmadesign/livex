/**
 * Storybook Friends — warm coral, cream yellow, lake blue and soft purple.
 * Characterful toy friends in the spirit of a warm animated feature film:
 * clear silhouettes, expressive faces and a rich mix of materials.
 * All six characters are original designs.
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
  roundCylinder,
  smile,
  sphere,
  starOutline,
  torus,
  wMouth,
  type DistFn,
  type PartDef,
  type PatchDef,
  type PlushDesign,
  type V3,
} from '../dsl';
import { rotated, scaled, smax } from '../sdf';

const CORAL = '#ff8c70';
const CORAL_SOFT = '#ffa78f';
const CREAM = '#ffe9a8';
const MILK = '#fff6e2';
const BLUE = '#6ebcd9';
const BLUE_DEEP = '#4f9fc4';
const PURPLE = '#b8a2ea';
const PURPLE_DEEP = '#9783d6';
const INK = '#3a2a2e';
const PINK = '#ffb3b8';

/** Flattened teardrop standing on `base`: a soft dinosaur plate. `tilt` leans it back, `yaw` turns its plane. */
function plate(name: string, base: V3, length: number, radius: number, color: string, tilt: number, yaw = 0): PartDef {
  const tip: V3 = [base[0], base[1] + length, base[2]];
  const shape = scaled(roundCone(base, tip, radius, radius * 0.5), base, [0.42, 1, 1]);
  return part(name, rotated(shape, base, [tilt, yaw, 0]), color, { soft: 0.75, k: 0.3, root: base, reach: length + radius });
}

/** A band painted around a limb: a sphere centred on the limb axis, slightly larger than the limb. */
const band = (center: V3, r: number): DistFn => sphere(center, r);

/** Mirrors a part to both sides and puts each copy into the collider group `<groupBase>R` / `<groupBase>L`. */
function sided(p: PartDef, groupBase: string, samePiece = false): PartDef[] {
  const [right, left] = pair(p);
  return [
    { ...right!, group: `${groupBase}R`, piece: samePiece ? `${groupBase}R` : right!.piece },
    { ...left!, group: `${groupBase}L`, piece: samePiece ? `${groupBase}L` : left!.piece },
  ];
}

/* ------------------------------------------------------------- astronaut */

const SUIT = '#fbf8f1';
const SKIN = '#ffdcc0';

// Gold sun visor flipped up over the forehead: a thin shell that hugs the helmet.
const helmetOuter = ellipsoid([0, 13.9, 0.2], [7.3, 6.9, 7.0]);
const visorRegion = roundBox([0, 19.05, 4.9], [5.3, 1.8, 2.4], 0.8, [-48, 0, 0]);
const sunVisor: DistFn = (x, y, z) => smax(Math.abs(helmetOuter(x, y, z)) - 0.3, visorRegion(x, y, z), 0.35);

export const astronaut: PlushDesign = {
  slug: 'astronaut',
  theme: 'storybook',
  name: { en: 'Captain Comet', zh: '彗星小队长', ja: 'コメット隊長' },
  kind: { en: 'plush astronaut', zh: '毛绒宇航员', ja: 'ぬいぐるみ宇宙飛行士' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.25,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 4.7, 0], [6.4, 6.2, 5.5], SUIT, { collide: 'core', k: 2.0 }),
        ell('helmet', [0, 13.9, 0.2], [7.0, 6.6, 6.7], SUIT, { collide: 'core', k: 1.5, group: 'head' }),
        // The face opening: a shallow bowl carved into the front of the helmet.
        part('opening', ellipsoid([0, 13.6, 7.2], [5.4, 4.5, 2.2]), SKIN, { subtract: true, k: 0.5 }),
        ...pair(cone('arm', [5.3, 8.9, 1.0], [7.3, 5.5, 2.3], 1.9, 2.0, SUIT, { soft: 0.45, k: 1.2, collide: 'appendage' })),
        ...sided(ball('glove', [7.6, 4.8, 2.6], 2.15, CORAL, { soft: 0.45, k: 0.6, collide: 'appendage' }), 'arm', true),
        // Padded suit cuffs (rings around the wrists, aligned with the arms).
        ...pair(ring('cuff', [6.74, 6.45, 1.94], 1.75, 0.62, BLUE, { rot: [-18.24, 0, 30.47], soft: 0.45, k: 0.3 })),
        ...pair(ell('boot', [4.2, 1.9, 3.7], [2.7, 2.1, 3.3], BLUE, { soft: 0.2, k: 0.8, collide: 'core', group: 'body' })),
        box('pack', [0, 6.6, -5.0], [3.8, 4.5, 2.3], 1.3, BLUE, { k: 0.7, collide: 'core', group: 'body' }),
        ring('collar', [0, 9.25, 0.2], 5.2, 0.95, BLUE, { k: 0.45 }),
        cone('antenna', [4.9, 18.5, -0.8], [6.0, 20.4, -1.1], 0.42, 0.36, SUIT, { soft: 0.85, k: 0.4 }),
        ball('antennaTip', [6.2, 20.9, -1.15], 0.85, CORAL, { soft: 0.95, k: 0.25, root: [4.9, 18.5, -0.8], reach: 3 }),
      ],
    },
    {
      name: 'visor',
      surface: 'gloss',
      seams: false,
      detail: 2,
      budget: 10000,
      parts: [
        // Glossy rim around the face opening.
        part('rim', scaled(torus([0, 13.6, 5.7], 4.15, 0.58, [90, 0, 0]), [0, 13.6, 5.7], [1, 0.835, 1]), BLUE, { k: 0.2 }),
        part('sunVisor', sunVisor, '#ffa64a', { k: 0.2 }),
        ...pair(cyl('earCap', [6.85, 13.7, 0.2], 2.05, 0.75, 0.5, BLUE, { rot: [0, 0, 90], k: 0.2 })),
      ],
    },
  ],
  paints: [{ name: 'face', channel: 0, fn: ellipsoid([0, 13.6, 6.3], [4.6, 3.9, 2.6]), color: SKIN }],
  patches: [
    ...eyes({ at: [1.95, 14.0, 5.1], r: 0.75, style: 'sparkle' }),
    smile([0, 12.75, 5.15], 1.05, 0.45, 0.2),
    blush([3.0, 12.85, 5.3], 0.8, 0.55, PINK),
    // A curl of hair peeking out under the helmet.
    {
      kind: 'stroke',
      points: [
        [-1.7, 16.2, 5.6],
        [-0.6, 15.5, 5.3],
        [0.5, 15.8, 5.3],
        [1.5, 16.4, 5.6],
      ],
      width: 0.8,
      color: '#b9744f',
      surface: 'felt',
      taper: true,
    },
    // Mission patch.
    { kind: 'disc', at: [0, 5.3, 5.5], rx: 1.5, color: PURPLE, surface: 'felt', lift: 0.05 },
    { kind: 'poly', at: [0, 5.3, 5.6], outline: starOutline(5, 1.0, 0.44), color: CREAM, surface: 'satin', lift: 0.12 },
    {
      kind: 'stroke',
      points: Array.from({ length: 12 }, (_, i): V3 => {
        const a = (i / 12) * Math.PI * 2;
        return [Math.cos(a) * 1.5, 5.3 + Math.sin(a) * 1.5, 5.4];
      }),
      width: 0.16,
      color: CREAM,
      surface: 'thread',
      closed: true,
      lift: 0.08,
    },
    { kind: 'tag', at: [-5.9, 3.6, 0.2], out: [-1, -0.25, 0.1], color: '#ffffff', accent: BLUE },
  ],
  deform: { sag: 0.5, sway: 0.5, squash: 0.55 },
};

/* ----------------------------------------------------------- hornmonster */

export const hornmonster: PlushDesign = {
  slug: 'hornmonster',
  theme: 'storybook',
  name: { en: 'Grumble', zh: '咕噜长角怪', ja: 'グランブル' },
  kind: { en: 'friendly long-horned furry monster', zh: '友善的长角毛毛怪', ja: 'やさしい長い角のもふもふモンスター' },
  status: 'original',
  note: 'Original character.',
  height: 21.5,
  mass: 0.29,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.6,
      parts: [
        ell('body', [0, 6.5, 0], [7.4, 8.3, 6.6], PURPLE, { collide: 'core', k: 2.0 }),
        ell('crown', [0, 12.6, 0.3], [6.5, 5.5, 5.9], PURPLE, { collide: 'core', k: 3.2, group: 'head', piece: 'body' }),
        ...pair(cone('arm', [6.3, 8.4, 2.0], [8.5, 5.5, 3.0], 1.75, 1.5, PURPLE, { soft: 0.55, k: 1.2, collide: 'appendage' })),
        ...pair(ell('foot', [3.7, 1.6, 4.5], [2.8, 1.8, 2.9], PURPLE, { soft: 0.2, k: 1.0, collide: 'core', group: 'body' })),
        cone('tail', [0, 3.0, -5.8], [0, 5.6, -8.8], 1.7, 0.7, PURPLE, { soft: 0.8, k: 1.0 }),
        // Shaggy cheeks and a little tuft on top.
        ...pair(cone('cheek', [6.2, 11.3, 2.2], [8.0, 10.6, 2.6], 1.3, 0.45, PURPLE, { soft: 0.85, k: 1.0, piece: 'body' })),
        ...pair(cone('cheekLow', [6.5, 10.2, 1.2], [7.8, 9.0, 1.4], 1.1, 0.4, PURPLE, { soft: 0.85, k: 0.9, piece: 'body' })),
        cone('tuftA', [0, 17.4, 0.2], [0.2, 19.3, 0.5], 0.85, 0.3, PURPLE_DEEP, { soft: 0.9, k: 0.6, piece: 'body' }),
        cone('tuftB', [-0.9, 17.2, 0.1], [-1.9, 18.6, 0.2], 0.75, 0.28, PURPLE_DEEP, { soft: 0.9, k: 0.6, piece: 'body' }),
        cone('tuftC', [0.9, 17.2, 0.1], [1.9, 18.5, 0.0], 0.75, 0.28, PURPLE_DEEP, { soft: 0.9, k: 0.6, piece: 'body' }),
      ],
    },
    {
      name: 'horns',
      surface: 'felt',
      seams: false,
      detail: 1.5,
      budget: 7000,
      parts: [
        ...pair(
          pipe(
            'horn',
            [
              [4.3, 15.4, 0],
              [6.7, 16.9, 0.1],
              [8.4, 18.9, 0.5],
              [8.8, 21.3, 1.1],
            ],
            [1.65, 1.4, 1.0, 0.48],
            CREAM,
            { soft: 0.8, collide: 'appendage', k: 0.3 },
          ),
        ),
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 4.5, 5.6], [4.0, 3.5, 2.7]), color: CREAM, stitch: '#eccf86' },
    {
      name: 'spots',
      channel: 1,
      fn: anyOf(
        sphere([-5.7, 13.6, 2.8], 1.3),
        sphere([5.9, 10.6, -2.6], 1.5),
        sphere([-4.6, 9.6, -4.6], 1.6),
        sphere([3.3, 16.0, -2.6], 1.2),
        sphere([-2.4, 16.9, 2.0], 0.9),
        sphere([0.5, 11.5, -6.5], 1.7),
        sphere([6.9, 5.4, -0.8], 1.2),
        sphere([-6.9, 6.2, -1.6], 1.15),
        sphere([4.6, 14.6, 3.4], 0.75),
      ),
      color: CORAL_SOFT,
    },
    {
      name: 'hornStripes',
      channel: 2,
      layer: 'horns',
      fn: bothSides(anyOf(band([6.7, 16.9, 0.1], 1.62), band([8.4, 18.9, 0.5], 1.2))),
      color: CORAL,
    },
  ],
  patches: [
    ...eyes({ at: [2.6, 12.9, 5.9], r: 1.0, style: 'sparkle' }),
    // Big friendly grin with two little fangs.
    smile([0, 10.1, 6.5], 3.5, 1.25, 0.3),
    { kind: 'poly', at: [1.75, 9.75, 6.7], outline: [[-0.5, -0.38], [0.5, -0.38], [0, 0.62]], color: '#ffffff', surface: 'felt', mirror: true, lift: 0.1 },
    blush([4.9, 11.0, 5.0], 1.0, 0.7, PINK),
    // Soft brows give him a gentle, slightly worried look.
    {
      kind: 'stroke',
      points: [
        [1.5, 14.6, 5.6],
        [2.6, 15.0, 5.3],
        [3.6, 14.7, 4.9],
      ],
      width: 0.34,
      color: PURPLE_DEEP,
      surface: 'thread',
      mirror: true,
      taper: true,
    },
    { kind: 'tag', at: [-7.2, 4.4, 0.3], out: [-1, -0.25, 0.1], color: '#ffffff', accent: CORAL },
  ],
  deform: { sag: 0.6, sway: 0.75, squash: 0.7 },
};

/* ----------------------------------------------------------------- robot */

export const robot: PlushDesign = {
  slug: 'robot',
  theme: 'storybook',
  name: { en: 'Bolt-Bolt', zh: '叮当小机器人', ja: 'ボルトボルト' },
  kind: { en: 'soft toy robot', zh: '软绵绵玩具机器人', ja: 'やわらかおもちゃロボット' },
  status: 'original',
  note: 'Original character.',
  height: 21.5,
  mass: 0.27,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.2,
      parts: [
        box('body', [0, 5.7, 0], [5.5, 5.1, 4.9], 2.0, BLUE, { collide: 'core', k: 1.0 }),
        box('head', [0, 14.5, 0.2], [6.5, 4.4, 5.3], 2.3, BLUE, { collide: 'core', k: 0.8 }),
        // A gently domed top so the head reads as stuffed rather than as a hard box.
        ell('headTop', [0, 16.4, 0.2], [5.6, 2.75, 4.5], BLUE, { collide: 'core', group: 'head', piece: 'head', k: 1.6 }),
        ...pair(cone('arm', [5.6, 8.6, 0.4], [7.9, 5.6, 1.5], 1.45, 1.35, CREAM, { soft: 0.5, k: 0.6, collide: 'appendage' })),
        ...sided(ell('mitt', [8.3, 4.5, 1.9], [1.9, 2.2, 1.9], CORAL, { soft: 0.5, k: 0.5, collide: 'appendage' }), 'arm'),
        ...pair(ball('thumb', [7.3, 4.9, 3.3], 0.95, CORAL, { soft: 0.5, k: 0.5 })),
        ...pair(cyl('leg', [2.8, 1.8, 0.8], 1.9, 1.8, 0.8, CREAM, { k: 0.6, collide: 'core', group: 'body' })),
        ...pair(ell('foot', [2.9, 1.5, 3.7], [2.5, 1.55, 3.3], PURPLE, { k: 0.6, collide: 'core', group: 'body' })),
      ],
    },
    {
      name: 'trim',
      surface: 'satin',
      seams: false,
      detail: 1.7,
      budget: 9000,
      parts: [
        cyl('neck', [0, 10.5, 0.1], 2.7, 0.9, 0.45, CREAM, { k: 0.2 }),
        ...pair(cyl('earCap', [6.75, 14.5, 0.2], 1.85, 0.8, 0.5, CORAL, { rot: [0, 0, 90], k: 0.2 })),
        ...pair(ball('earPin', [7.75, 14.5, 0.2], 0.7, CREAM, { k: 0.2 })),
        cone('antenna', [0, 18.9, 0.2], [0, 20.5, 0.2], 0.5, 0.42, CREAM, { soft: 0.9, k: 0.3 }),
        ball('antennaTip', [0, 21.25, 0.2], 1.1, CORAL, { soft: 0.95, k: 0.2, root: [0, 18.9, 0.2], reach: 3 }),
        // Wind-up key on the back.
        cone('keyStem', [0, 6.8, -4.6], [0, 6.8, -6.5], 0.6, 0.5, CREAM, { soft: 0.5, k: 0.2 }),
        ring('key', [0, 6.8, -7.9], 1.3, 0.52, CORAL, { rot: [0, 0, 90], soft: 0.6, k: 0.25, root: [0, 6.8, -4.6], reach: 4.5 }),
      ],
    },
  ],
  paints: [
    { name: 'screen', channel: 0, fn: roundBox([0, 14.4, 5.5], [4.7, 2.95, 1.6], 1.3), color: MILK, stitch: '#d9c9a0' },
    { name: 'panel', channel: 1, fn: roundBox([0, 6.2, 5.0], [3.5, 2.7, 1.6], 0.9), color: MILK, stitch: '#d9c9a0' },
    { name: 'toes', channel: 2, fn: bothSides(ellipsoid([2.9, 1.2, 6.6], [2.2, 1.3, 1.0])), color: PURPLE_DEEP },
  ],
  patches: [
    ...eyes({ at: [2.3, 14.9, 5.6], r: 0.9, style: 'sparkle' }),
    smile([0, 13.55, 5.6], 1.25, 0.55, 0.22),
    // Cheek lights.
    { kind: 'disc', at: [3.75, 13.5, 5.55], rx: 0.55, color: CORAL_SOFT, surface: 'gloss', dome: 0.35, mirror: true, lift: 0.05 },
    // Dial with a pointer.
    { kind: 'disc', at: [-1.5, 6.9, 5.05], rx: 1.25, color: CORAL, surface: 'gloss', dome: 0.32, lift: 0.05 },
    {
      kind: 'stroke',
      points: [
        [-1.5, 6.9, 5.5],
        [-0.95, 7.55, 5.4],
      ],
      width: 0.22,
      color: MILK,
      surface: 'thread',
      lift: 0.42,
    },
    // Three buttons.
    { kind: 'disc', at: [1.7, 7.7, 5.05], rx: 0.6, color: CREAM, surface: 'gloss', dome: 0.45, lift: 0.05 },
    { kind: 'disc', at: [1.7, 6.3, 5.05], rx: 0.6, color: PURPLE, surface: 'gloss', dome: 0.45, lift: 0.05 },
    { kind: 'disc', at: [1.7, 4.9, 5.05], rx: 0.6, color: CORAL_SOFT, surface: 'gloss', dome: 0.45, lift: 0.05 },
    // Speaker grille.
    ...[5.35, 4.75].map(
      (y): PatchDef => ({
        kind: 'stroke',
        points: [
          [-2.5, y, 5.05],
          [-0.5, y, 5.05],
        ],
        width: 0.2,
        color: BLUE_DEEP,
        surface: 'thread',
      }),
    ),
    // Rivets on the head.
    { kind: 'disc', at: [5.3, 17.3, 4.4], rx: 0.36, color: CREAM, surface: 'gloss', dome: 0.5, mirror: true, lift: 0.04 },
    { kind: 'disc', at: [5.3, 11.7, 4.4], rx: 0.36, color: CREAM, surface: 'gloss', dome: 0.5, mirror: true, lift: 0.04 },
    { kind: 'tag', at: [-5.5, 3.6, 0.2], out: [-1, -0.25, 0.1], color: '#ffffff', accent: CORAL },
  ],
  deform: { sag: 0.45, sway: 0.5, squash: 0.5 },
};

/* ------------------------------------------------------------ scarfpuppy */

const PUP = '#ffe6ab';
const CARAMEL = '#e9966f';

export const scarfpuppy: PlushDesign = {
  slug: 'scarfpuppy',
  theme: 'storybook',
  name: { en: 'Biscuit', zh: '围巾小狗饼干', ja: 'ビスケット' },
  kind: { en: 'puppy with a knitted scarf', zh: '戴针织围巾的小狗', ja: 'ニットマフラーの子犬' },
  status: 'original',
  note: 'Original character.',
  height: 19.5,
  mass: 0.23,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 4.4, -0.4], [5.7, 5.9, 5.5], PUP, { collide: 'core', k: 2.0 }),
        ell('head', [0, 13.3, 0.8], [6.7, 5.9, 6.2], PUP, { collide: 'core', k: 2.2 }),
        ell('muzzle', [0, 11.7, 6.1], [3.1, 2.4, 2.6], MILK, { k: 1.1, collide: 'core', group: 'head' }),
        ...pair(
          part('ear', scaled(roundCone([5.3, 16.5, 0.2], [7.9, 10.6, 1.3], 2.0, 2.9), [6.6, 13.5, 0.7], [1, 1, 0.48]), CARAMEL, {
            soft: 0.95,
            collide: 'appendage',
            k: 1.1,
            root: [5.3, 16.5, 0.2],
            reach: 8,
          }),
        ),
        ...pair(ell('paw', [2.7, 1.7, 4.8], [2.1, 1.8, 2.9], PUP, { soft: 0.3, k: 1.0, collide: 'core', group: 'body' })),
        ...pair(ell('haunch', [4.8, 2.3, 0.8], [2.6, 2.4, 3.6], PUP, { k: 1.4, collide: 'core', group: 'body' })),
        cone('tail', [0, 4.2, -5.2], [0.9, 8.0, -7.3], 1.4, 0.8, PUP, { soft: 0.75, k: 1.0 }),
      ],
    },
    {
      name: 'scarf',
      surface: 'knit',
      seams: false,
      detail: 1.2,
      budget: 8000,
      parts: [
        part('wrap', scaled(torus([0, 9.45, 0.5], 5.15, 1.45), [0, 9.45, 0.5], [1, 0.88, 1]), BLUE, { k: 0.3 }),
        ell('knot', [2.7, 9.2, 5.3], [1.45, 1.3, 1.15], BLUE, { k: 0.45 }),
        part('tail', scaled(roundCone([3.0, 8.6, 5.5], [4.0, 3.6, 6.5], 1.5, 1.8), [3.5, 6.1, 6.0], [1, 1, 0.42]), BLUE, {
          soft: 0.9,
          k: 0.5,
          root: [3.0, 8.6, 5.5],
          reach: 5.6,
        }),
        // The short end tucked behind the knot.
        part('stub', scaled(roundCone([2.2, 8.8, 5.3], [0.9, 6.6, 5.9], 1.2, 1.35), [1.5, 7.7, 5.6], [1, 1, 0.42]), BLUE, {
          soft: 0.85,
          k: 0.5,
          root: [2.2, 8.8, 5.3],
          reach: 3,
        }),
      ],
    },
  ],
  paints: [
    { name: 'eyePatch', channel: 0, fn: ellipsoid([2.9, 14.3, 5.6], [2.5, 2.6, 2.4]), color: CARAMEL, stitch: '#c9794f' },
    { name: 'pads', channel: 1, fn: bothSides(ellipsoid([2.7, 1.55, 7.6], [1.25, 1.0, 1.0])), color: '#ffb7a5' },
    { name: 'belly', channel: 2, fn: ellipsoid([0, 4.2, 5.1], [3.1, 3.0, 2.2]), color: MILK, stitch: '#ecd9b0' },
    {
      name: 'scarfStripes',
      channel: 3,
      layer: 'scarf',
      fn: anyOf(
        roundBox([3.85, 4.1, 6.4], [2.6, 0.42, 1.6], 0.1),
        roundBox([3.6, 5.4, 6.2], [2.6, 0.42, 1.6], 0.1),
        roundBox([1.0, 6.9, 5.9], [2.0, 0.36, 1.6], 0.1, [0, 0, 30]),
      ),
      color: PURPLE,
    },
  ],
  patches: [
    ...eyes({ at: [2.75, 14.2, 6.1], r: 0.82, style: 'sparkle' }),
    nose([0, 12.6, 8.5], 0.8, 0.58, INK),
    ...wMouth([0, 11.7, 8.6], 1.0, 0.48, 0.19),
    // A tiny tongue.
    { kind: 'poly', at: [0, 10.75, 8.3], outline: [[-0.5, 0.36], [0.5, 0.36], [0.45, -0.4], [0, -0.7], [-0.45, -0.4]], color: '#ff8fa0', surface: 'felt', lift: 0.06 },
    blush([4.7, 12.3, 5.2], 0.95, 0.65, PINK),
    // Eyebrows.
    {
      kind: 'stroke',
      points: [
        [1.7, 16.0, 5.7],
        [2.7, 16.4, 5.3],
        [3.6, 16.1, 4.9],
      ],
      width: 0.28,
      color: '#c9794f',
      surface: 'thread',
      mirror: true,
      taper: true,
    },
    { kind: 'tag', at: [-5.6, 3.8, 0.3], out: [-1, -0.25, 0.1], color: '#ffffff', accent: BLUE },
  ],
  deform: { sag: 0.6, sway: 0.9, squash: 0.6 },
};

/* ------------------------------------------------------------------ dino */

const DINO = '#74c3d7';

export const dino: PlushDesign = {
  slug: 'dino',
  theme: 'storybook',
  name: { en: 'Pudge', zh: '胖嘟嘟恐龙', ja: 'ぽっちゃりザウルス' },
  kind: { en: 'chubby dinosaur', zh: '胖乎乎的小恐龙', ja: 'ぽっちゃり恐竜' },
  status: 'original',
  note: 'Original character.',
  height: 20.5,
  mass: 0.3,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.6,
      parts: [
        ell('body', [0, 5.3, -0.6], [7.0, 7.1, 6.5], DINO, { collide: 'core', k: 2.2 }),
        ell('head', [0, 14.3, 1.2], [5.8, 5.0, 5.8], DINO, { collide: 'core', k: 2.4 }),
        ell('snout', [0, 13.2, 5.8], [4.3, 3.3, 3.5], DINO, { k: 1.6, collide: 'core', group: 'head', piece: 'head' }),
        pipe(
          'tail',
          [
            [0.6, 3.4, -4.9],
            [2.9, 2.7, -8.1],
            [6.1, 2.3, -9.0],
            [8.6, 2.2, -7.5],
          ],
          [3.4, 2.8, 2.0, 1.1],
          DINO,
          { soft: 0.6, collide: 'appendage', k: 1.8, piece: 'body' },
        ),
        ...pair(cone('arm', [4.9, 9.6, 3.9], [5.7, 8.0, 6.2], 1.4, 1.15, DINO, { soft: 0.6, k: 0.9 })),
        ...pair(ell('foot', [3.7, 1.8, 3.9], [2.8, 2.0, 3.2], DINO, { soft: 0.2, k: 1.2, collide: 'core', group: 'body' })),
      ],
    },
    {
      name: 'plates',
      surface: 'felt',
      seams: false,
      detail: 1.5,
      budget: 6500,
      parts: [
        plate('plate1', [0, 18.4, -2.4], 1.6, 1.15, CORAL, -34),
        plate('plate2', [0, 15.9, -4.3], 2.2, 1.5, CORAL, -55),
        plate('plate3', [0, 12.2, -6.0], 2.7, 1.8, CORAL, -68),
        plate('plate4', [0, 8.2, -6.7], 2.7, 1.8, CORAL, -80),
        plate('plate5', [1.1, 5.5, -7.3], 2.2, 1.45, CORAL, -45, 25),
        plate('plate6', [3.9, 4.9, -8.6], 1.9, 1.2, CORAL, -18, 80),
        plate('plate7', [6.7, 3.9, -8.5], 1.5, 0.95, CORAL, -12, 125),
      ],
    },
  ],
  paints: [
    { name: 'belly', channel: 0, fn: ellipsoid([0, 5.5, 5.4], [4.4, 4.5, 2.7]), color: CREAM, stitch: '#e8cc85' },
    {
      name: 'spots',
      channel: 1,
      fn: anyOf(
        sphere([-4.4, 17.2, -0.8], 1.1),
        sphere([4.9, 15.6, -1.8], 0.95),
        sphere([-6.2, 9.6, -2.6], 1.5),
        sphere([5.9, 7.2, -3.6], 1.6),
        sphere([-5.1, 4.9, -5.2], 1.25),
        sphere([6.5, 11.0, -0.6], 1.0),
        sphere([4.4, 3.3, -8.6], 1.0),
        sphere([-3.2, 12.6, -5.6], 1.05),
      ),
      color: PURPLE,
    },
    { name: 'toes', channel: 2, fn: bothSides(anyOf(sphere([2.4, 1.0, 6.8], 0.72), sphere([3.7, 1.1, 7.1], 0.72), sphere([5.0, 1.0, 6.7], 0.72))), color: MILK },
  ],
  patches: [
    ...eyes({ at: [3.3, 15.5, 5.7], r: 0.88, style: 'sparkle' }),
    { kind: 'disc', at: [1.3, 14.65, 8.75], rx: 0.3, ry: 0.36, color: BLUE_DEEP, surface: 'thread', mirror: true, lift: 0.04 },
    smile([0, 12.5, 9.2], 2.7, 0.95, 0.26),
    // One little tooth peeking over the lip.
    { kind: 'poly', at: [1.35, 11.4, 9.15], outline: [[-0.46, 0.36], [0.46, 0.36], [0, -0.56]], color: '#ffffff', surface: 'felt', lift: 0.12 },
    blush([4.3, 12.9, 6.6], 0.95, 0.65, PINK),
    // Belly ribs.
    ...[7.5, 5.7, 3.9].map(
      (y, i): PatchDef => ({
        kind: 'stroke',
        points: [-1, -0.5, 0, 0.5, 1].map((t): V3 => [t * (3.3 - i * 0.25), y - (1 - t * t) * 0.25, 6.0]),
        width: 0.2,
        color: '#e8cc85',
        surface: 'thread',
        taper: true,
      }),
    ),
    { kind: 'tag', at: [-6.8, 4.2, 0.2], out: [-1, -0.25, 0.1], color: '#ffffff', accent: CORAL },
  ],
  deform: { sag: 0.55, sway: 0.6, squash: 0.7 },
};

/* --------------------------------------------------------------- cowpony */

const COAT = '#ffad8e';
const HAT = '#ffe0a0';

// Hat brim with gently upturned sides.
const brimFlat = ellipsoid([0, 17.5, 0.2], [6.8, 0.62, 6.2]);
const brimShape: DistFn = (x, y, z) => brimFlat(x, y - 0.02 * x * x, z);

export const cowpony: PlushDesign = {
  slug: 'cowpony',
  theme: 'storybook',
  name: { en: 'Sheriff Clover', zh: '三叶草小警长', ja: 'クローバー保安官' },
  kind: { en: 'little cowboy pony', zh: '小小牛仔小马', ja: 'ちいさなカウボーイポニー' },
  status: 'original',
  note: 'Original character.',
  height: 22,
  mass: 0.26,
  layers: [
    {
      name: 'body',
      surface: 'shortfur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 4.5, -0.6], [5.7, 5.9, 5.9], COAT, { collide: 'core', k: 2.0 }),
        ell('head', [0, 13.2, 0.9], [5.5, 5.3, 5.6], COAT, { collide: 'core', k: 2.2 }),
        ell('muzzle', [0, 11.2, 6.2], [3.1, 2.7, 3.5], MILK, { k: 1.3, collide: 'core', group: 'head' }),
        // Ears poke up through the brim on either side of the crown.
        ...pair(cone('ear', [3.6, 16.8, -0.3], [4.95, 20.5, -0.6], 1.35, 0.5, COAT, { soft: 0.7, k: 0.8 })),
        ...pair(ell('foreleg', [2.7, 2.0, 4.5], [2.0, 2.0, 2.7], COAT, { soft: 0.25, k: 1.0, collide: 'core', group: 'body' })),
        ...pair(ell('haunch', [4.8, 2.3, 0.7], [2.5, 2.4, 3.6], COAT, { k: 1.4, collide: 'core', group: 'body' })),
      ],
    },
    {
      name: 'mane',
      surface: 'fur',
      seams: false,
      budget: 6500,
      parts: [
        ell('mane0', [0.3, 16.6, -4.0], [1.5, 1.3, 1.4], PURPLE, { soft: 0.6, k: 0.6, piece: 'mane' }),
        ell('mane1', [-0.45, 14.9, -5.2], [1.7, 1.5, 1.5], PURPLE, { soft: 0.6, k: 0.6, piece: 'mane' }),
        ell('mane2', [0.45, 12.9, -5.8], [1.8, 1.6, 1.5], PURPLE, { soft: 0.6, k: 0.6, piece: 'mane' }),
        ell('mane3', [-0.35, 10.8, -5.6], [1.7, 1.5, 1.4], PURPLE, { soft: 0.6, k: 0.6, piece: 'mane' }),
        ell('mane4', [0.3, 8.9, -5.9], [1.5, 1.4, 1.3], PURPLE, { soft: 0.6, k: 0.6, piece: 'mane' }),
        ell('forelockA', [0.9, 16.35, 5.2], [1.5, 1.05, 1.1], PURPLE, { soft: 0.6, k: 0.5, rot: [0, 0, -22], piece: 'mane' }),
        ell('forelockB', [-0.55, 16.6, 5.0], [1.05, 0.85, 1.0], PURPLE, { soft: 0.6, k: 0.5, piece: 'mane' }),
        pipe(
          'tail',
          [
            [0, 4.0, -6.1],
            [0.8, 3.6, -8.0],
            [2.6, 2.4, -9.1],
            [4.8, 1.6, -8.9],
            [6.2, 1.3, -7.5],
          ],
          [0.9, 1.5, 1.7, 1.3, 0.5],
          PURPLE,
          { soft: 0.85, k: 0.5, collide: 'appendage' },
        ),
      ],
    },
    {
      name: 'hat',
      surface: 'felt',
      seams: false,
      detail: 1.3,
      budget: 9000,
      parts: [
        ell('crown', [0, 19.4, 0.2], [3.9, 2.8, 3.7], HAT, { collide: 'core', group: 'head', k: 0.5 }),
        part('crease', ellipsoid([0, 22.6, 0.2], [1.5, 1.2, 3.0]), HAT, { subtract: true, k: 0.8 }),
        part('brim', brimShape, HAT, { soft: 0.6, collide: 'core', group: 'head', k: 0.6 }),
      ],
    },
    {
      name: 'bandana',
      surface: 'satin',
      seams: false,
      detail: 1.2,
      budget: 5000,
      parts: [
        part('band', scaled(torus([0, 9.0, 0.3], 4.25, 0.9), [0, 9.0, 0.3], [1, 0.72, 1.04]), BLUE, { k: 0.3 }),
        part('flap', scaled(roundCone([0, 8.9, 4.7], [0, 5.3, 5.8], 2.7, 0.45), [0, 7.1, 5.3], [1, 1, 0.36]), BLUE, {
          soft: 0.8,
          k: 0.5,
          root: [0, 8.9, 4.7],
          reach: 4.2,
        }),
        // Knot at the back.
        ell('knot', [0, 9.0, -4.9], [1.3, 0.9, 1.0], BLUE, { k: 0.4 }),
      ],
    },
  ],
  paints: [
    { name: 'blaze', channel: 0, fn: ellipsoid([0, 14.7, 6.0], [1.0, 2.6, 2.0]), color: MILK },
    { name: 'hooves', channel: 1, fn: bothSides(ellipsoid([2.7, 1.3, 7.0], [2.0, 1.55, 1.25])), color: PURPLE_DEEP },
    { name: 'hatBand', channel: 3, layer: 'hat', fn: roundCylinder([0, 19.25, 0.2], 4.3, 0.42, 0.1), color: BLUE },
  ],
  patches: [
    ...eyes({ at: [3.0, 14.3, 5.3], r: 0.82, style: 'sparkle' }),
    { kind: 'disc', at: [1.0, 12.1, 9.3], rx: 0.27, ry: 0.36, color: '#c98a72', surface: 'thread', mirror: true, lift: 0.04 },
    smile([0, 10.6, 9.4], 1.5, 0.6, 0.22),
    blush([4.0, 12.2, 5.3], 0.9, 0.62, PINK),
    // Sheriff star on the hat.
    { kind: 'poly', at: [0, 20.7, 3.6], outline: starOutline(5, 0.95, 0.42), color: '#ffc95e', surface: 'satin', layer: 'hat', lift: 0.08 },
    // Polka dots on the bandana.
    { kind: 'disc', at: [0, 7.6, 6.0], rx: 0.38, color: MILK, surface: 'felt', layer: 'bandana', lift: 0.04 },
    { kind: 'disc', at: [1.2, 8.7, 5.8], rx: 0.34, color: MILK, surface: 'felt', layer: 'bandana', mirror: true, lift: 0.04 },
    { kind: 'disc', at: [0, 6.2, 6.0], rx: 0.28, color: MILK, surface: 'felt', layer: 'bandana', lift: 0.04 },
    { kind: 'tag', at: [-5.6, 3.9, 0.2], out: [-1, -0.25, 0.1], color: '#ffffff', accent: CORAL },
  ],
  deform: { sag: 0.55, sway: 0.7, squash: 0.6 },
};

export const storybookDesigns: PlushDesign[] = [astronaut, hornmonster, robot, scarfpuppy, dino, cowpony];
