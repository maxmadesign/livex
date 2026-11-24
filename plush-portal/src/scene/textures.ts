import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { makeRng } from '../core/math';
import type { ThemeDef } from '../themes/themes';

/** Texture edge length for a quality tier. */
export function textureSize(tier: '512' | '1k' | '2k' | '4k'): number {
  return tier === '512' ? 512 : tier === '1k' ? 1024 : tier === '2k' ? 2048 : 4096;
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
  t.anisotropy = 4;
  t.generateMipmaps = true;
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
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** Quilted padding: height map (diamond pillows with stitched valleys). */
export function makeQuiltBump(size: number): Texture {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const cells = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells, v = (y / size) * cells;
      // Rotate 45° so the pillows are diamonds.
      const a = (u + v) % 1, b = (u - v + cells) % 1;
      const da = Math.min(a, 1 - a), db = Math.min(b, 1 - b);
      const d = Math.min(da, db) * 2; // 0 at a seam, 1 in the middle of a pillow
      const h = Math.pow(Math.sin(Math.min(1, d * 1.6) * Math.PI * 0.5), 0.7);
      const val = Math.round(40 + 215 * h);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, false);
}

/** Soft play mat: base colour with a faint woven grain and theme motifs. */
export function makeMatTexture(theme: ThemeDef, size: number): Texture {
  const { c, g } = canvas(size);
  g.fillStyle = theme.cabinet.mat;
  g.fillRect(0, 0, size, size);
  const rng = makeRng(4242 + theme.id.length);
  const u = size / 512;
  g.globalAlpha = 0.5;
  g.fillStyle = theme.cabinet.matInk;
  for (let i = 0; i < 18; i++) {
    const x = rng() * size, y = rng() * size, r = (7 + rng() * 9) * u, rot = rng() * 6.28;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        if (theme.cabinet.pattern === 'sakura') flower(g, x + dx, y + dy, r, rot, theme.cabinet.matInk, '#ffffff');
        else if (theme.cabinet.pattern === 'cosmos' || theme.cabinet.pattern === 'storybook') star(g, x + dx, y + dy, r, rot, theme.cabinet.pattern === 'cosmos' ? 4 : 5, 0.45);
        else {
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
  grad.addColorStop(0, '#ffffff');
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
  g.fillStyle = theme.ui.primaryDeep;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(size * 0.2)}px ${font}`;
  g.fillText('PLUSH', r, r * 0.8);
  g.fillStyle = theme.ui.accent === theme.cabinet.frame ? theme.ui.primary : theme.ui.accent;
  g.font = `700 ${Math.round(size * 0.17)}px ${font}`;
  g.fillText('PORTAL', r, r * 1.2);
  // Little claw glyph on top.
  g.strokeStyle = theme.ui.primary;
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

/** Small "PRIZE ▼" sign for the chute. */
export function makeSignTexture(theme: ThemeDef, text: string, font: string): Texture {
  const { c, g } = canvas(512, 160);
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = theme.cabinet.frameAccent;
  const rr = 36;
  g.beginPath();
  g.roundRect(8, 8, 496, 144, rr);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 84px ${font}`;
  g.fillText(text, 256, 86);
  return finish(c, true, false);
}

/** Out-of-focus arcade lights seen through the side glass. */
export function makeBackdropTexture(theme: ThemeDef, size: number): Texture {
  const { c, g } = canvas(size * 2, size);
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, theme.backdrop.top);
  grad.addColorStop(1, theme.backdrop.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, size * 2, size);
  const rng = makeRng(99 + theme.id.length * 13);
  for (let i = 0; i < 70; i++) {
    const x = rng() * size * 2, y = size * (0.15 + rng() * 0.7), r = size * (0.012 + rng() * 0.05);
    const col = theme.backdrop.bokeh[Math.floor(rng() * theme.backdrop.bokeh.length)]!;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(0.7, col);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = 0.1 + rng() * 0.28;
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, 6.28);
    g.fill();
  }
  g.globalAlpha = 1;
  const t = finish(c, true, true);
  return t;
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
