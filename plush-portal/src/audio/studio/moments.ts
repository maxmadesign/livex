/**
 * Pure decisions for the dramatic layer: how a character voices each moment, the per-
 * character cooldown, the generic squeak pitch, and which sounds make up a win of each tier.
 */
import type { CharacterMoment, SfxName, WinTier } from '../../core/contracts';

/** A character never repeats within this time (any moment). */
export const CHARACTER_COOLDOWN_MS = 2600;
/** Two different characters never start closer than this. */
export const CHARACTER_GAP_MS = 300;

export interface Voicing {
  /** Playback rate (speed and pitch). */
  rate: number;
  volume: number;
  /** Seconds after the call. */
  delay: number;
  /** Optional effect layered with the voice. */
  layer: { name: SfxName; delay: number; volume: number } | null;
}

/**
 * The same voice, coloured per moment: 'lift' natural, 'win' brighter / slightly higher with a
 * sparkle, 'slip' lower and a touch slower. `random` in [0, 1) adds a little life (±2 %).
 */
export function characterVoicing(moment: CharacterMoment, random: () => number): Voicing {
  const wobble = 1 + (random() * 2 - 1) * 0.02;
  switch (moment) {
    case 'lift':
      return { rate: 1.0 * wobble, volume: 0.85, delay: 0.05, layer: null };
    case 'win':
      return { rate: 1.12 * wobble, volume: 1.0, delay: 0.35, layer: { name: 'sparkle', delay: 0.42, volume: 0.6 } };
    case 'slip':
      return { rate: 0.86 * wobble, volume: 0.9, delay: 0.06, layer: null };
  }
}

/**
 * Moments in rising importance. Within its cooldown a character may still escalate to a more
 * important moment: a toy that slips 0.4–1.8 s after it was lifted (measured in headless rounds)
 * must still cry out, and a toy that slipped but bounced into the chute still cheers.
 */
export const MOMENT_RANK: Record<CharacterMoment, number> = { lift: 0, slip: 1, win: 2 };

/**
 * Per-character cooldown plus a short gap between different characters; `allow` records the
 * start when it says yes. Within the cooldown only a more important moment gets through (the
 * engine then cuts the character's previous voice, so the two never pile up).
 */
export class CooldownGate {
  private readonly last = new Map<string, { at: number; rank: number }>();
  private lastAny = -Infinity;
  private lastKey: string | null = null;

  constructor(
    private readonly cooldownMs = CHARACTER_COOLDOWN_MS,
    private readonly gapMs = CHARACTER_GAP_MS,
  ) {}

  allow(key: string, now: number, moment: CharacterMoment = 'lift'): boolean {
    const rank = MOMENT_RANK[moment] ?? 0;
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev.at < this.cooldownMs && rank <= prev.rank) return false;
    if (key !== this.lastKey && now - this.lastAny < this.gapMs) return false;
    this.last.set(key, { at: now, rank });
    this.lastAny = now;
    this.lastKey = key;
    return true;
  }

  reset(): void {
    this.last.clear();
    this.lastAny = -Infinity;
    this.lastKey = null;
  }
}

/** Stable pitch (0.82 … 1.24) of the generic squeak for a character without its own voice. */
export function squeakPitch(assetId: string): number {
  let h = 2166136261;
  for (let i = 0; i < assetId.length; i++) h = Math.imul(h ^ assetId.charCodeAt(i), 16777619);
  const u = ((h >>> 0) % 1000) / 999;
  return 0.82 + u * 0.42;
}

export type WinPart =
  | { kind: 'stinger'; which: 'win' | 'jackpot'; delay: number; volume: number }
  | { kind: 'sfx'; name: SfxName; delay: number; volume: number };

/** How far the music is turned down under a win (gain multiplier) and for how long after the stinger. */
export const WIN_DUCK: Record<WinTier, number> = { common: 0.5, rare: 0.45, epic: 0.35, legendary: 0.22 };

/**
 * Light music duck (gain multiplier) under a lift / slip cry. Measured in the built app at the
 * default volumes, a lift voice's loudest 400 ms (−19.7 dBFS) only matched the music's (−19.2),
 * while the claw and winch sound at the same moment; −3 dB on the music lets the character through.
 * A win's own (deeper) duck is never touched.
 */
export const CHARACTER_DUCK = 0.7;

/**
 * A recorded character voice shorter than this (seconds) is only a blip (storybook.astronaut
 * 0.10 s, sakura.tanuki 0.26 s, gpu.bot 0.35 s): the character's own squeak is layered under it.
 */
export const SHORT_VOICE_S = 0.4;

/**
 * The sounds of a win. With the studio stingers: common = theme win stinger; rare = + sparkle;
 * epic = + firework + confetti; legendary = theme jackpot fanfare + jackpot bells + firework.
 * Without them the synthesised theme jingle (`win`) takes the stinger's place; every layer is an
 * effect name, so it has a synthesised fallback too.
 */
export function winPlan(tier: WinTier, available: { win: boolean; jackpot: boolean }): WinPart[] {
  const stinger = (which: 'win' | 'jackpot'): WinPart =>
    available[which]
      ? { kind: 'stinger', which, delay: 0, volume: 1 }
      : available.win
        ? { kind: 'stinger', which: 'win', delay: 0, volume: 1 }
        : { kind: 'sfx', name: 'win', delay: 0, volume: 1 };
  switch (tier) {
    case 'common':
      return [stinger('win')];
    case 'rare':
      return [stinger('win'), { kind: 'sfx', name: 'sparkle', delay: 0.12, volume: 0.9 }];
    case 'epic':
      return [stinger('win'), { kind: 'sfx', name: 'confetti', delay: 0.05, volume: 1 }, { kind: 'sfx', name: 'firework', delay: 0.25, volume: 1 }];
    case 'legendary':
      return [stinger('jackpot'), { kind: 'sfx', name: 'jackpot', delay: 0.1, volume: 1 }, { kind: 'sfx', name: 'firework', delay: 0.45, volume: 1 }];
  }
}

/** Attract chime period: a fresh random interval in [20, 30) seconds. */
export function attractChimeDelayMs(random: () => number): number {
  return 20_000 + random() * 10_000;
}
