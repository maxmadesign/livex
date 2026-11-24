/**
 * Sound-effect recipes. Every effect is a small deterministic program built
 * from the same instruments as the music, so the machine, the toys and the
 * jingles share one sonic world: soft, round and toy-like.
 */
import { LOOP_NAMES, SFX_NAMES, type LoopName, type SfxName } from '../../core/contracts';
import type { ThemeId } from '../../core/types';
import { SR, TAU, hashSeed, makeRng, mtof, type Rng } from './core';
import { woodblock, zap } from './drums';
import { Biquad, filterCircular, reverbOneShot } from './dsp';
import {
  MALLETS,
  PLUCKS,
  SOFT_PLUCKS,
  WINDS,
  fmBell,
  mallet,
  noiseBurst,
  padChord,
  pluck,
  sineGlide,
  softPluck,
  subBass,
  synthLead,
  wind,
} from './instruments';
import { finishOneShot } from './mix';
import { noteToMidi } from './seq';
import { AUDIO_SOURCE_THEMES } from './themeSource';

/** Every file is normalised to this peak; relative loudness lives in the recipe's `gain`. */
export const SFX_FILE_PEAK_DB = -4;
export const LOOP_FILE_PEAK_DB = -7;

class Canvas {
  buf: Float32Array;
  constructor(seconds: number) {
    this.buf = new Float32Array(Math.round(seconds * SR));
  }
  add(src: Float32Array, atSec = 0, gain = 1): this {
    const off = Math.round(atSec * SR);
    const n = Math.min(src.length, this.buf.length - off);
    for (let i = 0; i < n; i++) this.buf[off + i] = this.buf[off + i]! + src[i]! * gain;
    return this;
  }
}

const f = (note: string) => mtof(noteToMidi(note));

/** Shortens a ringing note with a short fade so the cut never clicks. */
function cut(buf: Float32Array, seconds: number): Float32Array {
  const n = Math.min(buf.length, Math.round(seconds * SR));
  const out = buf.slice(0, n);
  const fade = Math.min(n, Math.round(0.02 * SR));
  for (let i = 0; i < fade; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fade);
  return out;
}

/** Mono room: dry + wet, the tail is appended. */
function room(buf: Float32Array, mix: number, t60 = 1.1, tail = 0.9): Float32Array {
  const wet = reverbOneShot(buf, buf, { t60, damping: 5200, size: 0.85, preDelayMs: 8, lowCut: 280 }, tail);
  const out = new Float32Array(wet.l.length);
  for (let i = 0; i < out.length; i++) out[i] = (i < buf.length ? buf[i]! : 0) + (wet.l[i]! + wet.r[i]!) * 0.5 * mix;
  return out;
}

/** Tone with slow amplitude ripple: the basis of the servo / winch sounds. */
function servo(seconds: number, f0: number, f1: number, rippleHz: number, rng: Rng, opts: { noise?: number; bright?: number } = {}): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const lp = Biquad.lowpass(3200, 0.7);
  const bp = Biquad.bandpass(1900, 1.0);
  let phase = 0;
  const bright = opts.bright ?? 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = f0 * Math.pow(f1 / f0, t);
    phase += freq / SR;
    const ph = TAU * phase;
    const tone = Math.sin(ph) * 0.5 + Math.sin(2 * ph) * 0.3 * bright + Math.sin(3 * ph) * 0.22 * bright + Math.sin(5 * ph) * 0.08 * bright;
    const ripple = 1 - 0.22 * (0.5 + 0.5 * Math.sin((TAU * rippleHz * i) / SR));
    const noise = bp.process(rng() * 2 - 1) * (opts.noise ?? 0.12);
    const env = Math.min(1, i / (0.02 * SR)) * Math.min(1, (n - i) / (0.06 * SR));
    out[i] = lp.process(tone * ripple + noise) * env;
  }
  return out;
}

function tick(rng: Rng, freq: number, ms: number): Float32Array {
  const n = Math.round((ms / 1000) * SR * 4);
  const out = new Float32Array(n);
  const hp = Biquad.highpass(1800, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * freq * t) * 0.7 + hp.process(rng() * 2 - 1) * 0.3) * Math.exp(-t / (ms / 1000 / 2.5)) * Math.min(1, i / 8);
  }
  return out;
}

/** Soft stuffed-toy thump: low sine drop plus a puff of low-passed noise. */
function pomf(rng: Rng, pitch = 1, size = 1): Float32Array {
  const c = new Canvas(0.2 * size + 0.05);
  c.add(sineGlide(108 * pitch, 60 * pitch, 0.16 * size, { glideTau: 0.03, ampTau: 0.04 * size, attackMs: 3, harm2: 0.15 }), 0, 0.9);
  c.add(noiseBurst(0.12 * size, rng, { type: 'lp', freq: 950 * pitch, q: 0.6, attackMs: 4, decayTau: 0.028 * size }), 0, 0.55);
  c.add(noiseBurst(0.06, rng, { type: 'bp', freq: 2400, q: 0.7, attackMs: 3, decayTau: 0.012 }), 0.002, 0.1);
  return c.buf;
}

export interface SfxRecipe {
  variants: number;
  /** Playback gain relative to a full-level effect (files themselves are peak-normalised). */
  gain: number;
  /** Random pitch / gain variation the engine applies per trigger. */
  pitchVar: number;
  gainVar: number;
  /** Renders one variant; `theme` is only passed to themed recipes. */
  render: (variant: number, rng: Rng, theme?: ThemeId) => Float32Array;
  themed?: boolean;
}

/* ------------------------------------------------------------ themed jingles */

function winJingle(theme: ThemeId, rng: Rng): Float32Array {
  const c = new Canvas(1.25);
  switch (theme) {
    case 'sakura': {
      ['f5', 'a5', 'c6', 'f6'].forEach((n, i) => c.add(mallet(MALLETS.xylophone, f(n), 0.7 + i * 0.07, rng), i * 0.1, 0.8));
      ['f6', 'a6', 'c7'].forEach((n, i) => c.add(mallet(MALLETS.glockenspiel, f(n), 0.8, rng), 0.44 + i * 0.012, 0.6));
      ['a5', 'c6', 'f6'].forEach((n) => c.add(softPluck(SOFT_PLUCKS.kawaii, f(n), 0.4, 0.7), 0.44, 0.3));
      ['c7', 'f7', 'a7', 'c8'].forEach((n, i) => c.add(mallet(MALLETS.celesta, f(n), 0.45, rng), 0.62 + i * 0.07, 0.3));
      c.add(subBass(f('f2'), 0.35, 0.7), 0.44, 0.5);
      break;
    }
    case 'storybook': {
      ['g4', 'b4', 'd5'].forEach((n, i) => c.add(pluck(PLUCKS.pizzViolin, f(n), 0.75, rng), i * 0.11, 0.8));
      c.add(wind(WINDS.clarinet, f('d5'), 0.14, 0.7, rng), 0.33, 0.8);
      c.add(wind(WINDS.clarinet, f('g5'), 0.6, 0.8, rng), 0.5, 0.85);
      c.add(wind(WINDS.flute, f('b5'), 0.6, 0.7, rng), 0.5, 0.55);
      ['g5', 'b5', 'd6', 'g6'].forEach((n, i) => c.add(mallet(MALLETS.celesta, f(n), 0.6, rng), 0.5 + i * 0.05, 0.45));
      ['g3', 'd4', 'b4'].forEach((n) => c.add(pluck(PLUCKS.pizzCello, f(n), 0.8, rng), 0.5, 0.6));
      c.add(pluck(PLUCKS.pizzBass, f('g2'), 0.8, rng), 0.5, 0.8);
      break;
    }
    case 'ocean': {
      ['d5', 'f#5', 'a5', 'c#6', 'e6'].forEach((n, i) => c.add(mallet(MALLETS.glass, f(n), 0.62 + i * 0.05, rng), i * 0.115, 0.7));
      ['f#6', 'a6'].forEach((n, i) => c.add(mallet(MALLETS.celesta, f(n), 0.5, rng), 0.62 + i * 0.09, 0.4));
      const pad = padChord([f('d4'), f('f#4'), f('a4'), f('e5')], 0.7, 0.6, { voices: 3, detuneCents: 12, cutoff: 1500, q: 0.6, lfoDepth: 0.2, lfoHz: 0.4, attack: 0.25, release: 0.5, soft: 0.5 }, rng);
      c.add(pad.l, 0.3, 0.35);
      for (let k = 0; k < 4; k++) {
        const f0 = 600 + rng() * 500;
        c.add(sineGlide(f0, f0 * 1.9, 0.1, { glideTau: 0.05, ampTau: 0.04, attackMs: 6 }), 0.75 + k * 0.11, 0.16);
      }
      c.add(subBass(f('d2'), 0.5, 0.6, { attack: 0.03 }), 0.3, 0.45);
      break;
    }
    case 'cosmic':
    case 'gpu': {
      ['a4', 'c#5', 'e5', 'a5', 'c#6', 'e6'].forEach((n, i) => c.add(softPluck(SOFT_PLUCKS.arcade, f(n), 0.09, 0.7 + i * 0.04), i * 0.07, 0.7));
      c.add(sineGlide(420, 1680, 0.4, { glideTau: 0.5, ampTau: 0.3, attackMs: 30 }), 0.05, 0.14);
      ['a5', 'c#6', 'e6'].forEach((n) => c.add(synthLead(f(n), 0.4, 0.8, { cutoff: 2800 }), 0.46, 0.4));
      c.add(subBass(f('a2'), 0.4, 0.8, { harm2: 0.35, harm3: 0.2 }), 0.46, 0.55);
      c.add(fmBell(f('a6'), 0.6, { decay: 0.9 }), 0.46, 0.3);
      c.add(fmBell(f('e7'), 0.5, { decay: 0.8 }), 0.6, 0.22);
      c.add(zap(rng, { from: 2400, to: 700, seconds: 0.12 }), 0.78, 0.25);
      break;
    }
  }
  return room(c.buf, 0.5, 1.1, 0.35);
}

function themeSting(theme: ThemeId, rng: Rng): Float32Array {
  const c = new Canvas(0.95);
  switch (theme) {
    case 'sakura': {
      const step = 0.17;
      ['d6', 'c6', 'a5', 'f5', 'a5'].forEach((n, i) => c.add(mallet(MALLETS.xylophone, f(n), i === 4 ? 0.85 : 0.72, rng), i * step, 0.8));
      ['a4', 'bb4', 'd5'].forEach((n) => c.add(softPluck(SOFT_PLUCKS.kawaii, f(n), 0.3, 0.6), 0, 0.3));
      ['a4', 'bb4', 'd5'].forEach((n) => c.add(softPluck(SOFT_PLUCKS.kawaii, f(n), 0.3, 0.55), step * 3, 0.26));
      c.add(mallet(MALLETS.glockenspiel, f('a6'), 0.6, rng), step * 4, 0.4);
      c.add(subBass(f('bb2'), 0.5, 0.7), 0, 0.45);
      break;
    }
    case 'storybook': {
      const beat = 0.3;
      const sw = beat * 0.62;
      c.add(wind(WINDS.clarinet, f('d5'), beat * 0.9, 0.72, rng), 0, 0.85);
      c.add(wind(WINDS.clarinet, f('b4'), sw * 0.9, 0.66, rng), beat, 0.85);
      c.add(wind(WINDS.clarinet, f('d5'), (beat - sw) * 0.95, 0.68, rng), beat + sw, 0.85);
      c.add(wind(WINDS.clarinet, f('g5'), beat * 0.7, 0.8, rng), beat * 2, 0.85);
      c.add(pluck(PLUCKS.pizzBass, f('g2'), 0.8, rng), 0, 0.8);
      ['b3', 'd4', 'g4'].forEach((n) => c.add(pluck(PLUCKS.pizzViolin, f(n), 0.7, rng), beat, 0.5));
      c.add(mallet(MALLETS.celesta, f('g6'), 0.6, rng), beat * 2, 0.45);
      break;
    }
    case 'ocean': {
      c.add(mallet(MALLETS.glass, f('f#5'), 0.7, rng), 0, 0.75);
      c.add(mallet(MALLETS.glass, f('a5'), 0.7, rng), 0.3, 0.75);
      c.add(mallet(MALLETS.glass, f('e6'), 0.78, rng), 0.56, 0.75);
      const pad = padChord([f('d4'), f('f#4'), f('a4'), f('c#5')], 0.7, 0.6, { voices: 3, detuneCents: 12, cutoff: 1300, q: 0.6, lfoDepth: 0.2, lfoHz: 0.4, attack: 0.3, release: 0.45, soft: 0.6 }, rng);
      c.add(pad.l, 0, 0.4);
      c.add(mallet(MALLETS.marimba, f('d3'), 0.6, rng), 0, 0.5);
      c.add(mallet(MALLETS.marimba, f('a3'), 0.5, rng), 0.3, 0.4);
      break;
    }
    case 'cosmic':
    case 'gpu': {
      const step = 0.15;
      ['c#5', 'f#5', 'a5'].forEach((n, i) => c.add(synthLead(f(n), step * (i === 2 ? 1.8 : 0.85), 0.75, { cutoff: 2600 }), i * step, 0.55));
      c.add(synthLead(f('g#5'), step * 0.85, 0.7, { cutoff: 2600 }), step * 4, 0.5);
      c.add(synthLead(f('f#5'), step * 1.6, 0.8, { cutoff: 2600 }), step * 5, 0.55);
      ['f#4', 'a4', 'c#5', 'a4', 'f#4', 'a4', 'c#5', 'f#5'].forEach((n, i) => c.add(softPluck(SOFT_PLUCKS.arcade, f(n), 0.08, 0.55), i * step * 0.5, 0.3));
      c.add(subBass(f('f#2'), 0.7, 0.8, { harm2: 0.35, harm3: 0.2 }), 0, 0.5);
      break;
    }
  }
  return room(c.buf, 0.4, 0.9, 0.3);
}

/* ------------------------------------------------------------------ recipes */

export const SFX_RECIPES: Record<SfxName, SfxRecipe> = {
  ui_click: {
    variants: 3,
    gain: 0.45,
    pitchVar: 0.04,
    gainVar: 0.08,
    render: (v, rng) => {
      const p = 1 + (v - 1) * 0.07;
      const c = new Canvas(0.09);
      c.add(sineGlide(1500 * p, 950 * p, 0.05, { glideTau: 0.008, ampTau: 0.011, attackMs: 0.6 }), 0, 0.8);
      c.add(sineGlide(260 * p, 180 * p, 0.04, { glideTau: 0.01, ampTau: 0.012, attackMs: 1 }), 0, 0.35);
      c.add(noiseBurst(0.02, rng, { type: 'hp', freq: 3200, attackMs: 0.3, decayTau: 0.003 }), 0, 0.12);
      return c.buf;
    },
  },
  ui_toggle: {
    variants: 2,
    gain: 0.4,
    pitchVar: 0.02,
    gainVar: 0.05,
    render: (v, rng) => {
      const base = v === 0 ? 988 : 1108;
      const c = new Canvas(0.2);
      c.add(cut(mallet(MALLETS.celesta, base, 0.6, rng), 0.12), 0, 0.7);
      c.add(cut(mallet(MALLETS.celesta, base * 1.335, 0.7, rng), 0.14), 0.045, 0.8);
      return c.buf;
    },
  },
  ui_open: {
    variants: 1,
    gain: 0.45,
    pitchVar: 0.01,
    gainVar: 0.03,
    render: (_v, rng) => {
      const c = new Canvas(0.5);
      c.add(noiseBurst(0.2, rng, { type: 'bp', freq: 700, freqEnd: 3400, q: 0.9, attackMs: 60, decayTau: 0.09 }), 0, 0.25);
      c.add(cut(mallet(MALLETS.celesta, f('e6'), 0.6, rng), 0.3), 0.03, 0.6);
      c.add(cut(mallet(MALLETS.celesta, f('b6'), 0.7, rng), 0.36), 0.11, 0.7);
      return c.buf;
    },
  },
  ui_close: {
    variants: 1,
    gain: 0.4,
    pitchVar: 0.01,
    gainVar: 0.03,
    render: (_v, rng) => {
      const c = new Canvas(0.42);
      c.add(noiseBurst(0.16, rng, { type: 'bp', freq: 3000, freqEnd: 600, q: 0.9, attackMs: 20, decayTau: 0.07 }), 0, 0.22);
      c.add(cut(mallet(MALLETS.celesta, f('b6'), 0.55, rng), 0.22), 0.01, 0.55);
      c.add(cut(mallet(MALLETS.celesta, f('e6'), 0.6, rng), 0.3), 0.085, 0.65);
      return c.buf;
    },
  },
  ui_error: {
    variants: 1,
    gain: 0.45,
    pitchVar: 0.01,
    gainVar: 0.03,
    render: (_v, rng) => {
      const c = new Canvas(0.5);
      c.add(cut(mallet(MALLETS.marimba, f('eb4'), 0.7, rng), 0.2), 0, 0.8);
      c.add(cut(mallet(MALLETS.marimba, f('c4'), 0.75, rng), 0.32), 0.13, 0.85);
      c.add(pomf(rng, 0.9, 0.7), 0.13, 0.25);
      return c.buf;
    },
  },
  dir_press: {
    variants: 2,
    gain: 0.45,
    pitchVar: 0.04,
    gainVar: 0.08,
    render: (v, rng) => {
      const p = v === 0 ? 1 : 1.08;
      const c = new Canvas(0.12);
      c.add(noiseBurst(0.03, rng, { type: 'bp', freq: 1700 * p, q: 1.4, attackMs: 0.4, decayTau: 0.005 }), 0, 0.7);
      c.add(sineGlide(250 * p, 150 * p, 0.07, { glideTau: 0.015, ampTau: 0.02, attackMs: 1 }), 0.001, 0.7);
      c.add(tick(rng, 2800 * p, 5), 0.012, 0.15);
      return c.buf;
    },
  },
  dir_tick: {
    variants: 3,
    gain: 0.14,
    pitchVar: 0.05,
    gainVar: 0.15,
    render: (v, rng) => tick(rng, 1900 + v * 260, 4),
  },
  grab_confirm: {
    variants: 1,
    gain: 0.8,
    pitchVar: 0.01,
    gainVar: 0.02,
    render: (_v, rng) => {
      const c = new Canvas(0.6);
      c.add(sineGlide(190, 85, 0.16, { glideTau: 0.03, ampTau: 0.045, attackMs: 1.5, harm2: 0.2 }), 0, 0.85);
      c.add(noiseBurst(0.03, rng, { type: 'bp', freq: 1500, q: 1.2, attackMs: 0.4, decayTau: 0.006 }), 0, 0.5);
      ['c6', 'e6', 'g6'].forEach((n, i) => c.add(softPluck(SOFT_PLUCKS.arcade, f(n), 0.07, 0.75), 0.05 + i * 0.055, 0.55));
      c.add(cut(mallet(MALLETS.glockenspiel, f('c7'), 0.7, rng), 0.36), 0.215, 0.45);
      return c.buf;
    },
  },
  claw_descend: {
    variants: 1,
    gain: 0.3,
    pitchVar: 0.02,
    gainVar: 0.04,
    render: (_v, rng) => {
      const c = new Canvas(0.62);
      c.add(tick(rng, 1500, 6), 0, 0.5);
      c.add(servo(0.58, 430, 250, 27, rng, { noise: 0.1, bright: 0.45 }), 0.015, 0.8);
      return c.buf;
    },
  },
  claw_touch: {
    variants: 3,
    gain: 0.45,
    pitchVar: 0.05,
    gainVar: 0.1,
    render: (v, rng) => {
      const p = 1 + (v - 1) * 0.09;
      const c = new Canvas(0.2);
      c.add(pomf(rng, 1.25 * p, 0.6), 0, 0.8);
      c.add(tick(rng, 2900 * p, 7), 0.004, 0.16);
      c.add(tick(rng, 4300 * p, 5), 0.011, 0.09);
      return c.buf;
    },
  },
  claw_close: {
    variants: 2,
    gain: 0.42,
    pitchVar: 0.03,
    gainVar: 0.05,
    render: (v, rng) => {
      const p = v === 0 ? 1 : 1.06;
      const c = new Canvas(0.5);
      c.add(servo(0.3, 300 * p, 540 * p, 38, rng, { noise: 0.1, bright: 0.6 }), 0, 0.7);
      for (let k = 0; k < 5; k++) c.add(tick(rng, 2300 + k * 90, 4), 0.03 + k * 0.05, 0.22);
      c.add(sineGlide(210, 150, 0.08, { glideTau: 0.02, ampTau: 0.022, attackMs: 1 }), 0.3, 0.7);
      c.add(noiseBurst(0.03, rng, { type: 'bp', freq: 1400, q: 1.2, attackMs: 0.4, decayTau: 0.006 }), 0.3, 0.4);
      return c.buf;
    },
  },
  claw_open: {
    variants: 2,
    gain: 0.3,
    pitchVar: 0.03,
    gainVar: 0.05,
    render: (v, rng) => {
      const p = v === 0 ? 1 : 0.94;
      const c = new Canvas(0.34);
      c.add(tick(rng, 1900 * p, 6), 0, 0.45);
      c.add(servo(0.24, 500 * p, 300 * p, 34, rng, { noise: 0.1, bright: 0.5 }), 0.012, 0.7);
      return c.buf;
    },
  },
  plush_rub: {
    variants: 3,
    gain: 0.28,
    pitchVar: 0.08,
    gainVar: 0.15,
    render: (v, rng) => {
      const seconds = 0.24 + v * 0.04;
      const n = Math.round(seconds * SR);
      const out = new Float32Array(n);
      const bp = Biquad.bandpass(1500 + v * 250, 0.55);
      const lp = Biquad.lowpass(4800, 0.7);
      const bumps = 2 + v;
      const ph = rng() * TAU;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const shape = Math.sin(Math.PI * t) ** 1.2 * (0.6 + 0.4 * Math.sin(TAU * bumps * t + ph) ** 2);
        out[i] = lp.process(bp.process(rng() * 2 - 1)) * shape;
      }
      return out;
    },
  },
  plush_land: {
    variants: 4,
    gain: 0.6,
    pitchVar: 0.07,
    gainVar: 0.12,
    render: (v, rng) => pomf(rng, 0.86 + v * 0.1, 0.9 + (v % 2) * 0.2),
  },
  glass_tap: {
    variants: 3,
    gain: 0.4,
    pitchVar: 0.05,
    gainVar: 0.12,
    render: (v, rng) => {
      const p = 0.93 + v * 0.07;
      const c = new Canvas(0.16);
      const modes: [number, number, number][] = [
        [1180, 0.9, 0.03],
        [2350, 0.5, 0.02],
        [3900, 0.25, 0.012],
      ];
      for (const [freq, amp, tau] of modes) c.add(sineGlide(freq * p, freq * p, 0.14, { glideTau: 1, ampTau: tau, attackMs: 0.4 }), 0, amp);
      c.add(sineGlide(240, 190, 0.05, { glideTau: 0.02, ampTau: 0.014, attackMs: 1 }), 0, 0.5);
      c.add(noiseBurst(0.015, rng, { type: 'hp', freq: 2500, attackMs: 0.3, decayTau: 0.002 }), 0, 0.15);
      return c.buf;
    },
  },
  chute_drop: {
    variants: 2,
    gain: 0.65,
    pitchVar: 0.04,
    gainVar: 0.08,
    render: (v, rng) => {
      const c = new Canvas(0.85);
      c.add(noiseBurst(0.5, rng, { type: 'bp', freq: 1000, freqEnd: 420, q: 0.8, attackMs: 40, decayTau: 0.2 }), 0.02, 0.25);
      const times = v === 0 ? [0, 0.17, 0.36, 0.56] : [0, 0.14, 0.33, 0.5];
      times.forEach((t, i) => c.add(pomf(rng, 1.2 - i * 0.1, 0.8 + i * 0.06), t, 0.75 - i * 0.08));
      c.add(woodblock(rng, 520), times[1]! + 0.01, 0.18);
      return c.buf;
    },
  },
  prize_out: {
    variants: 2,
    gain: 0.75,
    pitchVar: 0.03,
    gainVar: 0.06,
    render: (v, rng) => {
      const c = new Canvas(0.66);
      c.add(pomf(rng, 0.9, 1.15), 0, 0.9);
      c.add(woodblock(rng, 610), 0.13, 0.3);
      c.add(pomf(rng, 1.1, 0.6), 0.2, 0.3);
      const notes = v === 0 ? ['c7', 'g7'] : ['d7', 'a7'];
      notes.forEach((n, i) => c.add(cut(mallet(MALLETS.glockenspiel, f(n), 0.65, rng), 0.32), 0.24 + i * 0.08, 0.4));
      return c.buf;
    },
  },
  empty_grab: {
    variants: 2,
    gain: 0.42,
    pitchVar: 0.02,
    gainVar: 0.04,
    render: (v, rng) => {
      const c = new Canvas(0.7);
      if (v === 0) {
        c.add(wind(WINDS.ocarina, f('g5'), 0.16, 0.7, rng), 0, 0.9);
        c.add(wind(WINDS.ocarina, f('e5'), 0.3, 0.62, rng), 0.19, 0.9);
      } else {
        c.add(cut(mallet(MALLETS.marimba, f('g4'), 0.7, rng), 0.25), 0, 0.85);
        c.add(cut(mallet(MALLETS.marimba, f('e4'), 0.65, rng), 0.4), 0.18, 0.85);
      }
      return c.buf;
    },
  },
  slip: {
    variants: 2,
    gain: 0.42,
    pitchVar: 0.04,
    gainVar: 0.06,
    render: (v, rng) => {
      const c = new Canvas(0.55);
      const top = v === 0 ? 1150 : 1320;
      c.add(sineGlide(top, top * 0.42, 0.26, { glideTau: 0.14, ampTau: 0.2, attackMs: 12, harm2: 0.08 }), 0, 0.6);
      c.add(pomf(rng, 1.0, 0.9), 0.27, 0.75);
      return c.buf;
    },
  },
  win: {
    variants: 1,
    gain: 1.0,
    pitchVar: 0,
    gainVar: 0,
    themed: true,
    render: (_v, rng, theme) => winJingle(theme ?? 'sakura', rng),
  },
  collect_unlock: {
    variants: 1,
    gain: 0.8,
    pitchVar: 0,
    gainVar: 0.02,
    render: (_v, rng) => {
      const c = new Canvas(0.8);
      ['c6', 'e6', 'g6', 'b6', 'c7', 'e7'].forEach((n, i) => c.add(cut(mallet(MALLETS.glockenspiel, f(n), 0.55 + i * 0.05, rng), 0.45), i * 0.058, 0.6));
      c.add(fmBell(f('g7'), 0.5, { ratio: 3.5, index: 1.4, decay: 0.8 }), 0.36, 0.3);
      c.add(fmBell(f('c8'), 0.4, { ratio: 3.5, index: 1.2, decay: 0.7 }), 0.43, 0.2);
      c.add(noiseBurst(0.4, rng, { type: 'bp', freq: 4000, freqEnd: 9000, q: 1.2, attackMs: 200, decayTau: 0.12 }), 0, 0.07);
      return room(c.buf, 0.5, 1.0, 0.3);
    },
  },
  restock_drop: {
    variants: 2,
    gain: 0.5,
    pitchVar: 0.05,
    gainVar: 0.08,
    render: (v, rng) => {
      const c = new Canvas(0.62);
      const top = v === 0 ? 900 : 1040;
      c.add(sineGlide(top, top * 0.36, 0.22, { glideTau: 0.1, ampTau: 0.16, attackMs: 20 }), 0, 0.4);
      c.add(pomf(rng, 0.95, 1.0), 0.23, 0.85);
      c.add(pomf(rng, 1.15, 0.6), 0.41, 0.3);
      return c.buf;
    },
  },
  theme_sting: {
    variants: 1,
    gain: 0.75,
    pitchVar: 0,
    gainVar: 0,
    themed: true,
    render: (_v, rng, theme) => themeSting(theme ?? 'sakura', rng),
  },
  countdown_tick: {
    variants: 2,
    gain: 0.4,
    pitchVar: 0.01,
    gainVar: 0.03,
    render: (v, rng) => woodblock(rng, v === 0 ? 880 : 1175),
  },
  start_game: {
    variants: 1,
    gain: 0.9,
    pitchVar: 0,
    gainVar: 0,
    render: (_v, rng) => {
      const c = new Canvas(0.9);
      // Coin: two bright pings a fourth apart, then a rising arpeggio.
      c.add(cut(mallet(MALLETS.glockenspiel, f('b6'), 0.8, rng), 0.12), 0, 0.6);
      c.add(cut(mallet(MALLETS.glockenspiel, f('e7'), 0.85, rng), 0.4), 0.075, 0.65);
      ['c5', 'e5', 'g5', 'c6', 'e6', 'g6'].forEach((n, i) => c.add(softPluck(SOFT_PLUCKS.kawaii, f(n), 0.1, 0.7 + i * 0.04), 0.28 + i * 0.06, 0.6));
      c.add(cut(mallet(MALLETS.glockenspiel, f('c7'), 0.8, rng), 0.26), 0.64, 0.6);
      c.add(sineGlide(170, 80, 0.14, { glideTau: 0.03, ampTau: 0.04, attackMs: 2 }), 0.64, 0.6);
      return room(c.buf, 0.35, 0.9, 0.2);
    },
  },
};

/* -------------------------------------------------------------------- loops */

export interface LoopRecipe {
  seconds: number;
  gain: number;
  render: () => Float32Array;
}

/**
 * Seamless motor loops: every tonal component completes a whole number of
 * cycles and the noise is filtered circularly, so the buffer is exactly periodic.
 */
function motorLoop(seconds: number, base: number, harmonics: [number, number][], rippleHz: number, opts: { clicksPerSec?: number; whineHz?: number; seed: number }): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const cyc = (hz: number) => Math.round(hz * seconds) / seconds; // snap to whole cycles
  for (const [h, amp] of harmonics) {
    const w = (TAU * cyc(base * h)) / SR;
    const ph = h * 0.7;
    for (let i = 0; i < n; i++) out[i] = out[i]! + Math.sin(w * i + ph) * amp;
  }
  if (opts.whineHz) {
    const w = (TAU * cyc(opts.whineHz)) / SR;
    const wobble = (TAU * cyc(3)) / SR;
    for (let i = 0; i < n; i++) out[i] = out[i]! + Math.sin(w * i + 0.6 * Math.sin(wobble * i)) * 0.05;
  }
  const rw = (TAU * cyc(rippleHz)) / SR;
  for (let i = 0; i < n; i++) out[i] = out[i]! * (1 - 0.2 * (0.5 + 0.5 * Math.sin(rw * i)));
  const rng = makeRng(opts.seed);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  filterCircular(noise, Biquad.bandpass(1700, 0.8));
  for (let i = 0; i < n; i++) out[i] = out[i]! + noise[i]! * 0.5;
  if (opts.clicksPerSec) {
    const count = Math.round(opts.clicksPerSec * seconds);
    for (let k = 0; k < count; k++) {
      const start = Math.round((k / count) * n);
      const t = tick(rng, 2300 + (k % 3) * 120, 3);
      for (let i = 0; i < t.length; i++) {
        const idx = (start + i) % n;
        out[idx] = out[idx]! + t[i]! * 0.16;
      }
    }
  }
  filterCircular(out, Biquad.lowpass(3400, 0.7));
  filterCircular(out, Biquad.highpass(70, 0.7));
  return out;
}

export const LOOP_RECIPES: Record<LoopName, LoopRecipe> = {
  motor_trolley: {
    seconds: 1.2,
    gain: 0.5,
    render: () =>
      motorLoop(
        1.2,
        85,
        [
          [1, 0.22],
          [2, 0.42],
          [3, 0.3],
          [4, 0.16],
          [6, 0.1],
          [9, 0.05],
        ],
        20,
        { whineHz: 1280, seed: 71 },
      ),
  },
  motor_winch: {
    seconds: 1.0,
    gain: 0.5,
    render: () =>
      motorLoop(
        1.0,
        62,
        [
          [1, 0.2],
          [2, 0.4],
          [3, 0.36],
          [5, 0.14],
          [7, 0.07],
        ],
        12,
        { clicksPerSec: 12, whineHz: 430, seed: 72 },
      ),
  },
};

/* ------------------------------------------------------------------ renders */

export interface SfxFileSpec {
  name: SfxName;
  theme: ThemeId | null;
  variant: number;
  /** Path relative to the audio base, e.g. "sfx/ui_click_1.wav". */
  file: string;
}

/** The complete list of one-shot files, in a stable order. */
export function listSfxFiles(): SfxFileSpec[] {
  const out: SfxFileSpec[] = [];
  for (const name of SFX_NAMES) {
    const recipe = SFX_RECIPES[name];
    if (recipe.themed) {
      // Only themes with their own recordings get files; the others borrow them (AUDIO_THEME_SOURCE).
      for (const theme of AUDIO_SOURCE_THEMES) {
        for (let v = 0; v < recipe.variants; v++) {
          out.push({ name, theme, variant: v, file: `sfx/${name}_${theme}${recipe.variants > 1 ? `_${v + 1}` : ''}.wav` });
        }
      }
    } else {
      for (let v = 0; v < recipe.variants; v++) out.push({ name, theme: null, variant: v, file: `sfx/${name}_${v + 1}.wav` });
    }
  }
  return out;
}

export function loopFileName(name: LoopName): string {
  return `sfx/loop_${name}.wav`;
}

/** Renders one effect variant, peak-normalised and with click-free edges. */
export function renderSfx(name: SfxName, variant: number, theme: ThemeId | null = null): Float32Array {
  const recipe = SFX_RECIPES[name];
  const rng = makeRng(hashSeed('sfx', name, variant, theme ?? ''));
  const raw = recipe.render(variant, rng, theme ?? undefined);
  return finishOneShot(raw, SFX_FILE_PEAK_DB, { fadeInMs: 0.3, fadeOutMs: 8 });
}

/** Renders a motor loop: exactly periodic, peak-normalised, no fades. */
export function renderLoop(name: LoopName): Float32Array {
  const buf = LOOP_RECIPES[name].render();
  let peak = 1e-9;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
  const g = Math.pow(10, LOOP_FILE_PEAK_DB / 20) / peak;
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * g;
  return buf;
}

export { LOOP_NAMES, SFX_NAMES };
