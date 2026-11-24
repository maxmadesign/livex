/**
 * Builds a manifest for the in-browser synth fallback without rendering
 * anything: same shape and file keys as the baked manifest, so the engine
 * treats baked files and synthesised buffers identically.
 */
import { LOOP_NAMES, SFX_NAMES, type LoopName, type SfxName } from '../../core/contracts';
import { THEME_IDS, type ThemeId } from '../../core/types';
import { SR } from './core';
import { AUDIO_MANIFEST_VERSION, type AudioManifest, type LoopEntry, type MusicEntry, type SfxEntry } from './manifest';
import { LOOP_POST_ROLL, LOOP_PRE_ROLL } from './mix';
import { MUSIC_CREDITS, MUSIC_SCORES } from './music';
import { LOOP_FILE_PEAK_DB, LOOP_RECIPES, SFX_FILE_PEAK_DB, SFX_RECIPES, listSfxFiles, loopFileName } from './sfx';
import { Timeline } from './seq';

export function musicFileKey(theme: ThemeId): string {
  return `music/${theme}.mp3`;
}

/** Maps a music file key ("music/ocean.mp3", any extension) back to its theme. */
export function themeOfMusicFile(file: string): ThemeId | null {
  const m = /^music\/([a-z]+)\.[a-z0-9]+$/.exec(file);
  if (!m) return null;
  return (THEME_IDS as readonly string[]).includes(m[1]!) ? (m[1] as ThemeId) : null;
}

export function buildSynthManifest(): AudioManifest {
  const music = {} as Record<ThemeId, MusicEntry>;
  for (const theme of THEME_IDS) {
    const meta = MUSIC_SCORES[theme].data.meta;
    const tl = new Timeline(meta.bpm, meta.beatsPerBar, meta.bars);
    const loop = tl.loopSamples / SR;
    music[theme] = {
      file: musicFileKey(theme),
      title: meta.title,
      bpm: meta.bpm,
      beatsPerBar: meta.beatsPerBar,
      bars: meta.bars,
      key: meta.key,
      feel: meta.feel,
      instruments: meta.instruments,
      sections: meta.sections,
      duration: LOOP_PRE_ROLL + loop + LOOP_POST_ROLL,
      loopStart: Math.round(LOOP_PRE_ROLL * SR) / SR,
      loopEnd: (Math.round(LOOP_PRE_ROLL * SR) + tl.loopSamples) / SR,
      loopStartSample: Math.round(LOOP_PRE_ROLL * SR),
      loopEndSample: Math.round(LOOP_PRE_ROLL * SR) + tl.loopSamples,
      lufs: -16,
      peakDb: -1.5,
      credits: MUSIC_CREDITS,
      bytes: 0,
    };
  }
  const sfx = {} as Record<SfxName, SfxEntry>;
  for (const name of SFX_NAMES) {
    const r = SFX_RECIPES[name];
    sfx[name] = { files: [], gain: r.gain, pitchVar: r.pitchVar, gainVar: r.gainVar, duration: 0, peakDb: SFX_FILE_PEAK_DB };
    if (r.themed) sfx[name].themes = {};
  }
  for (const spec of listSfxFiles()) {
    const entry = sfx[spec.name];
    if (spec.theme) {
      (entry.themes![spec.theme] ??= []).push(spec.file);
      if (spec.theme === THEME_IDS[0]) entry.files.push(spec.file);
    } else {
      entry.files.push(spec.file);
    }
  }
  const loops = {} as Record<LoopName, LoopEntry>;
  for (const name of LOOP_NAMES) {
    loops[name] = { file: loopFileName(name), duration: LOOP_RECIPES[name].seconds, gain: LOOP_RECIPES[name].gain, peakDb: LOOP_FILE_PEAK_DB };
  }
  return { version: AUDIO_MANIFEST_VERSION, generator: 'in-browser synth fallback', sampleRate: SR, music, sfx, loops };
}
