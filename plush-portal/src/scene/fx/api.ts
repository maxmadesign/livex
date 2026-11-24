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
  /**
   * Optional (added by the effects work): extra energy 0..1 for the cabinet LED strips while
   * the light show runs. The game adds it to the energy it passes to `CabinetMaterials.updateLeds`.
   */
  ledEnergy?(): number;
  /** Optional: counters for diagnostics and tests. */
  fxState?(): FxStats;
}

/** Light show mode (same values as `FxApi.lightShow`). */
export type FxLightShowMode = 'off' | 'idle' | 'attract' | 'win' | 'jackpot';

/** Diagnostics of the effects system (`Effects.fxState()`). */
export interface FxStats {
  /** Effects intensity as set (0 … 1.5). */
  intensity: number;
  lightShowEnabled: boolean;
  /** Light show mode last requested by the game. */
  lightShow: FxLightShowMode;
  /** Mode actually shown: a running win / jackpot show, else the requested mode; `off` while disabled. */
  lightShowActive: FxLightShowMode;
  /** Live pooled particles (additive + normally blended). */
  live: number;
  liveAdditive: number;
  liveNormal: number;
  /** Instances drawn last frame, including beams, aura and aim helpers. */
  instances: number;
  /** Draw calls the effects issued last frame (0 … 2). */
  drawCalls: number;
  /** Pool capacity (fixed). */
  capacity: number;
  /** Spawns refused because a pool or batch was full (since start). */
  dropped: number;
  /** Light beams drawn last frame. */
  beams: number;
  /** A global flash is visible. */
  flash: boolean;
  /** Tier of the visible aura, or null. */
  aura: FxTier | null;
  /** Current extra LED energy (see `ledEnergy`). */
  ledEnergy: number;
  /** Running timed emitters (restock rain, call-to-action loop, firework volleys, …). */
  emitters: number;
  /** Particle count multiplier: decor budget × intensity × reduced motion (1 = Medium). */
  scale: number;
  reducedMotion: boolean;
}
