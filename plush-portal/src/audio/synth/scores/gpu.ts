/**
 * "Overclock Party" — GPU Party theme.
 * Cute, energetic chiptune-meets-synthwave: a narrow square-wave chip lead, 16th-note chip
 * arpeggios, an octave-bouncing bass, a glassy supersaw pad that pumps with the kick, FM
 * sparkle keys in the bridge, electro kick with a gated snare and clap, data blips and risers.
 * E major / C♯ minor, 120 BPM, 32 bars: verse · chorus · bridge · chorus'.
 */
import { makeRng } from '../core';
import { DrumKit, KICKS, swell, type SnareOptions } from '../drums';
import { fmBell, padChord, softPluck, synthBass, synthLead, type SoftPluckOptions } from '../instruments';
import { Song, type MixResult } from '../mix';
import { Timeline, memoRenderer, parseLine, pcAbove, schedule, type NoteEvent } from '../seq';
import { arpEvents, chordSpans, degreeLine, drumHits, drumPattern, melodyAt, padSpans, stabEvents, type ScoreData } from './common';

const PROG_V = ['E', 'B', 'C#m', 'A', 'E', 'B', 'A', 'B'] as const;
const PROG_C1 = ['A', 'B', 'G#m', 'C#m', 'A', 'B', 'E', 'E'] as const;
const PROG_BR = ['C#m', 'A', 'E', 'B', 'C#m', 'A', 'F#m', 'B'] as const;
const PROG_C2 = ['A', 'B', 'G#m', 'C#m', 'A', 'B', 'E', 'B'] as const;

const MEL_V = [
  'e5:0.5 g#5:0.5 b5:0.5 g#5:0.5 e6:1! b5:1',
  'f#5:0.5 d#5:0.5 b4:0.5 d#5:0.5 f#5:1! d#6:1',
  'e5:0.5 g#5:0.5 c#6:0.5 g#5:0.5 e6:1! c#6:1',
  'c#6:1 b5:0.5 a5:0.5 e5:2',
  'e5:0.5 g#5:0.5 b5:0.5 g#5:0.5 e6:1! f#6:0.5 e6:0.5',
  'd#6:1! b5:0.5 f#5:0.5 b5:1.5 r:0.5',
  'c#6:0.5 b5:0.5 a5:0.5 b5:0.5 c#6:1! e6:1',
  'd#6:1 f#6:1 b5:1.5! r:0.5',
];
const MEL_C1 = [
  'e6:1! c#6:0.5 e6:0.5 a6:1 e6:1',
  'f#6:1! d#6:0.5 f#6:0.5 b6:1 f#6:1',
  'd#6:1.5! b5:0.5 g#5:1 b5:1',
  'c#6:1 e6:1 g#6:1.5! r:0.5',
  'e6:1! c#6:0.5 e6:0.5 a6:1 c#7:1',
  'b6:1! a6:0.5 f#6:0.5 d#6:1 f#6:1',
  'g#6:1.5! e6:0.5 b5:1 e6:1',
  'e6:2 r:1 b5:0.5 d#6:0.5',
];
const MEL_BR = [
  'c#5:0.75 e5:0.75 g#5:0.5 c#6:1! b5:0.5 g#5:0.5',
  'a5:0.75 c#6:0.75 e6:0.5 a5:2',
  'g#5:0.75 b5:0.75 e6:0.5 g#6:1! f#6:0.5 e6:0.5',
  'f#6:1.5 d#6:0.5 b5:1 f#5:1',
  'c#5:0.75 e5:0.75 g#5:0.5 c#6:1! d#6:0.5 e6:0.5',
  'e6:0.75 c#6:0.75 a5:0.5 c#6:2',
  'f#5:0.75 a5:0.75 c#6:0.5 f#6:1! e6:0.5 c#6:0.5',
  'd#6:1 f#6:1 b6:1.5! r:0.5',
];
const MEL_C2 = [
  'e6:1! c#6:0.5 e6:0.5 a6:1 e6:1',
  'f#6:1! d#6:0.5 f#6:0.5 b6:1 f#6:1',
  'd#6:1.5! b5:0.5 g#5:1 b5:1',
  'c#6:1 e6:1 g#6:1.5! r:0.5',
  'e6:1! c#6:0.5 e6:0.5 a6:1 c#7:1',
  'b6:1! a6:0.5 f#6:0.5 d#6:1 f#6:1',
  'g#6:1! e6:1 b6:1.5! r:0.5',
  'f#6:1 d#6:1 b5:1 r:1',
];

/** Narrow-pulse chip arpeggio: bright attack, quick decay, almost no triangle. */
const CHIP_ARP: SoftPluckOptions = { duty: 0.125, tri: 0.05, cutoffStart: 7600, cutoffEnd: 1500, filterTau: 0.045, ampTau: 0.12, q: 0.9, release: 0.03 };
/** Snappier, brighter snare for the gated-reverb backbeat. */
const GATED_SNARE: SnareOptions = { tone: 225, toneAmt: 0.32, noiseLo: 2000, noiseHi: 9500, ampTau: 0.075 };

export const gpuData: ScoreData = {
  meta: {
    id: 'gpu',
    title: 'Overclock Party',
    bpm: 120,
    beatsPerBar: 4,
    bars: 32,
    key: 'E major / C# minor',
    feel: 'driving eighths, 16th chip arpeggios, side-chain pumped supersaw',
    instruments: [
      'square-wave chip lead',
      'chiptune 16th arpeggio',
      'glassy supersaw pad',
      'octave-bounce bass',
      'FM sparkle keys',
      'electro kick',
      'gated snare and clap',
      'noise hi-hats',
      'data blips and risers',
    ],
    sections: [
      { name: 'verse', bars: 8 },
      { name: 'chorus', bars: 8 },
      { name: 'bridge', bars: 8 },
      { name: "chorus'", bars: 8 },
    ],
  },
  progression: [...PROG_V, ...PROG_C1, ...PROG_BR, ...PROG_C2],
  melody: [...MEL_V, ...MEL_C1, ...MEL_BR, ...MEL_C2].join(' | '),
};

export function renderGpu(): MixResult {
  const tl = new Timeline(120, 4, 32);
  const song = new Song(tl);
  const rng = makeRng(0x69d);
  const kit = new DrumKit({ kick: KICKS.pop, snare: GATED_SNARE, seed: 2077 });

  const lead = song.stem('lead', { gain: 0.58, reverb: 0.2, delay: 0.26, hp: 240 });
  const arp = song.stem('arp', { gain: 0.85, reverb: 0.14, delay: 0.3, hp: 320, pump: 0.3 });
  const pad = song.stem('pad', { gain: 0.4, reverb: 0.32, hp: 210, lp: 8500, pump: 0.6, chorus: { rateHz: 0.35, depthMs: 2.6, baseMs: 14, mix: 0.45 } });
  const stabs = song.stem('stabs', { gain: 0.42, reverb: 0.22, hp: 260, pump: 0.35 });
  const bass = song.stem('bass', { gain: 0.92, hp: 34, pump: 0.4 });
  const kickStem = song.stem('kick', { gain: 0.52 });
  const snareStem = song.stem('snare', { gain: 1.25, reverb: 0.32, hp: 160 });
  const hats = song.stem('hats', { gain: 0.8, hp: 5200, reverb: 0.05 });
  const keys = song.stem('keys', { gain: 0.42, reverb: 0.45, delay: 0.35 });
  const fx = song.stem('fx', { gain: 0.5, reverb: 0.3, delay: 0.2 });

  song.pumpBeats = Array.from({ length: tl.totalBeats }, (_, i) => i);
  song.pumpTau = 0.12;

  const spansV = chordSpans(PROG_V, 4, 0);
  const spansC1 = chordSpans(PROG_C1, 4, 8);
  const spansBr = chordSpans(PROG_BR, 4, 16);
  const spansC2 = chordSpans(PROG_C2, 4, 24);
  const all = [...spansV, ...spansC1, ...spansBr, ...spansC2];

  /* ---------------------------------------------------------------- lead */
  const chipLead = memoRenderer((f, d, v) => synthLead(f, d, v, { duty: 0.125, detuneCents: 2, cutoff: 4200, vibDepth: 0.006, attack: 0.003, release: 0.06 }));
  const softLead = memoRenderer((f, d, v) => synthLead(f, d, v, { duty: 0.25, detuneCents: 9, cutoff: 3000, vibDepth: 0.004 }));
  schedule(lead, tl, melodyAt(MEL_V.join(' | '), tl, 0, 0.6), chipLead, { rng, gate: 0.7, humanizeMs: 2, velJitter: 0.03, pan: 0.05 });
  schedule(lead, tl, melodyAt(MEL_BR.join(' | '), tl, 16, 0.62), chipLead, { rng, gate: 0.6, humanizeMs: 2, velJitter: 0.03, pan: -0.08 });
  for (const [mel, bar] of [
    [MEL_C1, 8],
    [MEL_C2, 24],
  ] as const) {
    const notes = melodyAt(mel.join(' | '), tl, bar, 0.8);
    schedule(lead, tl, notes, chipLead, { rng, gate: 0.82, humanizeMs: 2, velJitter: 0.03 });
    // A softer pulse an octave below thickens the chorus hook.
    schedule(lead, tl, notes, softLead, { rng, gate: 0.85, humanizeMs: 3, transpose: -12, gain: 0.45, pan: -0.2 });
  }

  /* ----------------------------------------------------------------- arp */
  const arpR = memoRenderer((f, d, v) => softPluck(CHIP_ARP, f, d, v));
  const arpOpts = { stepBeats: 0.25, lo: 64, hi: 84, count: 3, durBeats: 0.18 };
  const arpPan = (_ev: NoteEvent, i: number) => (i % 2 ? 0.4 : -0.4);
  schedule(arp, tl, arpEvents(spansV, { ...arpOpts, shape: [0, 1, 2, 3], vel: 0.5, pattern: 'x-xxx-xxx-xxx-x-' }), arpR, { rng, velJitter: 0.04, pan: arpPan });
  schedule(arp, tl, arpEvents(spansC1, { ...arpOpts, shape: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.56, pattern: 'XxxxXxxxXxxxXxxx' }), arpR, { rng, velJitter: 0.04, pan: arpPan });
  schedule(arp, tl, arpEvents(spansBr, { ...arpOpts, lo: 68, hi: 88, shape: [0, 2, 1, 3, 2, 4], vel: 0.48, pattern: 'x-x-x-x-x-x-x-xx' }), arpR, { rng, velJitter: 0.04, pan: arpPan });
  schedule(arp, tl, arpEvents(spansC2, { ...arpOpts, shape: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.6, pattern: 'XxxxXxxxXxxxXxxx' }), arpR, { rng, velJitter: 0.04, pan: arpPan });

  /* ------------------------------------------------------- pad and stabs */
  const padBase = { voices: 6, detuneCents: 22, q: 0.6, lfoDepth: 0.12, lfoHz: 0.25, attack: 0.03, release: 0.3, soft: 0.1 };
  for (const [spans, cutoff, vel] of [
    [spansV, 1800, 0.45],
    [spansC1, 3600, 0.72],
    [spansBr, 2400, 0.6],
    [spansC2, 3900, 0.78],
  ] as const) {
    padSpans(pad, tl, [...spans], { lo: 56, hi: 76, count: 4, vel, gain: 1, pad: { ...padBase, cutoff }, rng });
  }
  // Off-beat supersaw stabs in the choruses.
  const stabR = memoRenderer((f, d, v) => padChord([f], d, v, { voices: 5, detuneCents: 18, cutoff: 5200, q: 0.7, lfoDepth: 0, lfoHz: 0.1, attack: 0.004, release: 0.08, soft: 0 }, makeRng(Math.round(f))).l);
  for (const [spans, bar] of [
    [spansC1, 8],
    [spansC2, 24],
  ] as const) {
    schedule(stabs, tl, stabEvents(spans, '--x---x---x---x-', { stepBeats: 0.25, lo: 64, hi: 80, count: 3, vel: 0.62, durBeats: 0.22, beatsPerBar: 4, startBar: bar, bars: 8 }), stabR, { rng, pan: (_e, i) => (i % 3 === 0 ? -0.3 : i % 3 === 1 ? 0.3 : 0) });
  }

  /* ---------------------------------------------------------------- bass */
  const bassR = memoRenderer((f, d, v) => synthBass(f, d, v, { cutoffStart: 2200, cutoffEnd: 300, filterTau: 0.08, q: 1.2 }));
  const bounce = '1:0.5 8:0.5 1:0.5 8:0.5 1:0.5 8:0.5 1:0.5 8:0.5';
  const drive = '1:0.5! 1:0.5 8:0.5 1:0.5 1:0.5! 1:0.5 5:0.5 8:0.5';
  const bridge = '1:1.5 1:0.5 8:0.5 1:0.5 5:0.5 a:0.5';
  const b = { lo: 40, beatsPerBar: 4 };
  const bassEvents: NoteEvent[] = [
    ...degreeLine(all, bounce, { ...b, startBar: 0, bars: 8, vel: 0.7 }),
    ...degreeLine(all, drive, { ...b, startBar: 8, bars: 8, vel: 0.8 }),
    ...degreeLine(all, bridge, { ...b, startBar: 16, bars: 8, vel: 0.74 }),
    ...degreeLine(all, drive, { ...b, startBar: 24, bars: 8, vel: 0.84 }),
  ];
  schedule(bass, tl, bassEvents, bassR, { rng, gate: 0.72 });

  /* ---------------------------------------------------------------- keys */
  const keyR = memoRenderer((f, _d, v) => fmBell(f, v, { ratio: 2, index: 1.4, decay: 0.7 }));
  const keyNotes: NoteEvent[] = [];
  for (const s of spansBr) {
    const root = pcAbove(s.chord.root, 76);
    const third = pcAbove((s.chord.root + s.chord.intervals[1]!) % 12, root + 1);
    const fifth = pcAbove((s.chord.root + 7) % 12, third + 1);
    [root, third, fifth, third + 12].forEach((midi, i) => keyNotes.push({ beat: s.beat + 0.5 + i * 0.75, dur: 0.5, midi, vel: 0.5 + i * 0.04 }));
  }
  schedule(keys, tl, keyNotes, keyR, { rng, pan: (_e, i) => (i % 2 ? 0.45 : -0.45) });
  // Chorus downbeat sparkles.
  const sparkle: NoteEvent[] = [];
  for (const spans of [spansC1, spansC2]) {
    for (const s of spans) {
      if (s.beat % 8 !== 0) continue;
      sparkle.push({ beat: s.beat, dur: 1, midi: pcAbove(s.chord.root, 84), vel: 0.5 });
    }
  }
  schedule(keys, tl, sparkle, keyR, { rng, pan: 0.2 });

  /* --------------------------------------------------------------- drums */
  const d = { stepBeats: 0.25, rng, humanizeMs: 1.2, levelJitter: 0.05 };
  drumPattern(kickStem, tl, kit, 'kick', 'x---x---x---x---', { ...d, startBar: 0, bars: 16, gain: 0.9, humanizeMs: 0 });
  // The bridge drops to a half-time kick with a syncopated push.
  drumPattern(kickStem, tl, kit, 'kick', 'x-------x-x-----', { ...d, startBar: 16, bars: 8, gain: 0.88, humanizeMs: 0 });
  drumPattern(kickStem, tl, kit, 'kick', 'x---x---x---x---', { ...d, startBar: 24, bars: 8, gain: 0.92, humanizeMs: 0 });
  drumPattern(snareStem, tl, kit, 'snare', '----x-------x---', { ...d, startBar: 0, bars: 16, gain: 0.78 });
  drumPattern(snareStem, tl, kit, 'snare', '------------x---', { ...d, startBar: 16, bars: 8, gain: 0.8 });
  drumPattern(snareStem, tl, kit, 'snare', '----x-------x---', { ...d, startBar: 24, bars: 8, gain: 0.82 });
  drumPattern(snareStem, tl, kit, 'clap', '----x-------x---', { ...d, startBar: 8, bars: 8, gain: 0.6, pan: -0.12 });
  drumPattern(snareStem, tl, kit, 'clap', '----x-------x-x-', { ...d, startBar: 24, bars: 8, gain: 0.64, pan: -0.12 });
  drumPattern(hats, tl, kit, 'hat', 'x-x-x-x-x-x-x-x-', { ...d, startBar: 0, bars: 8, gain: 0.62, pan: 0.25 });
  drumPattern(hats, tl, kit, 'hat', 'xxoxxxoxxxoxxxox', { ...d, startBar: 8, bars: 8, gain: 0.66, pan: 0.25 });
  drumPattern(hats, tl, kit, 'shaker', 'x-xxx-xxx-xxx-xx', { ...d, startBar: 16, bars: 8, gain: 0.5, pan: -0.3 });
  drumPattern(hats, tl, kit, 'hat', 'xxoxxxoxxxoxxxox', { ...d, startBar: 24, bars: 8, gain: 0.7, pan: 0.25 });
  drumPattern(hats, tl, kit, 'openHat', '--x---x---x---x-', { ...d, startBar: 8, bars: 8, gain: 0.38, pan: -0.25 });
  drumPattern(hats, tl, kit, 'openHat', '--x---x---x---x-', { ...d, startBar: 24, bars: 8, gain: 0.42, pan: -0.25 });
  // Data blips answering the lead in the verse and bridge.
  drumPattern(fx, tl, kit, 'blipHi', '--------------x-|------------x-x-', { ...d, startBar: 0, bars: 8, gain: 0.45, pan: 0.5 });
  drumPattern(fx, tl, kit, 'blipLo', '----------x-----|----------------', { ...d, startBar: 16, bars: 8, gain: 0.45, pan: -0.5 });
  // Snare rolls into each new section.
  const roll = (bar: number) =>
    drumHits(
      snareStem,
      tl,
      kit,
      Array.from({ length: 8 }, (_, i) => ({ name: 'snare' as const, beat: bar * 4 + 2 + i * 0.25, level: 0.35 + i * 0.08, pan: -0.2 + i * 0.05 })),
      0.8,
    );
  roll(7);
  roll(15);
  roll(23);
  roll(31);
  // Risers into the choruses and back to the top.
  for (const bar of [7, 23, 31]) fx.add({ l: swell(rng, tl.seconds(4), { from: 900, to: 10000 }) }, tl.sampleAt(bar * 4), 0.7, 0);
  // A rising "boot" sweep of chip notes into the bridge.
  const boot = parseLine('r:2 e6:0.25 g#6:0.25 b6:0.25 e7:0.25 b6:0.25 e7:0.25 g#7:0.25 b7:0.25', 0.4).notes.map((n, i) => ({ ...n, beat: n.beat + 15 * 4, vel: 0.3 + i * 0.04 }));
  schedule(fx, tl, boot, arpR, { rng, pan: (_e, i) => -0.5 + i * 0.14 });

  return song.mixdown({
    reverb: { t60: 1.3, damping: 6500, size: 0.9, preDelayMs: 12, lowCut: 320 },
    delay: { beats: 0.75, feedback: 0.3, damping: 4000, toReverb: 0.2 },
    targetLufs: -16,
    ceilingDb: -1.5,
    highShelfDb: 0.5,
  });
}
