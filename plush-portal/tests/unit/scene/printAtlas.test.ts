/**
 * The print atlas of the machine items (docs/design/machines.md, sections 5.2 and 8.1 WS-E): the cell
 * mapping, the colour-and-initial fallback before the portraits, the redraw when they arrive, the
 * bridge box's window, and the gpu theme's palette-only rule for every colour the items draw.
 */
import { describe, expect, it } from 'vitest';
import { NVIDIA_PALETTE } from '../../../src/brand/kits';
import { atlasGrid, atlasPrint, atlasSize, BOX_LAYOUT, BoxPrint, cellUv, drawBoxPrint, mixHex, PrintAtlas, type AtlasPrint } from '../../../src/scene/machines/printAtlas';
import { GEM_LOOKS, itemColors } from '../../../src/scene/machines/itemLooks';
import { THEMES } from '../../../src/themes/themes';
import { themeAssets } from '../game/harness';

/** A 2D context that records what is drawn. */
function recordingCanvas() {
  const calls: { name: string; args: unknown[]; fill?: string }[] = [];
  const fills = new Set<string>();
  let fillStyle = '#000000';
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, key: string) => {
      if (key === 'fillStyle') return fillStyle;
      if (key in t) return t[key];
      if (key === 'measureText') return (s: string) => ({ width: 6 * s.length });
      return (...args: unknown[]) => {
        calls.push({ name: key, args, fill: fillStyle });
        if (key === 'fill' || key === 'fillRect' || key === 'fillText') fills.add(fillStyle.toLowerCase());
      };
    },
    set: (t, key: string, value) => {
      if (key === 'fillStyle') fillStyle = String(value);
      else t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { calls, fills, ctx, make: (w: number, h: number) => Object.assign(canvas, { width: w, height: h }) };
}

const prints = (n: number): AtlasPrint[] => Array.from({ length: n }, (_, i) => ({ id: `t.c${i}`, name: `Char ${i}`, initial: 'C', color: '#ff8800', tier: 'common' }));

describe('print atlas layout', () => {
  it('sizes follow the texture tier', () => {
    expect(atlasSize('512')).toBe(512);
    expect(atlasSize('1k')).toBe(1024);
    expect(atlasSize('2k')).toBe(1024);
    expect(atlasSize('4k')).toBe(2048);
  });

  it('every character gets its own cell inside the texture, none overlap', () => {
    for (const n of [1, 4, 6, 9, 10, 24]) {
      const { cols, cell } = atlasGrid(n, 1024);
      expect(cols * cols).toBeGreaterThanOrEqual(n);
      const seen = new Set<string>();
      for (let i = 0; i < n; i++) {
        const [u, v, du, dv] = cellUv(i, cols, cell, 1024);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(u + du).toBeLessThanOrEqual(1 + 1e-9);
        expect(v + dv).toBeLessThanOrEqual(1 + 1e-9);
        seen.add(`${u.toFixed(5)},${v.toFixed(5)}`);
      }
      expect(seen.size).toBe(n);
    }
  });

  it('maps a print id to its cell, unknown ids to the first one', () => {
    const rec = recordingCanvas();
    const atlas = new PrintAtlas(THEMES.sakura, prints(6), 1024, 'sans-serif', async () => ({}) as CanvasImageSource, rec.make);
    expect(atlas.cols).toBe(3);
    expect(atlas.uv('t.c4')).toEqual(cellUv(4, 3, atlas.cell, 1024));
    expect(atlas.uv('nobody')).toEqual(cellUv(0, 3, atlas.cell, 1024));
    expect(atlas.uv(null)).toEqual(cellUv(0, 3, atlas.cell, 1024));
  });

  it('the real themes fit their characters on Safe', () => {
    for (const id of ['sakura', 'storybook', 'ocean', 'cosmic', 'gpu'] as const) {
      const n = themeAssets(id).length;
      const { cell } = atlasGrid(n, 512);
      expect(n, id).toBeGreaterThan(0);
      expect(cell, id).toBeGreaterThanOrEqual(128);
    }
  });
});

describe('print atlas drawing', () => {
  it('draws the colour-and-initial fallback before the portraits and redraws a cell when its portrait arrives', async () => {
    const rec = recordingCanvas();
    const loaded: string[] = [];
    const atlas = new PrintAtlas(THEMES.sakura, prints(4), 512, 'sans-serif', async (url) => {
      loaded.push(url);
      return { width: 256, height: 256 } as unknown as CanvasImageSource;
    }, rec.make);
    expect(rec.calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
    expect(rec.calls.filter((c) => c.name === 'arc')).toHaveLength(4);
    const before = atlas.version;
    const version = atlas.texture.version;
    await Promise.all(atlas.setThumbnails({ 't.c1': 'data:a', 't.c3': 'data:b', other: 'data:c' }));
    expect(loaded).toEqual(['data:a', 'data:b']);
    expect(rec.calls.filter((c) => c.name === 'drawImage')).toHaveLength(2);
    expect(atlas.version).toBe(before + 2);
    expect(atlas.texture.version).toBeGreaterThan(version);
    // The same portraits again: nothing is reloaded or redrawn.
    await Promise.all(atlas.setThumbnails({ 't.c1': 'data:a', 't.c3': 'data:b' }));
    expect(loaded).toHaveLength(2);
    expect(atlas.version).toBe(before + 2);
  });

  it('a portrait that fails to load keeps the fallback and is tried again later', async () => {
    const rec = recordingCanvas();
    let fail = true;
    const atlas = new PrintAtlas(THEMES.sakura, prints(1), 512, 'sans-serif', async () => {
      if (fail) throw new Error('nope');
      return {} as CanvasImageSource;
    }, rec.make);
    await Promise.all(atlas.setThumbnails({ 't.c0': 'data:x' }));
    expect(rec.calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
    fail = false;
    await Promise.all(atlas.setThumbnails({ 't.c0': 'data:x' }));
    expect(rec.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
  });

  it('the bridge box keeps its window clear and prints the portrait on the back', async () => {
    const rec = recordingCanvas();
    const p = atlasPrint(themeAssets('sakura')[0]!, 'en');
    const box = new BoxPrint(p, itemColors(THEMES.sakura), 1024, 'sans-serif', true, async () => ({}) as CanvasImageSource, rec.make);
    await box.setThumbnail('data:p');
    // One portrait (the back); the front's window area was cleared, not painted.
    expect(rec.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
    const [, fy, , fh] = BOX_LAYOUT.front;
    const window = rec.calls.filter((c) => c.name === 'clearRect' && (c.args[1] as number) > fy * 1024 && (c.args[1] as number) < (fy + fh) * 1024);
    expect(window.length).toBeGreaterThan(0);
    // Safe: no window, the portrait on the front too.
    const safe = recordingCanvas();
    const flat = new BoxPrint(p, itemColors(THEMES.sakura), 512, 'sans-serif', false, async () => ({}) as CanvasImageSource, safe.make);
    await flat.setThumbnail('data:p');
    expect(safe.calls.filter((c) => c.name === 'drawImage')).toHaveLength(2);
  });

  it('box faces keep their aspect ratio in the layout (front 2.4 : 1 like the 0.24 × 0.10 face)', () => {
    const [, , w, h] = BOX_LAYOUT.front;
    expect(w / h).toBeCloseTo(2.4, 1);
    const [, , sw, sh] = BOX_LAYOUT.left;
    expect(sw / sh).toBeCloseTo(1, 2);
    for (const [x, y, cw, ch] of Object.values(BOX_LAYOUT)) {
      expect(x + cw).toBeLessThanOrEqual(1 + 1e-6);
      expect(y + ch).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('mixes hex colours', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });
});

describe('the gpu theme draws palette colours only', () => {
  const PALETTE = new Set(Object.values(NVIDIA_PALETTE).map((h) => h.toLowerCase()));
  const colours = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string' && v.startsWith('#')) out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) colours(x, out);
    return out;
  };

  it('item colours (gems, coins, cards, rarity stripes) are palette values, without rainbow effects', () => {
    const c = itemColors(THEMES.gpu);
    for (const hex of colours(c)) expect(PALETTE.has(hex.toLowerCase()), hex).toBe(true);
    expect(c.iridescence).toBe(false);
    expect(c.tintCards).toBe(false);
    expect(GEM_LOOKS.every((l) => c.gems[l])).toBe(true);
    // Other themes keep their jewel colours and gold.
    const sakura = itemColors(THEMES.sakura);
    expect(sakura.gems.gemRuby.color).not.toBe(sakura.gems.gemSapphire.color);
    expect(sakura.iridescence).toBe(true);
  });

  it('cards and boxes are painted with palette colours only (fallback included), whatever the character', async () => {
    const rec = recordingCanvas();
    const gpuPrints = themeAssets('gpu').map((a) => atlasPrint(a, 'en'));
    const atlas = new PrintAtlas(THEMES.gpu, gpuPrints, 1024, 'sans-serif', async () => ({}) as CanvasImageSource, rec.make);
    void atlas;
    const box = recordingCanvas();
    drawBoxPrint(box.ctx, 1024, gpuPrints[0]!, itemColors(THEMES.gpu), 'sans-serif', null, true);
    for (const hex of [...rec.fills, ...box.fills]) expect(PALETTE.has(hex), hex).toBe(true);
  });
});
