import { createStore } from 'zustand/vanilla';
import { IDLE_CALIBRATION, type AudioStatus, type GuideLine, type GuideStatus, type TrackerStatus } from '../core/contracts';
import type { DisplayProfileId, RoundPhase, RoundResult, ThemeId } from '../core/types';
import type { RarityTier } from '../game/rarity';
import type { ScoreAward } from '../game/scoring';
import type { EffectiveGraphics } from '../scene/Stage';

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  frameP50: number;
  frameP95: number;
  frameMax: number;
  physicsMs: number;
  /** Fixed steps simulated per rendered frame (average). */
  stepsPerFrame: number;
  droppedSteps: number;
  trackingMs: number;
  trackingFps: number;
  calls: number;
  triangles: number;
  toyTriangles: number;
  particles: number;
  /** JS heap in MB when the browser exposes it, otherwise null. */
  heapMb: number | null;
  /** GPU frame time is not exposed to web pages without a timer-query extension. */
  gpuMs: number | null;
}

export interface PrizeInfo {
  typeId: string;
  isNew: boolean;
  count: number;
}

export type ModalId = 'settings' | 'collection' | 'tutorial' | 'device' | 'themes' | null;

/** Points system state shown by the HUD (src/ui/ScoreHud.tsx and the result card). */
export interface ScoreUiState {
  /** gameplay.scoring */
  enabled: boolean;
  /** True while the numbers are the demo's show score (attract mode). */
  demo: boolean;
  session: number;
  /** Consecutive wins of the shown track. */
  streak: number;
  /** Combo multiplier the next win would get. */
  nextMultiplier: number;
  best: number;
  lifetime: number;
  /** Award of the most recently settled round (the result card shows its breakdown). */
  last: ScoreAward | null;
}

/** A floating "+250" at the prize's position on screen (CSS pixels). */
export interface ScorePopup {
  id: number;
  x: number;
  y: number;
  points: number;
  tier: RarityTier | null;
  kind: 'win' | 'slip';
  demo: boolean;
  multiplier: number;
}

export const INITIAL_SCORE: ScoreUiState = { enabled: true, demo: false, session: 0, streak: 0, nextMultiplier: 1, best: 0, lifetime: 0, last: null };

/** Everything the React HUD needs. Updated only when something changes, never per frame. */
export interface GameUiState {
  boot: { stage: 'loading' | 'ready' | 'error'; progress: number; label: string; error: string | null };
  phase: RoundPhase;
  roundId: number;
  demo: boolean;
  paused: boolean;
  result: RoundResult | null;
  prize: PrizeInfo | null;
  /** Whole seconds left on the optional aim timer, or -1. */
  aimSecondsLeft: number;
  profile: DisplayProfileId;
  /** False until the player (or a launch parameter) picked a display preset. */
  profileChosen: boolean;
  themeId: ThemeId;
  themeBusy: boolean;
  /** Settings that wait for the end of the round. */
  pendingChange: boolean;
  restocking: boolean;
  modal: ModalId;
  toast: { id: number; key: string; params?: Record<string, string | number> } | null;
  tracker: TrackerStatus;
  audio: AudioStatus;
  guideLine: GuideLine | null;
  guideStatus: GuideStatus;
  perf: PerfSnapshot;
  effective: EffectiveGraphics;
  /** Which automatic reductions are active (human readable keys), empty when none. */
  autoReductions: string[];
  /** Data URLs of rendered character portraits by manifest id. */
  thumbnails: Record<string, string>;
  webglLost: boolean;
  /** Non-fatal problems worth showing in diagnostics. */
  warnings: string[];
  firstPlayDone: boolean;
  score: ScoreUiState;
  /** Score popups currently on screen (removed by the HUD after their animation). */
  scorePopups: ScorePopup[];
}

export const INITIAL_TRACKER: TrackerStatus = {
  state: 'idle',
  detail: '',
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

export const INITIAL_AUDIO: AudioStatus = { state: 'locked', detail: '', usingFallbackSynth: false, musicTheme: null, outputDeviceSupported: false };
export const INITIAL_GUIDE: GuideStatus = { connection: 'checking', detail: '', textModel: null, speechModel: null, voice: 'none', lastLatencyMs: null };

export const EMPTY_PERF: PerfSnapshot = {
  fps: 0,
  frameMs: 0,
  frameP50: 0,
  frameP95: 0,
  frameMax: 0,
  physicsMs: 0,
  stepsPerFrame: 0,
  droppedSteps: 0,
  trackingMs: 0,
  trackingFps: 0,
  calls: 0,
  triangles: 0,
  toyTriangles: 0,
  particles: 0,
  heapMb: null,
  gpuMs: null,
};

export function createGameStore(profile: DisplayProfileId, profileChosen: boolean, themeId: ThemeId) {
  return createStore<GameUiState>()(() => ({
    boot: { stage: 'loading', progress: 0, label: 'boot', error: null },
    phase: 'ATTRACT',
    roundId: 0,
    demo: false,
    paused: false,
    result: null,
    prize: null,
    aimSecondsLeft: -1,
    profile,
    profileChosen,
    themeId,
    themeBusy: false,
    pendingChange: false,
    restocking: false,
    modal: null,
    toast: null,
    tracker: INITIAL_TRACKER,
    audio: INITIAL_AUDIO,
    guideLine: null,
    guideStatus: INITIAL_GUIDE,
    perf: EMPTY_PERF,
    effective: {
      width: 0,
      height: 0,
      pixelRatio: 1,
      megapixels: 0,
      shadows: 'medium',
      ao: 'off',
      aa: 'fxaa',
      bloom: 0,
      glass: 'medium',
      reflections: 'static',
      particles: 0,
      autoScale: 1,
    },
    autoReductions: [],
    thumbnails: {},
    webglLost: false,
    warnings: [],
    firstPlayDone: false,
    score: INITIAL_SCORE,
    scorePopups: [],
  }));
}

export type GameStore = ReturnType<typeof createGameStore>;
