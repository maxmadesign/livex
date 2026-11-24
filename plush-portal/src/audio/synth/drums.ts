/** Drum and small-percussion voices. All are short mono one-shots. */
import { SR, TAU, makeRng, type Rng } from './core';
import { Biquad, OnePole } from './dsp';

function fadeTail(buf: Float32Array, ms = 5): void {
  const n = Math.min(buf.length, Math.round((ms / 1000) * SR));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] = buf[buf.length - 1 - i]! * (i / n);
}

export interface KickOptions {
  f0: number;
  f1: number;
  pitchTau: number;
  ampTau: number;
  click: number;
  drive: number;
  /** Low-pass on the whole drum, Hz (soft / lo-fi kicks). */
  tone: number;
}

export const KICKS = {
  /** Small and round: kawaii electronic. */
  soft: { f0: 118, f1: 47, pitchTau: 0.032, ampTau: 0.13, click: 0.06, drive: 1.2, tone: 3200 },
  /** Felt concert bass drum, no click. */
  felt: { f0: 88, f1: 50, pitchTau: 0.05, ampTau: 0.2, click: 0.0, drive: 1.0, tone: 1500 },
  /** Dusty lo-fi kick. */
  lofi: { f0: 98, f1: 43, pitchTau: 0.04, ampTau: 0.19, click: 0.03, drive: 1.5, tone: 2200 },
  /** Punchy synth-pop kick. */
  pop: { f0: 165, f1: 49, pitchTau: 0.028, ampTau: 0.17, click: 0.22, drive: 1.8, tone: 6500 },
} as const satisfies Record<string, KickOptions>;

export function kick(o: KickOptions, rng: Rng): Float32Array {
  const n = Math.round(Math.min(0.6, o.ampTau * 4.2) * SR);
  const out = new Float32Array(n);
  const lp = Biquad.lowpass(o.tone, 0.7);
  const hp = new OnePole(3000);
  let phase = 0;
  const att = Math.round(0.0015 * SR);
  const norm = 1 / Math.tanh(o.drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / o.pitchTau);
    phase += f / SR;
    let x = Math.tanh(Math.sin(TAU * phase) * o.drive) * norm;
    x += hp.hp(rng() * 2 - 1) * o.click * Math.exp(-t / 0.003);
    let g = Math.exp(-t / o.ampTau);
    if (i < att) g *= i / att;
    out[i] = lp.process(x * g) * 0.85;
  }
  fadeTail(out, 8);
  return out;
}

export interface SnareOptions {
  tone: number;
  toneAmt: number;
  noiseLo: number;
  noiseHi: number;
  ampTau: number;
}

export const SNARES = {
  soft: { tone: 190, toneAmt: 0.45, noiseLo: 1500, noiseHi: 6500, ampTau: 0.07 },
  arcade: { tone: 210, toneAmt: 0.35, noiseLo: 1800, noiseHi: 8500, ampTau: 0.085 },
  lofi: { tone: 175, toneAmt: 0.5, noiseLo: 900, noiseHi: 4200, ampTau: 0.09 },
} as const satisfies Record<string, SnareOptions>;

export function snare(o: SnareOptions, rng: Rng): Float32Array {
  const n = Math.round(Math.min(0.45, o.ampTau * 5) * SR);
  const out = new Float32Array(n);
  const hp = Biquad.highpass(o.noiseLo, 0.7);
  const lp = Biquad.lowpass(o.noiseHi, 0.7);
  let phase = 0;
  const att = Math.round(0.001 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (o.tone * (1 + 0.25 * Math.exp(-t / 0.02))) / SR;
    const tone = Math.sin(TAU * phase) * o.toneAmt * Math.exp(-t / 0.045);
    const noise = lp.process(hp.process(rng() * 2 - 1)) * Math.exp(-t / o.ampTau);
    let g = 1;
    if (i < att) g = i / att;
    out[i] = (tone + noise * 0.75) * g * 0.7;
  }
  fadeTail(out, 6);
  return out;
}

/** Hand clap (several bursts) or a single-burst finger snap. */
export function clap(rng: Rng, opts: { snap?: boolean } = {}): Float32Array {
  const snap = !!opts.snap;
  const n = Math.round((snap ? 0.14 : 0.24) * SR);
  const out = new Float32Array(n);
  const bp = Biquad.bandpass(snap ? 2300 : 1350, snap ? 2.2 : 1.1);
  const hp = Biquad.highpass(snap ? 1200 : 650, 0.7);
  const offsets = snap ? [0] : [0, 0.0085, 0.018, 0.027];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    offsets.forEach((o, k) => {
      if (t >= o) {
        const last = k === offsets.length - 1;
        env += Math.exp(-(t - o) / (last ? (snap ? 0.022 : 0.055) : 0.006)) * (last ? 1 : 0.7);
      }
    });
    out[i] = hp.process(bp.process(rng() * 2 - 1)) * env * (snap ? 1.6 : 1.0);
  }
  const att = Math.round(0.0006 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 6);
  return out;
}

export function hat(rng: Rng, opts: { open?: boolean; bright?: number } = {}): Float32Array {
  const tau = opts.open ? 0.11 : 0.017;
  const n = Math.round((opts.open ? 0.42 : 0.08) * SR);
  const out = new Float32Array(n);
  const b = opts.bright ?? 1;
  const hp1 = Biquad.highpass(6500 * b, 0.8);
  const hp2 = Biquad.highpass(7500 * b, 0.8);
  const lp = Biquad.lowpass(13500, 0.7);
  const att = Math.round(0.0008 * SR);
  for (let i = 0; i < n; i++) {
    let g = Math.exp(-i / (tau * SR));
    if (i < att) g *= i / att;
    out[i] = lp.process(hp2.process(hp1.process(rng() * 2 - 1))) * g * 0.9;
  }
  fadeTail(out, 5);
  return out;
}

/** Shaker: the level swells briefly before it falls, which gives the "shh-k" shape. */
export function shaker(rng: Rng, opts: { accent?: number; freq?: number } = {}): Float32Array {
  const n = Math.round(0.11 * SR);
  const out = new Float32Array(n);
  const bp = Biquad.bandpass(opts.freq ?? 6200, 0.9);
  const hp = Biquad.highpass(3200, 0.7);
  const swell = Math.round(0.014 * SR);
  const a = opts.accent ?? 1;
  for (let i = 0; i < n; i++) {
    const g = i < swell ? Math.pow(i / swell, 1.6) : Math.exp(-(i - swell) / (0.022 * SR));
    out[i] = hp.process(bp.process(rng() * 2 - 1)) * g * a * 1.3;
  }
  fadeTail(out, 5);
  return out;
}

/** Side-stick / rim click. */
export function rim(rng: Rng): Float32Array {
  const n = Math.round(0.07 * SR);
  const out = new Float32Array(n);
  const hp = new OnePole(2500);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const tone = Math.sin(TAU * 1650 * t) * 0.6 + Math.sin(TAU * 3900 * t) * 0.25;
    out[i] = (tone * Math.exp(-t / 0.009) + hp.hp(rng() * 2 - 1) * 0.35 * Math.exp(-t / 0.002)) * 0.8;
  }
  const att = Math.round(0.0004 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 4);
  return out;
}

export function woodblock(rng: Rng, freq = 880): Float32Array {
  const n = Math.round(0.12 * SR);
  const out = new Float32Array(n);
  const hp = new OnePole(1800);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const body = Math.sin(TAU * freq * t) * Math.exp(-t / 0.028) + Math.sin(TAU * freq * 2.71 * t) * 0.35 * Math.exp(-t / 0.012);
    out[i] = (body + hp.hp(rng() * 2 - 1) * 0.2 * Math.exp(-t / 0.0015)) * 0.7;
  }
  const att = Math.round(0.0005 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 5);
  return out;
}

export function triangle(rng: Rng, opts: { muted?: boolean } = {}): Float32Array {
  const t60 = opts.muted ? 0.18 : 1.5;
  const n = Math.round(t60 * 0.95 * SR);
  const out = new Float32Array(n);
  const base = 4350;
  const partials: [number, number][] = [
    [1, 1],
    [1.48, 0.55],
    [2.09, 0.4],
    [2.87, 0.22],
    [3.55, 0.12],
  ];
  for (const [ratio, amp] of partials) {
    const w = (TAU * base * ratio) / SR;
    const d = Math.exp(-6.9 / (t60 * (1.1 - 0.12 * ratio) * SR));
    const c = Math.cos(w) * d;
    const s = Math.sin(w) * d;
    const ph = rng() * TAU;
    let re = amp * Math.cos(ph);
    let im = amp * Math.sin(ph);
    for (let i = 0; i < n; i++) {
      out[i] = out[i]! + im;
      const nr = re * c - im * s;
      im = re * s + im * c;
      re = nr;
    }
  }
  const att = Math.round(0.001 * SR);
  for (let i = 0; i < n; i++) out[i] = out[i]! * 0.22 * (i < att ? i / att : 1);
  fadeTail(out, 10);
  return out;
}

export function tambourine(rng: Rng): Float32Array {
  const n = Math.round(0.2 * SR);
  const out = new Float32Array(n);
  const hp = Biquad.highpass(5200, 0.8);
  const bp = Biquad.peaking(9000, 1.2, 6);
  const grains = [0, 0.011, 0.019, 0.031, 0.044, 0.058].map((t) => ({ t: t + rng() * 0.004, a: 0.5 + rng() * 0.5 }));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const g of grains) if (t >= g.t) env += g.a * Math.exp(-(t - g.t) / 0.02);
    out[i] = bp.process(hp.process(rng() * 2 - 1)) * env * 0.28;
  }
  fadeTail(out, 6);
  return out;
}

/** Brush swish on a snare head. */
export function brush(rng: Rng, opts: { long?: boolean } = {}): Float32Array {
  const n = Math.round((opts.long ? 0.26 : 0.13) * SR);
  const out = new Float32Array(n);
  const bp = Biquad.bandpass(3400, 0.5);
  const hp = Biquad.highpass(900, 0.7);
  const swell = Math.round((opts.long ? 0.09 : 0.02) * SR);
  for (let i = 0; i < n; i++) {
    const g = i < swell ? Math.pow(i / swell, 1.3) : Math.exp(-(i - swell) / ((opts.long ? 0.06 : 0.035) * SR));
    out[i] = hp.process(bp.process(rng() * 2 - 1)) * g * 0.9;
  }
  fadeTail(out, 6);
  return out;
}

export function tom(rng: Rng, freq = 150, opts: { arcade?: boolean } = {}): Float32Array {
  const n = Math.round(0.34 * SR);
  const out = new Float32Array(n);
  let phase = 0;
  const lp = Biquad.lowpass(opts.arcade ? 3200 : 2400, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq * (1 + 0.7 * Math.exp(-t / 0.035));
    phase += f / SR;
    let x = Math.sin(TAU * phase);
    if (opts.arcade) x = Math.tanh(x * 3) * 0.75;
    x += (rng() * 2 - 1) * 0.08 * Math.exp(-t / 0.01);
    out[i] = lp.process(x) * Math.exp(-t / 0.085) * 0.8;
  }
  const att = Math.round(0.001 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 8);
  return out;
}

/** Soft laser "pew": a pulse sweeping down, low-passed so it never bites. */
export function zap(_rng: Rng, opts: { from?: number; to?: number; seconds?: number } = {}): Float32Array {
  const seconds = opts.seconds ?? 0.14;
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const from = opts.from ?? 1900;
  const to = opts.to ?? 260;
  const lp = Biquad.lowpass(4200, 0.8);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = from * Math.pow(to / from, t);
    phase += f / SR;
    const x = (phase % 1 < 0.4 ? 1 : -1) + 0.2;
    out[i] = lp.process(x) * (1 - t) * (1 - t) * 0.42;
  }
  const att = Math.round(0.0015 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 6);
  return out;
}

/** Tiny square blip. */
export function blip(_rng: Rng, freq = 1320, seconds = 0.05): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const lp = Biquad.lowpass(5200, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = (freq * t) % 1 < 0.5 ? 1 : -1;
    out[i] = lp.process(x) * Math.exp(-t / (seconds * 0.4)) * 0.4;
  }
  const att = Math.round(0.001 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 5);
  return out;
}

/** Noise riser used as a soft transition into a new section. */
export function swell(rng: Rng, seconds: number, opts: { from?: number; to?: number } = {}): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const from = opts.from ?? 1200;
  const to = opts.to ?? 7500;
  let bp = Biquad.bandpass(from, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if ((i & 255) === 0) {
      const next = Biquad.bandpass(from * Math.pow(to / from, t), 1.2);
      // Carry the response over by swapping coefficients only.
      bp.b0 = next.b0;
      bp.b1 = next.b1;
      bp.b2 = next.b2;
      bp.a1 = next.a1;
      bp.a2 = next.a2;
    }
    out[i] = bp.process(rng() * 2 - 1) * Math.pow(t, 2.4) * 0.6;
  }
  fadeTail(out, 30);
  return out;
}

/* ---------------------------------------------------------------------- kit */

export type DrumName =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'snap'
  | 'hat'
  | 'openHat'
  | 'shaker'
  | 'shakerAccent'
  | 'rim'
  | 'woodHi'
  | 'woodLo'
  | 'triangle'
  | 'triangleMute'
  | 'tambourine'
  | 'brush'
  | 'brushLong'
  | 'tomHi'
  | 'tomMid'
  | 'tomLo'
  | 'zap'
  | 'blipHi'
  | 'blipLo';

export interface KitOptions {
  kick: KickOptions;
  snare: SnareOptions;
  arcadeToms?: boolean;
  seed: number;
}

/**
 * A kit renders every drum a few times with different noise seeds and hands the
 * variants out round-robin, so repeated hits never sound machine-identical.
 */
export class DrumKit {
  private readonly cache = new Map<string, Float32Array[]>();
  private readonly counters = new Map<string, number>();
  constructor(private readonly opts: KitOptions) {}

  private render(name: DrumName, rng: Rng): Float32Array {
    const o = this.opts;
    switch (name) {
      case 'kick':
        return kick(o.kick, rng);
      case 'snare':
        return snare(o.snare, rng);
      case 'clap':
        return clap(rng);
      case 'snap':
        return clap(rng, { snap: true });
      case 'hat':
        return hat(rng);
      case 'openHat':
        return hat(rng, { open: true });
      case 'shaker':
        return shaker(rng, { accent: 0.8 });
      case 'shakerAccent':
        return shaker(rng, { accent: 1.15, freq: 6800 });
      case 'rim':
        return rim(rng);
      case 'woodHi':
        return woodblock(rng, 980);
      case 'woodLo':
        return woodblock(rng, 720);
      case 'triangle':
        return triangle(rng);
      case 'triangleMute':
        return triangle(rng, { muted: true });
      case 'tambourine':
        return tambourine(rng);
      case 'brush':
        return brush(rng);
      case 'brushLong':
        return brush(rng, { long: true });
      case 'tomHi':
        return tom(rng, 210, { arcade: o.arcadeToms });
      case 'tomMid':
        return tom(rng, 160, { arcade: o.arcadeToms });
      case 'tomLo':
        return tom(rng, 118, { arcade: o.arcadeToms });
      case 'zap':
        return zap(rng);
      case 'blipHi':
        return blip(rng, 1568, 0.05);
      case 'blipLo':
        return blip(rng, 1046.5, 0.05);
    }
  }

  hit(name: DrumName): Float32Array {
    let variants = this.cache.get(name);
    if (!variants) {
      variants = [];
      const count = name === 'kick' || name.startsWith('tom') || name === 'zap' || name.startsWith('blip') ? 2 : 4;
      for (let v = 0; v < count; v++) variants.push(this.render(name, makeRng(this.opts.seed + v * 7919 + name.length * 131 + name.charCodeAt(0))));
      this.cache.set(name, variants);
    }
    const c = this.counters.get(name) ?? 0;
    this.counters.set(name, c + 1);
    return variants[c % variants.length]!;
  }
}
