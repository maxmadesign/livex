import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, defaultSettings, getFieldAt } from '../../../src/settings/spec';
import { createSettingsStore, migrate } from '../../../src/settings/store';
import { installMemoryStorage } from '../settings/memoryStorage';

let data: Map<string, string>;
beforeEach(() => {
  data = installMemoryStorage();
});
const KEY = 'plush-portal/settings';

function stored(mutate: (s: Record<string, Record<string, unknown>>) => void): string {
  const s = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
  mutate(s);
  return JSON.stringify({ version: SETTINGS_VERSION, settings: s });
}

describe('stored settings housekeeping', () => {
  it('writes repaired settings back once, so the "repaired" warning appears only on that load', () => {
    data.set(KEY, stored((s) => {
      delete s.gameplay!.scoring;
      delete s.graphics!.fxIntensity;
      s.audio!.master = 0.4;
    }));
    const first = createSettingsStore().getState();
    expect(first.repaired).toBe(true);
    expect(JSON.parse(data.get(KEY)!).settings).toEqual(first.settings);
    const second = createSettingsStore().getState();
    expect(second.repaired).toBe(false);
    expect(second.settings).toEqual(first.settings);
    expect(second.settings.audio.master).toBe(0.4);
  });

  it('a fresh install writes nothing and a clean store is not touched', () => {
    expect(createSettingsStore().getState().repaired).toBe(false);
    expect(data.has(KEY)).toBe(false);
    const clean = JSON.stringify({ version: SETTINGS_VERSION, settings: defaultSettings() });
    data.set(KEY, clean);
    expect(createSettingsStore().getState().repaired).toBe(false);
    expect(data.get(KEY)).toBe(clean);
  });

  it('leaves data written by a newer build alone', () => {
    const newer = JSON.stringify({ version: SETTINGS_VERSION + 1, settings: { audio: { master: 0.1 } } });
    data.set(KEY, newer);
    expect(createSettingsStore().getState().repaired).toBe(true);
    expect(data.get(KEY)).toBe(newer);
  });

  it('retires system.attractIdleSec: a customised value carries over into system.idleSeconds', () => {
    expect(getFieldAt('system.attractIdleSec')).toBeNull();
    expect('attractIdleSec' in defaultSettings().system).toBe(false);

    // Customised old value, idleSeconds never set (saved before it existed).
    data.set(KEY, stored((s) => {
      s.system!.attractIdleSec = 120;
      delete s.system!.idleSeconds;
    }));
    expect(createSettingsStore().getState().settings.system.idleSeconds).toBe(120);
    // The old key is gone from storage after the write-back.
    expect(JSON.parse(data.get(KEY)!).settings.system.attractIdleSec).toBeUndefined();

    // Old default: nothing to carry over, idleSeconds keeps its own default.
    data.set(KEY, stored((s) => {
      s.system!.attractIdleSec = 45;
      delete s.system!.idleSeconds;
    }));
    expect(createSettingsStore().getState().settings.system.idleSeconds).toBe(60);

    // idleSeconds still at its default next to a customised old value: the old value wins.
    data.set(KEY, stored((s) => {
      s.system!.attractIdleSec = 300;
    }));
    expect(createSettingsStore().getState().settings.system.idleSeconds).toBe(300);

    // An explicitly chosen idleSeconds is kept.
    data.set(KEY, stored((s) => {
      s.system!.attractIdleSec = 300;
      s.system!.idleSeconds = 90;
    }));
    expect(createSettingsStore().getState().settings.system.idleSeconds).toBe(90);

    // Out-of-range old values are read like the old setting read them (10 … 600, step 5).
    data.set(KEY, stored((s) => {
      s.system!.attractIdleSec = 0;
      delete s.system!.idleSeconds;
    }));
    expect(createSettingsStore().getState().settings.system.idleSeconds).toBe(10);
  });

  it('migrates an imported configuration file the same way', () => {
    const store = createSettingsStore();
    const old = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    old.system!.attractIdleSec = 30;
    delete old.system!.idleSeconds;
    const r = store.getState().importJson(JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION, settings: old }));
    expect(r.ok).toBe(true);
    expect(store.getState().settings.system.idleSeconds).toBe(30);
    expect((store.getState().settings.system as Record<string, unknown>).attractIdleSec).toBeUndefined();
    // migrate() itself leaves unrelated payloads alone.
    expect(migrate({ version: SETTINGS_VERSION, settings: { a: 1 } })).toEqual({ a: 1 });
  });
});
