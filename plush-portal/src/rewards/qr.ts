/**
 * QR code for the win card: a module matrix from the `uqr` encoder (MIT, no network), drawn as one
 * inline SVG path so it stays crisp at any size and on any screen.
 *
 * Error correction M (about 15 % may be damaged: glare on a kiosk panel, a finger on a phone);
 * a quiet zone of 4 light modules on every side, as the QR specification asks for.
 */
import { encode } from 'uqr';

export const QR_ECC = 'M' as const;
/** Light modules around the symbol (the specification's minimum). */
export const QR_QUIET_ZONE = 4;

export interface QrMatrix {
  /** Modules per side, quiet zone included. */
  size: number;
  /** QR version (1–40). */
  version: number;
  /** [row][col], true = dark. */
  modules: boolean[][];
}

const cache = new Map<string, QrMatrix>();

/** Encodes `text` (byte mode, ECC M, 4-module quiet zone). Memoised: the card re-renders every second. */
export function qrMatrix(text: string): QrMatrix {
  let hit = cache.get(text);
  if (!hit) {
    const result = encode(text, { ecc: QR_ECC, border: QR_QUIET_ZONE });
    hit = { size: result.size, version: result.version, modules: result.data };
    if (cache.size > 16) cache.clear();
    cache.set(text, hit);
  }
  return hit;
}

/**
 * SVG path data for the dark modules in a viewBox of `size × size` (one unit per module).
 * Horizontal runs are merged into one rectangle each, which keeps the path short.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  const { size, modules } = matrix;
  for (let y = 0; y < size; y++) {
    const row = modules[y]!;
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join('');
}

/**
 * Rasterises the matrix to RGBA pixels (dark modules black, the rest white), `scale` pixels per
 * module. Used by tests to decode the code again.
 */
export function qrPixels(matrix: QrMatrix, scale: number): { data: Uint8ClampedArray; width: number; height: number } {
  const width = matrix.size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.modules[y]![x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * width + x * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width, height: width };
}
