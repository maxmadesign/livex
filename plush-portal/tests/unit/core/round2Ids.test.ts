import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_SOURCE_THEMES, AUDIO_THEME_SOURCE, MUSIC_SCORES, buildSynthManifest, musicFileKey } from '../../../src/audio/synth/index';
import { THEME_PROMPT_INFO } from '../../../src/ai/prompt';
import { LINE_BANKS, LINE_KEYS } from '../../../src/ai/lines';
import { createNullTracker } from '../../../src/app/nullPorts';
import { INITIAL_TRACKER } from '../../../src/app/gameStore';
import { IDLE_CALIBRATION, type TrackerPort } from '../../../src/core/contracts';
import { DISPLAY_PROFILE_IDS, LANGS, THEME_IDS } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { DESIGN } from '../../../src/layout/solve';
import type { PlushAsset, PlushManifest } from '../../../src/plush/manifest';
import { PlushLibrary } from '../../../src/plush/PlushLibrary';
import { Effects } from '../../../src/scene/Effects';
import type { FxApi } from '../../../src/scene/fx/api';
import { defaultSettings, profileDefaults } from '../../../src/settings/spec';
import { THEMES } from '../../../src/themes/themes';
import { createFaceTracker } from '../../../src/tracking/FaceTracker';
import { loadManifest } from '../game/harness';

registerAllStrings();

describe('theme and display preset ids', () => {
  it('add GPU Party as the fifth theme and the phone as the fourth preset, both last', () => {
    expect(THEME_IDS).toEqual(['sakura', 'storybook', 'ocean', 'cosmic', 'gpu']);
    expect(DISPLAY_PROFILE_IDS).toEqual(['desktop', 'portrait32', 'portrait86', 'mobile']);
  });

  it('every theme-keyed table has an entry for every theme', () => {
    for (const id of THEME_IDS) {
      expect(THEMES[id]?.id, id).toBe(id);
      expect(THEME_PROMPT_INFO[id]?.name, id).toBeTruthy();
      expect(MUSIC_SCORES[id], id).toBeDefined();
      expect(AUDIO_SOURCE_THEMES, id).toContain(AUDIO_THEME_SOURCE[id]);
      expect(buildSynthManifest().music[id]?.file, id).toBe(musicFileKey(id));
      for (const lang of LANGS) {
        for (const key of [`theme.${id}.name`, `theme.${id}.tagline`, `set.audio.track.o.${id}`, `audio.track.${id}`]) {
          expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        }
      }
    }
    // The settings enums follow the id list.
    expect(defaultSettings().themes.current).toBe('sakura');
  });

  it('every preset-keyed table has an entry for every display preset', () => {
    const d = defaultSettings();
    for (const id of DISPLAY_PROFILE_IDS) {
      expect(DESIGN[id], id).toBeDefined();
      expect(d.profiles[id], id).toBeDefined();
      for (const lang of LANGS) {
        for (const key of [`device.${id}.name`, `device.${id}.desc`]) expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
      }
    }
  });

  it('names the new theme and preset in every language', () => {
    const names: Record<string, [string, string, string]> = {
      'theme.gpu.name': ['GPU Party', '显卡派对', 'GPUパーティー'],
      'device.mobile.name': ['Phone', '手机', 'スマートフォン'],
    };
    for (const [key, [en, zh, ja]] of Object.entries(names)) {
      expect(translate('en', key)).toBe(en);
      expect(translate('zh', key)).toBe(zh);
      expect(translate('ja', key)).toBe(ja);
    }
  });

  // Only the contract is pinned here (palette from the brief, a complete definition of its own).
  // Placeholder choices (Cosmic's backdrop pattern, particles, music and characters) are left
  // to the GPU theme work, so it does not have to edit this shared file.
  it('GPU Party has its own dark theme definition with the green palette', () => {
    const gpu = THEMES.gpu;
    expect(gpu.ui.primary).toBe('#76b900');
    expect(gpu.ui.primaryDeep).toBe('#4e7a00');
    expect(gpu.ui.accent).toBe('#9be33a');
    expect(gpu.ui.ink).toBe('#eaffd0');
    expect(gpu.ui.paper).toBe('#10140c');
    expect(gpu.ui.panel).toBe('#1a2212');
    expect(gpu.ui.glow).toBe('#b6ff5c');
    expect(gpu).not.toBe(THEMES.cosmic);
    expect(gpu.cabinet.led.length).toBeGreaterThan(0);
    expect(gpu.particles.colors.length).toBeGreaterThan(0);
  });

  it('the phone preset has its own defaults and design size (tuned by the mobile work)', () => {
    const d = profileDefaults('mobile');
    expect(d.layout).toBeDefined();
    expect(d.view).toBeDefined();
    expect(DESIGN.mobile.w).toBeGreaterThan(0);
    expect(DESIGN.mobile.h).toBeGreaterThan(0);
  });

  it('every theme has local guide lines wherever a theme matters', () => {
    for (const lang of LANGS) {
      for (const key of LINE_KEYS) {
        const pool = LINE_BANKS[lang].lines[key];
        if (pool.cosmic) expect(pool.gpu, `${lang}:${key}`).toBeDefined();
      }
    }
  });
});

describe('plush library: a theme without characters', () => {
  afterEach(() => vi.restoreAllMocks());

  it('borrows another theme’s characters (warning once) so the machine is never empty', () => {
    // A manifest without GPU characters, whether or not the real one has them by now.
    const real = loadManifest();
    const lib = new PlushLibrary('/');
    lib.manifest = { ...real, assets: real.assets.filter((a) => a.theme !== 'gpu') } as PlushManifest;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cosmic = lib.assets('cosmic');
    expect(cosmic.length).toBeGreaterThan(0);
    expect(lib.assets('gpu').map((a: PlushAsset) => a.id)).toEqual(cosmic.map((a) => a.id));
    expect(lib.assetTheme('gpu')).toBe('cosmic');
    lib.assets('gpu');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lib.warnings.filter((w) => w.includes('"gpu"'))).toHaveLength(1);
    // Themes with their own characters are unaffected.
    expect(lib.assetTheme('sakura')).toBe('sakura');
    expect(lib.assets('sakura').every((a) => a.theme === 'sakura')).toBe(true);
  });

  it('falls back to the first theme in the manifest when the preferred stand-in is missing too', () => {
    const real = loadManifest();
    const lib = new PlushLibrary('/');
    lib.manifest = { ...real, assets: real.assets.filter((a) => a.theme === 'ocean') } as PlushManifest;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(lib.assetTheme('gpu')).toBe('ocean');
    expect(lib.assets('gpu').length).toBeGreaterThan(0);
  });
});

describe('effects contract', () => {
  it('Effects implements FxApi and accepts every call', () => {
    const effects = new Effects();
    const fx: FxApi = effects;
    const at = { x: 0, y: 0.2, z: -0.2 };
    for (const kind of ['grab', 'contact', 'lift', 'slip', 'drop', 'restock', 'combo', 'score', 'cta'] as const) fx.burst(kind, at, { tier: 'rare', scale: 1, color: '#ffffff' });
    fx.celebrate('legendary', at);
    fx.aura(at, 'epic');
    fx.aura(null);
    fx.lightShow('attract');
    fx.setIntensity(1.2);
    fx.setLightShowEnabled(false);
    // fxState() also carries live counters (particles, draw calls, beams, …); only the settings are pinned.
    expect(effects.fxState()).toMatchObject({ intensity: 1.2, lightShowEnabled: false, lightShow: 'attract' });
    effects.dispose();
  });
});

describe('tracker calibration contract', () => {
  it('the null tracker reports an idle calibration and ignores start / cancel', () => {
    const tracker: TrackerPort = createNullTracker('test');
    expect(tracker.status().calibration).toEqual({ phase: 'idle', remaining: 0, detail: '' });
    expect(() => tracker.startCalibration(3)).not.toThrow();
    expect(() => tracker.cancelCalibration()).not.toThrow();
    expect(tracker.status().calibration.phase).toBe('idle');
    expect(INITIAL_TRACKER.calibration).toEqual(IDLE_CALIBRATION);
  });

  it('the camera tracker exposes the same contract: idle before any calibration, start / cancel never throw', () => {
    const tracker = createFaceTracker({ openCamera: () => new Promise(() => undefined), listCameras: async () => [], assetBase: 'http://localhost/mediapipe/' });
    expect(tracker.status().calibration).toEqual(IDLE_CALIBRATION);
    // The tracker is not running here: the calibration work decides whether that reads idle or failed.
    expect(() => tracker.startCalibration(3)).not.toThrow();
    expect(['idle', 'countdown', 'capturing', 'done', 'failed']).toContain(tracker.status().calibration.phase);
    expect(() => tracker.cancelCalibration()).not.toThrow();
    expect(['idle', 'failed']).toContain(tracker.status().calibration.phase);
    tracker.dispose();
  });
});
