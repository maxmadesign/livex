import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, defaultSettings } from '../../../src/settings/spec';
import { createSettingsStore, migrate } from '../../../src/settings/store';
import { installMemoryStorage } from './memoryStorage';

let data: Map<string, string>;
beforeEach(() => {
  data = installMemoryStorage();
});
const KEY = 'plush-portal/settings';

describe('settings store', () => {
  it('starts with defaults and persists direct changes', () => {
    const store = createSettingsStore();
    expect(store.getState().settings).toEqual(defaultSettings());
    expect(store.getState().repaired).toBe(false);
    store.getState().set('audio.master', 0.33);
    const saved = JSON.parse(data.get(KEY)!);
    expect(saved.version).toBe(SETTINGS_VERSION);
    expect(saved.settings.audio.master).toBe(0.33);
    // A new store (page reload) sees the persisted value.
    expect(createSettingsStore().getState().settings.audio.master).toBe(0.33);
  });

  it('previews in a draft, restores on cancel and persists only on apply', () => {
    const store = createSettingsStore();
    const s = store.getState();
    s.beginEdit();
    store.getState().set('audio.music', 0.1);
    store.getState().set('gameplay.moveSpeed', 0.7);
    expect(store.getState().view().audio.music).toBe(0.1);
    expect(store.getState().settings.audio.music).toBe(defaultSettings().audio.music);
    expect(store.getState().isDirty()).toBe(true);
    expect(data.has(KEY)).toBe(false); // nothing written while previewing
    store.getState().cancelEdit();
    expect(store.getState().draft).toBeNull();
    expect(store.getState().view()).toEqual(defaultSettings());
    expect(data.has(KEY)).toBe(false);

    store.getState().beginEdit();
    store.getState().set('audio.music', 0.2);
    const changed = store.getState().applyEdit();
    expect(changed).toEqual(['audio.music']);
    expect(store.getState().settings.audio.music).toBe(0.2);
    expect(store.getState().isDirty()).toBe(false);
    expect(JSON.parse(data.get(KEY)!).settings.audio.music).toBe(0.2);
    // Cancelling after an apply keeps what was applied.
    store.getState().set('audio.music', 0.9);
    store.getState().cancelEdit();
    expect(store.getState().settings.audio.music).toBe(0.2);
  });

  it('repairs corrupt or foreign persisted data with safe defaults', () => {
    data.set(KEY, '{not json');
    expect(createSettingsStore().getState().settings).toEqual(defaultSettings());
    data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, settings: { audio: { master: 55 }, profiles: { portrait86: { layout: { safeTop: 0.6, safeBottom: 0.4 } } } } }));
    const repaired = createSettingsStore().getState();
    expect(repaired.repaired).toBe(true);
    expect(repaired.settings.audio.master).toBe(1);
    const l = repaired.settings.profiles.portrait86.layout;
    expect(l.safeBottom - l.safeTop).toBeGreaterThanOrEqual(0.3 - 1e-9);
    // Data written by a newer build is not trusted.
    data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION + 1, settings: { audio: { master: 0.1 } } }));
    expect(createSettingsStore().getState().settings.audio.master).toBe(defaultSettings().audio.master);
  });

  it('migrate accepts the current layout and rejects everything else', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate('x')).toBeNull();
    expect(migrate({ settings: {} })).toBeNull();
    expect(migrate({ version: 'one', settings: {} })).toBeNull();
    expect(migrate({ version: SETTINGS_VERSION + 5, settings: {} })).toBeNull();
    expect(migrate({ version: SETTINGS_VERSION, settings: { a: 1 } })).toEqual({ a: 1 });
  });

  it('exports without local secrets and re-imports the same configuration', () => {
    const a = createSettingsStore();
    a.getState().set('system.lockPin', '9876');
    a.getState().set('gameplay.moveSpeed', 0.66);
    a.getState().set('profiles.portrait86.layout.anchorY', 0.57);
    const text = a.getState().exportJson();
    expect(text).not.toContain('9876');
    expect(text).not.toContain('lockPin');
    const parsed = JSON.parse(text);
    expect(parsed.app).toBe('plush-portal');
    expect(parsed.version).toBe(SETTINGS_VERSION);

    data.clear();
    const b = createSettingsStore();
    b.getState().set('system.lockPin', '1111');
    const result = b.getState().importJson(text);
    expect(result.ok).toBe(true);
    expect(result.changed).toBeGreaterThanOrEqual(2);
    expect(b.getState().settings.gameplay.moveSpeed).toBe(0.66);
    expect(b.getState().settings.profiles.portrait86.layout.anchorY).toBe(0.57);
    expect(b.getState().settings.system.lockPin).toBe('1111'); // the PIN is never imported
  });

  it('rejects files that are not configurations and never imports a PIN or a lock', () => {
    const store = createSettingsStore();
    const before = store.getState().settings;
    expect(store.getState().importJson('{oops').ok).toBe(false);
    expect(store.getState().importJson('{oops').message).toBe('invalid_json');
    expect(store.getState().importJson('[1,2]').message).toBe('not_a_config');
    expect(store.getState().importJson(JSON.stringify({ version: 1, settings: {} })).message).toBe('not_a_config');
    expect(store.getState().importJson(JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION + 1, settings: {} })).message).toBe('unsupported_version');
    expect(store.getState().settings).toBe(before);

    const hostile = JSON.stringify({
      app: 'plush-portal',
      version: SETTINGS_VERSION,
      settings: {
        system: { lockPin: '0000', lockSettings: true },
        display: { profile: '' },
        profiles: { portrait86: { layout: { safeTop: 0.9, safeBottom: 0.1, anchorY: 5, uiScale: 99, panelWidth: -1 } } },
      },
    });
    store.getState().set('display.profile', 'portrait86');
    const result = store.getState().importJson(hostile);
    expect(result.ok).toBe(true);
    const s = store.getState().settings;
    expect(s.system.lockPin).toBe('');
    expect(s.system.lockSettings).toBe(false);
    expect(s.display.profile).toBe('portrait86'); // this device keeps its preset
    const l = s.profiles.portrait86.layout;
    expect(l.safeBottom - l.safeTop).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(l.anchorY).toBeGreaterThan(l.safeTop);
    expect(l.anchorY).toBeLessThan(l.safeBottom);
    expect(l.uiScale).toBeLessThanOrEqual(1.8);
    expect(l.panelWidth).toBeGreaterThanOrEqual(0.3);
  });

  it('imports into the draft while the dialog is open (cancel still restores)', () => {
    const store = createSettingsStore();
    store.getState().beginEdit();
    const text = JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION, settings: { audio: { master: 0.05 } } });
    expect(store.getState().importJson(text).ok).toBe(true);
    expect(store.getState().view().audio.master).toBe(0.05);
    expect(store.getState().settings.audio.master).toBe(defaultSettings().audio.master);
    store.getState().cancelEdit();
    expect(store.getState().view().audio.master).toBe(defaultSettings().audio.master);
  });

  it('resets one profile, one section or everything without touching the rest', () => {
    const store = createSettingsStore();
    const s = () => store.getState();
    s().set('display.profile', 'portrait32');
    s().set('system.language', 'ja');
    s().set('profiles.portrait86.layout.uiScale', 1.2);
    s().set('profiles.portrait32.layout.uiScale', 1.3);
    s().set('audio.master', 0.2);
    s().set('gameplay.clawForce', 1.7);
    s().resetProfile('portrait86');
    expect(s().settings.profiles.portrait86.layout.uiScale).toBe(defaultSettings().profiles.portrait86.layout.uiScale);
    expect(s().settings.profiles.portrait32.layout.uiScale).toBe(1.3);
    s().resetSection('audio');
    expect(s().settings.audio.master).toBe(defaultSettings().audio.master);
    expect(s().settings.gameplay.clawForce).toBe(1.7);
    s().resetAll();
    expect(s().settings.gameplay.clawForce).toBe(defaultSettings().gameplay.clawForce);
    expect(s().settings.profiles.portrait32.layout.uiScale).toBe(defaultSettings().profiles.portrait32.layout.uiScale);
    // The screen stays usable after a full reset: preset and language are kept.
    expect(s().settings.display.profile).toBe('portrait32');
    expect(s().settings.system.language).toBe('ja');
  });

  it('survives storage that throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    const store = createSettingsStore();
    expect(store.getState().settings).toEqual(defaultSettings());
    expect(() => store.getState().set('audio.master', 0.4)).not.toThrow();
    expect(store.getState().settings.audio.master).toBe(0.4);
  });
});
