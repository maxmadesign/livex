import { describe, expect, it } from 'vitest';
import { LOOP_NAMES, SFX_NAMES } from '../../../src/core/contracts';
import { THEME_IDS } from '../../../src/core/types';
import {
  LOOP_FILE_PEAK_DB,
  LOOP_RECIPES,
  SFX_FILE_PEAK_DB,
  SFX_RECIPES,
  SR,
  bandEnergiesDb,
  buildSynthManifest,
  gainToDb,
  hasInvalidSamples,
  listSfxFiles,
  loopFileName,
  parseAudioManifest,
  peakOf,
  renderFileByKey,
  renderLoop,
  renderSfx,
} from '../../../src/audio/synth/index';

describe('sfx recipes', () => {
  it('cover every effect and loop named in the contract', () => {
    for (const name of SFX_NAMES) {
      expect(SFX_RECIPES[name], name).toBeDefined();
      expect(SFX_RECIPES[name].variants).toBeGreaterThanOrEqual(1);
      expect(SFX_RECIPES[name].gain).toBeGreaterThan(0);
      expect(SFX_RECIPES[name].gain).toBeLessThanOrEqual(1);
    }
    for (const name of LOOP_NAMES) expect(LOOP_RECIPES[name], name).toBeDefined();
    expect(Object.keys(SFX_RECIPES).sort()).toEqual([...SFX_NAMES].sort());
  });

  it('give repetitive effects several variants and themed jingles one per theme', () => {
    for (const name of ['ui_click', 'dir_tick', 'claw_touch', 'plush_rub', 'plush_land', 'glass_tap'] as const) {
      expect(SFX_RECIPES[name].variants, name).toBeGreaterThanOrEqual(2);
    }
    const files = listSfxFiles();
    for (const name of ['win', 'theme_sting'] as const) {
      expect(SFX_RECIPES[name].themed).toBe(true);
      for (const theme of THEME_IDS) expect(files.some((f) => f.name === name && f.theme === theme), `${name}@${theme}`).toBe(true);
    }
    expect(new Set(files.map((f) => f.file)).size).toBe(files.length);
  });

  it('render clean one-shots: finite, normalised, click-free edges, sane length, no DC', () => {
    let totalSeconds = 0;
    for (const spec of listSfxFiles()) {
      const buf = renderSfx(spec.name, spec.variant, spec.theme);
      const id = spec.file;
      totalSeconds += buf.length / SR;
      expect(hasInvalidSamples(buf), id).toBe(false);
      expect(buf.length / SR, id).toBeGreaterThan(0.012);
      expect(buf.length / SR, id).toBeLessThan(spec.theme ? 2.2 : 1.4);
      expect(gainToDb(peakOf(buf)), id).toBeGreaterThan(SFX_FILE_PEAK_DB - 1);
      expect(gainToDb(peakOf(buf)), id).toBeLessThanOrEqual(SFX_FILE_PEAK_DB + 0.01);
      expect(Math.abs(buf[0]!), id).toBeLessThan(1e-3);
      expect(Math.abs(buf[buf.length - 1]!), id).toBeLessThan(1e-3);
      let dc = 0;
      for (let i = 0; i < buf.length; i++) dc += buf[i]!;
      expect(Math.abs(dc / buf.length), id).toBeLessThan(5e-3);
      // "Never harsh": the top octave never dominates the body of the sound.
      const b = bandEnergiesDb(buf);
      expect(b.air - Math.max(b.low, b.lowMid, b.mid, b.high), id).toBeLessThan(0);
    }
    // 16-bit mono budget for all one-shots plus loops (≈2.5 MB).
    for (const name of LOOP_NAMES) totalSeconds += LOOP_RECIPES[name].seconds;
    expect(totalSeconds * SR * 2).toBeLessThan(2.7e6);
  });

  it('render themed jingles that differ per theme', () => {
    for (const name of ['win', 'theme_sting'] as const) {
      const renders = THEME_IDS.map((t) => renderSfx(name, 0, t));
      for (let a = 0; a < renders.length; a++) {
        for (let b = a + 1; b < renders.length; b++) {
          const n = Math.min(renders[a]!.length, renders[b]!.length);
          let ab = 0;
          let aa = 0;
          let bb = 0;
          for (let i = 0; i < n; i++) {
            ab += renders[a]![i]! * renders[b]![i]!;
            aa += renders[a]![i]! ** 2;
            bb += renders[b]![i]! ** 2;
          }
          expect(Math.abs(ab / Math.sqrt(aa * bb)), `${name} ${THEME_IDS[a]} vs ${THEME_IDS[b]}`).toBeLessThan(0.5);
        }
      }
    }
  });

  it('are deterministic', () => {
    expect(renderSfx('plush_land', 2)).toEqual(renderSfx('plush_land', 2));
    expect(renderSfx('win', 0, 'ocean')).toEqual(renderSfx('win', 0, 'ocean'));
    expect(renderSfx('plush_land', 1)).not.toEqual(renderSfx('plush_land', 2));
  });

  it('render motor loops that are exactly periodic', () => {
    for (const name of LOOP_NAMES) {
      const buf = renderLoop(name);
      const n = buf.length;
      expect(n).toBe(Math.round(LOOP_RECIPES[name].seconds * SR));
      expect(hasInvalidSamples(buf)).toBe(false);
      expect(gainToDb(peakOf(buf))).toBeCloseTo(LOOP_FILE_PEAK_DB, 1);
      let sum = 0;
      let max = 0;
      for (let i = 1; i < n; i++) {
        const d = Math.abs(buf[i]! - buf[i - 1]!);
        sum += d;
        if (d > max) max = d;
      }
      const seam = Math.abs(buf[0]! - buf[n - 1]!);
      expect(seam, name).toBeLessThan((sum / n) * 3);
      expect(seam, name).toBeLessThan(max);
      // Periodic also in slope: the step across the seam continues the local trend.
      const slopeIn = buf[n - 1]! - buf[n - 2]!;
      const slopeOut = buf[1]! - buf[0]!;
      expect(Math.abs(buf[0]! - buf[n - 1]! - (slopeIn + slopeOut) / 2), name).toBeLessThan(max);
    }
  });
});

describe('synth fallback manifest', () => {
  it('is a valid manifest whose every file key can be rendered', () => {
    const manifest = buildSynthManifest();
    const parsed = parseAudioManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.problems).toEqual([]);
    const keys = new Set<string>();
    for (const name of SFX_NAMES) {
      const e = manifest.sfx[name];
      expect(e.files.length, name).toBeGreaterThan(0);
      for (const f of e.files) keys.add(f);
      for (const theme of THEME_IDS) for (const f of e.themes?.[theme] ?? []) keys.add(f);
    }
    for (const name of LOOP_NAMES) {
      expect(manifest.loops[name].file).toBe(loopFileName(name));
      keys.add(manifest.loops[name].file);
    }
    for (const key of keys) {
      const rendered = renderFileByKey(key);
      expect(rendered, key).not.toBeNull();
      expect(rendered!.channels[0]!.length, key).toBeGreaterThan(100);
    }
    expect(renderFileByKey('sfx/does_not_exist.wav')).toBeNull();
    for (const theme of THEME_IDS) {
      const m = manifest.music[theme];
      expect(m.loopEnd - m.loopStart).toBeGreaterThanOrEqual(60);
      expect((m.loopEndSample - m.loopStartSample) % 1152).toBe(0);
    }
  });

  it('rejects broken manifests with a list of problems', () => {
    expect(parseAudioManifest(null).manifest).toBeNull();
    const broken = JSON.parse(JSON.stringify(buildSynthManifest())) as Record<string, Record<string, unknown>>;
    delete broken.sfx!.win;
    (broken.music!.ocean as Record<string, unknown>).loopEnd = 0;
    const res = parseAudioManifest(broken);
    expect(res.manifest).toBeNull();
    expect(res.problems.join(' ')).toContain('sfx.win');
    expect(res.problems.join(' ')).toContain('music.ocean');
  });
});
