/**
 * Brand kits: an event / host identity laid over one theme (palette, logo and font slots, the
 * names dialogue may use). Pure data, shared by the browser and the API server (claim pages).
 *
 * Official artwork is never redrawn in code. The owner drops the official files into
 * `public/assets/brand/<kit>/` (see docs/BRAND.md); until then an original placeholder is shown
 * and the brand status says so. Nothing else has to change when the files arrive.
 */
import type { Lang, ThemeId } from '../core/types';

export const BRAND_IDS = ['gtc', 'neutral'] as const;
export type BrandId = (typeof BRAND_IDS)[number];

/**
 * NVIDIA core palette (web values). `green`, `black` and `white` are the brand colours; the greys
 * are neutral steps. `greenDeep` / `greenLight` are derived shades for pressed states, 3D shading
 * and emitted light only: never use them to recolour a logo.
 */
export const NVIDIA_PALETTE = {
  green: '#76B900',
  black: '#000000',
  white: '#FFFFFF',
  gray950: '#0D0D0D',
  gray900: '#1A1A1A',
  gray800: '#262626',
  gray700: '#333333',
  gray600: '#4D4D4D',
  gray500: '#666666',
  gray400: '#8C8C8C',
  gray300: '#B3B3B3',
  gray200: '#CCCCCC',
  gray100: '#EEEEEE',
  greenDeep: '#5A8F00',
  greenLight: '#A4D65E',
} as const;
export type BrandPalette = { readonly [K in keyof typeof NVIDIA_PALETTE]: string };

export interface LogoSlot {
  /** Official files the owner provides, tried in order (site-root relative, Vite `public/`). */
  official: readonly string[];
  /** Original placeholder shipped in the repo; null = draw nothing while the official file is missing. */
  placeholder: string | null;
  /** Width / height of the artwork, to size planes before the image has loaded. */
  aspect: number;
  /** Minimum clear space on every side, as a fraction of the logo's height. */
  clearSpace: number;
}

export interface FontSlot {
  /** CSS family name of the brand typeface (only used when its files load). */
  family: string;
  /** Official font files the owner provides (site-root relative). Missing files fall back silently. */
  files: readonly { weight: number; url: string }[];
  /** Fallback stack used until / unless the brand font loads. */
  fallback: string;
}

export interface BrandKit {
  id: BrandId;
  /** The theme this kit dresses. */
  theme: ThemeId;
  /** Event name: UI copy and the {event} token in dialogue. */
  eventName: string;
  /** Host organisation: the {host} token; '' = none. */
  hostName: string;
  /** Theme name in the theme picker and prompts. */
  themeName: Readonly<Record<Lang, string>>;
  palette: BrandPalette;
  /** Event logo (the hero mark on the back wall, attract screen, claim page). */
  logo: LogoSlot;
  /** Host logo (smaller secondary mark), or null. */
  hostLogo: LogoSlot | null;
  font: FontSlot;
  /**
   * True: dialogue and GPT lines may name the event and host (facts.brand). False: the theme
   * stays generic and the "no real companies" rule applies unchanged.
   */
  namesAllowed: boolean;
}

const GTC_DIR = 'assets/brand/gtc';

export const BRAND_KITS: Readonly<Record<BrandId, BrandKit>> = Object.freeze({
  gtc: {
    id: 'gtc',
    theme: 'gpu',
    eventName: 'GTC',
    hostName: 'NVIDIA',
    themeName: { en: 'NVIDIA GTC', zh: 'NVIDIA GTC', ja: 'NVIDIA GTC' },
    palette: NVIDIA_PALETTE,
    logo: {
      official: [`${GTC_DIR}/gtc-logo.svg`, `${GTC_DIR}/gtc-logo.png`],
      placeholder: `${GTC_DIR}/gtc-logo.placeholder.svg`,
      aspect: 2.46,
      clearSpace: 0.5,
    },
    hostLogo: {
      official: [`${GTC_DIR}/nvidia-logo.svg`, `${GTC_DIR}/nvidia-logo.png`],
      placeholder: null,
      aspect: 3.2,
      clearSpace: 0.5,
    },
    font: {
      family: 'NVIDIA Sans',
      files: [
        { weight: 400, url: `${GTC_DIR}/fonts/NVIDIASans-Regular.woff2` },
        { weight: 700, url: `${GTC_DIR}/fonts/NVIDIASans-Bold.woff2` },
      ],
      fallback: "'Inter Variable', 'Inter', 'Helvetica Neue', Arial, sans-serif",
    },
    namesAllowed: true,
  },
  /** The original "GPU Party" identity (no real event, host or logo); used for public demo builds. */
  neutral: {
    id: 'neutral',
    theme: 'gpu',
    eventName: 'GPU Party',
    hostName: '',
    themeName: { en: 'GPU Party', zh: '显卡派对', ja: 'GPUパーティー' },
    palette: NVIDIA_PALETTE,
    logo: {
      official: ['assets/themes/gpu/logo.svg'],
      placeholder: 'assets/themes/gpu/logo.svg',
      aspect: 1,
      clearSpace: 0.25,
    },
    hostLogo: null,
    font: { family: '', files: [], fallback: "'Inter Variable', 'Inter', 'Helvetica Neue', Arial, sans-serif" },
    namesAllowed: false,
  },
});

/** Parses a brand id from a build flag / env value; unknown values fall back to `gtc`. */
export function parseBrandId(value: string | undefined | null): BrandId {
  const v = (value ?? '').trim().toLowerCase();
  return (BRAND_IDS as readonly string[]).includes(v) ? (v as BrandId) : 'gtc';
}
