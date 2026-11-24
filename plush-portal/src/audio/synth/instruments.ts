/**
 * Pitched instruments. Every function renders one note (or one chord for pads)
 * into a fresh mono / stereo buffer; sequencing and mixing happen elsewhere.
 */
import { SR, TAU, type Rng, type Voice } from './core';
import { Biquad, OnePole, Svf } from './dsp';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** PolyBLEP residual for band-limited steps. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function fadeTail(buf: Float32Array, ms = 6): void {
  const n = Math.min(buf.length, Math.round((ms / 1000) * SR));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] = buf[buf.length - 1 - i]! * (i / n);
}

/** A fraction of a millisecond is inaudible as an attack but guarantees a click-free first sample. */
function fadeHead(buf: Float32Array, ms = 0.25): void {
  const n = Math.min(buf.length, Math.max(2, Math.round((ms / 1000) * SR)));
  for (let i = 0; i < n; i++) buf[i] = buf[i]! * (i / n);
}

/* ------------------------------------------------------------------ mallets */

export interface ModalPartial {
  ratio: number;
  amp: number;
  /** Decay to -60 dB at the preset's reference pitch, seconds. */
  t60: number;
}

export interface MalletPreset {
  partials: ModalPartial[];
  refFreq: number;
  /** How strongly decay shortens with pitch: t60 · (ref / f)^decayExp. */
  decayExp: number;
  /** Level of the strike noise burst. */
  strike: number;
  strikeBand: [number, number];
  strikeMs: number;
  /** Soft onset in ms (0 = immediate strike). */
  attackMs: number;
  /** How much upper partials depend on velocity. */
  hardness: number;
  maxSeconds: number;
  /** Adds a slightly detuned second set of partials for shimmer (cents). */
  shimmerCents?: number;
}

export const MALLETS = {
  /** Rosewood bars: short, woody, bright. */
  xylophone: {
    partials: [
      { ratio: 1, amp: 1, t60: 0.6 },
      { ratio: 3.0, amp: 0.28, t60: 0.22 },
      { ratio: 6.02, amp: 0.09, t60: 0.1 },
      { ratio: 9.9, amp: 0.035, t60: 0.06 },
    ],
    refFreq: 523.25,
    decayExp: 0.55,
    strike: 0.22,
    strikeBand: [1500, 6000],
    strikeMs: 5,
    attackMs: 0,
    hardness: 0.6,
    maxSeconds: 1.2,
  },
  /** Warm, round, soft mallets. */
  marimba: {
    partials: [
      { ratio: 1, amp: 1, t60: 1.25 },
      { ratio: 2.0, amp: 0.05, t60: 0.6 },
      { ratio: 4.0, amp: 0.15, t60: 0.4 },
      { ratio: 9.6, amp: 0.03, t60: 0.12 },
    ],
    refFreq: 261.63,
    decayExp: 0.6,
    strike: 0.1,
    strikeBand: [250, 1400],
    strikeMs: 9,
    attackMs: 0.6,
    hardness: 0.8,
    maxSeconds: 1.8,
  },
  /** Steel bars: long bright ring. */
  glockenspiel: {
    partials: [
      { ratio: 1, amp: 1, t60: 2.3 },
      { ratio: 2.756, amp: 0.28, t60: 1.0 },
      { ratio: 5.404, amp: 0.12, t60: 0.5 },
      { ratio: 8.933, amp: 0.04, t60: 0.28 },
    ],
    refFreq: 1046.5,
    decayExp: 0.5,
    strike: 0.1,
    strikeBand: [4000, 10000],
    strikeMs: 2,
    attackMs: 0,
    hardness: 0.5,
    maxSeconds: 2.6,
  },
  /** Music-box / celesta: sweet and small. */
  celesta: {
    partials: [
      { ratio: 1, amp: 1, t60: 1.5 },
      { ratio: 2.0, amp: 0.2, t60: 0.8 },
      { ratio: 3.01, amp: 0.09, t60: 0.45 },
      { ratio: 4.24, amp: 0.04, t60: 0.28 },
    ],
    refFreq: 1046.5,
    decayExp: 0.5,
    strike: 0.05,
    strikeBand: [3000, 8000],
    strikeMs: 2,
    attackMs: 0.4,
    hardness: 0.5,
    maxSeconds: 2.0,
  },
  /** Glass harp / bowl: soft onset, long shimmering ring. */
  glass: {
    partials: [
      { ratio: 1, amp: 1, t60: 3.2 },
      { ratio: 2.32, amp: 0.26, t60: 1.8 },
      { ratio: 4.25, amp: 0.09, t60: 1.0 },
      { ratio: 6.63, amp: 0.03, t60: 0.5 },
    ],
    refFreq: 783.99,
    decayExp: 0.45,
    strike: 0.015,
    strikeBand: [2500, 7000],
    strikeMs: 4,
    attackMs: 10,
    hardness: 0.4,
    maxSeconds: 3.4,
    shimmerCents: 4,
  },
  /** Soft vibraphone-like bell for sparse answers. */
  softBell: {
    partials: [
      { ratio: 1, amp: 1, t60: 3.0 },
      { ratio: 4.0, amp: 0.1, t60: 1.1 },
      { ratio: 10.0, amp: 0.018, t60: 0.4 },
    ],
    refFreq: 523.25,
    decayExp: 0.45,
    strike: 0.03,
    strikeBand: [1500, 5000],
    strikeMs: 4,
    attackMs: 2,
    hardness: 0.5,
    maxSeconds: 3.2,
  },
  /** Thumb piano: plucky, hollow. */
  kalimba: {
    partials: [
      { ratio: 1, amp: 1, t60: 1.1 },
      { ratio: 5.42, amp: 0.1, t60: 0.2 },
      { ratio: 6.9, amp: 0.04, t60: 0.12 },
    ],
    refFreq: 523.25,
    decayExp: 0.5,
    strike: 0.12,
    strikeBand: [900, 3500],
    strikeMs: 6,
    attackMs: 0,
    hardness: 0.7,
    maxSeconds: 1.6,
  },
} as const satisfies Record<string, MalletPreset>;

/** Struck bar / bell built from exponentially decaying modes plus a short strike noise. */
export function mallet(preset: MalletPreset, freq: number, vel: number, rng: Rng): Float32Array {
  const scale = Math.pow(preset.refFreq / freq, preset.decayExp);
  let longest = 0;
  for (const p of preset.partials) longest = Math.max(longest, p.t60 * scale);
  const seconds = Math.min(preset.maxSeconds, Math.max(0.08, longest * 0.95));
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const v = clamp01(vel);
  let ampSum = 0;
  const sets = preset.shimmerCents ? [-preset.shimmerCents / 2, preset.shimmerCents / 2] : [0];
  for (const cents of sets) {
    const det = Math.pow(2, cents / 1200);
    preset.partials.forEach((p, k) => {
      const f = freq * p.ratio * det;
      if (f > SR * 0.45) return;
      const amp = (p.amp * Math.pow(0.35 + 0.65 * v, preset.hardness * k)) / sets.length;
      ampSum += amp;
      const d = Math.exp(-6.908 / (p.t60 * scale * SR));
      const w = (TAU * f) / SR;
      const c = Math.cos(w) * d;
      const s = Math.sin(w) * d;
      // Small random start phase on upper partials avoids identical transients.
      const ph = k === 0 ? 0 : rng() * 0.6;
      let re = amp * Math.cos(ph);
      let im = amp * Math.sin(ph);
      for (let i = 0; i < n; i++) {
        out[i] = out[i]! + im;
        const nr = re * c - im * s;
        im = re * s + im * c;
        re = nr;
      }
    });
  }
  // Strike noise.
  if (preset.strike > 0) {
    const m = Math.min(n, Math.round((preset.strikeMs / 1000) * SR * 4));
    const bp = Biquad.bandpass(Math.sqrt(preset.strikeBand[0] * preset.strikeBand[1]), 0.8);
    const tau = ((preset.strikeMs / 1000) * SR) / 2.2;
    const a = preset.strike * Math.pow(v, 1.4) * ampSum * 2.5;
    for (let i = 0; i < m; i++) {
      out[i] = out[i]! + bp.process(rng() * 2 - 1) * a * Math.exp(-i / tau);
    }
  }
  const att = Math.round((preset.attackMs / 1000) * SR);
  for (let i = 0; i < att && i < n; i++) {
    const t = i / att;
    out[i] = out[i]! * (0.5 - 0.5 * Math.cos(Math.PI * t));
  }
  const gain = (0.28 + 0.72 * v) * (0.72 / Math.max(ampSum, 1e-6));
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain;
  fadeHead(out);
  fadeTail(out, 12);
  return out;
}

/* ----------------------------------------------------------- plucked string */

export interface PluckOptions {
  /** Decay to -60 dB, seconds. */
  decay: number;
  /** 0 = dark felt, 1 = bright nail. */
  brightness: number;
  /** Pluck position along the string, 0.05..0.5. */
  pickPos: number;
  body: 'none' | 'pizz' | 'harp' | 'bass';
  /** Optional damping after this many seconds (finger lifts off). */
  gate?: number;
}

export const PLUCKS = {
  pizzViolin: { decay: 0.55, brightness: 0.42, pickPos: 0.22, body: 'pizz' },
  pizzCello: { decay: 0.8, brightness: 0.36, pickPos: 0.2, body: 'pizz' },
  pizzBass: { decay: 1.1, brightness: 0.3, pickPos: 0.18, body: 'bass' },
  harp: { decay: 2.4, brightness: 0.5, pickPos: 0.3, body: 'harp' },
  koto: { decay: 1.6, brightness: 0.72, pickPos: 0.12, body: 'harp' },
} as const satisfies Record<string, PluckOptions>;

/** Karplus–Strong string with tuned fractional delay, pick-position comb and a small body. */
export function pluck(opts: PluckOptions, freq: number, vel: number, rng: Rng): Float32Array {
  const v = clamp01(vel);
  const seconds = Math.min(4, (opts.gate !== undefined ? Math.min(opts.gate + 0.25, opts.decay) : opts.decay) * 1.05);
  const n = Math.max(64, Math.round(seconds * SR));
  const out = new Float32Array(n);
  const period = SR / freq;
  const S = 0.5 - 0.42 * clamp01(opts.brightness); // loop low-pass blend, delay = S samples
  const total = period - S;
  let N = Math.floor(total - 0.1);
  if (N < 2) N = 2;
  const frac = total - N;
  const C = (1 - frac) / (1 + frac);
  const rho = Math.min(0.99995, Math.pow(10, -3 / (opts.decay * freq)));
  // Excitation: filtered noise shaped by the pick position.
  const exc = new Float32Array(N);
  const lp = new OnePole(700 + 9000 * opts.brightness * (0.35 + 0.65 * v));
  const lp2 = new OnePole(900 + 11000 * opts.brightness * (0.35 + 0.65 * v));
  for (let i = 0; i < N; i++) exc[i] = lp2.lp(lp.lp(rng() * 2 - 1));
  const pick = Math.max(1, Math.round(opts.pickPos * N));
  const shaped = new Float32Array(N);
  let peak = 1e-9;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    shaped[i] = exc[i]! - exc[(i - pick + N) % N]! * 0.85;
    mean += shaped[i]!;
  }
  mean /= N;
  for (let i = 0; i < N; i++) {
    shaped[i] = shaped[i]! - mean;
    peak = Math.max(peak, Math.abs(shaped[i]!));
  }
  const line = new Float32Array(N);
  let idx = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  const gateSample = opts.gate !== undefined ? Math.round(opts.gate * SR) : Infinity;
  const dampCoef = Math.exp(-1 / (0.035 * SR));
  let dampGain = 1;
  for (let i = 0; i < n; i++) {
    const d = line[idx]!;
    const filtered = (1 - S) * d + S * prev;
    prev = d;
    const ap = C * filtered + apIn - C * apOut;
    apIn = filtered;
    apOut = ap;
    const x = i < N ? shaped[i]! / peak : 0;
    const y = x + rho * ap;
    line[idx] = y;
    idx++;
    if (idx >= N) idx = 0;
    if (i >= gateSample) dampGain *= dampCoef;
    out[i] = y * dampGain;
  }
  // Body colouring.
  if (opts.body !== 'none') {
    const cfg =
      opts.body === 'pizz'
        ? { lp: 4200, res: [290, 480, 1100], mix: 0.5 }
        : opts.body === 'bass'
          ? { lp: 1800, res: [110, 210, 420], mix: 0.45 }
          : { lp: 7000, res: [220, 520, 1900], mix: 0.25 };
    const low = Biquad.lowpass(cfg.lp, 0.6);
    const r1 = Biquad.bandpass(cfg.res[0]!, 2.2);
    const r2 = Biquad.bandpass(cfg.res[1]!, 2.5);
    const r3 = Biquad.bandpass(cfg.res[2]!, 1.6);
    for (let i = 0; i < n; i++) {
      const x = out[i]!;
      const dry = low.process(x);
      out[i] = dry * (1 - cfg.mix * 0.4) + (r1.process(x) + r2.process(x) * 0.8 + r3.process(x) * 0.5) * cfg.mix;
    }
  }
  // Remove DC and normalise by velocity.
  const hp = Biquad.highpass(Math.max(25, freq * 0.4), 0.7);
  let pk = 1e-9;
  for (let i = 0; i < n; i++) {
    out[i] = hp.process(out[i]!);
    pk = Math.max(pk, Math.abs(out[i]!));
  }
  const g = ((0.3 + 0.7 * v) * 0.75) / pk;
  for (let i = 0; i < n; i++) out[i] = out[i]! * g;
  fadeHead(out);
  fadeTail(out, 15);
  return out;
}

/* -------------------------------------------------------------------- piano */

/** Soft felt piano: inharmonic additive partials with a two-stage decay and a hammer thump. */
export function softPiano(freq: number, dur: number, vel: number, rng: Rng): Float32Array {
  const v = clamp01(vel);
  const release = 0.11;
  const seconds = Math.min(6, dur + 0.5);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const K = Math.min(14, Math.max(3, Math.floor(6500 / freq)));
  const B = Math.min(0.012, 0.0003 * Math.pow(freq / 220, 1.1));
  const bright = 0.22 + 0.55 * v;
  const tauSlow0 = 1.9 * Math.pow(220 / freq, 0.55);
  const tauFast0 = 0.26 * Math.pow(220 / freq, 0.3);
  let ampSum = 0;
  for (let k = 1; k <= K; k++) {
    const fk = freq * k * Math.sqrt(1 + B * k * k);
    if (fk > SR * 0.45) break;
    const amp = Math.pow(k, -1.1) * Math.exp(-(k - 1) * (1 - bright) * 0.55);
    ampSum += amp;
    const copies = k <= 5 ? [0, 0.9 + rng() * 0.6] : [0];
    for (const cents of copies) {
      const f = fk * Math.pow(2, cents / 1200);
      const w = (TAU * f) / SR;
      const c = Math.cos(w);
      const s = Math.sin(w);
      const dSlow = Math.exp(-1 / ((tauSlow0 / (1 + 0.35 * (k - 1))) * SR));
      const dFast = Math.exp(-1 / ((tauFast0 / (1 + 0.2 * (k - 1))) * SR));
      let eSlow = 0.42;
      let eFast = 0.58;
      const ph = rng() * TAU;
      let re = Math.cos(ph);
      let im = Math.sin(ph);
      const a = amp / copies.length;
      for (let i = 0; i < n; i++) {
        out[i] = out[i]! + im * a * (eSlow + eFast);
        const nr = re * c - im * s;
        im = re * s + im * c;
        re = nr;
        eSlow *= dSlow;
        eFast *= dFast;
      }
    }
  }
  // Hammer thump.
  const thump = new OnePole(650);
  const tn = Math.min(n, Math.round(0.05 * SR));
  for (let i = 0; i < tn; i++) {
    out[i] = out[i]! + thump.lp(rng() * 2 - 1) * 0.5 * v * ampSum * Math.exp(-i / (0.011 * SR));
  }
  // Felt attack, damper release.
  const att = Math.round(0.006 * SR);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / ((release / 3) * SR));
  let rel = 1;
  const gain = ((0.25 + 0.75 * v) * 0.55) / Math.max(ampSum, 1e-6);
  for (let i = 0; i < n; i++) {
    let g = gain;
    if (i < att) g *= 0.5 - 0.5 * Math.cos((Math.PI * i) / att);
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    out[i] = out[i]! * g;
  }
  fadeTail(out, 10);
  return out;
}

/** FM electric piano (tine + bark). */
export function epiano(freq: number, dur: number, vel: number): Float32Array {
  const v = clamp01(vel);
  const seconds = Math.min(5, dur + 0.45);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const w = (TAU * freq) / SR;
  const tauAmp = 1.7 * Math.pow(220 / freq, 0.4);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / (0.045 * SR));
  let rel = 1;
  const att = Math.round(0.004 * SR);
  const lp = new OnePole(3800);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ph = w * i;
    const index = (0.9 + 2.0 * v) * Math.exp(-t / 0.32) + 0.22;
    const y1 = Math.sin(ph + index * Math.sin(ph));
    const y2 = Math.sin(ph + 1.3 * v * Math.exp(-t / 0.055) * Math.sin(14 * ph));
    let g = Math.exp(-t / tauAmp);
    if (i < att) g *= i / att;
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    out[i] = lp.lp((0.78 * y1 + 0.22 * y2) * g) * (0.25 + 0.75 * v) * 0.6;
  }
  fadeTail(out, 10);
  return out;
}

/** Two-operator FM bell for sparkles. */
export function fmBell(freq: number, vel: number, opts: { ratio?: number; index?: number; decay?: number } = {}): Float32Array {
  const ratio = opts.ratio ?? 3.5;
  const index = opts.index ?? 2.2;
  const decay = opts.decay ?? 1.2;
  const n = Math.round(Math.min(4, decay * 1.1) * SR);
  const out = new Float32Array(n);
  const w = (TAU * freq) / SR;
  const v = clamp01(vel);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp((-6.9 * t) / decay);
    const idx = index * (0.4 + 0.6 * v) * Math.exp((-6.9 * t) / (decay * 0.5));
    out[i] = Math.sin(w * i + idx * Math.sin(w * ratio * i)) * env * (0.3 + 0.7 * v) * 0.6;
  }
  const att = Math.round(0.002 * SR);
  for (let i = 0; i < att; i++) out[i] = out[i]! * (i / att);
  fadeTail(out, 10);
  return out;
}

/* ------------------------------------------------------------ synth plucks */

export interface SoftPluckOptions {
  /** Pulse duty (0.5 = square). */
  duty: number;
  /** Mix of triangle (0..1) blended with the pulse. */
  tri: number;
  /** Filter start / end cutoff in Hz. */
  cutoffStart: number;
  cutoffEnd: number;
  /** Filter envelope time constant, seconds. */
  filterTau: number;
  /** Amplitude decay time constant, seconds. */
  ampTau: number;
  q: number;
  release: number;
}

export const SOFT_PLUCKS = {
  /** Round, bubbly "kawaii" chord pluck. */
  kawaii: { duty: 0.5, tri: 0.45, cutoffStart: 5200, cutoffEnd: 800, filterTau: 0.08, ampTau: 0.22, q: 0.85, release: 0.05 },
  /** Tighter arcade arpeggio blip. */
  arcade: { duty: 0.28, tri: 0.15, cutoffStart: 6000, cutoffEnd: 900, filterTau: 0.05, ampTau: 0.16, q: 1.1, release: 0.04 },
  /** Mellow plucked synth for cosy textures. */
  mellow: { duty: 0.5, tri: 0.8, cutoffStart: 2400, cutoffEnd: 500, filterTau: 0.12, ampTau: 0.45, q: 0.7, release: 0.09 },
} as const satisfies Record<string, SoftPluckOptions>;

export function softPluck(opts: SoftPluckOptions, freq: number, dur: number, vel: number): Float32Array {
  const v = clamp01(vel);
  const seconds = Math.min(3, dur + opts.release * 4 + 0.02);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const dt = freq / SR;
  // Starting a quarter period in keeps the integrated triangle centred on zero.
  let phase = 0.25;
  let tri = 0;
  const pulseDc = 2 * opts.duty - 1;
  const svf = new Svf(opts.cutoffStart, opts.q);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / (opts.release * SR));
  let rel = 1;
  const att = Math.round(0.003 * SR);
  const c0 = opts.cutoffEnd + (opts.cutoffStart - opts.cutoffEnd) * (0.35 + 0.65 * v);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0) svf.set(opts.cutoffEnd + freq * 0.5 + (c0 - opts.cutoffEnd) * Math.exp(-t / opts.filterTau), opts.q);
    let pulse = (phase < opts.duty ? 1 : -1) - pulseDc;
    pulse += polyBlep(phase, dt);
    pulse -= polyBlep((phase + 1 - opts.duty) % 1, dt);
    // Leaky integration of a square gives a triangle.
    let sq = phase < 0.5 ? 1 : -1;
    sq += polyBlep(phase, dt);
    sq -= polyBlep((phase + 0.5) % 1, dt);
    tri = tri * 0.999 + sq * dt * 4;
    phase += dt;
    if (phase >= 1) phase -= 1;
    let g = Math.exp(-t / opts.ampTau);
    if (i < att) g *= i / att;
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    out[i] = svf.process(pulse * (1 - opts.tri) * 0.55 + tri * opts.tri) * g * (0.3 + 0.7 * v) * 0.7;
  }
  fadeTail(out, 6);
  return out;
}

/* --------------------------------------------------------------------- pads */

export interface PadOptions {
  voices: number;
  detuneCents: number;
  cutoff: number;
  q: number;
  /** Slow cutoff movement: fraction of the cutoff (0 = static). */
  lfoDepth: number;
  lfoHz: number;
  /** Phase offset so successive chords continue the same slow sweep. */
  lfoPhase?: number;
  attack: number;
  release: number;
  /** 0 = saw, 1 = soft (triangle-like). */
  soft: number;
}

/** Stereo pad for a whole chord: detuned band-limited saws through one slow low-pass per channel. */
export function padChord(freqs: number[], dur: number, vel: number, opts: PadOptions, rng: Rng): Voice {
  const seconds = dur + opts.release;
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  interface Osc {
    phase: number;
    dt: number;
    gl: number;
    gr: number;
  }
  const oscs: Osc[] = [];
  for (const f of freqs) {
    for (let k = 0; k < opts.voices; k++) {
      const spread = opts.voices === 1 ? 0 : (k / (opts.voices - 1)) * 2 - 1;
      const cents = spread * opts.detuneCents + (rng() - 0.5) * 2;
      const pan = spread * 0.8;
      const a = ((pan + 1) / 2) * (Math.PI / 2);
      oscs.push({ phase: rng(), dt: (f * Math.pow(2, cents / 1200)) / SR, gl: Math.cos(a), gr: Math.sin(a) });
    }
  }
  const norm = 0.5 / Math.sqrt(Math.max(1, oscs.length));
  const fl = new Svf(opts.cutoff, opts.q);
  const fr = new Svf(opts.cutoff, opts.q);
  const softL = new OnePole(900);
  const softR = new OnePole(900);
  const attS = Math.max(1, Math.round(opts.attack * SR));
  const durS = Math.round(dur * SR);
  const relS = Math.max(1, n - durS);
  const lfoW = (TAU * opts.lfoHz) / SR;
  const v = 0.3 + 0.7 * clamp01(vel);
  for (let i = 0; i < n; i++) {
    if ((i & 63) === 0) {
      const c = opts.cutoff * (1 + opts.lfoDepth * Math.sin(lfoW * i + (opts.lfoPhase ?? 0)));
      fl.set(c, opts.q);
      fr.set(c * 1.04, opts.q);
    }
    let sl = 0;
    let sr = 0;
    for (let k = 0; k < oscs.length; k++) {
      const o = oscs[k]!;
      const saw = 2 * o.phase - 1 - polyBlep(o.phase, o.dt);
      sl += saw * o.gl;
      sr += saw * o.gr;
      o.phase += o.dt;
      if (o.phase >= 1) o.phase -= 1;
    }
    let yl = fl.process(sl * norm);
    let yr = fr.process(sr * norm);
    if (opts.soft > 0) {
      yl = yl * (1 - opts.soft) + softL.lp(yl) * opts.soft * 1.6;
      yr = yr * (1 - opts.soft) + softR.lp(yr) * opts.soft * 1.6;
    }
    let g = v;
    if (i < attS) {
      const t = i / attS;
      g *= t * t * (3 - 2 * t);
    }
    if (i >= durS) {
      const t = 1 - (i - durS) / relS;
      g *= t * t * (3 - 2 * t);
    }
    l[i] = yl * g;
    r[i] = yr * g;
  }
  return { l, r };
}

/* --------------------------------------------------------------------- bass */

/** Round sine bass with a little harmonic content so it reads on small speakers. */
export function subBass(
  freq: number,
  dur: number,
  vel: number,
  opts: { harm2?: number; harm3?: number; drive?: number; attack?: number; release?: number; sag?: number } = {},
): Float32Array {
  const release = opts.release ?? 0.07;
  const n = Math.round((dur + release * 3) * SR);
  const out = new Float32Array(n);
  const w = (TAU * freq) / SR;
  const h2 = opts.harm2 ?? 0.22;
  const h3 = opts.harm3 ?? 0.08;
  const drive = opts.drive ?? 1.4;
  const att = Math.round((opts.attack ?? 0.008) * SR);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / (release * SR));
  let rel = 1;
  const sagTau = (opts.sag ?? 1.4) * SR;
  const v = 0.35 + 0.65 * clamp01(vel);
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const ph = w * i;
    let x = Math.sin(ph) + h2 * Math.sin(2 * ph) + h3 * Math.sin(3 * ph);
    x = Math.tanh(x * drive * 0.8) * norm;
    let g = 0.55 + 0.45 * Math.exp(-i / sagTau);
    if (i < att) g *= i / att;
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    out[i] = x * g * v * 0.6;
  }
  fadeTail(out, 5);
  return out;
}

/** Saw + sub through a decaying low-pass: classic synth-pop bass. */
export function synthBass(
  freq: number,
  dur: number,
  vel: number,
  opts: { cutoffStart?: number; cutoffEnd?: number; filterTau?: number; q?: number } = {},
): Float32Array {
  const release = 0.05;
  const n = Math.round((dur + release * 4) * SR);
  const out = new Float32Array(n);
  const dt = freq / SR;
  let phase = 0;
  const cs = opts.cutoffStart ?? 1500;
  const ce = opts.cutoffEnd ?? 230;
  const tau = opts.filterTau ?? 0.11;
  const q = opts.q ?? 1.1;
  const svf = new Svf(cs, q);
  const att = Math.round(0.004 * SR);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / (release * SR));
  let rel = 1;
  const v = 0.35 + 0.65 * clamp01(vel);
  const wf = (TAU * freq) / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0) svf.set(ce + (cs - ce) * (0.4 + 0.6 * v) * Math.exp(-t / tau), q);
    const saw = 2 * phase - 1 - polyBlep(phase, dt);
    phase += dt;
    if (phase >= 1) phase -= 1;
    let g = 0.75 + 0.25 * Math.exp(-t / 0.25);
    if (i < att) g *= i / att;
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    // The sine reinforces the fundamental so the bass stays solid when the filter closes.
    out[i] = (svf.process(saw * 0.7) + Math.sin(wf * i) * 0.45) * g * v * 0.5;
  }
  fadeTail(out, 5);
  return out;
}

/* -------------------------------------------------------------------- winds */

export interface WindPreset {
  /** Relative amplitude of harmonics 1..n. */
  harmonics: number[];
  breath: number;
  breathHz: number;
  chiff: number;
  attack: number;
  release: number;
  vibHz: number;
  /** Vibrato depth as a fraction of the frequency. */
  vibDepth: number;
  vibDelay: number;
  scoopCents: number;
  lowpass: number;
}

export const WINDS = {
  clarinet: {
    harmonics: [1, 0.035, 0.5, 0.03, 0.24, 0.02, 0.1, 0.012, 0.045],
    breath: 0.012,
    breathHz: 2200,
    chiff: 0.05,
    attack: 0.045,
    release: 0.07,
    vibHz: 5.1,
    vibDepth: 0.0028,
    vibDelay: 0.28,
    scoopCents: 12,
    lowpass: 3600,
  },
  flute: {
    harmonics: [1, 0.36, 0.12, 0.05, 0.02],
    breath: 0.035,
    breathHz: 3200,
    chiff: 0.12,
    attack: 0.06,
    release: 0.09,
    vibHz: 5.4,
    vibDepth: 0.004,
    vibDelay: 0.22,
    scoopCents: 8,
    lowpass: 5200,
  },
  /** Small, round whistle / ocarina. */
  ocarina: {
    harmonics: [1, 0.07, 0.03],
    breath: 0.02,
    breathHz: 2600,
    chiff: 0.08,
    attack: 0.03,
    release: 0.06,
    vibHz: 5.8,
    vibDepth: 0.003,
    vibDelay: 0.2,
    scoopCents: 18,
    lowpass: 4500,
  },
} as const satisfies Record<string, WindPreset>;

export function wind(preset: WindPreset, freq: number, dur: number, vel: number, rng: Rng): Float32Array {
  const v = clamp01(vel);
  const n = Math.round((dur + preset.release * 4) * SR);
  const out = new Float32Array(n);
  const hs = preset.harmonics;
  const durS = Math.round(dur * SR);
  const attTau = (preset.attack / 3) * SR;
  const relCoef = Math.exp(-1 / ((preset.release / 1.5) * SR));
  let rel = 1;
  let phase = rng();
  const bp = Biquad.bandpass(preset.breathHz, 1.1);
  const lp = Biquad.lowpass(preset.lowpass, 0.6);
  const vibW = (TAU * preset.vibHz) / SR;
  const useVib = dur > 0.32;
  const top = Math.min(hs.length, Math.floor((SR * 0.42) / freq));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let ratio = Math.pow(2, (-preset.scoopCents * Math.exp(-t / 0.035)) / 1200);
    if (useVib && t > preset.vibDelay) {
      const ramp = Math.min(1, (t - preset.vibDelay) / 0.35);
      ratio *= 1 + preset.vibDepth * ramp * Math.sin(vibW * i);
    }
    phase += (freq * ratio) / SR;
    if (phase >= 1) phase -= 1;
    const th = TAU * phase;
    const c2 = 2 * Math.cos(th);
    let sPrev = 0;
    let sCur = Math.sin(th);
    let env = 1 - Math.exp(-i / attTau);
    if (i >= durS) {
      rel *= relCoef;
      env *= rel;
    }
    // Upper harmonics bloom slightly after the fundamental and depend on dynamics.
    const bloom = 0.45 + 0.55 * env * (0.55 + 0.45 * v);
    let x = 0;
    for (let k = 0; k < top; k++) {
      x += sCur * hs[k]! * (k === 0 ? 1 : bloom);
      const next = c2 * sCur - sPrev;
      sPrev = sCur;
      sCur = next;
    }
    const noise = bp.process(rng() * 2 - 1) * (preset.breath + preset.chiff * Math.exp(-t / 0.03));
    out[i] = lp.process(x * 0.5 + noise) * env * (0.3 + 0.7 * v) * 0.62;
  }
  fadeTail(out, 6);
  return out;
}

/* -------------------------------------------------------------- synth leads */

/** Soft pulse lead with a delayed vibrato; bright but rounded. */
export function synthLead(
  freq: number,
  dur: number,
  vel: number,
  opts: { duty?: number; detuneCents?: number; cutoff?: number; vibDepth?: number; attack?: number; release?: number } = {},
): Float32Array {
  const release = opts.release ?? 0.09;
  const n = Math.round((dur + release * 4) * SR);
  const out = new Float32Array(n);
  const duty = opts.duty ?? 0.34;
  const det = Math.pow(2, (opts.detuneCents ?? 7) / 1200);
  const cutoff = opts.cutoff ?? 2600;
  const svf = new Svf(cutoff, 0.9);
  let p1 = 0;
  let p2 = 0.37;
  const att = Math.round((opts.attack ?? 0.008) * SR);
  const durS = Math.round(dur * SR);
  const relCoef = Math.exp(-1 / (release * SR));
  let rel = 1;
  const v = clamp01(vel);
  const vibW = (TAU * 5.6) / SR;
  const vibDepth = opts.vibDepth ?? 0.004;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = freq;
    if (dur > 0.3 && t > 0.16) f *= 1 + vibDepth * Math.min(1, (t - 0.16) / 0.25) * Math.sin(vibW * i);
    const dt1 = f / SR;
    const dt2 = (f * det) / SR;
    if ((i & 15) === 0) svf.set(cutoff * (0.55 + 0.45 * v) + (cutoff * 0.9) * Math.exp(-t / 0.09) + freq, 0.9);
    let a = (p1 < duty ? 1 : -1) - (2 * duty - 1);
    a += polyBlep(p1, dt1) - polyBlep((p1 + 1 - duty) % 1, dt1);
    const b = 2 * p2 - 1 - polyBlep(p2, dt2);
    p1 += dt1;
    if (p1 >= 1) p1 -= 1;
    p2 += dt2;
    if (p2 >= 1) p2 -= 1;
    let g = 0.8 + 0.2 * Math.exp(-t / 0.2);
    if (i < att) g *= i / att;
    if (i >= durS) {
      rel *= relCoef;
      g *= rel;
    }
    out[i] = svf.process(a * 0.5 + b * 0.32) * g * (0.3 + 0.7 * v) * 0.55;
  }
  fadeTail(out, 6);
  return out;
}

/* ------------------------------------------------------------------ helpers */

/** Sine with an exponential pitch glide and decay; the building block of many one-shots. */
export function sineGlide(
  f0: number,
  f1: number,
  seconds: number,
  opts: { glideTau?: number; ampTau?: number; attackMs?: number; harm2?: number } = {},
): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const glideTau = (opts.glideTau ?? seconds / 3) * SR;
  const ampTau = (opts.ampTau ?? seconds / 3) * SR;
  const att = Math.max(1, Math.round(((opts.attackMs ?? 2) / 1000) * SR));
  const h2 = opts.harm2 ?? 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f1 + (f0 - f1) * Math.exp(-i / glideTau);
    phase += f / SR;
    let g = Math.exp(-i / ampTau);
    if (i < att) g *= i / att;
    out[i] = (Math.sin(TAU * phase) + h2 * Math.sin(2 * TAU * phase)) * g;
  }
  fadeTail(out, 4);
  return out;
}

/** Filtered noise burst with attack / exponential decay. */
export function noiseBurst(
  seconds: number,
  rng: Rng,
  opts: { type: 'lp' | 'hp' | 'bp'; freq: number; q?: number; attackMs?: number; decayTau: number; freqEnd?: number },
): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const svf = new Svf(opts.freq, opts.q ?? 0.8);
  const att = Math.max(1, Math.round(((opts.attackMs ?? 1) / 1000) * SR));
  const tau = opts.decayTau * SR;
  for (let i = 0; i < n; i++) {
    if (opts.freqEnd !== undefined && (i & 31) === 0) {
      const t = i / n;
      svf.set(opts.freq * Math.pow(opts.freqEnd / opts.freq, t), opts.q ?? 0.8);
    }
    svf.process(rng() * 2 - 1);
    const y = opts.type === 'lp' ? svf.low : opts.type === 'hp' ? svf.high : svf.band;
    let g = Math.exp(-i / tau);
    if (i < att) g *= i / att;
    out[i] = y * g;
  }
  fadeTail(out, 4);
  return out;
}
