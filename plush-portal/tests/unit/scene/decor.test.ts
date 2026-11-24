import { BoxGeometry, ExtrudeGeometry, ShapeUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { axisUV, boltShape, boxUV, fanBladeShape, fanFrameShape, letterShape, TESSELLATION } from '../../../src/scene/decor';

describe('world-projected UVs', () => {
  it('box projection scales with world size, independent of the part', () => {
    const g = new BoxGeometry(0.5, 0.2, 0.1).toNonIndexed();
    boxUV(g, 4);
    const uv = g.getAttribute('uv');
    let maxU = -Infinity, minU = Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      minU = Math.min(minU, uv.getX(i));
    }
    // 0.5 m along x at 4 repeats per metre = 2 repeats.
    expect(maxU - minU).toBeCloseTo(2, 5);
  });

  it('axis projection runs u along the chosen axis on every face', () => {
    const g = new BoxGeometry(0.03, 0.034, 0.8).toNonIndexed();
    axisUV(g, 'z', 3);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) expect(uv.getX(i)).toBeCloseTo(pos.getZ(i) * 3, 6);
  });

  it('refuses indexed geometry (it would smear UVs across faces)', () => {
    expect(() => boxUV(new BoxGeometry(1, 1, 1), 1)).toThrow();
  });
});

describe('GPU decor outlines', () => {
  it('letters G, P and U are closed, non-degenerate and the P has its counter', () => {
    for (const ch of ['G', 'P', 'U'] as const) {
      const s = letterShape(ch, 0.1);
      const pts = s.getPoints();
      const area = Math.abs(ShapeUtils.area(pts));
      expect(area, ch).toBeGreaterThan(0.1 * 0.06 * 0.25);
      expect(area, ch).toBeLessThan(0.1 * 0.06);
      const box = pts.reduce((b, p) => ({ w: Math.max(b.w, p.x), h: Math.max(b.h, p.y) }), { w: 0, h: 0 });
      expect(box.h).toBeCloseTo(0.1, 6);
      expect(box.w).toBeCloseTo(0.06, 6);
      const geo = new ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: false });
      expect(geo.getAttribute('position').count).toBeGreaterThan(30);
      geo.dispose();
    }
    expect(letterShape('P', 0.1).holes.length).toBe(1);
    expect(letterShape('G', 0.1).holes.length).toBe(0);
  });

  it('bolt, fan blade and fan frame extrude cleanly', () => {
    for (const shape of [boltShape(0.04), fanBladeShape(0.06, 0.02), fanFrameShape(0.13, 0.06)]) {
      const geo = new ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false });
      const pos = geo.getAttribute('position');
      expect(pos.count).toBeGreaterThan(12);
      for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      geo.dispose();
    }
    expect(fanFrameShape(0.13, 0.06).holes.length).toBe(1);
  });

  it('tessellation grows monotonically from Safe to Ultra', () => {
    for (const list of Object.values(TESSELLATION)) {
      expect(list.length).toBe(4);
      for (let i = 1; i < list.length; i++) expect(list[i]!).toBeGreaterThanOrEqual(list[i - 1]!);
      expect(list[3]!).toBeGreaterThan(list[0]!);
    }
  });
});
