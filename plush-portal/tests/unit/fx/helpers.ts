import { Effects } from '../../../src/scene/Effects';
import type { SpriteBatch } from '../../../src/scene/fx/SpriteBatch';
import type { ParticlePool } from '../../../src/scene/fx/ParticlePool';
import { THEMES } from '../../../src/themes/themes';
import type { ThemeId } from '../../../src/core/types';

export const EXIT = { x: -0.35, y: 0, z: -0.15 };
export const PRESETS = {
  safe: { budget: 20, intensity: 0.5 },
  medium: { budget: 60, intensity: 1 },
  high: { budget: 150, intensity: 1.2 },
  ultra: { budget: 300, intensity: 1.5 },
} as const;

export interface Internals {
  addBatch: SpriteBatch;
  normBatch: SpriteBatch;
  addPool: ParticlePool;
  normPool: ParticlePool;
}

export function internals(fx: Effects): Internals {
  return fx as unknown as Internals;
}

export function makeFx(opts: { theme?: ThemeId; budget?: number; intensity?: number; reducedMotion?: boolean; lightShow?: boolean } = {}): Effects {
  const fx = new Effects();
  fx.setTheme(THEMES[opts.theme ?? 'sakura']);
  fx.setBudget(opts.budget ?? 60);
  fx.setIntensity(opts.intensity ?? 1);
  fx.reducedMotion = opts.reducedMotion ?? false;
  if (opts.lightShow !== undefined) fx.setLightShowEnabled(opts.lightShow);
  // No ambient motes in counting tests unless asked for: they spawn at random times.
  return fx;
}

/** Runs `seconds` of effects time at 60 Hz, calling `each` after every frame. */
export function run(fx: Effects, seconds: number, each?: (frame: number) => void): void {
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) {
    fx.update(1 / 60);
    each?.(f);
  }
}

/** Instances of the additive batch written last frame with sprite code `code` (alpha values). */
export function additiveAlphas(fx: Effects, code: number): number[] {
  const batch = internals(fx).addBatch;
  const [, , color, meta] = batch.buffers();
  const out: number[] = [];
  for (let i = 0; i < batch.n; i++) if (Math.round(meta![i * 3]!) === code) out.push(color![i * 4 + 3]!);
  return out;
}

/** Colours (r, g, b) of the additive instances with sprite code `code`. */
export function additiveColors(fx: Effects, code: number): [number, number, number][] {
  const batch = internals(fx).addBatch;
  const [, , color, meta] = batch.buffers();
  const out: [number, number, number][] = [];
  for (let i = 0; i < batch.n; i++) if (Math.round(meta![i * 3]!) === code) out.push([color![i * 4]!, color![i * 4 + 1]!, color![i * 4 + 2]!]);
  return out;
}

/** Positions (x, y, z) of the additive instances with sprite code `code`. */
export function additivePositions(fx: Effects, code: number): [number, number, number][] {
  const batch = internals(fx).addBatch;
  const [pos, , , meta] = batch.buffers();
  const out: [number, number, number][] = [];
  for (let i = 0; i < batch.n; i++) if (Math.round(meta![i * 3]!) === code) out.push([pos![i * 4]!, pos![i * 4 + 1]!, pos![i * 4 + 2]!]);
  return out;
}

/** Peak of each family count over `seconds` after `act`. */
export function peakFamilies(fx: Effects, seconds: number): Record<string, number> {
  const peak: Record<string, number> = {};
  run(fx, seconds, () => {
    for (const [k, v] of Object.entries(fx.familyCounts())) peak[k] = Math.max(peak[k] ?? 0, v);
  });
  return peak;
}
