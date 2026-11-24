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

/** Default and range of the retired `system.attractIdleSec` (replaced by `system.idleSeconds`). */
const OLD_ATTRACT_IDLE = { def: 45, min: 10, max: 600, step: 5 };

/**
 * `system.attractIdleSec` (idle time before the attract screen, default 45 s) and
 * `system.idleSeconds` (full reset after no input, default 60 s) were two settings for
 * one behaviour. Only idleSeconds remains; a customised old value carries over when
 * idleSeconds was never chosen (absent, or still at its default).
 */
function migrateIdleSetting(settings: unknown): unknown {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const system = (settings as { system?: unknown }).system;
  if (!system || typeof system !== 'object' || Array.isArray(system)) return settings;
  const s = system as Record<string, unknown>;
  if (!('attractIdleSec' in s)) return settings;
  const { attractIdleSec: old, ...rest } = s;
  const next: Record<string, unknown> = { ...rest };
  const idleDefault = defaultSettings().system.idleSeconds;
  if (typeof old === 'number' && Number.isFinite(old) && (s.idleSeconds === undefined || s.idleSeconds === idleDefault)) {
    // The old setting was sanitised to its own range, so do the same before comparing with its default.
    const stepped = OLD_ATTRACT_IDLE.min + Math.round((old - OLD_ATTRACT_IDLE.min) / OLD_ATTRACT_IDLE.step) * OLD_ATTRACT_IDLE.step;
    const value = Math.min(OLD_ATTRACT_IDLE.max, Math.max(OLD_ATTRACT_IDLE.min, stepped));
    if (value !== OLD_ATTRACT_IDLE.def) next.idleSeconds = value;
  }
  return { ...(settings as Record<string, unknown>), system: next };
}

/** Upgrades persisted data from older versions. Returns the settings payload or null when unusable. */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { version?: unknown; settings?: unknown };
  if (typeof o.version !== 'number' || o.settings === undefined) return null;
  if (o.version > SETTINGS_VERSION) return null; // written by a newer build: fall back to defaults
  // v1 is the first public layout; later changes within it are upgraded key by key.
  return migrateIdleSetting(o.settings);
}

/** True when the stored data was written by a newer build (it is then left untouched). */
function fromNewerBuild(raw: unknown): boolean {
  const version = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  return typeof version === 'number' && version > SETTINGS_VERSION;
}

function load(): { settings: Settings; repaired: boolean } {
  const raw = readJson(KEY);
  const payload = migrate(raw);
  let result: { settings: Settings; repaired: boolean };
  if (payload === null) result = { settings: defaultSettings(), repaired: raw !== null };
  else {
    const clean = sanitizeSettings(payload);
    result = { settings: clean, repaired: JSON.stringify(clean) !== JSON.stringify(payload) || payload !== (raw as { settings?: unknown }).settings };
  }
  // Write the repaired settings back once, so the next start does not repair (and warn about) the
  // same thing again. Data from a newer build is kept as it is: that build may still need it.
  if (result.repaired && !fromNewerBuild(raw)) persist(result.settings);
  return result;
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
