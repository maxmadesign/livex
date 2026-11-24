/**
 * Sakura Kawaii — cream white, cherry-blossom pink, mint and a touch of lemon.
 * Boutique Japanese crane-game plushies: big heads, tiny limbs, calm faces.
 */
import { anyOf, ball, blush, bothSides, cone, ell, ellipsoid, eyes, nose, pair, part, roundCone, wMouth, type PlushDesign } from '../dsl';
import { scaled } from '../sdf';

const CREAM = '#fff1dc';
const PINK = '#ffc2d4';
const ROSE = '#ff8fb0';

export const bunny: PlushDesign = {
  slug: 'bunny',
  theme: 'sakura',
  name: { en: 'Mochi Bunny', zh: '麻薯长耳兔', ja: 'もちうさぎ' },
  kind: { en: 'cream lop-eared bunny', zh: '奶油色垂耳兔', ja: 'クリーム色のたれ耳うさぎ' },
  status: 'original',
  note: 'Original character.',
  height: 21,
  mass: 0.23,
  layers: [
    {
      name: 'body',
      surface: 'fur',
      flatBase: 1.4,
      parts: [
        ell('body', [0, 5.4, 0], [6.3, 5.9, 5.7], CREAM, { collide: 'core', k: 2.2 }),
        ell('head', [0, 13.9, 0.5], [7.1, 6.3, 6.5], CREAM, { collide: 'core', k: 2.4 }),
        ...pair(
          part('ear', scaled(roundCone([4.1, 18.2, -0.2], [9.0, 8.6, 0.9], 1.7, 2.3), [6.5, 13, 0.3], [1, 1, 0.5]), CREAM, {
            soft: 0.95,
            collide: 'appendage',
            k: 1.5,
            root: [4.1, 18.2, -0.2],
            reach: 11,
          }),
        ),
        ...pair(cone('arm', [5.0, 8.9, 2.4], [6.5, 5.9, 4.5], 1.7, 1.9, CREAM, { soft: 0.5, k: 1.3, collide: 'none' })),
        ...pair(ell('foot', [3.7, 1.7, 5.0], [2.5, 1.9, 3.3], CREAM, { soft: 0.3, k: 1.2, collide: 'none', group: 'body' })),
        ball('tail', [0, 3.6, -5.9], 2.1, '#ffffff', { soft: 0.4, k: 0.9 }),
      ],
    },
    {
      name: 'bow',
      surface: 'satin',
      seams: false,
      detail: 1.5,
      budget: 500,
      parts: [
        ell('bowKnot', [4.6, 18.4, 2.2], [0.75, 0.8, 0.7], ROSE, { k: 0.3 }),
        ell('bowA', [3.2, 18.9, 2.3], [1.45, 1.1, 0.55], ROSE, { k: 0.35, rot: [0, 0, 18] }),
        ell('bowB', [6.0, 17.9, 2.3], [1.45, 1.1, 0.55], ROSE, { k: 0.35, rot: [0, 0, 18] }),
      ],
    },
  ],
  paints: [
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([6.9, 12.6, 1.5], [1.25, 4.3, 1.2], [0, 0, 27])), color: PINK, stitch: true },
    { name: 'belly', channel: 1, fn: ellipsoid([0, 5.2, 5.2], [3.5, 3.7, 2.4]), color: '#fffaf1', stitch: '#f1ddc4' },
    { name: 'pads', channel: 2, fn: anyOf(bothSides(ellipsoid([3.7, 1.8, 8.1], [1.35, 1.2, 1.2]))), color: PINK },
  ],
  patches: [
    ...eyes({ at: [2.75, 13.7, 6.6], r: 0.78, style: 'sparkle' }),
    nose([0, 12.75, 7.0], 0.48, 0.36, ROSE),
    ...wMouth([0, 12.3, 7.0], 0.95, 0.42, 0.17),
    blush([4.55, 12.35, 5.6], 1.05, 0.7, '#ffb3c8'),
    { kind: 'tag', at: [-6.2, 4.4, 0.3], out: [-1, -0.25, 0.1], color: '#ffffff', accent: ROSE },
  ],
  deform: { sag: 0.65, sway: 0.9, squash: 0.6 },
};

export const sakuraDesigns: PlushDesign[] = [bunny];
