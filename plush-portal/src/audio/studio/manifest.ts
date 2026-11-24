/**
 * The optional `studio` section of public/audio/manifest.json: generated ("studio")
 * recordings written by tools/audio/importStudio.ts. Everything here is an addition to
 * the synthesised set, which stays complete and is the fallback for every entry.
 *
 * Pure module (no DOM / Node APIs): used by the engine, the import tool and the tests.
 */
import { LOOP_NAMES, SFX_NAMES, type LoopName, type SfxName } from '../../core/contracts';
import { THEME_IDS, type ThemeId } from '../../core/types';

export const STUDIO_SCHEMA = 1;

/** Where a file came from. `job` is the basename of the Higgsfield result URL (null when it was not recorded). */
export interface StudioSource {
  generator: string;
  model: string;
  job: string | null;
  /** The raw file name the import tool read. */
  input: string;
}

export interface StudioTake {
  /** Path relative to the audio base URL. */
  file: string;
  bytes: number;
  /** Decoded duration, seconds. */
  duration: number;
  bpm: number;
  beatsPerBar: number;
  /** Estimated key (report only). */
  key?: string;
  /** Bar line (estimated) where the body starts, after the generated intro, seconds. */
  inPoint: number;
  /** Bar line (estimated) where the body ends, before the generated outro, seconds. */
  outPoint: number;
  /**
   * Cross-fade used when this take hands over to the next one, seconds (whole beats). It is
   * centred on the hand-over: the outgoing take's `outPoint` and the incoming take's `inPoint`
   * coincide in the middle of the fade.
   */
  crossfade: number;
  crossfadeBeats: number;
  /** Integrated loudness and true peak of the encoded file. */
  lufs: number;
  truePeakDb: number;
  source: StudioSource;
}

export interface StudioPlaylist {
  title: string;
  /** Played in order and repeated: take 1 → take 2 → take 1 …, equal-power cross-fades on bar lines. */
  takes: StudioTake[];
}

export interface StudioOneShot {
  /** Variant files (usually one). */
  files: string[];
  /** Playback gain: puts the file (peak-normalised) at its target loudness in the existing mix. */
  gain: number;
  pitchVar: number;
  gainVar: number;
  /** 'replace' plays only the studio sample, 'layer' plays it on top of the synthesised effect. */
  mode: 'replace' | 'layer';
  duration: number;
  /** Loudest 400 ms of the file after processing (LUFS) and the loudness it plays at (+ gain). */
  fileLoudness: number;
  targetLoudness: number;
  peakDb: number;
  bytes: number;
  source: StudioSource[];
  notes?: string[];
}

export interface StudioLoop {
  file: string;
  duration: number;
  gain: number;
  bytes: number;
  /** Sample step across the wrap relative to the mean step (≈1 = seamless). */
  seamStepRatio: number;
  source: StudioSource;
}

export interface StudioVoice {
  file: string;
  gain: number;
  duration: number;
  bytes: number;
  source: StudioSource;
  notes?: string[];
}

export interface StudioManifest {
  schema: number;
  generator: string;
  licence: string;
  music: Partial<Record<ThemeId, StudioPlaylist>>;
  stingers: Partial<Record<ThemeId, { win?: StudioOneShot; jackpot?: StudioOneShot }>>;
  sfx: Partial<Record<SfxName, StudioOneShot>>;
  loops: Partial<Record<LoopName, StudioLoop>>;
  /** Keyed by plush asset id ("sakura.bunny"). */
  voices: Record<string, StudioVoice>;
  /** Inputs that were not shipped, with the measured reason. */
  rejected?: { input: string; reason: string }[];
  /** Bytes a theme downloads (its play-list, stingers and voices) and the shared set. */
  bytes?: { themes: Partial<Record<ThemeId, number>>; shared: number };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function checkOneShot(v: unknown, where: string, problems: string[]): v is StudioOneShot {
  if (!isObj(v) || !Array.isArray(v.files) || v.files.length === 0 || !v.files.every(isStr) || !isNum(v.gain) || v.gain < 0) {
    problems.push(`${where} invalid`);
    return false;
  }
  if (v.mode !== 'replace' && v.mode !== 'layer') {
    problems.push(`${where}.mode invalid`);
    return false;
  }
  return true;
}

function checkTake(v: unknown, where: string, problems: string[]): v is StudioTake {
  if (!isObj(v) || !isStr(v.file) || !isNum(v.duration) || !isNum(v.inPoint) || !isNum(v.outPoint) || !isNum(v.crossfade) || !isNum(v.bpm)) {
    problems.push(`${where} invalid`);
    return false;
  }
  const { inPoint, outPoint, crossfade, duration } = v;
  // The cross-fade is centred on the points: half of it lies before `inPoint` and after `outPoint`.
  if (!(crossfade > 0) || inPoint < crossfade / 2 - 1e-6 || !(outPoint > inPoint + crossfade * 2) || outPoint + crossfade / 2 > duration + 1e-6) {
    problems.push(`${where} has invalid in / out points`);
    return false;
  }
  return true;
}

/**
 * Validates the untrusted `studio` section. Invalid entries are dropped one by one (each
 * listed in `problems`); the rest stays usable. Returns null when there is no usable section.
 */
export function parseStudioManifest(json: unknown): { studio: StudioManifest | null; problems: string[] } {
  const problems: string[] = [];
  if (json === undefined || json === null) return { studio: null, problems };
  if (!isObj(json)) return { studio: null, problems: ['studio is not an object'] };
  if (json.schema !== STUDIO_SCHEMA) return { studio: null, problems: [`unsupported studio schema ${String(json.schema)}`] };
  const out: StudioManifest = {
    schema: STUDIO_SCHEMA,
    generator: isStr(json.generator) ? json.generator : 'unknown',
    licence: isStr(json.licence) ? json.licence : '',
    music: {},
    stingers: {},
    sfx: {},
    loops: {},
    voices: {},
  };
  const music = isObj(json.music) ? json.music : {};
  for (const theme of THEME_IDS) {
    const p = music[theme];
    if (p === undefined) continue;
    if (!isObj(p) || !Array.isArray(p.takes)) {
      problems.push(`studio.music.${theme} invalid`);
      continue;
    }
    const takes = p.takes.filter((t, i) => checkTake(t, `studio.music.${theme}.takes[${i}]`, problems)) as StudioTake[];
    if (takes.length > 0) out.music[theme] = { title: isStr(p.title) ? p.title : theme, takes };
  }
  const stingers = isObj(json.stingers) ? json.stingers : {};
  for (const theme of THEME_IDS) {
    const s = stingers[theme];
    if (!isObj(s)) continue;
    const entry: { win?: StudioOneShot; jackpot?: StudioOneShot } = {};
    if (s.win !== undefined && checkOneShot(s.win, `studio.stingers.${theme}.win`, problems)) entry.win = s.win;
    if (s.jackpot !== undefined && checkOneShot(s.jackpot, `studio.stingers.${theme}.jackpot`, problems)) entry.jackpot = s.jackpot;
    if (entry.win || entry.jackpot) out.stingers[theme] = entry;
  }
  const sfx = isObj(json.sfx) ? json.sfx : {};
  for (const name of SFX_NAMES) {
    if (sfx[name] === undefined) continue;
    if (checkOneShot(sfx[name], `studio.sfx.${name}`, problems)) out.sfx[name] = sfx[name];
  }
  const loops = isObj(json.loops) ? json.loops : {};
  for (const name of LOOP_NAMES) {
    const l = loops[name];
    if (l === undefined) continue;
    if (isObj(l) && isStr(l.file) && isNum(l.gain) && isNum(l.duration) && l.duration > 0.05) out.loops[name] = l as unknown as StudioLoop;
    else problems.push(`studio.loops.${name} invalid`);
  }
  const voices = isObj(json.voices) ? json.voices : {};
  for (const [id, v] of Object.entries(voices)) {
    if (!/^[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(id)) {
      problems.push(`studio.voices.${id}: bad id`);
      continue;
    }
    if (isObj(v) && isStr(v.file) && isNum(v.gain)) out.voices[id] = v as unknown as StudioVoice;
    else problems.push(`studio.voices.${id} invalid`);
  }
  if (Array.isArray(json.rejected)) out.rejected = json.rejected.filter((r): r is { input: string; reason: string } => isObj(r) && isStr(r.input) && isStr(r.reason));
  if (isObj(json.bytes)) out.bytes = json.bytes as StudioManifest['bytes'];
  const any = Object.keys(out.music).length + Object.keys(out.stingers).length + Object.keys(out.sfx).length + Object.keys(out.loops).length + Object.keys(out.voices).length;
  return { studio: any > 0 ? out : null, problems };
}

/** Theme of a character id ("sakura.bunny" → "sakura"), or null. */
export function themeOfCharacter(assetId: string): ThemeId | null {
  const theme = assetId.split('.')[0] ?? '';
  return (THEME_IDS as readonly string[]).includes(theme) ? (theme as ThemeId) : null;
}

/** Every file a theme needs from the studio set (its play-list, stingers and character voices). */
export function studioThemeFiles(studio: StudioManifest, theme: ThemeId): { music: string[]; oneShots: string[] } {
  const music = (studio.music[theme]?.takes ?? []).map((t) => t.file);
  const oneShots: string[] = [];
  const s = studio.stingers[theme];
  if (s?.win) oneShots.push(...s.win.files);
  if (s?.jackpot) oneShots.push(...s.jackpot.files);
  for (const [id, v] of Object.entries(studio.voices)) if (themeOfCharacter(id) === theme) oneShots.push(v.file);
  return { music, oneShots };
}

/** Files every theme shares (effects and loops). */
export function studioSharedFiles(studio: StudioManifest): string[] {
  const out = new Set<string>();
  for (const e of Object.values(studio.sfx)) if (e) for (const f of e.files) out.add(f);
  for (const l of Object.values(studio.loops)) if (l) out.add(l.file);
  return [...out];
}
