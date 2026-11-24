import type { FxTier, Vec3Like } from './api';
import { MODE, SHAPE, spriteCode } from './constants';
import { TIER_INDEX, type Rgb, type ThemePalettes } from './palette';
import type { SpriteBatch } from './SpriteBatch';

const HALO_CODE = spriteCode(SHAPE.GLOW, MODE.BILLBOARD);
const RING_CODE = spriteCode(SHAPE.RING, MODE.FLAT);
const RAINBOW_CODE = spriteCode(SHAPE.RAINBOW_RING, MODE.FLAT);
const STAR_CODE = spriteCode(SHAPE.STAR, MODE.BILLBOARD);
/** Orbiting sparkles per tier. */
export const AURA_SPARKLES: readonly number[] = [3, 5, 7, 10];
/** If the game stops calling `aura(pos)` the aura fades out after this many seconds. */
const STALE_SECONDS = 0.5;
export const AURA_RADIUS = 0.1;

const _c: Rgb = { r: 1, g: 1, b: 1 };
const _gold: Rgb = { r: 1, g: 0.6, b: 0.05 };

/**
 * Rarity aura around the toy being carried: a soft halo behind it, a ring around
 * it (two for epic and above, rainbow for legendary) and sparkles circling it,
 * coloured by tier (common white, rare blue, epic purple, legendary gold-rainbow; in a
 * brand-kit theme white → brand green, with the legendary sparkles cycling green and white).
 * Drawn as immediate instances of the additive batch; no pool entries.
 */
export class Aura {
  x = 0;
  y = 0;
  z = 0;
  tier: FxTier = 'common';
  /** Visibility 0..1 (fades in and out). */
  fade = 0;
  private requested = false;
  private sinceCall = 0;

  set(pos: Vec3Like | null, tier: FxTier | undefined): void {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) {
      this.requested = false;
      return;
    }
    if (!this.requested && this.fade < 0.01) this.sinceCall = 0;
    this.requested = true;
    this.sinceCall = 0;
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    if (tier && tier in TIER_INDEX) this.tier = tier;
  }

  /** Tier shown, or null when hidden. */
  visibleTier(): FxTier | null {
    return this.fade > 0.01 ? this.tier : null;
  }

  update(dt: number): void {
    this.sinceCall += dt;
    const want = this.requested && this.sinceCall < STALE_SECONDS ? 1 : 0;
    this.fade += (want - this.fade) * Math.min(1, dt * (want ? 9 : 6));
    if (want === 0 && this.fade < 0.01) this.fade = 0;
  }

  write(batch: SpriteBatch, pal: ThemePalettes, time: number, reducedMotion: boolean, lightScale: number): void {
    const k = this.fade * Math.min(1, lightScale);
    if (k <= 0.005) return;
    const t = TIER_INDEX[this.tier];
    const tierPal = pal.tiers[this.tier];
    const legendary = t === 3;
    // A brand-kit theme has no rainbow ring: the legendary rings keep the tier's (brand) colour.
    const ringCode = legendary && pal.rainbow ? RAINBOW_CODE : RING_CODE;
    const pulse = reducedMotion ? 1 : 1 + 0.08 * Math.sin(time * 4);
    tierPal.get(0, _c);
    // Halo slightly behind the toy: the toy hides its middle, so it reads as a glow around the silhouette.
    batch.push(this.x, this.y, this.z - 0.07, 0, 0, 0, _c.r, _c.g, _c.b, 0.28 * k * (legendary ? 1.3 : 1), 0.15 * pulse * (1 + 0.12 * t), 0, HALO_CODE, 0, 0.1);
    // Ring around the toy.
    batch.push(
      this.x, this.y - 0.05, this.z,
      time * 0.2, 0.16, 0,
      _c.r * 1.6, _c.g * 1.6, _c.b * 1.6, 0.65 * k,
      AURA_RADIUS * pulse, reducedMotion ? 0 : time * 1.5, ringCode, 0.7, 0.35,
    );
    if (t >= 2) {
      batch.push(
        this.x, this.y + 0.03, this.z,
        0.5 + time * 0.2, 0.12, 0,
        _c.r * 1.4, _c.g * 1.4, _c.b * 1.4, 0.4 * k,
        AURA_RADIUS * 0.75 * (2 - pulse), reducedMotion ? 0 : -time * 2, ringCode, 0.7, 0.35,
      );
    }
    // Sparkles circling the toy (static positions with reduced motion).
    const n = AURA_SPARKLES[t]!;
    const spin = reducedMotion ? 0 : time * (1.6 + 0.2 * t);
    for (let s = 0; s < n; s++) {
      const a = spin + (s * Math.PI * 2) / n;
      const rr = AURA_RADIUS + (reducedMotion ? 0 : 0.012 * Math.sin(time * 3 + s));
      const px = this.x + Math.cos(a) * rr;
      const pz = this.z + Math.sin(a) * rr * 0.8;
      const py = this.y - 0.02 + 0.04 * Math.sin((reducedMotion ? 0 : time * 2.2) + s * 1.7);
      if (legendary && pal.rainbow) {
        pal.hue(time * 0.25 + s / n, _c);
        _c.r = (_c.r + _gold.r) * 0.75;
        _c.g = (_c.g + _gold.g) * 0.75;
        _c.b = (_c.b + _gold.b) * 0.75;
      } else if (legendary) pal.hue(time * 0.25 + s / n, _c);
      else tierPal.get(s, _c);
      const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 9 + s * 2.1);
      batch.push(px, py, pz, 0, 0, 0, _c.r * 1.8, _c.g * 1.8, _c.b * 1.8, Math.min(1, k * tw), 0.02 * (1 + 0.1 * t), time * 0.5 + s, STAR_CODE, 0, 0.45);
    }
  }
}
