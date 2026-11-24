/**
 * Shared constants of the effects system: sprite shapes (fragment shader branches),
 * quad orientation modes, particle behaviours and the family tags used for statistics.
 * Plain objects (not enums) so they work with `isolatedModules`.
 */

/** Sprite shapes; must match the branches in `shaders.ts`. */
export const SHAPE = {
  /** Soft round glow with a hot core. */
  GLOW: 0,
  /** Four-point star sparkle. */
  STAR: 1,
  /** Thin ring; extra1 = band thickness (fraction of the radius), aux = softness 0..1. */
  RING: 2,
  /** Ring whose colour runs through the rainbow around it; extra0 = hue offset. */
  RAINBOW_RING: 3,
  /** Axial streak, brightest at its head (sparks, firework trails, star-burst rays). */
  SPARK: 4,
  /** Axial light shaft, brightest at its source (light show). extra0 = dust phase. */
  BEAM: 5,
  /** Paper confetti rectangle; extra0 = cos(flip angle). */
  CONFETTI: 6,
  /** Sakura petal; extra0 = cos(flip angle). */
  PETAL: 7,
  /** Five-point paper star (Storybook); extra0 = cos(flip angle). */
  PAPER_STAR: 8,
  /** Soap bubble rim with a highlight. */
  BUBBLE: 9,
  /** Spinning gold coin; extra0 = cos(flip angle). */
  COIN: 10,
  /** Square LED pixel / data bit (GPU Party). */
  PIXEL: 11,
  /** Soft cloud puff (dust, plush fluff). aux = outline variant. */
  PUFF: 12,
  /** Flame tongue pointing up. */
  FLAME: 13,
  /** Large soft radial flash. */
  FLASH: 14,
  /** Crisp disc (aim dot). */
  DISC: 15,
  /** Uniform thin axial line (aim beam). */
  LINE: 16,
} as const;
export type Shape = (typeof SHAPE)[keyof typeof SHAPE];

/** How a sprite quad is oriented. */
export const MODE = {
  /** Faces the camera (the camera never rotates, so this is the screen plane). */
  BILLBOARD: 0,
  /** Lies in the horizontal (x/z) plane: rings and pools of light on the floor. */
  FLAT: 1,
  /** Stretched from a start point along an axis, turned towards the viewer (streaks, beams). */
  AXIAL: 2,
} as const;
export type Mode = (typeof MODE)[keyof typeof MODE];

/** Shape and mode packed into one float attribute. */
export function spriteCode(shape: number, mode: number): number {
  return shape + mode * 32;
}

/** Particle motion models (`ParticlePool.simulate`). */
export const BEH = {
  /** Gravity plus linear drag. */
  BALLISTIC: 0,
  /** Ballistic with side-to-side sway (confetti, petals, paper). */
  FLUTTER: 1,
  /** Buoyant with a wobble (bubbles, motes). */
  RISE: 2,
  /** Circles a centre point while rising (flame swirl, aura trails). */
  ORBIT: 3,
  /** Firework shell: ballistic, bursts when its life ends. */
  SHELL: 4,
  /** Does not move; only grows and fades (rings, glows). */
  FIXED: 5,
  /** Fixed origin; the axis grows along (vx, vy, vz) up to size1 (star-burst rays). */
  RAY: 6,
} as const;

/** Families, for statistics and tests (`Effects.familyCounts`). */
export const FAMILY = {
  NONE: 0,
  SPARKLE: 1,
  CONFETTI: 2,
  RING: 3,
  RAY: 4,
  FIREWORK: 5,
  SHELL: 6,
  PUFF: 7,
  COIN: 8,
  FLAME: 9,
  MOTIF: 10,
  AMBIENT: 11,
  TRAIL: 12,
  SPARK: 13,
  GLOW: 14,
  RAIN: 15,
} as const;
export type FamilyName = Lowercase<keyof typeof FAMILY>;
export const FAMILY_NAMES: readonly FamilyName[] = (Object.keys(FAMILY) as (keyof typeof FAMILY)[])
  .sort((a, b) => FAMILY[a] - FAMILY[b])
  .map((k) => k.toLowerCase() as FamilyName);

/** Pool sizes. Fixed at construction; nothing grows at run time. */
export const ADDITIVE_POOL = 2560;
export const NORMAL_POOL = 1536;
/** Instances drawn every frame without a pool entry (beams, aura, aim helpers, LED chase). */
export const ADDITIVE_IMMEDIATE = 192;
export const NORMAL_IMMEDIATE = 16;

/** Light show timing. */
export const WIN_SECONDS = 2.6;
export const JACKPOT_SECONDS = 4;
/** Minimum time between two global flashes (keeps well under three flashes per second). */
export const FLASH_MIN_INTERVAL = 0.45;
/**
 * Jackpot beam strobe rate, Hz. 3 Hz sits exactly on the photosensitivity limit (no more than
 * three flashes in any one second; public 86" screens), so the beams alternate at 2 Hz (0.5 s).
 */
export const JACKPOT_STROBE_HZ = 2;

/** Where the prize exit is when nobody says otherwise (front-left chute mouth). */
export const DEFAULT_FOCUS = { x: -0.35, y: 0.02, z: -0.15 } as const;
