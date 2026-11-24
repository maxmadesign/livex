/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Brand kit of this build: 'gtc' (default) or 'neutral' (public demo copies; src/brand). */
  readonly VITE_BRAND?: string;
  /** '1' only for public demo copies without the API server: the win card shows a labelled DEMO QR. */
  readonly VITE_REWARDS_DEMO?: string;
}
