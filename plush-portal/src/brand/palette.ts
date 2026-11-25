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
