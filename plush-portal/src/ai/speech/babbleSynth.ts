/**
 * "Babble": Momo's built-in mascot voice. One short, pitched, vowel-like blip
 * per syllable, driven by the characters of the line, in the tradition of
 * game mascots that speak in cute nonsense. It is language independent, needs
 * no assets and no network, so it is the voice that can never be missing.
 *
 * Pure DSP (additive formant synthesis into a Float32Array): deterministic,
 * unit-testable in Node, and the browser only has to wrap the samples in an
 * AudioBuffer.
 */
import type { GuideEmotion } from '../../core/contracts';
import type { Lang } from '../../core/types';

export interface BabbleSyllable {
  /** Seconds from the start of the utterance. */
  start: number;
  duration: number;
  /** Fundamental frequency in Hz. */
  pitch: number;
  /** 0..4 = a, i, u, e, o */
  vowel: number;
  gain: number;
  /** Soft consonant-like noise burst at the onset. */
  burst: boolean;
}

export interface BabblePlan {
  syllables: BabbleSyllable[];
  /** Total length in seconds, including trailing pause. */
  duration: number;
}

export interface BabbleOptions {
  emotion: GuideEmotion;
  /** 0.7–1.3 */
  speed: number;
}

const BASE_PITCH: Record<GuideEmotion, number> = { happy: 560, cheer: 615, think: 500, oops: 462, calm: 520 };
const PACE: Record<GuideEmotion, number> = { happy: 1, cheer: 1.1, think: 0.9, oops: 0.92, calm: 0.95 };
/** Formant centre frequencies of a small, bright "child-like" vocal tract. */
const FORMANTS: readonly (readonly [number, number, number])[] = [
  [1000, 1500, 2950], // a
  [370, 2750, 3350], // i
  [420, 1150, 2700], // u
  [620, 2250, 3050], // e
  [560, 980, 2800], // o
];
const FORMANT_GAIN = [1, 0.72, 0.34] as const;
const FORMANT_WIDTH = [170, 240, 320] as const;
const PITCH_STEPS = [-2, 0, 0, 2, 3, 5, 0, -3] as const;
const MAX_SYLLABLES = 64;

const LATIN_VOWEL = /[aeiouy]/i;
const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー';

function isCjk(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) || // hiragana + katakana
    (code >= 0x3400 && code <= 0x9fff) || // CJK unified ideographs (+ext A)
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff66 && code <= 0xff9d) // half-width katakana
  );
}

function vowelOfLatin(ch: string): number {
  switch (ch.toLowerCase()) {
    case 'a':
      return 0;
    case 'i':
    case 'y':
      return 1;
    case 'u':
      return 2;
    case 'e':
      return 3;
    default:
      return 4;
  }
}

const semitones = (st: number) => Math.pow(2, st / 12);

/** Splits a line into timed syllables with a pitch contour. */
export function planBabble(text: string, _lang: Lang, options: BabbleOptions): BabblePlan {
  const speed = Math.min(1.6, Math.max(0.5, options.speed)) * PACE[options.emotion];
  const base = BASE_PITCH[options.emotion];
  const cjkDur = 0.108 / speed;
  const latinDur = 0.084 / speed;
  const gap = 0.016 / speed;

  interface Draft {
    duration: number;
    vowel: number;
    code: number;
    burst: boolean;
    lift: number; // extra semitones (question / exclamation shaping)
    gain: number;
  }
  const drafts: (Draft | { pause: number })[] = [];
  const voiced = () => drafts.filter((d): d is Draft => 'duration' in d);
  const lastVoiced = (n: number): Draft[] => voiced().slice(-n);

  const chars = [...text];
  let i = 0;
  while (i < chars.length && voiced().length < MAX_SYLLABLES) {
    const ch = chars[i]!;
    const code = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) {
      drafts.push({ pause: 0.03 / speed });
      i++;
    } else if (/[,，、;；:：]/.test(ch)) {
      drafts.push({ pause: 0.11 / speed });
      i++;
    } else if (/[?？]/.test(ch)) {
      const tail = lastVoiced(2);
      if (tail[0]) tail[0].lift += tail.length > 1 ? 3 : 6;
      if (tail[1]) tail[1].lift += 6;
      drafts.push({ pause: 0.2 / speed });
      i++;
    } else if (/[!！]/.test(ch)) {
      const tail = lastVoiced(1);
      if (tail[0]) {
        tail[0].lift += 4;
        tail[0].gain = 1.15;
      }
      drafts.push({ pause: 0.17 / speed });
      i++;
    } else if (/[.。…~～]/.test(ch)) {
      drafts.push({ pause: 0.19 / speed });
      i++;
    } else if (SMALL_KANA.includes(ch)) {
      // Small kana and the long-vowel mark stretch the previous syllable.
      const tail = lastVoiced(1);
      if (tail[0]) tail[0].duration *= 1.5;
      i++;
    } else if (isCjk(code)) {
      drafts.push({ duration: cjkDur, vowel: code % 5, code, burst: code % 3 !== 0, lift: 0, gain: 1 });
      i++;
    } else if (/[A-Za-z]/.test(ch)) {
      // One syllable per vowel group of the word.
      let word = '';
      while (i < chars.length && /[A-Za-z'’]/.test(chars[i]!)) word += chars[i++]!;
      const groups = word.match(/[aeiouy]+/gi) ?? [word];
      // Silent final "e" ("there", "ride") is not its own syllable.
      const count = Math.min(5, Math.max(1, groups.length - (groups.length > 1 && /[^aeiouy]e$/i.test(word) ? 1 : 0)));
      for (let s = 0; s < count && voiced().length < MAX_SYLLABLES; s++) {
        const group = groups[s] ?? word;
        const first = [...group].find((c) => LATIN_VOWEL.test(c)) ?? 'a';
        const seed = word.charCodeAt(Math.min(word.length - 1, s * 2)) + s * 7;
        drafts.push({ duration: latinDur, vowel: vowelOfLatin(first), code: seed, burst: seed % 2 === 0, lift: 0, gain: 1 });
      }
    } else if (/[0-9０-９]/.test(ch)) {
      drafts.push({ duration: cjkDur, vowel: code % 5, code, burst: true, lift: 0, gain: 1 });
      i++;
    } else {
      i++; // quotes, brackets, emoji: silent
    }
  }

  const total = voiced().length;
  const syllables: BabbleSyllable[] = [];
  let t = 0.02;
  let index = 0;
  for (const d of drafts) {
    if ('pause' in d) {
      t += d.pause;
      continue;
    }
    // Gentle declination across the line plus a per-character melodic step.
    const progress = total > 1 ? index / (total - 1) : 0;
    const contour = 1.6 - 3.2 * progress;
    const step = PITCH_STEPS[d.code % PITCH_STEPS.length]!;
    syllables.push({
      start: t,
      duration: d.duration,
      pitch: base * semitones(contour + step * 0.6 + d.lift),
      vowel: d.vowel,
      gain: d.gain,
      burst: d.burst,
    });
    t += d.duration + gap;
    index++;
  }
  return { syllables, duration: t + 0.06 };
}

/** Renders a plan to mono samples in [-1, 1]. */
export function renderBabble(plan: BabblePlan, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(plan.duration * sampleRate)));
  const nyquistGuard = Math.min(5200, sampleRate * 0.45);
  for (const syl of plan.syllables) {
    const n = Math.max(8, Math.floor(syl.duration * sampleRate));
    const offset = Math.floor(syl.start * sampleRate);
    const formants = FORMANTS[syl.vowel % FORMANTS.length]!;
    const harmonics = Math.max(1, Math.min(14, Math.floor(nyquistGuard / syl.pitch)));
    // Harmonic amplitudes follow the formant envelope of the vowel.
    const amps = new Float32Array(harmonics);
    let sum = 0;
    for (let k = 1; k <= harmonics; k++) {
      const f = k * syl.pitch;
      let a = 0.03;
      for (let j = 0; j < 3; j++) {
        const x = (f - formants[j]!) / FORMANT_WIDTH[j]!;
        a += FORMANT_GAIN[j]! * Math.exp(-x * x);
      }
      a /= Math.pow(k, 0.85);
      amps[k - 1] = a;
      sum += a;
    }
    for (let k = 0; k < harmonics; k++) amps[k]! /= sum || 1;

    const attack = Math.min(n * 0.3, 0.009 * sampleRate);
    const release = Math.min(n * 0.45, 0.032 * sampleRate);
    let phase = 0;
    let noiseSeed = (Math.floor(syl.pitch * 13) ^ (offset * 2654435761)) >>> 0;
    const burstLen = Math.floor(0.008 * sampleRate);
    for (let s = 0; s < n; s++) {
      const u = s / n;
      // Small rise-fall glide inside each syllable keeps it lively.
      const glide = 0.97 + 0.07 * Math.sin(Math.PI * Math.min(1, u * 1.35));
      phase += (2 * Math.PI * syl.pitch * glide) / sampleRate;
      let v = 0;
      for (let k = 0; k < harmonics; k++) v += amps[k]! * Math.sin((k + 1) * phase);
      let env = 1;
      if (s < attack) env = 0.5 - 0.5 * Math.cos((Math.PI * s) / attack);
      const tail = n - s;
      if (tail < release) env *= 0.5 - 0.5 * Math.cos((Math.PI * tail) / release);
      env *= 0.82 + 0.18 * Math.exp(-s / (0.05 * sampleRate));
      let sample = v * env;
      if (syl.burst && s < burstLen) {
        noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
        const noise = noiseSeed / 2147483648 - 1;
        sample += noise * 0.16 * (1 - s / burstLen);
      }
      const idx = offset + s;
      if (idx < out.length) out[idx]! += sample * syl.gain * 0.6;
    }
  }
  // Normalise so every line has a similar level without clipping.
  let peak = 0;
  for (let s = 0; s < out.length; s++) {
    const a = Math.abs(out[s]!);
    if (a > peak) peak = a;
  }
  if (peak > 1e-6) {
    const scale = 0.82 / peak;
    for (let s = 0; s < out.length; s++) out[s]! *= scale;
  }
  return out;
}

/** Convenience: plan + render. */
export function synthesizeBabble(text: string, lang: Lang, options: BabbleOptions, sampleRate = 24000): Float32Array {
  return renderBabble(planBabble(text, lang, options), sampleRate);
}
