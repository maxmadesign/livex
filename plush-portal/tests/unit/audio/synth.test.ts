import { describe, expect, it } from 'vitest';
import {
  Biquad,
  MALLETS,
  PLUCKS,
  SOFT_PLUCKS,
  SR,
  Stem,
  Timeline,
  WINDS,
  dbToGain,
  decodeWav16,
  encodeWav16,
  gainToDb,
  hasInvalidSamples,
  integratedLufs,
  limit,
  makeRng,
  mallet,
  mtof,
  noteToMidi,
  parseChord,
  parseLine,
  peakOf,
  pluck,
  reverbCircular,
  rmsOf,
  softPluck,
  stepPattern,
  subBass,
  swingBeat,
  voiceChord,
  wind,
} from '../../../src/audio/synth/index';

/** Magnitude (dB) of one frequency in a buffer (Goertzel-style correlation, Hann window). */
function levelAt(buf: Float32Array, freq: number, from = 0, to = buf.length): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * freq) / SR;
  for (let i = from; i < to; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - from)) / (to - from));
    re += buf[i]! * win * Math.cos(w * i);
    im += buf[i]! * win * Math.sin(w * i);
  }
  return 20 * Math.log10((4 * Math.hypot(re, im)) / (to - from) + 1e-12);
}

describe('synth: notation and timing', () => {
  it('parses note names and chords', () => {
    expect(noteToMidi('a4')).toBe(69);
    expect(noteToMidi('c4')).toBe(60);
    expect(noteToMidi('bb3')).toBe(58);
    expect(noteToMidi('f#5')).toBe(78);
    expect(mtof(69)).toBeCloseTo(440, 6);
    const c = parseChord('Bbmaj7');
    expect(c.root).toBe(10);
    expect(c.pcs.sort((a, b) => a - b)).toEqual([2, 5, 9, 10]);
    expect(parseChord('A/C#').bass).toBe(1);
    expect(parseChord('D7sus4').intervals).toEqual([0, 5, 7, 10]);
    expect(() => parseChord('H7')).toThrow();
  });

  it('parses melody lines with rests, chords and accents', () => {
    const { notes, beats } = parseLine('c5:1 r:0.5 [e5,g5]:0.5 a5:2! | b5:0.5?', 0.8);
    expect(beats).toBeCloseTo(4.5);
    expect(notes.map((n) => n.midi)).toEqual([72, 76, 79, 81, 83]);
    expect(notes[1]!.beat).toBeCloseTo(1.5);
    expect(notes[3]!.vel).toBeCloseTo(1.0);
    expect(notes[4]!.vel).toBeCloseTo(0.56);
  });

  it('voice-leads chords with minimal movement', () => {
    const a = voiceChord(parseChord('Dm7'), { lo: 55, hi: 72, count: 4 });
    const b = voiceChord(parseChord('G7'), { lo: 55, hi: 72, count: 4, prev: a });
    const move = b.reduce((sum, n, i) => sum + Math.abs(n - a[i]!), 0);
    expect(a).toHaveLength(4);
    expect(move).toBeLessThanOrEqual(6);
  });

  it('swings off-beats and keeps downbeats', () => {
    expect(swingBeat(2, 1)).toBeCloseTo(2);
    expect(swingBeat(2.5, 1)).toBeCloseTo(2 + 2 / 3);
    expect(swingBeat(2.5, 0)).toBeCloseTo(2.5);
    expect(stepPattern('x-X-|o---', 0.25).map((h) => h.beat)).toEqual([0, 0.5, 1]);
  });

  it('aligns loop lengths to whole MP3 frames', () => {
    for (const [bpm, bars] of [[112, 32], [108, 32], [84, 24], [126, 32]] as const) {
      const tl = new Timeline(bpm, 4, bars);
      expect(tl.loopSamples % 1152).toBe(0);
      expect(Math.abs(tl.effectiveBpm - bpm)).toBeLessThan(0.05);
      expect(tl.loopSamples / SR).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('synth: instruments', () => {
  const rng = makeRng(7);
  it('renders finite, click-free notes at the requested pitch', () => {
    const f = mtof(69);
    const notes: [string, Float32Array][] = [
      ['xylophone', mallet(MALLETS.xylophone, f, 0.8, rng)],
      ['marimba', mallet(MALLETS.marimba, f, 0.8, rng)],
      ['glockenspiel', mallet(MALLETS.glockenspiel, f, 0.8, rng)],
      ['glass', mallet(MALLETS.glass, f, 0.8, rng)],
      ['pizz', pluck(PLUCKS.pizzViolin, f, 0.8, rng)],
      ['koto', pluck(PLUCKS.koto, f, 0.8, rng)],
      ['kawaii', softPluck(SOFT_PLUCKS.kawaii, f, 0.3, 0.8)],
      ['clarinet', wind(WINDS.clarinet, f, 0.6, 0.8, rng)],
      ['flute', wind(WINDS.flute, f, 0.6, 0.8, rng)],
      ['bass', subBass(f / 4, 0.5, 0.8)],
    ];
    for (const [name, buf] of notes) {
      expect(hasInvalidSamples(buf), name).toBe(false);
      expect(peakOf(buf), name).toBeGreaterThan(0.05);
      expect(peakOf(buf), name).toBeLessThanOrEqual(1);
      expect(Math.abs(buf[0]!), `${name} first sample`).toBeLessThan(1e-3);
      expect(Math.abs(buf[buf.length - 1]!), `${name} last sample`).toBeLessThan(1e-3);
      const target = name === 'bass' ? f / 4 : f;
      const from = Math.round(0.02 * SR);
      const to = Math.min(buf.length, from + 8192);
      const own = levelAt(buf, target, from, to);
      // The fundamental must clearly beat a detuned probe a semitone and a half away.
      expect(own - levelAt(buf, target * 1.09, from, to), `${name} pitch`).toBeGreaterThan(10);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = mallet(MALLETS.xylophone, 880, 0.7, makeRng(3));
    const b = mallet(MALLETS.xylophone, 880, 0.7, makeRng(3));
    expect(a).toEqual(b);
  });
});

describe('synth: dsp', () => {
  it('measures loudness per BS.1770 (stereo 1 kHz sine at -20 dBFS = -20 LUFS)', () => {
    const n = SR * 4;
    const l = new Float32Array(n);
    const a = dbToGain(-20);
    for (let i = 0; i < n; i++) l[i] = a * Math.sin((2 * Math.PI * 997 * i) / SR);
    expect(integratedLufs(l, Float32Array.from(l))).toBeCloseTo(-20, 0);
  });

  it('limits peaks to the ceiling without touching quiet material', () => {
    const n = SR * 3;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    const rng = makeRng(11);
    for (let i = 0; i < n; i++) {
      l[i] = (rng() * 2 - 1) * 0.2;
      r[i] = (rng() * 2 - 1) * 0.2;
    }
    const quiet = Float32Array.from(l);
    expect(limit(l, r, { ceiling: 0.8 }).maxReductionDb).toBe(0);
    expect(l).toEqual(quiet);
    for (const at of [1000, 20000, 20003, 40000]) {
      l[at] = 1.7;
      r[at] = -1.4;
    }
    const res = limit(l, r, { ceiling: 0.8, circular: true });
    expect(res.maxReductionDb).toBeGreaterThan(5);
    expect(peakOf(l, r)).toBeLessThanOrEqual(0.8 + 1e-6);
    // Right after a peak the gain is still recovering; long after it the signal is untouched.
    expect(Math.abs(l[30000]!)).toBeLessThan(Math.abs(quiet[30000]!));
    expect(l[Math.round(SR * 2.5)]).toBeCloseTo(quiet[Math.round(SR * 2.5)]!, 5);
  });

  it('wraps reverb tails around a periodic buffer', () => {
    const n = SR * 6;
    const inL = new Float32Array(n);
    const inR = new Float32Array(n);
    // A single click right before the end: its tail must appear at the start.
    inL[n - 200] = 1;
    inR[n - 200] = 1;
    const wet = reverbCircular(inL, inR, { t60: 1.5, damping: 5000, size: 1, preDelayMs: 10, lowCut: 200 });
    const head = rmsOf(wet.l.subarray(0, SR / 2));
    const middle = rmsOf(wet.l.subarray(SR * 3, SR * 3 + SR / 2));
    expect(head).toBeGreaterThan(1e-4);
    expect(gainToDb(head) - gainToDb(middle)).toBeGreaterThan(30);
    expect(hasInvalidSamples(wet.l, wet.r)).toBe(false);
  });

  it('keeps biquad filters stable', () => {
    const buf = new Float32Array(4096).fill(0);
    buf[0] = 1;
    for (const f of [Biquad.lowpass(1000), Biquad.highpass(100), Biquad.bandpass(2000, 4), Biquad.highshelf(7000, 3), Biquad.lowshelf(120, -3), Biquad.peaking(900, 1, 4)]) {
      const copy = Float32Array.from(buf);
      f.run(copy);
      expect(hasInvalidSamples(copy)).toBe(false);
      expect(Math.abs(copy[4095]!)).toBeLessThan(1e-3);
    }
  });

  it('wraps notes written past the end of a looping stem', () => {
    const stem = new Stem(100, true);
    stem.add({ l: new Float32Array(30).fill(1) }, 90, 1, 0);
    expect(stem.l[95]).toBeGreaterThan(0.5);
    expect(stem.l[10]).toBeGreaterThan(0.5);
    expect(stem.l[25]).toBe(0);
    const oneShot = new Stem(100, false);
    oneShot.add({ l: new Float32Array(30).fill(1) }, 90, 1, 0);
    expect(oneShot.l[10]).toBe(0);
  });

  it('round-trips 16-bit WAV', () => {
    const a = new Float32Array(1000);
    for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin(i * 0.1);
    const wav = decodeWav16(encodeWav16([a]));
    expect(wav.sampleRate).toBe(SR);
    expect(wav.channels).toBe(1);
    expect(wav.frames).toBe(1000);
    let maxErr = 0;
    for (let i = 0; i < a.length; i++) maxErr = Math.max(maxErr, Math.abs(wav.data[0]![i]! - a[i]!));
    expect(maxErr).toBeLessThan(1e-4);
  });
});
