import { Group, type Vector3 } from 'three';
import { makeRng } from '../core/math';
import { CHUTE } from '../physics/fieldSpec';
import type { ThemeDef } from '../themes/themes';
import { logoKeepOut, WALL_Z } from './brandScene';
import type { FxApi, FxBurstKind, FxStats, FxTier, Vec3Like } from './fx/api';
import { AURA_RADIUS, Aura } from './fx/Aura';
import { ambientTarget, lightScale, particleScale } from './fx/budget';
import {
  ADDITIVE_IMMEDIATE,
  ADDITIVE_POOL,
  BEH,
  FAMILY,
  FAMILY_NAMES,
  type FamilyName,
  MODE,
  NORMAL_IMMEDIATE,
  NORMAL_POOL,
  SHAPE,
  spriteCode,
} from './fx/constants';
import { LightShow, type LightShowMode } from './fx/LightShow';
import { ColorCache, type Palette, type Rgb, TIER_INDEX, ThemePalettes, mixRgb } from './fx/palette';
import { ParticlePool, SHELL_EVENT_STRIDE, TRAIL_EVENT_STRIDE } from './fx/ParticlePool';
import { FxRecipes, WHITE } from './fx/recipes';
import { SpriteBatch } from './fx/SpriteBatch';

export type { LightShowMode };

const TAU = Math.PI * 2;

/** Timed emitters (restock rain, call-to-action loop, confetti rain, firework volleys, delayed rings). */
const EMIT = { RESTOCK: 1, CTA: 2, CONFETTI_RAIN: 3, SHELLS: 4, RING: 5 } as const;
const MAX_EMITTERS = 16;

class Emitter {
  active = false;
  kind = 0;
  age = 0;
  duration = 1;
  x = 0;
  y = 0;
  z = 0;
  acc = 0;
  step = 0;
  /** Particle scale captured when the emitter started. */
  scale = 1;
  tier = 0;
  /** Use the tier palette instead of the theme palette. */
  tierColors = false;
  readonly rgb: Rgb = { r: 1, g: 1, b: 1 };
}

/** Firework launch times (s after the celebration) for epic and legendary; fewer with reduced motion. */
const SHELL_TIMES: readonly (readonly number[])[] = [[], [], [0.15, 0.5, 0.85], [0.1, 0.35, 0.6, 1.0, 1.35, 1.8, 2.3]];
const SHELL_TIMES_REDUCED: readonly (readonly number[])[] = [[], [], [0.2], [0.2, 0.9]];
/** Count multiplier of a celebration per tier. */
const TIER_MULT: readonly number[] = [1, 1.25, 1.5, 2];
const FLASH_BY_TIER: readonly number[] = [0, 0.45, 0.6, 0.7];
/** Aura trail sparkles per second by tier (at scale 1). */
const AURA_TRAIL_RATE: readonly number[] = [0, 4, 10, 18];

/** Shapes whose extra0 is the cosine of their flip angle. */
const FLIP_SHAPES = new Uint8Array(32);
for (const shape of [SHAPE.CONFETTI, SHAPE.PETAL, SHAPE.PAPER_STAR, SHAPE.COIN]) FLIP_SHAPES[shape] = 1;
const RING_CODE = spriteCode(SHAPE.RING, MODE.FLAT);
const DISC_CODE = spriteCode(SHAPE.DISC, MODE.FLAT);
const LINE_CODE = spriteCode(SHAPE.LINE, MODE.AXIAL);
const STAR_CODE = spriteCode(SHAPE.STAR, MODE.BILLBOARD);
const GLOW_CODE = spriteCode(SHAPE.GLOW, MODE.BILLBOARD);

/** Height of the chute mouth (top of its clear guard walls): rings and shockwaves sit there. */
const MOUTH_Y = CHUTE.wallHeight + 0.012;

function inChute(x: number, z: number): boolean {
  return x < CHUTE.xMax && x > CHUTE.xMin - 0.05 && z > CHUTE.zMin && z < CHUTE.zMax + 0.05;
}

/**
 * Where a burst at (x, y, z) should start: positions inside the chute or the bin below the
 * floor (the game's prize exit point) are lifted to just above the floor so the effect is seen.
 */
function originY(x: number, y: number, z: number): number {
  return inChute(x, z) ? Math.max(y, 0.06) : y;
}

/** Brightness 0..1 of a theme's cabinet, from its UI paper colour (pastel themes ≈ 0.9, dark ≈ 0.1). */
export function themeBrightness(theme: ThemeDef | null): number {
  if (!theme) return 0.5;
  const hex = theme.ui.paper.replace('#', '');
  const v = Number.parseInt(hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex.slice(0, 6), 16);
  if (!Number.isFinite(v)) return 0.5;
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

/** Cover gain for light sprites: bright cabinets need light that also hides a little of the background. */
function coverGainOf(brightness: number): number {
  return clamp(0.35 + brightness * 0.8, 0.4, 1.1);
}

function finite(p: Vec3Like | null | undefined): p is Vec3Like {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Presentation-only effects (src/scene/fx/api.ts): particle bursts and
 * celebrations, the rarity aura of the held toy, the light show, the aim
 * reticle / beam and a few ambient motes of the theme motif.
 *
 * Everything is drawn by two instanced sprite batches with one shared shader
 * program: additive light (sparkles, sparks, rings, beams, aura, bubbles, data
 * bits, aim helpers) and normally blended paper (confetti, petals, paper stars,
 * coins, dust puffs). Particles live in two fixed-size pools; nothing is
 * allocated per frame and nothing here touches physics or input.
 */
export class Effects implements FxApi {
  readonly group = new Group();
  reducedMotion = false;
  /** Hints selected in the gameplay settings. */
  showReticle = true;
  showBeam = true;

  private readonly addPool = new ParticlePool(ADDITIVE_POOL);
  private readonly normPool = new ParticlePool(NORMAL_POOL);
  private readonly addBatch = new SpriteBatch(ADDITIVE_POOL + ADDITIVE_IMMEDIATE, 'light', 31, 'light');
  private readonly normBatch = new SpriteBatch(NORMAL_POOL + NORMAL_IMMEDIATE, 'paper', 30, 'paper');
  private readonly light = new LightShow();
  private readonly auraFx = new Aura();
  private readonly emitters: Emitter[] = [];
  private readonly colorCache = new ColorCache();
  private readonly rng = makeRng(1234);
  private pal = new ThemePalettes(null);
  private readonly rec: FxRecipes;
  private theme: ThemeDef | null = null;
  private budget = 60;
  private fxIntensity = 1;
  private lightShowEnabled = true;
  private time = 0;
  private auraTrailAcc = 0;
  private aimRing = false;
  private aimBeam = false;
  private aimX = 0;
  private aimZ = 0;
  private aimHitY = 0;
  private aimTopY = 0;
  private readonly tierRgb: Rgb = { r: 1, g: 1, b: 1 };
  private readonly tmpRgb: Rgb = { r: 1, g: 1, b: 1 };
  private readonly focus = { x: 0, y: 0, z: 0 };

  constructor() {
    this.group.name = 'effects';
    this.group.add(this.normBatch.mesh, this.addBatch.mesh);
    for (let i = 0; i < MAX_EMITTERS; i++) this.emitters.push(new Emitter());
    this.rec = new FxRecipes(this.addPool, this.normPool, this.rng, this.pal);
  }

  /* --------------------------------------------------------------- setup */

  setTheme(theme: ThemeDef): void {
    this.theme = theme;
    this.pal = new ThemePalettes(theme);
    this.rec.pal = this.pal;
    const brightness = themeBrightness(theme);
    this.addBatch.setCoverGain(coverGainOf(brightness));
    // A brand kit's logo on the back wall: light passes around it, never over it (paper confetti
    // is a physical object like the toys and may still fly in front of it).
    this.addBatch.setKeepOut(logoKeepOut(theme), WALL_Z + 0.008);
    this.addBatch.setWhiteCores(!this.pal.rainbow);
    this.normBatch.setWhiteCores(!this.pal.rainbow);
    this.light.brightness = brightness;
    this.addPool.clear();
    this.normPool.clear();
    for (const e of this.emitters) e.active = false;
  }

  /** `count` is the decorative particle budget from the graphics settings (0..300). */
  setBudget(count: number): void {
    this.budget = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  }

  /** Kept for the game's resize hook; sprites are sized in world units, so nothing depends on it. */
  setViewportHeight(_pixels: number): void {}

  setIntensity(intensity: number): void {
    this.fxIntensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;
  }

  setLightShowEnabled(enabled: boolean): void {
    this.lightShowEnabled = enabled;
    this.light.enabled = enabled;
  }

  private particleScale(): number {
    return particleScale(this.budget, this.fxIntensity, this.reducedMotion);
  }

  private lightScale(): number {
    return lightScale(this.fxIntensity);
  }

  /** Configures the recipes for one call. */
  private prepare(countMul: number, sizeMul: number): FxRecipes {
    const rec = this.rec;
    rec.scale = this.particleScale() * countMul;
    rec.sizeK = sizeMul;
    rec.reducedMotion = this.reducedMotion;
    rec.lights = this.lightScale() > 0;
    return rec;
  }

  /* ------------------------------------------------------------- FxApi */

  burst(kind: FxBurstKind, pos: Vec3Like, opts?: { tier?: FxTier; scale?: number; color?: string }): void {
    if (!finite(pos)) return;
    const mul = opts?.scale !== undefined && Number.isFinite(opts.scale) ? clamp(opts.scale, 0.25, 3) : 1;
    const rec = this.prepare(mul, clamp(Math.sqrt(mul), 0.6, 1.6));
    const tier = opts?.tier && opts.tier in TIER_INDEX ? opts.tier : null;
    const custom = opts?.color ? this.colorCache.get(opts.color) : null;
    const tierPal = tier ? this.pal.tiers[tier] : null;
    const { x, y, z } = pos;
    switch (kind) {
      case 'grab': {
        // A small spark where the claw closes.
        const c = custom ?? (tierPal ? tierPal.get(0, this.tierRgb) : this.pal.glow);
        rec.colors(null, c).sparks(x, y, z, rec.n(10), 0.5, 0.9, false, 0.25, 0.4, 0.005, 0.05, -1.5, 4);
        rec.glowPop(x, y, z, 0.02, 0.07, 0.25, c, 0.6);
        rec.ring(x, y, z, 0.03, 0.1, 0.35, c, 0.55, 0.2);
        break;
      }
      case 'contact':
        // A puff of plush fluff and a couple of glints.
        rec.puffs(x, y, z, rec.n(6), custom ?? this.pal.fluff, 0.55, false);
        rec.colors(tierPal ?? this.pal.particles, custom).sparkles(x, y, z, rec.n(4), 0.1, 0.35, 0.05, 0.2, 0.35, 0.55, 0.008, 0.012, -0.5, 3);
        break;
      case 'lift':
        // Sparkles rising with the toy, plus a few upward streaks.
        rec.colors(tierPal ?? this.pal.ui, custom).sparkles(x, y, z, rec.n(14), 0.35, 0.7, 0.03, 0.15, 0.8, 1.2, 0.01, 0.018, 0.15, 1.5);
        rec.sparks(x, y - 0.03, z, rec.n(6), 0.8, 1.1, true, 0.3, 0.5, 0.004, 0.05, -0.5, 2);
        break;
      case 'slip': {
        // Sad grey dust and a few sparks fizzling down.
        const dust = mixRgb(this.tmpRgb, this.pal.fluff, this.pal.dust, 0.55);
        rec.puffs(x, y, z, rec.n(8), custom ?? dust, 0.45, true);
        rec.colors(null, this.pal.fizzle).sparks(x, y, z, rec.n(5), 0.15, 0.35, false, 0.5, 0.8, 0.003, 0.04, -1.2, 1.5, FAMILY.SPARK, false, 1.2);
        break;
      }
      case 'drop': {
        // Splash at the exit: a crown of streaks, a ring and the theme motif.
        const oy = Math.max(originY(x, y, z), 0.02);
        const ry = inChute(x, z) ? MOUTH_Y : oy + 0.006;
        rec.colors(tierPal ?? this.pal.particles, custom).sparks(x, oy, z, rec.n(18), 0.9, 1.3, true, 0.5, 0.8, 0.006, 0.05, -2.6, 2.2);
        rec.ring(x, ry, z, 0.03, 0.2, 0.5, custom ?? this.pal.primary, 0.7);
        rec.motif(x, oy, z, rec.n(10), 0);
        break;
      }
      case 'restock': {
        // Sparkle rain from the top of the cabinet.
        const e = this.startEmitter(EMIT.RESTOCK, x, y, z, 1.4);
        e.tierColors = !!tierPal;
        e.tier = tier ? TIER_INDEX[tier] : 0;
        rec.motif(x, y, z, rec.n(8), 1);
        break;
      }
      case 'combo': {
        // Flames swirling up around the point.
        const oy = inChute(x, z) ? Math.max(y, MOUTH_Y - 0.04) : y;
        rec.flameSwirl(x, oy, z, rec.n(26));
        rec.ring(x, oy - 0.04, z, 0.05, 0.16, 0.6, custom ?? this.pal.flameB, 0.6);
        rec.colors(null, custom ?? this.pal.flameB).sparks(x, oy, z, rec.n(6), 0.5, 0.8, true, 0.4, 0.6, 0.005, 0.05, -0.8, 2);
        break;
      }
      case 'score':
        rec.coins(x, originY(x, y, z), z, rec.n(8));
        break;
      case 'cta': {
        // Inviting loop: circling sparkles, rising motes and slow ring pulses for ~2.8 s.
        let e: Emitter | null = null;
        for (const other of this.emitters) {
          if (other.active && other.kind === EMIT.CTA && Math.abs(other.x - x) + Math.abs(other.z - z) < 0.05) e = other;
        }
        if (e) {
          // Extend the running loop; ring pulses carry on from the rewound age.
          e.age = Math.min(e.age, 0.3);
          e.step = Math.floor(e.age / 0.9) + 1;
        } else e = this.startEmitter(EMIT.CTA, x, y, z, 2.8);
        e.duration = 2.8;
        e.scale = rec.scale;
        rec.colors(tierPal ?? this.pal.ui, custom).sparkles(x, y, z, rec.n(10), 0.3, 0.6, 0.1, 0.3, 0.6, 1, 0.012, 0.02, -0.4, 2);
        break;
      }
    }
  }

  celebrate(tier: FxTier, pos: Vec3Like): void {
    if (!finite(pos)) return;
    const t = tier in TIER_INDEX ? TIER_INDEX[tier] : 0;
    const tierName: FxTier = tier in TIER_INDEX ? tier : 'common';
    const m = TIER_MULT[t]!;
    const rec = this.prepare(1, 1);
    const x = pos.x;
    const z = pos.z;
    // Bursts erupt from the chute mouth; rings sit on top of its guard walls.
    const oy = Math.max(originY(x, pos.y, z), 0.02);
    const ry = inChute(x, z) ? MOUTH_Y : oy + 0.01;
    const tierPal = this.pal.tiers[tierName];
    const tc = tierPal.get(0, this.tierRgb);
    // Every tier: glow, sparkle burst, confetti cannon and the theme motif.
    rec.glowPop(x, oy + 0.04, z, 0.06, 0.22 + 0.03 * t, 0.45, tc, 0.9);
    rec.colors(tierPal).sparkles(x, oy, z, rec.n(32 * m), 0.9, 1.7 + 0.2 * t, 0.15, 0.55, 1, 1.8, 0.016, 0.03, -0.9, 2);
    rec.confetti(x, oy, z, rec.n(56 * m), 2.4, 3.2, 0.5, this.pal.confetti, t >= 1 ? tierPal : null);
    rec.motif(x, oy, z, rec.n(20 * m), 0);
    if (t >= 1) {
      // Rare: shockwave rings (one around the chute mouth, one facing the player), radial sparks and a flash.
      rec.ring(x, ry, z, 0.05, 0.3, 0.7, tc, 0.85, 0.12);
      rec.ring(x, ry + 0.02, z - 0.02, 0.05, 0.3 + 0.03 * t, 0.6, tc, 0.75, 0.09, false, 0.5, true);
      const e = this.startEmitter(EMIT.RING, x, ry + 0.002, z, 0.14);
      e.rgb.r = tc.r;
      e.rgb.g = tc.g;
      e.rgb.b = tc.b;
      rec.colors(tierPal).sparks(x, oy, z, rec.n(20 * m), 0.7, 1.2, true, 0.4, 0.7, 0.007, 0.06, -1.2, 2.2);
      if (this.lightScale() > 0) this.light.flash(FLASH_BY_TIER[t]!, tc, this.time, this.reducedMotion);
    }
    if (t >= 2) {
      // Epic: fireworks, star-burst rays and the light show.
      const e = this.startEmitter(EMIT.SHELLS, x, oy, z, 3);
      e.tier = t;
      rec.colors(tierPal).rays(x, ry, z, rec.n(t === 3 ? 24 : 12), 0.34, 0.8, 0.55);
      this.focus.x = x;
      this.focus.y = ry;
      this.focus.z = z;
      this.light.trigger(t === 3 ? 'jackpot' : 'win', this.focus, tc, this.time, this.reducedMotion);
    }
    if (t >= 3) {
      // Legendary: rainbow ring, coin fountain, confetti and gold rain over the whole cabinet.
      rec.ring(x, ry + 0.004, z, 0.05, 0.3, 1.2, WHITE, 0.9, 0.16, true);
      rec.coins(x, oy, z, rec.n(14));
      this.startEmitter(EMIT.CONFETTI_RAIN, 0, 0.93, -0.4, 2.2).tier = t;
      const rain = this.startEmitter(EMIT.RESTOCK, 0, 0.93, -0.4, 2.6);
      rain.tierColors = true;
      rain.tier = t;
    }
  }

  aura(pos: Vec3Like | null, tier?: FxTier): void {
    this.auraFx.set(pos, tier);
  }

  lightShow(mode: LightShowMode): void {
    this.light.set(mode, this.time, this.reducedMotion);
  }

  /** Extra energy (0..1) for the cabinet LED strips while the light show runs. */
  ledEnergy(): number {
    return this.light.ledEnergy(this.lightScale());
  }

  /**
   * Compatibility with the first version (the game called this when a prize was won):
   * a common celebration. Prefer `celebrate(tier, pos)`.
   */
  prizeBurst(origin: Vector3, strength = 1): void {
    void strength;
    this.celebrate('common', origin);
  }

  /* ---------------------------------------------------------------- aim */

  /**
   * Aim helper. `visible` only while the player may aim; (x, z) is the claw
   * axis, `hitY` the height of whatever is under it, `clawY` the palm height.
   */
  setAim(visible: boolean, x: number, z: number, hitY: number, clawY: number): void {
    this.aimRing = visible && this.showReticle;
    this.aimBeam = visible && this.showBeam;
    this.aimX = x;
    this.aimZ = z;
    this.aimHitY = hitY;
    this.aimTopY = clawY - 0.2;
  }

  /* ------------------------------------------------------------- update */

  update(dt: number): void {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += dt;
    const time = this.time;
    const rm = this.reducedMotion;
    this.light.enabled = this.lightShowEnabled;
    if (dt > 0) {
      this.updateEmitters(dt);
      this.updateAmbient(dt);
      this.updateAuraTrail(dt);
    }
    this.addPool.simulate(dt, time);
    this.normPool.simulate(dt, time);
    if (dt > 0) this.processShells(dt);
    this.light.update(dt, time, rm);
    this.auraFx.update(dt);
    this.write();
  }

  private write(): void {
    const time = this.time;
    const rm = this.reducedMotion;
    const ls = this.lightScale();
    const add = this.addBatch;
    const norm = this.normBatch;
    add.begin();
    norm.begin();
    this.writePool(this.normPool, norm);
    this.writePool(this.addPool, add);
    this.light.write(add, this.pal, time, rm, ls);
    this.auraFx.write(add, this.pal, time, rm, ls);
    this.writeCta(add, ls);
    this.writeAim(add);
    // The shader clock wraps to keep float precision; nothing animates across the wrap for long.
    const clock = time % 2048;
    add.end(clock);
    norm.end(clock);
  }

  private writePool(pool: ParticlePool, batch: SpriteBatch): void {
    const time = this.time;
    const rm = this.reducedMotion;
    for (let i = 0; i < pool.count; i++) {
      const maxLife = pool.maxLife[i]!;
      const life = pool.life[i]!;
      const age = maxLife - life;
      const u = Math.min(1, age / maxLife);
      let a = pool.a[i]!;
      const fi = pool.fadeIn[i]!;
      if (fi > 0 && age < fi) a *= age / fi;
      const fo = pool.fadeOut[i]! * maxLife;
      if (fo > 0 && life < fo) a *= life / fo;
      const tw = pool.twinkle[i]!;
      if (tw > 0 && !rm) a *= 0.55 + 0.45 * Math.sin(time * tw + pool.seed[i]!);
      if (a < 0.003) continue;
      const shape = pool.shape[i]!;
      const mode = pool.mode[i]!;
      const code = shape + mode * 32;
      const s0 = pool.size0[i]!;
      const s1 = pool.size1[i]!;
      const v = 1 - u;
      const ease = 1 - v * v * v;
      const x = pool.px[i]!;
      const y = pool.py[i]!;
      const z = pool.pz[i]!;
      if (mode === MODE.AXIAL) {
        if (pool.beh[i] === BEH.RAY) {
          const len = s1 * ease;
          batch.push(x, y, z, pool.vx[i]! * len, pool.vy[i]! * len, pool.vz[i]! * len, pool.r[i]!, pool.g[i]!, pool.b[i]!, a, s0 * 0.5, pool.seed[i]!, code, s0, pool.cover[i]!);
        } else {
          const st = pool.stretch[i]!;
          let ax = pool.vx[i]! * st;
          let ay = pool.vy[i]! * st;
          let az = pool.vz[i]! * st;
          const l2 = ax * ax + ay * ay + az * az;
          if (l2 < 1.6e-5) {
            // Keep slow streaks at least 4 mm long so they read as glints, not slivers.
            const l = Math.sqrt(l2);
            if (l > 1e-6) {
              const k = 0.004 / l;
              ax *= k;
              ay *= k;
              az *= k;
            } else ay = 0.004;
          }
          const size = s0 + (s1 - s0) * ease;
          batch.push(x - ax, y - ay, z - az, ax, ay, az, pool.r[i]!, pool.g[i]!, pool.b[i]!, a, size * 0.3, pool.seed[i]!, code, size, pool.cover[i]!);
        }
      } else {
        const size = s0 + (s1 - s0) * ease;
        const e0 = FLIP_SHAPES[shape] ? Math.cos(pool.flip[i]!) : pool.extra0[i]!;
        batch.push(x, y, z, e0, pool.extra1[i]!, 0, pool.r[i]!, pool.g[i]!, pool.b[i]!, a, size, pool.rot[i]!, code, pool.aux[i]!, pool.cover[i]!);
      }
    }
  }

  private writeAim(batch: SpriteBatch): void {
    if (!this.aimRing && !this.aimBeam) return;
    const t = this.pal.tint;
    if (this.aimRing) {
      const y = this.aimHitY + 0.006;
      const pulse = this.reducedMotion ? 1 : 1 + 0.08 * Math.sin(this.time * 5);
      const alpha = 0.85 * (this.reducedMotion ? 0.8 : 0.7 + 0.2 * Math.sin(this.time * 5));
      // Ring 36–44 mm (band = 18 % of the outer radius) and a 7 mm dot, as before.
      batch.push(this.aimX, y, this.aimZ, 0, 0.18, 0, t.r, t.g, t.b, alpha, 0.044 * pulse, 0, RING_CODE, 0, 0);
      batch.push(this.aimX, y, this.aimZ, 0, 0, 0, t.r, t.g, t.b, 0.85, 0.007, 0, DISC_CODE, 0, 0);
    }
    if (this.aimBeam) {
      const length = Math.max(0.01, this.aimTopY - this.aimHitY);
      batch.push(this.aimX, this.aimHitY, this.aimZ, 0, length, 0, t.r, t.g, t.b, 0.16, 0.0022, 0, LINE_CODE, 0.0022, 0);
    }
  }

  /** Circling sparkles and a soft pulsing glow of the call-to-action loop. */
  private writeCta(batch: SpriteBatch, ls: number): void {
    if (!(ls > 0)) return;
    const time = this.time;
    const rm = this.reducedMotion;
    for (let k = 0; k < this.emitters.length; k++) {
      const e = this.emitters[k]!;
      if (!e.active || e.kind !== EMIT.CTA) continue;
      const env = Math.min(1, e.age / 0.3) * Math.min(1, (e.duration - e.age) / 0.5) * Math.min(1, ls);
      if (env <= 0.01) continue;
      const pulse = rm ? 1 : 0.75 + 0.25 * Math.sin(time * 3.2);
      this.pal.ui.get(0, this.tmpRgb);
      batch.push(e.x, e.y, e.z - 0.02, 0, 0, 0, this.tmpRgb.r, this.tmpRgb.g, this.tmpRgb.b, 0.22 * env * pulse, 0.09, 0, GLOW_CODE, 0, 0.1);
      const n = 8;
      const spin = rm ? 0 : time * 2;
      for (let s = 0; s < n; s++) {
        const a = spin + (s * TAU) / n;
        const px = e.x + Math.cos(a) * 0.11;
        const pz = e.z + Math.sin(a) * 0.11 * 0.8;
        const py = e.y + (rm ? 0 : 0.03 * Math.sin(time * 3 + s));
        this.pal.ui.get(s, this.tmpRgb, 1.8);
        const tw = rm ? 1 : 0.55 + 0.45 * Math.sin(time * 8 + s * 1.9);
        batch.push(px, py, pz, 0, 0, 0, this.tmpRgb.r, this.tmpRgb.g, this.tmpRgb.b, env * tw, 0.02, time + s, STAR_CODE, 0, 0.45);
      }
    }
  }

  /* ------------------------------------------------------------ emitters */

  private startEmitter(kind: number, x: number, y: number, z: number, duration: number): Emitter {
    let e: Emitter | null = null;
    let oldest = -1;
    for (const candidate of this.emitters) {
      if (!candidate.active) {
        e = candidate;
        break;
      }
      const progress = candidate.age / Math.max(0.001, candidate.duration);
      if (progress > oldest) {
        oldest = progress;
        e = candidate;
      }
    }
    const em = e!;
    em.active = true;
    em.kind = kind;
    em.age = 0;
    em.duration = duration;
    em.x = x;
    em.y = y;
    em.z = z;
    em.acc = 0;
    em.step = 0;
    em.scale = this.rec.scale;
    em.tier = 0;
    em.tierColors = false;
    em.rgb.r = em.rgb.g = em.rgb.b = 1;
    return em;
  }

  private updateEmitters(dt: number): void {
    const rec = this.rec;
    rec.reducedMotion = this.reducedMotion;
    rec.lights = this.lightScale() > 0;
    rec.sizeK = 1;
    for (let k = 0; k < this.emitters.length; k++) {
      const e = this.emitters[k]!;
      if (!e.active) continue;
      e.age += dt;
      rec.scale = e.scale;
      switch (e.kind) {
        case EMIT.RESTOCK: {
          const palette: Palette = e.tierColors ? this.pal.tiers[tierName(e.tier)] : this.pal.particles;
          e.acc += dt * 36 * e.scale;
          while (e.acc >= 1) {
            e.acc -= 1;
            rec.rainSparkle(e.x, e.z, 0.32, 0.3, palette);
          }
          break;
        }
        case EMIT.CTA: {
          e.acc += dt * 9 * e.scale;
          while (e.acc >= 1) {
            e.acc -= 1;
            rec.ctaMote(e.x, e.y, e.z, 0.11);
          }
          const pulse = Math.floor(e.age / 0.9);
          if (pulse >= e.step && e.age < e.duration - 0.4) {
            e.step = pulse + 1;
            rec.ring(e.x, e.y - 0.03, e.z, 0.04, 0.17, 0.8, this.pal.primary, 0.6, 0.14);
          }
          break;
        }
        case EMIT.CONFETTI_RAIN: {
          e.acc += dt * 70 * e.scale;
          const tierPal = this.pal.tiers[tierName(e.tier)];
          while (e.acc >= 1) {
            e.acc -= 1;
            rec.confetti(rec.rand(-0.45, 0.45), 0.93, rec.rand(-0.72, -0.08), 1, -0.25, 0, 0.12, this.pal.confetti, tierPal);
          }
          break;
        }
        case EMIT.SHELLS: {
          const times = (this.reducedMotion ? SHELL_TIMES_REDUCED : SHELL_TIMES)[e.tier] ?? [];
          while (e.step < times.length && e.age >= times[e.step]!) {
            this.launchShell(e, e.step);
            e.step++;
          }
          if (e.step >= times.length) e.active = false;
          break;
        }
        case EMIT.RING:
          if (e.age >= e.duration) rec.ring(e.x, e.y, e.z, 0.03, 0.24, 0.6, e.rgb, 0.7, 0.1);
          break;
      }
      if (e.age >= e.duration) e.active = false;
    }
  }

  private launchShell(e: Emitter, index: number): void {
    const rec = this.rec;
    const toward = e.x < 0 ? 1 : -1;
    const x = clamp(e.x + toward * rec.rand(0.1, 0.65), -0.42, 0.42);
    const z = rec.rand(-0.62, -0.22);
    const legendary = e.tier >= 3;
    const rainbow = legendary && index % 2 === 0;
    const palette = index % 3 === 2 ? this.pal.ui : this.pal.tiers[tierName(e.tier)];
    palette.get(index, this.tmpRgb);
    rec.shell(x, 0.06, z, rec.rand(1.7, 2), this.tmpRgb, legendary ? 1.2 : 1, rainbow);
  }

  /** Firework bursts and shell trails recorded by the additive pool's last step. */
  private processShells(dt: number): void {
    const pool = this.addPool;
    if (pool.shellEventCount === 0 && pool.trailEventCount === 0) return;
    const rec = this.prepare(1, 1);
    const ev = pool.shellEvents;
    const bursts = pool.shellEventCount;
    const trails = pool.trailEventCount;
    for (let k = 0; k < bursts; k++) {
      const o = k * SHELL_EVENT_STRIDE;
      this.tmpRgb.r = ev[o + 3]! / 2;
      this.tmpRgb.g = ev[o + 4]! / 2;
      this.tmpRgb.b = ev[o + 5]! / 2;
      rec.shellBurst(ev[o]!, ev[o + 1]!, ev[o + 2]!, this.tmpRgb, ev[o + 6]! || 1, ev[o + 7]! > 0.5);
    }
    if (rec.scale <= 0) return;
    const tr = pool.trailEvents;
    const per = Math.max(1, Math.round(dt * 45 * Math.min(1.5, rec.scale)));
    for (let k = 0; k < trails; k++) {
      const o = k * TRAIL_EVENT_STRIDE;
      this.tmpRgb.r = tr[o + 3]! / 2;
      this.tmpRgb.g = tr[o + 4]! / 2;
      this.tmpRgb.b = tr[o + 5]! / 2;
      for (let j = 0; j < per; j++) {
        const back = (dt * j) / per;
        rec.trail(tr[o]! - tr[o + 6]! * back, tr[o + 1]! - tr[o + 7]! * back, tr[o + 2]! - tr[o + 8]! * back, this.tmpRgb, 0.007, 0.4, 0.7);
      }
    }
  }

  /** A few slow motes of the theme motif in the upper part of the cabinet (decor budget). */
  private updateAmbient(dt: number): void {
    const want = ambientTarget(this.budget, this.reducedMotion);
    if (want <= 0) return;
    const motif = this.pal.motif;
    const pool = motif === 'petals' || motif === 'paper' ? this.normPool : this.addPool;
    if (this.rng() >= dt * 6) return;
    if (pool.countTag(FAMILY.AMBIENT) >= want) return;
    this.rec.reducedMotion = this.reducedMotion;
    this.rec.ambientMote();
  }

  /** Sparkle dust shed by the aura of rare and better toys. */
  private updateAuraTrail(dt: number): void {
    const tier = this.auraFx.visibleTier();
    if (!tier || this.reducedMotion) {
      this.auraTrailAcc = 0;
      return;
    }
    const t = TIER_INDEX[tier];
    const scale = Math.min(2, this.particleScale());
    this.auraTrailAcc += dt * AURA_TRAIL_RATE[t]! * scale * this.auraFx.fade;
    if (this.auraTrailAcc < 1) return;
    const rec = this.prepare(1, 1);
    const palette = this.pal.tiers[tier];
    while (this.auraTrailAcc >= 1) {
      this.auraTrailAcc -= 1;
      const a = this.rng() * TAU;
      palette.get(Math.floor(this.rng() * palette.size), this.tmpRgb, 1.5);
      rec.trail(
        this.auraFx.x + Math.cos(a) * AURA_RADIUS,
        this.auraFx.y - 0.02 + (this.rng() - 0.5) * 0.06,
        this.auraFx.z + Math.sin(a) * AURA_RADIUS * 0.8,
        this.tmpRgb, 0.0075, 0.5, 0.8,
      );
    }
  }

  /* --------------------------------------------------------- diagnostics */

  /** FxApi state and counters (diagnostics / tests). */
  fxState(): FxStats {
    let emitters = 0;
    for (const e of this.emitters) if (e.active) emitters++;
    return {
      intensity: this.fxIntensity,
      lightShowEnabled: this.lightShowEnabled,
      lightShow: this.light.requested,
      lightShowActive: this.light.effective(),
      live: this.addPool.count + this.normPool.count,
      liveAdditive: this.addPool.count,
      liveNormal: this.normPool.count,
      instances: this.addBatch.n + this.normBatch.n,
      drawCalls: (this.addBatch.mesh.visible ? 1 : 0) + (this.normBatch.mesh.visible ? 1 : 0),
      capacity: this.addPool.capacity + this.normPool.capacity,
      dropped: this.addPool.dropped + this.normPool.dropped + this.addBatch.overflow + this.normBatch.overflow,
      beams: this.light.beamsDrawn,
      flash: this.light.flashVisible,
      aura: this.auraFx.visibleTier(),
      ledEnergy: this.ledEnergy(),
      emitters,
      scale: this.particleScale(),
      reducedMotion: this.reducedMotion,
    };
  }

  /** Live particles per family (diagnostics / tests; allocates). */
  familyCounts(): Record<FamilyName, number> {
    const out = {} as Record<FamilyName, number>;
    for (const name of FAMILY_NAMES) out[name] = 0;
    for (const pool of [this.addPool, this.normPool]) {
      for (let i = 0; i < pool.count; i++) out[FAMILY_NAMES[pool.tag[i]!]!]++;
    }
    return out;
  }

  /** Typed arrays behind both batches and pools' capacities (tests check that nothing grows). */
  storage(): { buffers: readonly Float32Array[]; capacity: number; batchCapacity: number } {
    return {
      buffers: [...this.addBatch.buffers(), ...this.normBatch.buffers(), this.addPool.px, this.normPool.px],
      capacity: this.addPool.capacity + this.normPool.capacity,
      batchCapacity: this.addBatch.capacity + this.normBatch.capacity,
    };
  }

  /** Number of live particles (diagnostics). */
  liveCount(): number {
    return this.addPool.count + this.normPool.count;
  }

  dispose(): void {
    this.addBatch.dispose();
    this.normBatch.dispose();
    this.addPool.clear();
    this.normPool.clear();
    this.group.removeFromParent();
  }
}

function tierName(index: number): FxTier {
  return index >= 3 ? 'legendary' : index === 2 ? 'epic' : index === 1 ? 'rare' : 'common';
}
