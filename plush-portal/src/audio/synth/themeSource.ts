import type { ThemeId } from '../../core/types';

/**
 * Which theme's recordings (music file, themed jingles) a theme uses. A theme that maps to
 * another one borrows that theme's files instead of having its own; when it gets its own
 * score and jingles, map it to itself and re-run `npm run assets:audio`.
 */
export const AUDIO_THEME_SOURCE: Record<ThemeId, ThemeId> = {
  sakura: 'sakura',
  storybook: 'storybook',
  ocean: 'ocean',
  cosmic: 'cosmic',
  gpu: 'cosmic',
};

/** Themes that have their own recordings (the music tracks and jingle sets that really exist). */
export const AUDIO_SOURCE_THEMES: readonly ThemeId[] = (Object.keys(AUDIO_THEME_SOURCE) as ThemeId[]).filter((t) => AUDIO_THEME_SOURCE[t] === t);
