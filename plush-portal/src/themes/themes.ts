import type { ThemeId } from '../core/types';

export type ParticleKind = 'petals' | 'confetti' | 'bubbles' | 'stars';
export type PatternKind = 'sakura' | 'storybook' | 'waves' | 'cosmos';
export type LedMode = 'breathe' | 'chase' | 'wave' | 'twinkle';

/**
 * Everything that changes with a theme besides the toys and the music:
 * cabinet finish, light rig, decoration kit, UI colours and celebration.
 */
export interface ThemeDef {
  id: ThemeId;
  /** UI colours (CSS custom properties on the HUD root). */
  ui: {
    primary: string;
    primaryDeep: string;
    accent: string;
    accent2: string;
    ink: string;
    paper: string;
    panel: string;
    glow: string;
  };
  cabinet: {
    /** Lacquered frame colour and its accent stripe. */
    frame: string;
    frameAccent: string;
    /** Tint of the bare metal (rails, claw). */
    metalTint: string;
    clawCap: string;
    backboard: string;
    backboardInk: string;
    pattern: PatternKind;
    mat: string;
    matInk: string;
    fascia: string;
    velvet: string;
    acrylicEdge: string;
    led: string[];
    ledMode: LedMode;
  };
  lights: {
    key: string;
    keyIntensity: number;
    sky: string;
    ground: string;
    hemiIntensity: number;
    rim: string;
    rimIntensity: number;
    envIntensity: number;
    /** Colours of the small procedural environment used for reflections (ceiling, walls, floor). */
    env: [string, string, string];
    exposure: number;
    /** Slow water-light animation on the floor (Ocean). */
    caustics: boolean;
  };
  backdrop: { top: string; bottom: string; bokeh: string[] };
  particles: { kind: ParticleKind; colors: string[] };
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  sakura: {
    id: 'sakura',
    ui: {
      primary: '#ff8fb3',
      primaryDeep: '#e2608c',
      accent: '#7fd8bd',
      accent2: '#ffe27a',
      ink: '#5a3145',
      paper: '#fff8f1',
      panel: '#fff0f4',
      glow: '#ffc6d9',
    },
    cabinet: {
      frame: '#fff4ea',
      frameAccent: '#ff9dbd',
      metalTint: '#fff6f2',
      clawCap: '#ff8fb3',
      backboard: '#ffc9da',
      backboardInk: '#ff8fb3',
      pattern: 'sakura',
      mat: '#fbe9d6',
      matInk: '#ffd0de',
      fascia: '#ffc4d6',
      velvet: '#ff9bbb',
      acrylicEdge: '#ff9dc0',
      led: ['#ffb0cb', '#fff0b0', '#a8ecd6'],
      ledMode: 'breathe',
    },
    lights: {
      key: '#fff1e0',
      keyIntensity: 2.5,
      sky: '#fff3f6',
      ground: '#ffd2df',
      hemiIntensity: 0.24,
      rim: '#ffc4dd',
      rimIntensity: 1.0,
      envIntensity: 0.34,
      env: ['#fffaf2', '#ffd9e6', '#f6c9d4'],
      exposure: 1.0,
      caustics: false,
    },
    backdrop: { top: '#ffdbe7', bottom: '#f7b8cd', bokeh: ['#ffffff', '#ffe9a8', '#b7f0dc', '#ffc0d6'] },
    particles: { kind: 'petals', colors: ['#ffc2d6', '#ffd9e5', '#ffffff', '#ffb0c9'] },
  },
  storybook: {
    id: 'storybook',
    ui: {
      primary: '#ff8a6b',
      primaryDeep: '#e2603f',
      accent: '#4fb3d9',
      accent2: '#ffd772',
      ink: '#4a3142',
      paper: '#fff9ec',
      panel: '#fff3dc',
      glow: '#ffd3a8',
    },
    cabinet: {
      frame: '#fff0cf',
      frameAccent: '#ff8a6b',
      metalTint: '#fff3e2',
      clawCap: '#4fb3d9',
      backboard: '#f8d39a',
      backboardInk: '#ef9d5d',
      pattern: 'storybook',
      mat: '#f6e3bd',
      matInk: '#a9d7ea',
      fascia: '#f7b98a',
      velvet: '#b79ae0',
      acrylicEdge: '#ffb07a',
      led: ['#ffcf6e', '#ff9a7a', '#7fc8e8', '#c2a6ee'],
      ledMode: 'chase',
    },
    lights: {
      key: '#ffe9c4',
      keyIntensity: 2.6,
      sky: '#fff2d6',
      ground: '#f3c59a',
      hemiIntensity: 0.24,
      rim: '#9fd3f2',
      rimIntensity: 1.05,
      envIntensity: 0.34,
      env: ['#fff4d8', '#ffd5a6', '#c9b4ea'],
      exposure: 1.0,
      caustics: false,
    },
    backdrop: { top: '#ffe2ae', bottom: '#f1a886', bokeh: ['#fff6c4', '#ffb08f', '#9ad6f0', '#d4baf5'] },
    particles: { kind: 'confetti', colors: ['#ff8a6b', '#ffd772', '#4fb3d9', '#b79ae0', '#ffffff'] },
  },
  ocean: {
    id: 'ocean',
    ui: {
      primary: '#6ab8e6',
      primaryDeep: '#3d8fc4',
      accent: '#b3a2ee',
      accent2: '#8fe6dc',
      ink: '#2c4a66',
      paper: '#f6fbff',
      panel: '#e8f5ff',
      glow: '#bfe8ff',
    },
    cabinet: {
      frame: '#eaf6fd',
      frameAccent: '#7cc4ea',
      metalTint: '#f1f8ff',
      clawCap: '#8fd8ea',
      backboard: '#9fd2ee',
      backboardInk: '#62aede',
      pattern: 'waves',
      mat: '#d9eef6',
      matInk: '#c9e6f4',
      fascia: '#a9cdf0',
      velvet: '#8fb6e6',
      acrylicEdge: '#8fdcf0',
      led: ['#9be0f5', '#c8b8f8', '#a8f0e2'],
      ledMode: 'wave',
    },
    lights: {
      key: '#f1fbff',
      keyIntensity: 2.4,
      sky: '#e6f6ff',
      ground: '#b9d6f0',
      hemiIntensity: 0.26,
      rim: '#c7b6ff',
      rimIntensity: 1.1,
      envIntensity: 0.36,
      env: ['#f4fcff', '#bfe4f7', '#b3a8e8'],
      exposure: 1.0,
      caustics: true,
    },
    backdrop: { top: '#bfe3f7', bottom: '#8fb5e6', bokeh: ['#ffffff', '#c8f4ee', '#d2c6ff', '#a8dcf8'] },
    particles: { kind: 'bubbles', colors: ['#ffffff', '#d9f3ff', '#d8ccff', '#b8f2e8'] },
  },
  cosmic: {
    id: 'cosmic',
    ui: {
      primary: '#9b7bff',
      primaryDeep: '#6b4be0',
      accent: '#49dcec',
      accent2: '#ffa9a0',
      ink: '#f4efff',
      paper: '#2a2148',
      panel: '#352a5c',
      glow: '#b79cff',
    },
    cabinet: {
      frame: '#3b2f6b',
      frameAccent: '#49dcec',
      metalTint: '#e9e4ff',
      clawCap: '#ff9fb0',
      backboard: '#2b2352',
      backboardInk: '#6b57c8',
      pattern: 'cosmos',
      mat: '#3a2f66',
      matInk: '#5f4fae',
      fascia: '#30265a',
      velvet: '#5b3fb5',
      acrylicEdge: '#56e3f2',
      led: ['#57e0f0', '#ff9ec0', '#a98bff', '#ffd38a'],
      ledMode: 'twinkle',
    },
    lights: {
      key: '#f3ecff',
      keyIntensity: 3.0,
      sky: '#b8a8ff',
      ground: '#3a2c70',
      hemiIntensity: 0.55,
      rim: '#4fe3f2',
      rimIntensity: 1.5,
      envIntensity: 0.55,
      env: ['#e6dcff', '#5a48b8', '#2a1f55'],
      exposure: 1.08,
      caustics: false,
    },
    backdrop: { top: '#2a2058', bottom: '#191233', bokeh: ['#57e0f0', '#ff9ec0', '#a98bff', '#ffe3a8'] },
    particles: { kind: 'stars', colors: ['#57e0f0', '#ff9ec0', '#ffe9a8', '#ffffff', '#b79cff'] },
  },
  // GPU Party: plush merchandise from a graphics-card / AI-computing world. Placeholder:
  // the Cosmic Arcade definition retinted to black with a vivid green accent (same backdrop
  // pattern, LED mode and particle kind); the real look comes with the theme's own content.
  gpu: {
    id: 'gpu',
    ui: {
      primary: '#76b900',
      primaryDeep: '#4e7a00',
      accent: '#9be33a',
      accent2: '#e4ff9e',
      ink: '#eaffd0',
      paper: '#10140c',
      panel: '#1a2212',
      glow: '#b6ff5c',
    },
    cabinet: {
      frame: '#141810',
      frameAccent: '#76b900',
      metalTint: '#e6eee0',
      clawCap: '#76b900',
      backboard: '#0e120b',
      backboardInk: '#3f6310',
      pattern: 'cosmos',
      mat: '#171d12',
      matInk: '#33500f',
      fascia: '#12160f',
      velvet: '#2e4a0c',
      acrylicEdge: '#8fd61a',
      led: ['#76b900', '#b6ff5c', '#ffffff', '#9be33a'],
      ledMode: 'twinkle',
    },
    lights: {
      key: '#f3ffe8',
      keyIntensity: 3.0,
      sky: '#c9f29e',
      ground: '#1e2c10',
      hemiIntensity: 0.55,
      rim: '#76b900',
      rimIntensity: 1.5,
      envIntensity: 0.55,
      env: ['#e8f6da', '#3f6a12', '#12180c'],
      exposure: 1.08,
      caustics: false,
    },
    backdrop: { top: '#151d0f', bottom: '#080a06', bokeh: ['#76b900', '#b6ff5c', '#9be33a', '#ffffff'] },
    particles: { kind: 'stars', colors: ['#76b900', '#b6ff5c', '#9be33a', '#ffffff', '#eaffd0'] },
  },
};

export function themeOf(id: ThemeId): ThemeDef {
  return THEMES[id];
}
