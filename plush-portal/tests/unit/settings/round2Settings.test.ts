import { beforeEach, describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS, GRAPHICS_PRESET_KEYS, applyGraphicsPreset } from '../../../src/app/presets';
import { LANGS } from '../../../src/core/types';
import { hasString } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { SETTINGS_VERSION, defaultSettings, getFieldAt, getValueAt, sanitizeSettings, setValueAt, type Settings } from '../../../src/settings/spec';
import { createSettingsStore } from '../../../src/settings/store';
import { labelKey } from '../../../src/ui/settings/Field';
import { installMemoryStorage } from './memoryStorage';

registerAllStrings();

/** The settings added for the second feature round, with their declared shape. */
const NEW_FIELDS = {
  'gameplay.scoring': { kind: 'bool', def: true },
  'graphics.fxIntensity': { kind: 'num', def: 1, min: 0, max: 1.5, step: 0.05 },
  'graphics.lightShow': { kind: 'bool', def: true },
  'system.idleSeconds': { kind: 'num', def: 60, min: 0, max: 600, step: 5 },
  'system.attractDemo': { kind: 'bool', def: true },
  'camera.autoCalibrate': { kind: 'bool', def: true },
  'camera.calibrationSeconds': { kind: 'num', def: 3, min: 1, max: 10, step: 1 },
  'ai.voiceLanguage': { kind: 'enum', def: 'en', options: ['en', 'ui'] },
} as const;

describe('round 2 settings', () => {
  it('declares every new field with its range, default and live apply mode', () => {
    const d = defaultSettings();
    for (const [path, want] of Object.entries(NEW_FIELDS)) {
      const field = getFieldAt(path);
      expect(field, path).not.toBeNull();
      expect(field!.apply, path).toBe('live');
      expect(field, path).toMatchObject(want);
      expect(getValueAt(d, path), path).toEqual(want.def);
    }
  });

  it('sanitises out-of-range, off-grid and wrongly typed values', () => {
    const s = sanitizeSettings({
      gameplay: { scoring: 'yes' },
      graphics: { fxIntensity: 7, lightShow: 1 },
      system: { idleSeconds: -20, attractDemo: null },
      camera: { autoCalibrate: 'no', calibrationSeconds: 99 },
      ai: { voiceLanguage: 'fr' },
    });
    expect(s.gameplay.scoring).toBe(true);
    expect(s.graphics.fxIntensity).toBe(1.5);
    expect(s.graphics.lightShow).toBe(true);
    expect(s.system.idleSeconds).toBe(0);
    expect(s.system.attractDemo).toBe(true);
    expect(s.camera.autoCalibrate).toBe(true);
    expect(s.camera.calibrationSeconds).toBe(10);
    expect(s.ai.voiceLanguage).toBe('en');
    const t = sanitizeSettings({ graphics: { fxIntensity: 0.73, lightShow: false }, system: { idleSeconds: 0 }, camera: { calibrationSeconds: 4.4 }, ai: { voiceLanguage: 'ui' }, gameplay: { scoring: false } });
    expect(t.graphics.fxIntensity).toBe(0.75);
    expect(t.graphics.lightShow).toBe(false);
    expect(t.system.idleSeconds).toBe(0); // 0 = never reset
    expect(t.camera.calibrationSeconds).toBe(4);
    expect(t.ai.voiceLanguage).toBe('ui');
    expect(t.gameplay.scoring).toBe(false);
    expect(setValueAt(defaultSettings(), 'system.idleSeconds', 123).system.idleSeconds).toBe(125);
  });

  it('gives the phone preset its own profile, independent of desktop', () => {
    const d = defaultSettings();
    expect(Object.keys(d.profiles.mobile.layout).sort()).toEqual(Object.keys(d.profiles.desktop.layout).sort());
    expect(Object.keys(d.profiles.mobile.view).sort()).toEqual(Object.keys(d.profiles.desktop.view).sort());
    const b = setValueAt(d, 'profiles.mobile.layout.uiScale', 1.2);
    expect(b.profiles.desktop).toEqual(d.profiles.desktop);
    expect(b.profiles.mobile.layout.uiScale).toBe(1.2);
  });

  it('graphics presets carry the two effect values and stay on the slider grid', () => {
    expect(GRAPHICS_PRESETS.safe).toMatchObject({ fxIntensity: 0.5, lightShow: false });
    expect(GRAPHICS_PRESETS.medium).toMatchObject({ fxIntensity: 1, lightShow: true });
    expect(GRAPHICS_PRESETS.high).toMatchObject({ fxIntensity: 1.2, lightShow: true });
    expect(GRAPHICS_PRESETS.ultra).toMatchObject({ fxIntensity: 1.5, lightShow: true });
    expect(GRAPHICS_PRESET_KEYS).toContain('fxIntensity');
    expect(GRAPHICS_PRESET_KEYS).toContain('lightShow');
    const field = getFieldAt('graphics.fxIntensity')!;
    for (const [name, preset] of Object.entries(GRAPHICS_PRESETS)) {
      expect(Object.keys(preset).sort(), name).toEqual([...GRAPHICS_PRESET_KEYS].sort());
      if (field.kind === 'num') {
        const steps = (preset.fxIntensity - field.min) / field.step;
        expect(Math.abs(steps - Math.round(steps)), name).toBeLessThan(1e-6);
      }
    }
    // A fresh install (preset Medium) has exactly Medium's values.
    const d = defaultSettings();
    for (const key of GRAPHICS_PRESET_KEYS) expect(d.graphics[key], key).toBe(GRAPHICS_PRESETS.medium[key]);
    // Applying a preset writes the effect values too.
    let s: Settings = defaultSettings();
    applyGraphicsPreset((path, value) => (s = setValueAt(s, path, value)), 'safe');
    expect(s.graphics.fxIntensity).toBe(0.5);
    expect(s.graphics.lightShow).toBe(false);
    expect(s.graphics.preset).toBe('safe');
  });

  it('has a label (and help where meant) for every new field and option in every language', () => {
    for (const [path, want] of Object.entries(NEW_FIELDS)) {
      const key = labelKey(path);
      for (const lang of LANGS) {
        expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        if (path !== 'system.attractDemo') expect(hasString(lang, `${key}.hint`), `${lang}:${key}.hint`).toBe(true);
        if (want.kind === 'enum') for (const o of want.options) expect(hasString(lang, `${key}.o.${o}`), `${lang}:${key}.o.${o}`).toBe(true);
      }
    }
    for (const lang of LANGS) expect(hasString(lang, 'sec.graphics.fx'), lang).toBe(true);
  });
});

describe('round 2 settings: stored data from before', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = installMemoryStorage();
  });
  const KEY = 'plush-portal/settings';

  it('loads settings saved without the new keys with the new defaults and keeps everything else', () => {
    const old = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    delete old.gameplay!.scoring;
    delete old.graphics!.fxIntensity;
    delete old.graphics!.lightShow;
    delete old.system!.idleSeconds;
    delete old.camera!.autoCalibrate;
    delete old.camera!.calibrationSeconds;
    delete old.ai!.voiceLanguage;
    delete (old.profiles as Record<string, unknown>).mobile;
    old.audio!.master = 0.42;
    old.themes!.current = 'ocean';
    data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, settings: old }));
    const loaded = createSettingsStore().getState().settings;
    const d = defaultSettings();
    expect(loaded.gameplay.scoring).toBe(true);
    expect(loaded.graphics.fxIntensity).toBe(1);
    expect(loaded.graphics.lightShow).toBe(true);
    expect(loaded.system.idleSeconds).toBe(60);
    expect(loaded.camera.autoCalibrate).toBe(true);
    expect(loaded.camera.calibrationSeconds).toBe(3);
    expect(loaded.ai.voiceLanguage).toBe('en');
    expect(loaded.profiles.mobile).toEqual(d.profiles.mobile);
    expect(loaded.audio.master).toBe(0.42);
    expect(loaded.themes.current).toBe('ocean');
    expect(loaded).toEqual({ ...d, audio: { ...d.audio, master: 0.42 }, themes: { ...d.themes, current: 'ocean' } });
  });

  it('gives an older stored named graphics preset the effect values of that preset', () => {
    const cases = [
      ['safe', 0.5, false],
      ['medium', 1, true],
      ['high', 1.2, true],
      ['ultra', 1.5, true],
      ['custom', 1, true], // no preset to follow: plain defaults
    ] as const;
    for (const [preset, fx, show] of cases) {
      const old = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
      old.graphics!.preset = preset;
      delete old.graphics!.fxIntensity;
      delete old.graphics!.lightShow;
      data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, settings: old }));
      const g = createSettingsStore().getState().settings.graphics;
      expect(g.preset, preset).toBe(preset);
      expect(g.fxIntensity, preset).toBe(fx);
      expect(g.lightShow, preset).toBe(show);
      if (preset !== 'custom') {
        expect(g.fxIntensity, preset).toBe(GRAPHICS_PRESETS[preset].fxIntensity);
        expect(g.lightShow, preset).toBe(GRAPHICS_PRESETS[preset].lightShow);
      }
    }
    // Values that were stored are kept, even when they differ from the preset.
    const kept = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    kept.graphics!.preset = 'safe';
    kept.graphics!.fxIntensity = 0.8;
    delete kept.graphics!.lightShow;
    data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, settings: kept }));
    const g = createSettingsStore().getState().settings.graphics;
    expect(g.fxIntensity).toBe(0.8);
    expect(g.lightShow).toBe(false);
    // The same applies to an imported configuration file.
    const store = createSettingsStore();
    const exported = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    exported.graphics!.preset = 'ultra';
    delete exported.graphics!.fxIntensity;
    expect(store.getState().importJson(JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION, settings: exported })).ok).toBe(true);
    expect(store.getState().settings.graphics.fxIntensity).toBe(1.5);
  });

  it('imports a configuration file exported before the new keys existed', () => {
    const store = createSettingsStore();
    const old = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    delete old.graphics!.fxIntensity;
    delete old.system!.idleSeconds;
    old.graphics!.bloom = 0.5;
    const result = store.getState().importJson(JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION, settings: old }));
    expect(result.ok).toBe(true);
    const s = store.getState().settings;
    expect(s.graphics.fxIntensity).toBe(1);
    expect(s.system.idleSeconds).toBe(60);
    expect(s.graphics.bloom).toBe(0.5);
  });
});
