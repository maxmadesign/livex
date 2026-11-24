import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { BRAND_KITS, NVIDIA_PALETTE } from '../../../src/brand/kits';
import { brandForTheme } from '../../../src/brand';
import { CLAW, FIELD } from '../../../src/physics/fieldSpec';
import {
  inverseNeutral,
  LED_BEZEL,
  LED_WALL,
  LOGO_AREA,
  logoKeepOut,
  neutralToneMap,
  placeHostLogo,
  placeLogo,
  sceneInk,
  sceneKit,
  sceneParts,
} from '../../../src/scene/brandScene';
import { JACKPOT_STROBE_HZ, SHAPE } from '../../../src/scene/fx/constants';
import { ThemePalettes, type Palette, type Rgb } from '../../../src/scene/fx/palette';
import { BrandWall } from '../../../src/scene/ledWall';
import { THEMES } from '../../../src/themes/themes';
import { internals, makeFx, run } from '../fx/helpers';

/**
 * A colour belongs to the brand when, in linear RGB, it is a pure grey (white and black included)
 * or brand green plus some white: take away the grey part (the smallest channel) and what is left
 * has no blue and the red / green ratio of the brand greens (#76B900 0.37, greenDeep 0.37,
 * greenLight 0.46). Gains, white mixes and saturation boosts keep that ratio; any other hue
 * (cyan, lime, yellow-green, gold, blue, purple, the rainbow) breaks it.
 */
function brandLinear(r: number, g: number, b: number): boolean {
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b, 1e-6);
  const cr = r - lo, cg = g - lo, cb = b - lo;
  if (Math.max(cr, cg, cb) <= 0.004 * Math.max(1, hi)) return true;
  if (cb > 0.004 * Math.max(1, hi) || cg <= 0) return false;
  const ratio = cr / cg;
  return ratio >= 0.33 && ratio <= 0.5;
}

function brandHex(hex: string): boolean {
  const c = new Color(hex);
  return brandLinear(c.r, c.g, c.b);
}

const PALETTE_HEX = new Set(Object.values(NVIDIA_PALETTE).map((h) => h.toLowerCase()));

/** Every colour string anywhere in a nested object. */
function colours(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.startsWith('#')) out.push(value);
  else if (Array.isArray(value)) for (const v of value) colours(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) colours(v, out);
  return out;
}

function paletteRgb(p: Palette): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < p.size; i++) out.push(p.get(i, { r: 0, g: 0, b: 0 }));
  return out;
}

describe('the brand test itself', () => {
  it('accepts the brand palette, greys and green / white mixes and refuses other hues', () => {
    for (const hex of Object.values(NVIDIA_PALETTE)) expect(brandHex(hex), hex).toBe(true);
    // Cyan, yellow-green, gold, blue, purple, fire, the blue-grey fizzle and the old cool sky light.
    for (const hex of ['#4fd1ff', '#e4ff9e', '#ffc21a', '#3d9bff', '#a24dff', '#ff6a19', '#c4cee7', '#d4e2f6', '#ffe9a8']) expect(brandHex(hex), hex).toBe(false);
    // The old limes share the green's hue (they read as brighter green light), so static theme data
    // is held to exact palette values instead (next block).
    for (const hex of ['#9be33a', '#b6ff5c', '#e8ffd0', '#8fd61a', '#7fd400']) expect(PALETTE_HEX.has(hex), hex).toBe(false);
    const g = new Color(NVIDIA_PALETTE.green);
    for (const k of [0.2, 0.5, 0.8]) {
      const mix = g.clone().lerp(new Color(1, 1, 1), k).multiplyScalar(1.7);
      expect(brandLinear(mix.r, mix.g, mix.b)).toBe(true);
    }
  });
});

describe('GPU theme colours (brand kit)', () => {
  const gpu = THEMES.gpu;

  it('cabinet, lights, backdrop and particles use only brand palette values', () => {
    for (const group of [gpu.cabinet, gpu.lights, gpu.backdrop, gpu.particles]) {
      for (const hex of colours(group)) expect(PALETTE_HEX.has(hex.toLowerCase()), hex).toBe(true);
    }
    // The light that is emitted may be greenLight; nothing else outside green / black / white / greys.
    expect(colours(gpu.cabinet.led).every((h) => brandHex(h))).toBe(true);
  });

  it('printed and part colours of the scene come from the kit, not from the UI block', () => {
    const kit = sceneKit(gpu);
    expect(kit).toBe(brandForTheme('gpu'));
    for (const hex of [...colours(sceneInk(gpu)), ...colours(sceneParts(gpu))]) expect(PALETTE_HEX.has(hex.toLowerCase()), hex).toBe(true);
    // Themes without a kit keep their own UI colours.
    expect(sceneKit(THEMES.sakura)).toBeNull();
    expect(sceneInk(THEMES.sakura).primary).toBe(THEMES.sakura.ui.primary);
  });

  it('the effects palette of the gpu theme is green / white / grey: no rainbow, gold, fire or blue', () => {
    const pal = new ThemePalettes(gpu);
    expect(pal.rainbow).toBe(false);
    const all: Rgb[] = [
      ...[pal.particles, pal.confetti, pal.ui, pal.led, pal.spectrum, ...Object.values(pal.tiers)].flatMap(paletteRgb),
      pal.primary, pal.glow, pal.accent, pal.tint, pal.fluff, pal.coin, pal.flameA, pal.flameB, pal.fizzle, pal.dust,
    ];
    for (const c of all) expect(brandLinear(c.r, c.g, c.b), JSON.stringify(c)).toBe(true);
    const out = { r: 0, g: 0, b: 0 };
    for (let h = 0; h < 1; h += 0.05) {
      pal.hue(h, out);
      expect(brandLinear(out.r, out.g, out.b), `hue ${h}`).toBe(true);
    }
    // Other themes keep their rainbow and gold.
    const sakura = new ThemePalettes(THEMES.sakura);
    expect(sakura.rainbow).toBe(true);
    expect(sakura.coin.b).toBeLessThan(sakura.coin.g * 0.2);
  });

  it('a legendary jackpot draws only brand colours, still strobing at JACKPOT_STROBE_HZ', () => {
    const fx = makeFx({ theme: 'gpu', budget: 150, intensity: 1.2 });
    fx.lightShow('attract');
    fx.celebrate('legendary', { x: -0.35, y: 0, z: -0.15 });
    fx.lightShow('jackpot');
    fx.aura({ x: 0.1, y: 0.5, z: -0.35 }, 'legendary');
    let checked = 0;
    run(fx, 3, () => {
      fx.aura({ x: 0.1, y: 0.5, z: -0.35 }, 'legendary');
      for (const batch of [internals(fx).addBatch, internals(fx).normBatch]) {
        const [, , color, meta] = batch.buffers();
        for (let i = 0; i < batch.n; i++) {
          const r = color![i * 4]!, g = color![i * 4 + 1]!, b = color![i * 4 + 2]!;
          expect(brandLinear(r, g, b), `instance ${i}: ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`).toBe(true);
          // The rainbow ring shape picks its hues in the shader: never used here.
          expect(Math.round(meta![i * 3]!) % 32).not.toBe(SHAPE.RAINBOW_RING);
          checked++;
        }
      }
    });
    expect(checked).toBeGreaterThan(500);
    expect(JACKPOT_STROBE_HZ).toBe(2);
  });

  it('light effects keep away from the logo (keep-out on the additive batch only)', () => {
    const fx = makeFx({ theme: 'gpu' });
    const add = internals(fx).addBatch.material.uniforms;
    const paper = internals(fx).normBatch.material.uniforms;
    expect(add.uKeepOutOn!.value).toBe(1);
    expect(paper.uKeepOutOn!.value).toBe(0);
    const kit = brandForTheme('gpu')!;
    const rects = logoKeepOut(THEMES.gpu);
    expect(rects).toHaveLength(kit.hostLogo ? 2 : 1);
    const pads = [placeLogo(kit.logo.aspect, kit.logo.clearSpace), ...(kit.hostLogo ? [placeHostLogo(kit.hostLogo)] : [])];
    pads.forEach((pad, i) => {
      const k = rects[i]!;
      expect(k.xMin).toBeLessThanOrEqual(pad.cx - pad.padW / 2);
      expect(k.xMax).toBeGreaterThanOrEqual(pad.cx + pad.padW / 2);
      expect(k.yMin).toBeLessThanOrEqual(pad.cy - pad.padH / 2);
      expect(k.yMax).toBeGreaterThanOrEqual(pad.cy + pad.padH / 2);
    });
    expect(logoKeepOut(THEMES.sakura)).toEqual([]);
    expect(internals(makeFx({ theme: 'sakura' })).addBatch.material.uniforms.uKeepOutOn!.value).toBe(0);
  });
});

describe('logo placement on the LED wall', () => {
  it('keeps the artwork aspect and the kit clear space, inside the LED wall', () => {
    for (const kit of Object.values(BRAND_KITS)) {
      for (const aspect of [kit.logo.aspect, 1, 3.5, 0.6]) {
        const p = placeLogo(aspect, kit.logo.clearSpace);
        expect(p.w / p.h).toBeCloseTo(aspect, 9);
        expect(p.padW - p.w).toBeCloseTo(2 * kit.logo.clearSpace * p.h, 9);
        expect(p.padH - p.h).toBeCloseTo(2 * kit.logo.clearSpace * p.h, 9);
        expect(p.padW).toBeLessThanOrEqual(LOGO_AREA.maxW + 1e-9);
        expect(p.padH).toBeLessThanOrEqual(LOGO_AREA.maxH + 1e-9);
        expect(p.cx - p.padW / 2).toBeGreaterThan(LED_WALL.xMin);
        expect(p.cx + p.padW / 2).toBeLessThan(LED_WALL.xMax);
        expect(p.cy - p.padH / 2).toBeGreaterThan(LED_WALL.yMin);
      }
    }
  });

  it('is centred, large, and below the parked claw for the default eyes', () => {
    const p = placeLogo(BRAND_KITS.gtc.logo.aspect, BRAND_KITS.gtc.logo.clearSpace);
    expect(p.cx).toBe(0);
    expect(p.w).toBeGreaterThan(0.3);
    // Default eyes (world) of desktop, 9:16 portrait 32" / 86" and a phone sideways, measured in the game.
    const eyes = [
      [0, 0.915, 2.698],
      [0, 0.721, 1.651],
      [0, 0.457, 0.94],
      [0, 0.26, 7.43],
    ];
    // The open fingertips of the parked claw: 0.17 m under its hub, which hangs 0.1 m under the anchor.
    const tip = { x: CLAW.homeX, y: CLAW.anchorY - CLAW.ropeMin - 0.17, z: CLAW.homeZ };
    for (const [ex, ey, ez] of eyes) {
      const t = (-FIELD.depth - ez!) / (tip.z - ez!);
      const onWall = ey! + (tip.y - ey!) * t;
      expect(onWall, `eye ${ey} ${ez}`).toBeGreaterThan(p.cy + p.h / 2);
      void ex;
    }
  });

  it('puts the host mark in the upper-left corner, clear of the bezel, the event logo and the claw', () => {
    const slot = BRAND_KITS.gtc.hostLogo!;
    const h = placeHostLogo(slot);
    const p = placeLogo(BRAND_KITS.gtc.logo.aspect, BRAND_KITS.gtc.logo.clearSpace);
    expect(h.w / h.h).toBeCloseTo(slot.aspect, 9);
    expect(h.cx - h.padW / 2).toBeGreaterThanOrEqual(LED_WALL.xMin);
    expect(h.cy + h.padH / 2).toBeLessThanOrEqual(LED_WALL.yMax);
    expect(h.cy - h.padH / 2).toBeGreaterThan(p.cy + p.padH / 2);
    expect(h.w).toBeLessThan(p.w);
    // The parked claw lands on the wall right of x ≈ -0.02.
    expect(h.cx + h.padW / 2).toBeLessThan(-0.05);
    expect(LED_WALL.xMax + LED_BEZEL).toBeLessThan(FIELD.halfWidth - 0.02);
  });
});

describe('logo colours through the output pass', () => {
  it('the inverse Neutral transform round-trips brand colours', () => {
    for (const hex of [NVIDIA_PALETTE.green, NVIDIA_PALETTE.gray400, NVIDIA_PALETTE.greenLight, '#202020']) {
      const c = new Color(hex);
      const back = neutralToneMap(inverseNeutral([c.r, c.g, c.b]));
      expect(back[0]).toBeCloseTo(c.r, 5);
      expect(back[1]).toBeCloseTo(c.g, 5);
      expect(back[2]).toBeCloseTo(c.b, 5);
    }
    // Brand green passes Neutral unchanged: the shader needs no help there at exposure 1.
    const g = new Color(NVIDIA_PALETTE.green);
    expect(neutralToneMap([g.r, g.g, g.b])).toEqual([g.r, g.g, g.b]);
    // White can only be approached (the operator never reaches 1): 0.999 needs a large input.
    const w = inverseNeutral([1, 1, 1]);
    expect(neutralToneMap(w)[0]).toBeGreaterThan(0.995);
  });

  it('logo materials are unlit, not tone mapped and compensate the output transform', () => {
    const wall = new BrandWall(BRAND_KITS.gtc, 256);
    try {
      expect(wall.logo.toneMapped).toBe(false);
      expect(wall.logo.lights).toBe(false);
      expect(wall.logo.fragmentShader).toContain('inverseNeutral');
      expect(wall.logo.uniforms.uMaxLum!.value).toBeLessThan(1.5);
      expect(wall.hostLogo).not.toBeNull();
      expect(wall.hostLogo!.toneMapped).toBe(false);
      // Nothing is drawn before a file has loaded, and the host mark never without an official file.
      expect(wall.logoStatus().logo.loaded).toBe(false);
      expect(wall.hostPlacement()).toBeNull();
    } finally {
      wall.dispose();
    }
    const neutral = new BrandWall(BRAND_KITS.neutral, 256);
    expect(neutral.hostLogo).toBeNull();
    neutral.dispose();
  });
});

describe('LED wall animation', () => {
  const at = (wall: BrandWall, name: string) => wall.ledWall.uniforms[name]!.value as number;

  it('livens up with energy, pulses on wins and follows the effects settings', () => {
    const wall = new BrandWall(BRAND_KITS.gtc, 256);
    for (let i = 0; i <= 60; i++) wall.update(i / 30, 0, false);
    expect(at(wall, 'uBurst')).toBeLessThan(0.01);
    const idlePhase = at(wall, 'uPhase');
    expect(idlePhase).toBeGreaterThan(1.5);
    for (let i = 61; i <= 120; i++) wall.update(i / 30, 2.4, false);
    expect(at(wall, 'uBurst')).toBeGreaterThan(1);
    expect(at(wall, 'uRing')).toBeGreaterThan(0.5);
    expect(at(wall, 'uRingAmp')).toBe(1);
    // Light show off: a win only brightens the wall a little.
    wall.setFx(1, false);
    for (let i = 121; i <= 180; i++) wall.update(i / 30, 2.4, false);
    expect(at(wall, 'uBurst')).toBeLessThan(0.4);
    // Effects intensity scales the light; 0 leaves a dark panel.
    wall.setFx(0, true);
    wall.update(181 / 30, 0, false);
    expect(at(wall, 'uLevel')).toBe(0);
    wall.dispose();
  });

  it('stands still with reduced motion', () => {
    const wall = new BrandWall(BRAND_KITS.gtc, 256);
    wall.update(0, 0, true);
    const phase = at(wall, 'uPhase');
    const scan = at(wall, 'uScan');
    for (let i = 1; i <= 90; i++) wall.update(i / 30, 2.4, true);
    expect(at(wall, 'uPhase')).toBe(phase);
    expect(at(wall, 'uScan')).toBe(scan);
    expect(at(wall, 'uRing')).toBe(0);
    expect(at(wall, 'uRingAmp')).toBe(0);
    expect(at(wall, 'uBurst')).toBeLessThanOrEqual(0.25);
    wall.dispose();
  });

  it('never draws over a logo: the shader blacks out both pads', () => {
    const wall = new BrandWall(BRAND_KITS.gtc, 256);
    expect(wall.ledWall.fragmentShader).toMatch(/min\(\s*dPad,\s*dHost\s*\)/);
    const pad = wall.ledWall.uniforms.uPad!.value as { x: number; y: number; z: number; w: number };
    const p = wall.logoPlacement();
    expect(pad.x).toBeCloseTo(p.cx - LED_WALL.xMin, 9);
    expect(pad.y).toBeCloseTo(p.cy - LED_WALL.yMin, 9);
    expect(pad.z).toBeCloseTo(p.padW / 2, 9);
    expect(pad.w).toBeCloseTo(p.padH / 2, 9);
    wall.dispose();
  });
});
