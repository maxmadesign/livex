/**
 * Brand kits: an event / host identity laid over one theme (palette, logo and font slots, the
 * names dialogue may use). Pure data, shared by the browser and the API server (claim pages).
 *
 * Official artwork is never redrawn in code. The owner drops the official files into
 * `public/assets/brand/<kit>/` (see docs/BRAND.md); until then an original placeholder is shown
 * and the brand status says so. Nothing else has to change when the files arrive.
 */
import type { Lang, ThemeId } from '../core/types';
import { GTC_KIT } from './kitGtc';
import { NVIDIA_PALETTE } from './palette';

export { NVIDIA_PALETTE } from './palette';

export const BRAND_IDS = ['gtc', 'neutral'] as const;
export type BrandId = (typeof BRAND_IDS)[number];

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

export const BRAND_KITS: Readonly<Record<BrandId, BrandKit>> = Object.freeze({
  gtc: GTC_KIT,
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
