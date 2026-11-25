import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { makeRng } from '../core/math';
import type { ThemeDef } from '../themes/themes';
import { sceneInk, sceneParts } from './brandScene';
import { braidHeight, brushedHeight, flakeNormals, heightToNormal, quiltHeight, stippleHeight, streakRoughness, weave } from './texgen';

export type TextureTier = '512' | '1k' | '2k' | '4k';

/** Texture edge length for a quality tier. */
export function textureSize(tier: TextureTier): number {
  return tier === '512' ? 512 : tier === '1k' ? 1024 : tier === '2k' ? 2048 : 4096;
}

/** Edge length of tiled detail maps (normal / roughness): they repeat, so 1K is plenty even on Ultra. */
export function detailSize(tier: TextureTier): number {
  return tier === '512' ? 256 : tier === '1k' ? 512 : 1024;
}

let maxAnisotropy = 4;
/** Called by the Stage with the renderer's limit; textures use the highest the tier allows. */
export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, Math.floor(value));
}
function anisotropyFor(size: number): number {
  // Small (phone tier) textures do not benefit from 16× filtering; keep the sampler cheap.
  return Math.min(maxAnisotropy, size <= 512 ? 4 : size <= 1024 ? 8 : 16);
}

function canvas(size: number, height = size): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, color = true, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropyFor(Math.max(c.width, c.height));
  t.generateMipmaps = true;
  return t;
}

function dataTexture(data: Uint8Array, w: number, h: number, repeat = true): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropyFor(Math.max(w, h));
  t.needsUpdate = true;
  return t;
}

function flower(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, fill: string, centre: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = fill;
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(r * 0.55, -r * 0.25, r * 0.6, -r * 0.95, 0.06 * r, -r);
    g.lineTo(0, -r * 0.86);
    g.lineTo(-0.06 * r, -r);
    g.bezierCurveTo(-r * 0.6, -r * 0.95, -r * 0.55, -r * 0.25, 0, 0);
    g.fill();
  }
  g.fillStyle = centre;
  g.beginPath();
  g.arc(0, 0, r * 0.16, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, points = 5, inner = 0.48): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.arc(x - s * 0.5, y, s * 0.32, 0, Math.PI * 2);
  g.arc(x - s * 0.1, y - s * 0.2, s * 0.42, 0, Math.PI * 2);
  g.arc(x + s * 0.38, y - s * 0.02, s * 0.34, 0, Math.PI * 2);
  g.rect(x - s * 0.5, y - s * 0.02, s * 0.9, s * 0.34);
  g.fill();
}

/** A small chip outline with pins, used by the circuit wallpaper and the mat. */
function chipIcon(g: CanvasRenderingContext2D, x: number, y: number, s: number, body: string, pins: string, die: string | null): void {
  const half = s / 2;
  const pinCount = 5;
  g.fillStyle = pins;
  for (let i = 0; i < pinCount; i++) {
    const o = -half + ((i + 0.5) / pinCount) * s;
    const pw = s * 0.07, pl = s * 0.16;
    g.fillRect(x + o - pw / 2, y - half - pl, pw, pl);
    g.fillRect(x + o - pw / 2, y + half, pw, pl);
    g.fillRect(x - half - pl, y + o - pw / 2, pl, pw);
    g.fillRect(x + half, y + o - pw / 2, pl, pw);
  }
  g.fillStyle = body;
  g.beginPath();
  g.roundRect(x - half, y - half, s, s, s * 0.1);
  g.fill();
  if (die) {
    g.strokeStyle = die;
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    g.roundRect(x - half * 0.55, y - half * 0.55, s * 0.55, s * 0.55, s * 0.05);
    g.stroke();
    // Pin-1 dot.
    g.fillStyle = die;
    g.beginPath();
    g.arc(x - half * 0.72, y - half * 0.72, s * 0.05, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Printed-circuit wallpaper (GPU theme): black laminate with a faint glass-fibre weave, routed
 * traces with 45° bends, vias, chip footprints and a few glowing "powered" lines in the brand
 * green (colours from the brand kit when one dresses the theme).
 */
function drawCircuit(g: CanvasRenderingContext2D, size: number, theme: ThemeDef, variant: 'board' | 'fascia', rng: () => number): void {
  const u = size / 512;
  const cab = theme.cabinet;
  const ink = sceneInk(theme);
  const parts = sceneParts(theme);
  const lime = ink.primary;
  const bright = ink.glow;
  const copper = cab.backboardInk;
  const tiled = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy);
  };
  // Laminate: faint weave of the glass fibre.
  g.globalAlpha = 0.06;
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1, 0.6 * u);
  const pitch = 6 * u;
  for (let p = 0; p < size; p += pitch) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p + pitch / 2);
    g.lineTo(size, p + pitch / 2);
    g.stroke();
  }
  const grid = 16 * u;
  const cells = Math.round(size / grid);
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const;
  const density = variant === 'board' ? 1 : 0.55;
  // Chip footprints first, so traces appear to run into them.
  const chips: { x: number; y: number; s: number }[] = [];
  for (let i = 0; i < Math.round(7 * density); i++) {
    const s = (3 + Math.floor(rng() * 4)) * grid;
    chips.push({ x: Math.round(rng() * cells) * grid, y: Math.round(rng() * cells) * grid, s });
  }
  // Traces: random walks on the routing grid.
  const traces: { pts: [number, number][]; w: number; glow: boolean }[] = [];
  for (let i = 0; i < Math.round(46 * density); i++) {
    let x = Math.floor(rng() * cells), y = Math.floor(rng() * cells);
    let d = Math.floor(rng() * 4) * 2;
    const pts: [number, number][] = [[x * grid, y * grid]];
    const segments = 2 + Math.floor(rng() * 5);
    for (let s = 0; s < segments; s++) {
      const len = 1 + Math.floor(rng() * 5);
      x += dirs[d]![0] * len;
      y += dirs[d]![1] * len;
      pts.push([x * grid, y * grid]);
      d = (d + (rng() < 0.5 ? 1 : 7)) % 8; // 45° turns
    }
    traces.push({ pts, w: (rng() < 0.2 ? 3.2 : 1.6) * u, glow: rng() < 0.12 });
  }
  const strokeTrace = (t: { pts: [number, number][] }, dx: number, dy: number) => {
    g.beginPath();
    t.pts.forEach(([px, py], k) => (k === 0 ? g.moveTo(px + dx, py + dy) : g.lineTo(px + dx, py + dy)));
    g.stroke();
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalAlpha = variant === 'board' ? 0.9 : 0.6;
  for (const t of traces) {
    if (t.glow) continue;
    g.strokeStyle = copper;
    g.lineWidth = t.w;
    tiled((dx, dy) => strokeTrace(t, dx, dy));
  }
  // Vias and pads at trace ends.
  for (const t of traces) {
    const [ex, ey] = t.pts[t.pts.length - 1]!;
    const [sx, sy] = t.pts[0]!;
    tiled((dx, dy) => {
      for (const [px, py] of [
        [ex, ey],
        [sx, sy],
      ] as const) {
        g.fillStyle = copper;
        g.beginPath();
        g.arc(px + dx, py + dy, 3.4 * u, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = cab.backboard;
        g.beginPath();
        g.arc(px + dx, py + dy, 1.4 * u, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  g.globalAlpha = 1;
  for (const c of chips) tiled((dx, dy) => chipIcon(g, c.x + dx, c.y + dy, c.s, parts.rack, parts.pins, variant === 'board' ? copper : null));
  // A few lit traces with a soft glow: the "powered" lines.
  g.save();
  g.shadowColor = bright;
  g.shadowBlur = 7 * u;
  g.globalAlpha = variant === 'board' ? 0.95 : 0.7;
  for (const t of traces) {
    if (!t.glow) continue;
    g.strokeStyle = lime;
    g.lineWidth = t.w * 1.1;
    tiled((dx, dy) => strokeTrace(t, dx, dy));
  }
  g.restore();
  // Tiny silkscreen tick marks.
  g.globalAlpha = 0.25;
  g.fillStyle = parts.silkscreen;
  for (let i = 0; i < Math.round(60 * density); i++) {
    const x = rng() * size, y = rng() * size;
    const horizontal = rng() < 0.5;
    tiled((dx, dy) => g.fillRect(x + dx, y + dy, horizontal ? 7 * u : 1.2 * u, horizontal ? 1.2 * u : 7 * u));
  }
  g.globalAlpha = 1;
}

/** Tileable wallpaper for the back board (and fascia) of a theme. */
export function makePatternTexture(theme: ThemeDef, size: number, variant: 'board' | 'fascia' = 'board'): Texture {
  const { c, g } = canvas(size);
  const cab = theme.cabinet;
  const base = variant === 'board' ? cab.backboard : cab.fascia;
  const ink = variant === 'board' ? cab.backboardInk : cab.frameAccent;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const rng = makeRng(theme.id.length * 977 + (variant === 'board' ? 1 : 7));
  const u = size / 512;
  // Draw every motif at its position and wrapped copies so the texture tiles seamlessly.
  const tiled = (draw: (x: number, y: number) => void, x: number, y: number) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(x + dx, y + dy);
  };
  g.globalAlpha = variant === 'board' ? 0.55 : 0.3;
  switch (cab.pattern) {
    case 'sakura': {
      for (let i = 0; i < 26; i++) {
        const x = rng() * size, y = rng() * size, r = (10 + rng() * 22) * u, rot = rng() * 6.28;
        const light = rng() > 0.5;
        tiled((px, py) => flower(g, px, py, r, rot, light ? '#ffffff' : ink, light ? ink : '#fff3b8'), x, y);
      }
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) {
        const x = rng() * size, y = rng() * size, r = (1.5 + rng() * 3) * u;
        tiled((px, py) => {
          g.beginPath();
          g.arc(px, py, r, 0, 6.28);
          g.fill();
        }, x, y);
      }
      break;
    }
    case 'storybook': {
      const cols = [ink, '#ffffff', theme.ui.accent, theme.ui.accent2];
      for (let i = 0; i < 22; i++) {
        const x = rng() * size, y = rng() * size, s = (14 + rng() * 26) * u, rot = rng() * 6.28;
        const kind = Math.floor(rng() * 3);
        g.fillStyle = cols[Math.floor(rng() * cols.length)]!;
        const fill = g.fillStyle;
        tiled((px, py) => {
          g.fillStyle = fill;
          if (kind === 0) star(g, px, py, s * 0.6, rot);
          else if (kind === 1) cloud(g, px, py, s * 1.3);
          else {
            g.beginPath();
            g.arc(px, py, s * 0.45, 0, 6.28);
            g.fill();
          }
        }, x, y);
      }
      break;
    }
    case 'waves': {
      g.lineCap = 'round';
      for (let row = 0; row < 9; row++) {
        const y0 = ((row + 0.5) / 9) * size;
        g.strokeStyle = row % 2 === 0 ? '#ffffff' : ink;
        g.lineWidth = (3 + (row % 3)) * u;
        g.beginPath();
        for (let x = -8; x <= size + 8; x += 4) {
          const y = y0 + Math.sin((x / size) * Math.PI * 2 * 4 + row * 1.3) * 9 * u;
          if (x === -8) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 34; i++) {
        const x = rng() * size, y = rng() * size, r = (3 + rng() * 9) * u;
        tiled((px, py) => {
          g.beginPath();
          g.arc(px, py, r, 0, 6.28);
          g.fill();
        }, x, y);
      }
      break;
    }
    case 'cosmos': {
      const cols = ['#ffffff', theme.ui.accent, theme.ui.accent2, ink, '#ffe9a8'];
      for (let i = 0; i < 90; i++) {
        const x = rng() * size, y = rng() * size, r = (0.8 + rng() * 2.4) * u;
        g.fillStyle = cols[Math.floor(rng() * cols.length)]!;
        const fill = g.fillStyle;
        tiled((px, py) => {
          g.fillStyle = fill;
          g.beginPath();
          g.arc(px, py, r, 0, 6.28);
          g.fill();
        }, x, y);
      }
      for (let i = 0; i < 12; i++) {
        const x = rng() * size, y = rng() * size, s = (7 + rng() * 14) * u, rot = rng() * 6.28;
        g.fillStyle = cols[1 + Math.floor(rng() * 3)]!;
        const fill = g.fillStyle;
        tiled((px, py) => {
          g.fillStyle = fill;
          star(g, px, py, s, rot, 4, 0.3);
        }, x, y);
      }
      // A couple of ringed planets.
      for (let i = 0; i < 3; i++) {
        const x = rng() * size, y = rng() * size, r = (16 + rng() * 14) * u;
        const col = cols[1 + (i % 3)]!;
        tiled((px, py) => {
          g.fillStyle = col;
          g.beginPath();
          g.arc(px, py, r, 0, 6.28);
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2.5 * u;
          g.beginPath();
          g.ellipse(px, py, r * 1.7, r * 0.42, -0.4, 0, 6.28);
          g.stroke();
        }, x, y);
      }
      break;
    }
    case 'circuit': {
      g.globalAlpha = 1;
      drawCircuit(g, size, theme, variant, rng);
      break;
    }
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** Quilted padding as a normal map (diamond pillows with stitched valleys). */
export function makeQuiltNormal(size: number): Texture {
  return dataTexture(heightToNormal(quiltHeight(size), size, size, 9 * (size / 512)), size, size);
}

/**
 * Floor-mat normal map: the quilting plus a woven fabric surface (`threads` threads per tile),
 * so the mat reads as fabric up close and as padding from afar.
 */
export function makeMatNormal(size: number, threads: number): Texture {
  const quilt = quiltHeight(size);
  const { height } = weave(size, threads, 11);
  const h = new Float32Array(size * size);
  // Weave slopes are much steeper (short period), so it is mixed in at a lower amplitude.
  const weaveAmp = 0.05 * (512 / size) * (threads / 96);
  for (let i = 0; i < h.length; i++) h[i] = quilt[i]! + height[i]! * weaveAmp;
  return dataTexture(heightToNormal(h, size, size, 8 * (size / 512)), size, size);
}

/** Brushed metal: grooves along +u. Returns a normal map and a roughness (G) map. */
export function makeBrushedMaps(size: number, seed = 7): { normal: Texture; roughness: Texture } {
  const h = brushedHeight(size, seed);
  return {
    normal: dataTexture(heightToNormal(h, size, size, 1.6), size, size),
    roughness: dataTexture(streakRoughness(h, size, 0.62), size, size),
  };
}

/** Metallic flake normal map for lacquer (High and Ultra). */
export function makeFlakeNormal(size: number): Texture {
  return dataTexture(flakeNormals(size, 2, 0.5, 23), size, size);
}

/** Moulded rubber stipple. */
export function makeStippleNormal(size: number): Texture {
  return dataTexture(heightToNormal(stippleHeight(size, 31), size, size, 2.2), size, size);
}

/** Braided cable normal map (u = around the cable, v = along it). */
export function makeBraidNormal(): Texture {
  const w = 64, h = 64;
  return dataTexture(heightToNormal(braidHeight(w, h, 3, 5), w, h, 3.2), w, h);
}

/**
 * Micro-scratches and faint wipe marks for glass and acrylic: R = how strongly a texel
 * scatters light, G = roughness factor (three.js reads roughness from G).
 */
export function makeScratchTexture(size: number, seed = 3): Texture {
  const { c, g } = canvas(size);
  g.fillStyle = 'rgb(0, 70, 255)';
  g.fillRect(0, 0, size, size);
  const rng = makeRng(seed);
  const u = size / 1024;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  // Wipe marks: big faint arcs.
  for (let i = 0; i < 14; i++) {
    const x = rng() * size, y = rng() * size, r = (120 + rng() * 260) * u;
    g.strokeStyle = `rgba(14, 30, 0, ${0.5 + rng() * 0.5})`;
    g.lineWidth = (14 + rng() * 30) * u;
    g.beginPath();
    g.arc(x, y, r, rng() * 6.28, rng() * 6.28 + 0.6 + rng() * 1.2);
    g.stroke();
  }
  // Hairline scratches.
  for (let i = 0; i < 220; i++) {
    const x = rng() * size, y = rng() * size;
    const len = (10 + Math.pow(rng(), 2) * 160) * u;
    const a = rng() * Math.PI;
    const bend = (rng() - 0.5) * len * 0.3;
    const strength = 40 + rng() * 140;
    g.strokeStyle = `rgba(${Math.round(strength)}, ${Math.round(strength * 0.9)}, 0, 1)`;
    g.lineWidth = Math.max(0.6, (0.5 + rng() * 0.9) * u);
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + dy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        g.stroke();
      }
  }
  g.globalCompositeOperation = 'source-over';
  return finish(c, false);
}

/** Soft play mat: base colour with a woven thread shade and theme motifs. */
export function makeMatTexture(theme: ThemeDef, size: number): Texture {
  const { c, g } = canvas(size);
  g.fillStyle = theme.cabinet.mat;
  g.fillRect(0, 0, size, size);
  const rng = makeRng(4242 + theme.id.length);
  const u = size / 512;
  // Thread-by-thread shade, so the colour breaks up like real fabric.
  const threads = 96;
  const p = size / threads;
  g.globalAlpha = 0.07;
  for (let i = 0; i < threads; i++) {
    g.fillStyle = rng() < 0.5 ? '#000000' : '#ffffff';
    g.fillRect(i * p, 0, p * 0.55, size);
    g.fillStyle = rng() < 0.5 ? '#000000' : '#ffffff';
    g.fillRect(0, i * p, size, p * 0.55);
  }
  g.globalAlpha = 0.5;
  g.fillStyle = theme.cabinet.matInk;
  const pattern = theme.cabinet.pattern;
  for (let i = 0; i < 18; i++) {
    const x = rng() * size, y = rng() * size, r = (7 + rng() * 9) * u, rot = rng() * 6.28;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        if (pattern === 'sakura') flower(g, x + dx, y + dy, r, rot, theme.cabinet.matInk, '#ffffff');
        else if (pattern === 'cosmos' || pattern === 'storybook') star(g, x + dx, y + dy, r, rot, pattern === 'cosmos' ? 4 : 5, 0.45);
        else if (pattern === 'circuit') {
          if (i % 3 === 0) chipIcon(g, x + dx, y + dy, r * 1.5, theme.cabinet.matInk, theme.cabinet.matInk, null);
          else {
            g.beginPath();
            g.arc(x + dx, y + dy, r * 0.35, 0, 6.28);
            g.fill();
          }
        } else {
          g.beginPath();
          g.arc(x + dx, y + dy, r * 0.7, 0, 6.28);
          g.fill();
        }
      }
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** Round badge with the PLUSH PORTAL monogram for the lower cabinet. */
export function makeBadgeTexture(theme: ThemeDef, size: number, font: string): Texture {
  const { c, g } = canvas(size);
  const r = size / 2;
  g.clearRect(0, 0, size, size);
  const grad = g.createRadialGradient(r * 0.8, r * 0.7, r * 0.1, r, r, r);
  grad.addColorStop(0, sceneInk(theme).badgeHighlight);
  grad.addColorStop(1, theme.cabinet.frame);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r * 0.98, 0, 6.28);
  g.fill();
  g.strokeStyle = theme.cabinet.frameAccent;
  g.lineWidth = size * 0.045;
  g.beginPath();
  g.arc(r, r, r * 0.86, 0, 6.28);
  g.stroke();
  // Printed micro-ring of dots (only resolvable at higher tiers, harmless at low ones).
  g.fillStyle = theme.cabinet.frameAccent;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    g.beginPath();
    g.arc(r + Math.cos(a) * r * 0.765, r + Math.sin(a) * r * 0.765, size * 0.006, 0, 6.28);
    g.fill();
  }
  const ink = sceneInk(theme);
  g.fillStyle = ink.primaryDeep;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(size * 0.2)}px ${font}`;
  g.fillText('PLUSH', r, r * 0.8);
  g.fillStyle = ink.accent === theme.cabinet.frame ? ink.primary : ink.accent;
  g.font = `700 ${Math.round(size * 0.17)}px ${font}`;
  g.fillText('PORTAL', r, r * 1.2);
  // Little claw glyph on top.
  g.strokeStyle = ink.primary;
  g.lineWidth = size * 0.022;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(r, r * 0.3);
  g.lineTo(r, r * 0.44);
  g.moveTo(r - size * 0.07, r * 0.54);
  g.quadraticCurveTo(r - size * 0.08, r * 0.42, r, r * 0.44);
  g.quadraticCurveTo(r + size * 0.08, r * 0.42, r + size * 0.07, r * 0.54);
  g.stroke();
  return finish(c, true, false);
}

/** Small "PRIZE" sign for the chute. */
export function makeSignTexture(theme: ThemeDef, text: string, font: string, scale = 1): Texture {
  const W = Math.round(512 * scale), H = Math.round(160 * scale);
  const { c, g } = canvas(W, H);
  g.scale(scale, scale);
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = theme.cabinet.frameAccent;
  g.beginPath();
  g.roundRect(8, 8, 496, 144, 36);
  g.fill();
  const onPrimary = sceneInk(theme).onPrimary;
  g.strokeStyle = onPrimary;
  g.globalAlpha = 0.55;
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(18, 18, 476, 124, 28);
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = onPrimary;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 84px ${font}`;
  g.fillText(text, 256, 86);
  return finish(c, true, false);
}

/** Cells of the decal atlas (2 × 2). */
export const DECAL = { win: 0, free: 1, caution: 2, arrow: 3 } as const;
export type DecalId = keyof typeof DECAL;

/** UV rectangle [u0, v0, u1, v1] of a decal in the atlas (three.js: v grows upwards, canvas rows downwards). */
export function decalUv(id: DecalId): [number, number, number, number] {
  const i = DECAL[id];
  const col = i % 2, row = Math.floor(i / 2);
  return [col / 2, 1 - (row + 1) / 2, (col + 1) / 2, 1 - row / 2];
}

/**
 * Printed stickers on the cabinet: a starburst "WIN!", a "FREE PLAY" price card, a
 * caution label and a "PRIZE" arrow. One atlas per theme, transparent outside the stickers.
 */
export function makeDecalAtlas(theme: ThemeDef, size: number, font: string): Texture {
  const { c, g } = canvas(size);
  g.clearRect(0, 0, size, size);
  const h = size / 2;
  const dark = theme.cabinet.pattern === 'circuit' || theme.cabinet.pattern === 'cosmos';
  const ink = sceneInk(theme);
  const cell = (i: number, draw: (s: number) => void) => {
    g.save();
    g.translate((i % 2) * h, Math.floor(i / 2) * h);
    draw(h);
    g.restore();
  };
  const label = (text: string, x: number, y: number, px: number, color: string, weight = 700) => {
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${weight} ${Math.round(px)}px ${font}`;
    g.fillText(text, x, y);
  };
  // WIN! starburst.
  cell(DECAL.win, (s) => {
    g.fillStyle = '#ffffff';
    star(g, s / 2, s / 2, s * 0.48, 0.1, 14, 0.8);
    g.fillStyle = ink.primary;
    star(g, s / 2, s / 2, s * 0.43, 0.1, 14, 0.8);
    g.fillStyle = ink.accent2;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.29, 0, Math.PI * 2);
    g.fill();
    label(theme.cabinet.pattern === 'circuit' ? 'GG!' : 'WIN!', s / 2, s * 0.52, s * 0.22, ink.primaryDeep);
  });
  // FREE PLAY card.
  cell(DECAL.free, (s) => {
    g.fillStyle = dark ? ink.paper : '#ffffff';
    g.beginPath();
    g.roundRect(s * 0.06, s * 0.2, s * 0.88, s * 0.6, s * 0.08);
    g.fill();
    g.strokeStyle = ink.primary;
    g.lineWidth = s * 0.035;
    g.stroke();
    label(theme.cabinet.pattern === 'circuit' ? 'FREE COMPUTE' : 'FREE PLAY', s / 2, s * 0.42, s * 0.12, dark ? ink.cardTitle : ink.primaryDeep);
    label('1 GRAB = 1 TRY', s / 2, s * 0.62, s * 0.075, ink.ink, 600);
  });
  // Caution label with hazard stripes.
  cell(DECAL.caution, (s) => {
    g.save();
    g.beginPath();
    g.roundRect(s * 0.04, s * 0.3, s * 0.92, s * 0.4, s * 0.05);
    g.clip();
    g.fillStyle = ink.caution;
    g.fillRect(0, 0, s, s);
    g.fillStyle = ink.cautionInk;
    for (let x = -s; x < s * 2; x += s * 0.12) {
      g.beginPath();
      g.moveTo(x, s * 0.3);
      g.lineTo(x + s * 0.06, s * 0.3);
      g.lineTo(x + s * 0.06 + s * 0.4, s * 0.7);
      g.lineTo(x + s * 0.4, s * 0.7);
      g.fill();
    }
    g.fillStyle = ink.caution;
    g.fillRect(s * 0.12, s * 0.38, s * 0.76, s * 0.24);
    g.restore();
    label('MIND THE CLAW', s / 2, s * 0.505, s * 0.09, ink.cautionInk);
  });
  // PRIZE arrow.
  cell(DECAL.arrow, (s) => {
    g.fillStyle = theme.cabinet.frameAccent;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.92);
    g.lineTo(s * 0.86, s * 0.52);
    g.lineTo(s * 0.64, s * 0.52);
    g.lineTo(s * 0.64, s * 0.1);
    g.lineTo(s * 0.36, s * 0.1);
    g.lineTo(s * 0.36, s * 0.52);
    g.lineTo(s * 0.14, s * 0.52);
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.025;
    g.stroke();
  });
  return finish(c, true, false);
}

/** Out-of-focus arcade lights seen through the side glass (2:1 equirectangular-ish strip). */
export function makeBackdropTexture(theme: ThemeDef, size: number): Texture {
  const { c, g } = canvas(size * 2, size);
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, theme.backdrop.top);
  grad.addColorStop(1, theme.backdrop.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, size * 2, size);
  const rng = makeRng(99 + theme.id.length * 13);
  if (theme.cabinet.pattern === 'circuit') {
    // Server hall: rows of tiny status LEDs on dark racks, a few big soft glows.
    const rack = sceneParts(theme).rack;
    const racks = 14;
    for (let i = 0; i < racks; i++) {
      const x = (i / racks) * size * 2 + rng() * size * 0.04;
      const w = size * 0.09;
      const top = size * (0.22 + rng() * 0.08), bottom = size * (0.82 + rng() * 0.06);
      g.globalAlpha = 0.55;
      g.fillStyle = rack;
      g.fillRect(x, top, w, bottom - top);
      for (let r = 0; r < 26; r++) {
        const y = top + ((r + 0.5) / 26) * (bottom - top);
        for (let k = 0; k < 4; k++) {
          if (rng() < 0.45) continue;
          const col = theme.backdrop.bokeh[Math.floor(rng() * theme.backdrop.bokeh.length)]!;
          g.globalAlpha = 0.25 + rng() * 0.6;
          g.fillStyle = col;
          g.beginPath();
          g.arc(x + w * (0.2 + k * 0.2), y, size * 0.0035, 0, 6.28);
          g.fill();
        }
      }
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = rng() * size * 2, y = size * (0.15 + rng() * 0.7), r = size * (0.012 + rng() * 0.05);
    const col = theme.backdrop.bokeh[Math.floor(rng() * theme.backdrop.bokeh.length)]!;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(0.7, col);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = (0.1 + rng() * 0.28) * (theme.cabinet.pattern === 'circuit' ? 0.7 : 1);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, 6.28);
    g.fill();
  }
  g.globalAlpha = 1;
  return finish(c, true, true);
}

/**
 * Lit header signs of the two neighbouring machines (src/scene/arcadeRow.ts): one 1024 × 256 cell
 * per sign, stacked (top cell = left neighbour). Theme colours only; on a brand-dressed theme the
 * sign is black with brand-green type and rule (sceneInk), so it stays inside the kit's palette.
 */
export function makeRowSignTexture(theme: ThemeDef, words: readonly [string, string], font: string, size: number): Texture {
  const W = Math.max(256, Math.min(1024, size));
  const H = W / 4;
  const { c, g } = canvas(W, H * 2);
  const ink = sceneInk(theme);
  const cab = theme.cabinet;
  // The circuit (GPU) theme keeps to its cabinet colours: black face, green rule and type.
  const kit = cab.pattern === 'circuit';
  const dark = kit || cab.pattern === 'cosmos';
  const s = W / 1024;
  const rng = makeRng(311 + theme.id.length);
  words.forEach((word, i) => {
    const y0 = i * H;
    // Light box face: a soft vertical gradient, brighter in the middle like a lit diffuser.
    const face = kit ? cab.fascia : i === 0 ? ink.primary : ink.accent;
    const lineColour = kit ? cab.frameAccent : '#ffffff';
    g.fillStyle = face;
    g.fillRect(0, y0, W, H);
    if (!kit) {
      const grad = g.createLinearGradient(0, y0, 0, y0 + H);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, y0, W, H);
    }
    // Inner rule and a row of bulbs along the top and bottom edges.
    g.strokeStyle = lineColour;
    g.globalAlpha = kit ? 1 : 0.75;
    g.lineWidth = 6 * s;
    g.beginPath();
    g.roundRect(18 * s, y0 + 18 * s, W - 36 * s, H - 36 * s, 34 * s);
    g.stroke();
    g.globalAlpha = 1;
    const bulbs = 22;
    for (let k = 0; k < bulbs; k++) {
      const bx = (40 + (k / (bulbs - 1)) * (W / s - 80)) * s;
      for (const by of [y0 + 9 * s, y0 + H - 9 * s]) {
        g.fillStyle = kit ? cab.led[k % cab.led.length]! : k % 2 === 0 ? '#ffffff' : ink.accent2;
        g.beginPath();
        g.arc(bx, by, 4.5 * s, 0, 6.28);
        g.fill();
      }
    }
    // Small motifs either side of the word.
    for (const side of [-1, 1]) {
      const mx = W / 2 + side * 380 * s;
      const my = y0 + H / 2;
      if (kit) {
        g.fillStyle = cab.frameAccent;
        g.fillRect(mx - 18 * s, my - 18 * s, 36 * s, 36 * s);
        g.fillStyle = cab.fascia;
        g.fillRect(mx - 9 * s, my - 9 * s, 18 * s, 18 * s);
      } else {
        g.fillStyle = i === 0 ? ink.accent2 : '#ffffff';
        star(g, mx, my, 30 * s, rng() * 0.5, 5, 0.5);
      }
    }
    g.fillStyle = kit ? cab.frameAccent : dark ? '#ffffff' : ink.onPrimary;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(132 * s)}px ${font}`;
    if (!kit) {
      g.shadowColor = 'rgba(0, 0, 0, 0.25)';
      g.shadowBlur = 10 * s;
      g.shadowOffsetY = 5 * s;
    }
    g.fillText(word, W / 2, y0 + H / 2 + 6 * s, W - 220 * s);
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
  });
  return finish(c, true, false);
}

/**
 * Haze behind a neighbour's front glass (white; the material tints it): alpha rises towards the
 * floor and the ceiling, where a real cabinet is lit least, and stays lighter in the middle band.
 */
export function makeVeilTexture(): Texture {
  const { c, g } = canvas(16, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.78)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.86, 'rgba(255,255,255,0.58)');
  grad.addColorStop(1, 'rgba(255,255,255,0.85)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const t = finish(c, true, false);
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  return t;
}

/**
 * Baked corner occlusion: black, alpha falling off from u = 0 (the corner) to u = 1, so a strip laid
 * along an inside corner darkens it the way ambient occlusion would.
 */
export function makeShadeTexture(): Texture {
  const { c, g } = canvas(128, 4);
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.25, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 4);
  const t = finish(c, true, false);
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  return t;
}

/**
 * Dust, specks and faint fingerprint smudges on the front glass (src/scene/glass.ts). One channel
 * (R) of brightness on black: the glass shader adds it where light grazes the pane. Tiles.
 */
export function makeDustTexture(size: number, seed = 23): Texture {
  const { c, g } = canvas(size);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  const rng = makeRng(seed);
  const u = size / 512;
  g.globalCompositeOperation = 'lighter';
  // Smudges: soft overlapping ovals with a few ridges, like a wiped fingerprint.
  for (let i = 0; i < 5; i++) {
    const x = rng() * size, y = rng() * size, r = (16 + rng() * 22) * u;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const rg = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        rg.addColorStop(0, 'rgba(70,0,0,0.5)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * 0.72, rng() * 3.1, 0, 6.28);
        g.fill();
        g.strokeStyle = 'rgba(40,0,0,0.6)';
        g.lineWidth = 1.2 * u;
        for (let k = 1; k < 5; k++) {
          g.beginPath();
          g.ellipse(x + dx, y + dy, r * k * 0.2, r * k * 0.15, 0.4, 0, 6.28);
          g.stroke();
        }
      }
  }
  // Specks of dust: tiny bright dots, most of them faint.
  for (let i = 0; i < 260; i++) {
    const x = rng() * size, y = rng() * size;
    const r = (0.5 + Math.pow(rng(), 3) * 1.6) * u;
    const v = Math.round(90 + rng() * 165);
    g.fillStyle = `rgb(${v},0,0)`;
    g.beginPath();
    g.arc(x, y, r, 0, 6.28);
    g.fill();
  }
  // A few short lint fibres.
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const x = rng() * size, y = rng() * size, len = (4 + rng() * 10) * u, a = rng() * 6.28;
    g.strokeStyle = `rgb(${Math.round(80 + rng() * 80)},0,0)`;
    g.lineWidth = 0.8 * u;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.8) * len * 0.6, y + Math.sin(a + 0.8) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return finish(c, false);
}

/** Soft radial sprite used for particles and the aim reticle glow. */
export function makeGlowTexture(): Texture {
  const { c, g } = canvas(128);
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return finish(c, true, false);
}

/**
 * Loads a logo file (SVG or bitmap) into a texture with the artwork's own aspect ratio, `maxWidth`
 * texels wide (an SVG is rasterised at that size; nothing is stretched or recoloured). Resolves
 * to null when the file is missing or cannot be decoded. Clamped edges: a logo never tiles.
 */
export async function loadLogoTexture(url: string, maxWidth: number): Promise<{ texture: Texture; aspect: number } | null> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!(nw > 0 && nh > 0)) return null;
    const aspect = nw / nh;
    const w = Math.max(16, Math.round(maxWidth));
    const h = Math.max(8, Math.round(w / aspect));
    const { c, g } = canvas(w, h);
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const texture = finish(c, true, false);
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    return { texture, aspect };
  } catch {
    return null;
  }
}
