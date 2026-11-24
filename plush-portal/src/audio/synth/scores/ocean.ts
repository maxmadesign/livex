/**
 * "Drift Glass" — Ocean Dream theme.
 * Slow, floating and cosy: glass-bowl melody, a marimba ostinato in 3-3-2, a
 * breathing soft-synth pad, sine sub, a dusty half-time beat, bubbles and surf.
 * D major, 84 BPM, 24 bars: A · B · A'.
 */
import { SR, makeRng, type Stem } from '../core';
import { DrumKit, KICKS, SNARES } from '../drums';
import { Biquad, filterCircular } from '../dsp';
import { MALLETS, SOFT_PLUCKS, mallet, sineGlide, softPluck, subBass } from '../instruments';
import { Song, type MixResult } from '../mix';
import { Timeline, memoRenderer, schedule, type NoteEvent } from '../seq';
import { arpEvents, chordSpans, degreeLine, drumHits, drumPattern, melodyAt, padSpans, type ScoreData } from './common';

const PROG_A = ['Dmaj9', 'Dmaj9', 'Bm9', 'Bm9', 'Gmaj7', 'Gmaj7', 'A69', 'A'] as const;
const PROG_B = ['Em9', 'Em9', 'F#m7', 'F#m7', 'Gmaj7', 'Gmaj7', 'Asus4', 'A'] as const;
const PROG_A2 = ['Dmaj9', 'Dmaj9', 'Bm9', 'Bm9', 'Gmaj7', 'Gmaj7', 'A69', 'A'] as const;

const MEL_A = [
  'f#5:2 a5:1 e6:1',
  'c#6:3! r:1',
  'd6:2 c#6:1 a5:1',
  'f#5:3 r:1',
  'b5:2 d6:1 f#6:1',
  'e6:2! d6:2',
  'c#6:2 b5:1 a5:1',
  'e5:3 r:1',
];
const MEL_B = [
  'g5:1.5 b5:0.5 d6:2',
  'f#6:2! e6:1 b5:1',
  'a5:1.5 c#6:0.5 e6:2',
  'c#6:3 r:1',
  'd6:1 b5:1 g5:1 b5:1',
  'd6:2 f#6:2!',
  'e6:2 d6:2',
  'c#6:3 r:1',
];
const MEL_A2 = [
  'f#5:1 a5:1 d6:1 e6:1',
  'c#6:2! a5:1 e6:1',
  'd6:1.5 c#6:0.5 a5:1 f#5:1',
  'b5:3 r:1',
  'b5:1 d6:1 g6:1! f#6:1',
  'e6:2 d6:1 b5:1',
  'a5:2 c#6:1 e6:1',
  'e5:3 r:1',
];

/** High celesta answers in the melody's rests. */
const ANSWERS: { bar: number; line: string }[] = [
  { bar: 1, line: 'r:2 e6:0.5 f#6:0.5 a6:1' },
  { bar: 3, line: 'r:2 c#6:0.5 d6:0.5 f#6:1' },
  { bar: 7, line: 'r:2 a5:0.5 c#6:0.5 e6:1' },
  { bar: 11, line: 'r:2 e6:0.5 f#6:0.5 a6:1' },
  { bar: 15, line: 'r:2 a5:0.5 c#6:0.5 e6:1' },
  { bar: 19, line: 'r:2 d6:0.5 f#6:0.5 b6:1' },
  { bar: 23, line: 'r:2 a5:0.5 c#6:0.5 e6:0.5 a6:0.5' },
];

export const oceanData: ScoreData = {
  meta: {
    id: 'ocean',
    title: 'Drift Glass',
    bpm: 84,
    beatsPerBar: 4,
    bars: 24,
    key: 'D major',
    feel: 'half-time, 3-3-2 ostinato',
    instruments: ['glass bowls', 'marimba', 'soft synth pad', 'celesta', 'mellow synth pluck', 'sine sub', 'lo-fi kick', 'rim', 'soft hats', 'bubbles', 'surf noise'],
    sections: [
      { name: 'A', bars: 8 },
      { name: 'B', bars: 8 },
      { name: "A'", bars: 8 },
    ],
  },
  progression: [...PROG_A, ...PROG_B, ...PROG_A2],
  melody: [...MEL_A, ...MEL_B, ...MEL_A2].join(' | '),
};

/** Slow surf: periodic low-passed noise that swells every eight bars. */
function addSurf(stem: Stem, tl: Timeline, seed: number): void {
  const n = tl.loopSamples;
  const period = tl.sampleAt(32);
  for (const [ch, s] of [
    [stem.l, seed],
    [stem.r, seed + 17],
  ] as const) {
    const rng = makeRng(s);
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
    filterCircular(noise, Biquad.lowpass(900, 0.6));
    filterCircular(noise, Biquad.highpass(180, 0.7));
    for (let i = 0; i < n; i++) {
      const phase = (i / period) * Math.PI * 2;
      // Asymmetric swell: slow rise, quicker fall, like a wave running up a beach.
      const env = Math.pow(0.5 - 0.5 * Math.cos(phase + 0.6 * Math.sin(phase)), 2.2);
      ch[i] = ch[i]! + noise[i]! * env;
    }
  }
}

export function renderOcean(): MixResult {
  const tl = new Timeline(84, 4, 24);
  const song = new Song(tl);
  const rng = makeRng(0x0cea);
  const kit = new DrumKit({ kick: KICKS.lofi, snare: SNARES.lofi, seed: 303 });

  const glass = song.stem('glass', { gain: 1.0, reverb: 0.5, delay: 0.3 });
  const marimba = song.stem('marimba', { gain: 0.6, reverb: 0.3, delay: 0.12, hp: 100 });
  const pad = song.stem('pad', { gain: 0.4, reverb: 0.4, hp: 150, lp: 5200, chorus: { rateHz: 0.22, depthMs: 3.5, baseMs: 16, mix: 0.45 } });
  const sub = song.stem('sub', { gain: 0.4, hp: 32 });
  const kickStem = song.stem('kick', { gain: 0.42 });
  const drums = song.stem('drums', { gain: 0.95, reverb: 0.22, hp: 300 });
  const bell = song.stem('bell', { gain: 0.46, reverb: 0.55, delay: 0.36 });
  const fx = song.stem('fx', { gain: 0.45, reverb: 0.6, delay: 0.3, hp: 160 });
  const surf = song.stem('surf', { gain: 0.085, reverb: 0.3 });

  const spansA = chordSpans(PROG_A, 4, 0);
  const spansB = chordSpans(PROG_B, 4, 8);
  const spansA2 = chordSpans(PROG_A2, 4, 16);
  const all = [...spansA, ...spansB, ...spansA2];

  /* -------------------------------------------------------------- melody */
  const glassR = memoRenderer((f, _d, v) => mallet(MALLETS.glass, f, v, rng));
  const softBellR = memoRenderer((f, _d, v) => mallet(MALLETS.softBell, f, v, rng));
  const celR = memoRenderer((f, _d, v) => mallet(MALLETS.celesta, f, v, rng));
  const mel: [string[], number, number][] = [
    [MEL_A, 0, 0.66],
    [MEL_B, 8, 0.72],
    [MEL_A2, 16, 0.78],
  ];
  for (const [bars, startBar, vel] of mel) {
    const notes = melodyAt(bars.join(' | '), tl, startBar, vel);
    schedule(glass, tl, notes, glassR, { rng, humanizeMs: 9, velJitter: 0.05, pan: (ev) => (ev.midi - 81) / 40 });
    // The last section is doubled an octave lower by a soft bell for body.
    if (startBar === 16) schedule(glass, tl, notes, softBellR, { rng, humanizeMs: 10, transpose: -12, gain: 0.5, pan: -0.2 });
  }
  for (const a of ANSWERS) {
    schedule(bell, tl, melodyAt(a.line, tl, a.bar, 0.5), celR, { rng, humanizeMs: 8, pan: 0.4 });
  }
  // A mellow pluck echoes the first note of each melody phrase, low and wide.
  const mellow = memoRenderer((f, d, v) => softPluck(SOFT_PLUCKS.mellow, f, d, v));
  const echoes: NoteEvent[] = [];
  for (const [bars, startBar] of mel) {
    melodyAt(bars.join(' | '), tl, startBar, 0.4)
      .filter((n) => n.beat % 8 === 0)
      .forEach((n) => echoes.push({ ...n, beat: n.beat + 2.5, dur: 1, midi: n.midi - 12 }));
  }
  schedule(bell, tl, echoes, mellow, { rng, humanizeMs: 8, pan: -0.45, gain: 0.9 });

  /* --------------------------------------------------- marimba and pad */
  const marR = memoRenderer((f, _d, v) => mallet(MALLETS.marimba, f, v, rng));
  const ost = { stepBeats: 0.5, shape: [0, 2, 3, 1, 2, 3, 4, 3], lo: 50, hi: 67, count: 4, durBeats: 0.5 };
  const panAlt = (_ev: NoteEvent, i: number) => (i % 2 ? 0.28 : -0.28);
  schedule(marimba, tl, arpEvents(spansA, { ...ost, vel: 0.5, pattern: 'XooXooXo' }), marR, { rng, humanizeMs: 7, velJitter: 0.06, pan: panAlt });
  schedule(marimba, tl, arpEvents(spansB, { ...ost, vel: 0.46, pattern: 'X-oX-oX-' }), marR, { rng, humanizeMs: 7, velJitter: 0.06, pan: panAlt });
  schedule(marimba, tl, arpEvents(spansA2, { ...ost, vel: 0.56, pattern: 'XooXooXo' }), marR, { rng, humanizeMs: 7, velJitter: 0.06, pan: panAlt });
  // In the last section the accents ring an octave up as well.
  schedule(marimba, tl, arpEvents(spansA2, { ...ost, vel: 0.34, pattern: 'X--X--X-' }), marR, { rng, humanizeMs: 7, transpose: 12, pan: (ev, i) => -panAlt(ev, i) });

  const padOpts = { voices: 3, detuneCents: 12, cutoff: 1250, q: 0.6, lfoDepth: 0.36, lfoHz: 0.07, attack: 1.1, release: 1.6, soft: 0.6 };
  padSpans(pad, tl, all, { lo: 57, hi: 76, count: 4, vel: 0.7, gain: 1, pad: padOpts, rng, overlapBeats: 0.5 });

  /* ---------------------------------------------------------------- bass */
  const subR = memoRenderer((f, d, v) => subBass(f, d, v, { harm2: 0.3, harm3: 0.12, drive: 1.2, attack: 0.02, release: 0.12, sag: 2.5 }));
  schedule(sub, tl, degreeLine(all, ['1:3 r:0.5 1:0.5', '1:2.5 r:0.5 5:1'], { lo: 38, beatsPerBar: 4, startBar: 0, bars: 24, vel: 0.7 }), subR, { rng, gate: 0.95 });

  /* --------------------------------------------------------------- drums */
  const d = { stepBeats: 0.25, rng, humanizeMs: 5, levelJitter: 0.1, swing: 0.4, swingDivision: 0.5 };
  drumPattern(kickStem, tl, kit, 'kick', 'x-----x---x-----', { ...d, startBar: 0, bars: 8, gain: 0.85 });
  drumPattern(kickStem, tl, kit, 'kick', 'x---------x-----', { ...d, startBar: 8, bars: 8, gain: 0.8 });
  drumPattern(kickStem, tl, kit, 'kick', 'x-----x---x--x--', { ...d, startBar: 16, bars: 8, gain: 0.9 });
  drumPattern(drums, tl, kit, 'rim', '----x-------x---', { ...d, startBar: 0, bars: 24, gain: 0.6, pan: 0.12 });
  drumPattern(drums, tl, kit, 'snare', '------------x---', { ...d, startBar: 16, bars: 8, gain: 0.3, pan: -0.05 });
  drumPattern(drums, tl, kit, 'hat', 'x-xox-x-x-xox-xo', { ...d, startBar: 0, bars: 24, gain: 0.4, pan: -0.3 });
  drumPattern(drums, tl, kit, 'shaker', '--x---x---x---x-', { ...d, startBar: 8, bars: 16, gain: 0.45, pan: 0.35 });
  for (const bar of [0, 8, 16]) drumHits(drums, tl, kit, [{ name: 'triangle', beat: bar * 4, pan: 0.4 }], 0.55);
  drumHits(drums, tl, kit, [{ name: 'tomMid', beat: 7 * 4 + 3.5, level: 0.5 }, { name: 'tomLo', beat: 15 * 4 + 3, level: 0.5 }, { name: 'tomMid', beat: 15 * 4 + 3.5, level: 0.6 }, { name: 'tomLo', beat: 23 * 4 + 3.5, level: 0.5 }], 0.5);

  /* ------------------------------------------------------------------ fx */
  // Bubbles: short upward blips scattered through the loop.
  const bubbleBeats = [5.5, 13.25, 22.75, 30.5, 37.25, 44.75, 53.5, 60.25, 69.75, 78.5, 86.25, 93.5];
  for (const beat of bubbleBeats) {
    const count = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      const f0 = 520 + rng() * 620;
      const blip = sineGlide(f0, f0 * (1.7 + rng() * 0.6), 0.09 + rng() * 0.07, { glideTau: 0.05, ampTau: 0.04, attackMs: 6 });
      fx.add({ l: blip }, tl.sampleAt(beat) + k * (0.07 + rng() * 0.05) * SR, 0.5 - k * 0.1, rng() * 1.4 - 0.7);
    }
  }
  addSurf(surf, tl, 4242);

  return song.mixdown({
    reverb: { t60: 2.8, damping: 3800, size: 1.25, preDelayMs: 25, lowCut: 240 },
    delay: { beats: 1.5, feedback: 0.38, damping: 2400, toReverb: 0.5 },
    targetLufs: -16,
    ceilingDb: -1.5,
    highShelfDb: 2,
  });
}
