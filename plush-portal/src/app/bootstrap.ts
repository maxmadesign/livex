import type { AudioPort } from '../core/contracts';
import type { DisplayProfileId } from '../core/types';
import { log, logError } from '../diagnostics/log';
import { guessProfile } from '../layout/solve';
import { createCollectionStore, type CollectionStore } from '../persistence/collection';
import { createSettingsStore, type SettingsStore } from '../settings/store';
import { Game, type ConfigurableGuide, type ConfigurableTracker, type LaunchParams } from './Game';
import { createGameStore, type GameStore } from './gameStore';
import { readLaunchParams } from './launch';
import { applyGraphicsPreset } from './presets';
import { createNullAudio, createNullGuide, createNullTracker } from './nullPorts';

export interface App {
  game: Game;
  settings: SettingsStore;
  collection: CollectionStore;
  ui: GameStore;
  audio: AudioPort;
  guide: ConfigurableGuide;
  tracker: ConfigurableTracker;
  launch: LaunchParams;
  dispose(): void;
}

/** CSS font stacks; the same display stack is used for text drawn into 3D textures. */
export const FONT_DISPLAY = '"Fredoka Variable", "ZCOOL KuaiLe", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yuanti SC", system-ui, sans-serif';

/**
 * Creates the stores, the three optional subsystems (each replaced by a
 * truthful no-op if it cannot initialise) and the game itself.
 */
export async function createApp(canvas: HTMLCanvasElement): Promise<App> {
  const launch = readLaunchParams();
  const settings = createSettingsStore();
  const collection = createCollectionStore();
  const state = settings.getState();
  if (launch.display) state.set('display.profile', launch.display);
  if (launch.theme) state.set('themes.current', launch.theme);
  if (launch.lang) state.set('system.language', launch.lang);
  if (launch.quality) applyGraphicsPreset(state.set, launch.quality);
  const s = settings.getState().settings;
  const chosen = s.display.profile as DisplayProfileId | '';
  const profile = chosen || guessProfile(window.innerWidth, window.innerHeight);
  const ui = createGameStore(profile, !!chosen, s.themes.current);
  if (settings.getState().repaired) log('warn', 'settings', 'Stored settings were incomplete or invalid and were repaired with defaults.');

  let audio: AudioPort;
  try {
    const { createAudioEngine } = await import('../audio');
    audio = createAudioEngine({ baseUrl: `${import.meta.env.BASE_URL}audio/` });
  } catch (error) {
    logError('audio', error);
    audio = createNullAudio('audio engine failed to initialise');
  }

  let guide: ConfigurableGuide;
  try {
    const { createGuide } = await import('../ai');
    guide = createGuide({ audio });
  } catch (error) {
    logError('guide', error);
    guide = createNullGuide('guide failed to initialise');
  }

  let tracker: ConfigurableTracker;
  let offCalibration: (() => void) | null = null;
  try {
    const { createFaceTracker } = await import('../tracking');
    const face = createFaceTracker();
    // The tracker measures; the application owns and persists the calibration of the active preset.
    offCalibration = face.onCalibration((event) => {
      const id = ui.getState().profile;
      const store = settings.getState();
      store.set(`profiles.${id}.view.calDepthK`, event.values.calDepthK);
      store.set(`profiles.${id}.view.calNeutral`, event.values.calNeutral);
      store.set(`profiles.${id}.view.calibrated`, true);
    });
    tracker = face;
  } catch (error) {
    logError('tracker', error);
    tracker = createNullTracker('head tracking failed to initialise');
  }

  // Wait for the display font so text drawn into textures uses it.
  try {
    await Promise.race([document.fonts.load(`700 32px ${FONT_DISPLAY}`), new Promise((resolve) => setTimeout(resolve, 1500))]);
  } catch {
    /* fonts are optional */
  }

  const game = new Game({ canvas, settings, collection, ui, audio, guide, tracker, launch, font: FONT_DISPLAY });
  return {
    game,
    settings,
    collection,
    ui,
    audio,
    guide,
    tracker,
    launch,
    dispose() {
      offCalibration?.();
      game.dispose();
      guide.dispose();
      tracker.dispose();
      audio.dispose();
    },
  };
}
