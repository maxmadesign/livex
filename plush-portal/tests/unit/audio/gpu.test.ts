import { beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIO_SOURCE_THEMES,
  AUDIO_THEME_SOURCE,
  MUSIC_SCORES,
  SR,
  Timeline,
  buildSynthManifest,
  dbToGain,
  hasInvalidSamples,
  listSfxFiles,
  musicFileKey,
  parseChord,
  parseLine,
  peakOf,
  renderMusic,
  renderSfx,
  type MusicRender,
} from '../../../src/audio/synth/index';

/** E major / C# minor pitch classes. */
const E_MAJOR = [4, 6, 8, 9, 11, 1, 3];

let gpu: MusicRender;

beforeAll(() => {
  gpu = renderMusic('gpu');
}, 120_000);

/** Energy per pitch class measured from the audio (Goertzel over MIDI 48..95). */
function chroma(mono: Float32Array): number[] {
  const out = new Array<number>(12).fill(0);
  const frame = 8192;
  for (let midi = 48; midi <= 95; midi++) {
    const w = (2 * Math.PI * 440 * Math.pow(2, (midi - 69) / 12)) / SR;
    const c = Math.cos(w);
    const s = Math.sin(w);
    let acc = 0;
    for (let start = 0; start + frame <= mono.length; start += frame * 3) {
      let re = 0;
      let im = 0;
      let cr = 1;
      let ci = 0;
      for (let i = 0; i < frame; i++) {
        const x = mono[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame));
        re += x * cr;
        im += x * ci;
        const n = cr * c - ci * s;
        ci = cr * s + ci * c;
        cr = n;
      }
      acc += re * re + im * im;
    }
    out[midi % 12] = out[midi % 12]! + acc;
  }
  return out;
}

describe('GPU Party audio', () => {
  it('has its own track, jingles and file keys (no longer borrowed from Cosmic Arcade)', () => {
    expect(AUDIO_THEME_SOURCE.gpu).toBe('gpu');
    expect(AUDIO_SOURCE_THEMES).toContain('gpu');
    expect(MUSIC_SCORES.gpu.data).not.toBe(MUSIC_SCORES.cosmic.data);
    expect(MUSIC_SCORES.gpu.data.meta.title).toBe('Overclock Party');
    expect(musicFileKey('gpu')).toBe('music/gpu.mp3');
    const files = listSfxFiles().filter((f) => f.theme === 'gpu').map((f) => f.file);
    expect(files).toEqual(['sfx/win_gpu.wav', 'sfx/theme_sting_gpu.wav']);
    const manifest = buildSynthManifest();
    expect(manifest.sfx.win.themes?.gpu).toEqual(['sfx/win_gpu.wav']);
    expect(manifest.sfx.theme_sting.themes?.gpu).toEqual(['sfx/theme_sting_gpu.wav']);
  });

  it('is a seamless 32-bar loop of 60–90 s at about 120 BPM, aligned to MP3 frames', () => {
    const { meta } = MUSIC_SCORES.gpu.data;
    expect(meta.bpm).toBe(120);
    expect(meta.bars).toBe(32);
    const tl = new Timeline(meta.bpm, meta.beatsPerBar, meta.bars);
    const n = gpu.loop.l.length;
    expect(n).toBe(tl.loopSamples);
    expect(n % 1152).toBe(0);
    expect(n / SR).toBeGreaterThanOrEqual(60);
    expect(n / SR).toBeLessThanOrEqual(90);
    expect(Math.abs(tl.effectiveBpm - 120)).toBeLessThan(0.01);
    // The file around the loop is periodic: pre-roll = end of the loop, post-roll = start of the loop.
    const { file } = gpu;
    for (let i = 0; i < file.l.length - n; i += 101) {
      expect(file.l[i]).toBe(file.l[i + n]);
      expect(file.r[i]).toBe(file.r[i + n]);
    }
  });

  it('does not clip, is finite and sits at the shared −16 LUFS target', () => {
    const { loop } = gpu;
    expect(hasInvalidSamples(loop.l, loop.r)).toBe(false);
    expect(peakOf(loop.l, loop.r)).toBeLessThanOrEqual(dbToGain(-1.5) + 1e-4);
    expect(loop.lufs).toBeGreaterThan(-16.6);
    expect(loop.lufs).toBeLessThan(-15.4);
    // The limiter only catches stray peaks; it never pumps the mix.
    expect(loop.limiterDb).toBeLessThan(3);
  });

  it('is written in E major: chords, melody and the measured pitch content', () => {
    const { progression, melody } = MUSIC_SCORES.gpu.data;
    for (const symbol of progression.flatMap((bar) => bar.trim().split(/\s+/))) {
      for (const pc of parseChord(symbol).pcs) expect(E_MAJOR, symbol).toContain(pc);
    }
    for (const note of parseLine(melody.replace(/\|/g, ' ')).notes) expect(E_MAJOR, `midi ${note.midi}`).toContain(note.midi % 12);
    const mono = new Float32Array(gpu.loop.l.length);
    for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (gpu.loop.l[i]! + gpu.loop.r[i]!);
    const c = chroma(mono);
    const total = c.reduce((a, b) => a + b, 0);
    const diatonic = c.reduce((a, v, i) => a + (E_MAJOR.includes(i) ? v : 0), 0);
    expect(diatonic / total).toBeGreaterThan(0.8);
    // The tonic triad (E, G#, B) is among the strongest pitch classes.
    const top = c.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, i]) => i);
    expect(top.filter((pc) => [4, 8, 11].includes(pc)).length).toBeGreaterThanOrEqual(2);
  });

  it('renders short, clean jingles that differ from Cosmic Arcade', () => {
    for (const name of ['win', 'theme_sting'] as const) {
      const mine = renderSfx(name, 0, 'gpu');
      const cosmic = renderSfx(name, 0, 'cosmic');
      expect(hasInvalidSamples(mine), name).toBe(false);
      expect(mine.length / SR, name).toBeLessThan(name === 'win' ? 1.2 : 0.9);
      expect(Math.abs(mine[0]!)).toBeLessThan(1e-3);
      expect(Math.abs(mine[mine.length - 1]!)).toBeLessThan(1e-3);
      const n = Math.min(mine.length, cosmic.length);
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i < n; i++) {
        ab += mine[i]! * cosmic[i]!;
        aa += mine[i]! ** 2;
        bb += cosmic[i]! ** 2;
      }
      expect(Math.abs(ab / Math.sqrt(aa * bb)), name).toBeLessThan(0.5);
    }
  });
});
