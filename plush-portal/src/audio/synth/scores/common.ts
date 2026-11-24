/** Arrangement helpers shared by the four scores. */
import { SR, type Rng, type Stem, type Voice } from '../core';
import type { DrumKit, DrumName } from '../drums';
import { padChord, type PadOptions } from '../instruments';
import {
  parseChord,
  parseLine,
  pcAbove,
  stepPattern,
  swingBeat,
  voiceChord,
  type Chord,
  type NoteEvent,
  type Timeline,
} from '../seq';
import { mtof } from '../core';

/** One entry per bar; "Am7 D7" means two chords sharing the bar equally. */
export type Progression = readonly string[];

export interface ChordSpan {
  chord: Chord;
  /** Absolute start beat and length in beats. */
  beat: number;
  beats: number;
  bar: number;
}

export function chordSpans(prog: Progression, beatsPerBar: number, startBar = 0): ChordSpan[] {
  const spans: ChordSpan[] = [];
  prog.forEach((entry, i) => {
    const symbols = entry.trim().split(/\s+/);
    const len = beatsPerBar / symbols.length;
    symbols.forEach((symbol, k) => {
      spans.push({ chord: parseChord(symbol), beat: (startBar + i) * beatsPerBar + k * len, beats: len, bar: startBar + i });
    });
  });
  return spans;
}

/** Merges consecutive identical chords into one long span (for pads / long bass notes). */
export function mergeSpans(spans: ChordSpan[]): ChordSpan[] {
  const out: ChordSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.chord.symbol === s.chord.symbol && Math.abs(last.beat + last.beats - s.beat) < 1e-6) {
      last.beats += s.beats;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export function chordAt(spans: ChordSpan[], beat: number): Chord {
  for (const s of spans) if (beat >= s.beat - 1e-6 && beat < s.beat + s.beats - 1e-6) return s.chord;
  return spans[spans.length - 1]!.chord;
}

function intervalOf(chord: Chord, kind: 'third' | 'fifth' | 'seventh'): number {
  const iv = chord.intervals;
  if (kind === 'third') return iv.find((i) => i === 3 || i === 4) ?? iv.find((i) => i === 5 || i === 2) ?? 4;
  if (kind === 'fifth') return iv.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
  return iv.find((i) => i === 10 || i === 11 || i === 9) ?? 10;
}

/**
 * Builds a line from chord degrees. `patterns` holds one pattern per bar
 * (cycled); each is a list of `<degree>:<beats>` tokens with degree
 *   1 bass note · 3 third · 5 fifth · 7 seventh/sixth · 8 bass an octave up
 *   a chromatic approach to the next chord's bass · r rest
 * A trailing ! accents, ? softens.
 */
export function degreeLine(
  spans: ChordSpan[],
  patterns: string | readonly string[],
  opts: { lo: number; vel?: number; beatsPerBar: number; startBar: number; bars: number; nextChord?: Chord },
): NoteEvent[] {
  const list = typeof patterns === 'string' ? [patterns] : patterns;
  const out: NoteEvent[] = [];
  const baseVel = opts.vel ?? 0.75;
  for (let b = 0; b < opts.bars; b++) {
    const barStart = (opts.startBar + b) * opts.beatsPerBar;
    let beat = 0;
    for (const raw of list[b % list.length]!.trim().split(/\s+/)) {
      let tok = raw;
      let vel = baseVel;
      if (tok.endsWith('!')) {
        vel = Math.min(1, baseVel * 1.2);
        tok = tok.slice(0, -1);
      } else if (tok.endsWith('?')) {
        vel = baseVel * 0.72;
        tok = tok.slice(0, -1);
      }
      const [deg, durStr] = tok.split(':');
      const dur = Number(durStr);
      if (!(dur > 0)) throw new Error(`bad degree token "${raw}"`);
      if (deg !== 'r') {
        const abs = barStart + beat;
        const chord = chordAt(spans, abs);
        const root = pcAbove(chord.bass, opts.lo);
        let midi = root;
        if (deg === '3') midi = pcAbove((chord.root + intervalOf(chord, 'third')) % 12, opts.lo);
        else if (deg === '5') midi = pcAbove((chord.root + intervalOf(chord, 'fifth')) % 12, opts.lo);
        else if (deg === '7') midi = pcAbove((chord.root + intervalOf(chord, 'seventh')) % 12, opts.lo);
        else if (deg === '8') midi = root + 12;
        else if (deg === 'a') {
          const nextBeat = abs + dur;
          const last = spans[spans.length - 1]!;
          const next = nextBeat >= last.beat + last.beats - 1e-6 ? (opts.nextChord ?? spans[0]!.chord) : chordAt(spans, nextBeat);
          midi = pcAbove(next.bass, opts.lo) - 1;
          if (midi < opts.lo - 1) midi += 12;
        } else if (deg !== '1') throw new Error(`unknown degree "${deg}"`);
        out.push({ beat: abs, dur, midi, vel });
      }
      beat += dur;
    }
  }
  return out;
}

/** Arpeggio through voice-led chord voicings. Shape indices beyond the voicing size go up an octave. */
export function arpEvents(
  spans: ChordSpan[],
  opts: {
    stepBeats: number;
    shape: readonly number[];
    lo: number;
    hi: number;
    count: number;
    vel?: number;
    /** Step pattern (cycled over the bar); only marked steps play. */
    pattern?: string;
    durBeats?: number;
    accentEvery?: number;
    rootless?: boolean;
  },
): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  const baseVel = opts.vel ?? 0.6;
  const levels = opts.pattern ? [...opts.pattern].filter((c) => c !== '|' && c !== ' ') : null;
  for (const s of spans) {
    const voicing = voiceChord(s.chord, { lo: opts.lo, hi: opts.hi, count: opts.count, prev, rootless: opts.rootless });
    prev = voicing;
    const steps = Math.round(s.beats / opts.stepBeats);
    const offset = Math.round(s.beat / opts.stepBeats);
    for (let i = 0; i < steps; i++) {
      const global = offset + i;
      let level = 1;
      if (levels) {
        const ch = levels[global % levels.length]!;
        level = ch === 'X' ? 1.2 : ch === 'x' ? 1 : ch === 'o' ? 0.6 : 0;
        if (level === 0) continue;
      }
      const k = opts.shape[i % opts.shape.length]!;
      const midi = voicing[k % voicing.length]! + 12 * Math.floor(k / voicing.length);
      const accent = opts.accentEvery && global % opts.accentEvery === 0 ? 1.18 : 1;
      out.push({
        beat: s.beat + i * opts.stepBeats,
        dur: opts.durBeats ?? opts.stepBeats,
        midi,
        vel: Math.min(1, baseVel * level * accent),
      });
    }
  }
  return out;
}

/** Block chords on the hits of a per-bar step pattern. */
export function stabEvents(
  spans: ChordSpan[],
  pattern: string,
  opts: { stepBeats: number; lo: number; hi: number; count: number; vel?: number; durBeats: number; beatsPerBar: number; startBar: number; bars: number; rootless?: boolean },
): NoteEvent[] {
  const out: NoteEvent[] = [];
  const hits = stepPattern(pattern, opts.stepBeats);
  let prev: number[] | null = null;
  let prevSymbol = '';
  let voicing: number[] = [];
  for (let b = 0; b < opts.bars; b++) {
    const barStart = (opts.startBar + b) * opts.beatsPerBar;
    for (const h of hits) {
      const chord = chordAt(spans, barStart + h.beat);
      if (chord.symbol !== prevSymbol) {
        voicing = voiceChord(chord, { lo: opts.lo, hi: opts.hi, count: opts.count, prev, rootless: opts.rootless });
        prev = voicing;
        prevSymbol = chord.symbol;
      }
      for (const midi of voicing) out.push({ beat: barStart + h.beat, dur: opts.durBeats, midi, vel: (opts.vel ?? 0.6) * (0.55 + 0.45 * h.level) });
    }
  }
  return out;
}

/** Sustained pad chords (voice-led) written straight into a stem. */
export function padSpans(
  stem: Stem,
  tl: Timeline,
  spans: ChordSpan[],
  opts: { lo: number; hi: number; count: number; vel: number; gain: number; pad: PadOptions; rng: Rng; overlapBeats?: number; rootless?: boolean },
): void {
  let prev: number[] | null = null;
  for (const s of mergeSpans(spans)) {
    const voicing = voiceChord(s.chord, { lo: opts.lo, hi: opts.hi, count: opts.count, prev, rootless: opts.rootless });
    prev = voicing;
    const dur = tl.seconds(s.beats + (opts.overlapBeats ?? 0));
    // Continue the slow filter sweep across chords instead of restarting it.
    const lfoPhase = (2 * Math.PI * opts.pad.lfoHz * tl.sampleAt(s.beat)) / SR;
    const voice: Voice = padChord(voicing.map(mtof), dur, opts.vel, { ...opts.pad, lfoPhase }, opts.rng);
    stem.add(voice, tl.sampleAt(s.beat), opts.gain, 0);
  }
}

export interface DrumPatternOptions {
  startBar: number;
  bars: number;
  stepBeats: number;
  gain: number;
  pan?: number;
  swing?: number;
  swingDivision?: number;
  humanizeMs?: number;
  rng: Rng;
  /** Extra random level variation (±). */
  levelJitter?: number;
}

/** Repeats a one-bar (or longer) step pattern across a range of bars. */
export function drumPattern(stem: Stem, tl: Timeline, kit: DrumKit, name: DrumName, pattern: string, o: DrumPatternOptions): void {
  const hits = stepPattern(pattern, o.stepBeats);
  let steps = 0;
  for (const ch of pattern) if (ch !== '|' && ch !== ' ') steps++;
  const patternBars = Math.max(1, Math.round((steps * o.stepBeats) / tl.beatsPerBar));
  for (let b = 0; b < o.bars; b += patternBars) {
    const barStart = (o.startBar + b) * tl.beatsPerBar;
    for (const h of hits) {
      if (h.beat >= (o.bars - b) * tl.beatsPerBar) continue;
      let beat = barStart + h.beat;
      if (o.swing) beat = swingBeat(beat, o.swing, o.swingDivision ?? 1);
      let start = tl.sampleAt(beat);
      if (o.humanizeMs) start += ((o.rng() * 2 - 1) * o.humanizeMs * SR) / 1000;
      const jitter = o.levelJitter ? 1 + (o.rng() * 2 - 1) * o.levelJitter : 1;
      stem.add({ l: kit.hit(name) }, start, o.gain * h.level * jitter, o.pan ?? 0);
    }
  }
}

/** Single drum hits at explicit beats (fills). */
export function drumHits(
  stem: Stem,
  tl: Timeline,
  kit: DrumKit,
  hits: readonly { name: DrumName; beat: number; level?: number; pan?: number }[],
  gain: number,
): void {
  for (const h of hits) stem.add({ l: kit.hit(h.name) }, tl.sampleAt(h.beat), gain * (h.level ?? 1), h.pan ?? 0);
}

/** Parses a multi-bar melody and places it at a bar. */
export function melodyAt(text: string, tl: Timeline, bar: number, vel = 0.75): NoteEvent[] {
  const { notes, beats } = parseLine(text, vel);
  void beats;
  return notes.map((n) => ({ ...n, beat: n.beat + bar * tl.beatsPerBar }));
}

/** Number of beats a melody text covers (for self-checks in the scores). */
export function melodyBeats(text: string): number {
  return parseLine(text).beats;
}

export interface TrackMeta {
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  key: string;
  feel: string;
  instruments: string[];
  sections: { name: string; bars: number }[];
}

/** Data used by the consonance lint (tools) and by tests to prove the tracks are different pieces. */
export interface ScoreData {
  meta: TrackMeta;
  /** Whole-song chord progression, one entry per bar. */
  progression: Progression;
  /** Lead melody of the whole song in the parseLine notation. */
  melody: string;
}
