import { FIELD } from '../../physics/fieldSpec';
import { DEFAULT_FOCUS, FLASH_MIN_INTERVAL, JACKPOT_SECONDS, JACKPOT_STROBE_HZ, MODE, SHAPE, WIN_SECONDS, spriteCode } from './constants';
import type { Rgb, ThemePalettes } from './palette';
import type { SpriteBatch } from './SpriteBatch';

export type LightShowMode = 'off' | 'idle' | 'attract' | 'win' | 'jackpot';
type ActiveMode = Exclude<LightShowMode, 'off'>;

interface ModeParams {
  /** Beams lit (of BEAM_SOURCES). */
  beams: number;
  /** Beam opacity. */
  alpha: number;
  /** Sweep speed (rad/s of the sweep phase). */
  sweep: number;
  /** Half-width of a beam at the source and at the floor (m). */
  width0: number;
  width1: number;
  /** Strength of the pools of light where the beams meet the floor. */
  spot: number;
  /** Extra energy for the cabinet LED strips (ledEnergy). */
  led: number;
  /** Brightness of the LED chase along the front edge of the floor. */
  chase: number;
  /** LED chase speed (rad/s). */
  chaseSpeed: number;
}

const PARAMS: Readonly<Record<ActiveMode, ModeParams>> = {
  idle: { beams: 2, alpha: 0.06, sweep: 0.16, width0: 0.016, width1: 0.085, spot: 0.45, led: 0, chase: 0, chaseSpeed: 2 },
  attract: { beams: 4, alpha: 0.17, sweep: 0.55, width0: 0.018, width1: 0.11, spot: 1, led: 0.35, chase: 0.7, chaseSpeed: 5 },
  win: { beams: 6, alpha: 0.26, sweep: 1.25, width0: 0.02, width1: 0.12, spot: 1, led: 0.9, chase: 1, chaseSpeed: 9 },
  jackpot: { beams: 6, alpha: 0.3, sweep: 1.55, width0: 0.022, width1: 0.13, spot: 1.2, led: 1, chase: 1, chaseSpeed: 12 },
};

/** Beam sources along the top of the cabinet (x, z); y is just under the ceiling. */
const BEAM_SOURCES: readonly (readonly [number, number])[] = [
  [-0.4, -0.1],
  [0.4, -0.1],
  [-0.15, -0.66],
  [0.15, -0.66],
  [-0.28, -0.38],
  [0.28, -0.38],
];
export const MAX_BEAMS = BEAM_SOURCES.length;
const SOURCE_Y = FIELD.ceilingY - 0.005;
/** LED chase: a row of small lights along the front edge of the play floor (right of the chute). */
const CHASE_COUNT = 18;
const CHASE_X0 = -0.18;
const CHASE_X1 = 0.48;
const CHASE_Y = 0.014;
const CHASE_Z = -0.016;

const BEAM_CODE = spriteCode(SHAPE.BEAM, MODE.AXIAL);
const SPOT_CODE = spriteCode(SHAPE.GLOW, MODE.FLAT);
const GLOW_CODE = spriteCode(SHAPE.GLOW, MODE.BILLBOARD);
const STAR_CODE = spriteCode(SHAPE.STAR, MODE.BILLBOARD);
const FLASH_CODE = spriteCode(SHAPE.FLASH, MODE.BILLBOARD);
const RAINBOW_CODE = spriteCode(SHAPE.RAINBOW_RING, MODE.FLAT);
const RING_CODE = spriteCode(SHAPE.RING, MODE.FLAT);

const _c: Rgb = { r: 1, g: 1, b: 1 };

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * Math.min(1, rate * dt);
}

/**
 * Moving light show drawn with additive geometry only (no extra lights, no shadow
 * passes): light shafts sweeping down from the cabinet top with pools of light on
 * the floor, an LED chase along the front edge of the floor, a short global flash,
 * and a rainbow ring at the prize exit during a jackpot. In a brand-kit theme the jackpot
 * colours cycle through the brand's spectrum (green / white) instead of every hue.
 *
 * `off`, `idle` and `attract` are persistent modes; `win` and `jackpot` are timed
 * shows (2.6 s / 4 s) that return to the persistent mode. `off` also cancels a
 * running timed show. Everything fades in and out; with reduced motion the beams
 * barely move, nothing strobes and there is no flash.
 */
export class LightShow {
  /** The mode last requested through `set` (what the game asked for). */
  requested: LightShowMode = 'off';
  enabled = true;
  /**
   * How bright the cabinet interior is (0 dark … 1 pastel). Additive light hardly shows on a
   * bright cabinet, so there the beams get stronger, more saturated and hide a little more.
   */
  brightness = 0.5;
  readonly focus: { x: number; y: number; z: number } = { x: DEFAULT_FOCUS.x, y: DEFAULT_FOCUS.y, z: DEFAULT_FOCUS.z };
  readonly focusColor: Rgb = { r: 1, g: 0.85, b: 0.4 };
  /** Instances drawn in the last `write` (diagnostics). */
  beamsDrawn = 0;
  flashVisible = false;

  private base: 'off' | 'idle' | 'attract' = 'off';
  private timed: 'win' | 'jackpot' | null = null;
  private timedAge = 0;
  private timedDuration = 0;
  private secondFlashDone = false;
  private readonly level = new Float32Array(MAX_BEAMS);
  private readonly phaseX = new Float32Array(MAX_BEAMS);
  private readonly phaseZ = new Float32Array(MAX_BEAMS);
  private alpha = 0;
  private sweep = 0;
  private width0 = 0.016;
  private width1 = 0.09;
  private spot = 0;
  private chase = 0;
  private chaseSpeed = 2;
  private chasePhase = 0;
  private led = 0;
  private ring = 0;
  private flashAge = 99;
  private flashStrength = 0;
  private lastFlash = -99;
  private readonly flashColor: Rgb = { r: 1, g: 1, b: 1 };

  constructor() {
    for (let i = 0; i < MAX_BEAMS; i++) {
      this.phaseX[i] = i * 1.9;
      this.phaseZ[i] = i * 2.7 + 0.5;
    }
  }

  set(mode: LightShowMode, time: number, reducedMotion: boolean): void {
    this.requested = mode;
    if (mode === 'off') {
      this.base = 'off';
      this.timed = null;
    } else if (mode === 'idle' || mode === 'attract') {
      this.base = mode;
    } else {
      this.trigger(mode, null, null, time, reducedMotion);
    }
  }

  /** Starts a timed show focused on `focus` (the prize exit when null). */
  trigger(mode: 'win' | 'jackpot', focus: { x: number; y: number; z: number } | null, color: Rgb | null, time: number, reducedMotion: boolean): void {
    // A win never interrupts a running jackpot; it only extends it a little.
    if (this.timed === 'jackpot' && mode === 'win') {
      this.timedDuration = Math.max(this.timedDuration, this.timedAge + WIN_SECONDS * 0.5);
      return;
    }
    this.timed = mode;
    this.timedAge = 0;
    this.timedDuration = mode === 'jackpot' ? JACKPOT_SECONDS : WIN_SECONDS;
    this.secondFlashDone = false;
    if (focus) {
      this.focus.x = focus.x;
      this.focus.y = focus.y;
      this.focus.z = focus.z;
    }
    if (color) {
      this.focusColor.r = color.r;
      this.focusColor.g = color.g;
      this.focusColor.b = color.b;
    }
    this.flash(mode === 'jackpot' ? 0.55 : 0.4, color, time, reducedMotion);
  }

  /** A short global flash. Refused while disabled, with reduced motion, or too soon after the last one. */
  flash(strength: number, color: Rgb | null, time: number, reducedMotion: boolean): boolean {
    if (!this.enabled || reducedMotion || !(strength > 0)) return false;
    if (time - this.lastFlash < FLASH_MIN_INTERVAL) return false;
    this.lastFlash = time;
    this.flashAge = 0;
    this.flashStrength = Math.min(1, strength);
    this.flashColor.r = color ? 0.55 + 0.45 * color.r : 1;
    this.flashColor.g = color ? 0.55 + 0.45 * color.g : 1;
    this.flashColor.b = color ? 0.55 + 0.45 * color.b : 1;
    return true;
  }

  /** Mode currently shown (a timed show wins over the persistent mode; disabled = off). */
  effective(): LightShowMode {
    if (!this.enabled) return 'off';
    return this.timed ?? this.base;
  }

  /** Seconds left of the running timed show (0 when none). */
  timedRemaining(): number {
    return this.timed ? Math.max(0, this.timedDuration - this.timedAge) : 0;
  }

  update(dt: number, time: number, reducedMotion: boolean): void {
    if (this.timed) {
      this.timedAge += dt;
      if (this.timed === 'jackpot' && !this.secondFlashDone && this.timedAge > 2) {
        this.secondFlashDone = true;
        this.flash(0.35, this.focusColor, time, reducedMotion);
      }
      if (this.timedAge >= this.timedDuration) this.timed = null;
    }
    this.flashAge += dt;
    const mode = this.effective();
    const p = mode === 'off' ? null : PARAMS[mode];
    const motion = reducedMotion ? 0.15 : 1;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const want = p && i < p.beams ? 1 : 0;
      this.level[i] = approach(this.level[i]!, want, want > this.level[i]! ? 3 : 2.2, dt);
    }
    this.alpha = approach(this.alpha, p ? p.alpha : this.alpha, 2.5, dt);
    this.sweep = approach(this.sweep, (p ? p.sweep : 0.2) * motion, 2, dt);
    this.width0 = approach(this.width0, p ? p.width0 : this.width0, 2, dt);
    this.width1 = approach(this.width1, p ? p.width1 : this.width1, 2, dt);
    this.spot = approach(this.spot, p ? p.spot : 0, 2.5, dt);
    this.chase = approach(this.chase, p ? p.chase : 0, 2.5, dt);
    this.chaseSpeed = approach(this.chaseSpeed, (p ? p.chaseSpeed : 2) * motion, 2, dt);
    this.chasePhase += this.chaseSpeed * dt;
    this.led = approach(this.led, p ? p.led : 0, 3, dt);
    this.ring = approach(this.ring, mode === 'jackpot' ? 1 : 0, 3, dt);
    for (let i = 0; i < MAX_BEAMS; i++) {
      this.phaseX[i] = this.phaseX[i]! + dt * this.sweep * (0.7 + 0.13 * i);
      this.phaseZ[i] = this.phaseZ[i]! + dt * this.sweep * (0.52 + 0.09 * i);
    }
  }

  /** Energy (0..1) to add to the cabinet LED strips. */
  ledEnergy(lightScale: number): number {
    if (!this.enabled) return 0;
    return Math.min(1, this.led * lightScale);
  }

  /** Writes beams, floor pools, the LED chase, the flash and the jackpot ring. */
  write(batch: SpriteBatch, pal: ThemePalettes, time: number, reducedMotion: boolean, lightScale: number): void {
    this.beamsDrawn = 0;
    this.flashVisible = false;
    if (!(lightScale > 0)) return;
    const mode = this.effective();
    const jackpot = this.timed === 'jackpot' && this.enabled;
    const win = this.timed === 'win' && this.enabled;
    // Beams converge on the prize exit at the start of a timed show, then sweep again.
    const converge = this.timed && this.enabled ? 1 - smooth(0.5, 1.3, this.timedAge) : 0;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const level = this.level[i]! * this.alpha * lightScale;
      if (level < 0.002) continue;
      let strobe = 1;
      if (jackpot && !reducedMotion) strobe = fract(time * JACKPOT_STROBE_HZ + i * 0.5) < 0.5 ? 1 : 0.3;
      const src = BEAM_SOURCES[i]!;
      const sx = src[0];
      const sz = src[1];
      let tx = clamp(sx * 0.35 + Math.sin(this.phaseX[i]!) * 0.36, -0.46, 0.46);
      let tz = clamp(-0.4 + Math.sin(this.phaseZ[i]!) * 0.3, -0.74, -0.06);
      if (converge > 0) {
        const ox = Math.cos(i * 1.7) * 0.05;
        const oz = Math.sin(i * 1.7) * 0.04;
        tx += (clamp(this.focus.x + ox, -0.48, 0.48) - tx) * converge;
        tz += (clamp(this.focus.z + oz, -0.76, -0.04) - tz) * converge;
      }
      const ty = 0.004;
      if (jackpot) pal.hue(time * (reducedMotion ? 0.03 : 0.35) + i / MAX_BEAMS, _c);
      else if (win && i % 2 === 1) {
        _c.r = this.focusColor.r;
        _c.g = this.focusColor.g;
        _c.b = this.focusColor.b;
      } else if (mode === 'idle') {
        _c.r = pal.glow.r;
        _c.g = pal.glow.g;
        _c.b = pal.glow.b;
      } else pal.ui.blend(i * 0.9 + time * (reducedMotion ? 0.02 : 0.15), _c);
      saturate(_c, 1 + 0.7 * this.brightness);
      const a = Math.min(1, level * strobe * (1 + 0.9 * this.brightness));
      const cover = 0.2 + 0.4 * this.brightness;
      batch.push(sx, SOURCE_Y, sz, tx - sx, ty - SOURCE_Y, tz - sz, _c.r, _c.g, _c.b, a, this.width0, i * 1.7, BEAM_CODE, this.width1, cover);
      // Pool of light where the beam meets the floor (or the toys).
      batch.push(tx, ty, tz, 0, 0, 0, _c.r, _c.g, _c.b, Math.min(1, a * this.spot * 2.4), this.width1 * 1.3, 0, SPOT_CODE, 0, cover * 0.5);
      // A glint dancing in the pool while the machine invites players.
      if (mode === 'attract' && !reducedMotion) {
        const tw = Math.pow(Math.max(0, Math.sin(time * 2.2 + i * 1.3)), 8);
        if (tw > 0.02) batch.push(tx, 0.03, tz, 0, 0, 0, 1.6, 1.6, 1.6, Math.min(1, tw * 0.9 * lightScale), 0.026, time * 0.6, STAR_CODE, 0, 0.4);
      }
      this.beamsDrawn++;
    }

    const chase = this.chase * lightScale;
    if (chase > 0.01) {
      for (let j = 0; j < CHASE_COUNT; j++) {
        const x = CHASE_X0 + ((CHASE_X1 - CHASE_X0) * j) / (CHASE_COUNT - 1);
        const b = reducedMotion ? 0.55 : 0.12 + 0.88 * Math.pow(Math.max(0, Math.sin(this.chasePhase - j * 0.55)), 6);
        if (jackpot) pal.hue(j / CHASE_COUNT + time * (reducedMotion ? 0.02 : 0.4), _c, 1.4);
        else pal.led.get(j, _c, 1.4);
        batch.push(x, CHASE_Y, CHASE_Z, 0, 0, 0, _c.r, _c.g, _c.b, Math.min(1, chase * b), 0.012, 0, GLOW_CODE, 0, 0.4);
      }
    }

    if (this.flashAge < 0.6 && this.enabled && !reducedMotion) {
      const a = this.flashStrength * Math.exp(-this.flashAge * 7) * lightScale;
      if (a > 0.004) {
        const fc = this.flashColor;
        batch.push(this.focus.x * 0.4, 0.42, -0.03, 0, 0, 0, fc.r, fc.g, fc.b, Math.min(0.85, a), 0.95, 0, FLASH_CODE, 0, 0);
        this.flashVisible = true;
      }
    }

    const ring = this.ring * lightScale;
    if (ring > 0.01) {
      const f = this.focus;
      const y = Math.max(0.006, f.y);
      const pulse = reducedMotion ? 0 : Math.sin(time * 4) * 0.03;
      if (pal.rainbow) {
        batch.push(f.x, y, f.z, time * 0.1, 0.14, 0, 1, 1, 1, Math.min(1, ring * 0.9), 0.15 + pulse, reducedMotion ? 0 : time * 0.8, RAINBOW_CODE, 0.6, 0.35);
        batch.push(f.x, y + 0.004, f.z, 0.5, 0.08, 0, 1, 1, 1, Math.min(1, ring * 0.5), 0.21 - pulse, reducedMotion ? 0 : -time * 0.5, RAINBOW_CODE, 0.8, 0.35);
      } else {
        // Brand-kit theme: the jackpot ring is the brand green inside a white one.
        const g = pal.primary;
        batch.push(f.x, y, f.z, 0, 0.14, 0, g.r * 1.6, g.g * 1.6, g.b * 1.6, Math.min(1, ring * 0.9), 0.15 + pulse, 0, RING_CODE, 0.6, 0.35);
        batch.push(f.x, y + 0.004, f.z, 0, 0.08, 0, 1.4, 1.4, 1.4, Math.min(1, ring * 0.5), 0.21 - pulse, 0, RING_CODE, 0.8, 0.35);
      }
    }
  }
}

/** Pushes a colour away from its grey value (k > 1 = more saturated), keeping it non-negative. */
function saturate(c: Rgb, k: number): void {
  const grey = (c.r + c.g + c.b) / 3;
  c.r = Math.max(0, grey + (c.r - grey) * k);
  c.g = Math.max(0, grey + (c.g - grey) * k);
  c.b = Math.max(0, grey + (c.b - grey) * k);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
