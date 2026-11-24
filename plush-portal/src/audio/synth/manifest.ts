/** Shape of public/audio/manifest.json (written by tools/audio/bake.ts, read by the runtime engine). */
import { LOOP_NAMES, SFX_NAMES, type LoopName, type SfxName } from '../../core/contracts';
import { THEME_IDS, type ThemeId } from '../../core/types';

export const AUDIO_MANIFEST_VERSION = 1;

export interface MusicEntry {
  /** Path relative to the audio base URL. */
  file: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  key: string;
  feel: string;
  instruments: string[];
  sections: { name: string; bars: number }[];
  /** Seconds. */
  duration: number;
  /** Looping [loopStart, loopEnd) is seamless (the file content is periodic with this period). Seconds, full precision. */
  loopStart: number;
  loopEnd: number;
  /** The same loop points as whole sample frames at the manifest's sampleRate. */
  loopStartSample: number;
  loopEndSample: number;
  lufs: number;
  /** Sample peak of the decoded file and RMS of the loop, dBFS. */
  peakDb: number;
  rmsDb?: number;
  credits: string;
  bytes: number;
}

export interface SfxEntry {
  /** Variant files. For themed effects this is the default set (first theme). */
  files: string[];
  /** Theme specific variant files (only for themed effects such as `win`). */
  themes?: Partial<Record<ThemeId, string[]>>;
  /** Playback gain relative to a full-level effect; the files themselves are peak-normalised. */
  gain: number;
  /** Random per-trigger variation applied by the engine. */
  pitchVar: number;
  gainVar: number;
  /** Longest variant, seconds. */
  duration: number;
  /** Highest peak and RMS over the variant files, dBFS. */
  peakDb: number;
  rmsDb?: number;
}

export interface LoopEntry {
  file: string;
  duration: number;
  gain: number;
  peakDb: number;
  rmsDb?: number;
}

export interface AudioManifest {
  version: number;
  generator: string;
  sampleRate: number;
  music: Record<ThemeId, MusicEntry>;
  sfx: Record<SfxName, SfxEntry>;
  loops: Record<LoopName, LoopEntry>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/**
 * Validates untrusted JSON. Returns the manifest or a list of problems; a
 * manifest is only accepted when every theme track, effect and loop is present.
 */
export function parseAudioManifest(json: unknown): { manifest: AudioManifest | null; problems: string[] } {
  const problems: string[] = [];
  if (!json || typeof json !== 'object') return { manifest: null, problems: ['manifest is not an object'] };
  const m = json as Record<string, unknown>;
  if (m.version !== AUDIO_MANIFEST_VERSION) problems.push(`unsupported manifest version ${String(m.version)}`);
  const music = (m.music ?? {}) as Record<string, Record<string, unknown>>;
  for (const theme of THEME_IDS) {
    const e = music[theme];
    if (!e || !isStr(e.file)) {
      problems.push(`music.${theme} missing`);
      continue;
    }
    if (!isNum(e.loopStart) || !isNum(e.loopEnd) || !isNum(e.duration) || !(e.loopEnd > e.loopStart) || e.loopStart < 0 || e.loopEnd > e.duration + 1e-6) {
      problems.push(`music.${theme} has invalid loop points`);
    }
  }
  const sfx = (m.sfx ?? {}) as Record<string, Record<string, unknown>>;
  for (const name of SFX_NAMES) {
    const e = sfx[name];
    if (!e || !isStrList(e.files) || e.files.length === 0 || !isNum(e.gain)) problems.push(`sfx.${name} missing`);
    else if (e.themes !== undefined) {
      const themes = e.themes as Record<string, unknown>;
      for (const key of Object.keys(themes)) if (!isStrList(themes[key])) problems.push(`sfx.${name}.themes.${key} invalid`);
    }
  }
  const loops = (m.loops ?? {}) as Record<string, Record<string, unknown>>;
  for (const name of LOOP_NAMES) {
    const e = loops[name];
    if (!e || !isStr(e.file) || !isNum(e.gain)) problems.push(`loops.${name} missing`);
  }
  return { manifest: problems.length === 0 ? (json as AudioManifest) : null, problems };
}
