import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVE_BRAND, BRAND_KITS, NVIDIA_PALETTE, type BrandKit } from '../../../src/brand';
import { LANGS, type DisplayProfileId } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { GPU_KIT_STRINGS, gpuStrings } from '../../../src/i18n/strings/gpu';
import { uiEn } from '../../../src/i18n/strings/ui.en';
import { uiJa } from '../../../src/i18n/strings/ui.ja';
import { uiZh } from '../../../src/i18n/strings/ui.zh';
import { NO_INSETS, solveLayout } from '../../../src/layout/solve';
import { profileDefaults } from '../../../src/settings/spec';
import { THEMES } from '../../../src/themes/themes';
import { attractBrandGeometry, attractSubKey, ctaGeometry, rewardsShown } from '../../../src/ui/AttractOverlay';
import { scoreHudRect } from '../../../src/ui/ScoreHud';

registerAllStrings();

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const P = NVIDIA_PALETTE;
const PALETTE = new Set(Object.values(P).map((c) => c.toLowerCase()));

describe('GPU theme UI in the brand palette', () => {
  it('takes every UI colour from the kit palette', () => {
    for (const [key, value] of Object.entries(THEMES.gpu.ui)) expect(PALETTE.has(value.toLowerCase()), `ui.${key} ${value}`).toBe(true);
    expect(THEMES.gpu.ui.primary).toBe(P.green);
    expect(THEMES.gpu.ui.paper).toBe(P.black);
    expect(THEMES.gpu.ui.ink).toBe(P.white);
  });

  it('keeps every text / surface pair of the theme sheet readable', () => {
    // [text, surface, minimum]: lettering on the green buttons 7:1; body text 4.5:1.
    const pairs: [string, string, number, string][] = [
      [P.black, P.green, 7, 'black lettering on green buttons, tabs and badges'],
      [P.white, P.black, 4.5, 'white text on black (soft buttons, bubble, status, toasts)'],
      [P.white, P.gray900, 4.5, 'white text on the dialog body'],
      [P.white, P.gray800, 4.5, 'white text on cards, notes and segments'],
      [P.white, P.gray700, 4.5, 'white text on the "later" badge'],
      [P.green, P.black, 4.5, 'green labels on black (score label, DEMO badge)'],
      [P.green, P.gray900, 4.5, 'green section headings on the dialog body'],
      [P.green, P.gray800, 4.5, 'green title of the selected theme card'],
      [P.gray300, P.gray900, 4.5, 'grey hints on the dialog body'],
      [P.gray300, P.black, 4.5, 'grey secondary text on black'],
      [P.gray200, P.gray800, 4.5, 'card taglines'],
      [P.black, P.white, 4.5, 'black on white (legendary tier)'],
    ];
    for (const [fg, bg, min, what] of pairs) expect(contrast(fg, bg), what).toBeGreaterThanOrEqual(min);
  });

  it('uses only palette colours in its stylesheet: no lime, cyan or other hues', () => {
    const css = read('src/ui/theme-gpu.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => {
      const h = m[0].toLowerCase();
      return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h.slice(0, 7);
    });
    expect(hexes.length).toBeGreaterThan(10);
    for (const hex of hexes) expect(PALETTE.has(hex), hex).toBe(true);
    const rgbs = [...css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map((m) => `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`);
    for (const hex of rgbs) expect(PALETTE.has(hex), hex).toBe(true);
    expect(css).not.toMatch(/\b(lime|cyan|aqua|yellow|orange|pink|purple|magenta|red|blue)\b/i);
  });

  it('never filters, animates or tints a logo; light effects stay behind it', () => {
    const css = read('src/ui/theme-gpu.css');
    const rule = css.match(/\.pp-brand-logo img \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('object-fit: contain');
    expect(rule).toContain('animation: none !important');
    expect(rule).toContain('filter: none !important');
    // No other rule targets the logo image.
    expect(css.match(/\.pp-brand-logo img/g)?.length).toBe(1);
    // The attract brand block is rendered after the call to action (its rings and glow paint below it).
    const tsx = read('src/ui/AttractOverlay.tsx');
    expect(tsx.indexOf('pp-attract-brand')).toBeGreaterThan(tsx.indexOf('className="pp-cta-ring"'));
  });
});

describe('brand kit strings', () => {
  const tables = { en: uiEn, zh: uiZh, ja: uiJa } as const;

  it('names the GPU theme after the kit in the theme picker, in every language', () => {
    for (const lang of LANGS) expect(translate(lang, 'theme.gpu.name')).toBe(ACTIVE_BRAND.themeName[lang]);
  });

  it('has every brand.* string in every language, with the same placeholders', () => {
    const keys = Object.keys(uiEn).filter((k) => k.startsWith('brand.'));
    expect(keys.length).toBeGreaterThan(15);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const lang of LANGS) {
      for (const key of keys) {
        expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        expect(holes(tables[lang][key]!), `${lang}:${key}`).toBe(holes(uiEn[key]!));
      }
    }
  });

  it('builds the attract headline from the kit event name', () => {
    for (const lang of LANGS) {
      expect(tables[lang]['brand.attract.welcome']).toContain('{event}');
      expect(translate(lang, 'brand.attract.welcome', { event: ACTIVE_BRAND.eventName })).toContain(ACTIVE_BRAND.eventName);
    }
  });

  it('keeps the "original characters" note for the neutral kit only, with the same keys per kit', () => {
    expect(GPU_KIT_STRINGS.neutral.en['gpu.originals']).toBeTruthy();
    expect(GPU_KIT_STRINGS.gtc.en['gpu.originals']).toBeUndefined();
    for (const kit of ['gtc', 'neutral'] as const) {
      const keys = Object.keys(GPU_KIT_STRINGS[kit].en).sort();
      for (const lang of LANGS) expect(Object.keys(GPU_KIT_STRINGS[kit][lang]).sort(), `${kit}.${lang}`).toEqual(keys);
    }
    // The neutral kit keeps the GPU Party copy and names no real event.
    for (const lang of LANGS) expect(JSON.stringify(GPU_KIT_STRINGS.neutral[lang])).not.toMatch(/GTC|NVIDIA/);
    expect(gpuStrings.en['gpu.tagline']).toBe(GPU_KIT_STRINGS[ACTIVE_BRAND.id].en['gpu.tagline']);
  });

  it('describes the theme in the palette colours (no lime)', () => {
    for (const kit of ['gtc', 'neutral'] as const) {
      for (const lang of LANGS) expect(JSON.stringify(GPU_KIT_STRINGS[kit][lang]), `${kit}.${lang}`).not.toMatch(/lime|青柠|ライム/i);
    }
  });
});

describe('components take names and logos from the kit', () => {
  function files(dir: string): string[] {
    return readdirSync(path.join(root, dir)).flatMap((name) => {
      const rel = path.join(dir, name);
      return statSync(path.join(root, rel)).isDirectory() ? files(rel) : /\.(tsx?|css)$/.test(name) ? [rel] : [];
    });
  }

  it('never hard-codes the event or host name in UI code or styles', () => {
    for (const file of [...files('src/ui'), 'src/brand/fonts.ts', 'index.html']) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(source, file).not.toMatch(/\bGTC\b|NVIDIA/);
    }
  });
});

describe('attract call to action with the event logo', () => {
  const kit: BrandKit = BRAND_KITS.gtc;

  it('invites the visitor to scan the claim QR only where a win shows one', () => {
    expect(rewardsShown('off', 'gpu')).toBe(false);
    expect(rewardsShown('all', 'sakura')).toBe(true);
    expect(rewardsShown('gtc', 'sakura')).toBe(false);
    expect(rewardsShown('gtc', 'gpu')).toBe(ACTIVE_BRAND.id === 'gtc');
    expect(attractSubKey(null, null)).toBe('attract.sub');
    expect(attractSubKey(kit, null)).toBe('brand.attract.sub');
    for (const options of ['both', 'prize', 'swag'] as const) {
      const key = attractSubKey(kit, { mode: 'gtc', options, claimUrl: '', swagUrl: '', discountText: '', qrSeconds: 60 });
      expect(key).toBe(`brand.attract.reward.${options}`);
      for (const lang of LANGS) expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
    }
  });

  const VIEWPORTS: [DisplayProfileId, number, number][] = [
    ['desktop', 1280, 720],
    ['desktop', 1920, 1080],
    ['portrait32', 1080, 1920],
    ['portrait86', 1080, 1920],
    ['portrait86', 405, 720],
    ['mobile', 844, 390],
    ['mobile', 390, 844],
  ];

  it('fits the logo and headline between the top bar and the call to action, which keeps its place', () => {
    for (const [profile, vw, vh] of VIEWPORTS) {
      const layout = solveLayout(profile, profileDefaults(profile).layout, vw, vh, NO_INSETS);
      const label = `${profile} ${vw}x${vh}`;
      for (const scoring of [false, true]) {
        for (const badge of [false, true]) {
          const score = scoring ? scoreHudRect(layout) : null;
          const cta = ctaGeometry(layout, score);
          // The call to action may grow with a two-line sub-line: test the taller case too.
          for (const grow of [1, 1.3]) {
            const ctaTop = cta.cy - (cta.h * grow) / 2;
            const welcome = 'Welcome to the GPU Party!';
            const brand = attractBrandGeometry(layout, ctaTop, kit, { score, badge, headlineChars: welcome.length, wide: false });
            if (!brand) continue;
            const k = kit.logo.clearSpace;
            const height = (brand.logo > 0 ? brand.logo * (1 + 2 * k) + Math.max(6, 10 * layout.unit) : 0) + brand.headline * 1.2;
            const top = ctaTop - brand.gap - height;
            expect(top, `${label} score=${scoring} badge=${badge} grow=${grow}`).toBeGreaterThanOrEqual(layout.topBar.y + layout.topBar.h - 0.5);
            if (score && score.place !== 'side' && score.place !== 'abovePanel') expect(top, `${label} below the score`).toBeGreaterThanOrEqual(score.y + score.h - 0.5);
            expect(brand.logo * (kit.logo.aspect + 2 * k), label).toBeLessThanOrEqual(vw);
            expect(brand.headline * welcome.length * 0.6, label).toBeLessThanOrEqual(vw);
          }
        }
      }
    }
  });

  it('shows the logo where there is room: desktop and the portrait kiosks', () => {
    for (const [profile, vw, vh] of VIEWPORTS.filter(([p]) => p !== 'mobile')) {
      const layout = solveLayout(profile, profileDefaults(profile).layout, vw, vh, NO_INSETS);
      const cta = ctaGeometry(layout, null);
      const brand = attractBrandGeometry(layout, cta.cy - cta.h / 2, kit, { score: null, badge: false, headlineChars: 14, wide: false });
      expect(brand?.logo ?? 0, `${profile} ${vw}x${vh}`).toBeGreaterThan(0);
    }
  });
});
