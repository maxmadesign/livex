/**
 * Contract of the effects system (particles, light effects, light show). The game talks
 * to effects only through this interface; `src/scene/Effects.ts` implements it.
 * Effects are presentation only: nothing here may influence physics or round outcomes.
 */

export type FxTier = 'common' | 'rare' | 'epic' | 'legendary';
export type FxBurstKind = 'grab' | 'contact' | 'lift' | 'slip' | 'drop' | 'restock' | 'combo' | 'score' | 'cta';
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
export interface FxApi {
  /** One-shot particle burst at a world position. */
  burst(kind: FxBurstKind, pos: Vec3Like, opts?: { tier?: FxTier; scale?: number; color?: string }): void;
  /** Big win celebration at the prize exit (confetti, sparkles, shockwave, light show); intensity grows with tier. */
  celebrate(tier: FxTier, pos: Vec3Like): void;
  /** Rarity aura around the toy currently held (null = none). Called every frame with its world position. */
  aura(pos: Vec3Like | null, tier?: FxTier): void;
  /** Moving light show mode. */
  lightShow(mode: 'off' | 'idle' | 'attract' | 'win' | 'jackpot'): void;
  setIntensity(intensity: number): void;
  setLightShowEnabled(enabled: boolean): void;
}
