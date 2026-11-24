import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, REDUCTION_STEPS, reductionLabelKey, visibleReductions } from '../../../src/app/AdaptiveQuality';
import { GRAPHICS_PRESETS } from '../../../src/app/presets';
import { BRAND_KITS } from '../../../src/brand/kits';
import { LANGS } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { graphicsStrings } from '../../../src/i18n/strings/graphics';
import { FIELD } from '../../../src/physics/fieldSpec';
import { ContactShadows, CONTACT_RANGE, contactDarkness } from '../../../src/scene/contactShadows';
import { buildStudioScene, captureSize, environmentSize, studioEnvironmentSize } from '../../../src/scene/environment';
import { detailLevel } from '../../../src/scene/materials';
import { CONTACT_SHADOWS, SHADOW_FILTER, SHADOW_SIZE } from '../../../src/scene/Stage';
import { defaultSettings, getFieldAt, sanitizeSettings, type GraphicsSettings } from '../../../src/settings/spec';
import { THEMES } from '../../../src/themes/themes';

registerAllStrings();

const TIERS = ['safe', 'medium', 'high', 'ultra'] as const;
const TEXTURE_ORDER = ['512', '1k', '2k', '4k'] as const;
const SHADOW_ORDER = ['off', 'low', 'medium', 'high'] as const;
const root = fileURLToPath(new URL('../../../', import.meta.url));

function graphics(preset: (typeof TIERS)[number]): GraphicsSettings {
  return { ...defaultSettings().graphics, ...GRAPHICS_PRESETS[preset], preset, autoOptimize: true };
}

describe('graphics tiers', () => {
  it('Safe is a genuine phone tier', () => {
    const s = GRAPHICS_PRESETS.safe;
    expect(s.maxDpr).toBeGreaterThanOrEqual(1);
    expect(s.maxDpr).toBeLessThanOrEqual(1.25);
    expect(s.maxPixels).toBeGreaterThanOrEqual(0.6);
    expect(s.maxPixels).toBeLessThanOrEqual(0.9);
    expect(['flat', 'sheen']).toContain(s.fur);
    expect(s.shadows).toBe('low');
    expect(s.textures).toBe('512');
    expect(s.fxIntensity).toBe(0.5);
    expect(CONTACT_SHADOWS[s.shadows].size).toBe(0);
    expect(s.ao).toBe('off');
    expect(s.reflections).toBe('static');
  });

  it('cost grows monotonically from Safe to Ultra', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const a = GRAPHICS_PRESETS[TIERS[i - 1]!], b = GRAPHICS_PRESETS[TIERS[i]!];
      expect(b.maxPixels).toBeGreaterThanOrEqual(a.maxPixels);
      expect(b.maxDpr).toBeGreaterThanOrEqual(a.maxDpr);
      expect(TEXTURE_ORDER.indexOf(b.textures)).toBeGreaterThan(TEXTURE_ORDER.indexOf(a.textures));
      expect(SHADOW_ORDER.indexOf(b.shadows)).toBeGreaterThanOrEqual(SHADOW_ORDER.indexOf(a.shadows));
      expect(environmentSize(b.textures)).toBeGreaterThanOrEqual(environmentSize(a.textures));
    }
    // Medium (780M target) keeps the 1080p-class budget and the cheap post chain.
    expect(GRAPHICS_PRESETS.medium).toMatchObject({ maxPixels: 2.1, textures: '1k', shadows: 'medium', ao: 'off', aa: 'fxaa', reflections: 'static' });
  });

  it('the pixel-ratio cap is a proper setting on the slider grid, carried by older stored presets', () => {
    const field = getFieldAt('graphics.maxDpr');
    expect(field?.kind).toBe('num');
    if (field?.kind !== 'num') return;
    for (const tier of TIERS) {
      const v = GRAPHICS_PRESETS[tier].maxDpr;
      expect(v).toBeGreaterThanOrEqual(field.min);
      expect(v).toBeLessThanOrEqual(field.max);
      expect(Math.abs((v - field.min) / field.step - Math.round((v - field.min) / field.step))).toBeLessThan(1e-9);
    }
    expect(defaultSettings().graphics.maxDpr).toBe(GRAPHICS_PRESETS.medium.maxDpr);
    // A configuration stored before the setting existed takes its preset's cap.
    const old = defaultSettings() as unknown as { graphics: Record<string, unknown> };
    old.graphics.preset = 'safe';
    delete old.graphics.maxDpr;
    expect(sanitizeSettings(old).graphics.maxDpr).toBe(1.25);
  });

  it('the optimiser never touches the pixel-ratio cap, textures or the tier detail', () => {
    const a = new AdaptiveQuality();
    for (const tier of TIERS) {
      const user = graphics(tier);
      for (let level = 0; level <= REDUCTION_STEPS.length; level++) {
        a.level = level;
        const g = a.apply(user).graphics;
        expect(g.maxDpr).toBe(user.maxDpr);
        expect(g.textures).toBe(user.textures);
        expect(g.lod).toBe(user.lod);
        expect(g.fur).toBe(user.fur);
      }
    }
  });

  it('shadows: larger maps and softer filtering per level, contact shadows from Medium up', () => {
    expect(SHADOW_SIZE.low).toBeLessThan(SHADOW_SIZE.medium);
    expect(SHADOW_SIZE.medium).toBeLessThan(SHADOW_SIZE.high);
    expect(SHADOW_FILTER.high.type).toBe('vsm');
    expect(SHADOW_FILTER.medium.type).toBe('pcf');
    expect(CONTACT_SHADOWS.off.size).toBe(0);
    expect(CONTACT_SHADOWS.low.size).toBe(0);
    expect(CONTACT_SHADOWS.medium.size).toBeGreaterThan(0);
    // Medium stays cheap: a smaller map, refreshed every other frame.
    expect(CONTACT_SHADOWS.medium.size).toBeLessThan(CONTACT_SHADOWS.high.size);
    expect(CONTACT_SHADOWS.medium.every).toBeGreaterThan(CONTACT_SHADOWS.high.every);
  });

  it('environment resolution: Safe lowest, Ultra highest; live captures stay small', () => {
    expect(environmentSize('512')).toBe(Math.min(...TEXTURE_ORDER.map(environmentSize)));
    expect(environmentSize('4k')).toBe(Math.max(...TEXTURE_ORDER.map(environmentSize)));
    expect(environmentSize('4k')).toBeGreaterThan(environmentSize('1k'));
    for (const tier of TEXTURE_ORDER) {
      expect(captureSize(tier, 'live')).toBeLessThanOrEqual(captureSize(tier, 'refresh'));
      expect(captureSize(tier, 'refresh')).toBeLessThanOrEqual(512);
    }
    expect(detailLevel('512')).toBe(0);
    expect(detailLevel('4k')).toBe(3);
  });

  it('the studio shares the capture size while captures are used (one shader variant), and the preset reflections never get coarser up the tiers', () => {
    for (const tier of TEXTURE_ORDER) {
      expect(studioEnvironmentSize(tier, 'static')).toBe(environmentSize(tier));
      for (const mode of ['refresh', 'live'] as const) expect(studioEnvironmentSize(tier, mode)).toBe(captureSize(tier, mode));
    }
    // What the presets really show: the studio when static, the capture otherwise.
    const shown = TIERS.map((t) => {
      const g = GRAPHICS_PRESETS[t];
      return g.reflections === 'static' ? environmentSize(g.textures) : captureSize(g.textures, g.reflections);
    });
    for (let i = 1; i < shown.length; i++) expect(shown[i]!, TIERS[i]).toBeGreaterThanOrEqual(shown[i - 1]!);
    expect(shown[shown.length - 1]).toBeGreaterThan(shown[0]!);
  });
});

describe('studio environment', () => {
  it('builds a lit room for every theme and disposes it', () => {
    for (const theme of Object.values(THEMES)) {
      const { scene, dispose } = buildStudioScene(theme);
      let meshes = 0;
      scene.traverse((o) => {
        if ((o as Mesh).isMesh) meshes++;
      });
      // Dome, two ceiling strips, two side boxes, rim, front fill, floor bounce, practicals.
      expect(meshes, theme.id).toBeGreaterThanOrEqual(9);
      dispose();
    }
  });
});

describe('contact shadows', () => {
  it('darken most at the floor and fade to nothing at the range', () => {
    expect(contactDarkness(0)).toBe(1);
    expect(contactDarkness(CONTACT_RANGE / 2)).toBeLessThan(contactDarkness(0.01));
    expect(contactDarkness(CONTACT_RANGE + 0.01)).toBe(0);
    expect(contactDarkness(-0.5)).toBe(0);
  });

  it('cover the play floor just above the mat and skip AO', () => {
    const c = new ContactShadows({ minX: -FIELD.halfWidth, maxX: FIELD.halfWidth, minZ: -FIELD.depth, maxZ: 0, floorY: 0 }, { minX: -0.5, maxX: -0.2, minZ: -0.3, maxZ: 0 }, 256);
    c.mesh.geometry.computeBoundingBox();
    const box = c.mesh.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(2 * FIELD.halfWidth, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(FIELD.depth, 6);
    expect(c.mesh.position.y).toBeGreaterThan(0);
    expect(c.mesh.position.y).toBeLessThan(0.005);
    expect(c.mesh.userData.skipAO).toBe(true);
    expect(c.mesh.castShadow).toBe(false);
    c.dispose();
  });
});

describe('optimiser labels', () => {
  it('every reduction step has a readable label in every language', () => {
    for (const lang of LANGS) {
      for (const step of REDUCTION_STEPS) {
        const key = reductionLabelKey(step);
        expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        const text = translate(lang, key);
        // A label, not the internal id ("scale90") or the bare key.
        expect(text).not.toBe(step);
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/scale\d+/);
        expect(text.trim().length).toBeGreaterThan(0);
      }
      expect(hasString(lang, 'graphics.listSep')).toBe(true);
      expect(hasString(lang, 'set.graphics.maxDpr')).toBe(true);
      expect(hasString(lang, 'set.graphics.maxDpr.hint')).toBe(true);
    }
  });

  it('lists only the current resolution step', () => {
    expect(visibleReductions(['particles', 'bloom', 'scale90', 'scale80', 'scale70', 'shadows'])).toEqual(['particles', 'bloom', 'scale70', 'shadows']);
    expect(visibleReductions(['particles'])).toEqual(['particles']);
    expect(visibleReductions([])).toEqual([]);
    const a = new AdaptiveQuality();
    a.level = REDUCTION_STEPS.length;
    const shown = visibleReductions(a.apply(graphics('ultra')).reductions);
    expect(shown.filter((s) => s.startsWith('scale'))).toEqual(['scale50']);
  });

  it('the namespace has the same keys in every language', () => {
    const keys = Object.keys(graphicsStrings.en).sort();
    for (const lang of LANGS) expect(Object.keys(graphicsStrings[lang]).sort(), lang).toEqual(keys);
  });
});

describe('GPU Party look', () => {
  it('uses the circuit wallpaper / decor kit', () => {
    expect(THEMES.gpu.cabinet.pattern).toBe('circuit');
  });

  it('takes its back-wall logo from the brand kit; the neutral kit ships an original emblem', () => {
    // The GTC kit's original placeholder sits where the official file goes (see its README).
    expect(existsSync(`${root}public/${BRAND_KITS.gtc.logo.placeholder}`)).toBe(true);
    const rel = BRAND_KITS.neutral.logo.placeholder!;
    const file = `${root}public/${rel}`;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(64 * 1024);
    const svg = readFileSync(file, 'utf8');
    expect(svg).toMatch(/<svg[\s>]/);
    expect(svg).toMatch(/viewBox="0 0 512 512"/);
    // No real-world vendor names or marks in the artwork.
    expect(svg).not.toMatch(/\b(nvidia|geforce|rtx|radeon|amd|intel|quadro|tesla)\b/i);
    // Self-contained: no external references.
    expect(svg).not.toMatch(/(href|src)\s*=\s*["']https?:/i);
  });
});
