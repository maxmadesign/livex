/**
 * The GTC kit's data. A public demo build (VITE_BRAND=neutral) replaces this module with
 * ./kitGtc.neutral.ts at bundle time (vite.config.ts), so such a bundle carries no GTC / NVIDIA
 * names or file paths at all. Everything else imports the kit through ./kits.ts.
 */
import type { BrandKit } from './kits';
import { NVIDIA_PALETTE } from './palette';

const GTC_DIR = 'assets/brand/gtc';

export const GTC_KIT: BrandKit = {
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
};
