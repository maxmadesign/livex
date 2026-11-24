/**
 * How many particles an effect may use. Counts are tuned for the Medium preset
 * (decor particle budget 60, effects intensity 1) and scaled from there:
 *
 *   scale = (budget / 60)^0.6 × intensity × (reduced motion ? 0.4 : 1)
 *
 * Safe (20, 0.5) ≈ 0.26 · Medium (60, 1) = 1 · High (150, 1.2) ≈ 2.1 · Ultra (300, 1.5) ≈ 3.9.
 * A budget or an intensity of 0 turns particle effects off. Quality never changes physics.
 */

export const REFERENCE_BUDGET = 60;
export const REDUCED_MOTION_FACTOR = 0.4;

export function particleScale(budget: number, intensity: number, reducedMotion: boolean): number {
  if (!(budget > 0) || !(intensity > 0)) return 0;
  const b = Math.pow(Math.min(300, budget) / REFERENCE_BUDGET, 0.6);
  return b * Math.min(1.5, intensity) * (reducedMotion ? REDUCED_MOTION_FACTOR : 1);
}

/** `base` particles at the reference settings → particles at `scale` (at least one while scale > 0). */
export function scaledCount(base: number, scale: number): number {
  if (!(scale > 0) || !(base > 0)) return 0;
  return Math.max(1, Math.round(base * scale));
}

/** Strength of light effects (beams, flashes, LED energy) for an intensity setting. */
export function lightScale(intensity: number): number {
  if (!(intensity > 0)) return 0;
  return Math.min(1.25, intensity);
}

/** Ambient motes for a decor budget (unchanged from the first version: at most 40). */
export function ambientTarget(budget: number, reducedMotion: boolean): number {
  const n = Math.round(Math.min(40, Math.max(0, budget) * 0.22));
  return reducedMotion ? Math.min(6, n) : n;
}
