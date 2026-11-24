/**
 * "Storybook Stroll" — Storybook Friends theme.
 * Warm animated-film bounce: pizzicato strings, clarinet and flute, a soft felt
 * piano, celesta sparkles, brushes and wood blocks.
 * G major, 108 BPM swing, 32 bars: A · A' · B · A''.
 */
import { makeRng } from '../core';
import { DrumKit, KICKS, SNARES } from '../drums';
import { MALLETS, PLUCKS, WINDS, mallet, pluck, softPiano, wind } from '../instruments';
import { Song, type MixResult } from '../mix';
import { Timeline, memoRenderer, parseLine, schedule, type NoteEvent } from '../seq';
import { arpEvents, chordSpans, degreeLine, drumHits, drumPattern, melodyAt, stabEvents, type ScoreData } from './common';

const SWING = 0.72;

const PROG_A = ['G6', 'Em7', 'Am7', 'D7', 'G6', 'E7', 'Am7 D7', 'G D7'] as const;
const PROG_A2 = ['G6', 'Em7', 'Am7', 'D7', 'G6', 'E7', 'Am7 D7', 'G G7'] as const;
const PROG_B = ['C6', 'Cm6', 'G/B', 'E7', 'Am7', 'A7', 'D7sus4', 'D7'] as const;
const PROG_A3 = ['G6', 'Em7', 'Am7', 'D7', 'G6 B7', 'Em7 A7', 'Am7 D7', 'G D7'] as const;

const MEL_A = [
  'd5:1 b4:0.5 d5:0.5 g5:1! e5:1',
  'd5:0.5 e5:0.5 g5:1 b5:1.5! r:0.5',
  'a5:1 c6:0.5 a5:0.5 e5:1 g5:1',
  'f#5:0.5 g5:0.5 a5:1 d5:1.5 r:0.5',
  'd5:1 b4:0.5 d5:0.5 g5:1! b5:1',
  'd6:1! b5:0.5 g#5:0.5 e5:2',
  'a5:0.5 b5:0.5 c6:1! a5:0.5 f#5:0.5 d5:1',
  'g5:2 r:1 b4:0.5 c#5:0.5',
];
const MEL_A2 = [
  'd5:1 b4:0.5 d5:0.5 g5:1! e5:1',
  'd5:0.5 e5:0.5 g5:1 b5:1.5! r:0.5',
  'a5:1 c6:0.5 a5:0.5 e5:1 g5:1',
  'f#5:0.5 g5:0.5 a5:1 d5:1.5 r:0.5',
  'd5:1 b4:0.5 d5:0.5 g5:1! b5:1',
  'd6:1! b5:0.5 g#5:0.5 e5:1 g#5:1',
  'a5:0.5 b5:0.5 c6:1! d6:0.5 c6:0.5 a5:1',
  'g5:2 r:1 b5:0.5 d6:0.5',
];
const MEL_B = [
  'e6:1! c6:0.5 e6:0.5 g6:1.5 e6:0.5',
  'eb6:1! c6:0.5 eb6:0.5 g6:1.5 eb6:0.5',
  'd6:1 b5:0.5 d6:0.5 g6:1! d6:1',
  'e6:0.5 d6:0.5 b5:0.5 g#5:0.5 e5:1 r:1',
  'c6:1 e6:1! c6:0.5 a5:0.5 e5:1',
  'c#6:1 e6:1 g6:1.5! e6:0.5',
  'd6:1 c6:1 a5:1 g5:1',
  'f#5:1 a5:0.5 c6:0.5 d6:1 b4:0.5 c#5:0.5',
];
const MEL_A3 = [
  'd5:1 b4:0.5 d5:0.5 g5:1! e5:1',
  'd5:0.5 e5:0.5 g5:1 b5:1.5! r:0.5',
  'a5:1 c6:0.5 a5:0.5 e5:1 g5:1',
  'f#5:0.5 g5:0.5 a5:1 d6:1.5! r:0.5',
  'g5:0.5 b5:0.5 d6:1! d#6:0.5 b5:0.5 f#5:1',
  'e5:0.5 g5:0.5 b5:1 c#6:0.5 a5:0.5 e5:1',
  'a5:0.5 b5:0.5 c6:1! d6:0.5 c6:0.5 a5:0.5 f#5:0.5',
  'g5:2 r:1 b4:0.5 c#5:0.5',
];

/** Flute answers in the clarinet's rests (first section). */
const FLUTE_FILLS: { bar: number; line: string }[] = [
  { bar: 1, line: 'r:3 e6:0.5 d6:0.5' },
  { bar: 3, line: 'r:3 a5:0.5 c6:0.5' },
  { bar: 5, line: 'r:2 g#5:0.5 b5:0.5 d6:0.5 e6:0.5' },
  { bar: 7, line: 'r:2 d6:0.5 b5:0.5 r:1' },
];

/** Low clarinet counter-line under the flute (second section) and guide tones in the bridge. */
const CLAR_COUNTER = [
  'b4:2 d5:2',
  'b4:2 g4:2',
  'c5:2 e5:2',
  'c5:2 a4:1 r:1',
  'b4:2 d5:2',
  'd5:2 b4:2',
  'c5:2 c5:1 a4:1',
  'b4:3 r:1',
];
const CLAR_BRIDGE = ['g4:4', 'g4:4', 'g4:2 b4:2', 'b4:2 g#4:2', 'a4:2 c5:2', 'c#5:2 e5:2', 'd5:2 c5:2', 'c5:3 r:1'];

export const storybookData: ScoreData = {
  meta: {
    id: 'storybook',
    title: 'Storybook Stroll',
    bpm: 108,
    beatsPerBar: 4,
    bars: 32,
    key: 'G major',
    feel: 'swung 8ths, oom-pah bounce',
    instruments: ['clarinet', 'flute', 'felt piano', 'pizzicato strings', 'pizzicato bass', 'celesta', 'brushes', 'wood blocks', 'triangle', 'tambourine'],
    sections: [
      { name: 'A', bars: 8 },
      { name: "A'", bars: 8 },
      { name: 'B', bars: 8 },
      { name: "A''", bars: 8 },
    ],
  },
  progression: [...PROG_A, ...PROG_A2, ...PROG_B, ...PROG_A3],
  melody: [...MEL_A, ...MEL_A2, ...MEL_B, ...MEL_A3].join(' | '),
};

export function renderStorybook(): MixResult {
  const tl = new Timeline(108, 4, 32);
  const song = new Song(tl);
  const rng = makeRng(0x570b);
  const kit = new DrumKit({ kick: KICKS.felt, snare: SNARES.soft, seed: 202 });

  const clar = song.stem('clarinet', { gain: 0.66, reverb: 0.3, delay: 0.05, hp: 120 });
  const flute = song.stem('flute', { gain: 0.7, reverb: 0.38, delay: 0.08, hp: 200 });
  const piano = song.stem('piano', { gain: 1.0, reverb: 0.28, hp: 70 });
  const pizz = song.stem('pizz', { gain: 0.62, reverb: 0.32, hp: 130 });
  const pizzBass = song.stem('pizzBass', { gain: 1.35, reverb: 0.12, hp: 36 });
  const celesta = song.stem('celesta', { gain: 0.34, reverb: 0.5, delay: 0.16 });
  const kickStem = song.stem('kick', { gain: 0.46 });
  const brushes = song.stem('brushes', { gain: 0.78, reverb: 0.16, hp: 500 });
  const blocks = song.stem('blocks', { gain: 0.6, reverb: 0.24 });

  const spansA = chordSpans(PROG_A, 4, 0);
  const spansA2 = chordSpans(PROG_A2, 4, 8);
  const spansB = chordSpans(PROG_B, 4, 16);
  const spansA3 = chordSpans(PROG_A3, 4, 24);
  const all = [...spansA, ...spansA2, ...spansB, ...spansA3];

  const clarR = (f: number, d: number, v: number) => wind(WINDS.clarinet, f, d, v, rng);
  const fluteR = (f: number, d: number, v: number) => wind(WINDS.flute, f, d, v, rng);
  const pianoR = (f: number, d: number, v: number) => softPiano(f, d, v, rng);
  const celR = memoRenderer((f, _d, v) => mallet(MALLETS.celesta, f, v, rng));
  const sw = { swing: SWING, rng };

  /* ------------------------------------------------------------ melodies */
  // A: clarinet lead, flute answers.
  schedule(clar, tl, melodyAt(MEL_A.join(' | '), tl, 0, 0.72), clarR, { ...sw, gate: 0.92, humanizeMs: 7, velJitter: 0.05, pan: -0.15 });
  for (const f of FLUTE_FILLS) schedule(flute, tl, melodyAt(f.line, tl, f.bar, 0.6), fluteR, { ...sw, gate: 0.85, humanizeMs: 7, pan: 0.3 });
  // A': flute lead, clarinet counter-line below.
  schedule(flute, tl, melodyAt(MEL_A2.join(' | '), tl, 8, 0.74), fluteR, { ...sw, gate: 0.92, humanizeMs: 7, velJitter: 0.05, pan: 0.2 });
  schedule(clar, tl, melodyAt(CLAR_COUNTER.join(' | '), tl, 8, 0.5), clarR, { ...sw, gate: 0.97, humanizeMs: 8, pan: -0.25, gain: 0.6 });
  // B: piano melody (with a soft lower octave), clarinet guide tones.
  const melB = melodyAt(MEL_B.join(' | '), tl, 16, 0.7);
  schedule(piano, tl, melB, pianoR, { ...sw, gate: 1.0, humanizeMs: 6, velJitter: 0.06, pan: 0.05 });
  schedule(piano, tl, melB.filter((n) => n.dur >= 1), pianoR, { ...sw, gate: 1.0, humanizeMs: 6, transpose: -12, gain: 0.45, pan: -0.1 });
  schedule(clar, tl, melodyAt(CLAR_BRIDGE.join(' | '), tl, 16, 0.42), clarR, { ...sw, gate: 0.98, humanizeMs: 8, pan: -0.25, gain: 0.5 });
  // A'': clarinet lead, flute an octave above, celesta on the long notes.
  const melA3 = melodyAt(MEL_A3.join(' | '), tl, 24, 0.8);
  schedule(clar, tl, melA3, clarR, { ...sw, gate: 0.92, humanizeMs: 7, velJitter: 0.05, pan: -0.15 });
  schedule(flute, tl, melA3, fluteR, { ...sw, gate: 0.9, humanizeMs: 8, transpose: 12, gain: 0.62, pan: 0.25 });
  schedule(celesta, tl, melA3.filter((n) => n.dur >= 1), celR, { ...sw, humanizeMs: 6, transpose: 12, pan: 0.35 });
  // Celesta runs that hand one section to the next.
  const run = (bar: number, names: string[]) => {
    const text = `r:3 ${names.map((n) => `${n}:0.25`).join(' ')}`;
    const notes = parseLine(text, 0.4).notes.map((n, i) => ({ ...n, vel: 0.36 + i * 0.07, beat: n.beat + bar * 4 }));
    schedule(celesta, tl, notes, celR, { rng, pan: 0.3 });
  };
  run(15, ['g6', 'b6', 'd7', 'f7']);
  run(23, ['d6', 'f#6', 'a6', 'c7']);
  run(31, ['d6', 'f#6', 'a6', 'd7']);

  /* --------------------------------------------------- strings and piano */
  const pizzChord = memoRenderer((f, _d, v) => pluck(PLUCKS.pizzViolin, f, v, rng));
  const stab = { stepBeats: 0.5, lo: 55, hi: 74, count: 3, durBeats: 0.5, beatsPerBar: 4, rootless: true };
  const panSpread = (ev: NoteEvent) => Math.max(-0.6, Math.min(0.6, (ev.midi - 64) / 11));
  schedule(pizz, tl, stabEvents(spansA, '--x---x-', { ...stab, startBar: 0, bars: 8, vel: 0.6 }), pizzChord, { ...sw, humanizeMs: 6, velJitter: 0.06, pan: panSpread });
  schedule(pizz, tl, stabEvents(spansA2, '--xo--x-', { ...stab, startBar: 8, bars: 8, vel: 0.64 }), pizzChord, { ...sw, humanizeMs: 6, velJitter: 0.06, pan: panSpread });
  schedule(pizz, tl, stabEvents(spansB, '--x---x-', { ...stab, startBar: 16, bars: 8, vel: 0.5 }), pizzChord, { ...sw, humanizeMs: 6, velJitter: 0.06, pan: panSpread });
  schedule(pizz, tl, stabEvents(spansA3, '--xo--xo', { ...stab, startBar: 24, bars: 8, vel: 0.7 }), pizzChord, { ...sw, humanizeMs: 6, velJitter: 0.06, pan: panSpread });

  // Piano: gentle comping in A' and A'', broken left-hand chords under its own melody in B.
  const comp = { stepBeats: 0.5, lo: 52, hi: 69, count: 3, durBeats: 1.4, beatsPerBar: 4, rootless: true };
  schedule(piano, tl, stabEvents(spansA2, 'x----o--', { ...comp, startBar: 8, bars: 8, vel: 0.46 }), pianoR, { ...sw, humanizeMs: 9, velJitter: 0.05, pan: (ev) => (ev.midi - 60) / 30 });
  schedule(piano, tl, stabEvents(spansA3, 'x----o--', { ...comp, startBar: 24, bars: 8, vel: 0.52 }), pianoR, { ...sw, humanizeMs: 9, velJitter: 0.05, pan: (ev) => (ev.midi - 60) / 30 });
  schedule(piano, tl, arpEvents(spansB, { stepBeats: 0.5, shape: [0, 2, 1, 2], lo: 45, hi: 62, count: 3, vel: 0.45, durBeats: 0.9, accentEvery: 4 }), pianoR, {
    ...sw,
    humanizeMs: 7,
    velJitter: 0.05,
    pan: -0.12,
  });

  /* ---------------------------------------------------------------- bass */
  const bassR = memoRenderer((f, _d, v) => pluck(PLUCKS.pizzBass, f, v, rng));
  const b = { lo: 38, beatsPerBar: 4 };
  const oom = '1:1 r:1 5:1 r:1';
  const two = '1:1 r:1 1:1 r:1';
  const twoApproach = '1:1 r:1 1:1 a:1';
  const bassEvents: NoteEvent[] = [
    ...degreeLine(all, [oom, oom, oom, oom, oom, oom, two, twoApproach], { ...b, startBar: 0, bars: 8, vel: 0.78 }),
    ...degreeLine(all, [oom, oom, oom, '1:1 r:1 5:1 a:1', oom, oom, two, twoApproach], { ...b, startBar: 8, bars: 8, vel: 0.8 }),
    ...degreeLine(all, ['1:1 3:1 5:1 a:1'], { ...b, startBar: 16, bars: 8, vel: 0.72 }),
    ...degreeLine(all, [oom, oom, oom, '1:1 r:1 5:1 a:1', two, two, two, twoApproach], { ...b, startBar: 24, bars: 8, vel: 0.84 }),
  ];
  schedule(pizzBass, tl, bassEvents, bassR, { ...sw, humanizeMs: 5, velJitter: 0.05 });

  /* ---------------------------------------------------------- percussion */
  const d = { stepBeats: 0.5, rng, humanizeMs: 4, levelJitter: 0.1, swing: SWING };
  drumPattern(kickStem, tl, kit, 'kick', 'x---x---', { ...d, startBar: 0, bars: 32, gain: 0.8 });
  drumPattern(brushes, tl, kit, 'brush', 'o-xoo-xo', { ...d, startBar: 0, bars: 32, gain: 0.7, pan: -0.2 });
  drumPattern(brushes, tl, kit, 'brushLong', '--x---x-', { ...d, startBar: 0, bars: 32, gain: 0.34, pan: 0.15 });
  drumPattern(blocks, tl, kit, 'woodHi', '-------x', { ...d, startBar: 8, bars: 8, gain: 0.42, pan: -0.45 });
  drumPattern(blocks, tl, kit, 'woodLo', '---x----', { ...d, startBar: 8, bars: 8, gain: 0.4, pan: 0.45 });
  drumPattern(blocks, tl, kit, 'woodHi', '---x---x', { ...d, startBar: 24, bars: 8, gain: 0.45, pan: -0.45 });
  drumPattern(blocks, tl, kit, 'woodLo', '-x---x--', { ...d, startBar: 24, bars: 8, gain: 0.42, pan: 0.45 });
  drumPattern(brushes, tl, kit, 'tambourine', '--x---x-', { ...d, startBar: 24, bars: 8, gain: 0.3, pan: 0.3 });
  drumPattern(brushes, tl, kit, 'triangleMute', 'x-------', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: 0.35 });
  for (const bar of [0, 8, 16, 24]) drumHits(brushes, tl, kit, [{ name: 'triangle', beat: bar * 4, pan: 0.35 }], 0.7);
  // Fills: a brush roll, a block triplet and a clip-clop turnaround.
  drumHits(brushes, tl, kit, [0, 0.25, 0.5, 0.75].map((o, i) => ({ name: 'brush' as const, beat: 7 * 4 + 3 + o, level: 0.5 + i * 0.15 })), 0.8);
  drumHits(blocks, tl, kit, [0, 1 / 3, 2 / 3].map((o, i) => ({ name: (i % 2 ? 'woodLo' : 'woodHi') as 'woodLo' | 'woodHi', beat: 15 * 4 + 3 + o, level: 0.6 + i * 0.15, pan: i % 2 ? 0.4 : -0.4 })), 0.5);
  drumHits(brushes, tl, kit, [0, 0.25, 0.5, 0.75].map((o, i) => ({ name: 'brush' as const, beat: 23 * 4 + 3 + o, level: 0.5 + i * 0.15 })), 0.8);
  drumHits(blocks, tl, kit, [0, 0.25, 0.5, 0.75].map((o, i) => ({ name: (i % 2 ? 'woodLo' : 'woodHi') as 'woodLo' | 'woodHi', beat: 31 * 4 + 3 + o, level: 0.6 + i * 0.1, pan: i % 2 ? 0.4 : -0.4 })), 0.5);

  return song.mixdown({
    reverb: { t60: 1.7, damping: 4600, size: 1.05, preDelayMs: 18, lowCut: 220 },
    delay: { beats: 2 / 3, feedback: 0.2, damping: 2800, toReverb: 0.4 },
    targetLufs: -16,
    ceilingDb: -1.5,
    highShelfDb: 1,
  });
}
