/** Note / chord notation, timing (tempo, swing, humanisation) and scheduling helpers. */
import { SR, mtof, type Rng, type Stem, type Voice } from './core';

/* -------------------------------------------------------------------- pitch */

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "c4" = 60, "f#5", "bb3". */
export function noteToMidi(name: string): number {
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note name: "${name}"`);
  const pc = NOTE_PC[m[1]!.toLowerCase()]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + pc;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
};

export interface Chord {
  symbol: string;
  /** Pitch class of the root (0 = C). */
  root: number;
  /** Pitch class of the bass note (differs from the root for slash chords). */
  bass: number;
  /** Intervals above the root in semitones. */
  intervals: number[];
  /** Pitch classes contained in the chord. */
  pcs: number[];
}

const chordCache = new Map<string, Chord>();

/** Parses "Bbmaj7", "Am7", "G/B", "D7sus4", "C69"… */
export function parseChord(symbol: string): Chord {
  const hit = chordCache.get(symbol);
  if (hit) return hit;
  const m = /^([A-G])([#b]?)(maj9|maj7|m7b5|madd9|add9|7sus4|sus4|sus2|dim7|dim|aug|m9|m7|m6|m|69|9|7|6|)(?:\/([A-G])([#b]?))?$/.exec(symbol);
  if (!m) throw new Error(`bad chord symbol: "${symbol}"`);
  const pcOf = (letter: string, acc: string | undefined) =>
    (NOTE_PC[letter.toLowerCase()]! + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  const root = pcOf(m[1]!, m[2]);
  const intervals = QUALITIES[m[3]!]!;
  const chord: Chord = {
    symbol,
    root,
    bass: m[4] ? pcOf(m[4], m[5]) : root,
    intervals,
    pcs: [...new Set(intervals.map((i) => (root + i) % 12))],
  };
  chordCache.set(symbol, chord);
  return chord;
}

/** All chord tones (MIDI) inside [lo, hi], ascending. */
export function chordTones(chord: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (chord.pcs.includes(((n % 12) + 12) % 12)) out.push(n);
  return out;
}

/** Lowest MIDI note with the given pitch class at or above `lo`. */
export function pcAbove(pc: number, lo: number): number {
  let n = lo;
  while (((n % 12) + 12) % 12 !== pc) n++;
  return n;
}

/**
 * Close-position voicing with `count` notes. When a previous voicing is given
 * the inversion with the least total movement is chosen (smooth voice leading).
 */
export function voiceChord(
  chord: Chord,
  opts: { lo: number; hi: number; count: number; prev?: number[] | null; rootless?: boolean },
): number[] {
  let tones = chordTones(chord, opts.lo, opts.hi + 12);
  // Rootless voicing of four-note chords: the bass already plays the root, and
  // leaving it out avoids the root/seventh semitone rub in close position.
  if (opts.rootless && chord.pcs.length >= 4) tones = tones.filter((n) => ((n % 12) + 12) % 12 !== chord.root);
  const candidates: number[][] = [];
  for (let i = 0; i + opts.count <= tones.length; i++) {
    const v = tones.slice(i, i + opts.count);
    if (v[0]! > opts.hi - 5) break;
    candidates.push(v);
  }
  if (candidates.length === 0) return tones.slice(0, opts.count);
  // Neighbouring semitones inside a close voicing sound rough; prefer inversions without them.
  const rub = (v: number[]) => {
    let r = 0;
    for (let i = 1; i < v.length; i++) if (v[i]! - v[i - 1]! === 1) r += 100;
    return r;
  };
  if (!opts.prev || opts.prev.length === 0) {
    const mid = (opts.lo + opts.hi) / 2;
    const centre = (v: number[]) => Math.abs(v[0]! + v[v.length - 1]! - 2 * mid) + rub(v);
    return candidates.reduce((best, v) => (centre(v) < centre(best) ? v : best));
  }
  const prev = opts.prev;
  const cost = (v: number[]) => {
    let c = rub(v);
    for (let i = 0; i < v.length; i++) c += Math.abs(v[i]! - prev[Math.min(i, prev.length - 1)]!);
    return c;
  };
  return candidates.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

/* ----------------------------------------------------------------- notation */

export interface NoteEvent {
  /** Start in beats from the beginning of the phrase. */
  beat: number;
  /** Length in beats. */
  dur: number;
  midi: number;
  /** 0..1 */
  vel: number;
}

/**
 * Parses a melody line. Tokens are separated by spaces, `|` is ignored:
 *   c5:1      note for one beat          r:0.5       rest
 *   [c5,e5]:2 two notes together         c5:1!       accent     c5:1?  soft
 * A missing duration repeats the previous one.
 */
export function parseLine(text: string, baseVel = 0.75): { notes: NoteEvent[]; beats: number } {
  const notes: NoteEvent[] = [];
  let beat = 0;
  let lastDur = 1;
  for (const raw of text.split(/\s+/)) {
    if (!raw || raw === '|') continue;
    let tok = raw;
    let vel = baseVel;
    if (tok.endsWith('!')) {
      vel = Math.min(1, baseVel * 1.25);
      tok = tok.slice(0, -1);
    } else if (tok.endsWith('?')) {
      vel = baseVel * 0.7;
      tok = tok.slice(0, -1);
    }
    const colon = tok.lastIndexOf(':');
    let head = tok;
    let dur = lastDur;
    if (colon >= 0) {
      head = tok.slice(0, colon);
      dur = Number(tok.slice(colon + 1));
      if (!(dur > 0)) throw new Error(`bad duration in "${raw}"`);
      lastDur = dur;
    }
    if (head === 'r' || head === '-') {
      beat += dur;
      continue;
    }
    const names = head.startsWith('[') ? head.slice(1, -1).split(',') : [head];
    for (const name of names) notes.push({ beat, dur, midi: noteToMidi(name), vel });
    beat += dur;
  }
  return { notes, beats: beat };
}

/** Step pattern: X accent, x normal, o ghost, - or . rest, | ignored. */
export function stepPattern(pattern: string, stepBeats: number): { beat: number; level: number }[] {
  const out: { beat: number; level: number }[] = [];
  let i = 0;
  for (const ch of pattern) {
    if (ch === '|' || ch === ' ') continue;
    const level = ch === 'X' ? 1 : ch === 'x' ? 0.76 : ch === 'o' ? 0.45 : 0;
    if (level > 0) out.push({ beat: i * stepBeats, level });
    i++;
  }
  return out;
}

export function patternLength(pattern: string, stepBeats: number): number {
  let i = 0;
  for (const ch of pattern) if (ch !== '|' && ch !== ' ') i++;
  return i * stepBeats;
}

/* ------------------------------------------------------------------- timing */

/**
 * Warps a beat position so that the second half of every `division` pair is
 * delayed. amount 0 = straight, 1 = full triplet swing.
 */
export function swingBeat(beat: number, amount: number, division = 1): number {
  if (amount <= 0) return beat;
  const pos = beat / division;
  const whole = Math.floor(pos);
  const f = pos - whole;
  const s = 0.5 + amount / 6;
  const warped = f < 0.5 ? (f / 0.5) * s : s + ((f - 0.5) / 0.5) * (1 - s);
  return (whole + warped) * division;
}

/**
 * Musical timeline. The loop length is rounded to a whole number of MP3 frames
 * (1152 samples) so encoder frames line up identically on every repetition;
 * the tempo is adjusted by a few thousandths of a BPM to make that exact.
 */
export class Timeline {
  readonly totalBeats: number;
  readonly loopSamples: number;
  /** Samples per beat (not necessarily an integer). */
  readonly spb: number;
  readonly effectiveBpm: number;

  constructor(
    readonly bpm: number,
    readonly beatsPerBar: number,
    readonly bars: number,
    frameAlign = 1152,
  ) {
    this.totalBeats = bars * beatsPerBar;
    const exact = (this.totalBeats * 60 * SR) / bpm;
    this.loopSamples = Math.round(exact / frameAlign) * frameAlign;
    this.spb = this.loopSamples / this.totalBeats;
    this.effectiveBpm = (60 * SR) / this.spb;
  }

  sampleAt(beat: number): number {
    return beat * this.spb;
  }
  seconds(beats: number): number {
    return (beats * this.spb) / SR;
  }
  barBeat(bar: number, beat = 0): number {
    return bar * this.beatsPerBar + beat;
  }
}

export interface ScheduleOptions {
  /** Beat offset added to every event (e.g. the start of a section). */
  at?: number;
  gain?: number;
  pan?: number | ((ev: NoteEvent, index: number) => number);
  swing?: number;
  swingDivision?: number;
  /** Random timing spread in milliseconds (uniform, ±). */
  humanizeMs?: number;
  /** Random velocity spread (±, absolute). */
  velJitter?: number;
  /** Shortens / lengthens every note (1 = written length). */
  gate?: number;
  /** Semitone transposition. */
  transpose?: number;
  /** Constant offset in ms (negative = ahead of the beat). */
  offsetMs?: number;
  rng: Rng;
}

export type NoteRenderer = (freq: number, durSeconds: number, vel: number, ev: NoteEvent) => Voice | Float32Array;

/** Renders note events through an instrument into a stem. */
export function schedule(stem: Stem, tl: Timeline, events: NoteEvent[], render: NoteRenderer, opts: ScheduleOptions): void {
  const at = opts.at ?? 0;
  const gate = opts.gate ?? 1;
  events.forEach((ev, index) => {
    let beat = ev.beat;
    if (opts.swing) beat = swingBeat(beat, opts.swing, opts.swingDivision ?? 1);
    let start = tl.sampleAt(at + beat);
    if (opts.offsetMs) start += (opts.offsetMs / 1000) * SR;
    if (opts.humanizeMs) start += ((opts.rng() * 2 - 1) * opts.humanizeMs * SR) / 1000;
    let vel = ev.vel;
    if (opts.velJitter) vel += (opts.rng() * 2 - 1) * opts.velJitter;
    vel = Math.min(1, Math.max(0.05, vel));
    const durSec = Math.max(0.02, tl.seconds(ev.dur) * gate);
    const freq = mtof(ev.midi + (opts.transpose ?? 0));
    const rendered = render(freq, durSec, vel, ev);
    const voice: Voice = rendered instanceof Float32Array ? { l: rendered } : rendered;
    const pan = typeof opts.pan === 'function' ? opts.pan(ev, index) : (opts.pan ?? 0);
    stem.add(voice, start, opts.gain ?? 1, pan);
  });
}

/** Memoises an instrument by (pitch, duration, velocity bucket) — big win for repeating patterns. */
export function memoRenderer(render: NoteRenderer): NoteRenderer {
  const cache = new Map<string, Voice | Float32Array>();
  return (freq, dur, vel, ev) => {
    const key = `${freq.toFixed(3)}|${dur.toFixed(4)}|${Math.round(vel * 16)}`;
    let v = cache.get(key);
    if (!v) {
      v = render(freq, dur, Math.round(vel * 16) / 16, ev);
      cache.set(key, v);
    }
    return v;
  };
}

/** Shifts events in time. */
export function shift(events: NoteEvent[], beats: number): NoteEvent[] {
  return events.map((e) => ({ ...e, beat: e.beat + beats }));
}

/** Transposes events by semitones. */
export function transpose(events: NoteEvent[], semis: number): NoteEvent[] {
  return events.map((e) => ({ ...e, midi: e.midi + semis }));
}

export function scaleVel(events: NoteEvent[], k: number): NoteEvent[] {
  return events.map((e) => ({ ...e, vel: Math.min(1, e.vel * k) }));
}
