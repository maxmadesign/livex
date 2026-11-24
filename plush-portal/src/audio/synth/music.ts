/** Registry of the four theme tracks and the entry points used by the bake tool, the fallback worker and tests. */
import type { ThemeId } from '../../core/types';
import { assembleLoopFile, type LoopFile, type MixResult } from './mix';
import type { ScoreData } from './scores/common';
import { cosmicData, renderCosmic } from './scores/cosmic';
import { oceanData, renderOcean } from './scores/ocean';
import { renderSakura, sakuraData } from './scores/sakura';
import { renderStorybook, storybookData } from './scores/storybook';

export const MUSIC_SCORES: Record<ThemeId, { data: ScoreData; render: () => MixResult }> = {
  sakura: { data: sakuraData, render: renderSakura },
  storybook: { data: storybookData, render: renderStorybook },
  ocean: { data: oceanData, render: renderOcean },
  cosmic: { data: cosmicData, render: renderCosmic },
};

export const MUSIC_CREDITS = 'original, synthesised by tools/audio';

export interface MusicRender {
  theme: ThemeId;
  data: ScoreData;
  /** The periodic loop itself (exactly one cycle). */
  loop: MixResult;
  /** The loop laid out for a file / AudioBuffer with safe loop points. */
  file: LoopFile;
}

/** Renders one theme track. Deterministic: the same code always yields the same samples. */
export function renderMusic(theme: ThemeId): MusicRender {
  const score = MUSIC_SCORES[theme];
  const loop = score.render();
  return { theme, data: score.data, loop, file: assembleLoopFile(loop.l, loop.r) };
}
