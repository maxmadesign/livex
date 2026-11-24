/**
 * The big round START / GRAB / PLAY AGAIN button: its label must never be split inside a word
 * ("STAR / T", "スター / ト") when the font scale is raised or the language has longer words.
 * hud.css (.pp-grab span) shrinks the label so its widest unbreakable run fits the button:
 *   font-size: min(1em, var(--touch) × GRAB_LABEL_WIDTH / var(--label-em))
 * where --label-em is the run's width in em, estimated here.
 */

/** Usable label width as a multiple of the touch size: 86 % of a button 2.15 touch sizes wide, minus a margin. */
export const GRAB_LABEL_WIDTH = 1.8;

/** CJK ideographs, kana, Hangul and full-width forms: about 1 em each in the display fonts (+ letter spacing). */
const WIDE = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]/u;
const WIDE_EM = 1.05;
/** Latin capitals in Fredoka bold measure 0.61 em with the button's letter spacing; a little spare. */
const NARROW_EM = 0.64;

/**
 * Width in em of the widest part of `text` that may not be broken: a space-separated word, or a
 * whole run of CJK text (breaking between ideographs is allowed but reads badly on a 2-line button).
 */
export function labelEm(text: string): number {
  let widest = 0;
  for (const word of text.split(/\s+/)) {
    let em = 0;
    for (const ch of word) em += WIDE.test(ch) ? WIDE_EM : NARROW_EM;
    widest = Math.max(widest, em);
  }
  return Math.max(1, Math.round(widest * 100) / 100);
}
