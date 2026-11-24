import { scaledCount } from './budget';
import { BEH, FAMILY, MODE, SHAPE } from './constants';
import { type Motif, hueRgb, type Palette, type Rgb, type ThemePalettes } from './palette';
import { ParticleSpec, type ParticlePool } from './ParticlePool';

const TAU = Math.PI * 2;
/** Gold of the score coins (linear RGB of #ffcf3a). */
const GOLD: Rgb = { r: 1, g: 0.624, b: 0.042 };
const FLAME_A: Rgb = { r: 1, g: 0.144, b: 0.012 };
const FLAME_B: Rgb = { r: 1, g: 0.54, b: 0.04 };
const DUST: Rgb = { r: 0.42, g: 0.42, b: 0.46 };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };

/** Firework shell physics (see `shell`). */
const SHELL_DRAG = 0.4;
const SHELL_GRAVITY = -2.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Particle recipes. Every recipe fills the shared `ParticleSpec` and copies it into
 * a pool; counts go through `n()` so they follow the budget, the effects intensity
 * and reduced motion. Additive things (light) go to `add`, paper and fluff to `norm`.
 */
export class FxRecipes {
  readonly s = new ParticleSpec();
  /** Count multiplier of the current call (budget × intensity × reduced motion × caller's scale). */
  scale = 1;
  /** Size multiplier of the current call. */
  sizeK = 1;
  reducedMotion = false;
  /** Single light elements (rings, glow pops) are drawn while the intensity is above zero. */
  lights = true;
  pal: ThemePalettes;
  private readonly c: Rgb = { r: 1, g: 1, b: 1 };
  /** Colour source of the current recipe: a fixed colour, else a random palette entry. */
  private fixed: Rgb | null = null;
  private palette: Palette;

  constructor(
    readonly add: ParticlePool,
    readonly norm: ParticlePool,
    readonly rng: () => number,
    pal: ThemePalettes,
  ) {
    this.pal = pal;
    this.palette = pal.particles;
  }

  n(base: number): number {
    return scaledCount(base, this.scale);
  }

  rand(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  /** Selects the colour source used by the following spawns. */
  colors(palette: Palette | null, fixed: Rgb | null = null): this {
    this.palette = palette ?? this.pal.particles;
    this.fixed = fixed;
    return this;
  }

  private paint(gain: number, whiteMix = 0): void {
    const c = this.c;
    if (this.fixed) {
      c.r = this.fixed.r;
      c.g = this.fixed.g;
      c.b = this.fixed.b;
    } else this.palette.get(Math.floor(this.rng() * this.palette.size), c);
    const s = this.s;
    s.r = (c.r + (1 - c.r) * whiteMix) * gain;
    s.g = (c.g + (1 - c.g) * whiteMix) * gain;
    s.b = (c.b + (1 - c.b) * whiteMix) * gain;
  }

  private setRgb(rgb: Rgb, gain: number): void {
    this.s.r = rgb.r * gain;
    this.s.g = rgb.g * gain;
    this.s.b = rgb.b * gain;
  }

  private motion(v: number): number {
    return this.reducedMotion ? v * 0.35 : v;
  }

  private emitAdd(): number {
    return this.add.emit(this.s, this.rng() * TAU);
  }

  private emitNorm(): number {
    this.s.cover = 1;
    return this.norm.emit(this.s, this.rng() * TAU);
  }

  /* -------------------------------------------------------- light elements */

  /** Soft glow that grows and fades (burst centres, firework flashes). */
  glowPop(x: number, y: number, z: number, s0: number, s1: number, life: number, rgb: Rgb, alpha: number): void {
    if (!this.lights) return;
    const s = this.s.reset();
    s.shape = SHAPE.GLOW;
    s.mode = MODE.BILLBOARD;
    s.beh = BEH.FIXED;
    s.tag = FAMILY.GLOW;
    s.x = x;
    s.y = y;
    s.z = z;
    s.life = life;
    s.size0 = s0 * this.sizeK;
    s.size1 = s1 * this.sizeK;
    this.setRgb(rgb, 1.4);
    s.a = alpha;
    s.fadeIn = 0.02;
    s.fadeOut = 0.7;
    s.cover = 0.15;
    this.emitAdd();
  }

  /** Horizontal ring expanding from r0 to r1 (shockwaves, landing splashes). */
  ring(x: number, y: number, z: number, r0: number, r1: number, life: number, rgb: Rgb, alpha: number, thickness = 0.14, rainbow = false, softness = 0.6, facing = false): void {
    if (!this.lights) return;
    const s = this.s.reset();
    s.shape = rainbow ? SHAPE.RAINBOW_RING : SHAPE.RING;
    s.mode = facing ? MODE.BILLBOARD : MODE.FLAT;
    s.beh = BEH.FIXED;
    s.tag = FAMILY.RING;
    s.x = x;
    s.y = y;
    s.z = z;
    s.life = life;
    s.size0 = r0 * this.sizeK;
    s.size1 = r1 * this.sizeK;
    s.extra0 = this.rng();
    s.extra1 = thickness;
    s.aux = softness;
    s.rot = this.rng() * TAU;
    s.spin = this.reducedMotion ? 0 : 0.8;
    this.setRgb(rgb, 1.5);
    s.a = alpha;
    s.fadeIn = 0.02;
    s.fadeOut = 0.6;
    s.cover = 0.3;
    this.emitAdd();
  }

  /* -------------------------------------------------------------- sparkles */

  /** Star sparkles thrown up and out (colour from `colors()`). */
  sparkles(
    x: number, y: number, z: number, count: number,
    upMin: number, upMax: number, outMin: number, outMax: number,
    lifeMin: number, lifeMax: number, sizeMin: number, sizeMax: number,
    grav = -0.9, drag = 2, tag: number = FAMILY.SPARKLE,
  ): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.STAR;
      s.mode = MODE.BILLBOARD;
      s.beh = BEH.BALLISTIC;
      s.tag = tag;
      const th = this.rng() * TAU;
      const out = this.rand(outMin, outMax);
      s.x = x + (this.rng() - 0.5) * 0.03;
      s.y = y + this.rng() * 0.02;
      s.z = z + (this.rng() - 0.5) * 0.03;
      s.vx = Math.cos(th) * out;
      s.vz = Math.sin(th) * out * 0.7;
      s.vy = this.rand(upMin, upMax);
      s.drag = drag;
      s.grav = grav;
      s.life = this.rand(lifeMin, lifeMax);
      s.size0 = this.rand(sizeMin, sizeMax) * this.sizeK;
      s.size1 = s.size0 * 0.55;
      s.rot = this.rng() * TAU;
      s.spin = this.motion(this.rand(-2, 2));
      s.twinkle = this.rand(9, 18);
      s.fadeIn = 0.03;
      s.fadeOut = 0.45;
      s.cover = 0.45;
      this.paint(1.7, 0.15);
      this.emitAdd();
    }
  }

  /** Glowing streaks flying out of a point (grab sparks, firework bursts). `up` keeps them above the horizon. */
  sparks(
    x: number, y: number, z: number, count: number,
    speedMin: number, speedMax: number, up: boolean,
    lifeMin: number, lifeMax: number, width: number, stretch: number,
    grav: number, drag: number, tag: number = FAMILY.SPARK, rainbow = false, gain = 2,
  ): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.SPARK;
      s.mode = MODE.AXIAL;
      s.beh = BEH.BALLISTIC;
      s.tag = tag;
      const u = up ? this.rand(-0.15, 1) : this.rand(-1, 1);
      const th = this.rng() * TAU;
      const rr = Math.sqrt(Math.max(0, 1 - u * u));
      const speed = this.rand(speedMin, speedMax);
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = rr * Math.cos(th) * speed;
      s.vy = u * speed;
      s.vz = rr * Math.sin(th) * speed * 0.8;
      s.drag = drag;
      s.grav = grav;
      s.life = this.rand(lifeMin, lifeMax);
      s.size0 = s.size1 = width * this.sizeK;
      s.stretch = stretch;
      s.fadeIn = 0.01;
      s.fadeOut = 0.5;
      s.cover = 0.35;
      if (rainbow) {
        hueRgb(i / Math.max(1, count) + this.rng() * 0.1, this.c);
        this.setRgb(this.c, gain);
      } else this.paint(gain, 0.2);
      this.emitAdd();
    }
  }

  /** Star-burst rays growing out of a point in a fan facing the viewer. */
  rays(x: number, y: number, z: number, count: number, length: number, life: number, alpha: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.BEAM;
      s.mode = MODE.AXIAL;
      s.beh = BEH.RAY;
      s.tag = FAMILY.RAY;
      const phi = 0.15 + ((Math.PI - 0.3) * (i + 0.2 + this.rng() * 0.6)) / count;
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = Math.cos(phi);
      s.vy = Math.sin(phi);
      s.vz = -0.25 * this.rng();
      s.life = life * this.rand(0.85, 1.15);
      s.size0 = 0.014 * this.sizeK;
      s.size1 = length * this.rand(0.7, 1.15) * this.sizeK;
      s.a = alpha;
      s.fadeIn = 0.02;
      s.fadeOut = 0.55;
      s.cover = 0.12;
      this.paint(1.6, 0.25);
      this.emitAdd();
    }
  }

  /* ------------------------------------------------------------- fireworks */

  /** Apex time of a shell launched upwards at `vy` (its life: it bursts at the top). */
  static shellLife(vy: number): number {
    const terminal = -SHELL_GRAVITY / SHELL_DRAG;
    return Math.log((vy + terminal) / terminal) / SHELL_DRAG;
  }

  /** Rising firework shell; it bursts (`shellBurst`) when its life ends. */
  shell(x: number, y: number, z: number, vy: number, rgb: Rgb, strength: number, rainbow: boolean): void {
    if (!(this.scale > 0)) return;
    const s = this.s.reset();
    s.shape = SHAPE.GLOW;
    s.mode = MODE.BILLBOARD;
    s.beh = BEH.SHELL;
    s.tag = FAMILY.SHELL;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = (this.rng() - 0.5) * 0.12;
    s.vz = (this.rng() - 0.5) * 0.08;
    s.vy = vy;
    s.drag = SHELL_DRAG;
    s.grav = SHELL_GRAVITY;
    s.life = FxRecipes.shellLife(vy);
    s.size0 = s.size1 = 0.015 * this.sizeK;
    this.setRgb(rgb, 2);
    s.fadeIn = 0.02;
    s.fadeOut = 0;
    s.cover = 0.3;
    s.extra1 = strength;
    s.aux = rainbow ? 1 : 0;
    this.emitAdd();
  }

  shellBurst(x: number, y: number, z: number, rgb: Rgb, strength: number, rainbow: boolean): void {
    this.colors(null, rgb);
    this.sparks(x, y, z, this.n(40 * strength), 0.45, 0.8, false, 0.9, 1.4, 0.008, 0.09, -0.55, 2.2, FAMILY.FIREWORK, rainbow, 2.1);
    this.sparkles(x, y, z, this.n(12 * strength), -0.1, 0.25, 0.15, 0.4, 1.4, 2.1, 0.013, 0.02, -0.3, 1.5, FAMILY.FIREWORK);
    this.glowPop(x, y, z, 0.06, 0.22, 0.35, rgb, 0.8);
  }

  /** Small fading glows left behind by shells and the aura. */
  trail(x: number, y: number, z: number, rgb: Rgb, size: number, life: number, alpha: number): void {
    const s = this.s.reset();
    s.shape = SHAPE.GLOW;
    s.mode = MODE.BILLBOARD;
    s.beh = BEH.BALLISTIC;
    s.tag = FAMILY.TRAIL;
    s.x = x + (this.rng() - 0.5) * 0.006;
    s.y = y;
    s.z = z + (this.rng() - 0.5) * 0.006;
    s.vy = -0.04;
    s.drag = 2;
    s.life = life * this.rand(0.8, 1.2);
    s.size0 = size;
    s.size1 = size * 0.3;
    this.setRgb(rgb, 1.2);
    s.a = alpha;
    s.fadeIn = 0;
    s.fadeOut = 0.8;
    s.cover = 0.2;
    this.emitAdd();
  }

  /* ---------------------------------------------------------------- paper */

  /** Paper confetti cannon (normal blending). Biased towards the middle of the field. */
  confetti(x: number, y: number, z: number, count: number, upMin: number, upMax: number, spread: number, palette: Palette, tierMix: Palette | null): void {
    const biasX = clamp(-x * 1.6, -0.7, 0.7);
    const biasZ = clamp((-0.4 - z) * 1.5, -0.6, 0.6);
    const stars = this.pal.motif === 'paper';
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = stars && i % 3 === 0 ? SHAPE.PAPER_STAR : SHAPE.CONFETTI;
      s.mode = MODE.BILLBOARD;
      s.beh = BEH.FLUTTER;
      s.tag = FAMILY.CONFETTI;
      s.x = x + (this.rng() - 0.5) * 0.06;
      s.y = y + this.rng() * 0.03;
      s.z = z + (this.rng() - 0.5) * 0.06;
      s.vx = biasX + (this.rng() * 2 - 1) * spread;
      s.vz = biasZ * 0.5 + (this.rng() * 2 - 1) * spread * 0.6;
      s.vy = this.rand(upMin, upMax);
      s.drag = 2.8;
      s.grav = -1.6;
      s.sway = this.rand(0.06, 0.14);
      s.swayFreq = this.rand(3, 6);
      s.flip = this.rng() * TAU;
      s.flipSpeed = this.motion(this.rand(6, 14)) * (this.rng() < 0.5 ? -1 : 1);
      s.rot = this.rng() * TAU;
      s.spin = this.motion(this.rand(-3, 3));
      s.life = this.rand(2.4, 3.6);
      s.size0 = s.size1 = this.rand(0.0095, 0.014) * this.sizeK * (s.shape === SHAPE.PAPER_STAR ? 1.4 : 1);
      s.fadeIn = 0;
      s.fadeOut = 0.22;
      this.colors(tierMix && this.rng() < 0.3 ? tierMix : palette).paint(1);
      this.emitNorm();
    }
  }

  /** Spinning gold coins (score) plus a few gold glints. */
  coins(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.COIN;
      s.mode = MODE.BILLBOARD;
      s.beh = BEH.BALLISTIC;
      s.tag = FAMILY.COIN;
      const th = this.rng() * TAU;
      const out = this.rand(0.1, 0.35);
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = Math.cos(th) * out + clamp(-x * 0.6, -0.25, 0.25);
      s.vz = Math.sin(th) * out * 0.6;
      s.vy = this.rand(1.0, 1.6);
      s.drag = 1.2;
      s.grav = -2.6;
      s.life = this.rand(1.0, 1.4);
      s.flip = this.rng() * TAU;
      s.flipSpeed = this.motion(this.rand(10, 18));
      s.size0 = s.size1 = 0.014 * this.sizeK;
      s.fadeIn = 0;
      s.fadeOut = 0.25;
      this.setRgb(GOLD, 1.35);
      this.emitNorm();
    }
    this.colors(null, GOLD).sparkles(x, y, z, count, 0.4, 0.8, 0.05, 0.25, 0.6, 0.9, 0.012, 0.018, -0.4, 2, FAMILY.COIN);
  }

  /** Soft puffs of dust / plush fluff (normal blending). `sad` = slow, grey, sinking. */
  puffs(x: number, y: number, z: number, count: number, rgb: Rgb, alpha: number, sad: boolean): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.PUFF;
      s.mode = MODE.BILLBOARD;
      s.beh = BEH.BALLISTIC;
      s.tag = FAMILY.PUFF;
      const th = this.rng() * TAU;
      const out = sad ? this.rand(0.04, 0.1) : this.rand(0.1, 0.28);
      s.x = x + Math.cos(th) * 0.015;
      s.y = y + (this.rng() - 0.5) * 0.02;
      s.z = z + Math.sin(th) * 0.012;
      s.vx = Math.cos(th) * out;
      s.vz = Math.sin(th) * out * 0.7;
      s.vy = sad ? this.rand(-0.06, 0.03) : this.rand(0.03, 0.12);
      s.drag = sad ? 2.2 : 3;
      s.grav = sad ? -0.25 : -0.05;
      s.life = sad ? this.rand(0.9, 1.3) : this.rand(0.5, 0.8);
      s.size0 = 0.012 * this.sizeK;
      s.size1 = (sad ? 0.035 : this.rand(0.04, 0.055)) * this.sizeK;
      s.rot = this.rng() * TAU;
      s.spin = this.motion(this.rand(-0.8, 0.8));
      s.aux = this.rng();
      this.setRgb(rgb, 1);
      s.a = alpha;
      s.fadeIn = 0.05;
      s.fadeOut = 0.6;
      this.emitNorm();
    }
  }

  /* ---------------------------------------------------------------- flames */

  /** Flames swirling up around a point (combo). */
  flameSwirl(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.shape = SHAPE.FLAME;
      s.mode = MODE.BILLBOARD;
      s.beh = BEH.ORBIT;
      s.tag = FAMILY.FLAME;
      const f = i / Math.max(1, count);
      s.cx = x;
      s.cy = y - 0.05 + f * 0.06;
      s.cz = z;
      s.x = x;
      s.y = s.cy;
      s.z = z;
      s.ang = f * TAU * 2 + this.rng() * 0.3;
      s.angV = this.reducedMotion ? 2 : 7;
      s.rad = (0.06 + this.rng() * 0.02) * this.sizeK;
      s.radV = 0.06 * this.sizeK;
      s.vy = this.rand(0.12, 0.32);
      s.life = this.rand(0.7, 1.1);
      s.size0 = this.rand(0.02, 0.03) * this.sizeK;
      s.size1 = s.size0 * 0.35;
      s.cover = 0.35;
      const pick = this.rng();
      this.setRgb(pick < 0.4 ? FLAME_A : pick < 0.8 ? FLAME_B : this.pal.primary, 1.7);
      s.fadeIn = 0.05;
      s.fadeOut = 0.5;
      this.emitAdd();
    }
  }

  /* ---------------------------------------------------------------- motifs */

  /**
   * Theme motif: sakura petals, storybook paper stars, ocean bubbles, cosmic
   * stardust or GPU data bits. style 0 = burst from a point, 1 = rain over the field.
   */
  motif(x: number, y: number, z: number, count: number, style: 0 | 1): void {
    const m: Motif = this.pal.motif;
    this.colors(this.pal.particles);
    const biasX = clamp(-x * 1.4, -0.6, 0.6);
    for (let i = 0; i < count; i++) {
      const s = this.s.reset();
      s.tag = FAMILY.MOTIF;
      s.mode = MODE.BILLBOARD;
      const th = this.rng() * TAU;
      if (style === 1) {
        s.x = this.rand(-0.45, 0.45);
        s.z = this.rand(-0.72, -0.08);
        s.y = m === 'bubbles' ? this.rand(0.02, 0.15) : this.rand(0.86, 0.94);
      } else {
        s.x = x + (this.rng() - 0.5) * 0.05;
        s.y = y + this.rng() * 0.03;
        s.z = z + (this.rng() - 0.5) * 0.05;
      }
      const out = this.rand(0.15, 0.5);
      if (m === 'petals' || m === 'paper') {
        s.shape = m === 'petals' ? SHAPE.PETAL : SHAPE.PAPER_STAR;
        s.beh = BEH.FLUTTER;
        if (style === 1) {
          s.vy = this.rand(-0.3, -0.12);
        } else {
          s.vx = biasX + Math.cos(th) * out;
          s.vz = Math.sin(th) * out * 0.5;
          s.vy = this.rand(1.6, 2.6);
        }
        s.drag = 3;
        s.grav = -1;
        s.sway = this.rand(0.08, 0.16);
        s.swayFreq = this.rand(2, 4.5);
        s.flip = this.rng() * TAU;
        s.flipSpeed = this.motion(this.rand(3, 7));
        s.rot = this.rng() * TAU;
        s.spin = this.motion(this.rand(-2, 2));
        s.life = this.rand(3, 4.5);
        s.size0 = s.size1 = (m === 'petals' ? this.rand(0.012, 0.017) : this.rand(0.014, 0.02)) * this.sizeK;
        s.fadeIn = 0.05;
        s.fadeOut = 0.25;
        this.paint(1);
        this.emitNorm();
      } else if (m === 'bubbles') {
        s.shape = SHAPE.BUBBLE;
        s.beh = BEH.RISE;
        s.vx = style === 1 ? 0 : Math.cos(th) * out * 0.5 + biasX * 0.3;
        s.vz = style === 1 ? 0 : Math.sin(th) * out * 0.3;
        s.vy = style === 1 ? this.rand(0.12, 0.25) : this.rand(0.3, 0.7);
        s.drag = 1.5;
        s.grav = 0.35;
        s.sway = this.rand(0.03, 0.06);
        s.swayFreq = this.rand(4, 7);
        s.life = this.rand(1.6, 2.6);
        s.size0 = this.rand(0.01, 0.024) * this.sizeK;
        s.size1 = s.size0 * 1.15;
        s.a = 0.85;
        s.cover = 0.25;
        s.fadeIn = 0.05;
        s.fadeOut = 0.2;
        this.paint(1.1);
        this.emitAdd();
      } else if (m === 'bits') {
        s.shape = SHAPE.PIXEL;
        s.beh = BEH.BALLISTIC;
        if (style === 1) {
          s.vy = this.rand(-0.35, -0.2);
        } else {
          s.vx = biasX + Math.cos(th) * out * 0.8;
          s.vz = Math.sin(th) * out * 0.4;
          s.vy = this.rand(0.8, 1.6);
        }
        s.drag = 2.2;
        s.grav = -0.6;
        s.life = this.rand(1.6, 2.6);
        s.size0 = s.size1 = this.rand(0.006, 0.01) * this.sizeK;
        s.cover = 0.55;
        s.twinkle = this.reducedMotion ? 0 : this.rand(20, 35);
        s.fadeIn = 0.02;
        s.fadeOut = 0.3;
        if (this.rng() < 0.15) this.setRgb(WHITE, 1.8);
        else this.paint(1.6);
        this.emitAdd();
      } else {
        // stardust
        const star = this.rng() < 0.4;
        s.shape = star ? SHAPE.STAR : SHAPE.GLOW;
        s.beh = BEH.BALLISTIC;
        const u = this.rand(-0.2, 1);
        const rr = Math.sqrt(Math.max(0, 1 - u * u));
        const speed = style === 1 ? 0.1 : this.rand(0.3, 0.9);
        s.vx = rr * Math.cos(th) * speed + (style === 1 ? 0 : biasX * 0.4);
        s.vy = style === 1 ? -this.rand(0.1, 0.25) : u * speed;
        s.vz = rr * Math.sin(th) * speed * 0.7;
        s.drag = 1.8;
        s.grav = -0.15;
        s.life = this.rand(1.4, 2.4);
        s.size0 = s.size1 = (star ? this.rand(0.015, 0.026) : this.rand(0.008, 0.015)) * this.sizeK;
        s.cover = 0.35;
        s.twinkle = this.rand(10, 20);
        s.rot = this.rng() * TAU;
        s.fadeIn = 0.03;
        s.fadeOut = 0.4;
        this.paint(1.8);
        this.emitAdd();
      }
    }
  }

  /** One slow ambient mote of the theme motif, kept above the toys. Returns false when the pool is full. */
  ambientMote(): boolean {
    const m = this.pal.motif;
    const s = this.s.reset();
    s.tag = FAMILY.AMBIENT;
    s.mode = MODE.BILLBOARD;
    s.x = this.rand(-0.45, 0.45);
    s.z = this.rand(-0.74, -0.08);
    s.a = 0.55;
    s.fadeIn = 0.6;
    s.fadeOut = 0.15;
    s.rot = this.rng() * TAU;
    s.spin = this.motion(this.rand(-0.8, 0.8));
    this.colors(this.pal.particles).paint(1);
    let additive = true;
    if (m === 'bubbles') {
      s.shape = SHAPE.BUBBLE;
      s.beh = BEH.RISE;
      s.y = this.rand(0.3, 0.4);
      s.vy = this.rand(0.05, 0.1);
      s.sway = 0.02;
      s.swayFreq = this.rand(1, 2);
      s.life = Math.min(this.rand(7, 13), (0.9 - s.y) / s.vy);
      s.size0 = s.size1 = this.rand(0.008, 0.016);
    } else if (m === 'stardust') {
      s.shape = this.rng() < 0.3 ? SHAPE.STAR : SHAPE.GLOW;
      s.beh = BEH.BALLISTIC;
      s.y = this.rand(0.5, 0.9);
      s.vx = (this.rng() - 0.5) * 0.04;
      s.vy = (this.rng() - 0.5) * 0.02;
      s.vz = (this.rng() - 0.5) * 0.03;
      s.life = this.rand(7, 13);
      s.size0 = s.size1 = this.rand(0.006, 0.014);
      s.twinkle = this.rand(2, 5);
      s.r *= 1.6;
      s.g *= 1.6;
      s.b *= 1.6;
    } else if (m === 'bits') {
      s.shape = SHAPE.PIXEL;
      s.beh = BEH.BALLISTIC;
      s.rot = 0;
      s.spin = 0;
      s.y = this.rand(0.82, 0.92);
      s.vy = -this.rand(0.03, 0.07);
      s.life = Math.min(this.rand(7, 13), (s.y - 0.45) / -s.vy);
      s.size0 = s.size1 = this.rand(0.004, 0.007);
      s.twinkle = this.reducedMotion ? 0 : this.rand(4, 9);
      s.r *= 1.5;
      s.g *= 1.5;
      s.b *= 1.5;
    } else {
      // Petals and paper stars drift down from the ceiling.
      additive = false;
      s.shape = m === 'petals' ? SHAPE.PETAL : SHAPE.PAPER_STAR;
      s.beh = BEH.FLUTTER;
      s.y = this.rand(0.82, 0.92);
      s.vy = -this.rand(0.035, 0.085);
      s.sway = 0.03;
      s.swayFreq = this.rand(0.6, 1.4);
      s.flip = this.rng() * TAU;
      s.flipSpeed = this.motion(this.rand(0.8, 2));
      s.life = Math.min(this.rand(7, 13), (s.y - 0.45) / -s.vy);
      s.size0 = s.size1 = this.rand(0.008, 0.013);
    }
    return (additive ? this.emitAdd() : this.emitNorm()) >= 0;
  }

  /** One sparkle falling from the top of the cabinet (restock rain). */
  rainSparkle(x0: number, z0: number, halfW: number, halfD: number, palette: Palette): void {
    const s = this.s.reset();
    s.shape = SHAPE.STAR;
    s.mode = MODE.BILLBOARD;
    s.beh = BEH.BALLISTIC;
    s.tag = FAMILY.RAIN;
    s.x = clamp(x0 + (this.rng() * 2 - 1) * halfW, -0.47, 0.47);
    s.y = this.rand(0.88, 0.94);
    s.z = clamp(z0 + (this.rng() * 2 - 1) * halfD, -0.76, -0.05);
    s.vy = this.rand(-0.6, -0.35);
    s.drag = 0.4;
    s.grav = -0.2;
    s.life = this.rand(1, 1.6);
    s.size0 = this.rand(0.012, 0.02) * this.sizeK;
    s.size1 = s.size0 * 0.6;
    s.twinkle = this.rand(12, 20);
    s.rot = this.rng() * TAU;
    s.spin = this.motion(this.rand(-1.5, 1.5));
    s.fadeIn = 0.1;
    s.fadeOut = 0.4;
    s.cover = 0.45;
    this.colors(palette).paint(1.8, 0.2);
    this.emitAdd();
  }

  /** One rising sparkle for the call-to-action loop. */
  ctaMote(x: number, y: number, z: number, radius: number): void {
    const s = this.s.reset();
    s.shape = this.rng() < 0.5 ? SHAPE.STAR : SHAPE.GLOW;
    s.mode = MODE.BILLBOARD;
    s.beh = BEH.ORBIT;
    s.tag = FAMILY.SPARKLE;
    s.cx = x;
    s.cy = y - 0.02;
    s.cz = z;
    s.ang = this.rng() * TAU;
    s.angV = this.reducedMotion ? 0.4 : 2.2;
    s.rad = radius * this.rand(0.85, 1.1);
    s.radV = -0.02;
    s.vy = this.rand(0.12, 0.26);
    s.life = this.rand(1, 1.4);
    s.size0 = this.rand(0.01, 0.016) * this.sizeK;
    s.size1 = s.size0 * 0.4;
    s.twinkle = this.rand(8, 14);
    s.fadeIn = 0.15;
    s.fadeOut = 0.5;
    s.cover = 0.4;
    this.colors(this.pal.ui).paint(1.7, 0.2);
    this.emitAdd();
  }
}

export { DUST, FLAME_B, GOLD, WHITE };
