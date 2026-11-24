/**
 * Length rules for Momo's lines, shared by the browser (local line tests,
 * display timing) and the server (enforcing limits on model output).
 *
 * English is measured in words; Chinese and Japanese in characters, ignoring
 * whitespace and punctuation. Runs of ASCII letters/digits inside CJK text
 * (toy names, "Momo") count as roughly one unit per three characters.
 */
import type { Lang } from '../core/types';
import type { LineLength } from './protocol';

export interface LengthRule {
  /** Range we ask the model for and write local lines in. */
  targetMin: number;
  targetMax: number;
  /** Anything longer is trimmed to whole sentences or rejected. */
  hardMax: number;
  unit: 'words' | 'characters';
}

export const LENGTH_RULES: Record<LineLength, Record<Lang, LengthRule>> = {
  short: {
    en: { targetMin: 8, targetMax: 20, hardMax: 24, unit: 'words' },
    zh: { targetMin: 10, targetMax: 30, hardMax: 34, unit: 'characters' },
    ja: { targetMin: 12, targetMax: 40, hardMax: 46, unit: 'characters' },
  },
  medium: {
    en: { targetMin: 14, targetMax: 30, hardMax: 36, unit: 'words' },
    zh: { targetMin: 20, targetMax: 45, hardMax: 52, unit: 'characters' },
    ja: { targetMin: 24, targetMax: 58, hardMax: 66, unit: 'characters' },
  },
};

const ASCII_RUN = /[A-Za-z0-9]+/g;
// Letters and numbers of any script; everything else (spaces, punctuation, emoji) is not counted.
const COUNTED = /[\p{L}\p{N}]/u;

/** Number of length units in `text` for `lang` (see file header). */
export function countUnits(text: string, lang: Lang): number {
  if (lang === 'en') {
    const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    return words ? words.length : 0;
  }
  let units = 0;
  const withoutAscii = text.replace(ASCII_RUN, (run) => {
    units += Math.max(1, Math.ceil(run.length / 3));
    return ' ';
  });
  for (const ch of withoutAscii) {
    if (COUNTED.test(ch)) units += 1;
  }
  return units;
}

/** Collapses whitespace, removes control characters and wrapping quotes. */
export function normalizeLineText(raw: string): string {
  let text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Models sometimes wrap the whole line in quotes.
  const quotePairs: [string, string][] = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
    ["'", "'"],
  ];
  for (const [open, close] of quotePairs) {
    if (text.length > 2 && text.startsWith(open) && text.endsWith(close) && !text.slice(1, -1).includes(open)) {
      text = text.slice(open.length, -close.length).trim();
      break;
    }
  }
  return text;
}

const SENTENCE_SPLIT = /(?<=[.!?。！？…~～])\s*/u;

export interface FittedLine {
  text: string;
  units: number;
  truncated: boolean;
}

/**
 * Returns the line if it respects the hard limit, a version cut back to whole
 * sentences if that is possible, or null when even the first sentence is too
 * long (the caller then falls back to a local line).
 */
export function fitLine(raw: string, lang: Lang, length: LineLength): FittedLine | null {
  const text = normalizeLineText(raw);
  if (!text) return null;
  const rule = LENGTH_RULES[length][lang];
  const units = countUnits(text, lang);
  if (units === 0) return null;
  if (units <= rule.hardMax) return { text, units, truncated: false };
  const sentences = text.split(SENTENCE_SPLIT).filter((s) => s.length > 0);
  let kept = '';
  for (const sentence of sentences) {
    const candidate = kept ? `${kept}${lang === 'en' ? ' ' : ''}${sentence}` : sentence;
    if (countUnits(candidate, lang) > rule.hardMax) break;
    kept = candidate;
  }
  if (!kept) return null;
  return { text: kept, units: countUnits(kept, lang), truncated: true };
}

/** How long a line should stay on screen when no audio defines its duration. */
export function displayDurationMs(text: string, lang: Lang): number {
  const units = countUnits(text, lang);
  const perUnit = lang === 'en' ? 270 : 120;
  return Math.min(7500, Math.max(2600, 1500 + units * perUnit));
}
