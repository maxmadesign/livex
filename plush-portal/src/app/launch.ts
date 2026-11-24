import { DISPLAY_PROFILE_IDS, LANGS, THEME_IDS, type DisplayProfileId, type Lang, type ThemeId } from '../core/types';
import type { LaunchParams } from './Game';

/**
 * Launch parameters (query string):
 *   ?display=desktop|portrait32|portrait86|mobile   choose and remember the display preset
 *   ?theme=sakura|storybook|ocean|cosmic|gpu     start with a theme
 *   ?lang=en|zh|ja                           UI language
 *   ?quality=safe|medium|high|ultra          apply a graphics preset
 *   ?seed=123                                deterministic toy layout
 *   ?debug=1                                 expose window.__plush for tests / tuning
 *   ?camera=off                              never request the camera
 *   ?debug=1&insets=47,0,21,47               pretend the screen has cut-outs (top,right,bottom,left CSS px)
 */
export function readLaunchParams(search: string = globalThis.location?.search ?? ''): LaunchParams {
  const q = new URLSearchParams(search);
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null);
  const display = pick<DisplayProfileId>(q.get('display') ?? q.get('profile'), DISPLAY_PROFILE_IDS);
  const seed = q.has('seed') ? Number(q.get('seed')) : NaN;
  return {
    display,
    theme: pick<ThemeId>(q.get('theme'), THEME_IDS),
    quality: pick(q.get('quality'), ['safe', 'medium', 'high', 'ultra'] as const),
    lang: pick<Lang>(q.get('lang'), LANGS),
    seed: Number.isFinite(seed) ? Math.floor(seed) : null,
    debug: q.get('debug') === '1',
    noCamera: q.get('camera') === 'off',
  };
}

/**
 * Debug only (`?debug=1&insets=top,right,bottom,left`): simulated safe-area insets in CSS pixels, so
 * the phone layout's handling of notches and home indicators can be checked in a desktop browser or
 * an emulator that reports none. One value applies to all four sides. Null without both parameters.
 */
export function readInsetsParam(search: string): { top: number; right: number; bottom: number; left: number } | null {
  const q = new URLSearchParams(search);
  const raw = q.get('insets');
  if (q.get('debug') !== '1' || !raw) return null;
  const parts = raw.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 1 && parts.length !== 4) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 200)) return null;
  const [top, right = top, bottom = top, left = top] = parts as [number, number?, number?, number?];
  return { top, right, bottom, left };
}
