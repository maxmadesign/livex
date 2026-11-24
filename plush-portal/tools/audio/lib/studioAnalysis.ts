/**
 * Signal analysis for importing generated ("studio") audio: loudness envelopes,
 * true peak, onset strength, tempo / beat / downbeat estimation, choice of
 * play-list cross-fade points, trimming, gating, fades and seamless loops.
 *
 * Pure TypeScript (no Node APIs) so it can be unit tested; the import tool
 * (tools/audio/importStudio.ts) does the file I/O with ffmpeg.
 */

export interface Pcm {
  sampleRate: number;
  /** One Float32Array per channel, equal lengths. */
  channels: Float32Array[];
}

const TAU = Math.PI * 2;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));
const powerToLufs = (p: number): number => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));

export function frames(p: Pcm): number {
  return p.channels[0]?.length ?? 0;
}

export function durationOf(p: Pcm): number {
  return frames(p) / p.sampleRate;
}

export function mono(p: Pcm): Float32Array {
  const n = frames(p);
  const out = new Float32Array(n);
  const k = 1 / p.channels.length;
  for (const ch of p.channels) for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! * k;
  return out;
}

export function slicePcm(p: Pcm, startSec: number, endSec: number): Pcm {
  const a = Math.max(0, Math.round(startSec * p.sampleRate));
  const b = Math.min(frames(p), Math.round(endSec * p.sampleRate));
  return { sampleRate: p.sampleRate, channels: p.channels.map((c) => c.slice(a, Math.max(a, b))) };
}

/* ------------------------------------------------------------------ filters */

/** Biquad designed for an arbitrary sample rate (RBJ cookbook), transposed direct form II. */
class Bq {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}
  static make(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Bq {
    return new Bq(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }
  static highshelf(sr: number, fc: number, gainDb: number, q: number): Bq {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * fc) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const s = 2 * Math.sqrt(A) * al;
    return Bq.make(A * (A + 1 + (A - 1) * c + s), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - s), A + 1 - (A - 1) * c + s, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - s);
  }
  static highpass(sr: number, fc: number, q: number): Bq {
    const w = (TAU * fc) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return Bq.make((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  static lowpass(sr: number, fc: number, q: number): Bq {
    const w = (TAU * fc) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return Bq.make((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i]!;
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      buf[i] = y;
    }
    return buf;
  }
}

/** ITU-R BS.1770 K-weighting (pre-filter shelf + RLB high-pass). */
export function kWeight(ch: Float32Array, sr: number): Float32Array {
  const out = Float32Array.from(ch);
  Bq.highshelf(sr, 1681.97, 3.99984, 0.7072).run(out);
  Bq.highpass(sr, 38.135, 0.5003).run(out);
  return out;
}

/* ----------------------------------------------------------------- loudness */

/** Per-hop K-weighted mean square (summed over channels) of windows centred on each hop. */
function kPowerEnvelope(p: Pcm, windowSec: number, hopSec: number): { power: Float64Array; hop: number } {
  const sr = p.sampleRate;
  const n = frames(p);
  const sq = new Float64Array(n + 1); // prefix sums of the summed channel power
  const weighted = p.channels.map((c) => kWeight(c, sr));
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const w of weighted) s += w[i]! * w[i]!;
    acc += s;
    sq[i + 1] = acc;
  }
  const hop = Math.max(1, Math.round(hopSec * sr));
  const half = Math.round((windowSec * sr) / 2);
  const count = Math.max(1, Math.floor(n / hop));
  const power = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const c = k * hop;
    const a = Math.max(0, c - half);
    const b = Math.min(n, c + half);
    power[k] = b > a ? (sq[b]! - sq[a]!) / (b - a) : 0;
  }
  return { power, hop };
}

/** Loudness envelope in LUFS: `windowSec` 0.4 = momentary, 3 = short-term; centred windows. */
export function loudnessEnvelope(p: Pcm, windowSec: number, hopSec: number): Float32Array {
  const { power } = kPowerEnvelope(p, windowSec, hopSec);
  return Float32Array.from(power, (v) => powerToLufs(v));
}

/** Gated integrated loudness (BS.1770-4): 400 ms blocks, 75 % overlap, −70 LUFS and −10 LU gates. */
export function integratedLoudness(p: Pcm): number {
  const sr = p.sampleRate;
  const weighted = p.channels.map((c) => kWeight(c, sr));
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const n = frames(p);
  const powers: number[] = [];
  for (let start = 0; start + block <= n; start += step) {
    let sum = 0;
    for (const w of weighted) for (let i = start; i < start + block; i++) sum += w[i]! * w[i]!;
    powers.push(sum / block);
  }
  if (powers.length === 0) return -70;
  const abs = powers.filter((v) => powerToLufs(v) > -70);
  if (abs.length === 0) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((v) => powerToLufs(v) > powerToLufs(meanAbs) - 10);
  return powerToLufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** Highest momentary (400 ms) loudness: the level measure used for short effects. */
export function maxMomentaryLoudness(p: Pcm): number {
  const env = loudnessEnvelope(p, 0.4, 0.01);
  let m = -120;
  for (const v of env) if (v > m) m = v;
  return m;
}

export function samplePeakDb(p: Pcm): number {
  let m = 0;
  for (const ch of p.channels) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]!));
  return gainToDb(m);
}

/** True peak estimate (dBTP): 4× oversampling with a windowed-sinc interpolator. */
export function truePeakDb(p: Pcm): number {
  const taps = 12; // per side
  const ratio = 4;
  const kernel: number[][] = [];
  for (let ph = 1; ph < ratio; ph++) {
    const row: number[] = [];
    const frac = ph / ratio;
    for (let k = -taps + 1; k <= taps; k++) {
      const x = k - frac;
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 1));
      row.push(sinc * w);
    }
    kernel.push(row);
  }
  let m = 0;
  for (const ch of p.channels) {
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[i]!);
      if (v > m) m = v;
      // Only interpolate around samples that could plausibly overshoot.
      if (v < m * 0.5) continue;
      for (const row of kernel) {
        let acc = 0;
        for (let k = -taps + 1, j = 0; k <= taps; k++, j++) {
          const idx = i + k;
          if (idx >= 0 && idx < n) acc += ch[idx]! * row[j]!;
        }
        if (Math.abs(acc) > m) m = Math.abs(acc);
      }
    }
  }
  return gainToDb(m);
}

/* ---------------------------------------------------------------------- fft */

/** In-place iterative radix-2 FFT (length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/* ------------------------------------------------------------ onset / tempo */

export interface OnsetEnvelopes {
  /** Frames per second of both envelopes. */
  rate: number;
  /** Seconds of frame 0 (the centre of the first analysis window). */
  offset: number;
  /** Broadband spectral flux (log magnitude, half-wave rectified, local mean removed). */
  full: Float32Array;
  /** Flux below ~180 Hz (kick / bass): used to find the downbeat. */
  low: Float32Array;
}

/** Spectral-flux onset strength of a mono signal (any sample rate; 1024-point frames). */
export function onsetEnvelopes(x: Float32Array, sr: number, hop = Math.round(sr / 86)): OnsetEnvelopes {
  const size = 1024;
  const count = Math.max(0, Math.floor((x.length - size) / hop));
  const bins = size / 2;
  const maxBin = Math.min(bins, Math.round((6000 / sr) * size));
  const lowBin = Math.max(2, Math.round((180 / sr) * size));
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let prev = new Float64Array(maxBin);
  let cur = new Float64Array(maxBin);
  const full = new Float32Array(count);
  const low = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const off = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = x[off + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sf = 0;
    let sl = 0;
    for (let b = 1; b < maxBin; b++) {
      const mag = Math.log1p(100 * Math.hypot(re[b]!, im[b]!));
      cur[b] = mag;
      const d = mag - prev[b]!;
      if (d > 0) {
        sf += d;
        if (b <= lowBin) sl += d;
      }
    }
    full[f] = f === 0 ? 0 : sf;
    low[f] = f === 0 ? 0 : sl;
    [prev, cur] = [cur, prev];
  }
  const rate = sr / hop;
  // A step onset raises the Hann-windowed energy fastest when it sits 3/4 into the window
  // (where the window's slope is steepest), i.e. 3/4 · size after the frame's start.
  const offset = (0.75 * size - hop / 2) / sr;
  return { rate, offset, full: detrend(full, Math.round(rate * 0.5)), low: detrend(low, Math.round(rate * 0.5)) };
}

/** Subtracts a centred moving average and half-wave rectifies. */
function detrend(env: Float32Array, radius: number): Float32Array {
  const n = env.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + env[i]!;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(n, i + radius + 1);
    out[i] = Math.max(0, env[i]! - (pre[b]! - pre[a]!) / (b - a));
  }
  return out;
}

function sampleAt(env: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = pos - i;
  return env[i]! * (1 - f) + env[i + 1]! * f;
}

export interface TempoEstimate {
  bpm: number;
  /** Seconds of the first beat (beats are at first + k · 60 / bpm). */
  firstBeat: number;
  /** Mean onset strength on the beat grid divided by the mean of the envelope (1 = no pulse). */
  beatStrength: number;
  /** Autocorrelation peak of the chosen period relative to the median over the search range. */
  acPeak: number;
}

/**
 * Tempo by autocorrelation of the onset envelope with a log-normal prior around
 * 120 BPM, refined on a fine grid by maximising the comb (beat grid) score.
 */
export function estimateTempo(env: OnsetEnvelopes, opts: { minBpm?: number; maxBpm?: number } = {}): TempoEstimate {
  const { rate, full } = env;
  const minBpm = opts.minBpm ?? 70;
  const maxBpm = opts.maxBpm ?? 180;
  const n = full.length;
  const lagMin = Math.floor((60 / maxBpm) * rate);
  const lagMax = Math.ceil((60 / minBpm) * rate);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += full[i]!;
  mean /= Math.max(1, n);
  const ac: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += (full[i]! - mean) * (full[i - lag]! - mean);
    ac.push(s / (n - lag));
  }
  let best = -Infinity;
  let bestLag = lagMin;
  for (let k = 0; k < ac.length; k++) {
    const lag = lagMin + k;
    const bpm = (60 * rate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const v = ac[k]! * prior;
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const acPeak = ac[bestLag - lagMin]! / Math.max(1e-9, Math.abs(median));
  // Fine search: ±3 % around the coarse tempo, comb score over the whole track. The phase is
  // taken from broadband + (weighted) low-band onsets, so the grid sits on the kicks / bass
  // notes rather than on off-beat hi-hats.
  let meanLow = 0;
  for (let i = 0; i < n; i++) meanLow += env.low[i]!;
  meanLow /= Math.max(1, n);
  const combined = new Float32Array(n);
  for (let i = 0; i < n; i++) combined[i] = full[i]! / Math.max(1e-9, mean) + (2 * env.low[i]!) / Math.max(1e-9, meanLow);
  const coarse = (60 * rate) / bestLag;
  let bestScore = -Infinity;
  let bestBpm = coarse;
  for (let bpm = coarse * 0.97; bpm <= coarse * 1.03; bpm += coarse * 0.0004) {
    const { score } = combScore(full, (60 / bpm) * rate);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  const { phase } = combScore(combined, (60 / bestBpm) * rate, 96);
  return { bpm: bestBpm, firstBeat: env.offset + phase / rate, beatStrength: bestScore / Math.max(1e-9, mean), acPeak };
}

/** Mean envelope value on a beat grid of the given period, at the best phase. */
function combScore(env: Float32Array, period: number, steps = 48): { score: number; phase: number } {
  let best = -Infinity;
  let bestPhase = 0;
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    let sum = 0;
    let count = 0;
    for (let pos = phase; pos < env.length - 1; pos += period) {
      // Small tolerance window: the max of the neighbourhood absorbs frame quantisation.
      sum += Math.max(sampleAt(env, pos - 1), sampleAt(env, pos), sampleAt(env, pos + 1));
      count++;
    }
    const score = sum / Math.max(1, count);
    if (score > best) {
      best = score;
      bestPhase = phase;
    }
  }
  return { score: best, phase: bestPhase };
}

export function beatTimes(t: TempoEstimate, duration: number): number[] {
  const period = 60 / t.bpm;
  const out: number[] = [];
  for (let b = t.firstBeat; b < duration; b += period) out.push(b);
  return out;
}

export interface DownbeatEstimate {
  /** Index (0..3) of the first beat that is a downbeat. */
  offset: number;
  /** Best score / second best score (1 = undecided). */
  confidence: number;
  /** Downbeat times, seconds. */
  times: number[];
}

/** Picks which of the four beat positions carries the bar line (strongest low-band / novelty onsets). */
export function estimateDownbeats(env: OnsetEnvelopes, beats: number[], loudness?: { env: Float32Array; hop: number }): DownbeatEstimate {
  const scores = [0, 0, 0, 0];
  for (let k = 0; k < beats.length; k++) {
    const pos = (beats[k]! - env.offset) * env.rate;
    let v = Math.max(sampleAt(env.low, pos - 1), sampleAt(env.low, pos), sampleAt(env.low, pos + 1)) * 2;
    v += Math.max(sampleAt(env.full, pos - 1), sampleAt(env.full, pos), sampleAt(env.full, pos + 1));
    if (loudness) {
      // Section changes (loudness jumps) happen on bar lines.
      const i = Math.round(beats[k]! / loudness.hop);
      const a = loudness.env[Math.max(0, i - 4)] ?? 0;
      const b = loudness.env[Math.min(loudness.env.length - 1, i + 4)] ?? 0;
      v += Math.max(0, b - a) * 0.5;
    }
    scores[k % 4] = scores[k % 4]! + v;
  }
  const order = [0, 1, 2, 3].sort((a, b) => scores[b]! - scores[a]!);
  const offset = order[0]!;
  return {
    offset,
    confidence: scores[order[0]!]! / Math.max(1e-9, scores[order[1]!]!),
    times: beats.filter((_, k) => k % 4 === offset),
  };
}

/* ---------------------------------------------------------------------- key */

const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb + 1e-20);
}

/** Key estimate (Krumhansl–Kessler profiles on a 55 Hz – 2 kHz chromagram); for the import report only. */
export function estimateKey(x: Float32Array, sr: number): { key: string; correlation: number; chroma: number[] } {
  const size = 8192;
  const hop = size;
  const chroma = new Array<number>(12).fill(0);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let off = 0; off + size <= x.length; off += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = x[off + i]! * (0.5 - 0.5 * Math.cos((TAU * i) / size));
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 1; b < size / 2; b++) {
      const f = (b * sr) / size;
      if (f < 55 || f > 2000) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] = chroma[pc]! + Math.hypot(re[b]!, im[b]!);
    }
  }
  let best = { key: '?', correlation: -2 };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]!);
    const maj = correlate(rotated, MAJOR_PROFILE);
    const min = correlate(rotated, MINOR_PROFILE);
    if (maj > best.correlation) best = { key: `${KEY_NAMES[tonic]} major`, correlation: maj };
    if (min > best.correlation) best = { key: `${KEY_NAMES[tonic]} minor`, correlation: min };
  }
  const total = chroma.reduce((s, v) => s + v, 0) || 1;
  return { ...best, chroma: chroma.map((v) => v / total) };
}

/* ----------------------------------------------------- play-list cross-fade */

export interface TakePoints {
  /** First bar line of the body (after the generated intro), seconds. */
  inPoint: number;
  /** Bar line where the body ends (before the generated outro), seconds. */
  outPoint: number;
  /** Cross-fade length, seconds (whole beats of this take's tempo). */
  crossfade: number;
  crossfadeBeats: number;
  /** Where the intro / outro were detected (before snapping to bar lines), seconds. */
  introEnd: number;
  outroStart: number;
  /** Median short-term loudness of the body, LUFS. */
  bodyLufs: number;
  notes: string[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Cross-fade length: 4 beats if that lies in 1.6–3.2 s, else 8 beats if in 1.6–3.6 s, else 2.5 s. */
export function crossfadeFor(bpm: number): { seconds: number; beats: number } {
  const beat = 60 / bpm;
  if (beat * 4 >= 1.6 && beat * 4 <= 3.2) return { seconds: beat * 4, beats: 4 };
  if (beat * 8 >= 1.6 && beat * 8 <= 3.6) return { seconds: beat * 8, beats: 8 };
  if (beat * 2 >= 1.6 && beat * 2 <= 3.2) return { seconds: beat * 2, beats: 2 };
  return { seconds: 2.5, beats: Math.max(1, Math.round(2.5 / beat)) };
}

/**
 * Chooses the in / out points of a generated take: the body starts at the bar line
 * where the short-term loudness first reaches the body level (end of the intro) and ends
 * at the last bar line before it falls away for good (start of the outro / final chord).
 */
export function chooseTakePoints(p: Pcm, bpm: number, downbeats: number[]): TakePoints {
  const notes: string[] = [];
  const duration = durationOf(p);
  const hop = 0.1;
  const mo = Array.from(loudnessEnvelope(p, 1, hop));
  const at = (i: number) => i * hop;
  const body = median(mo.slice(Math.floor(mo.length * 0.2), Math.ceil(mo.length * 0.8)));
  const { seconds: xfade, beats: xbeats } = crossfadeFor(bpm);

  // Intro: until the 1 s level first reaches body − 1.5 LU and stays above body − 4 LU for 6 s.
  let introIdx = 0;
  for (let i = 0; i < mo.length; i++) {
    if (mo[i]! < body - 1.5) continue;
    let stays = true;
    for (let j = i; j < Math.min(mo.length, i + Math.round(6 / hop)); j++) if (mo[j]! < body - 4) stays = false;
    if (stays) {
      introIdx = i;
      break;
    }
  }
  // The centred 1 s window rises ~0.5 s before the music does.
  const introEnd = Math.max(0, at(introIdx) + 0.3);
  notes.push(introEnd < 1 ? 'starts at full level (no intro to skip)' : `intro until ${introEnd.toFixed(1)} s`);
  // Outro: after the last time the 1 s level is within 1.5 LU of the body.
  let outroIdx = mo.length - 1;
  while (outroIdx > 0 && mo[outroIdx]! < body - 1.5) outroIdx--;
  let outroStart = Math.min(duration, at(outroIdx) + 0.3);
  notes.push(outroStart > duration - 2 ? 'full level to the end of the file (generator cut it off)' : `outro from ${outroStart.toFixed(1)} s`);
  // Never run into the last two seconds (generated endings, encoder padding).
  outroStart = Math.min(outroStart, duration - 2);

  // The cross-fade is centred on the in / out points (the engine lines the two up), so the
  // beat grids meet in the middle of the fade. Both halves must lie in full-level music: a
  // quiet intro tail or outro inside the fade would be heard as a dip.
  const half = xfade / 2;
  const range = (a: number, b: number) => mo.slice(Math.max(0, Math.floor(a / hop)), Math.min(mo.length, Math.ceil(b / hop) + 1));
  const meanLu = (a: number, b: number) => {
    const v = range(a, b);
    return v.length ? 10 * Math.log10(v.reduce((s, x) => s + Math.pow(10, x / 10), 0) / v.length) : -120;
  };
  const minLu = (a: number, b: number) => Math.min(...range(a, b), 0);
  const fullLevel = (a: number, b: number, fadeA: number, fadeB: number) => meanLu(a, b) >= body - 2 && minLu(fadeA, fadeB) >= body - 4;
  const bar = downbeats.length > 1 ? downbeats[1]! - downbeats[0]! : (60 / bpm) * 4;
  const inCandidates = downbeats.filter((d) => d >= introEnd - bar * 0.35 && d - half >= 0.02 && d <= introEnd + 24);
  let inPoint = inCandidates.find((d) => fullLevel(d - half, d + 4, d - half, d + half)) ?? inCandidates[0] ?? downbeats.find((d) => d - half >= 0.02) ?? half + 0.05;
  if (inCandidates.length && inPoint !== inCandidates[0]) notes.push(`in point moved ${(inPoint - inCandidates[0]!).toFixed(2)} s past the intro to reach full level`);
  const outCandidates = downbeats.filter((d) => d + half <= outroStart && d > inPoint + 30);
  let outPoint = [...outCandidates].reverse().find((d) => fullLevel(d - 4, d + half, d - half, d + half)) ?? outCandidates[outCandidates.length - 1] ?? outroStart - half;
  if (!outCandidates.length) notes.push('out point not on a bar line');
  if (outPoint - inPoint < 45) notes.push(`short body (${(outPoint - inPoint).toFixed(1)} s)`);
  inPoint = Math.max(inPoint, half + 0.02);
  outPoint = Math.min(outPoint, duration - half - 0.05);
  return { inPoint, outPoint, crossfade: xfade, crossfadeBeats: xbeats, introEnd, outroStart, bodyLufs: body, notes };
}

/** Equal-power gain curves (cos / sin), `points` samples from t = 0 to 1. */
export function equalPowerCurves(points: number): { fadeOut: Float32Array; fadeIn: Float32Array } {
  const fadeOut = new Float32Array(points);
  const fadeIn = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = points === 1 ? 1 : i / (points - 1);
    fadeOut[i] = Math.cos((t * Math.PI) / 2);
    fadeIn[i] = Math.sin((t * Math.PI) / 2);
  }
  return { fadeOut, fadeIn };
}

export interface TransitionReport {
  /** Mean momentary loudness 4 s before the cross-fade and 4 s after it, LUFS. */
  before: number;
  after: number;
  /** Lowest / highest momentary loudness inside the cross-fade, and its mean (power), LUFS. */
  minDuring: number;
  maxDuring: number;
  meanDuring: number;
  /**
   * Largest difference, inside the fade, between the momentary loudness of the mix and the
   * equal-power sum of the two faded sources measured on their own (LU). ≈ 0 means the fade
   * itself adds no dip or bump (no cancellation); the music's own dynamics are not counted.
   */
  maxDeviation: number;
  /**
   * Largest sample step inside the cross-fade relative to the largest step in the 4 s of
   * plain music before it (≤ 1 means the fade adds no step larger than the music's own).
   */
  maxStepRatio: number;
}

/**
 * Renders the transition outgoing(out) → incoming(in) exactly as the engine schedules it
 * (equal-power, the fade centred on both bar lines) and measures it.
 */
export function simulateTransition(a: Pcm, aOut: number, b: Pcm, bIn: number, xfade: number): TransitionReport {
  const sr = a.sampleRate;
  const pre = 4;
  const post = 4;
  const total = Math.round((pre + xfade + post) * sr);
  const startA = Math.round((aOut - xfade / 2 - pre) * sr);
  const startB = Math.round((bIn - xfade / 2 - pre) * sr);
  const fadeStart = Math.round(pre * sr);
  const fadeLen = Math.round(xfade * sr);
  const chs = Math.min(a.channels.length, b.channels.length);
  const out: Float32Array[] = [];
  const onlyA: Float32Array[] = [];
  const onlyB: Float32Array[] = [];
  for (let c = 0; c < chs; c++) {
    const y = new Float32Array(total);
    const ya = new Float32Array(total);
    const yb = new Float32Array(total);
    const ac = a.channels[c]!;
    const bc = b.channels[c]!;
    for (let i = 0; i < total; i++) {
      const t = (i - fadeStart) / fadeLen;
      const ga = t <= 0 ? 1 : t >= 1 ? 0 : Math.cos((t * Math.PI) / 2);
      const gb = t <= 0 ? 0 : t >= 1 ? 1 : Math.sin((t * Math.PI) / 2);
      const ia = startA + i;
      const ib = startB + i;
      const va = ga > 0 && ia >= 0 && ia < ac.length ? ac[ia]! * ga : 0;
      const vb = gb > 0 && ib >= 0 && ib < bc.length ? bc[ib]! * gb : 0;
      y[i] = va + vb;
      ya[i] = va;
      yb[i] = vb;
    }
    out.push(y);
    onlyA.push(ya);
    onlyB.push(yb);
  }
  const mix: Pcm = { sampleRate: sr, channels: out };
  const hop = 0.05;
  const env = loudnessEnvelope(mix, 0.4, hop);
  const envA = loudnessEnvelope({ sampleRate: sr, channels: onlyA }, 0.4, hop);
  const envB = loudnessEnvelope({ sampleRate: sr, channels: onlyB }, 0.4, hop);
  const idx = (sec: number) => Math.max(0, Math.min(env.length - 1, Math.round(sec / hop)));
  const meanDb = (s: number, e: number) => {
    let p = 0;
    let n = 0;
    for (let i = idx(s); i <= idx(e); i++) {
      p += Math.pow(10, (env[i]! + 0.691) / 10);
      n++;
    }
    return powerToLufs(p / Math.max(1, n));
  };
  const before = meanDb(0.3, pre - 0.3);
  const after = meanDb(pre + xfade + 0.3, pre + xfade + post - 0.3);
  let minDuring = Infinity;
  let maxDuring = -Infinity;
  let maxDeviation = 0;
  const toPow = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10);
  for (let i = idx(pre); i <= idx(pre + xfade); i++) {
    const v = env[i]!;
    minDuring = Math.min(minDuring, v);
    maxDuring = Math.max(maxDuring, v);
    const expected = powerToLufs(toPow(envA[i]!) + toPow(envB[i]!));
    maxDeviation = Math.max(maxDeviation, Math.abs(v - expected));
  }
  const m = mono(mix);
  let stepBefore = 0;
  let stepDuring = 0;
  for (let i = 1; i < m.length; i++) {
    const d = Math.abs(m[i]! - m[i - 1]!);
    if (i < fadeStart) stepBefore = Math.max(stepBefore, d);
    else if (i < fadeStart + fadeLen) stepDuring = Math.max(stepDuring, d);
  }
  const meanDuring = meanDb(pre, pre + xfade);
  return { before, after, minDuring, maxDuring, meanDuring, maxDeviation, maxStepRatio: stepDuring / Math.max(1e-9, stepBefore) };
}

/* ------------------------------------------------------------ one-shot edit */

export interface ActiveRegion {
  /** Seconds. */
  start: number;
  end: number;
  /** Peak of the whole file, dBFS. */
  peakDb: number;
  /** Noise floor: the quietest 100 ms of the file, RMS dBFS. */
  floorDb: number;
  /** The sound is still loud in the last 30 ms of the file: the generator cut it off. */
  truncated: boolean;
  /** Highest 50 ms RMS, dBFS. */
  maxRmsDb: number;
}

function windowRmsDb(m: Float32Array, sr: number, seconds: number): number[] {
  const w = Math.max(1, Math.round(seconds * sr));
  const out: number[] = [];
  for (let i = 0; i + w <= m.length; i += Math.max(1, Math.round(w / 2))) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += m[j]! * m[j]!;
    out.push(gainToDb(Math.sqrt(s / w)));
  }
  if (out.length === 0) {
    let s = 0;
    for (let j = 0; j < m.length; j++) s += m[j]! * m[j]!;
    out.push(gainToDb(Math.sqrt(s / Math.max(1, m.length))));
  }
  return out;
}

/**
 * Finds where a one-shot really starts and ends: 10 ms peaks above
 * max(peak − range, floor + margin), where floor is the quietest 100 ms (RMS).
 */
export function activeRegion(p: Pcm, opts: { rangeDb?: number; floorMarginDb?: number } = {}): ActiveRegion {
  const sr = p.sampleRate;
  const m = mono(p);
  const frame = Math.round(0.01 * sr);
  const peaks: number[] = [];
  for (let i = 0; i < m.length; i += frame) {
    let pk = 0;
    for (let j = i; j < Math.min(m.length, i + frame); j++) pk = Math.max(pk, Math.abs(m[j]!));
    peaks.push(gainToDb(pk));
  }
  const peakDb = Math.max(...peaks);
  const floorDb = Math.min(...windowRmsDb(m, sr, 0.1));
  const maxRmsDb = Math.max(...windowRmsDb(m, sr, 0.05));
  // A 10 ms peak of noise sits ~10 dB over its RMS: the margin is counted from there.
  const threshold = Math.max(peakDb - (opts.rangeDb ?? 36), floorDb + 10 + (opts.floorMarginDb ?? 6));
  let first = peaks.findIndex((v) => v >= threshold);
  if (first < 0) first = 0;
  let last = peaks.length - 1;
  while (last > first && peaks[last]! < threshold) last--;
  const tail = peaks.slice(-3);
  const truncated = tail.some((v) => v >= peakDb - 20);
  return {
    start: Math.max(0, first * 0.01 - 0.004),
    end: Math.min(m.length / sr, (last + 1) * 0.01 + 0.03),
    peakDb,
    floorDb,
    truncated,
    maxRmsDb,
  };
}

/** Why a generated sound cannot be used (null = usable): silent, or nothing but a steady quiet floor. */
export function unusableReason(r: ActiveRegion): string | null {
  const snr = r.maxRmsDb - r.floorDb;
  if (r.maxRmsDb < -55 || (r.maxRmsDb < -40 && snr < 10)) {
    return `too quiet to use: loudest 50 ms ${r.maxRmsDb.toFixed(1)} dBFS RMS, only ${snr.toFixed(1)} dB above the quietest 100 ms (${r.floorDb.toFixed(1)} dBFS RMS)`;
  }
  return null;
}

/**
 * Downward expander: attenuates by up to `rangeDb` where the (linked) envelope is below
 * `thresholdDb`; attack / release keep transients and tails natural. In place.
 */
export function gate(p: Pcm, thresholdDb: number, rangeDb: number, attackMs = 2, releaseMs = 60): void {
  const sr = p.sampleRate;
  const n = frames(p);
  const thr = dbToGain(thresholdDb);
  const floor = dbToGain(-Math.abs(rangeDb));
  const aEnv = Math.exp(-1 / (0.0015 * sr));
  const rEnv = Math.exp(-1 / (0.03 * sr));
  const aG = Math.exp(-1 / ((attackMs / 1000) * sr));
  const rG = Math.exp(-1 / ((releaseMs / 1000) * sr));
  // Look-ahead of 3 ms so the gate is already open when a transient arrives.
  const look = Math.round(0.003 * sr);
  let env = 0;
  let g = floor;
  const gains = new Float32Array(n);
  for (let i = 0; i < n + look; i++) {
    const j = Math.min(n - 1, i);
    let v = 0;
    for (const ch of p.channels) v = Math.max(v, Math.abs(ch[j]!));
    env = v > env ? aEnv * env + (1 - aEnv) * v : rEnv * env + (1 - rEnv) * v;
    const target = env >= thr ? 1 : Math.max(floor, Math.pow(env / thr, 2));
    g = target > g ? aG * g + (1 - aG) * target : rG * g + (1 - rG) * target;
    const k = i - look;
    if (k >= 0) gains[k] = g;
  }
  for (const ch of p.channels) for (let i = 0; i < n; i++) ch[i] = ch[i]! * gains[i]!;
}

/** Raised-cosine fades in place. */
export function fadeEdges(p: Pcm, inMs: number, outMs: number): void {
  const sr = p.sampleRate;
  const n = frames(p);
  const fi = Math.min(n, Math.round((inMs / 1000) * sr));
  const fo = Math.min(n, Math.round((outMs / 1000) * sr));
  for (const ch of p.channels) {
    for (let i = 0; i < fi; i++) ch[i] = ch[i]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fi));
    for (let i = 0; i < fo; i++) ch[n - 1 - i] = ch[n - 1 - i]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fo));
  }
}

/** Removes DC with a gentle high-pass (20 Hz) in place. */
export function removeDc(p: Pcm): void {
  for (const ch of p.channels) {
    Bq.highpass(p.sampleRate, 20, 0.707).run(ch);
  }
}

export function scale(p: Pcm, gain: number): void {
  for (const ch of p.channels) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * gain;
}

/** Mean side / mid energy ratio in dB (very negative = effectively mono). */
export function sideToMidDb(p: Pcm): number {
  if (p.channels.length < 2) return -120;
  const [l, r] = p.channels as [Float32Array, Float32Array];
  let mid = 0;
  let side = 0;
  for (let i = 0; i < l.length; i++) {
    mid += ((l[i]! + r[i]!) / 2) ** 2;
    side += ((l[i]! - r[i]!) / 2) ** 2;
  }
  return 10 * Math.log10(Math.max(side, 1e-20) / Math.max(mid, 1e-20));
}

/* ------------------------------------------------------------- seamless loop */

export interface LoopResult {
  pcm: Pcm;
  /** Source seconds the loop was cut from. */
  start: number;
  end: number;
  crossfade: number;
  /** |x[0] − x[N−1]| relative to the mean absolute sample step (≈ 1 = seamless). */
  seamStepRatio: number;
  /** Share of the loop's own sample steps that are smaller than the step across the wrap (0..1). */
  seamPercentile: number;
  /** Momentary loudness range over two passes of the loop, LU. */
  levelRange: number;
}

/**
 * Cuts a seamless loop from a steady texture: the last `crossfade` seconds of [start, end)
 * are cross-faded (equal power) with the audio just before `start`, so playback wrapping
 * from the end to the start continues the original signal. `end` is moved to the position
 * (±25 ms) where the waveform best matches the material before `start`.
 */
export function makeSeamlessLoop(p: Pcm, start: number, end: number, crossfade: number, startSearch = 0.1): LoopResult {
  const sr = p.sampleRate;
  const x = Math.round(crossfade * sr);
  const m = mono(p);
  // The wrap repeats the waveform around the loop start every pass: start where it is calm
  // (smallest local sample step within ±0.1 s of the requested start).
  const localStep = (k: number) => {
    let mx = 0;
    for (let j = k - 4; j <= k + 4; j++) mx = Math.max(mx, Math.abs(m[j]! - m[j - 1]!));
    return mx;
  };
  let a = Math.round(start * sr);
  let bestStep = Infinity;
  for (let k = Math.round((start - startSearch) * sr); k <= Math.round((start + startSearch) * sr); k++) {
    if (k - 5 < x || k + 5 >= m.length) continue;
    const v = localStep(k);
    if (v < bestStep) {
      bestStep = v;
      a = k;
    }
  }
  end += a / sr - start;
  if (a < x) throw new Error('loop start needs at least one cross-fade of pre-roll');
  // Align: pick b so that the window before b correlates best with the window before a.
  const w = Math.round(0.03 * sr);
  let bestB = Math.round(end * sr);
  let bestC = -Infinity;
  const search = Math.round(0.025 * sr);
  for (let b = Math.round(end * sr) - search; b <= Math.round(end * sr) + search; b++) {
    if (b > m.length || b - w < 0) continue;
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < w; i++) {
      const u = m[a - w + i]!;
      const v = m[b - w + i]!;
      ab += u * v;
      aa += u * u;
      bb += v * v;
    }
    const c = ab / Math.sqrt(aa * bb + 1e-20);
    if (c > bestC) {
      bestC = c;
      bestB = b;
    }
  }
  const b = bestB;
  const len = b - a;
  const channels = p.channels.map((ch) => {
    const out = ch.slice(a, b);
    for (let i = 0; i < x; i++) {
      const t = (i + 0.5) / x;
      const gOut = Math.cos((t * Math.PI) / 2);
      const gIn = Math.sin((t * Math.PI) / 2);
      const k = len - x + i;
      // The tail fades out while the material that precedes the loop start fades in.
      out[k] = ch[a + k]! * gOut + ch[a - x + i]! * gIn;
    }
    return out;
  });
  const loop: Pcm = { sampleRate: sr, channels };
  const lm = mono(loop);
  let sum = 0;
  for (let i = 1; i < lm.length; i++) sum += Math.abs(lm[i]! - lm[i - 1]!);
  const meanStep = sum / Math.max(1, lm.length - 1);
  const seam = Math.abs(lm[0]! - lm[lm.length - 1]!);
  let smaller = 0;
  for (let i = 1; i < lm.length; i++) if (Math.abs(lm[i]! - lm[i - 1]!) < seam) smaller++;
  const twice: Pcm = { sampleRate: sr, channels: channels.map((c) => {
    const t = new Float32Array(c.length * 2);
    t.set(c, 0);
    t.set(c, c.length);
    return t;
  }) };
  const env = loudnessEnvelope(twice, 0.4, 0.05);
  const inner = Array.from(env).slice(4, env.length - 4);
  return {
    pcm: loop,
    start: a / sr,
    end: b / sr,
    crossfade,
    seamStepRatio: seam / Math.max(1e-9, meanStep),
    seamPercentile: smaller / Math.max(1, lm.length - 1),
    levelRange: Math.max(...inner) - Math.min(...inner),
  };
}
