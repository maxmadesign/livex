/**
 * Stand-in for ./kitGtc.ts in public demo builds (VITE_BRAND=neutral, see vite.config.ts): the
 * bundle then carries no GTC / NVIDIA names, font names or file paths. The neutral kit is the
 * active one in such a build, so this entry is never shown; it keeps the table complete and can
 * never unlock names (namesAllowed false).
 */
import type { BrandKit } from './kits';
import { NVIDIA_PALETTE } from './palette';

export const GTC_KIT: BrandKit = {
  id: 'gtc',
  theme: 'gpu',
  eventName: 'GPU Party',
  hostName: '',
  themeName: { en: 'GPU Party', zh: '显卡派对', ja: 'GPUパーティー' },
  palette: NVIDIA_PALETTE,
  logo: { official: ['assets/themes/gpu/logo.svg'], placeholder: 'assets/themes/gpu/logo.svg', aspect: 1, clearSpace: 0.25 },
  hostLogo: null,
  font: { family: '', files: [], fallback: "'Inter Variable', 'Inter', 'Helvetica Neue', Arial, sans-serif" },
  namesAllowed: false,
};
