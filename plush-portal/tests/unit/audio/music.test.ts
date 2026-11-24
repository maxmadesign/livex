import { beforeAll, describe, expect, it } from 'vitest';
import { THEME_IDS, type ThemeId } from '../../../src/core/types';
import {
  AUDIO_SOURCE_THEMES,
  AUDIO_THEME_SOURCE,
  LOOP_POST_ROLL,
  LOOP_PRE_ROLL,
  MUSIC_SCORES,
  SR,
  dbToGain,
  hasInvalidSamples,
  parseChord,
  parseLine,
  peakOf,
  renderMusic,
  rmsOf,
  type MusicRender,
} from '../../../src/audio/synth/index';

/** Themes with a track of their own; a theme that borrows another theme's track is not rendered twice. */
const TRACKS = AUDIO_SOURCE_THEMES;

const renders = {} as Record<ThemeId, MusicRender>;
const monos = {} as Record<ThemeId, Float32Array>;

beforeAll(() => {
  for (const theme of TRACKS) {
    const r = renderMusic(theme);
    renders[theme] = r;
    const m = new Float32Array(r.loop.l.length);
    for (let i = 0; i < m.length; i++) m[i] = 0.5 * (r.loop.l[i]! + r.loop.r[i]!);
    monos[theme] = m;
  }
  // Five full tracks are rendered here; on a loaded shared machine this can take several minutes.
}, 600_000);

/* --------------------------------------------------------------- analysis */

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function envelope(mono: Float32Array, hop = 441): Float32Array {
  const n = Math.floor(mono.length / hop);
  const e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < hop; i++) s += mono[k * hop + i]! ** 2;
    e[k] = Math.sqrt(s / hop);
  }
  return e;
}

function onsets(env: Float32Array): Float32Array {
  const o = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) o[i] = Math.max(0, env[i]! - env[i - 1]!);
  return o;
}

function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return ab / Math.sqrt(aa * bb);
}

/** Normalised autocorrelation of an onset envelope at a fractional lag (in envelope hops). */
function autocorr(o: Float32Array, lag: number): number {
  const l0 = Math.floor(lag);
  const f = lag - l0;
  let s = 0;
  let e = 0;
  for (let i = 0; i + l0 + 1 < o.length; i++) {
    s += o[i]! * (o[i + l0]! * (1 - f) + o[i + l0 + 1]! * f);
    e += o[i]! * o[i]!;
  }
  return s / e;
}

/** How well an onset envelope (100 Hz) fits a tempo: self-similarity at an 8th, a beat, two beats and a bar. */
function tempoScore(o: Float32Array, bpm: number): number {
  const beat = (60 / bpm) * 100;
  return (autocorr(o, beat / 2) + autocorr(o, beat) + autocorr(o, 2 * beat) + autocorr(o, 4 * beat)) / 4;
}

/** Energy per pitch class (C = 0) measured from the audio. */
function chroma(mono: Float32Array): number[] {
  const out = new Array<number>(12).fill(0);
  const frame = 8192;
  for (let midi = 48; midi <= 95; midi++) {
    const w = (2 * Math.PI * 440 * Math.pow(2, (midi - 69) / 12)) / SR;
    const c = Math.cos(w);
    const s = Math.sin(w);
    let acc = 0;
    for (let start = 0; start + frame <= mono.length; start += frame * 2) {
      let re = 0;
      let im = 0;
      let cr = 1;
      let ci = 0;
      for (let i = 0; i < frame; i++) {
        const x = mono[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame));
        re += x * cr;
        im += x * ci;
        const n = cr * c - ci * s;
        ci = cr * s + ci * c;
        cr = n;
      }
      acc += re * re + im * im;
    }
    out[midi % 12] = out[midi % 12]! + acc;
  }
  return out;
}

const SCALES: Partial<Record<ThemeId, number[]>> = {
  sakura: [5, 7, 9, 10, 0, 2, 4], // F major
  storybook: [7, 9, 11, 0, 2, 4, 6], // G major
  ocean: [2, 4, 6, 7, 9, 11, 1], // D major
  cosmic: [9, 11, 1, 2, 4, 6, 8], // A major / F# minor
  gpu: [4, 6, 8, 9, 11, 1, 3], // E major / C# minor
};

/* ------------------------------------------------------------------ tests */

describe('music: theme → track mapping', () => {
  it('every theme plays a track that exists (its own or the one it borrows)', () => {
    for (const theme of THEME_IDS) {
      const source = AUDIO_THEME_SOURCE[theme];
      expect(TRACKS, theme).toContain(source);
      expect(MUSIC_SCORES[theme].data, theme).toBe(MUSIC_SCORES[source].data);
    }
  });
});

describe.each(TRACKS)('music: %s', (theme) => {
  it('is at least 60 s long, finite, and laid out as a periodic file', () => {
    const { loop, file } = renders[theme];
    const n = loop.l.length;
    expect(n / SR).toBeGreaterThanOrEqual(60);
    expect(n % 1152).toBe(0);
    expect(hasInvalidSamples(loop.l, loop.r)).toBe(false);
    expect(file.loopSamples).toBe(n);
    expect(file.loopEnd - file.loopStart).toBeCloseTo(n / SR, 9);
    expect(file.duration).toBeCloseTo(LOOP_PRE_ROLL + n / SR + LOOP_POST_ROLL, 6);
    // Every sample of the pre- and post-roll equals the sample one loop length away.
    const extra = file.l.length - n;
    for (let i = 0; i < extra; i += 97) {
      expect(file.l[i]).toBe(file.l[i + n]);
      expect(file.r[i]).toBe(file.r[i + n]);
    }
  });

  it('stays below 0 dBFS at the target loudness without DC', () => {
    const { loop } = renders[theme];
    expect(peakOf(loop.l, loop.r)).toBeLessThanOrEqual(dbToGain(-1.5) + 1e-4);
    expect(loop.lufs).toBeGreaterThan(-16.6);
    expect(loop.lufs).toBeLessThan(-15.4);
    let dc = 0;
    for (let i = 0; i < loop.l.length; i++) dc += loop.l[i]! + loop.r[i]!;
    expect(Math.abs(dc / (2 * loop.l.length))).toBeLessThan(1e-3);
  });

  it('has no click at the loop seam', () => {
    const { loop } = renders[theme];
    for (const ch of [loop.l, loop.r]) {
      const n = ch.length;
      const deltas = new Float32Array(n - 1);
      for (let i = 1; i < n; i++) deltas[i - 1] = Math.abs(ch[i]! - ch[i - 1]!);
      const seam = Math.abs(ch[0]! - ch[n - 1]!);
      // The wrap must look like any other pair of neighbouring samples.
      expect(seam).toBeLessThanOrEqual(percentile(deltas, 0.999));
    }
  });

  it('carries the tails of the last bar into the first bar', () => {
    // Remove the wrap: if the render were not periodic the first milliseconds
    // would be far quieter than the same position one bar later.
    const mono = monos[theme];
    const first = rmsOf(mono.subarray(0, Math.round(0.004 * SR)));
    expect(first).toBeGreaterThan(dbToGain(-60));
  });

  it('never drops out and is real stereo', () => {
    const { loop } = renders[theme];
    const win = 2 * SR;
    for (let start = 0; start + win <= loop.l.length; start += SR) {
      expect(rmsOf(loop.l.subarray(start, start + win), loop.r.subarray(start, start + win))).toBeGreaterThan(dbToGain(-34));
    }
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < loop.l.length; i += 3) {
      lr += loop.l[i]! * loop.r[i]!;
      ll += loop.l[i]! ** 2;
      rr += loop.r[i]! ** 2;
    }
    const corr = lr / Math.sqrt(ll * rr);
    expect(corr).toBeLessThan(0.97);
    expect(corr).toBeGreaterThan(0.4);
  });

  it('is written consistently: full bars and a melody that fits its chords', () => {
    const { meta, melody, progression } = MUSIC_SCORES[theme].data;
    const bars = melody.split('|').map((b) => b.trim());
    expect(bars).toHaveLength(meta.bars);
    expect(progression).toHaveLength(meta.bars);
    expect(meta.sections.reduce((a, s) => a + s.bars, 0)).toBe(meta.bars);
    let strong = 0;
    let consonant = 0;
    bars.forEach((text, bar) => {
      const { notes, beats } = parseLine(text);
      expect(beats, `${theme} bar ${bar}`).toBeCloseTo(meta.beatsPerBar, 6);
      const symbols = progression[bar]!.trim().split(/\s+/);
      for (const n of notes) {
        if (!(Math.abs(n.beat % 2) < 1e-6 || n.dur >= 1.5)) continue;
        const chord = parseChord(symbols[Math.min(symbols.length - 1, Math.floor((n.beat / meta.beatsPerBar) * symbols.length))]!);
        const pc = ((n.midi % 12) + 12) % 12;
        const rel = (pc - chord.root + 12) % 12;
        strong++;
        if (chord.pcs.includes(pc) || rel === 2 || rel === 9 || (chord.intervals.includes(3) && rel === 5)) consonant++;
      }
    });
    expect(consonant / strong).toBeGreaterThan(0.95);
  });

  it('sounds in the key it claims (measured from the audio)', () => {
    const c = chroma(monos[theme]);
    const order = c.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    const top7 = order.slice(0, 7).map(([, i]) => i);
    expect(SCALES[theme], `add the scale of the ${theme} track to SCALES`).toBeDefined();
    expect(top7.filter((pc) => SCALES[theme]!.includes(pc)).length).toBeGreaterThanOrEqual(6);
    const total = c.reduce((a, b) => a + b, 0);
    const diatonic = c.reduce((a, v, i) => a + (SCALES[theme]!.includes(i) ? v : 0), 0);
    expect(diatonic / total).toBeGreaterThan(0.8);
  });
});

describe('music: the tracks are different pieces', () => {
  it('differ in tempo, key, title and instrumentation', () => {
    const metas = TRACKS.map((t) => MUSIC_SCORES[t].data.meta);
    expect(new Set(metas.map((m) => m.bpm)).size).toBe(TRACKS.length);
    expect(new Set(metas.map((m) => m.key)).size).toBe(TRACKS.length);
    expect(new Set(metas.map((m) => m.title)).size).toBe(TRACKS.length);
    for (let a = 0; a < TRACKS.length; a++) {
      for (let b = a + 1; b < TRACKS.length; b++) {
        const ia = new Set(metas[a]!.instruments);
        const shared = metas[b]!.instruments.filter((i) => ia.has(i)).length;
        const union = new Set([...metas[a]!.instruments, ...metas[b]!.instruments]).size;
        expect(shared / union).toBeLessThan(0.35);
      }
    }
  });

  it('have different melodies', () => {
    const intervals = (theme: ThemeId) => {
      const notes = parseLine(MUSIC_SCORES[theme].data.melody.replace(/\|/g, ' ')).notes;
      return notes.slice(1).map((n, i) => `${n.midi - notes[i]!.midi}/${n.dur}`);
    };
    for (let a = 0; a < TRACKS.length; a++) {
      for (let b = a + 1; b < TRACKS.length; b++) {
        const A = intervals(TRACKS[a]!);
        const B = intervals(TRACKS[b]!);
        // Share of identical (interval, duration) steps at the same position.
        const n = Math.min(A.length, B.length);
        let same = 0;
        for (let i = 0; i < n; i++) if (A[i] === B[i]) same++;
        expect(same / n).toBeLessThan(0.25);
      }
    }
  });

  it('have uncorrelated loudness envelopes and their own measurable tempo', () => {
    const env = {} as Record<ThemeId, Float32Array>;
    const ons = {} as Record<ThemeId, Float32Array>;
    for (const t of TRACKS) {
      env[t] = envelope(monos[t]);
      ons[t] = onsets(env[t]);
    }
    for (let a = 0; a < TRACKS.length; a++) {
      for (let b = a + 1; b < TRACKS.length; b++) {
        expect(Math.abs(correlation(env[TRACKS[a]!], env[TRACKS[b]!]))).toBeLessThan(0.5);
        expect(Math.abs(correlation(ons[TRACKS[a]!], ons[TRACKS[b]!]))).toBeLessThan(0.5);
      }
    }
    // Each recording fits its own tempo better than any of the other tempi.
    for (const t of TRACKS) {
      const own = tempoScore(ons[t], MUSIC_SCORES[t].data.meta.bpm);
      for (const other of TRACKS) {
        if (other === t) continue;
        expect(own, `${t} vs tempo of ${other}`).toBeGreaterThan(tempoScore(ons[t], MUSIC_SCORES[other].data.meta.bpm) * 1.15);
      }
    }
  });
});
