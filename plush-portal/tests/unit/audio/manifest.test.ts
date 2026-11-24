import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOOP_NAMES, SFX_NAMES } from '../../../src/core/contracts';
import { THEME_IDS } from '../../../src/core/types';
import {
  MUSIC_SCORES,
  SR,
  buildSynthManifest,
  decodeWav16,
  gainToDb,
  parseAudioManifest,
  peakOf,
  renderLoop,
  renderSfx,
  listSfxFiles,
  type AudioManifest,
} from '../../../src/audio/synth/index';

const AUDIO_DIR = path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'public', 'audio');
const manifestPath = path.join(AUDIO_DIR, 'manifest.json');

/** Counts MPEG-1 Layer III frames: gives the exact decoded length without a decoder. */
function mp3Info(bytes: Uint8Array): { frames: number; sampleRate: number; bitrates: Set<number>; duration: number } {
  const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const RATES = [44100, 48000, 32000, 0];
  let i = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    i = 10 + ((bytes[6]! & 0x7f) << 21) + ((bytes[7]! & 0x7f) << 14) + ((bytes[8]! & 0x7f) << 7) + (bytes[9]! & 0x7f);
  }
  let frames = 0;
  let sampleRate = 0;
  const bitrates = new Set<number>();
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xfe) !== 0xfa) {
      i++;
      continue;
    }
    const bitrate = BITRATES[bytes[i + 2]! >> 4]!;
    const rate = RATES[(bytes[i + 2]! >> 2) & 3]!;
    const padding = (bytes[i + 2]! >> 1) & 1;
    if (!bitrate || !rate) {
      i++;
      continue;
    }
    sampleRate = rate;
    bitrates.add(bitrate);
    frames++;
    i += Math.floor((144000 * bitrate) / rate) + padding;
  }
  return { frames, sampleRate, bitrates, duration: sampleRate ? (frames * 1152) / sampleRate : 0 };
}

describe('baked audio assets (public/audio)', () => {
  const raw = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const parsed = parseAudioManifest(raw);
  const manifest = parsed.manifest as AudioManifest;

  it('has a valid manifest (run `npm run assets:audio` if this fails)', () => {
    expect(raw, 'public/audio/manifest.json is missing').not.toBeNull();
    expect(parsed.problems).toEqual([]);
    expect(manifest.sampleRate).toBe(SR);
  });

  it('lists every SFX and loop name with files that exist on disk', () => {
    let bytes = 0;
    for (const name of SFX_NAMES) {
      const e = manifest.sfx[name];
      expect(e, name).toBeDefined();
      const files = new Set<string>(e.files);
      for (const theme of THEME_IDS) for (const f of e.themes?.[theme] ?? []) files.add(f);
      expect(files.size, name).toBeGreaterThan(0);
      for (const file of files) {
        const full = path.join(AUDIO_DIR, file);
        expect(existsSync(full), file).toBe(true);
        bytes += statSync(full).size;
        const wav = decodeWav16(new Uint8Array(readFileSync(full)));
        expect(wav.sampleRate, file).toBe(SR);
        expect(wav.channels, file).toBe(1);
        expect(wav.duration, file).toBeGreaterThan(0.012);
        expect(wav.duration, file).toBeLessThan(2.2);
        expect(wav.duration, file).toBeLessThanOrEqual(e.duration + 1e-3);
        expect(gainToDb(peakOf(wav.data[0]!)), file).toBeLessThan(-3.5);
        expect(gainToDb(peakOf(wav.data[0]!)), file).toBeGreaterThan(-6.5);
      }
    }
    for (const name of ['win', 'theme_sting'] as const) {
      for (const theme of THEME_IDS) expect(manifest.sfx[name].themes?.[theme]?.length, `${name}@${theme}`).toBeGreaterThan(0);
    }
    for (const name of LOOP_NAMES) {
      const e = manifest.loops[name];
      const full = path.join(AUDIO_DIR, e.file);
      expect(existsSync(full), e.file).toBe(true);
      bytes += statSync(full).size;
      const wav = decodeWav16(new Uint8Array(readFileSync(full)));
      expect(wav.duration).toBeCloseTo(e.duration, 4);
    }
    // ≈3.6 MB since the dramatic layer added eleven effects (each also has a studio sample).
    expect(bytes).toBeLessThan(3.7e6);
  });

  it('has four music files that are long enough for their loop points', () => {
    for (const theme of THEME_IDS) {
      const e = manifest.music[theme];
      const full = path.join(AUDIO_DIR, e.file);
      expect(existsSync(full), e.file).toBe(true);
      const size = statSync(full).size;
      expect(size, e.file).toBe(e.bytes);
      expect(size, e.file).toBeLessThan(1.6e6);
      expect(e.loopEnd - e.loopStart, theme).toBeGreaterThanOrEqual(60);
      expect(e.loopStart, theme).toBeGreaterThanOrEqual(0.2);
      expect(e.loopStartSample, theme).toBe(Math.round(e.loopStart * SR));
      expect((e.loopEndSample - e.loopStartSample) % 1152, theme).toBe(0);
      expect(e.peakDb, theme).toBeLessThan(0);
      expect(e.lufs, theme).toBeGreaterThan(-17);
      expect(e.lufs, theme).toBeLessThan(-15);
      expect(e.credits).toContain('original');
      expect(e.title).toBe(MUSIC_SCORES[theme].data.meta.title);
      expect(e.bpm).toBe(MUSIC_SCORES[theme].data.meta.bpm);
      if (e.file.endsWith('.mp3')) {
        const info = mp3Info(new Uint8Array(readFileSync(full)));
        expect(info.sampleRate).toBe(SR);
        // Even if a decoder strips nothing or everything, the loop window stays inside real audio.
        expect(info.duration, theme).toBeGreaterThan(e.loopEnd + 1);
        expect(info.duration, theme).toBeLessThan(e.duration + 0.2);
      }
    }
  });

  it('matches what the synthesiser renders today (the files are reproducible)', () => {
    const fresh = buildSynthManifest();
    // Same file keys, so the in-browser fallback can stand in for any baked file.
    for (const name of SFX_NAMES) {
      expect(manifest.sfx[name].files).toEqual(fresh.sfx[name].files);
      expect(manifest.sfx[name].themes ?? null).toEqual(fresh.sfx[name].themes ?? null);
      expect(manifest.sfx[name].gain).toBe(fresh.sfx[name].gain);
    }
    for (const name of LOOP_NAMES) expect(manifest.loops[name].file).toBe(fresh.loops[name].file);
    for (const theme of THEME_IDS) {
      expect(manifest.music[theme].loopStartSample).toBe(fresh.music[theme].loopStartSample);
      expect(manifest.music[theme].loopEndSample).toBe(fresh.music[theme].loopEndSample);
    }
    // Spot-check sample data: baked WAV == fresh render within 16-bit quantisation and dither.
    const specs = listSfxFiles().filter((s) => ['ui_click', 'plush_land', 'win', 'start_game'].includes(s.name));
    for (const spec of specs) {
      const wav = decodeWav16(new Uint8Array(readFileSync(path.join(AUDIO_DIR, spec.file))));
      const now = renderSfx(spec.name, spec.variant, spec.theme);
      expect(wav.frames, spec.file).toBe(now.length);
      let maxErr = 0;
      for (let i = 0; i < now.length; i++) maxErr = Math.max(maxErr, Math.abs(wav.data[0]![i]! - now[i]!));
      expect(maxErr, spec.file).toBeLessThan(3 / 32768);
    }
    const loop = decodeWav16(new Uint8Array(readFileSync(path.join(AUDIO_DIR, manifest.loops.motor_trolley.file))));
    const loopNow = renderLoop('motor_trolley');
    let maxErr = 0;
    for (let i = 0; i < loopNow.length; i++) maxErr = Math.max(maxErr, Math.abs(loop.data[0]![i]! - loopNow[i]!));
    expect(maxErr).toBeLessThan(3 / 32768);
  });
});
