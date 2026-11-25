import { FIELD } from '../../physics/fieldSpec';
import { BEH, FAMILY } from './constants';

/**
 * Reusable description of one particle. Recipes fill it in and call
 * `ParticlePool.emit`, which copies the values: no object is created per particle.
 */
export class ParticleSpec {
  shape = 0;
  mode = 0;
  beh: number = BEH.BALLISTIC;
  tag: number = FAMILY.NONE;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  life = 1;
  size0 = 0.01;
  size1 = 0.01;
  rot = 0;
  spin = 0;
  r = 1;
  g = 1;
  b = 1;
  a = 1;
  drag = 0;
  grav = 0;
  /** Seconds to fade in. */
  fadeIn = 0.04;
  /** Fraction of the life spent fading out. */
  fadeOut = 0.35;
  sway = 0;
  swayFreq = 0;
  flip = 0;
  flipSpeed = 0;
  cx = 0;
  cy = 0;
  cz = 0;
  ang = 0;
  angV = 0;
  rad = 0;
  radV = 0;
  /** Axial streak length in seconds of velocity (0 = not stretched). */
  stretch = 0;
  /** Twinkle frequency in rad/s (0 = steady). */
  twinkle = 0;
  extra0 = 0;
  extra1 = 0;
  aux = 0;
  /** 0 = pure additive light … 1 = opaque paper (see shaders.ts). */
  cover = 0.3;

  reset(): this {
    this.shape = 0;
    this.mode = 0;
    this.beh = BEH.BALLISTIC;
    this.tag = FAMILY.NONE;
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.life = 1;
    this.size0 = this.size1 = 0.01;
    this.rot = this.spin = 0;
    this.r = this.g = this.b = this.a = 1;
    this.drag = this.grav = 0;
    this.fadeIn = 0.04;
    this.fadeOut = 0.35;
    this.sway = this.swayFreq = this.flip = this.flipSpeed = 0;
    this.cx = this.cy = this.cz = 0;
    this.ang = this.angV = this.rad = this.radV = 0;
    this.stretch = this.twinkle = 0;
    this.extra0 = this.extra1 = this.aux = 0;
    this.cover = 0.3;
    return this;
  }
}

/** Shell bursts recorded during `simulate`: x, y, z, r, g, b, strength, rainbow. */
export const SHELL_EVENT_STRIDE = 8;
/** Shell trail samples recorded during `simulate`: x, y, z, r, g, b, vx, vy, vz. */
export const TRAIL_EVENT_STRIDE = 9;
const MAX_SHELL_EVENTS = 24;
const MAX_TRAIL_EVENTS = 48;

/** Floor height and the chute opening (particles fall through the prize exit into the bin). */
const FLOOR_Y = 0.004;
const CHUTE_X = -0.2;
const CHUTE_Z = -0.3;
const WALL_X = FIELD.halfWidth - 0.01;
const FRONT_Z = -0.012;
const BACK_Z = -FIELD.depth + 0.01;
const CEILING_Y = FIELD.ceilingY - 0.02;

/**
 * Fixed-capacity particle storage in structure-of-arrays form. Dead particles are
 * removed by moving the last live particle into their slot, so live particles are
 * always the dense range [0, count). Capacity never grows; when the pool is full a
 * spawn is dropped and counted.
 */
export class ParticlePool {
  readonly capacity: number;
  count = 0;
  /** Spawns refused because the pool was full (since construction). */
  dropped = 0;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly a: Float32Array;
  readonly drag: Float32Array;
  readonly grav: Float32Array;
  readonly fadeIn: Float32Array;
  readonly fadeOut: Float32Array;
  readonly sway: Float32Array;
  readonly swayFreq: Float32Array;
  readonly flip: Float32Array;
  readonly flipSpeed: Float32Array;
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly cz: Float32Array;
  readonly ang: Float32Array;
  readonly angV: Float32Array;
  readonly rad: Float32Array;
  readonly radV: Float32Array;
  readonly stretch: Float32Array;
  readonly twinkle: Float32Array;
  readonly extra0: Float32Array;
  readonly extra1: Float32Array;
  readonly aux: Float32Array;
  readonly cover: Float32Array;
  readonly seed: Float32Array;
  readonly shape: Uint8Array;
  readonly mode: Uint8Array;
  readonly beh: Uint8Array;
  readonly tag: Uint8Array;
  /** Every array above, for the swap-remove copy. */
  private readonly fields: (Float32Array | Uint8Array)[];

  /** Firework shells that ended during the last `simulate` (see SHELL_EVENT_STRIDE). */
  readonly shellEvents = new Float32Array(MAX_SHELL_EVENTS * SHELL_EVENT_STRIDE);
  shellEventCount = 0;
  /** Live shells during the last `simulate` (trail emission), TRAIL_EVENT_STRIDE floats each. */
  readonly trailEvents = new Float32Array(MAX_TRAIL_EVENTS * TRAIL_EVENT_STRIDE);
  trailEventCount = 0;

  /** The floor hole particles fall through into the bin (classic: the chute, open towards the glass). */
  private holeXMin = -Infinity;
  private holeXMax = CHUTE_X;
  private holeZMin = CHUTE_Z;
  private holeZMax = Infinity;

  /** The machine's floor hole (an edge on the glass is left open, as the chute's). */
  setHole(xMin: number, xMax: number, zMin: number, zMax: number): void {
    this.holeXMin = xMin <= -FIELD.halfWidth + 1e-6 ? -Infinity : xMin;
    this.holeXMax = xMax >= FIELD.halfWidth - 1e-6 ? Infinity : xMax;
    this.holeZMin = zMin <= -FIELD.depth + 1e-6 ? -Infinity : zMin;
    this.holeZMax = zMax >= -1e-6 ? Infinity : zMax;
  }

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    const u = () => new Uint8Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.life = f();
    this.maxLife = f();
    this.size0 = f();
    this.size1 = f();
    this.rot = f();
    this.spin = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.a = f();
    this.drag = f();
    this.grav = f();
    this.fadeIn = f();
    this.fadeOut = f();
    this.sway = f();
    this.swayFreq = f();
    this.flip = f();
    this.flipSpeed = f();
    this.cx = f();
    this.cy = f();
    this.cz = f();
    this.ang = f();
    this.angV = f();
    this.rad = f();
    this.radV = f();
    this.stretch = f();
    this.twinkle = f();
    this.extra0 = f();
    this.extra1 = f();
    this.aux = f();
    this.cover = f();
    this.seed = f();
    this.shape = u();
    this.mode = u();
    this.beh = u();
    this.tag = u();
    this.fields = [
      this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.size0, this.size1,
      this.rot, this.spin, this.r, this.g, this.b, this.a, this.drag, this.grav, this.fadeIn, this.fadeOut,
      this.sway, this.swayFreq, this.flip, this.flipSpeed, this.cx, this.cy, this.cz, this.ang, this.angV,
      this.rad, this.radV, this.stretch, this.twinkle, this.extra0, this.extra1, this.aux, this.cover, this.seed,
      this.shape, this.mode, this.beh, this.tag,
    ];
  }

  get free(): number {
    return this.capacity - this.count;
  }

  /** Copies `s` into a free slot. Returns the slot or -1 when the pool is full. */
  emit(s: ParticleSpec, seed: number): number {
    if (this.count >= this.capacity) {
      this.dropped++;
      return -1;
    }
    const i = this.count++;
    this.px[i] = s.x;
    this.py[i] = s.y;
    this.pz[i] = s.z;
    this.vx[i] = s.vx;
    this.vy[i] = s.vy;
    this.vz[i] = s.vz;
    const life = Math.max(0.02, s.life);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = s.size0;
    this.size1[i] = s.size1;
    this.rot[i] = s.rot;
    this.spin[i] = s.spin;
    this.r[i] = s.r;
    this.g[i] = s.g;
    this.b[i] = s.b;
    this.a[i] = s.a;
    this.drag[i] = s.drag;
    this.grav[i] = s.grav;
    this.fadeIn[i] = s.fadeIn;
    this.fadeOut[i] = s.fadeOut;
    this.sway[i] = s.sway;
    this.swayFreq[i] = s.swayFreq;
    this.flip[i] = s.flip;
    this.flipSpeed[i] = s.flipSpeed;
    this.cx[i] = s.cx;
    this.cy[i] = s.cy;
    this.cz[i] = s.cz;
    this.ang[i] = s.ang;
    this.angV[i] = s.angV;
    this.rad[i] = s.rad;
    this.radV[i] = s.radV;
    this.stretch[i] = s.stretch;
    this.twinkle[i] = s.twinkle;
    this.extra0[i] = s.extra0;
    this.extra1[i] = s.extra1;
    this.aux[i] = s.aux;
    this.cover[i] = s.cover;
    this.seed[i] = seed;
    this.shape[i] = s.shape;
    this.mode[i] = s.mode;
    this.beh[i] = s.beh;
    this.tag[i] = s.tag;
    return i;
  }

  clear(): void {
    this.count = 0;
    this.shellEventCount = 0;
    this.trailEventCount = 0;
  }

  /** Live particles of one family. */
  countTag(tag: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.tag[i] === tag) n++;
    return n;
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const fields = this.fields;
    for (let k = 0; k < fields.length; k++) {
      const arr = fields[k]!;
      arr[i] = arr[last]!;
    }
  }

  /** Advances every particle by `dt` seconds; `time` is the effects clock (for sway). */
  simulate(dt: number, time: number): void {
    this.shellEventCount = 0;
    this.trailEventCount = 0;
    if (!(dt > 0)) return;
    let i = 0;
    while (i < this.count) {
      const life = this.life[i]! - dt;
      const beh = this.beh[i]!;
      if (life <= 0 || this.py[i]! < -0.6) {
        if (beh === BEH.SHELL && life <= 0) this.recordShell(i);
        this.removeAt(i);
        continue;
      }
      this.life[i] = life;
      this.rot[i] = this.rot[i]! + this.spin[i]! * dt;
      if (this.flipSpeed[i] !== 0) this.flip[i] = this.flip[i]! + this.flipSpeed[i]! * dt;
      switch (beh) {
        case BEH.FIXED:
        case BEH.RAY:
          break;
        case BEH.ORBIT: {
          this.ang[i] = this.ang[i]! + this.angV[i]! * dt;
          this.rad[i] = Math.max(0, this.rad[i]! + this.radV[i]! * dt);
          this.cy[i] = this.cy[i]! + this.vy[i]! * dt;
          const a = this.ang[i]!;
          this.px[i] = this.cx[i]! + Math.cos(a) * this.rad[i]!;
          this.py[i] = this.cy[i]!;
          this.pz[i] = this.cz[i]! + Math.sin(a) * this.rad[i]! * 0.8;
          break;
        }
        default: {
          // BALLISTIC, FLUTTER, RISE, SHELL: gravity (or buoyancy) and linear drag.
          const k = Math.max(0, 1 - this.drag[i]! * dt);
          let vx = this.vx[i]! * k;
          let vy = this.vy[i]! * k + this.grav[i]! * dt;
          let vz = this.vz[i]! * k;
          let x = this.px[i]!;
          let y = this.py[i]!;
          let z = this.pz[i]!;
          x += vx * dt;
          y += vy * dt;
          z += vz * dt;
          const sway = this.sway[i]!;
          if (sway !== 0) {
            const ph = time * this.swayFreq[i]! + this.seed[i]!;
            x += Math.sin(ph) * sway * dt;
            z += Math.cos(ph * 0.73) * sway * 0.5 * dt;
          }
          // Stay inside the glass box; fall through the chute opening into the bin.
          if (z > FRONT_Z) {
            z = FRONT_Z;
            vz = -Math.abs(vz) * 0.3;
          } else if (z < BACK_Z) {
            z = BACK_Z;
            vz = Math.abs(vz) * 0.3;
          }
          if (x > WALL_X) {
            x = WALL_X;
            vx = -Math.abs(vx) * 0.3;
          } else if (x < -WALL_X) {
            x = -WALL_X;
            vx = Math.abs(vx) * 0.3;
          }
          if (y > CEILING_Y) {
            y = CEILING_Y;
            vy = -Math.abs(vy) * 0.2;
          } else if (y < FLOOR_Y && y > -0.03 && !(x > this.holeXMin && x < this.holeXMax && z > this.holeZMin && z < this.holeZMax)) {
            // Landed: lie on the floor (confetti settles flat, sparks die out).
            y = FLOOR_Y;
            if (vy < 0) vy = 0;
            vx *= 0.6;
            vz *= 0.6;
            this.spin[i] = this.spin[i]! * 0.5;
            this.flipSpeed[i] = this.flipSpeed[i]! * 0.5;
          }
          this.px[i] = x;
          this.py[i] = y;
          this.pz[i] = z;
          this.vx[i] = vx;
          this.vy[i] = vy;
          this.vz[i] = vz;
          if (beh === BEH.SHELL) this.recordTrail(i);
        }
      }
      i++;
    }
  }

  private recordShell(i: number): void {
    if (this.shellEventCount >= MAX_SHELL_EVENTS) return;
    const o = this.shellEventCount++ * SHELL_EVENT_STRIDE;
    const e = this.shellEvents;
    e[o] = this.px[i]!;
    e[o + 1] = this.py[i]!;
    e[o + 2] = this.pz[i]!;
    e[o + 3] = this.r[i]!;
    e[o + 4] = this.g[i]!;
    e[o + 5] = this.b[i]!;
    e[o + 6] = this.extra1[i]!; // burst strength
    e[o + 7] = this.aux[i]!; // 1 = rainbow
  }

  private recordTrail(i: number): void {
    if (this.trailEventCount >= MAX_TRAIL_EVENTS) return;
    const o = this.trailEventCount++ * TRAIL_EVENT_STRIDE;
    const e = this.trailEvents;
    e[o] = this.px[i]!;
    e[o + 1] = this.py[i]!;
    e[o + 2] = this.pz[i]!;
    e[o + 3] = this.r[i]!;
    e[o + 4] = this.g[i]!;
    e[o + 5] = this.b[i]!;
    e[o + 6] = this.vx[i]!;
    e[o + 7] = this.vy[i]!;
    e[o + 8] = this.vz[i]!;
  }
}
