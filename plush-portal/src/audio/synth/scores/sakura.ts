/**
 * "Petal Parade" — Sakura Kawaii theme.
 * Light, soft Japanese-kawaii electronic: xylophone lead, glockenspiel answers,
 * a round synth pluck, koto arpeggios in the bridge and small hand percussion.
 * F major, 112 BPM, 32 bars: A · A' · B · A''.
 */
import { makeRng, mtof } from '../core';
import { DrumKit, KICKS, SNARES, swell } from '../drums';
import { MALLETS, PLUCKS, SOFT_PLUCKS, mallet, pluck, softPluck, subBass } from '../instruments';
import { Song, type MixResult } from '../mix';
import { Timeline, memoRenderer, parseLine, schedule, type NoteEvent } from '../seq';
import {
  arpEvents,
  chordSpans,
  degreeLine,
  drumHits,
  drumPattern,
  melodyAt,
  padSpans,
  stabEvents,
  type ScoreData,
} from './common';

const PROG_A = ['Bbmaj7', 'C', 'Am7', 'Dm7', 'Bbmaj7', 'C', 'F', 'F7'] as const;
const PROG_A2 = ['Bbmaj7', 'C', 'Am7', 'Dm7', 'Gm7', 'C7', 'F', 'F D7'] as const;
const PROG_B = ['Gm7', 'C7', 'Am7', 'Dm7', 'Gm7', 'A7', 'Dm7', 'Cm7 F7'] as const;
const PROG_A3 = ['Bbmaj7', 'C', 'Am7', 'Dm7', 'Bbmaj7', 'C', 'F', 'F7'] as const;

const MEL_A = [
  'd6:0.5 c6:0.5 a5:0.5 f5:0.5 a5:1 r:1',
  'g5:0.5 a5:0.5 c6:0.5 g5:0.5 e5:1 r:1',
  'c6:0.5 a5:0.5 g5:0.5 e5:0.5 g5:1 r:1',
  'f5:0.5 g5:0.5 a5:0.5 c6:0.5 d6:1.5! r:0.5',
  'd6:0.5 c6:0.5 a5:0.5 f5:0.5 a5:1 c6:0.5 d6:0.5',
  'e6:1! d6:0.5 c6:0.5 g5:1 r:1',
  'a5:0.5 c6:0.5 f6:1! e6:0.5 c6:0.5 a5:1',
  'f5:1.5 r:0.5 g5:0.5 a5:0.5 c6:0.5 eb6:0.5',
];
const MEL_A2 = [
  'd6:0.5 c6:0.5 a5:0.75 f5:0.25 a5:1 r:1',
  'g5:0.5 a5:0.5 c6:0.5 g5:0.5 e5:0.5 g5:0.5 c6:1',
  'c6:0.5 a5:0.5 g5:0.75 e5:0.25 g5:1 r:1',
  'f5:0.5 g5:0.5 a5:0.5 c6:0.5 d6:1 f6:1!',
  'g6:1! f6:0.5 d6:0.5 bb5:1 d6:1',
  'e6:1 d6:0.5 c6:0.5 bb5:0.5 g5:0.5 e5:1',
  'f5:0.5 a5:0.5 c6:1 a5:0.5 c6:0.5 f6:1!',
  'f6:1.5 r:0.5 f#5:0.5 a5:0.5 c6:0.5 a5:0.5',
];
const MEL_B = [
  'bb5:1 d6:1 f6:1.5 d6:0.5',
  'e6:1 g5:0.5 bb5:0.5 c6:2',
  'a5:1 c6:1 e6:1.5 c6:0.5',
  'd6:1 a5:0.5 f5:0.5 a5:2',
  'bb5:0.5 a5:0.5 g5:0.5 bb5:0.5 d6:1 g6:1!',
  'e6:1 c#6:1 a5:1 e6:1',
  'f6:1.5! e6:0.5 d6:1 a5:1',
  'g5:0.5 bb5:0.5 eb6:1 c6:0.5 eb6:0.5 f6:0.5 eb6:0.5',
];
const MEL_A3 = [
  'd6:0.5 c6:0.5 a5:0.75 f5:0.25 a5:1 r:1',
  'g5:0.5 a5:0.5 c6:0.75 g5:0.25 e5:1 r:1',
  'c6:0.5 a5:0.5 g5:0.75 e5:0.25 g5:1 r:1',
  'f5:0.5 g5:0.5 a5:0.5 c6:0.5 d6:1.5! r:0.5',
  'd6:0.5 c6:0.5 a5:0.5 f5:0.5 a5:1 c6:0.5 d6:0.5',
  'e6:1! d6:0.5 c6:0.5 g5:0.5 c6:0.5 e6:1',
  'f6:1! c6:0.5 a5:0.5 f5:1 a5:0.5 c6:0.5',
  'f6:1.5 r:0.5 g5:0.5 a5:0.5 c6:0.5 eb6:0.5',
];

/** Glockenspiel answers that fill the lead's rests (beats within the bar). */
const GLOCK_ANSWERS: { bar: number; line: string }[] = [
  { bar: 8, line: 'r:3 f6:0.5 a6:0.5' },
  { bar: 10, line: 'r:3 e6:0.5 g6:0.5' },
  { bar: 12, line: 'r:2 d7:1 bb6:1' },
  { bar: 14, line: 'r:3.5 c7:0.5' },
  { bar: 24, line: 'r:3 f6:0.5 a6:0.5' },
  { bar: 25, line: 'r:3 e6:0.5 c7:0.5' },
  { bar: 26, line: 'r:3 e6:0.5 g6:0.5' },
  { bar: 27, line: 'r:3.5 a6:0.5' },
  { bar: 29, line: 'r:1 c7:1 r:2' },
];

export const sakuraData: ScoreData = {
  meta: {
    id: 'sakura',
    title: 'Petal Parade',
    bpm: 112,
    beatsPerBar: 4,
    bars: 32,
    key: 'F major',
    feel: 'straight 16ths, light syncopation',
    instruments: ['xylophone', 'glockenspiel', 'kawaii synth pluck', 'koto', 'soft pad', 'sine bass', 'snaps', 'shaker', 'woodblocks', 'triangle', 'tambourine'],
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

export function renderSakura(): MixResult {
  const tl = new Timeline(112, 4, 32);
  const song = new Song(tl);
  const rng = makeRng(0x5a4b);
  const kit = new DrumKit({ kick: KICKS.soft, snare: SNARES.soft, seed: 101 });

  const lead = song.stem('lead', { gain: 1.0, reverb: 0.3, delay: 0.12 });
  const glock = song.stem('glock', { gain: 0.34, reverb: 0.5, delay: 0.22 });
  const plucks = song.stem('pluck', { gain: 0.3, reverb: 0.28, delay: 0.16, hp: 220 });
  const koto = song.stem('koto', { gain: 0.34, reverb: 0.4, delay: 0.18, hp: 150 });
  const pad = song.stem('pad', { gain: 0.22, reverb: 0.4, hp: 190, lp: 5200, chorus: { rateHz: 0.35, depthMs: 2.5, baseMs: 14, mix: 0.35 } });
  const bass = song.stem('bass', { gain: 0.27, hp: 34 });
  const kickStem = song.stem('kick', { gain: 0.5 });
  const perc = song.stem('perc', { gain: 0.85, reverb: 0.2 });
  const tops = song.stem('tops', { gain: 0.62, reverb: 0.12, hp: 1800 });

  const spansA = chordSpans(PROG_A, 4, 0);
  const spansA2 = chordSpans(PROG_A2, 4, 8);
  const spansB = chordSpans(PROG_B, 4, 16);
  const spansA3 = chordSpans(PROG_A3, 4, 24);
  const all = [...spansA, ...spansA2, ...spansB, ...spansA3];

  /* ---------------------------------------------------------------- lead */
  const xylo = memoRenderer((f, _d, v) => mallet(MALLETS.xylophone, f, v, rng));
  const glockR = memoRenderer((f, _d, v) => mallet(MALLETS.glockenspiel, f, v, rng));
  const sections: [string[], number, number][] = [
    [MEL_A, 0, 0.72],
    [MEL_A2, 8, 0.78],
    [MEL_B, 16, 0.66],
    [MEL_A3, 24, 0.86],
  ];
  for (const [bars, startBar, vel] of sections) {
    const notes = melodyAt(bars.join(' | '), tl, startBar, vel);
    schedule(lead, tl, notes, xylo, { rng, humanizeMs: 5, velJitter: 0.05, pan: -0.06 });
    // The glockenspiel doubles the bridge melody softly, and the peaks of the last section an octave up.
    if (startBar === 16) {
      schedule(glock, tl, notes.filter((n) => n.dur >= 1), glockR, { rng, humanizeMs: 6, gain: 0.7, pan: 0.28 });
    }
    if (startBar === 24) {
      schedule(glock, tl, notes.filter((n) => n.dur >= 1 || n.vel > 0.9), glockR, { rng, humanizeMs: 6, gain: 0.75, pan: 0.28, transpose: 12 });
    }
  }
  for (const a of GLOCK_ANSWERS) {
    schedule(glock, tl, melodyAt(a.line, tl, a.bar, 0.62), glockR, { rng, humanizeMs: 6, pan: 0.32 });
  }
  // Ascending pentatonic glissando into the loop point and into the last section.
  const gliss = (bar: number) => {
    const names = ['f5', 'g5', 'a5', 'c6', 'd6', 'f6', 'g6', 'a6'];
    const text = `r:3 ${names.map((n) => `${n}:0.125`).join(' ')}`;
    const notes = parseLine(text, 0.4).notes.map((n, i) => ({ ...n, vel: 0.32 + i * 0.05, beat: n.beat + bar * 4 }));
    schedule(glock, tl, notes, glockR, { rng, pan: 0.2, gain: 0.8 });
  };
  gliss(23);
  gliss(31);

  /* -------------------------------------------------------- chord plucks */
  const kawaii = memoRenderer((f, d, v) => softPluck(SOFT_PLUCKS.kawaii, f, d, v));
  const stabOpts = { stepBeats: 0.25, lo: 62, hi: 81, count: 3, durBeats: 0.3, beatsPerBar: 4, rootless: true };
  const panByPitch = (ev: NoteEvent) => Math.max(-0.7, Math.min(0.7, (ev.midi - 71) / 12));
  schedule(plucks, tl, stabEvents(spansA, 'x--x--x---x--x--', { ...stabOpts, startBar: 0, bars: 8, vel: 0.62 }), kawaii, { rng, humanizeMs: 3, velJitter: 0.05, pan: panByPitch });
  schedule(plucks, tl, stabEvents(spansA2, 'x--x--x---x--x--', { ...stabOpts, startBar: 8, bars: 8, vel: 0.66 }), kawaii, { rng, humanizeMs: 3, velJitter: 0.05, pan: panByPitch });
  schedule(plucks, tl, stabEvents(spansB, 'x-------x-------', { ...stabOpts, startBar: 16, bars: 8, vel: 0.5, durBeats: 0.8 }), kawaii, { rng, humanizeMs: 3, pan: panByPitch });
  schedule(plucks, tl, stabEvents(spansA3, 'x--x--x-x--x--x-', { ...stabOpts, startBar: 24, bars: 8, vel: 0.72 }), kawaii, { rng, humanizeMs: 3, velJitter: 0.05, pan: panByPitch });
  // A soft 16th-note sparkle arpeggio from the second section on.
  const sparkle = memoRenderer((f, _d, v) => mallet(MALLETS.celesta, f, v, rng));
  schedule(glock, tl, arpEvents(spansA2, { stepBeats: 0.5, shape: [0, 2, 1, 3], lo: 72, hi: 88, count: 3, vel: 0.3, pattern: '-x-x-x-x' }), sparkle, { rng, humanizeMs: 4, pan: -0.3, gain: 0.7 });
  schedule(glock, tl, arpEvents(spansA3, { stepBeats: 0.25, shape: [0, 1, 2, 3, 2, 1], lo: 72, hi: 88, count: 3, vel: 0.28, pattern: '--x-x-x---x-x-x-' }), sparkle, { rng, humanizeMs: 4, pan: -0.3, gain: 0.7 });

  /* ------------------------------------------------------------- bridge */
  const kotoR = memoRenderer((f, _d, v) => pluck(PLUCKS.koto, f, v, rng));
  schedule(koto, tl, arpEvents(spansB, { stepBeats: 0.5, shape: [0, 2, 1, 3, 2, 1, 3, 2], lo: 60, hi: 79, count: 4, vel: 0.55, accentEvery: 4 }), kotoR, {
    rng,
    humanizeMs: 6,
    velJitter: 0.07,
    pan: (ev) => (ev.midi % 2 === 0 ? -0.5 : 0.5),
  });
  const padOpts = { voices: 3, detuneCents: 10, cutoff: 1350, q: 0.5, lfoDepth: 0.16, lfoHz: 0.11, attack: 0.3, release: 0.7, soft: 0.5 };
  padSpans(pad, tl, spansB, { lo: 55, hi: 72, count: 3, vel: 0.7, gain: 0.95, pad: padOpts, rng, rootless: true });
  padSpans(pad, tl, spansA3, { lo: 55, hi: 72, count: 3, vel: 0.6, gain: 0.6, pad: padOpts, rng, rootless: true });

  /* ---------------------------------------------------------------- bass */
  const bassR = memoRenderer((f, d, v) => subBass(f, d, v, { harm2: 0.26, harm3: 0.1, drive: 1.3, release: 0.05 }));
  const bassOpts = { lo: 41, beatsPerBar: 4 };
  const bassLines: NoteEvent[] = [
    ...degreeLine(all, '1:1.5 1:0.5 1:1 5:0.5 8:0.5', { ...bassOpts, startBar: 0, bars: 16, vel: 0.74 }),
    ...degreeLine(all, ['1:2 5:1 1:1', '1:2 5:1 a:1'], { ...bassOpts, startBar: 16, bars: 8, vel: 0.66 }),
    ...degreeLine(all, ['1:1.5 1:0.5 1:0.5 8:0.5 5:0.5 1:0.5', '1:1.5 1:0.5 1:0.5 8:0.5 5:0.5 a:0.5'], { ...bassOpts, startBar: 24, bars: 8, vel: 0.8 }),
  ];
  schedule(bass, tl, bassLines, bassR, { rng, gate: 0.8, humanizeMs: 2 });

  /* --------------------------------------------------------------- drums */
  const d = { stepBeats: 0.25, rng, humanizeMs: 2, levelJitter: 0.08 };
  drumPattern(kickStem, tl, kit, 'kick', 'x-----x-x-------', { ...d, startBar: 0, bars: 16, gain: 0.9 });
  drumPattern(kickStem, tl, kit, 'kick', 'x-------x-------', { ...d, startBar: 16, bars: 8, gain: 0.8 });
  drumPattern(kickStem, tl, kit, 'kick', 'x-----x-x-----x-', { ...d, startBar: 24, bars: 8, gain: 0.95 });
  drumPattern(perc, tl, kit, 'snap', '----x-------x---', { ...d, startBar: 0, bars: 16, gain: 0.7, pan: 0.1 });
  drumPattern(perc, tl, kit, 'rim', '----x-------x---', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: 0.15 });
  drumPattern(perc, tl, kit, 'snap', '----x-------x---', { ...d, startBar: 24, bars: 8, gain: 0.7, pan: 0.1 });
  drumPattern(perc, tl, kit, 'clap', '----x-------x---', { ...d, startBar: 24, bars: 8, gain: 0.42, pan: -0.1 });
  drumPattern(perc, tl, kit, 'woodHi', '---x-------x----', { ...d, startBar: 8, bars: 8, gain: 0.34, pan: -0.4 });
  drumPattern(perc, tl, kit, 'woodLo', '--------------x-', { ...d, startBar: 8, bars: 8, gain: 0.3, pan: 0.4 });
  drumPattern(perc, tl, kit, 'woodHi', '---x-------x----', { ...d, startBar: 24, bars: 8, gain: 0.34, pan: -0.4 });
  drumPattern(perc, tl, kit, 'woodLo', '------x-------x-', { ...d, startBar: 24, bars: 8, gain: 0.3, pan: 0.4 });
  drumPattern(perc, tl, kit, 'tambourine', '----x-------x---', { ...d, startBar: 24, bars: 8, gain: 0.3, pan: 0.3 });
  drumPattern(tops, tl, kit, 'shaker', 'xoXoxoXoxoXoxoXo', { ...d, startBar: 0, bars: 16, gain: 0.8, pan: -0.45 });
  drumPattern(tops, tl, kit, 'shaker', 'x-o-x-o-x-o-x-o-', { ...d, startBar: 16, bars: 8, gain: 0.55, pan: -0.45 });
  drumPattern(tops, tl, kit, 'shaker', 'xoXoxoXoxoXoxoXo', { ...d, startBar: 24, bars: 8, gain: 0.9, pan: -0.45 });
  drumPattern(tops, tl, kit, 'hat', '--x---x---x---x-', { ...d, startBar: 8, bars: 8, gain: 0.5, pan: 0.45 });
  drumPattern(tops, tl, kit, 'hat', '--x---x---x---xo', { ...d, startBar: 24, bars: 8, gain: 0.55, pan: 0.45 });
  drumPattern(tops, tl, kit, 'triangleMute', 'x-x-x-x-x-x-x-x-', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: 0.35 });
  for (const bar of [0, 4, 8, 12, 16, 20, 24, 28]) drumHits(tops, tl, kit, [{ name: 'triangle', beat: bar * 4, pan: 0.35 }], 0.8);

  // Section fills.
  const fill = (bar: number, names: ('woodHi' | 'woodLo' | 'rim' | 'tomHi' | 'tomMid' | 'tomLo')[]) =>
    drumHits(
      perc,
      tl,
      kit,
      names.map((name, i) => ({ name, beat: bar * 4 + 3 + i * 0.25, level: 0.6 + i * 0.12, pan: -0.3 + i * 0.2 })),
      0.6,
    );
  fill(7, ['woodHi', 'woodLo', 'woodHi', 'woodLo']);
  fill(15, ['rim', 'rim', 'woodHi', 'woodLo']);
  fill(23, ['woodLo', 'woodHi', 'rim', 'rim']);
  fill(31, ['tomHi', 'tomHi', 'tomMid', 'tomLo']);
  // A breath of noise lifts into the last section and back into the loop.
  tops.add({ l: swell(rng, tl.seconds(4), { from: 1500, to: 6500 }) }, tl.sampleAt(23 * 4), 0.55, 0);
  tops.add({ l: swell(rng, tl.seconds(2), { from: 1800, to: 6000 }) }, tl.sampleAt(31 * 4 + 2), 0.4, 0);
  void mtof;

  return song.mixdown({
    reverb: { t60: 1.5, damping: 5200, size: 0.9, preDelayMs: 12, lowCut: 260 },
    delay: { beats: 0.75, feedback: 0.3, damping: 3200, toReverb: 0.3 },
    targetLufs: -16,
    ceilingDb: -1.5,
    highShelfDb: 1.5,
  });
}
