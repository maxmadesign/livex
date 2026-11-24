import { IDLE_CALIBRATION, type AudioPort, type AudioStatus, type GuidePort, type GuideStatus, type TrackerPort, type TrackerStatus, type ViewSource } from '../core/contracts';
import type { Vec3 } from '../core/types';
import type { ViewSettings } from '../settings/spec';
import type { ConfigurableGuide, ConfigurableTracker } from './Game';

/**
 * Do-nothing implementations of the subsystem ports. They are used when a
 * subsystem fails to initialise (the game must stay playable) and in tests.
 * Each one reports truthfully that it is unavailable.
 */

export function createNullAudio(detail: string): AudioPort {
  const status: AudioStatus = { state: 'failed', detail, usingFallbackSynth: false, musicTheme: null, outputDeviceSupported: false };
  return {
    unlock: async () => {},
    status: () => status,
    subscribe: () => () => {},
    setVolumes: () => {},
    playSfx: () => {},
    setLoop: () => {},
    setTheme: () => {},
    setMusicTrack: () => {},
    previewTrack: () => {},
    playCharacter: () => {},
    playWin: () => {},
    setAttract: () => {},
    setAttractChime: () => {},
    playVoice: () => ({ done: Promise.resolve(), stop: () => {} }),
    voiceBus: () => null,
    setVoiceActive: () => {},
    stopVoice: () => {},
    suspend: () => {},
    resume: () => {},
    listOutputDevices: async () => ({ supported: false, reason: detail, devices: [] }),
    setOutputDevice: async () => ({ ok: false, reason: detail }),
    dispose: () => {},
  };
}

export function createNullGuide(detail: string): ConfigurableGuide {
  const status: GuideStatus = { connection: 'off', detail, textModel: null, speechModel: null, voice: 'none', lastLatencyMs: null };
  const guide: GuidePort = {
    handle: () => {},
    invalidateBefore: () => {},
    silence: () => {},
    setPaused: () => {},
    status: () => status,
    currentLine: () => null,
    subscribe: () => () => {},
    testConnection: async () => ({ ok: false, detail, latencyMs: null }),
    previewVoice: async () => ({ ok: false, detail }),
    dispose: () => {},
  };
  return Object.assign(guide, { configure: () => {} });
}

/** Fixed viewpoint: always returns the profile's reference eye. */
export function createNullTracker(detail: string): ConfigurableTracker {
  let view: ViewSettings | null = null;
  let test: Vec3 | null = null;
  const status: TrackerStatus = {
    state: 'model_error',
    detail,
    backend: null,
    cameraLabel: null,
    videoWidth: 0,
    videoHeight: 0,
    inferenceFps: 0,
    inferenceMs: 0,
    facesSeen: 0,
    viewSource: 'neutral',
    calibrated: false,
    calibration: IDLE_CALIBRATION,
  };
  const tracker: TrackerPort = {
    start: async () => {},
    stop: () => {},
    status: () => status,
    subscribe: () => () => {},
    sampleEye(_now: number, out: Vec3): ViewSource {
      const eye = view?.eye ?? [0, 0.1, 0.7];
      out[0] = eye[0] + (test?.[0] ?? 0);
      out[1] = eye[1] + (test?.[1] ?? 0);
      out[2] = Math.max(0.15, eye[2] + (test?.[2] ?? 0));
      return test ? 'test' : 'neutral';
    },
    calibrate: async () => ({ ok: false, detail, samples: 0 }),
    recenter: () => {},
    // No camera: a countdown calibration can never start, so the status stays idle.
    startCalibration: () => {},
    cancelCalibration: () => {},
    setTestViewpoint: (offset) => {
      test = offset;
    },
    attachPreview: () => {},
    listCameras: async () => [],
    setPaused: () => {},
    dispose: () => {},
  };
  return Object.assign(tracker, {
    configure: (cfg: { view: ViewSettings }) => {
      view = cfg.view;
    },
  });
}
