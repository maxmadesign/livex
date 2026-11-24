/**
 * Core types for the offline synthesiser. Everything in src/audio/synth is pure
 * TypeScript (no DOM, no Web Audio, no Node APIs) so the same code renders the
 * shipped assets in Node (tools/audio/bake.ts) and the in-browser fallback in a
 * Worker (src/audio/synthWorker.ts).
 */

export const SR = 44100;
export const TAU = Math.PI * 2;

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-12));
export const secToSamples = (sec: number): number => Math.max(0, Math.round(sec * SR));

/** Deterministic PRNG (mulberry32). Every render is seeded so bakes are reproducible. */
export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A rendered voice: mono, or stereo when `r` is present. */
export interface Voice {
  l: Float32Array;
  r?: Float32Array;
}

/** Constant-power pan gains for pan in -1..1. */
export function panGains(pan: number): [number, number] {
  const p = Math.min(1, Math.max(-1, pan));
  const a = ((p + 1) / 2) * (Math.PI / 2);
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Stereo accumulation buffer. With `wrap` set, anything written past the end
 * continues at the start, which is what makes rendered loops periodic: note
 * tails of the last bar ring into the first bar exactly as they will when the
 * loop repeats.
 */
export class Stem {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(
    public readonly length: number,
    public readonly wrap = false,
  ) {
    this.l = new Float32Array(length);
    this.r = new Float32Array(length);
  }

  /** Mixes a voice in at `start` (samples) with a gain and constant-power pan. */
  add(voice: Voice, start: number, gain = 1, pan = 0): void {
    const [pl, pr] = panGains(pan);
    const n = voice.l.length;
    const len = this.length;
    let s = Math.round(start);
    if (this.wrap) {
      s = ((s % len) + len) % len;
    }
    const src = voice.l;
    const srcR = voice.r;
    const gl = gain * pl * (srcR ? Math.SQRT2 : 1);
    const gr = gain * pr * (srcR ? Math.SQRT2 : 1);
    let i = 0;
    if (s < 0) {
      i = -s;
      s = 0;
    }
    let idx = s;
    for (; i < n; i++) {
      if (idx >= len) {
        if (!this.wrap) break;
        idx -= len;
      }
      if (srcR) {
        this.l[idx] = this.l[idx]! + src[i]! * gl;
        this.r[idx] = this.r[idx]! + srcR[i]! * gr;
      } else {
        const v = src[i]!;
        this.l[idx] = this.l[idx]! + v * gl;
        this.r[idx] = this.r[idx]! + v * gr;
      }
      idx++;
    }
  }

  scale(gain: number): void {
    for (let i = 0; i < this.length; i++) {
      this.l[i] = this.l[i]! * gain;
      this.r[i] = this.r[i]! * gain;
    }
  }

  mixInto(target: Stem, gain = 1): void {
    const n = Math.min(this.length, target.length);
    for (let i = 0; i < n; i++) {
      target.l[i] = target.l[i]! + this.l[i]! * gain;
      target.r[i] = target.r[i]! + this.r[i]! * gain;
    }
  }
}

export function peakOf(...channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]!);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

export function rmsOf(...channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    count += ch.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

export function hasInvalidSamples(...channels: Float32Array[]): boolean {
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      if (!Number.isFinite(ch[i]!)) return true;
    }
  }
  return false;
}

/** Linear fade applied in place; used to guarantee click-free starts / ends of one-shots. */
export function applyFades(buf: Float32Array, fadeInSamples: number, fadeOutSamples: number): void {
  const n = buf.length;
  const fi = Math.min(fadeInSamples, n);
  for (let i = 0; i < fi; i++) buf[i] = buf[i]! * (i / fi);
  const fo = Math.min(fadeOutSamples, n);
  for (let i = 0; i < fo; i++) buf[n - 1 - i] = buf[n - 1 - i]! * (i / fo);
}
