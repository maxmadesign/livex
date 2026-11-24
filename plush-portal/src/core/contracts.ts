/**
 * Ports between the game core and the independent subsystems (audio, AI guide,
 * head tracking). The core only ever talks to these interfaces; each subsystem
 * owns its implementation and can be replaced or disabled without touching the
 * game loop.
 */
import type { ContactLevel, Lang, RoundOutcome, RoundPhase, SlipReason, ThemeId, Unsubscribe, Vec3 } from './types';

/* ------------------------------------------------------------------ audio */

/** One-shot sound effects. Every name has at least one real asset (see public/audio/manifest.json). */
export const SFX_NAMES = [
  'ui_click', // generic button press
  'ui_toggle', // switches / tabs
  'ui_open', // modal opens
  'ui_close', // modal closes
  'ui_error', // rejected action
  'dir_press', // direction button pressed (start of a hold)
  'dir_tick', // light repeating tick while a direction is held
  'grab_confirm', // grab button accepted
  'claw_descend', // winch starts paying out
  'claw_touch', // claw touches a toy / the floor
  'claw_close', // fingers close
  'claw_open', // fingers open
  'plush_rub', // plush dragged / squeezed
  'plush_land', // soft landing
  'glass_tap', // toy bumps the glass
  'chute_drop', // prize passes the chute
  'prize_out', // prize lands in the prize bin
  'empty_grab', // nothing was caught
  'slip', // toy slipped out
  'win', // success fanfare (theme specific variant is chosen by the engine)
  'collect_unlock', // first time a character is collected
  'restock_drop', // a new toy is dropped in
  'theme_sting', // short theme motif when a theme is selected
  'countdown_tick', // optional aim timer
  'start_game', // attract -> play
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Continuous sounds driven by a level in 0..1; they start, change and stop smoothly. */
export const LOOP_NAMES = ['motor_trolley', 'motor_winch'] as const;
export type LoopName = (typeof LOOP_NAMES)[number];

export type AudioState =
  | 'locked' // waiting for a user gesture
  | 'loading'
  | 'running'
  | 'suspended' // tab hidden or explicitly suspended
  | 'failed';

export interface AudioStatus {
  state: AudioState;
  /** Human readable, non-localised detail for diagnostics. */
  detail: string;
  /** True when assets failed to load and the in-browser synth fallback is playing instead. */
  usingFallbackSynth: boolean;
  musicTheme: ThemeId | null;
  outputDeviceSupported: boolean;
}

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
  /** 0..1: how much the music is turned down while a voice line plays. */
  ducking: number;
}

export interface SfxOptions {
  /** Linear gain multiplier, default 1. */
  volume?: number;
  /** Playback rate multiplier, default 1 (the engine adds its own small random variation). */
  pitch?: number;
  /** Stereo pan -1..1. */
  pan?: number;
  /** Seconds to wait before playing. */
  delay?: number;
}

export interface VoiceHandle {
  /** Resolves when playback finished or was stopped. */
  done: Promise<void>;
  stop(): void;
}

export interface AudioPort {
  /** Must be called from a user gesture. Never throws; inspect `status()` for the outcome. */
  unlock(): Promise<void>;
  status(): AudioStatus;
  subscribe(listener: (status: AudioStatus) => void): Unsubscribe;
  setVolumes(volumes: AudioVolumes): void;
  playSfx(name: SfxName, options?: SfxOptions): void;
  /** Idempotent: call every frame with the current level; 0 fades the loop out. */
  setLoop(name: LoopName, level: number, pitch?: number): void;
  /** Cross-fades to the theme's music track and selects its theme specific SFX variants. */
  setTheme(themeId: ThemeId, options?: { immediate?: boolean }): void;
  /** Override which track plays ('theme' follows the current theme). */
  setMusicTrack(track: ThemeId | 'theme'): void;
  /** Plays a short preview of a track (settings UI); null stops the preview. */
  previewTrack(themeId: ThemeId | null): void;
  /** Plays encoded audio (mp3/wav/...) or raw samples on the voice bus; ducks the music meanwhile. */
  playVoice(data: ArrayBuffer | AudioBuffer, options?: { volume?: number; rate?: number }): VoiceHandle;
  /** Low-level access for synthesised voices (babble): returns the voice bus input, or null when locked. */
  voiceBus(): { context: AudioContext; input: AudioNode } | null;
  /** Manually hold the music duck (used by voices that do not go through playVoice). */
  setVoiceActive(active: boolean): void;
  stopVoice(): void;
  /** Tab hidden / shown. Suspending must not queue sounds for later. */
  suspend(): void;
  resume(): void;
  listOutputDevices(): Promise<{ supported: boolean; reason?: string; devices: { id: string; label: string }[] }>;
  setOutputDevice(deviceId: string): Promise<{ ok: boolean; reason?: string }>;
  dispose(): void;
}

/* --------------------------------------------------------------- AI guide */

export const GUIDE_EVENT_TYPES = [
  'welcome',
  'first_play',
  'idle_hint',
  'aim_help',
  'grab_started',
  'empty_grab',
  'slipped_after_grip',
  'prize_won',
  'theme_changed',
  'retry_prompt',
  'user_requested_tip',
] as const;
export type GuideEventType = (typeof GUIDE_EVENT_TYPES)[number];

export type GuideEmotion = 'happy' | 'cheer' | 'think' | 'oops' | 'calm';

/** Facts the guide may talk about. Everything here comes from the game / physics, never from the model. */
export interface GuideFacts {
  phase: RoundPhase;
  demo: boolean;
  attempts: number;
  wins: number;
  lossStreak: number;
  outcome?: RoundOutcome;
  contact?: ContactLevel;
  slipReason?: SlipReason | null;
  liftedMs?: number;
  /** Public attributes of the toy involved (target or prize). */
  toy?: { typeId: string; name: string; kind: string } | null;
  /**
   * Where the nearest toy was relative to the claw when the grab started (metres).
   * +dx: toy is to the player's right; +dz: toy is closer to the player.
   */
  nearest?: { dx: number; dz: number; dist: number; name: string } | null;
  /** True when this is the first time this character was collected. */
  newCharacter?: boolean;
  headTracking?: boolean;
}

export interface GuideEvent {
  type: GuideEventType;
  /** Round the event belongs to; lines for older rounds are dropped. */
  roundId: number;
  themeId: ThemeId;
  facts: GuideFacts;
}

export type GuideSource = 'gpt' | 'local' | 'off';

export interface GuideLine {
  id: string;
  text: string;
  emotion: GuideEmotion;
  source: GuideSource;
  eventType: GuideEventType;
  roundId: number;
  lang: Lang;
  /** True while audio for this line is playing. */
  speaking: boolean;
  /** 'ai' = OpenAI voice, 'system' = speechSynthesis, 'babble' = synthesised mascot voice, 'none' = subtitle only. */
  voice: 'ai' | 'system' | 'babble' | 'none';
}

export type GuideConnection =
  | 'off' // guide disabled
  | 'local' // local lines (no key / forced local / server unreachable)
  | 'checking'
  | 'gpt' // server reports a configured key and the last request succeeded
  | 'error'; // configured but the last request failed (falls back to local lines)

export interface GuideStatus {
  connection: GuideConnection;
  /** Non-localised detail for the settings panel and diagnostics. */
  detail: string;
  textModel: string | null;
  speechModel: string | null;
  /** Which speech path is really in use right now. */
  voice: 'ai' | 'system' | 'babble' | 'none';
  lastLatencyMs: number | null;
}

export interface GuidePort {
  handle(event: GuideEvent): void;
  /** Drop queued / in-flight lines that belong to anything before this round. */
  invalidateBefore(roundId: number): void;
  /** Stop the current line (text + audio), e.g. when a modal opens or the tab is hidden. */
  silence(): void;
  setPaused(paused: boolean): void;
  status(): GuideStatus;
  currentLine(): GuideLine | null;
  subscribe(listener: (line: GuideLine | null, status: GuideStatus) => void): Unsubscribe;
  /** Re-probes the server (`/api/ai/status`) and optionally runs a real round trip. */
  testConnection(): Promise<{ ok: boolean; detail: string; latencyMs: number | null; sample?: string }>;
  /** Speaks a short fixed sample with the currently configured voice path. */
  previewVoice(): Promise<{ ok: boolean; detail: string }>;
  dispose(): void;
}

/* ------------------------------------------------------------ head tracking */

export type TrackerState =
  | 'off' // disabled by the user
  | 'idle' // enabled but not started yet (waiting for the first user gesture)
  | 'requesting' // waiting for the permission prompt
  | 'denied' // permission denied or dismissed
  | 'no_device' // no camera found
  | 'in_use' // camera busy / not readable
  | 'insecure' // not HTTPS / localhost, or blocked by iframe permissions policy
  | 'loading' // camera ok, loading the model
  | 'model_error' // model / wasm failed to load on every backend
  | 'searching' // running, no face locked yet
  | 'tracking' // running, primary player locked
  | 'lost'; // primary player lost, holding / returning to neutral

export type ViewSource =
  | 'neutral' // fixed reference viewpoint
  | 'tracking' // live camera estimate
  | 'hold' // short loss: last stable value
  | 'returning' // long loss: easing back to neutral
  | 'reacquire' // blending back onto a fresh estimate
  | 'test'; // manual test sliders (never reported as camera tracking)

/**
 * Countdown calibration (TrackerPort.startCalibration): a countdown, then the player's current
 * head pose is captured as the neutral baseline.
 *   idle      – nothing running
 *   countdown – `remaining` whole seconds are left
 *   capturing – the countdown is over, stable samples are being collected
 *   done      – the baseline was captured (and persisted through the calibration event)
 *   failed    – no usable face / tracker not running / cancelled; `detail` says why
 */
export type CalibrationPhase = 'idle' | 'countdown' | 'capturing' | 'done' | 'failed';

export interface CalibrationStatus {
  phase: CalibrationPhase;
  /** Whole seconds left in the countdown (0 outside the countdown). */
  remaining: number;
  /** Non-localised detail for diagnostics (e.g. a CalibrationResult detail code). */
  detail: string;
}

/** The calibration status when nothing is running. */
export const IDLE_CALIBRATION: CalibrationStatus = Object.freeze({ phase: 'idle', remaining: 0, detail: '' });

export interface TrackerStatus {
  state: TrackerState;
  /** Non-localised detail for diagnostics ("NotAllowedError: ..."). */
  detail: string;
  /** Which inference path is really running, once known. */
  backend: 'worker-gpu' | 'worker-cpu' | 'main-gpu' | 'main-cpu' | null;
  cameraLabel: string | null;
  /** Actual negotiated camera frame size. */
  videoWidth: number;
  videoHeight: number;
  /** Measured inferences per second and average inference time. */
  inferenceFps: number;
  inferenceMs: number;
  facesSeen: number;
  viewSource: ViewSource;
  /** True when a calibration exists for the active display profile. */
  calibrated: boolean;
  /** Progress of the countdown calibration (startCalibration). */
  calibration: CalibrationStatus;
}

export interface CalibrationResult {
  ok: boolean;
  detail: string;
  /** Number of stable samples that were averaged. */
  samples: number;
}

export interface TrackerPort {
  /** Starts the camera + inference. Never throws and never blocks gameplay. */
  start(): Promise<void>;
  /** Stops inference and releases every camera track. */
  stop(): void;
  status(): TrackerStatus;
  subscribe(listener: (status: TrackerStatus) => void): Unsubscribe;
  /**
   * Writes the eye position for this render frame into `out`, in metres, in
   * screen coordinates (origin = centre of the effective window, +X right,
   * +Y up, +Z towards the viewer). Always returns a usable viewpoint.
   */
  sampleEye(nowMs: number, out: Vec3): ViewSource;
  /** Collects ~1 s of stable samples and stores them as the neutral viewpoint for the active profile. */
  calibrate(): Promise<CalibrationResult>;
  /** Makes the current head position the neutral viewpoint without touching the depth scale. */
  recenter(): void;
  /**
   * Starts a countdown of `seconds` (whole seconds), then captures the player's current head
   * pose as the neutral baseline for the active profile. Progress is reported in
   * `status().calibration`. Calling it again restarts the countdown. Never throws.
   */
  startCalibration(seconds: number): void;
  /** Cancels a running countdown / capture; the previous baseline stays in use. */
  cancelCalibration(): void;
  /** Manual test viewpoint offset from neutral (metres); null returns to normal operation. */
  setTestViewpoint(offset: Vec3 | null): void;
  /** Shows the (mirrored) camera preview with landmarks in the given element; null detaches. */
  attachPreview(container: HTMLElement | null): void;
  listCameras(): Promise<{ id: string; label: string }[]>;
  /** Tab hidden / shown: pauses inference without releasing the camera permission. */
  setPaused(paused: boolean): void;
  dispose(): void;
}
