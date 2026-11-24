import { beforeAll, describe, expect, it } from 'vitest';
import { gpuStrings } from '../../../src/i18n/strings/gpu';
import type { ProxyShape } from '../../../src/plush/manifest';
import { buildAsset, type BuiltAsset } from '../../../tools/plush/build';
import { ALL_DESIGNS } from '../../../tools/plush/designs/index';
import { gpuDesigns } from '../../../tools/plush/designs/gpu';

const EXPECTED = [
  ['chief', 'Keynote Chief', '主讲人', 'キーノートチーフ'],
  ['card', 'Twin-Fan', '双风扇', 'ツインファン'],
  ['chip', 'Chippy', '小芯片', 'チッピー'],
  ['fan', 'Breezy', '小风扇', 'ブリージー'],
  ['rack', 'Rack Buddy', '机柜宝宝', 'ラックバディ'],
  ['bot', 'Tensor Bot', '张量机器人', 'テンソルボット'],
  ['pixel', 'Pixel', '像素方块', 'ピクセル'],
] as const;

describe('GPU Party designs', () => {
  it('are the seven characters, in order, with their names in three languages', () => {
    expect(gpuDesigns.map((d) => d.slug)).toEqual(EXPECTED.map((e) => e[0]));
    gpuDesigns.forEach((d, i) => {
      const [slug, en, zh, ja] = EXPECTED[i]!;
      expect(d.theme).toBe('gpu');
      expect(d.name).toEqual({ en, zh, ja });
      for (const lang of ['en', 'zh', 'ja'] as const) {
        expect(d.kind[lang].length, `${slug} kind ${lang}`).toBeGreaterThan(3);
        expect(gpuStrings[lang][`gpu.char.${slug}`], `${slug} ${lang}`).toBe(d.name[lang]);
      }
      expect(d.status).toBe('original');
      expect(d.height).toBeGreaterThanOrEqual(13);
      expect(d.height).toBeLessThanOrEqual(24);
      expect(d.mass).toBeGreaterThanOrEqual(0.19);
      expect(d.mass).toBeLessThanOrEqual(0.3);
      expect(d.layers.some((l) => l.parts.some((p) => p.collide === 'core')), slug).toBe(true);
    });
    // Registered for the bake, after the other themes.
    expect(ALL_DESIGNS.slice(-7)).toEqual(gpuDesigns);
  });
});

/** Convex hull (2D, monotone chain) of points. */
function hull2(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Signed distance from a point to the inside of a convex polygon (positive = inside). */
function insideMargin(poly: [number, number][], x: number, z: number): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    m = Math.min(m, ((x - a[0]) * ez - (z - a[1]) * ex) / -len);
  }
  return m;
}

function hullPoints(p: ProxyShape): number[] {
  return p.geometry.type === 'hull' ? p.geometry.points : [];
}

describe('GPU Party baked characters (collision proxies, size, balance)', () => {
  const built = new Map<string, BuiltAsset>();
  beforeAll(async () => {
    for (const d of gpuDesigns) built.set(d.slug, await buildAsset(d));
  }, 240_000);

  it('have sizes like the other characters, grabbable cores and LOD budgets', () => {
    for (const d of gpuDesigns) {
      const b = built.get(d.slug)!;
      const [w, h, depth] = b.size;
      expect(h, d.slug).toBeCloseTo(d.height / 100, 3);
      expect(w, d.slug).toBeGreaterThan(0.12);
      expect(w, d.slug).toBeLessThan(0.24);
      expect(depth, d.slug).toBeGreaterThan(0.06);
      expect(depth, d.slug).toBeLessThan(0.2);
      const cores = b.proxies.filter((p) => p.role === 'core');
      expect(cores.length, d.slug).toBeGreaterThanOrEqual(1);
      expect(b.proxies.length, d.slug).toBeLessThanOrEqual(9);
      expect(b.proxies.reduce((a, p) => a + p.massFraction, 0), d.slug).toBeCloseTo(1, 2);
      // Most of the mass is in the solid body the claw closes on.
      expect(cores.reduce((a, p) => a + p.massFraction, 0), d.slug).toBeGreaterThan(0.75);
      expect(b.footprint, d.slug).toBeGreaterThan(0.04);
      expect(b.footprint, d.slug).toBeLessThan(0.1);
      expect(b.lods[0]!.indices.length / 3, d.slug).toBeLessThanOrEqual(15000);
      expect(b.lods[2]!.indices.length / 3, d.slug).toBeLessThan(b.lods[1]!.indices.length / 3);
    }
  });

  it('sit on a flat base that holds the centre of mass well inside it', () => {
    for (const d of gpuDesigns) {
      const b = built.get(d.slug)!;
      const floor: [number, number][] = [];
      let cx = 0;
      let cz = 0;
      for (const p of b.proxies) {
        const pts = hullPoints(p);
        let sx = 0;
        let sz = 0;
        const n = pts.length / 3;
        for (let i = 0; i < n; i++) {
          sx += pts[i * 3]!;
          sz += pts[i * 3 + 2]!;
          if (p.role === 'core' && pts[i * 3 + 1]! < 0.002) floor.push([pts[i * 3]!, pts[i * 3 + 2]!]);
        }
        cx += (sx / n) * p.massFraction;
        cz += (sz / n) * p.massFraction;
      }
      expect(floor.length, d.slug).toBeGreaterThanOrEqual(6);
      const base = hull2(floor);
      const margin = insideMargin(base, cx, cz);
      // At least 1.3 cm of support around the centre of mass, and a tipping angle of at least 7°.
      expect(margin, d.slug).toBeGreaterThan(0.013);
      expect(Math.atan2(margin, b.comHeight) * (180 / Math.PI), d.slug).toBeGreaterThan(7);
    }
  });
});
