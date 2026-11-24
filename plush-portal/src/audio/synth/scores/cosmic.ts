/**
 * "Neon Orbit" — Cosmic Arcade theme.
 * Upbeat synth-pop: four-on-the-floor, pumping pad and bass, a playful pulse
 * arpeggio through a ping-pong delay, a rounded lead and arcade percussion.
 * F# minor / A major, 126 BPM, 32 bars: verse · chorus · verse' · chorus'.
 */
import { makeRng, mtof } from '../core';
import { DrumKit, KICKS, SNARES, swell } from '../drums';
import { SOFT_PLUCKS, fmBell, softPluck, synthBass, synthLead } from '../instruments';
import { Song, type MixResult } from '../mix';
import { Timeline, memoRenderer, parseLine, pcAbove, schedule, type NoteEvent } from '../seq';
import { arpEvents, chordSpans, degreeLine, drumHits, drumPattern, melodyAt, padSpans, type ScoreData } from './common';

const PROG_V1 = ['F#m', 'D', 'A', 'E', 'F#m', 'D', 'A', 'E'] as const;
const PROG_C1 = ['D', 'E', 'F#m', 'A/C#', 'D', 'E', 'A', 'A E'] as const;
const PROG_V2 = ['F#m', 'D', 'A', 'E', 'F#m', 'D', 'Bm', 'E'] as const;
const PROG_C2 = ['D', 'E', 'F#m', 'A/C#', 'D', 'E', 'F#m', 'E'] as const;

const MEL_V1 = [
  'c#5:0.5 f#5:0.5 a5:1! g#5:0.5 f#5:0.5 c#5:1',
  'd5:0.5 f#5:0.5 a5:1! b5:0.5 a5:0.5 f#5:1',
  'e5:0.5 a5:0.5 c#6:1! b5:0.5 a5:0.5 e5:1',
  'g#5:1 b5:1 e6:1.5! r:0.5',
  'c#5:0.5 f#5:0.5 a5:1! g#5:0.5 a5:0.5 c#6:1',
  'd6:1! a5:0.5 f#5:0.5 a5:1.5 r:0.5',
  'e5:0.5 a5:0.5 c#6:1! e6:0.5 c#6:0.5 a5:1',
  'b5:1 g#5:1 e5:0.5 g#5:0.5 b5:0.5 e6:0.5',
];
const MEL_C1 = [
  'f#6:1! e6:0.5 d6:0.5 a5:1 d6:1',
  'e6:1! d6:0.5 b5:0.5 g#5:1 b5:1',
  'c#6:1.5! a5:0.5 f#5:1 a5:1',
  'c#6:1 e6:1 a5:2',
  'f#6:1! e6:0.5 d6:0.5 a5:1 f#6:1',
  'g#6:1! f#6:0.5 e6:0.5 b5:1 e6:1',
  'a6:1.5! e6:0.5 c#6:1 e6:1',
  'a5:2 b5:0.5 g#5:0.5 e5:1',
];
const MEL_V2 = [
  'c#5:0.5 f#5:0.5 a5:1! g#5:0.5 f#5:0.5 c#5:1',
  'd5:0.5 f#5:0.5 a5:1! b5:0.5 a5:0.5 d6:1',
  'e5:0.5 a5:0.5 c#6:1! b5:0.5 a5:0.5 e5:1',
  'g#5:1 b5:1 e6:1.5! r:0.5',
  'f#5:0.5 a5:0.5 c#6:1! b5:0.5 a5:0.5 f#5:1',
  'd6:1! a5:0.5 f#5:0.5 a5:1.5 r:0.5',
  'd6:1! b5:0.5 f#5:0.5 b5:1 d6:1',
  'e6:1 b5:0.5 g#5:0.5 e5:0.5 g#5:0.5 b5:0.5 e6:0.5',
];
const MEL_C2 = [
  'f#6:1! e6:0.5 d6:0.5 a5:1 d6:1',
  'e6:1! d6:0.5 b5:0.5 g#5:1 b5:1',
  'c#6:1.5! a5:0.5 f#5:1 a5:1',
  'c#6:1 e6:1 a5:2',
  'f#6:1! e6:0.5 d6:0.5 a5:1 f#6:1',
  'g#6:1! f#6:0.5 e6:0.5 b5:1 e6:1',
  'c#6:1 f#6:1 a6:1.5! f#6:0.5',
  'g#6:1 e6:1 b5:1 r:1',
];

export const cosmicData: ScoreData = {
  meta: {
    id: 'cosmic',
    title: 'Neon Orbit',
    bpm: 126,
    beatsPerBar: 4,
    bars: 32,
    key: 'F# minor / A major',
    feel: 'four-on-the-floor, 16th arpeggios, side-chain pump',
    instruments: ['pulse lead', 'arcade arpeggio', 'detuned saw pad', 'synth bass', 'FM bells', 'pop kick', 'arcade snare and clap', 'hats', 'blips, zaps and arcade toms'],
    sections: [
      { name: 'verse', bars: 8 },
      { name: 'chorus', bars: 8 },
      { name: "verse'", bars: 8 },
      { name: "chorus'", bars: 8 },
    ],
  },
  progression: [...PROG_V1, ...PROG_C1, ...PROG_V2, ...PROG_C2],
  melody: [...MEL_V1, ...MEL_C1, ...MEL_V2, ...MEL_C2].join(' | '),
};

export function renderCosmic(): MixResult {
  const tl = new Timeline(126, 4, 32);
  const song = new Song(tl);
  const rng = makeRng(0xc05);
  const kit = new DrumKit({ kick: KICKS.pop, snare: SNARES.arcade, arcadeToms: true, seed: 404 });

  const lead = song.stem('lead', { gain: 0.4, reverb: 0.24, delay: 0.3, hp: 220 });
  const arp = song.stem('arp', { gain: 0.64, reverb: 0.2, delay: 0.36, hp: 260, pump: 0.25 });
  const pad = song.stem('pad', { gain: 0.52, reverb: 0.3, hp: 190, lp: 7000, pump: 0.55, chorus: { rateHz: 0.5, depthMs: 2.2, baseMs: 12, mix: 0.4 } });
  const bass = song.stem('bass', { gain: 0.95, hp: 36, pump: 0.45 });
  const kickStem = song.stem('kick', { gain: 0.5 });
  const snareStem = song.stem('snare', { gain: 1.4, reverb: 0.2, hp: 140 });
  const hats = song.stem('hats', { gain: 0.72, hp: 4200, reverb: 0.06 });
  const arcade = song.stem('arcade', { gain: 0.62, reverb: 0.26, delay: 0.22 });
  const bells = song.stem('bells', { gain: 0.4, reverb: 0.5, delay: 0.32 });

  song.pumpBeats = Array.from({ length: tl.totalBeats }, (_, i) => i);
  song.pumpTau = 0.1;

  const spansV1 = chordSpans(PROG_V1, 4, 0);
  const spansC1 = chordSpans(PROG_C1, 4, 8);
  const spansV2 = chordSpans(PROG_V2, 4, 16);
  const spansC2 = chordSpans(PROG_C2, 4, 24);
  const all = [...spansV1, ...spansC1, ...spansV2, ...spansC2];

  /* ---------------------------------------------------------------- lead */
  const verseLead = memoRenderer((f, d, v) => synthLead(f, d, v, { cutoff: 2100, duty: 0.4, vibDepth: 0.003 }));
  const chorusLead = memoRenderer((f, d, v) => synthLead(f, d, v, { cutoff: 3100, duty: 0.32, vibDepth: 0.0045 }));
  schedule(lead, tl, melodyAt(MEL_V1.join(' | '), tl, 0, 0.62), verseLead, { rng, gate: 0.82, humanizeMs: 3, velJitter: 0.04, pan: -0.05 });
  schedule(lead, tl, melodyAt(MEL_V2.join(' | '), tl, 16, 0.66), verseLead, { rng, gate: 0.82, humanizeMs: 3, velJitter: 0.04, pan: -0.05 });
  for (const [mel, bar] of [
    [MEL_C1, 8],
    [MEL_C2, 24],
  ] as const) {
    const notes = melodyAt(mel.join(' | '), tl, bar, 0.82);
    schedule(lead, tl, notes, chorusLead, { rng, gate: 0.88, humanizeMs: 3, velJitter: 0.04 });
    // Octave-below double for weight.
    schedule(lead, tl, notes, verseLead, { rng, gate: 0.88, humanizeMs: 4, transpose: -12, gain: 0.42, pan: 0.15 });
  }

  /* ----------------------------------------------------------------- arp */
  const arpR = memoRenderer((f, d, v) => softPluck(SOFT_PLUCKS.arcade, f, d, v));
  const arpOpts = { stepBeats: 0.25, lo: 64, hi: 83, count: 3, durBeats: 0.2 };
  const arpPan = (_ev: NoteEvent, i: number) => (i % 4 < 2 ? -0.35 : 0.35);
  schedule(arp, tl, arpEvents(spansV1, { ...arpOpts, shape: [0, 1, 2, 3, 2, 1], vel: 0.55, pattern: 'x--x--x-x--x--x-' }), arpR, { rng, velJitter: 0.05, pan: arpPan });
  schedule(arp, tl, arpEvents(spansC1, { ...arpOpts, shape: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.6, pattern: 'XxxxXxxxXxxxXxxx' }), arpR, { rng, velJitter: 0.05, pan: arpPan });
  schedule(arp, tl, arpEvents(spansV2, { ...arpOpts, shape: [0, 2, 1, 3, 2, 4], vel: 0.57, pattern: 'x-xx--x-x-xx--x-' }), arpR, { rng, velJitter: 0.05, pan: arpPan });
  schedule(arp, tl, arpEvents(spansC2, { ...arpOpts, shape: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.64, pattern: 'XxxxXxxxXxxxXxxx' }), arpR, { rng, velJitter: 0.05, pan: arpPan });

  /* ----------------------------------------------------------------- pad */
  const padBase = { voices: 5, detuneCents: 16, q: 0.7, lfoDepth: 0.1, lfoHz: 0.2, attack: 0.04, release: 0.28, soft: 0.2 };
  for (const [spans, cutoff, vel] of [
    [spansV1, 1500, 0.55],
    [spansC1, 2500, 0.75],
    [spansV2, 1700, 0.6],
    [spansC2, 2700, 0.8],
  ] as const) {
    padSpans(pad, tl, [...spans], { lo: 57, hi: 76, count: 4, vel, gain: 1, pad: { ...padBase, cutoff }, rng });
  }

  /* ---------------------------------------------------------------- bass */
  const bassR = memoRenderer((f, d, v) => synthBass(f, d, v));
  const verseBass = 'r:0.5 1:0.5 r:0.5 1:0.5 r:0.5 1:0.5 r:0.5 8:0.5';
  const chorusBass = '1:0.5! 1:0.5 8:0.5 1:0.5 1:0.5! 1:0.5 8:0.5 5:0.5';
  const b = { lo: 37, beatsPerBar: 4 };
  const bassEvents: NoteEvent[] = [
    ...degreeLine(all, verseBass, { ...b, startBar: 0, bars: 8, vel: 0.72 }),
    ...degreeLine(all, chorusBass, { ...b, startBar: 8, bars: 8, vel: 0.8 }),
    ...degreeLine(all, verseBass, { ...b, startBar: 16, bars: 8, vel: 0.74 }),
    ...degreeLine(all, chorusBass, { ...b, startBar: 24, bars: 8, vel: 0.84 }),
  ];
  schedule(bass, tl, bassEvents, bassR, { rng, gate: 0.78 });

  /* --------------------------------------------------------------- bells */
  const bellR = memoRenderer((f, _d, v) => fmBell(f, v, { ratio: 3.5, index: 1.8, decay: 1.1 }));
  for (const spans of [spansC1, spansC2]) {
    const hits: NoteEvent[] = [];
    for (const s of spans) {
      if (s.beat % 4 !== 0) continue;
      const root = pcAbove(s.chord.root, 81);
      hits.push({ beat: s.beat, dur: 1, midi: root, vel: 0.55 }, { beat: s.beat + 0.01, dur: 1, midi: root + 7, vel: 0.4 });
    }
    schedule(bells, tl, hits, bellR, { rng, pan: (_e, i) => (i % 2 ? 0.4 : -0.4) });
  }
  // Rising sparkle runs into each chorus.
  for (const bar of [7, 23]) {
    const names = ['e6', 'g#6', 'b6', 'e7', 'g#6', 'b6', 'e7', 'g#7'];
    const notes = parseLine(`r:2 ${names.map((n) => `${n}:0.25`).join(' ')}`, 0.4).notes.map((n, i) => ({ ...n, vel: 0.3 + i * 0.045, beat: n.beat + bar * 4 }));
    schedule(bells, tl, notes, bellR, { rng, pan: (_e, i) => -0.5 + i * 0.14 });
  }

  /* --------------------------------------------------------------- drums */
  const d = { stepBeats: 0.25, rng, humanizeMs: 1.5, levelJitter: 0.06 };
  drumPattern(kickStem, tl, kit, 'kick', 'x---x---x---x---', { ...d, startBar: 0, bars: 32, gain: 0.9, humanizeMs: 0 });
  drumPattern(snareStem, tl, kit, 'snare', '----x-------x---', { ...d, startBar: 0, bars: 32, gain: 0.8 });
  drumPattern(snareStem, tl, kit, 'clap', '----x-------x---', { ...d, startBar: 8, bars: 8, gain: 0.55, pan: 0.1 });
  drumPattern(snareStem, tl, kit, 'clap', '----x-------x--o', { ...d, startBar: 24, bars: 8, gain: 0.6, pan: 0.1 });
  drumPattern(hats, tl, kit, 'hat', 'o-x-o-x-o-x-o-x-', { ...d, startBar: 0, bars: 8, gain: 0.7, pan: 0.2 });
  drumPattern(hats, tl, kit, 'hat', 'xoxoxoxoxoxoxoxo', { ...d, startBar: 8, bars: 8, gain: 0.75, pan: 0.2 });
  drumPattern(hats, tl, kit, 'hat', 'o-x-o-xoo-x-o-xo', { ...d, startBar: 16, bars: 8, gain: 0.7, pan: 0.2 });
  drumPattern(hats, tl, kit, 'hat', 'xoxoxoxoxoxoxoxo', { ...d, startBar: 24, bars: 8, gain: 0.8, pan: 0.2 });
  drumPattern(hats, tl, kit, 'openHat', '--x---x---x---x-', { ...d, startBar: 8, bars: 8, gain: 0.42, pan: -0.2 });
  drumPattern(hats, tl, kit, 'openHat', '--x---x---x---x-', { ...d, startBar: 24, bars: 8, gain: 0.46, pan: -0.2 });
  drumPattern(hats, tl, kit, 'shaker', '--x---x---x---x-', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: -0.35 });
  // Arcade colour in the verses.
  drumPattern(arcade, tl, kit, 'blipHi', '------x---------|----------------', { ...d, startBar: 0, bars: 8, gain: 0.5, pan: 0.45 });
  drumPattern(arcade, tl, kit, 'blipLo', '----------------|----------x---x-', { ...d, startBar: 0, bars: 8, gain: 0.5, pan: -0.45 });
  drumPattern(arcade, tl, kit, 'blipHi', '------x-------x-|----------------', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: 0.45 });
  drumPattern(arcade, tl, kit, 'blipLo', '----------------|------x---x---x-', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: -0.45 });
  drumHits(arcade, tl, kit, [8, 16, 24, 0].map((bar) => ({ name: 'zap' as const, beat: bar * 4, level: 0.7, pan: bar % 16 ? 0.3 : -0.3 })), 0.7);
  // Tom fills on the last beats of every section.
  const fill = (bar: number) =>
    drumHits(
      arcade,
      tl,
      kit,
      (['tomHi', 'tomHi', 'tomMid', 'tomMid', 'tomLo', 'tomLo'] as const).map((name, i) => ({ name, beat: bar * 4 + 2.5 + i * 0.25, level: 0.6 + i * 0.07, pan: -0.4 + i * 0.16 })),
      0.75,
    );
  fill(7);
  fill(15);
  fill(23);
  fill(31);
  for (const bar of [7, 23, 31]) hats.add({ l: swell(rng, tl.seconds(4), { from: 1500, to: 9000 }) }, tl.sampleAt(bar * 4), 0.75, 0);
  void mtof;

  return song.mixdown({
    reverb: { t60: 1.6, damping: 6000, size: 0.95, preDelayMs: 10, lowCut: 300 },
    delay: { beats: 0.75, feedback: 0.34, damping: 3500, toReverb: 0.25 },
    targetLufs: -16,
    ceilingDb: -1.5,
    highShelfDb: 1,
  });
}
