import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { App } from '../app/bootstrap';
import type { GameUiState } from '../app/gameStore';
import type { Lang } from '../core/types';
import { translate } from '../i18n';
import type { CollectionState } from '../persistence/collection';
import type { Settings } from '../settings/spec';
import type { SettingsState } from '../settings/store';
import { getLog, subscribeLog, type LogEntry } from '../diagnostics/log';

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('AppContext is missing');
  return app;
}

/** Subscribes to a slice of the game's UI state. */
export function useUi<T>(selector: (state: GameUiState) => T): T {
  return useStore(useApp().ui, selector);
}

/** Subscribes to the settings the player currently sees (the draft while the dialog is open). */
export function useSettings<T>(selector: (settings: Settings) => T): T {
  return useStore(useApp().settings, (state: SettingsState) => selector(state.draft ?? state.settings));
}

export function useSettingsState<T>(selector: (state: SettingsState) => T): T {
  return useStore(useApp().settings, selector);
}

export function useCollection<T>(selector: (state: CollectionState) => T): T {
  return useStore(useApp().collection, selector);
}

export function useLang(): Lang {
  return useSettings((s) => s.system.language);
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function useT(): Translate {
  const lang = useLang();
  return useCallback((key, params) => translate(lang, key, params), [lang]);
}

let logSnapshot: readonly LogEntry[] = [];
export function useLogEntries(): readonly LogEntry[] {
  return useSyncExternalStore(
    (notify) =>
      subscribeLog(() => {
        logSnapshot = [...getLog()];
        notify();
      }),
    () => {
      if (logSnapshot.length !== getLog().length) logSnapshot = [...getLog()];
      return logSnapshot;
    },
  );
}
