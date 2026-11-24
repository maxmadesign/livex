import type { PlushAsset, ProxyShape } from '../../../src/plush/manifest';

/** Points on an ellipsoid with a flattened bottom (a sitting plush body). */
function bodyHull(rx: number, ry: number, rz: number, cy: number): number[] {
  const pts: number[] = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const py = Math.max(0, cy + y * ry);
    pts.push(Math.cos(a) * r * rx, py, Math.sin(a) * r * rz);
  }
  return pts;
}

/** Simple stand-in characters so the physics can be tested without baked assets. */
export function fakeAsset(slug: string, opts: { body?: number; head?: number; mass?: number; ears?: boolean } = {}): PlushAsset {
  const body = opts.body ?? 0.078;
  const head = opts.head ?? 0.068;
  const proxies: ProxyShape[] = [
    {
      part: 'body',
      role: 'core',
      geometry: { type: 'hull', points: bodyHull(body, body * 0.95, body * 0.92, body * 0.85) },
      pos: [0, 0, 0],
      rot: [0, 0, 0, 1],
      massFraction: 0.62,
    },
    {
      part: 'head',
      role: 'core',
      geometry: { type: 'ball', r: head },
      pos: [0, body * 1.55 + head * 0.55, 0.004],
      rot: [0, 0, 0, 1],
      massFraction: 0.32,
    },
  ];
  if (opts.ears !== false) {
    for (const side of [-1, 1]) {
      proxies.push({
        part: side < 0 ? 'earL' : 'earR',
        role: 'appendage',
        geometry: { type: 'ball', r: 0.024 },
        pos: [side * head * 0.72, body * 1.55 + head * 1.35, 0],
        rot: [0, 0, 0, 1],
        massFraction: 0.03,
      });
    }
  }
  const height = body * 1.55 + head * 1.6;
  return {
    id: `test.${slug}`,
    theme: 'sakura',
    slug,
    name: { en: slug, zh: slug, ja: slug },
    kind: { en: 'test plush', zh: '测试娃娃', ja: 'テスト' },
    size: [body * 2, height, body * 1.9],
    mass: opts.mass ?? 0.24,
    footprint: body,
    comHeight: height * 0.4,
    palette: ['#ffffff'],
    materials: ['fur'],
    model: { path: '', bytes: 0, lods: [], attributes: [] },
    paint: [],
    maskRange: 0.02,
    proxies,
    deform: { softAttribute: '_AUX.x', dentRadius: 0.03, sag: 0.5, squash: 0.5, sway: 0.5, softParts: [] },
    source: { status: 'original', method: 'procedural-sdf', generator: 'tests', license: 'test', note: '' },
  };
}

export const FAKE_ASSETS = [
  fakeAsset('bear'),
  fakeAsset('chub', { body: 0.086, head: 0.072, mass: 0.3 }),
  fakeAsset('mini', { body: 0.07, head: 0.064, mass: 0.19 }),
];
