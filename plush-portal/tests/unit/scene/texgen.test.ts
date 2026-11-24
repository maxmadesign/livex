import { describe, expect, it } from 'vitest';
import { braidHeight, brushedHeight, flakeNormals, hash2, heightToNormal, quiltHeight, stippleHeight, streakRoughness, textureBytes, valueNoise, weave } from '../../../src/scene/texgen';

const decode = (data: Uint8Array, i: number) => [data[i * 4]! / 127.5 - 1, data[i * 4 + 1]! / 127.5 - 1, data[i * 4 + 2]! / 127.5 - 1] as const;

describe('procedural texel generators', () => {
  it('hash and value noise are deterministic, in range and tileable', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.73, 16, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // Period 16: the same value one period away in either direction.
    expect(valueNoise(2.25, 5.5, 16, 1)).toBeCloseTo(valueNoise(18.25, 5.5, 16, 1), 10);
    expect(valueNoise(2.25, 5.5, 16, 1)).toBeCloseTo(valueNoise(2.25, 21.5, 16, 1), 10);
  });

  it('a flat height field gives a straight-up normal map', () => {
    const n = heightToNormal(new Float32Array(16 * 16).fill(0.4), 16, 16, 5);
    for (let i = 0; i < 256; i++) {
      expect(n[i * 4]).toBe(128);
      expect(n[i * 4 + 1]).toBe(128);
      expect(n[i * 4 + 2]).toBe(255);
      expect(n[i * 4 + 3]).toBe(255);
    }
  });

  it('normals tilt away from rising height along +u and +v', () => {
    const size = 32;
    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x / size;
    const [nx, , nz] = decode(heightToNormal(ramp, size, size, 8), 5 * size + 10);
    expect(nx).toBeLessThan(-0.1);
    expect(nz).toBeGreaterThan(0.5);
    const rampV = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rampV[y * size + x] = y / size;
    const [, ny] = decode(heightToNormal(rampV, size, size, 8), 10 * size + 5);
    expect(ny).toBeLessThan(-0.1);
  });

  it('every generated normal is (nearly) unit length', () => {
    const maps = [heightToNormal(brushedHeight(64, 1), 64, 64, 1.6), heightToNormal(stippleHeight(64, 2), 64, 64, 2.2), flakeNormals(64, 2, 0.5, 3), heightToNormal(braidHeight(64, 64, 3, 4), 64, 64, 3.2)];
    for (const map of maps) {
      for (let i = 0; i < 64 * 64; i += 37) {
        const [x, y, z] = decode(map, i);
        expect(Math.hypot(x, y, z)).toBeGreaterThan(0.97);
        expect(Math.hypot(x, y, z)).toBeLessThan(1.03);
        expect(z).toBeGreaterThan(0);
      }
    }
  });

  it('height fields stay in 0..1 and actually vary', () => {
    const fields = [quiltHeight(64), weave(64, 16, 1).height, brushedHeight(64, 2), stippleHeight(64, 3), braidHeight(32, 32, 3, 4)];
    for (const f of fields) {
      let min = Infinity, max = -Infinity;
      for (const v of f) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1.0001);
      expect(max - min).toBeGreaterThan(0.2);
    }
  });

  it('brushed grooves run along u: rows vary much less than columns', () => {
    const size = 128;
    const h = brushedHeight(size, 7);
    let alongU = 0, alongV = 0;
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        alongU += Math.abs(h[y * size + x + 1]! - h[y * size + x]!);
        alongV += Math.abs(h[(y + 1) * size + x]! - h[y * size + x]!);
      }
    expect(alongV).toBeGreaterThan(alongU * 2);
  });

  it('the weave alternates over and under thread by thread', () => {
    const { height } = weave(64, 8, 5);
    // Centre of cell (0,0): warp on top, its cross-section peaks in u; centre of cell (1,0): weft on top.
    const p = 8;
    const at = (x: number, y: number) => height[y * 64 + x]!;
    expect(at(p / 2, p / 2)).toBeGreaterThan(at(1, p / 2));
    expect(at(p + p / 2, p / 2)).toBeGreaterThan(at(p + p / 2, 1));
  });

  it('roughness modulation lives in the green channel within base..1', () => {
    const h = brushedHeight(32, 3);
    const r = streakRoughness(h, 32, 0.6);
    for (let i = 0; i < 32 * 32; i++) {
      expect(r[i * 4 + 1]! / 255).toBeGreaterThanOrEqual(0.59);
      expect(r[i * 4 + 2]).toBe(255);
    }
  });

  it('estimates GPU bytes with the mip chain', () => {
    expect(textureBytes(1024, 1024, false)).toBe(4 * 1024 * 1024);
    expect(textureBytes(1024, 1024)).toBe(Math.round((4 * 1024 * 1024 * 4) / 3));
  });
});
