import { Color } from 'three';
import type { ThemeDef } from '../../themes/themes';
import type { FxTier } from './api';

/** Theme-specific particle motif. */
export type Motif = 'petals' | 'paper' | 'bubbles' | 'stardust' | 'bits';

/** Motif of a theme: sakura petals, storybook paper stars, ocean bubbles, cosmic stardust, GPU data bits. */
export function motifOf(theme: ThemeDef | null): Motif {
  if (!theme) return 'stardust';
  if (theme.id === 'gpu') return 'bits';
  switch (theme.particles.kind) {
    case 'petals':
      return 'petals';
    case 'confetti':
      return 'paper';
    case 'bubbles':
      return 'bubbles';
    default:
      return 'stardust';
  }
}

export const TIER_INDEX: Readonly<Record<FxTier, number>> = { common: 0, rare: 1, epic: 2, legendary: 3 };
export const TIERS: readonly FxTier[] = ['common', 'rare', 'epic', 'legendary'];

/** Tier colours: common white, rare blue, epic purple, legendary gold (plus a rainbow in the shaders). */
export const TIER_COLORS: Readonly<Record<FxTier, readonly string[]>> = {
  common: ['#ffffff', '#fff6dc', '#e6f3ff'],
  rare: ['#3d9bff', '#8cc8ff', '#d8ecff'],
  epic: ['#a24dff', '#d39bff', '#ff6bd6'],
  legendary: ['#ffc21a', '#fff0a0', '#ff9d2e', '#ffffff'],
};

/** Mutable RGB triple (linear). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const _c = new Color();

/** A list of colours converted once to linear RGB (three's working colour space). */
export class Palette {
  readonly rgb: Float32Array;
  readonly size: number;

  constructor(colors: readonly string[]) {
    const list = colors.length > 0 ? colors : ['#ffffff'];
    this.size = list.length;
    this.rgb = new Float32Array(this.size * 3);
    for (let i = 0; i < this.size; i++) {
      _c.set(list[i]!);
      this.rgb[i * 3] = _c.r;
      this.rgb[i * 3 + 1] = _c.g;
      this.rgb[i * 3 + 2] = _c.b;
    }
  }

  /** Writes colour `index` (wrapped) into `out`, multiplied by `gain`. */
  get(index: number, out: Rgb, gain = 1): Rgb {
    const i = ((Math.floor(index) % this.size) + this.size) % this.size;
    out.r = this.rgb[i * 3]! * gain;
    out.g = this.rgb[i * 3 + 1]! * gain;
    out.b = this.rgb[i * 3 + 2]! * gain;
    return out;
  }

  /** Smoothly cycles through the palette: `t` = 0..size wraps around. */
  blend(t: number, out: Rgb, gain = 1): Rgb {
    const n = this.size;
    const f = ((t % n) + n) % n;
    const i0 = Math.floor(f);
    const i1 = (i0 + 1) % n;
    const k = f - i0;
    out.r = (this.rgb[i0 * 3]! * (1 - k) + this.rgb[i1 * 3]! * k) * gain;
    out.g = (this.rgb[i0 * 3 + 1]! * (1 - k) + this.rgb[i1 * 3 + 1]! * k) * gain;
    out.b = (this.rgb[i0 * 3 + 2]! * (1 - k) + this.rgb[i1 * 3 + 2]! * k) * gain;
    return out;
  }
}

/** Saturated rainbow colour for hue `h` (0..1, wraps). */
export function hueRgb(h: number, out: Rgb, gain = 1): Rgb {
  const f = h - Math.floor(h);
  out.r = hueChannel(f) * gain;
  out.g = hueChannel(f + 2 / 3) * gain;
  out.b = hueChannel(f + 1 / 3) * gain;
  return out;
}

function hueChannel(f: number): number {
  const x = Math.abs((f % 1) * 6 - 3) - 1;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function mixRgb(out: Rgb, a: Rgb, b: Rgb, k: number): Rgb {
  out.r = a.r + (b.r - a.r) * k;
  out.g = a.g + (b.g - a.g) * k;
  out.b = a.b + (b.b - a.b) * k;
  return out;
}

/** Every colour set the effects need for one theme, converted once on theme change. */
export class ThemePalettes {
  readonly motif: Motif;
  /** THEMES[id].particles.colors */
  readonly particles: Palette;
  /** Confetti: the UI colours plus the particle colours. */
  readonly confetti: Palette;
  /** Light show beams: primary, accent, accent2, glow. */
  readonly ui: Palette;
  /** Cabinet LED colours (LED chase). */
  readonly led: Palette;
  readonly primary: Rgb;
  readonly glow: Rgb;
  readonly accent: Rgb;
  /** Reticle / aim beam tint (primary, half way to white). */
  readonly tint: Rgb;
  /** Puffs: plush fluff in the theme's paper colour, slightly brightened. */
  readonly fluff: Rgb;
  readonly tiers: Readonly<Record<FxTier, Palette>>;

  constructor(theme: ThemeDef | null) {
    this.motif = motifOf(theme);
    const ui = theme?.ui;
    const colors = theme?.particles.colors ?? ['#ffffff', '#ffe9a8', '#b79cff'];
    this.particles = new Palette(colors);
    this.confetti = new Palette(ui ? [ui.primary, ui.accent, ui.accent2, ...colors] : colors);
    this.ui = new Palette(ui ? [ui.primary, ui.accent, ui.accent2, ui.glow] : colors);
    this.led = new Palette(theme?.cabinet.led ?? colors);
    const one = (hex: string | undefined, fallback: string): Rgb => {
      _c.set(hex ?? fallback);
      return { r: _c.r, g: _c.g, b: _c.b };
    };
    this.primary = one(ui?.primary, '#ffffff');
    this.glow = one(ui?.glow, '#ffffff');
    this.accent = one(ui?.accent, '#ffffff');
    _c.set(ui?.primary ?? '#ffffff').lerp(new Color(0xffffff), 0.5);
    this.tint = { r: _c.r, g: _c.g, b: _c.b };
    _c.set(ui?.paper ?? '#ffffff').lerp(new Color(0xffffff), 0.45);
    this.fluff = { r: _c.r, g: _c.g, b: _c.b };
    this.tiers = {
      common: new Palette(TIER_COLORS.common),
      rare: new Palette(TIER_COLORS.rare),
      epic: new Palette(TIER_COLORS.epic),
      legendary: new Palette(TIER_COLORS.legendary),
    };
  }
}

/** Parses CSS colour strings once and caches them (bursts may pass `opts.color`). */
export class ColorCache {
  private readonly cache = new Map<string, Rgb>();

  get(css: string): Rgb | null {
    let hit = this.cache.get(css);
    if (hit) return hit;
    if (this.cache.size > 64) this.cache.clear();
    // An unknown colour leaves the value untouched (three logs a warning), so start from NaN.
    _c.setRGB(Number.NaN, Number.NaN, Number.NaN);
    try {
      _c.set(css);
    } catch {
      return null;
    }
    if (!Number.isFinite(_c.r + _c.g + _c.b)) return null;
    hit = { r: _c.r, g: _c.g, b: _c.b };
    this.cache.set(css, hit);
    return hit;
  }
}
