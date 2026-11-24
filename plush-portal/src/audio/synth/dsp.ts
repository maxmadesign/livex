/** Filters, time-based effects, dynamics and loudness measurement. */
import { SR, TAU } from './core';

/* ------------------------------------------------------------------ filters */

/** RBJ biquad, transposed direct form II. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private z1 = 0;
  private z2 = 0;

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  static lowpass(fc: number, q = Math.SQRT1_2): Biquad {
    const w = (TAU * Math.min(fc, SR * 0.49)) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return new Biquad().set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }

  static highpass(fc: number, q = Math.SQRT1_2): Biquad {
    const w = (TAU * Math.min(fc, SR * 0.49)) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return new Biquad().set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }

  /** Band-pass with 0 dB peak gain. */
  static bandpass(fc: number, q = 1): Biquad {
    const w = (TAU * Math.min(fc, SR * 0.49)) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return new Biquad().set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }

  static peaking(fc: number, q: number, gainDb: number): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * Math.min(fc, SR * 0.49)) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return new Biquad().set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }

  static lowshelf(fc: number, gainDb: number, q = Math.SQRT1_2): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * fc) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const s = 2 * Math.sqrt(A) * al;
    return new Biquad().set(
      A * (A + 1 - (A - 1) * c + s),
      2 * A * (A - 1 - (A + 1) * c),
      A * (A + 1 - (A - 1) * c - s),
      A + 1 + (A - 1) * c + s,
      -2 * (A - 1 + (A + 1) * c),
      A + 1 + (A - 1) * c - s,
    );
  }

  static highshelf(fc: number, gainDb: number, q = Math.SQRT1_2): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * fc) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const s = 2 * Math.sqrt(A) * al;
    return new Biquad().set(
      A * (A + 1 + (A - 1) * c + s),
      -2 * A * (A - 1 + (A + 1) * c),
      A * (A + 1 + (A - 1) * c - s),
      A + 1 - (A - 1) * c + s,
      2 * (A - 1 - (A + 1) * c),
      A + 1 - (A - 1) * c - s,
    );
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** In-place. `passes: 2` warms the state up on the buffer itself (for periodic loops). */
  run(buf: Float32Array, passes = 1): Float32Array {
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i]!;
        const y = this.b0 * x + this.z1;
        this.z1 = this.b1 * x - this.a1 * y + this.z2;
        this.z2 = this.b2 * x - this.a2 * y;
        if (p === passes - 1) buf[i] = y;
      }
    }
    return buf;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Filters a periodic buffer so the result is periodic too: the first pass only
 * warms the filter state up, the second pass is written back.
 */
export function filterCircular(buf: Float32Array, filter: Biquad): Float32Array {
  filter.reset();
  for (let i = 0; i < buf.length; i++) filter.process(buf[i]!);
  for (let i = 0; i < buf.length; i++) buf[i] = filter.process(buf[i]!);
  return buf;
}

/** Topology-preserving state variable filter; safe to modulate. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  low = 0;
  band = 0;
  high = 0;

  constructor(fc = 1000, q = 0.707) {
    this.set(fc, q);
  }

  set(fc: number, q: number): void {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 10), SR * 0.45)) / SR);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** Returns the low-pass output; band / high are available as fields. */
  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - this.k * v1 - v2;
    return v2;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }
}

export class OnePole {
  private a: number;
  private y = 0;
  constructor(fc: number) {
    this.a = 1 - Math.exp((-TAU * fc) / SR);
  }
  setCutoff(fc: number): void {
    this.a = 1 - Math.exp((-TAU * fc) / SR);
  }
  lp(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
  hp(x: number): number {
    this.y += this.a * (x - this.y);
    return x - this.y;
  }
  reset(): void {
    this.y = 0;
  }
}

/* ------------------------------------------------------------------ effects */

class DelayLine {
  private readonly buf: Float32Array;
  private idx = 0;
  constructor(readonly length: number) {
    this.buf = new Float32Array(Math.max(1, length));
  }
  read(): number {
    return this.buf[this.idx]!;
  }
  write(x: number): void {
    this.buf[this.idx] = x;
    this.idx++;
    if (this.idx >= this.buf.length) this.idx = 0;
  }
}

class Allpass {
  private readonly line: DelayLine;
  constructor(
    length: number,
    private readonly g: number,
  ) {
    this.line = new DelayLine(length);
  }
  process(x: number): number {
    const d = this.line.read();
    const y = d - this.g * x;
    this.line.write(x + this.g * y);
    return y;
  }
}

export interface ReverbOptions {
  /** Decay time to -60 dB, seconds. */
  t60: number;
  /** Low-pass inside the feedback loop, Hz (lower = darker tail). */
  damping: number;
  /** Room size scale; 1 is a medium room. */
  size: number;
  preDelayMs: number;
  /** High-pass on the reverb input, Hz (keeps bass out of the tail). */
  lowCut: number;
}

const FDN_BASE_MS = [29.7, 37.1, 41.1, 43.7, 47.3, 53.1, 59.3, 61.7];
const DIFFUSER_MS_L = [4.77, 3.59, 12.73, 9.31];
const DIFFUSER_MS_R = [5.13, 3.31, 13.57, 8.87];

/** Stereo feedback-delay-network reverb (8 lines, Householder matrix, damped). Output is wet only. */
export class Reverb {
  private readonly lines: DelayLine[] = [];
  private readonly gains: number[] = [];
  private readonly damp: OnePole[] = [];
  private readonly diffL: Allpass[];
  private readonly diffR: Allpass[];
  private readonly preL: DelayLine;
  private readonly preR: DelayLine;
  private readonly hpL: OnePole;
  private readonly hpR: OnePole;
  private readonly outs = new Float64Array(8);

  constructor(opts: ReverbOptions) {
    for (let i = 0; i < 8; i++) {
      let len = Math.round((FDN_BASE_MS[i]! / 1000) * SR * opts.size);
      if (len % 2 === 0) len += 1;
      this.lines.push(new DelayLine(len));
      this.gains.push(Math.pow(10, (-3 * len) / (SR * opts.t60)));
      this.damp.push(new OnePole(opts.damping));
    }
    const mk = (ms: number[]) => ms.map((m) => new Allpass(Math.max(3, Math.round((m / 1000) * SR)), 0.6));
    this.diffL = mk(DIFFUSER_MS_L);
    this.diffR = mk(DIFFUSER_MS_R);
    const pre = Math.max(1, Math.round((opts.preDelayMs / 1000) * SR));
    this.preL = new DelayLine(pre);
    this.preR = new DelayLine(pre + 37);
    this.hpL = new OnePole(opts.lowCut);
    this.hpR = new OnePole(opts.lowCut);
  }

  /** Writes the wet signal for `n` samples of input into outL / outR (overwrites). */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, write = true): void {
    const { lines, gains, damp, outs } = this;
    for (let i = 0; i < n; i++) {
      let xl = this.hpL.hp(inL[i]!);
      let xr = this.hpR.hp(inR[i]!);
      const pl = this.preL.read();
      const pr = this.preR.read();
      this.preL.write(xl);
      this.preR.write(xr);
      xl = pl;
      xr = pr;
      for (let k = 0; k < 4; k++) {
        xl = this.diffL[k]!.process(xl);
        xr = this.diffR[k]!.process(xr);
      }
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        const o = damp[k]!.lp(lines[k]!.read()) * gains[k]!;
        outs[k] = o;
        sum += o;
      }
      const h = sum * 0.25; // Householder: out - (2/N)·sum
      for (let k = 0; k < 8; k++) {
        lines[k]!.write((k & 1 ? xr : xl) + outs[k]! - h);
      }
      if (write) {
        outL[i] = (outs[0]! - outs[2]! + outs[4]! - outs[6]!) * 0.5;
        outR[i] = (outs[1]! - outs[3]! + outs[5]! - outs[7]!) * 0.5;
      }
    }
  }
}

/** Runs a reverb over a periodic buffer so the tail of the end wraps into the start. */
export function reverbCircular(
  inL: Float32Array,
  inR: Float32Array,
  opts: ReverbOptions,
): { l: Float32Array; r: Float32Array } {
  const n = inL.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const reverb = new Reverb(opts);
  // Warm-up: the last few seconds are enough because the tail is far shorter than the loop.
  const warm = Math.min(n, Math.round(SR * Math.max(4, opts.t60 * 3)));
  const off = n - warm;
  reverb.process(inL.subarray(off), inR.subarray(off), outL, outR, warm, false);
  reverb.process(inL, inR, outL, outR, n, true);
  return { l: outL, r: outR };
}

/** Plain (non-wrapping) reverb for one-shots; the output is `tail` seconds longer than the input. */
export function reverbOneShot(
  inL: Float32Array,
  inR: Float32Array,
  opts: ReverbOptions,
  tailSec: number,
): { l: Float32Array; r: Float32Array } {
  const n = inL.length + Math.round(tailSec * SR);
  const padL = new Float32Array(n);
  const padR = new Float32Array(n);
  padL.set(inL);
  padR.set(inR);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  new Reverb(opts).process(padL, padR, outL, outR, n, true);
  return { l: outL, r: outR };
}

export interface PingPongOptions {
  delaySamples: number;
  feedback: number;
  /** Low-pass in the feedback path, Hz. */
  damping: number;
}

/** Stereo ping-pong delay over a periodic buffer (wet only, periodic result). */
export function pingPongCircular(
  inL: Float32Array,
  inR: Float32Array,
  opts: PingPongOptions,
): { l: Float32Array; r: Float32Array } {
  const n = inL.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const d = Math.max(1, Math.round(opts.delaySamples));
  const lineL = new DelayLine(d);
  const lineR = new DelayLine(d);
  const lpL = new OnePole(opts.damping);
  const lpR = new OnePole(opts.damping);
  const warm = Math.min(n, d * 24);
  const run = (from: number, count: number, write: boolean) => {
    for (let j = 0; j < count; j++) {
      const i = from + j;
      const dl = lineL.read();
      const dr = lineR.read();
      lineL.write((inL[i]! + inR[i]!) * 0.5 + lpL.lp(dr) * opts.feedback);
      lineR.write(lpR.lp(dl) * opts.feedback);
      if (write) {
        outL[i] = dl;
        outR[i] = dr;
      }
    }
  };
  run(n - warm, warm, false);
  run(0, n, true);
  return { l: outL, r: outR };
}

/** Gentle stereo chorus (in place). Periodic input stays periodic when `circular` is set. */
export function chorusStereo(
  l: Float32Array,
  r: Float32Array,
  opts: { rateHz: number; depthMs: number; baseMs: number; mix: number; circular?: boolean },
): void {
  const n = l.length;
  const maxDelay = Math.ceil(((opts.baseMs + opts.depthMs) / 1000) * SR) + 4;
  const srcL = Float32Array.from(l);
  const srcR = Float32Array.from(r);
  // An LFO that completes a whole number of cycles keeps a periodic buffer periodic.
  const cycles = opts.circular ? Math.max(1, Math.round((opts.rateHz * n) / SR)) : (opts.rateHz * n) / SR;
  const w = (TAU * cycles) / n;
  const read = (src: Float32Array, pos: number): number => {
    let p = pos;
    if (opts.circular) {
      p = ((p % n) + n) % n;
    } else if (p < 0) {
      return 0;
    }
    const i0 = Math.floor(p);
    const f = p - i0;
    const i1 = opts.circular ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
    return src[i0]! * (1 - f) + src[i1]! * f;
  };
  void maxDelay;
  for (let i = 0; i < n; i++) {
    const dl = ((opts.baseMs + opts.depthMs * Math.sin(w * i)) / 1000) * SR;
    const dr = ((opts.baseMs + opts.depthMs * Math.sin(w * i + Math.PI / 2)) / 1000) * SR;
    l[i] = srcL[i]! * (1 - opts.mix * 0.5) + read(srcL, i - dl) * opts.mix;
    r[i] = srcR[i]! * (1 - opts.mix * 0.5) + read(srcR, i - dr) * opts.mix;
  }
}

/* ----------------------------------------------------------------- dynamics */

/**
 * Look-ahead peak limiter (in place, linked stereo). The gain is the box
 * average of a forward-looking minimum with an exponential release, so the
 * output never exceeds `ceiling`. With `circular` the gain curve itself is
 * periodic, which keeps loops seamless.
 */
export function limit(
  l: Float32Array,
  r: Float32Array,
  opts: { ceiling: number; lookaheadMs?: number; releaseMs?: number; circular?: boolean },
): { maxReductionDb: number } {
  const n = l.length;
  const look = Math.max(8, Math.round(((opts.lookaheadMs ?? 5) / 1000) * SR));
  const relCoef = 1 - Math.exp(-1 / (((opts.releaseMs ?? 120) / 1000) * SR));
  const circular = !!opts.circular;
  const need = new Float32Array(n);
  let minNeed = 1;
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
    const g = p > opts.ceiling ? opts.ceiling / p : 1;
    need[i] = g;
    if (g < minNeed) minNeed = g;
  }
  if (minNeed >= 1) return { maxReductionDb: 0 };

  // Forward-window minimum: fwd[i] = min(need[i .. i + look]).
  const fwd = new Float32Array(n);
  const deque = new Int32Array(look + 2);
  let head = 0;
  let tail = 0;
  const at = (i: number) => (circular ? need[i % n]! : i < n ? need[i]! : 1);
  const total = n + look;
  for (let i = 0; i < total; i++) {
    const v = at(i);
    while (tail > head && at(deque[(tail - 1) % deque.length]!) >= v) tail--;
    deque[tail % deque.length] = i;
    tail++;
    const start = i - look;
    if (start >= 0) {
      while (deque[head % deque.length]! < start) head++;
      fwd[start] = at(deque[head % deque.length]!);
    }
  }

  // Instant attack (already anticipated by the look-ahead), exponential release.
  const rel = new Float32Array(n);
  let g = 1;
  const passes = circular ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      g = g + (1 - g) * relCoef;
      if (fwd[i]! < g) g = fwd[i]!;
      rel[i] = g;
    }
  }

  // Trailing box average over the look-ahead turns the steps into smooth ramps.
  let acc = 0;
  for (let k = 1; k <= look; k++) acc += circular ? rel[(n - k) % n]! : 1;
  for (let i = 0; i < n; i++) {
    const drop = i - look;
    acc += rel[i]! - (drop >= 0 ? rel[drop]! : circular ? rel[((drop % n) + n) % n]! : 1);
    const gain = acc / look;
    l[i] = l[i]! * gain;
    r[i] = r[i]! * gain;
  }
  return { maxReductionDb: -20 * Math.log10(minNeed) };
}

/** Smooth saturation that is transparent at low level and rounds peaks. */
export function softClip(x: number, drive = 1): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/* ----------------------------------------------------------------- loudness */

/**
 * Integrated loudness after ITU-R BS.1770 (K-weighting + absolute / relative
 * gating). Used to level the music tracks against each other.
 */
export function integratedLufs(l: Float32Array, r: Float32Array): number {
  const weight = (src: Float32Array): Float32Array => {
    const out = Float32Array.from(src);
    Biquad.highshelf(1500, 4, Math.SQRT1_2).run(out);
    Biquad.highpass(38, 0.5).run(out);
    return out;
  };
  const wl = weight(l);
  const wr = weight(r);
  const block = Math.round(0.4 * SR);
  const step = Math.round(0.1 * SR);
  const powers: number[] = [];
  for (let start = 0; start + block <= wl.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += wl[i]! * wl[i]! + wr[i]! * wr[i]!;
    powers.push(sum / block);
  }
  if (powers.length === 0) {
    let sum = 0;
    for (let i = 0; i < wl.length; i++) sum += wl[i]! * wl[i]! + wr[i]! * wr[i]!;
    return -0.691 + 10 * Math.log10(Math.max(sum / Math.max(1, wl.length), 1e-12));
  }
  const toLufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const abs = powers.filter((p) => toLufs(p) > -70);
  if (abs.length === 0) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = toLufs(meanAbs) - 10;
  const rel = abs.filter((p) => toLufs(p) > relGate);
  const mean = (rel.length ? rel : abs).reduce((a, b) => a + b, 0) / (rel.length || abs.length);
  return toLufs(mean);
}

/** Energy (dB, relative) in a few broad bands; used by tests and the bake report. */
export function bandEnergiesDb(mono: Float32Array): { low: number; lowMid: number; mid: number; high: number; air: number } {
  const band = (lo: number, hi: number): number => {
    const tmp = Float32Array.from(mono);
    Biquad.highpass(lo, 0.707).run(tmp);
    Biquad.highpass(lo, 0.707).run(tmp);
    Biquad.lowpass(hi, 0.707).run(tmp);
    Biquad.lowpass(hi, 0.707).run(tmp);
    let sum = 0;
    for (let i = 0; i < tmp.length; i++) sum += tmp[i]! * tmp[i]!;
    return 10 * Math.log10(Math.max(sum / Math.max(1, tmp.length), 1e-14));
  };
  return {
    low: band(30, 120),
    lowMid: band(120, 500),
    mid: band(500, 2000),
    high: band(2000, 6000),
    air: band(6000, 16000),
  };
}
