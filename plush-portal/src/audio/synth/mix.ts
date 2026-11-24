/** Song container: named stems with sends, a periodic master chain and loop-file assembly. */
import { SR, Stem, dbToGain, gainToDb, peakOf, rmsOf } from './core';
import {
  Biquad,
  chorusStereo,
  filterCircular,
  integratedLufs,
  limit,
  pingPongCircular,
  reverbCircular,
  type ReverbOptions,
} from './dsp';
import type { Timeline } from './seq';

export interface StemConfig {
  /** Level of the stem in the mix (linear). */
  gain: number;
  /** Send levels (linear, post gain). */
  reverb?: number;
  delay?: number;
  /** High-pass / low-pass on the stem, Hz. */
  hp?: number;
  lp?: number;
  chorus?: { rateHz: number; depthMs: number; baseMs: number; mix: number };
  /** Side-chain depth 0..1 applied from the song's pump envelope. */
  pump?: number;
}

export interface MixOptions {
  reverb: ReverbOptions;
  /** Tempo-synced ping-pong delay. */
  delay?: { beats: number; feedback: number; damping: number; toReverb?: number };
  targetLufs: number;
  ceilingDb: number;
  /** Gentle tonal shaping of the whole mix. */
  lowShelfDb?: number;
  highShelfDb?: number;
}

export interface MixResult {
  l: Float32Array;
  r: Float32Array;
  lufs: number;
  peakDb: number;
  limiterDb: number;
  /** Pre-master level of every stem (dB RMS, after its gain), for balance checks. */
  stems?: Record<string, number>;
}

export class Song {
  private readonly entries = new Map<string, { stem: Stem; cfg: StemConfig }>();
  /** Beat positions that trigger the side-chain "pump". */
  pumpBeats: number[] = [];
  pumpTau = 0.11;

  constructor(readonly tl: Timeline) {}

  stem(name: string, cfg: StemConfig): Stem {
    const existing = this.entries.get(name);
    if (existing) return existing.stem;
    const stem = new Stem(this.tl.loopSamples, true);
    this.entries.set(name, { stem, cfg });
    return stem;
  }

  stemNames(): string[] {
    return [...this.entries.keys()];
  }

  private pumpEnvelope(): Float32Array | null {
    if (this.pumpBeats.length === 0) return null;
    const n = this.tl.loopSamples;
    const env = new Float32Array(n);
    const starts = this.pumpBeats.map((b) => ((Math.round(this.tl.sampleAt(b)) % n) + n) % n).sort((a, b) => a - b);
    const tau = this.pumpTau * SR;
    // Two passes so the last kick of the loop still shapes the first bar.
    let last = starts[starts.length - 1]! - n;
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < starts.length && starts[k]! <= i) {
        last = starts[k]!;
        k++;
      }
      env[i] = Math.exp(-(i - last) / tau);
    }
    return env;
  }

  mixdown(opts: MixOptions): MixResult {
    const n = this.tl.loopSamples;
    const master = new Stem(n, true);
    const revIn = new Stem(n, true);
    const dlyIn = new Stem(n, true);
    const pump = this.pumpEnvelope();
    const stemLevels: Record<string, number> = {};

    for (const [name, { stem, cfg }] of this.entries) {
      if (cfg.hp) {
        filterCircular(stem.l, Biquad.highpass(cfg.hp));
        filterCircular(stem.r, Biquad.highpass(cfg.hp));
      }
      if (cfg.lp) {
        filterCircular(stem.l, Biquad.lowpass(cfg.lp));
        filterCircular(stem.r, Biquad.lowpass(cfg.lp));
      }
      if (cfg.chorus) chorusStereo(stem.l, stem.r, { ...cfg.chorus, circular: true });
      if (cfg.pump && pump) {
        for (let i = 0; i < n; i++) {
          const g = 1 - cfg.pump * pump[i]!;
          stem.l[i] = stem.l[i]! * g;
          stem.r[i] = stem.r[i]! * g;
        }
      }
      stemLevels[name] = Math.round(gainToDb(rmsOf(stem.l, stem.r) * cfg.gain) * 10) / 10;
      stem.mixInto(master, cfg.gain);
      if (cfg.reverb) stem.mixInto(revIn, cfg.gain * cfg.reverb);
      if (cfg.delay) stem.mixInto(dlyIn, cfg.gain * cfg.delay);
    }

    if (opts.delay) {
      const wet = pingPongCircular(dlyIn.l, dlyIn.r, {
        delaySamples: this.tl.sampleAt(opts.delay.beats),
        feedback: opts.delay.feedback,
        damping: opts.delay.damping,
      });
      const toRev = opts.delay.toReverb ?? 0.3;
      stemLevels['(delay wet)'] = Math.round(gainToDb(rmsOf(wet.l, wet.r)) * 10) / 10;
      for (let i = 0; i < n; i++) {
        master.l[i] = master.l[i]! + wet.l[i]!;
        master.r[i] = master.r[i]! + wet.r[i]!;
        revIn.l[i] = revIn.l[i]! + wet.l[i]! * toRev;
        revIn.r[i] = revIn.r[i]! + wet.r[i]! * toRev;
      }
    }

    const wet = reverbCircular(revIn.l, revIn.r, opts.reverb);
    stemLevels['(reverb wet)'] = Math.round(gainToDb(rmsOf(wet.l, wet.r)) * 10) / 10;
    for (let i = 0; i < n; i++) {
      master.l[i] = master.l[i]! + wet.l[i]!;
      master.r[i] = master.r[i]! + wet.r[i]!;
    }

    // Master: rumble filter and optional broad tone shaping (all periodic).
    for (const ch of [master.l, master.r]) {
      filterCircular(ch, Biquad.highpass(30, 0.707));
      if (opts.lowShelfDb) filterCircular(ch, Biquad.lowshelf(140, opts.lowShelfDb));
      if (opts.highShelfDb) filterCircular(ch, Biquad.highshelf(7000, opts.highShelfDb));
    }

    const result = finalizeLoudness(master.l, master.r, opts.targetLufs, opts.ceilingDb, true);
    result.stems = stemLevels;
    return result;
  }
}

/**
 * Brings a mix to the target loudness and keeps peaks under the ceiling with
 * the look-ahead limiter; iterates because limiting lowers the loudness a bit.
 */
export function finalizeLoudness(
  l: Float32Array,
  r: Float32Array,
  targetLufs: number,
  ceilingDb: number,
  circular: boolean,
): MixResult {
  const ceiling = dbToGain(ceilingDb);
  let limiterDb = 0;
  let lufs = integratedLufs(l, r);
  for (let pass = 0; pass < 4; pass++) {
    const diff = targetLufs - lufs;
    if (Math.abs(diff) < 0.15 && peakOf(l, r) <= ceiling * 1.0001) break;
    const g = dbToGain(diff);
    for (let i = 0; i < l.length; i++) {
      l[i] = l[i]! * g;
      r[i] = r[i]! * g;
    }
    const res = limit(l, r, { ceiling, lookaheadMs: 5, releaseMs: 140, circular });
    limiterDb = Math.max(limiterDb, res.maxReductionDb);
    lufs = integratedLufs(l, r);
  }
  return { l, r, lufs, peakDb: gainToDb(peakOf(l, r)), limiterDb };
}

export interface LoopFile {
  l: Float32Array;
  r: Float32Array;
  /** Seconds. Looping [loopStart, loopEnd) is seamless. */
  loopStart: number;
  loopEnd: number;
  duration: number;
  loopSamples: number;
}

/** Seconds of the end of the loop written before it, and of its start written after it. */
export const LOOP_PRE_ROLL = 0.25;
export const LOOP_POST_ROLL = 1.5;

/**
 * Lays a periodic loop out as a file that is periodic over its whole length:
 * [last 0.25 s of the loop][loop][first 1.5 s of the loop]. Whatever delay or
 * padding an encoder / decoder adds, the window [loopStart, loopEnd) always
 * falls on real, periodic content.
 */
export function assembleLoopFile(l: Float32Array, r: Float32Array): LoopFile {
  const n = l.length;
  const pre = Math.round(LOOP_PRE_ROLL * SR);
  const post = Math.round(LOOP_POST_ROLL * SR);
  const total = pre + n + post;
  const outL = new Float32Array(total);
  const outR = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const src = (((i - pre) % n) + n) % n;
    outL[i] = l[src]!;
    outR[i] = r[src]!;
  }
  return {
    l: outL,
    r: outR,
    loopStart: pre / SR,
    loopEnd: (pre + n) / SR,
    duration: total / SR,
    loopSamples: n,
  };
}

/** Normalises a one-shot to a peak level and guarantees click-free edges. */
export function finishOneShot(buf: Float32Array, peakDb: number, opts: { fadeInMs?: number; fadeOutMs?: number; trimDb?: number } = {}): Float32Array {
  // Trim trailing near-silence.
  const threshold = dbToGain(opts.trimDb ?? -66) * Math.max(peakOf(buf), 1e-9);
  let end = buf.length;
  while (end > 64 && Math.abs(buf[end - 1]!) < threshold) end--;
  end = Math.min(buf.length, end + Math.round(0.004 * SR));
  const out = buf.slice(0, end);
  // Remove DC so fades end at true zero.
  const hp = Biquad.highpass(28, 0.707);
  hp.run(out);
  const peak = peakOf(out);
  const g = peak > 0 ? dbToGain(peakDb) / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * g;
  const fi = Math.min(out.length, Math.round(((opts.fadeInMs ?? 0.4) / 1000) * SR));
  for (let i = 0; i < fi; i++) out[i] = out[i]! * (i / fi);
  const fo = Math.min(out.length, Math.round(((opts.fadeOutMs ?? 6) / 1000) * SR));
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] = out[out.length - 1 - i]! * (i / fo);
  return out;
}
