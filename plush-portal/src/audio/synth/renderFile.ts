/** Renders the asset that belongs to a manifest file key (used by the fallback worker and by tests). */
import { LOOP_NAMES } from '../../core/contracts';
import { SR } from './core';
import { themeOfMusicFile } from './fallbackManifest';
import { renderMusic } from './music';
import { listSfxFiles, loopFileName, renderLoop, renderSfx } from './sfx';

export interface RenderedFile {
  file: string;
  sampleRate: number;
  channels: Float32Array[];
  /** Present for music. */
  loopStart?: number;
  loopEnd?: number;
}

export function renderFileByKey(file: string): RenderedFile | null {
  const theme = themeOfMusicFile(file);
  if (theme) {
    const m = renderMusic(theme);
    return { file, sampleRate: SR, channels: [m.file.l, m.file.r], loopStart: m.file.loopStart, loopEnd: m.file.loopEnd };
  }
  for (const name of LOOP_NAMES) {
    if (loopFileName(name) === file) return { file, sampleRate: SR, channels: [renderLoop(name)] };
  }
  const spec = listSfxFiles().find((s) => s.file === file);
  if (spec) return { file, sampleRate: SR, channels: [renderSfx(spec.name, spec.variant, spec.theme)] };
  return null;
}
