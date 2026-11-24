/**
 * DOM-free procedural texel generators (height fields, normal maps, roughness maps).
 * Everything here is plain arithmetic on typed arrays, tileable, deterministic for a
 * seed, and runs in Node as well as in the browser (unit tested in tests/unit/scene).
 * `textures.ts` wraps the results into three.js textures.
 */

/** Integer hash → [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Tileable 2D value noise: `period` lattice cells across the tile, coordinates in cells. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const ax = mod(x0, period), bx = mod(x0 + 1, period), ay = mod(y0, period), by = mod(y0 + 1, period);
  const a = hash2(ax, ay, seed), b = hash2(bx, ay, seed), c = hash2(ax, by, seed), d = hash2(bx, by, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable 1D value noise. */
export function noise1(x: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const f = smooth(x - x0);
  const a = hash2(mod(x0, period), 0, seed), b = hash2(mod(x0 + 1, period), 0, seed);
  return a + (b - a) * f;
}

/**
 * Converts a tileable height field (0..1) into a tangent-space normal map (RGBA, 8 bit).
 * `strength` is the slope gain: height difference of 1 across one texel → strength.
 */
export function heightToNormal(height: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (height[yc + xp]! - height[yc + xm]!) * 0.5 * strength;
      const dy = (height[yp + x]! - height[ym + x]!) * 0.5 * strength;
      // Texture rows grow downwards in memory but v grows upwards in three.js (flipY is off
      // for data textures): row y+1 is +v, so the green channel uses +dy.
      const nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (yc + x) * 4;
      out[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Diamond quilting: 1 in the middle of a pillow, ~0.15 in a stitched valley. */
export function quiltHeight(size: number, cells = 8): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells, v = (y / size) * cells;
      const a = (u + v) % 1, b = (((u - v) % 1) + 1) % 1;
      const d = Math.min(Math.min(a, 1 - a), Math.min(b, 1 - b)) * 2;
      out[y * size + x] = 0.15 + 0.85 * Math.pow(Math.sin(Math.min(1, d * 1.6) * Math.PI * 0.5), 0.7);
    }
  }
  return out;
}

/**
 * Plain fabric weave: `threads` threads across the tile in each direction, alternately
 * over and under. Returns height (0..1) and a per-thread shade (0..1) for colour variation.
 */
export function weave(size: number, threads: number, seed: number): { height: Float32Array; shade: Float32Array } {
  const height = new Float32Array(size * size);
  const shade = new Float32Array(size * size);
  const p = size / threads;
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / p), fy = (y % p) / p;
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / p), fx = (x % p) / p;
      const warpOnTop = ((cx + cy) & 1) === 0;
      // Cross-section of the visible thread and how it dips where it passes under the next one.
      const across = warpOnTop ? fx : fy;
      const along = warpOnTop ? fy : fx;
      const profile = Math.pow(Math.sin(Math.PI * across), 0.55);
      const dip = 0.55 + 0.45 * Math.sin(Math.PI * along);
      const fibre = 0.9 + 0.1 * valueNoise(x * 0.5, y * 0.5, Math.max(1, Math.round(size * 0.5)), seed + 3);
      const i = y * size + x;
      height[i] = profile * dip * fibre;
      shade[i] = warpOnTop ? 0.45 + 0.55 * hash2(cx, 0, seed) : 0.45 + 0.55 * hash2(0, cy, seed + 1);
    }
  }
  return { height, shade };
}

/**
 * Brushed-metal height field: fine grooves running along +u (x), several octaves of 1D
 * noise across them plus a faint long-wave waviness. Tileable.
 */
export function brushedHeight(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const row = new Float32Array(size);
  for (let y = 0; y < size; y++) {
    row[y] = 0.5 * noise1(y, size, seed) + 0.3 * noise1(y / 4, size / 4, seed + 1) + 0.2 * noise1(y / 16, size / 16, seed + 2);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Grooves wander slightly along their length and break up now and then.
      const wobble = valueNoise((x / size) * 6, (y / size) * 48, 6, seed + 5) - 0.5;
      const yy = mod(Math.round(y + wobble * 3), size);
      const breakup = valueNoise((x / size) * 24, (y / size) * 256, 24, seed + 9);
      out[y * size + x] = row[yy]! * (0.8 + 0.2 * breakup);
    }
  }
  return out;
}

/**
 * Roughness modulation map in the green channel (three.js reads roughness from G and
 * metalness from B): `base`…1 following the brushed grooves.
 */
export function streakRoughness(height: Float32Array, size: number, base: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = base + (1 - base) * height[i]!;
    out[i * 4] = 255;
    out[i * 4 + 1] = Math.round(Math.min(1, g) * 255);
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Metallic flake normal map: small square flakes (`cell` texels), each tilted in a random
 * direction by up to `tilt` radians. Tileable when `size` is a multiple of `cell`.
 */
export function flakeNormals(size: number, cell: number, tilt: number, seed: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const cells = Math.floor(size / cell);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Jitter the grid so flakes do not line up.
      const jx = Math.floor((x + hash2(0, Math.floor(y / cell), seed) * cell) / cell) % cells;
      const cy = Math.floor(y / cell) % cells;
      const a = hash2(jx, cy, seed + 1) * Math.PI * 2;
      const t = Math.pow(hash2(jx, cy, seed + 2), 1.5) * tilt;
      const nx = Math.sin(t) * Math.cos(a), ny = Math.sin(t) * Math.sin(a), nz = Math.cos(t);
      const i = (y * size + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Fine stipple of moulded rubber (soft-touch claw tips). */
export function stippleHeight(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const f1 = size / 4, f2 = size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = 0.65 * valueNoise(x / 4, y / 4, f1, seed) + 0.35 * valueNoise(x / 16, y / 16, f2, seed + 1);
    }
  }
  return out;
}

/**
 * Braided steel cable: `strands` helical strands around the circumference (u, `w` texels)
 * advancing along the cable (v, `h` texels), with the over-under of a braid.
 */
export function braidHeight(w: number, h: number, strands: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const a = (((u + v) * strands) % 1 + 1) % 1;
      const b = (((u - v) * strands) % 1 + 1) % 1;
      const ra = Math.pow(Math.sin(Math.PI * a), 0.6);
      const rb = Math.pow(Math.sin(Math.PI * b), 0.6);
      // Alternate which strand family lies on top, cell by cell.
      const cell = (Math.floor((u + v) * strands) + Math.floor((u - v) * strands + strands)) & 1;
      const top = cell ? ra : rb;
      const under = cell ? rb : ra;
      const wire = 0.92 + 0.08 * Math.sin((u * strands * 7 + v * 31) * Math.PI * 2 + hash2(x, y, seed) * 0.3);
      out[y * w + x] = Math.max(top, under * 0.55) * wire;
    }
  }
  return out;
}

/** Bytes a texture of this size occupies on the GPU with a full mip chain (RGBA8). */
export function textureBytes(w: number, h: number, mipmaps = true, bytesPerTexel = 4): number {
  return Math.round(w * h * bytesPerTexel * (mipmaps ? 4 / 3 : 1));
}
