import jsQR from 'jsqr';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, qrMatrix, qrPath, qrPixels, type QrMatrix } from '../../../src/rewards/qr';
import { demoClaimUrl } from '../../../src/rewards/policy';
import { REWARD_LIMITS, fillClaimTemplate } from '../../../src/rewards/protocol';

const URLS = [
  'http://192.168.1.20:8788/c/K7M2QX9D',
  'http://127.0.0.1:8788/c/0123ABCD',
  demoClaimUrl('ZZZZ9999'),
  fillClaimTemplate('https://events.example.com/claim?booth=7&code={code}', 'K7M2QX9D'),
  // The longest owner link the protocol allows.
  `https://example.com/${'a'.repeat(REWARD_LIMITS.maxUrlChars - 30)}/{code}`.replace('{code}', 'K7M2QX9D'),
];

/** Error correction level from the format bits next to the top-left finder (00 = M, 01 = L, 11 = Q, 10 = H). */
function eccLevel(m: QrMatrix): 'L' | 'M' | 'Q' | 'H' {
  const q = QR_QUIET_ZONE;
  const at = (row: number, col: number) => (m.modules[row + q]![col + q] ? 1 : 0);
  let bits = 0;
  const set = (i: number, v: number) => (bits |= v << i);
  for (let i = 0; i <= 5; i++) set(i, at(i, 8));
  set(6, at(7, 8));
  set(7, at(8, 8));
  set(8, at(8, 7));
  for (let i = 9; i < 15; i++) set(i, at(8, 14 - i));
  const data = (bits ^ 0x5412) >> 10;
  return (['M', 'L', 'H', 'Q'] as const)[data >> 3]!;
}

/** Fills the SVG path's rectangles (M x y h w v1 h -w z) back into a module grid. */
function rasterPath(path: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-?\d+z/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = Number(m[3]);
    for (let i = 0; i < w; i++) grid[y]![x + i] = true;
  }
  return grid;
}

describe('claim QR code', () => {
  for (const url of URLS) {
    it(`round trip: encode → pixels → decode (${url.length} chars)`, () => {
      const m = qrMatrix(url);
      const img = qrPixels(m, 4);
      const decoded = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      expect(decoded?.data).toBe(url);
      expect(decoded?.version).toBe(m.version);
    });
  }

  it('uses error correction M', () => {
    // The reader itself tells the levels apart.
    for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
      const r = encode(URLS[0]!, { ecc, border: QR_QUIET_ZONE });
      expect(eccLevel({ size: r.size, version: r.version, modules: r.data })).toBe(ecc);
    }
    for (const url of URLS) expect(eccLevel(qrMatrix(url)), url).toBe('M');
  });

  it('has a quiet zone of at least 4 light modules on every side', () => {
    for (const url of URLS) {
      const m = qrMatrix(url);
      expect(m.size).toBe(4 * m.version + 17 + 2 * QR_QUIET_ZONE);
      expect(QR_QUIET_ZONE).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < m.size; i++) {
        for (let d = 0; d < QR_QUIET_ZONE; d++) {
          expect(m.modules[d]![i]).toBe(false);
          expect(m.modules[m.size - 1 - d]![i]).toBe(false);
          expect(m.modules[i]![d]).toBe(false);
          expect(m.modules[i]![m.size - 1 - d]).toBe(false);
        }
      }
      // The symbol itself starts right inside the quiet zone (the finder's dark corner).
      expect(m.modules[QR_QUIET_ZONE]![QR_QUIET_ZONE]).toBe(true);
    }
  });

  it('the SVG path draws exactly the dark modules', () => {
    const m = qrMatrix(URLS[0]!);
    expect(rasterPath(qrPath(m), m.size)).toEqual(m.modules);
  });

  it('a typical LAN claim link stays a small symbol (big modules, easy to scan)', () => {
    expect(qrMatrix(URLS[0]!).version).toBeLessThanOrEqual(3);
    expect(qrMatrix(demoClaimUrl('ZZZZ9999')).version).toBeLessThanOrEqual(4);
  });
});
