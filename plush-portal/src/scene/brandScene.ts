/**
 * How a brand kit (src/brand) dresses the 3D scene of its theme: the colours the cabinet prints
 * and emits, and where the event logo sits on the play field's own back wall (the LED wall).
 *
 * Pure data and arithmetic (no DOM, no WebGL), shared by the cabinet, its materials and the
 * effects, which keep light away from the logo. Themes without a kit fall back to their UI colours
 * exactly as before.
 */
import { brandForTheme, type BrandKit, type LogoSlot } from '../brand';
import { FIELD } from '../physics/fieldSpec';
import type { ThemeDef } from '../themes/themes';

/** Colours the scene prints on stickers, badges and wallpaper, or emits from small lights. */
export interface SceneInk {
  primary: string;
  /** Text on light / accent surfaces (the WIN sticker label, the badge's first word). */
  primaryDeep: string;
  accent: string;
  accent2: string;
  /** Emitted light: glowing wallpaper traces, idle light beams, reticle. */
  glow: string;
  /** Small print on the price card. */
  ink: string;
  /** The price card's background on dark cabinets, and its title there. */
  paper: string;
  cardTitle: string;
  /** Highlight of the badge's glossy gradient. */
  badgeHighlight: string;
  /** Text printed on `primary` (the chute sign). */
  onPrimary: string;
  /** Hazard sticker colour and its text / stripes. */
  caution: string;
  cautionInk: string;
}

/** Material colours of small cabinet parts that are not theme data. */
export interface SceneParts {
  /** Dark plastic and slots (gantry slots, chute collar, speaker grille, stand-offs). */
  dark: string;
  /** Soft-touch rubber (claw wheels). */
  rubber: string;
  /** Chip packages of the circuit decor. */
  chip: string;
  /** Ceiling light diffuser (an emitter). */
  diffuser: string;
  /** Edge tint of the side glass. */
  glassEdge: string;
  /** Coloured anodised aluminium (gantry carriages, claw knuckles, fan frames); null = from the theme accent. */
  anodised: string | null;
  /** Chip pins and bezels of the circuit wallpaper. */
  pins: string;
  /** Silkscreen marks of the circuit wallpaper. */
  silkscreen: string;
  /** Server racks of the backdrop. */
  rack: string;
  /** How far the prize bin's cushion is lightened from the velvet colour towards white, and its sheen. */
  cushionLift: number;
  cushionSheen: number;
}

/** The brand kit that dresses `theme` (src/brand: brandForTheme), or null. */
export function sceneKit(theme: ThemeDef | null): BrandKit | null {
  return theme ? brandForTheme(theme.id) : null;
}

export function sceneInk(theme: ThemeDef): SceneInk {
  const kit = sceneKit(theme);
  if (kit) {
    const p = kit.palette;
    return {
      primary: p.green,
      primaryDeep: p.green,
      accent: p.white,
      accent2: p.black,
      glow: p.greenLight,
      ink: p.white,
      paper: p.black,
      cardTitle: p.green,
      // A grey highlight keeps the badge dark enough for its green and white words.
      badgeHighlight: p.gray500,
      onPrimary: p.black,
      caution: p.green,
      cautionInk: p.black,
    };
  }
  const ui = theme.ui;
  return {
    primary: ui.primary,
    primaryDeep: ui.primaryDeep,
    accent: ui.accent,
    accent2: ui.accent2,
    glow: ui.glow,
    ink: theme.cabinet.pattern === 'circuit' || theme.cabinet.pattern === 'cosmos' ? '#e8f5dc' : ui.ink,
    paper: '#0b0f08',
    cardTitle: ui.glow,
    badgeHighlight: '#ffffff',
    onPrimary: '#ffffff',
    caution: '#ffd23a',
    cautionInk: '#1c1c1c',
  };
}

export function sceneParts(theme: ThemeDef): SceneParts {
  const kit = sceneKit(theme);
  if (kit) {
    const p = kit.palette;
    return {
      dark: p.gray800,
      rubber: p.gray700,
      chip: p.gray950,
      diffuser: p.white,
      glassEdge: p.gray200,
      anodised: p.gray700,
      pins: p.gray400,
      silkscreen: p.gray300,
      rack: p.black,
      // A dark grey cushion: the black stage look continues into the prize bin.
      cushionLift: 0.06,
      cushionSheen: 0.22,
    };
  }
  return {
    dark: '#2c2633',
    rubber: '#3a3540',
    chip: '#15181b',
    diffuser: '#fff8ee',
    glassEdge: '#cfeee6',
    anodised: null,
    pins: '#9aa39a',
    silkscreen: '#e8f5dc',
    rack: '#05070a',
    cushionLift: 0.35,
    cushionSheen: 1,
  };
}

/* ------------------------------------------------------------------ LED wall */

/** Axis-aligned rectangle on the back wall (metres, world x / y). */
export interface WallRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Front face of the back wall (world z). */
export const WALL_Z = -FIELD.depth;

/**
 * The LED wall on the play field's own back wall: almost its whole width (inside the rear corner
 * posts and their light strips) from just under the toys' heads to below the gantry, so it is in
 * view in every layout and the parked claw hangs in front of its animated upper half.
 */
export const LED_WALL: Readonly<WallRect> = { xMin: -0.45, xMax: 0.45, yMin: 0.12, yMax: 0.865 };
/** Width of the LED wall's bezel (it stays clear of the rear corner posts' light strips). */
export const LED_BEZEL = 0.012;

/**
 * Largest box the logo and its clear space may take: centred, in the lower half of the LED wall.
 * Seen from the default eye of every layout (desktop, 9:16 portrait, phone), the parked claw
 * (CLAW.homeX / homeZ, fingers open) covers the back wall from y ≈ 0.44 upwards and the toys'
 * heads reach y ≈ 0.13–0.2, so the logo (y 0.255–0.405 for the GTC kit) sits between them; only
 * the pad's margins (clear space, plain black) can meet the claw's fingertips or a toy.
 */
export const LOGO_AREA = { cx: 0, cy: 0.33, maxW: 0.58, maxH: 0.3, maxLogoH: 0.16 } as const;

/** Where the logo and its black pad go, for an artwork of `aspect` (w / h) and the slot's clear space. */
export interface LogoPlacement {
  cx: number;
  cy: number;
  /** Logo size (metres). */
  w: number;
  h: number;
  /** Pad = logo plus the clear space on every side. */
  padW: number;
  padH: number;
}

/**
 * Fits a logo of `aspect` into LOGO_AREA with `clearSpace` × its height free on every side. The
 * artwork keeps its own aspect ratio (never stretched); the pad hugs logo + clear space.
 */
export function placeLogo(aspect: number, clearSpace: number): LogoPlacement {
  const a = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
  const c = Number.isFinite(clearSpace) && clearSpace >= 0 ? clearSpace : 0.25;
  // A square or upright mark with little clear space would otherwise grow taller than a wordmark
  // and reach up to the parked claw: the artwork itself is capped at maxLogoH.
  const h = Math.min(LOGO_AREA.maxH / (1 + 2 * c), LOGO_AREA.maxW / (a + 2 * c), LOGO_AREA.maxLogoH);
  const w = h * a;
  return { cx: LOGO_AREA.cx, cy: LOGO_AREA.cy, w, h, padW: w + 2 * c * h, padH: h + 2 * c * h };
}

/**
 * Largest box of the host logo (secondary mark) and its clear space: the LED wall's upper-left
 * corner, left of the parked claw (which hangs right of centre) and low enough to stay clear of
 * the top edge of the window in the desktop layout.
 */
export const HOST_AREA = { xMin: LED_WALL.xMin + 0.03, cy: 0.71, maxW: 0.26, maxH: 0.1 } as const;

/**
 * Regions light effects keep away from (the largest possible pads): beams, sparkles and flashes
 * fade where they would pass over them, so light goes behind or around a logo, never over it.
 * The host corner is kept free whenever the kit has a host slot, drawn or not.
 */
export function logoKeepOut(theme: ThemeDef | null): WallRect[] {
  const kit = sceneKit(theme);
  if (!kit) return [];
  const out: WallRect[] = [
    {
      xMin: LOGO_AREA.cx - LOGO_AREA.maxW / 2,
      xMax: LOGO_AREA.cx + LOGO_AREA.maxW / 2,
      yMin: LOGO_AREA.cy - LOGO_AREA.maxH / 2,
      yMax: LOGO_AREA.cy + LOGO_AREA.maxH / 2,
    },
  ];
  if (kit.hostLogo) out.push({ xMin: HOST_AREA.xMin, xMax: HOST_AREA.xMin + HOST_AREA.maxW, yMin: HOST_AREA.cy - HOST_AREA.maxH / 2, yMax: HOST_AREA.cy + HOST_AREA.maxH / 2 });
  return out;
}

/** Where the host logo goes (left-aligned in HOST_AREA), for its artwork aspect. */
export function placeHostLogo(slot: LogoSlot, aspect = slot.aspect): LogoPlacement {
  const a = Number.isFinite(aspect) && aspect > 0.05 ? aspect : slot.aspect;
  const c = slot.clearSpace;
  const h = Math.min(HOST_AREA.maxH / (1 + 2 * c), HOST_AREA.maxW / (a + 2 * c));
  const w = h * a;
  const padW = w + 2 * c * h, padH = h + 2 * c * h;
  return { cx: HOST_AREA.xMin + padW / 2, cy: HOST_AREA.cy, w, h, padW, padH };
}

/* ------------------------------------------------------------ output colour */

/**
 * The scene is drawn into a linear half-float target and tone-mapped once by the composer's
 * output pass (Stage), so `toneMapped = false` alone cannot keep a logo's colours. The logo shader
 * therefore pre-applies the inverse of that output transform (exposure, and Khronos PBR Neutral —
 * the default operator) and keeps its luminance under the bloom threshold, so the logo neither
 * shifts colour nor glows. ACES / AgX are only compensated for exposure.
 */
export const BLOOM_SAFE_LUMINANCE = 1.4;

/** CPU twin of the shader's inverse Neutral transform (unit tested against three's operator). */
export function inverseNeutral(out: [number, number, number]): [number, number, number] {
  const S = 0.8 - 0.04;
  const D = 0.15;
  let [r, g, b] = out;
  const P = Math.min(0.999, Math.max(r, g, b));
  if (P >= S) {
    const d = 1 - S;
    const peak = (d * d) / (1 - P) - d + S;
    const k = 1 - 1 / (D * (peak - P) + 1);
    const back = peak / P / (1 - k);
    r = (r - k * P) * back;
    g = (g - k * P) * back;
    b = (b - k * P) * back;
  }
  const m = Math.max(0, Math.min(r, g, b));
  const offset = m < 0.04 ? Math.sqrt(m) / 2.5 - m : 0.04;
  return [r + offset, g + offset, b + offset];
}

/** three.js' Khronos PBR Neutral operator (linear in, linear out), for tests and checks. */
export function neutralToneMap(c: [number, number, number], exposure = 1): [number, number, number] {
  const S = 0.8 - 0.04;
  const D = 0.15;
  let [r, g, b] = [c[0] * exposure, c[1] * exposure, c[2] * exposure];
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < S) return [r, g, b];
  const d = 1 - S;
  const newPeak = 1 - (d * d) / (peak + d - S);
  const k = newPeak / peak;
  r *= k;
  g *= k;
  b *= k;
  const t = 1 - 1 / (D * (peak - newPeak) + 1);
  return [r + (newPeak - r) * t, g + (newPeak - g) * t, b + (newPeak - b) * t];
}
