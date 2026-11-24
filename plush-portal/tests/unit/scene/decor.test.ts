import { BoxGeometry, ExtrudeGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { axisUV, boxUV, fanBladeShape, fanFrameShape, TESSELLATION } from '../../../src/scene/decor';

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
  it('fan blade and fan frame extrude cleanly', () => {
    for (const shape of [fanBladeShape(0.06, 0.02), fanFrameShape(0.13, 0.06)]) {
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
