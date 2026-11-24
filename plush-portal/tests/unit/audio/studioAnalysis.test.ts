/** The import tool's signal analysis (tools/audio/lib/studioAnalysis.ts) on synthetic signals. */
import { describe, expect, it } from 'vitest';
import {
  activeRegion,
  beatTimes,
  chooseTakePoints,
  crossfadeFor,
  estimateDownbeats,
  estimateTempo,
  integratedLoudness,
  makeSeamlessLoop,
  onsetEnvelopes,
  simulateTransition,
  unusableReason,
  type Pcm,
} from '../../../tools/audio/lib/studioAnalysis';

const SR = 44100;

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A drum-machine-like track: kick on every beat (louder on the downbeat), noise hats between, a tone bed. */
function groove(bpm: number, seconds: number, opts: { level?: (t: number) => number; seed?: number; tone?: number; kickHz?: number } = {}): Pcm {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = rng(opts.seed ?? 3);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = Math.floor(t / beat);
    const tb = t - k * beat;
    const accent = k % 4 === 0 ? 1 : 0.55;
    let v = Math.sin(2 * Math.PI * ((opts.kickHz ?? 60) + 90 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9) * accent;
    const th = (t + beat / 2) % beat;
    v += (r() * 2 - 1) * 0.12 * Math.exp(-th * 40);
    v += Math.sin(2 * Math.PI * (opts.tone ?? 220) * t) * 0.08;
    l[i] = v * 0.5 * (opts.level ? opts.level(t) : 1);
  }
  return { sampleRate: SR, channels: [l, Float32Array.from(l)] };
}

function downsample(p: Pcm): { x: Float32Array; sr: number } {
  const m = p.channels[0]!;
  const x = new Float32Array(Math.floor(m.length / 4));
  for (let i = 0; i < x.length; i++) x[i] = (m[i * 4]! + m[i * 4 + 1]! + m[i * 4 + 2]! + m[i * 4 + 3]!) / 4;
  return { x, sr: SR / 4 };
}

describe('studio analysis', () => {
  it('finds the tempo, the beat grid and the bar line of a steady groove', () => {
    const p = groove(117, 40);
    const { x, sr } = downsample(p);
    const env = onsetEnvelopes(x, sr, 128);
    const tempo = estimateTempo(env);
    expect(tempo.bpm).toBeGreaterThan(116.5);
    expect(tempo.bpm).toBeLessThan(117.5);
    expect(tempo.beatStrength).toBeGreaterThan(2);
    const beats = beatTimes(tempo, 40);
    // The grid lands on the kicks (within 25 ms).
    const period = 60 / 117;
    for (const b of beats.slice(2, 10)) {
      const err = Math.abs(b / period - Math.round(b / period)) * period;
      expect(err).toBeLessThan(0.025);
    }
    const bars = estimateDownbeats(env, beats);
    for (const d of bars.times.slice(1, 6)) expect(Math.round(d / period) % 4).toBe(0);
  });

  it('chooses in / out points past a quiet intro and before a fading outro, on bar lines', () => {
    const p = groove(120, 60, { level: (t) => (t < 8 ? 0.2 : t > 52 ? Math.max(0.02, 1 - (t - 52) / 4) : 1) });
    const { x, sr } = downsample(p);
    const env = onsetEnvelopes(x, sr, 128);
    const tempo = estimateTempo(env);
    const bars = estimateDownbeats(env, beatTimes(tempo, 60));
    const points = chooseTakePoints(p, tempo.bpm, bars.times);
    expect(points.inPoint).toBeGreaterThanOrEqual(7.5);
    expect(points.inPoint).toBeLessThan(12);
    expect(points.outPoint + points.crossfade / 2).toBeLessThanOrEqual(52.6);
    expect(points.outPoint).toBeGreaterThan(44);
    expect(points.crossfade).toBeCloseTo(2, 2); // four beats at 120 BPM
    const bar = (60 / tempo.bpm) * 4;
    for (const pt of [points.inPoint, points.outPoint]) {
      const k = Math.round((pt - bars.times[0]!) / bar);
      expect(Math.abs(pt - (bars.times[0]! + k * bar))).toBeLessThan(0.03);
    }
  });

  it('picks whole-beat cross-fades of about 2–3 s', () => {
    expect(crossfadeFor(120)).toEqual({ seconds: 2, beats: 4 });
    expect(crossfadeFor(90).beats).toBe(4);
    expect(crossfadeFor(170).beats).toBe(8);
    for (const bpm of [70, 95, 128, 160, 180]) {
      const c = crossfadeFor(bpm);
      expect(c.seconds).toBeGreaterThanOrEqual(1.6);
      expect(c.seconds).toBeLessThanOrEqual(3.6);
    }
  });

  it('renders an equal-power hand-over between two takes without a dip of its own', () => {
    // Different material (kick, tone, noise) on the same tempo, beat grids lined up by the hand-over.
    const a = groove(120, 30, { seed: 5, tone: 220, kickHz: 55 });
    const b = groove(120, 30, { seed: 9, tone: 330, kickHz: 85 });
    const rep = simulateTransition(a, 20, b, 6, 2);
    // Coinciding kicks add partly coherently (equal power assumes uncorrelated material): ≤ 3 dB.
    expect(rep.maxDeviation).toBeLessThan(3);
    expect(rep.meanDuring).toBeGreaterThan(Math.min(rep.before, rep.after) - 1.5);
    expect(Math.abs(rep.after - rep.before)).toBeLessThan(1.5);
    expect(rep.maxStepRatio).toBeLessThan(1.5);
  });

  it('cuts a seamless loop out of a steady texture', () => {
    const n = 3 * SR;
    const ch = new Float32Array(n);
    const r = rng(11);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += ((r() * 2 - 1) - lp) * 0.2;
      ch[i] = lp * 0.5 + Math.sin((2 * Math.PI * 97 * i) / SR) * 0.3;
    }
    const loop = makeSeamlessLoop({ sampleRate: SR, channels: [ch] }, 0.45, 2.75, 0.25);
    expect(loop.seamStepRatio).toBeLessThan(4);
    expect(loop.levelRange).toBeLessThan(3);
    expect(loop.end - loop.start).toBeGreaterThan(2.2);
  });

  it('finds the active part of a one-shot and rejects a file that is only a quiet floor', () => {
    const n = 2 * SR;
    const ch = new Float32Array(n);
    const r = rng(2);
    for (let i = 0; i < n; i++) ch[i] = (r() * 2 - 1) * 0.0015; // −60 dBFS-ish floor
    for (let i = 0; i < 0.3 * SR; i++) ch[Math.round(0.5 * SR) + i] += Math.sin((2 * Math.PI * 880 * i) / SR) * Math.exp(-i / (0.08 * SR)) * 0.5;
    const region = activeRegion({ sampleRate: SR, channels: [ch] });
    expect(region.start).toBeGreaterThan(0.48);
    expect(region.start).toBeLessThan(0.51);
    expect(region.end).toBeLessThan(1.0);
    expect(region.truncated).toBe(false);
    expect(unusableReason(region)).toBeNull();
    const floorOnly = activeRegion({ sampleRate: SR, channels: [Float32Array.from(ch.subarray(0, 0.4 * SR))] });
    expect(unusableReason(floorOnly)).toMatch(/too quiet/);
  });

  it('measures integrated loudness like BS.1770 (a full-scale 1 kHz sine is about −3 LUFS)', () => {
    const n = 5 * SR;
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = Math.sin((2 * Math.PI * 1000 * i) / SR);
    const lufs = integratedLoudness({ sampleRate: SR, channels: [l] });
    expect(lufs).toBeGreaterThan(-3.6);
    expect(lufs).toBeLessThan(-2.4);
  });
});
