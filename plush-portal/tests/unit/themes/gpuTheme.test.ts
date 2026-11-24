import { describe, expect, it } from 'vitest';
import { LANGS } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { gpuStrings } from '../../../src/i18n/strings/gpu';
import { THEMES } from '../../../src/themes/themes';

registerAllStrings();

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Every colour string anywhere in a nested object. */
function colours(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.startsWith('#')) out.push(value);
  else if (Array.isArray(value)) for (const v of value) colours(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) colours(v, out);
  return out;
}

describe('GPU Party theme definition', () => {
  const gpu = THEMES.gpu;

  it('is complete and uses only valid colours', () => {
    expect(gpu.id).toBe('gpu');
    for (const key of Object.keys(THEMES.cosmic) as (keyof typeof gpu)[]) expect(gpu[key], key).toBeDefined();
    for (const group of ['ui', 'cabinet', 'lights'] as const) {
      for (const key of Object.keys(THEMES.cosmic[group])) expect((gpu[group] as Record<string, unknown>)[key], `${group}.${key}`).toBeDefined();
    }
    for (const c of colours(gpu)) expect(c, c).toMatch(HEX);
    expect(gpu.cabinet.led.length).toBeGreaterThanOrEqual(3);
    expect(gpu.particles.colors.length).toBeGreaterThanOrEqual(3);
    expect(gpu.lights.env).toHaveLength(3);
  });

  it('keeps UI text readable on its dark surfaces (WCAG AA, 4.5:1 for body text)', () => {
    const { ui } = gpu;
    expect(luminance(ui.paper)).toBeLessThan(0.02);
    expect(luminance(ui.panel)).toBeLessThan(0.03);
    for (const fg of [ui.ink, ui.primary, ui.accent, ui.accent2, ui.glow]) {
      expect(contrast(fg, ui.paper), `${fg} on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, ui.panel), `${fg} on panel`).toBeGreaterThanOrEqual(4.5);
    }
    // The deep primary is only used for large display text and glyphs: 3:1 (WCAG AA large).
    expect(contrast(ui.primaryDeep, ui.paper)).toBeGreaterThanOrEqual(3);
  });

  it('looks like a black lacquer cabinet with lime accents, a cool key light and a green rim', () => {
    const { cabinet, lights, particles } = gpu;
    expect(luminance(cabinet.frame)).toBeLessThan(0.01);
    expect(luminance(cabinet.fascia)).toBeLessThan(0.01);
    expect(cabinet.frameAccent).toBe('#76b900');
    for (const led of cabinet.led) {
      const [r, g, b] = rgb(led);
      expect(g, led).toBeGreaterThanOrEqual(r);
      expect(g, led).toBeGreaterThanOrEqual(b);
    }
    const [kr, , kb] = rgb(lights.key);
    expect(kb).toBeGreaterThanOrEqual(kr);
    const [rr, rg, rb] = rgb(lights.rim);
    expect(rg).toBeGreaterThan(rr);
    expect(rg).toBeGreaterThan(rb);
    expect(lights.caustics).toBe(false);
    // Flipping square "data bits" in greens and white.
    expect(particles.kind).toBe('confetti');
    for (const c of particles.colors) {
      const [r, g, b] = rgb(c);
      expect(g, c).toBeGreaterThanOrEqual(Math.max(r, b));
    }
  });

  it('has its own strings in every language', () => {
    const keys = Object.keys(gpuStrings.en).sort();
    for (const key of ['gpu.tagline', 'gpu.description', 'gpu.track', 'gpu.originals', 'gpu.char.chief', 'gpu.char.pixel']) expect(keys).toContain(key);
    for (const lang of LANGS) {
      expect(Object.keys(gpuStrings[lang]).sort(), lang).toEqual(keys);
      for (const key of keys) {
        expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        expect(translate(lang, key).trim().length, `${lang}:${key}`).toBeGreaterThan(0);
      }
    }
    expect(translate('zh', 'gpu.char.chief')).toBe('主讲人');
    expect(translate('ja', 'gpu.char.card')).toBe('ツインファン');
  });
});
