/**
 * Renders every audio asset of PLUSH PORTAL from code.
 *
 *   npm run assets:audio            # music -> MP3 (needs ffmpeg with libmp3lame), SFX/loops -> WAV
 *   npm run assets:audio -- --music-format wav   # no ffmpeg needed (larger files)
 *   npm run assets:audio -- --only sfx           # skip the music
 *
 * Output: public/audio/music/*.mp3, public/audio/sfx/*.wav, public/audio/manifest.json
 * The render is deterministic: the same sources always produce the same samples.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOP_NAMES, SFX_NAMES } from '../../src/core/contracts';
import { THEME_IDS, type ThemeId } from '../../src/core/types';
import {
  AUDIO_MANIFEST_VERSION,
  LOOP_RECIPES,
  MUSIC_CREDITS,
  SFX_RECIPES,
  SR,
  decodeWav16,
  encodeWav16,
  gainToDb,
  hasInvalidSamples,
  listSfxFiles,
  loopFileName,
  peakOf,
  renderLoop,
  renderMusic,
  renderSfx,
  rmsOf,
  type AudioManifest,
  type LoopEntry,
  type MusicEntry,
  type SfxEntry,
} from '../../src/audio/synth/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = path.join(ROOT, 'public', 'audio');
const args = process.argv.slice(2);
const argValue = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : null;
};
const musicFormat = (argValue('--music-format') ?? 'mp3') as 'mp3' | 'wav';
const only = argValue('--only');
const bitrate = argValue('--bitrate') ?? '160k';

function ffmpeg(ffArgs: string[]): { ok: boolean; stderr: string } {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs], { encoding: 'utf8' });
  return { ok: res.status === 0, stderr: (res.stderr ?? '') + (res.error ? String(res.error) : '') };
}

function round(v: number, digits = 3): number {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

/** Normalised correlation between two windows of a decoded file: 1 = identical. */
function windowCorrelation(a: Float32Array, startA: number, startB: number, length: number): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < length; i++) {
    const x = a[startA + i]!;
    const y = a[startB + i]!;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return ab / Math.sqrt(aa * bb + 1e-20);
}

function cleanDir(dir: string, ext: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) if (ext.some((e) => name.endsWith(e))) rmSync(path.join(dir, name));
}

function loadExistingManifest(): AudioManifest | null {
  try {
    return JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as AudioManifest;
  } catch {
    return null;
  }
}

function bakeMusic(): Record<ThemeId, MusicEntry> {
  const dir = path.join(OUT, 'music');
  mkdirSync(dir, { recursive: true });
  cleanDir(dir, ['.mp3', '.wav', '.ogg']);
  const tmp = mkdtempSync(path.join(tmpdir(), 'plush-audio-'));
  const out = {} as Record<ThemeId, MusicEntry>;
  try {
    for (const theme of THEME_IDS) {
      const t0 = performance.now();
      const { data, loop, file } = renderMusic(theme);
      if (hasInvalidSamples(file.l, file.r)) throw new Error(`${theme}: render produced invalid samples`);
      const wav = encodeWav16([file.l, file.r]);
      const fileName = `music/${theme}.${musicFormat}`;
      const target = path.join(OUT, fileName);
      let decodedPeakDb = gainToDb(peakOf(file.l, file.r));
      let seam = 1;
      if (musicFormat === 'wav') {
        writeFileSync(target, wav);
      } else {
        const src = path.join(tmp, `${theme}.wav`);
        writeFileSync(src, wav);
        const enc = ffmpeg(['-i', src, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', String(SR), '-ac', '2', target]);
        if (!enc.ok) {
          throw new Error(
            `ffmpeg could not encode ${theme}.mp3 (${enc.stderr.trim() || 'ffmpeg not found'}).\n` +
              'Install ffmpeg with libmp3lame, or run: npm run assets:audio -- --music-format wav',
          );
        }
        // Decode what was written and verify it the way a browser will see it.
        const back = path.join(tmp, `${theme}.decoded.wav`);
        const dec = ffmpeg(['-i', target, '-c:a', 'pcm_s16le', back]);
        if (!dec.ok) throw new Error(`ffmpeg could not decode ${theme}.mp3: ${dec.stderr}`);
        const decoded = decodeWav16(new Uint8Array(readFileSync(back)));
        decodedPeakDb = gainToDb(peakOf(...decoded.data));
        const a = Math.round(file.loopStart * SR);
        const b = Math.round(file.loopEnd * SR);
        const len = Math.min(Math.round(1.0 * SR), decoded.frames - b - 64);
        seam = windowCorrelation(decoded.data[0]!, a, b, len);
        if (decoded.duration < file.loopEnd + 0.5) throw new Error(`${theme}: decoded file is too short for its loop points`);
        if (seam < 0.995) throw new Error(`${theme}: decoded loop seam correlation ${seam.toFixed(5)} is too low`);
      }
      const bytes = statSync(target).size;
      out[theme] = {
        file: fileName,
        title: data.meta.title,
        bpm: data.meta.bpm,
        beatsPerBar: data.meta.beatsPerBar,
        bars: data.meta.bars,
        key: data.meta.key,
        feel: data.meta.feel,
        instruments: data.meta.instruments,
        sections: data.meta.sections,
        duration: round(file.duration, 6),
        // Not rounded: a loop point that is off by a fraction of a sample makes the browser interpolate after every wrap.
        loopStart: file.loopStart,
        loopEnd: file.loopEnd,
        loopStartSample: Math.round(file.loopStart * SR),
        loopEndSample: Math.round(file.loopEnd * SR),
        lufs: round(loop.lufs, 2),
        peakDb: round(decodedPeakDb, 2),
        rmsDb: round(gainToDb(rmsOf(loop.l, loop.r)), 2),
        credits: MUSIC_CREDITS,
        bytes,
      };
      console.log(
        `music  ${theme.padEnd(10)} "${data.meta.title}"  loop ${(file.loopEnd - file.loopStart).toFixed(2)} s  ${loop.lufs.toFixed(1)} LUFS  ` +
          `decoded peak ${decodedPeakDb.toFixed(2)} dBFS  seam corr ${seam.toFixed(5)}  ${(bytes / 1e6).toFixed(2)} MB  (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

function bakeSfx(): { sfx: AudioManifest['sfx']; loops: AudioManifest['loops']; bytes: number } {
  const dir = path.join(OUT, 'sfx');
  mkdirSync(dir, { recursive: true });
  cleanDir(dir, ['.wav']);
  let bytes = 0;
  const sfx = {} as AudioManifest['sfx'];
  for (const name of SFX_NAMES) {
    const recipe = SFX_RECIPES[name];
    sfx[name] = { files: [], gain: recipe.gain, pitchVar: recipe.pitchVar, gainVar: recipe.gainVar, duration: 0, peakDb: -Infinity } satisfies SfxEntry;
    if (recipe.themed) sfx[name].themes = {};
  }
  for (const spec of listSfxFiles()) {
    const buf = renderSfx(spec.name, spec.variant, spec.theme);
    if (hasInvalidSamples(buf)) throw new Error(`${spec.file}: invalid samples`);
    const wav = encodeWav16([buf]);
    writeFileSync(path.join(OUT, spec.file), wav);
    bytes += wav.length;
    const entry = sfx[spec.name];
    if (spec.theme) {
      (entry.themes![spec.theme] ??= []).push(spec.file);
      if (spec.theme === THEME_IDS[0]) entry.files.push(spec.file);
    } else {
      entry.files.push(spec.file);
    }
    entry.duration = Math.max(entry.duration, round(buf.length / SR, 4));
    entry.peakDb = Math.max(entry.peakDb, round(gainToDb(peakOf(buf)), 2));
    entry.rmsDb = Math.max(entry.rmsDb ?? -Infinity, round(gainToDb(rmsOf(buf)), 2));
  }
  const loops = {} as AudioManifest['loops'];
  for (const name of LOOP_NAMES) {
    const buf = renderLoop(name);
    const file = loopFileName(name);
    const wav = encodeWav16([buf]);
    writeFileSync(path.join(OUT, file), wav);
    bytes += wav.length;
    loops[name] = {
      file,
      duration: round(buf.length / SR, 6),
      gain: LOOP_RECIPES[name].gain,
      peakDb: round(gainToDb(peakOf(buf)), 2),
      rmsDb: round(gainToDb(rmsOf(buf)), 2),
    } satisfies LoopEntry;
    console.log(`loop   ${name.padEnd(14)} ${(buf.length / SR).toFixed(2)} s  rms ${gainToDb(rmsOf(buf)).toFixed(1)} dB`);
  }
  const count = listSfxFiles().length;
  console.log(`sfx    ${count} one-shots + ${LOOP_NAMES.length} loops, ${(bytes / 1e6).toFixed(2)} MB`);
  return { sfx, loops, bytes };
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const previous = loadExistingManifest();
  const music = only === 'sfx' ? previous?.music : bakeMusic();
  const effects = only === 'music' ? (previous ? { sfx: previous.sfx, loops: previous.loops } : null) : bakeSfx();
  if (!music || !effects) throw new Error('--only needs an existing manifest for the part that is skipped; run a full bake first');
  const manifest: AudioManifest = {
    version: AUDIO_MANIFEST_VERSION,
    generator: 'tools/audio/bake.ts',
    sampleRate: SR,
    music,
    sfx: effects.sfx,
    loops: effects.loops,
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote  ${path.relative(ROOT, path.join(OUT, 'manifest.json'))}`);
}

main();
