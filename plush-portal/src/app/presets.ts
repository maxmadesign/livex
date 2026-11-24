import { GRAPHICS_PRESET_ADDITIONS, type GameplaySettings, type GraphicsSettings } from '../settings/spec';

type GraphicsValues = Omit<GraphicsSettings, 'preset' | 'autoOptimize' | 'perfPanel' | 'exposure' | 'toneMapping' | 'dof' | 'motionBlur'>;

/**
 * Starting budgets for each quality level. They are engineering defaults, not
 * measured guarantees: the automatic optimiser and the performance panel show
 * what a given machine really sustains.
 */
export const GRAPHICS_PRESETS: Record<Exclude<GraphicsSettings['preset'], 'custom'>, GraphicsValues> = {
  // Phone tier and performance floor: 30 fps target, device pixel ratio capped at 1.25 and at most
  // 0.7 MP of 3D pixels, no fur shells, simple materials (512 textures), no contact shadows.
  safe: {
    renderScale: 1,
    maxPixels: 0.7,
    targetFps: '30',
    lod: 'low',
    textures: '512',
    shadows: 'low',
    ao: 'off',
    glass: 'low',
    reflections: 'static',
    fur: 'sheen',
    deform: 'basic',
    aa: 'fxaa',
    bloom: 0,
    particles: 20,
    // Effects intensity, light show and pixel-ratio cap (src/settings/spec.ts, also used to upgrade older stored data).
    ...GRAPHICS_PRESET_ADDITIONS.safe,
  },
  // Default: ~1080p-equivalent internal pixels, aimed at 60 fps on a Ryzen 7 7840HS / Radeon 780M class iGPU.
  // 1K textures, clearcoat lacquer and brushed metal, PCF shadows 2048 plus 256² contact shadows
  // refreshed every other frame, 256 studio environment, FXAA.
  medium: {
    renderScale: 1,
    maxPixels: 2.1,
    targetFps: '60',
    lod: 'medium',
    textures: '1k',
    shadows: 'medium',
    ao: 'off',
    glass: 'medium',
    reflections: 'static',
    fur: 'shell',
    deform: 'basic',
    aa: 'fxaa',
    bloom: 0.25,
    particles: 60,
    // Effects intensity, light show and pixel-ratio cap (src/settings/spec.ts, also used to upgrade older stored data).
    ...GRAPHICS_PRESET_ADDITIONS.medium,
  },
  // Discrete GPUs: 2K textures with metallic flake, braided cable and full claw / cabinet detail,
  // soft VSM shadows 4096 plus 512² contact shadows, 512 environment, GTAO, SMAA.
  high: {
    renderScale: 1,
    maxPixels: 4,
    targetFps: '60',
    lod: 'high',
    textures: '2k',
    shadows: 'high',
    ao: 'low',
    glass: 'medium',
    reflections: 'refresh',
    fur: 'shell',
    deform: 'fine',
    aa: 'smaa',
    bloom: 0.3,
    particles: 150,
    // Effects intensity, light show and pixel-ratio cap (src/settings/spec.ts, also used to upgrade older stored data).
    ...GRAPHICS_PRESET_ADDITIONS.high,
  },
  // High-end GPUs and 4K kiosks: 4K back wall, 1024 studio environment, live cabinet reflections,
  // transmission glass, MSAA 4×.
  ultra: {
    renderScale: 1,
    maxPixels: 8.3,
    targetFps: '60',
    lod: 'high',
    textures: '4k',
    shadows: 'high',
    ao: 'high',
    glass: 'high',
    reflections: 'live',
    fur: 'shellHigh',
    deform: 'ultra',
    aa: 'msaa4',
    bloom: 0.3,
    particles: 300,
    // Effects intensity, light show and pixel-ratio cap (src/settings/spec.ts, also used to upgrade older stored data).
    ...GRAPHICS_PRESET_ADDITIONS.ultra,
  },
};

export const GRAPHICS_PRESET_KEYS = Object.keys(GRAPHICS_PRESETS.medium) as (keyof GraphicsValues)[];

type DifficultyValues = Pick<GameplaySettings, 'moveSpeed' | 'moveAccel' | 'descendSpeed' | 'liftSpeed' | 'clawForce' | 'closeSpeed' | 'gripAssist' | 'ropeSwing'>;

/**
 * Difficulty only changes physical parameters (claw force, grip assist,
 * closing speed, cable swing, travel speeds). There is no hidden win counter.
 */
export const DIFFICULTY_PRESETS: Record<Exclude<GameplaySettings['difficulty'], 'custom'>, DifficultyValues> = {
  easy: { moveSpeed: 0.4, moveAccel: 2.6, descendSpeed: 0.5, liftSpeed: 0.38, clawForce: 1.3, closeSpeed: 1, gripAssist: 1.4, ropeSwing: 0.3 },
  arcade: { moveSpeed: 0.42, moveAccel: 2.4, descendSpeed: 0.55, liftSpeed: 0.42, clawForce: 1, closeSpeed: 1, gripAssist: 1, ropeSwing: 0.55 },
  skill: { moveSpeed: 0.46, moveAccel: 2.2, descendSpeed: 0.6, liftSpeed: 0.44, clawForce: 1, closeSpeed: 1, gripAssist: 0.6, ropeSwing: 0.85 },
};

export const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_PRESETS.arcade) as (keyof DifficultyValues)[];

/** Writes every value of a graphics preset into a settings store (draft or applied, whichever is active). */
export function applyGraphicsPreset(set: (path: string, value: unknown) => void, preset: Exclude<GraphicsSettings['preset'], 'custom'>): void {
  const values = GRAPHICS_PRESETS[preset];
  for (const key of GRAPHICS_PRESET_KEYS) set(`graphics.${key}`, values[key]);
  set('graphics.preset', preset);
}

export function applyDifficultyPreset(set: (path: string, value: unknown) => void, preset: Exclude<GameplaySettings['difficulty'], 'custom'>): void {
  const values = DIFFICULTY_PRESETS[preset];
  for (const key of DIFFICULTY_KEYS) set(`gameplay.${key}`, values[key]);
  set('gameplay.difficulty', preset);
}
