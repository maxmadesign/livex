/** Small dependency-free math helpers shared by game, physics, tracking and tools. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, a: number, b: number, c: number, d: number): number {
  return lerp(c, d, clamp01(invLerp(a, b, v)));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential approach. `tau` is the time constant in
 * seconds (time to cover ~63% of the remaining distance).
 */
export function damp(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 1e-6) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Move `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Deterministic PRNG (mulberry32). Used for layouts and audio so results are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Second order spring (semi-implicit Euler, unconditionally well behaved for the
 * small steps we use). State is kept by the caller so it can live in typed arrays.
 */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;
  constructor(
    /** Undamped natural frequency in Hz. */
    public frequency = 4,
    /** Damping ratio: 1 = critically damped, <1 overshoots. */
    public damping = 0.5,
  ) {}

  step(dt: number): number {
    // Sub-step so that stiff springs stay stable on long frames.
    const w = TAU * this.frequency;
    const maxStep = 0.5 / Math.max(w, 1e-3);
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 16) {
      const h = Math.min(remaining, maxStep);
      const accel = -w * w * (this.value - this.target) - 2 * this.damping * w * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  kick(impulse: number): void {
    this.velocity += impulse;
  }

  snap(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  /** True once the spring has effectively come to rest at its target. */
  isResting(eps = 1e-4): boolean {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps * 10;
  }
}

export function vec3Length(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}
