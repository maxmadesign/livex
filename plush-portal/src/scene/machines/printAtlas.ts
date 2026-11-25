/**
 * Printed artwork of the machine items (docs/design/machines.md, section 5.2):
 *
 *  - PrintAtlas: one canvas texture per theme with a cell per character (snack boxes pick their
 *    cell per instance). A cell holds the character's portrait (the UI thumbnails, rendered by the
 *    game in the background), its name, a rarity stripe and the theme's border. Until the portrait
 *    has arrived a cell shows the character's colour and initial, and it is redrawn when it does.
 *  - drawBoxPrint: the bridge prize box's own print (front, back, sides, top on one canvas); with a
 *    window the front's middle is left transparent so the plush inside shows through.
 *
 * Texture sizes follow the graphics tier: 512 on Safe, 1024 on Medium / High, 2048 on Ultra.
 * Presentation only: nothing here reaches the simulation.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { rarityOf, type RarityTier } from '../../game/rarity';
import type { Lang } from '../../core/types';
import type { PlushAsset } from '../../plush/manifest';
import type { ThemeDef } from '../../themes/themes';
import { itemColors, type ItemColors } from './itemLooks';

/** What a cell needs to know about one character. */
export interface AtlasPrint {
  id: string;
  name: string;
  initial: string;
  /** The character's main colour (fallback picture). */
  color: string;
  tier: RarityTier;
}

/** A 2D canvas the atlas can draw on (the DOM's, or a stand-in in tests). */
export interface AtlasCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
}
export type CanvasFactory = (w: number, h: number) => AtlasCanvas;
export type ImageLoader = (url: string) => Promise<CanvasImageSource>;

/** Atlas edge length (px) for a texture tier. */
export function atlasSize(textures: string | undefined): number {
  return textures === '512' ? 512 : textures === '4k' ? 2048 : 1024;
}

/** Columns (= rows) and cell size of an atlas with room for `count` characters. */
export function atlasGrid(count: number, size: number): { cols: number; cell: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  return { cols, cell: Math.floor(size / cols) };
}

/** UV rectangle [u0, v0, du, dv] of cell `index` (three.js v grows upwards; canvas rows downwards). */
export function cellUv(index: number, cols: number, cell: number, size: number): [number, number, number, number] {
  const col = index % cols, row = Math.floor(index / cols);
  const du = cell / size;
  return [col * du, 1 - (row + 1) * du, du, du];
}

/** The language of the page (for names printed on boxes); English outside a browser. */
export function pageLang(): Lang {
  const lang = typeof document !== 'undefined' ? (document.documentElement?.lang ?? '') : '';
  return lang.startsWith('zh') ? 'zh' : lang.startsWith('ja') ? 'ja' : 'en';
}

export function atlasPrint(asset: PlushAsset, lang: Lang = pageLang()): AtlasPrint {
  const name = asset.name[lang] || asset.name.en || asset.slug;
  return { id: asset.id, name, initial: [...name][0]?.toUpperCase() ?? '?', color: asset.palette[0] ?? '#cccccc', tier: rarityOf(asset.id) };
}

const domCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const domImage: ImageLoader = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('thumbnail did not load'));
    img.src = url;
  });

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** `a` mixed towards `b` by `k` (hex colours). */
export function mixHex(a: string, b: string, k: number): string {
  const parse = (h: string) => {
    const s = h.replace('#', '');
    const v = Number.parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s.slice(0, 6), 16);
    return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [204, 204, 204];
  };
  const x = parse(a), y = parse(b);
  return `#${x.map((c, i) => Math.round(c + (y[i]! - c) * k).toString(16).padStart(2, '0')).join('')}`;
}

/** Text that never runs wider than `maxW` (shrinks the font). */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, font: string): void {
  let size = px;
  g.font = `700 ${size}px ${font}`;
  const w = g.measureText(text).width;
  if (w > maxW && w > 0) {
    size = Math.max(6, Math.floor((size * maxW) / w));
    g.font = `700 ${size}px ${font}`;
  }
  g.fillText(text, x, y);
}

/**
 * One printed card (a snack box face, the front / back of the bridge box): theme border, portrait
 * (or the colour-and-initial fallback), a rarity stripe and the name. `window` leaves the middle
 * transparent (the bridge box on Medium and better).
 */
export function drawCard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  print: AtlasPrint,
  colors: ItemColors,
  font: string,
  portrait: CanvasImageSource | null,
  opts: { window?: boolean } = {},
): void {
  const m = Math.min(w, h);
  g.save();
  g.clearRect(x, y, w, h);
  g.fillStyle = colors.card.border;
  g.fillRect(x, y, w, h);
  const inset = m * 0.06;
  // The card takes a pastel of the character's own colour (a brand kit keeps its plain paper).
  g.fillStyle = colors.tintCards ? mixHex(colors.card.paper, print.color, 0.55) : colors.card.paper;
  roundRect(g, x + inset, y + inset, w - 2 * inset, h - 2 * inset, m * 0.08);
  g.fill();
  // Rarity stripe and name band at the bottom.
  const band = h * 0.2;
  g.fillStyle = colors.rarity[print.tier];
  g.fillRect(x + inset, y + h - inset - band * 0.22, w - 2 * inset, band * 0.22);
  g.fillStyle = colors.card.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, print.name, x + w / 2, y + h - inset - band * 0.62, w - 4 * inset, Math.round(band * 0.62), font);
  const area = { x: x + inset * 2, y: y + inset * 2, w: w - inset * 4, h: h - inset * 3 - band };
  if (opts.window) {
    // The clear window: nothing printed there (the material's alpha test cuts it out).
    g.clearRect(area.x, area.y, area.w, area.h);
  } else if (portrait) {
    const s = Math.min(area.w, area.h);
    g.drawImage(portrait, area.x + (area.w - s) / 2, area.y + (area.h - s) / 2, s, s);
  } else {
    // Until the portrait has arrived: the character's colour and initial.
    const s = Math.min(area.w, area.h) * 0.42;
    g.fillStyle = colors.tintCards ? print.color : colors.card.border;
    g.beginPath();
    g.arc(area.x + area.w / 2, area.y + area.h / 2, s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors.card.paper;
    fitText(g, print.initial, area.x + area.w / 2, area.y + area.h / 2, s * 1.6, Math.round(s * 1.1), font);
  }
  g.restore();
}

/** Theme stripes for the box's top and the snack boxes' plain faces. */
function drawPattern(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: ItemColors): void {
  g.save();
  g.fillStyle = colors.card.border;
  g.fillRect(x, y, w, h);
  g.fillStyle = colors.card.accent;
  g.globalAlpha = 0.45;
  const step = Math.max(6, h * 0.35);
  for (let i = -h; i < w + h; i += step) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + step * 0.5, y + h);
    g.lineTo(x + i + step * 0.5 + h, y);
    g.lineTo(x + i + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/**
 * Layout of the bridge box's canvas (fractions of its width / height): the front and back are the
 * big cells, the top and the two sides share the bottom row. Faces keep their real aspect ratio.
 */
export const BOX_LAYOUT = {
  front: [0, 0, 1, 0.4167],
  back: [0, 0.4167, 1, 0.4167],
  top: [0, 0.8333, 0.4, 0.1667],
  left: [0.4, 0.8333, 0.1667, 0.1667],
  right: [0.5667, 0.8333, 0.1667, 0.1667],
  bottom: [0.7333, 0.8333, 0.2667, 0.1667],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type BoxFace = keyof typeof BOX_LAYOUT;

/** Paints the bridge box's whole print on a square canvas of edge `size`. */
export function drawBoxPrint(g: CanvasRenderingContext2D, size: number, print: AtlasPrint, colors: ItemColors, font: string, portrait: CanvasImageSource | null, window: boolean): void {
  const at = (f: BoxFace) => {
    const [x, y, w, h] = BOX_LAYOUT[f];
    return [x * size, y * size, w * size, h * size] as const;
  };
  const [fx, fy, fw, fh] = at('front');
  // The front and back read like a toy box: portrait on the left, name to the right (or the window).
  drawCard(g, fx, fy, fw, fh, print, colors, font, portrait, { window });
  const [bx, by, bw, bh] = at('back');
  drawCard(g, bx, by, bw, bh, print, colors, font, portrait);
  const [tx, ty, tw, th] = at('top');
  drawPattern(g, tx, ty, tw, th, colors);
  for (const side of ['left', 'right'] as const) {
    const [sx, sy, sw, sh] = at(side);
    g.save();
    g.fillStyle = colors.card.border;
    g.fillRect(sx, sy, sw, sh);
    g.fillStyle = colors.rarity[print.tier];
    g.fillRect(sx, sy + sh * 0.78, sw, sh * 0.12);
    g.fillStyle = colors.card.paper;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, print.initial, sx + sw / 2, sy + sh * 0.42, sw * 0.8, Math.round(sh * 0.5), font);
    g.restore();
  }
  const [ox, oy, ow, oh] = at('bottom');
  g.fillStyle = colors.card.inside;
  g.fillRect(ox, oy, ow, oh);
}

function finishTexture(c: AtlasCanvas): CanvasTexture {
  const t = new CanvasTexture(c as unknown as HTMLCanvasElement);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** The snack boxes' print atlas of one theme. */
export class PrintAtlas {
  readonly texture: CanvasTexture;
  readonly size: number;
  readonly cols: number;
  readonly cell: number;
  /** Bumped whenever a cell was redrawn (tests, diagnostics). */
  version = 0;
  private readonly canvas: AtlasCanvas;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly index = new Map<string, number>();
  private readonly prints: AtlasPrint[];
  private readonly colors: ItemColors;
  /** Thumbnail URL drawn (or being drawn) in each cell. */
  private readonly drawn = new Map<string, string>();
  private disposed = false;

  constructor(
    readonly theme: ThemeDef,
    prints: readonly AtlasPrint[],
    size: number,
    private readonly font: string,
    private readonly loadImage: ImageLoader = domImage,
    makeCanvas: CanvasFactory = domCanvas,
  ) {
    this.prints = [...prints];
    this.size = size;
    const grid = atlasGrid(this.prints.length, size);
    this.cols = grid.cols;
    this.cell = grid.cell;
    this.colors = itemColors(theme);
    this.canvas = makeCanvas(size, size);
    this.g = this.canvas.getContext('2d');
    this.prints.forEach((p, i) => {
      this.index.set(p.id, i);
      this.drawCell(i, null);
    });
    this.texture = finishTexture(this.canvas);
  }

  /** UV rectangle [u0, v0, du, dv] of a character's cell (unknown ids get the first cell). */
  uv(id: string | null): [number, number, number, number] {
    const i = (id ? this.index.get(id) : undefined) ?? 0;
    return cellUv(i, this.cols, this.cell, this.size);
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  private drawCell(i: number, portrait: CanvasImageSource | null): void {
    const g = this.g;
    if (!g) return;
    const col = i % this.cols, row = Math.floor(i / this.cols);
    drawCard(g, col * this.cell, row * this.cell, this.cell, this.cell, this.prints[i]!, this.colors, this.font, portrait);
    this.version++;
  }

  /** The UI's portraits (id → data URL). Cells whose portrait is new are redrawn once it has loaded. */
  setThumbnails(thumbnails: Readonly<Record<string, string>>): Promise<void>[] {
    const jobs: Promise<void>[] = [];
    for (const [id, i] of this.index) {
      const url = thumbnails[id];
      if (!url || this.drawn.get(id) === url) continue;
      this.drawn.set(id, url);
      jobs.push(
        this.loadImage(url).then(
          (img) => {
            if (this.disposed || this.drawn.get(id) !== url) return;
            this.drawCell(i, img);
            this.texture.needsUpdate = true;
          },
          () => {
            // Keep the fallback; try again with the next set of portraits.
            if (this.drawn.get(id) === url) this.drawn.delete(id);
          },
        ),
      );
    }
    return jobs;
  }

  dispose(): void {
    this.disposed = true;
    this.texture.dispose();
  }
}

/** The bridge box's own print, redrawn when its portrait arrives. */
export class BoxPrint {
  readonly texture: CanvasTexture;
  private readonly canvas: AtlasCanvas;
  private readonly g: CanvasRenderingContext2D | null;
  private url: string | null = null;
  private disposed = false;

  constructor(
    readonly print: AtlasPrint,
    private readonly colors: ItemColors,
    readonly size: number,
    private readonly font: string,
    readonly window: boolean,
    private readonly loadImage: ImageLoader = domImage,
    makeCanvas: CanvasFactory = domCanvas,
  ) {
    this.canvas = makeCanvas(size, size);
    this.g = this.canvas.getContext('2d');
    if (this.g) drawBoxPrint(this.g, size, print, colors, font, null, window);
    this.texture = finishTexture(this.canvas);
  }

  setThumbnail(url: string | undefined): Promise<void> | null {
    if (!url || url === this.url) return null;
    this.url = url;
    return this.loadImage(url).then(
      (img) => {
        if (this.disposed || this.url !== url || !this.g) return;
        drawBoxPrint(this.g, this.size, this.print, this.colors, this.font, img, this.window);
        this.texture.needsUpdate = true;
      },
      () => {
        if (this.url === url) this.url = null;
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.texture.dispose();
  }
}
