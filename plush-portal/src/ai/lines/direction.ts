import type { DirKey } from './types';

/**
 * Turns the physics fact "where was the nearest toy relative to the claw" into
 * the direction the player should move the claw.
 *
 *   +dx: the toy is to the player's right  → move right
 *   +dz: the toy is closer to the player   → move toward the front
 *
 * Returns null when the claw was practically on target (a direction would be
 * noise) or when the offset is unusable.
 */
export function directionKey(nearest: { dx: number; dz: number } | null | undefined): DirKey | null {
  if (!nearest) return null;
  const { dx, dz } = nearest;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (Math.hypot(dx, dz) < 0.02) return null;
  const x = dx > 0 ? 'right' : 'left';
  const z = dz > 0 ? 'front' : 'back';
  // A second direction is only worth mentioning when it is a real part of the miss.
  const MINOR_MIN = 0.04;
  if (ax >= az) {
    return az >= MINOR_MIN && az >= ax * 0.5 ? (`${x}_${z}` as DirKey) : x;
  }
  return ax >= MINOR_MIN && ax >= az * 0.5 ? (`${x}_${z}` as DirKey) : z;
}
