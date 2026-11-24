import { createStore } from 'zustand/vanilla';
import { DISPLAY_PROFILE_IDS, type DisplayProfileId } from '../core/types';
import { readJson, writeJson } from '../persistence/storage';
import {
  SETTINGS_VERSION,
  defaultSettings,
  diffSettings,
  exportableSettings,
  getFieldAt,
  profileDefaults,
  sanitizeSettings,
  setValueAt,
  type Settings,
} from './spec';

const KEY = 'settings';

export interface SettingsState {
  /** Applied and persisted settings. */
  settings: Settings;
  /** Working copy while the settings dialog is open (live preview); null otherwise. */
  draft: Settings | null;
  /** True when persisted data was missing or had to be repaired. */
  repaired: boolean;
  /** What the game should show right now: the draft while editing, otherwise the applied settings. */
  view(): Settings;
  /** Changes one value: in the draft while editing, otherwise applied + persisted immediately. */
  set(path: string, value: unknown): void;
  beginEdit(): void;
  /** Discards the draft: everything previewed returns to the applied values. */
  cancelEdit(): void;
  /** Makes the draft the applied settings and persists it. Returns the paths that changed. */
  applyEdit(): string[];
  /** True when the draft differs from the applied settings. */
  isDirty(): boolean;
  resetAll(): void;
  resetSection(section: keyof Settings): void;
  /** Resets a display preset: its layout, its viewing geometry + calibration, or both. */
  resetProfile(id: DisplayProfileId, part?: 'layout' | 'view'): void;
  exportJson(): string;
  /** Validates and loads a configuration file. Unknown or out-of-range values are repaired. */
  importJson(text: string): { ok: boolean; message: string; changed: number };
}

/** Upgrades persisted data from older versions. Returns the settings payload or null when unusable. */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { version?: unknown; settings?: unknown };
  if (typeof o.version !== 'number' || o.settings === undefined) return null;
  if (o.version > SETTINGS_VERSION) return null; // written by a newer build: fall back to defaults
  // v1 is the first public layout; future versions transform `o.settings` step by step here.
  return o.settings;
}

function load(): { settings: Settings; repaired: boolean } {
  const raw = readJson(KEY);
  const payload = migrate(raw);
  if (payload === null) return { settings: defaultSettings(), repaired: raw !== null };
  const clean = sanitizeSettings(payload);
  return { settings: clean, repaired: JSON.stringify(clean) !== JSON.stringify(payload) };
}

function persist(settings: Settings): void {
  writeJson(KEY, { version: SETTINGS_VERSION, settings });
}

export function createSettingsStore() {
  const initial = load();
  return createStore<SettingsState>()((set, get) => ({
    settings: initial.settings,
    draft: null,
    repaired: initial.repaired,
    view() {
      return get().draft ?? get().settings;
    },
    set(path, value) {
      if (!getFieldAt(path)) return;
      const state = get();
      if (state.draft) set({ draft: setValueAt(state.draft, path, value) });
      else {
        const next = setValueAt(state.settings, path, value);
        set({ settings: next });
        persist(next);
      }
    },
    beginEdit() {
      if (!get().draft) set({ draft: structuredClone(get().settings) });
    },
    cancelEdit() {
      set({ draft: null });
    },
    applyEdit() {
      const { draft, settings } = get();
      if (!draft) return [];
      const changed = diffSettings(settings, draft);
      set({ settings: draft, draft: structuredClone(draft) });
      persist(draft);
      return changed;
    },
    isDirty() {
      const { draft, settings } = get();
      return draft !== null && diffSettings(settings, draft).length > 0;
    },
    resetAll() {
      const fresh = defaultSettings();
      // Keep the chosen display preset and language so the screen stays usable after a reset.
      const current = get().view();
      fresh.display.profile = current.display.profile;
      fresh.system.language = current.system.language;
      if (get().draft) set({ draft: fresh });
      else {
        set({ settings: fresh });
        persist(fresh);
      }
    },
    resetSection(section) {
      const current = structuredClone(get().view());
      const fresh = defaultSettings();
      if (section === 'profiles') return;
      (current as Record<string, unknown>)[section] = fresh[section];
      if (section === 'system') current.system.language = get().view().system.language;
      if (section === 'display') current.display.profile = get().view().display.profile;
      const clean = sanitizeSettings(current);
      if (get().draft) set({ draft: clean });
      else {
        set({ settings: clean });
        persist(clean);
      }
    },
    resetProfile(id, part) {
      if (!DISPLAY_PROFILE_IDS.includes(id)) return;
      const current = structuredClone(get().view());
      const fresh = profileDefaults(id);
      if (part === 'layout') current.profiles[id].layout = fresh.layout;
      else if (part === 'view') current.profiles[id].view = fresh.view;
      else current.profiles[id] = fresh;
      if (get().draft) set({ draft: current });
      else {
        set({ settings: current });
        persist(current);
      }
    },
    exportJson() {
      return JSON.stringify({ app: 'plush-portal', version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), settings: exportableSettings(get().view()) }, null, 2);
    },
    importJson(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, message: 'invalid_json', changed: 0 };
      }
      if (!parsed || typeof parsed !== 'object' || (parsed as { app?: unknown }).app !== 'plush-portal') {
        return { ok: false, message: 'not_a_config', changed: 0 };
      }
      const payload = migrate(parsed);
      if (payload === null) return { ok: false, message: 'unsupported_version', changed: 0 };
      const current = get().view();
      const clean = sanitizeSettings(payload);
      // Never import the local settings PIN and keep this device's display preset choice.
      clean.system.lockPin = current.system.lockPin;
      clean.system.lockSettings = current.system.lockSettings;
      if (current.display.profile) clean.display.profile = current.display.profile;
      const changed = diffSettings(current, clean).length;
      if (get().draft) set({ draft: clean });
      else {
        set({ settings: clean });
        persist(clean);
      }
      return { ok: true, message: 'imported', changed };
    },
  }));
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
