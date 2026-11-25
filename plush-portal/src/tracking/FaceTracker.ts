/**
 * Head Tracking / Window Perspective – orchestrator.
 *
 *   camera frame → landmarks → primary player → eye estimate (camera space)
 *     → camera-to-screen transform → window space → filtering → view mapping
 *     → ViewpointController (loss handling, render-rate interpolation)
 *
 * The head direction of the same fit feeds the optional head-turn offset of the
 * view mapping (headPose.ts), and the countdown calibration (countdown.ts)
 * captures eye position + head direction as the baseline.
 *
 * Camera frames and landmarks stay on this device: they are processed in
 * memory, never stored and never sent anywhere.
 */
import { IDLE_CALIBRATION, type CalibrationResult, type TrackerPort, type TrackerState, type TrackerStatus, type ViewSource } from '../core/contracts';
import type { DisplayProfileId, Unsubscribe, Vec3 } from '../core/types';
import { defaultSettings, type CameraSettings, type ViewSettings } from '../settings/spec';
import { headBiasFor, roundDegrees } from './baseline';
import { CalibrationCollector, hfovFromFocal, solveCalibration, type CalibrationValues } from './calibration';
import { cameraToScreen, mountMatrix } from './cameraTransform';
import { listVideoInputs, openCamera, type CameraHandle, type CameraOpener } from './cameraSource';
import { CountdownCalibration, ROTATED, countdownSeconds, type BaselineResult, type CountdownFailure } from './countdown';
import { effectiveCapture, readDeviceInfo, type DeviceInfo, type EffectiveCapture } from './devicePolicy';
import { createMeasurement, effectiveFocalRef, eyeInCamera, measureFace, type FaceMeasurement } from './eyeEstimator';
import { MeasurementFilter, OneEuroFilter } from './filters';
import { parseRotation, uprightFrame, type SensorRotation, type UprightFrame } from './frameGeometry';
import { headDirectionScreen, headOffset, headRelativeToCentre, type HeadAngles } from './headPose';
import { createBackend, selectBackend, type BackendFactory, type BackendKind, type InferenceBackend, type ProbeAttempt } from './inference/backends';
import type { InferenceResult } from './inference/protocol';
import { FLOATS_PER_FACE } from './landmarks';
import { PrimarySelector, type FaceCandidate } from './primarySelector';
import { TrackingPreview, type PreviewInfo } from './preview';
import { mapToViewpoint, neutralViewpoint, offsetViewpoint, screenToWindow, type PhysicalWindow } from './viewMapping';
import { ViewpointController } from './ViewpointController';

export type { PhysicalWindow } from './viewMapping';

export interface TrackerConfig {
  camera: CameraSettings;
  view: ViewSettings;
  /** The effective game window on the physical screen. */
  window: PhysicalWindow;
  /** Active display preset: selects its head-direction baseline (same as setActiveProfile()). */
  profile?: DisplayProfileId;
}

export interface FaceTrackerDeps {
  /** Monotonic clock in milliseconds (defaults to performance.now). */
  now?: () => number;
  openCamera?: CameraOpener;
  backendFactory?: BackendFactory;
  listCameras?: () => Promise<{ id: string; label: string }[]>;
  /** URL of the directory that contains `wasm/` and `models/` (defaults to `<base>/mediapipe/`). */
  assetBase?: string;
  /** Device class for the phone / low-power capture policy (defaults to readDeviceInfo()). */
  deviceInfo?: () => DeviceInfo;
  /**
   * Subscribes to screen-orientation changes; returns the unsubscribe function. Defaults to
   * `screen.orientation` "change" (or window "orientationchange") in a browser; null = none.
   */
  watchOrientation?: ((callback: () => void) => () => void) | null;
}

/**
 * Values to store in the active display profile (`profiles.<id>.view`, and for a countdown
 * baseline `camera.headBaseline.<id>`, see baseline.ts `baselineWrites`).
 * The tracker applies them to itself immediately, but the application owns
 * the settings: persist them and pass them back through `configure()`.
 *
 *   calibrate – quick calibration (depth scale + neutral position, `calibrate()`)
 *   recenter  – current position becomes neutral (`recenter()`)
 *   baseline  – countdown calibration: neutral position + head direction (`startCalibration()`)
 */
export interface CalibrationEvent {
  kind: 'calibrate' | 'recenter' | 'baseline';
  values: CalibrationValues;
}

export interface CalibrationOutcome extends CalibrationResult {
  /** Present when ok: the values that were applied (same as the CalibrationEvent). */
  values?: CalibrationValues;
  /** Horizontal field of view implied by the calibrated focal constant. */
  hfovDeg?: number;
}

export interface TrackerDiagnostics {
  /** Every backend that was tried, in order, with the reason it was (not) used. */
  attempts: ProbeAttempt[];
  lastError: string;
  rawWidth: number;
  rawHeight: number;
  rotation: SensorRotation;
  mirror: boolean;
  /** Effective focal length in reference pixels and the field of view it implies. */
  focalRef: number;
  hfovDeg: number;
  /** Latest measurement of the primary player (null when none). */
  measurement: {
    ipdPx: number;
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
    residual: number;
    /** Eye in camera space, metres. */
    camera: Vec3;
    /** Filtered eye in window space, metres (before neutral / gains / limits). */
    window: Vec3;
    /** Final tracked viewpoint in window space, metres. */
    viewpoint: Vec3;
    /**
     * Head direction in screen space (degrees), the same relative to facing the window centre
     * minus the baseline, and the head-turn offset it adds to the viewpoint (metres, filtered).
     */
    head: { yawDeg: number; pitchDeg: number; relYawDeg: number; relPitchDeg: number; offset: [number, number] };
  } | null;
  primary: 'searching' | 'locked' | 'missing';
  outliersRejected: number;
  inferences: number;
  paused: boolean;
  /** Camera request and inference parameters really in use (phone / low-power policy applied). */
  capture: EffectiveCapture;
  /** Display preset whose head-direction baseline is used (null until known). */
  profile: DisplayProfileId | null;
  /** Head-direction baseline in use, degrees (0 / 0 = facing the window centre). */
  headBaselineDeg: { yaw: number; pitch: number };
  /** Last countdown baseline captured in this session (window-space eye, degrees, spreads). */
  lastBaseline: { eye: Vec3; yawDeg: number; pitchDeg: number; samples: number; spread: BaselineResult['spread'] } | null;
}

/**
 * Drag-to-peek source (src/app/PeekDrag.ts), asked once per rendered frame: `nowMs` is the frame
 * time, `driven` is true while a tracked face or the test viewpoint drives the view. Returns the
 * offset from the viewpoint (window space, metres), or null when the view is not being peeked.
 */
export type DragSource = (nowMs: number, driven: boolean) => Readonly<Vec3> | null;

export interface FaceTracker extends TrackerPort {
  /** Applies settings. Cheap; restarts the camera / backend only when a relevant field changed. */
  configure(config: TrackerConfig): void;
  /** Fires whenever a calibration or re-centre produced new values to persist. */
  onCalibration(listener: (event: CalibrationEvent) => void): Unsubscribe;
  calibrate(): Promise<CalibrationOutcome>;
  diagnostics(): TrackerDiagnostics;
  /** Selects the display preset whose head-direction baseline (`camera.headBaseline.<id>`) is used. */
  setActiveProfile(profile: DisplayProfileId): void;
  /** Drag-to-peek offset provider, or null to remove it. */
  setDragSource(source: DragSource | null): void;
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
/** Rotation events closer together than this are one rotation, ms. */
const ROTATION_DEBOUNCE_MS = 1500;
/** How often a running countdown is advanced when no frames arrive, ms. */
const SESSION_TICK_MS = 200;

/** Countdown failures that mirror a tracker start-up failure state. */
const START_FAILURES: Partial<Record<TrackerState, CountdownFailure>> = {
  denied: 'denied',
  no_device: 'no_device',
  in_use: 'in_use',
  insecure: 'insecure',
  model_error: 'model_error',
};

function defaultWatchOrientation(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const orientation = typeof screen !== 'undefined' ? (screen as Screen & { orientation?: ScreenOrientation }).orientation : undefined;
  if (orientation && typeof orientation.addEventListener === 'function') {
    orientation.addEventListener('change', callback);
    return () => orientation.removeEventListener('change', callback);
  }
  window.addEventListener('orientationchange', callback);
  return () => window.removeEventListener('orientationchange', callback);
}
/** Consecutive inference failures after which the backend is replaced. */
const MAX_BACKEND_FAILURES = 3;

function resolveAssetBase(explicit?: string): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = explicit ?? `${env?.BASE_URL ?? '/'}mediapipe/`;
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  try {
    const origin = typeof document !== 'undefined' ? document.baseURI : typeof location !== 'undefined' ? location.href : undefined;
    return origin ? new URL(withSlash, origin).href : withSlash;
  } catch {
    return withSlash;
  }
}

class FaceTrackerImpl implements FaceTracker {
  private readonly now: () => number;
  private readonly openCameraFn: CameraOpener;
  private readonly backendFactory: BackendFactory | null;
  private readonly listCamerasFn: () => Promise<{ id: string; label: string }[]>;
  private readonly assetBase: string;
  private readonly deviceInfo: DeviceInfo;
  private readonly watchOrientation: ((callback: () => void) => () => void) | null;

  private camera_: CameraSettings;
  /** Camera request / inference parameters after the phone & low-power policy. */
  private capture: EffectiveCapture;
  private profile: DisplayProfileId | null = null;
  private view: ViewSettings;
  private window: PhysicalWindow = { widthM: 0.5, heightM: 0.3, centerOffsetM: [0, 0] };

  private statusValue: TrackerStatus;
  private readonly listeners = new Set<(status: TrackerStatus) => void>();
  private readonly calibrationListeners = new Set<(event: CalibrationEvent) => void>();

  /** Bumped by every start/stop so that late async results can be recognised and dropped. */
  private generation = 0;
  private starting = false;
  private running = false;
  private paused = false;
  private busy = false;
  private startPromise: Promise<void> | null = null;

  private camera: CameraHandle | null = null;
  private backend: InferenceBackend | null = null;
  private unsubscribeFrames: (() => void) | null = null;
  private attempts: ProbeAttempt[] = [];
  private failedKinds: BackendKind[] = [];
  private backendFailures = 0;
  private lastError = '';

  private nextDueMs = 0;
  private readonly inferStamps: number[] = [];
  private inferMsAvg = 0;
  private lastStatsMs = 0;
  private inferenceCount = 0;
  private outliersRejected = 0;

  // Derived geometry.
  private rotation: SensorRotation = 0;
  private frame: UprightFrame = uprightFrame(640, 480, 0, false);
  private readonly matrix = new Float64Array(9);
  private focalRef = 520;

  private readonly selector = new PrimarySelector();
  private readonly filter = new MeasurementFilter();
  private readonly controller = new ViewpointController();
  private dragSource: DragSource | null = null;
  private readonly collector = new CalibrationCollector();
  private calibrationResolve: ((outcome: CalibrationOutcome) => void) | null = null;
  private calibrationPromise: Promise<CalibrationOutcome> | null = null;
  private calibrationTimer: ReturnType<typeof setInterval> | null = null;

  /** Countdown calibration (startCalibration). */
  private readonly session = new CountdownCalibration();
  private sessionTimer: ReturnType<typeof setInterval> | null = null;
  private lastBaseline: BaselineResult | null = null;

  /** Head-direction baseline in use (radians) and the configured value it was last taken from. */
  private readonly headBias: HeadAngles = { yaw: 0, pitch: 0 };
  private readonly configuredBias: HeadAngles = { yaw: 0, pitch: 0 };
  private readonly headDir: HeadAngles = { yaw: 0, pitch: 0 };
  private readonly headRel: HeadAngles = { yaw: 0, pitch: 0 };
  private readonly headRaw: [number, number] = [0, 0];
  private readonly headOff: [number, number] = [0, 0];
  private readonly headFilterX = new OneEuroFilter();
  private readonly headFilterY = new OneEuroFilter();
  private headFiltered = false;

  /** Orientation of the last camera frame (null until one arrived in this run). */
  private frameLandscape: boolean | null = null;
  private lastRotationMs = -Infinity;
  private unwatchOrientation: (() => void) | null = null;

  /** Forces the next sample to be blended in (settings changed, recalibrated, …). */
  private pendingJump = false;
  private testOffset: Vec3 | null = null;

  // Scratch + latest values (also used by the preview and diagnostics).
  private readonly measurements: FaceMeasurement[] = [];
  private readonly candidates: FaceCandidate[] = [];
  private readonly pc: Vec3 = [0, 0, 0];
  private readonly ps: Vec3 = [0, 0, 0];
  private readonly pw: Vec3 = [0, 0, 0];
  private readonly filtered: Vec3 = [0, 0, 0];
  private readonly viewpoint: Vec3 = [0, 0, 0];
  private hasFiltered = false;
  private lastPrimary: FaceMeasurement | null = null;
  private lastResult: InferenceResult | null = null;
  private lastPrimaryIndex = -1;

  private preview: TrackingPreview | null = null;
  private disposed = false;

  constructor(deps: FaceTrackerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.openCameraFn = deps.openCamera ?? openCamera;
    this.backendFactory = deps.backendFactory ?? null;
    this.listCamerasFn = deps.listCameras ?? listVideoInputs;
    this.assetBase = resolveAssetBase(deps.assetBase);
    this.deviceInfo = safeDeviceInfo(deps.deviceInfo);
    this.watchOrientation = deps.watchOrientation === undefined ? defaultWatchOrientation : deps.watchOrientation;
    const defaults = defaultSettings();
    this.camera_ = { ...defaults.camera };
    this.capture = effectiveCapture(this.camera_, this.deviceInfo);
    this.view = cloneView(defaults.profiles.desktop.view);
    this.statusValue = {
      state: this.camera_.enabled ? 'idle' : 'off',
      detail: '',
      backend: null,
      cameraLabel: null,
      videoWidth: 0,
      videoHeight: 0,
      inferenceFps: 0,
      inferenceMs: 0,
      facesSeen: 0,
      viewSource: 'neutral',
      calibrated: this.view.calibrated,
      calibration: IDLE_CALIBRATION,
    };
    this.applyDerived();
  }

  /* ------------------------------------------------------------ configuration */

  configure(config: TrackerConfig): void {
    if (this.disposed) return;
    const prev = this.camera_;
    const prevCapture = this.capture;
    const prevView = this.view;
    const prevWindow = this.window;
    this.camera_ = { ...config.camera };
    this.capture = effectiveCapture(this.camera_, this.deviceInfo);
    if (config.profile) this.profile = config.profile;
    this.view = cloneView(config.view);
    this.window = {
      widthM: config.window.widthM,
      heightM: config.window.heightM,
      centerOffsetM: [config.window.centerOffsetM[0], config.window.centerOffsetM[1]],
    };
    this.applyDerived();
    if (this.testOffset) this.controller.setTest(offsetViewpoint(this.testOffset, this.view));

    // Anything that changes how a head position maps to a viewpoint is blended in, never jumped.
    if (
      JSON.stringify(prevView) !== JSON.stringify(this.view) ||
      prevWindow.centerOffsetM[0] !== this.window.centerOffsetM[0] ||
      prevWindow.centerOffsetM[1] !== this.window.centerOffsetM[1]
    ) {
      this.pendingJump = true;
      // The depth scale or the mount changed: old filter history is in a different space.
      if (
        prevView.calDepthK !== this.view.calDepthK ||
        prevView.hfov !== this.view.hfov ||
        prevView.camPitch !== this.view.camPitch ||
        prevView.camYaw !== this.view.camYaw ||
        prevView.camRoll !== this.view.camRoll ||
        prevView.camRotation !== this.view.camRotation ||
        prevView.mirror !== this.view.mirror ||
        String(prevView.camPos) !== String(this.view.camPos)
      ) {
        this.filter.reset();
        this.hasFiltered = false;
      }
      if (prevView.camRotation !== this.view.camRotation) this.selector.reset();
    }
    if (prev.headWeight !== this.camera_.headWeight) this.pendingJump = true;
    this.refreshHeadBias(false);

    if (!this.camera_.enabled) {
      if (this.starting || this.running) this.stop();
      if (this.session.active) {
        this.session.cancel();
        this.stopSessionTimer();
      }
      this.patch({ state: 'off', detail: '', calibrated: this.view.calibrated, calibration: this.session.status() });
      return;
    }
    if (this.statusValue.state === 'off') this.patch({ state: 'idle', detail: '' });
    this.patch({ calibrated: this.view.calibrated });

    if (this.starting || this.running) {
      if (prev.deviceId !== this.camera_.deviceId || prevCapture.resolution !== this.capture.resolution) {
        // A different camera or frame size: reopen the device (a running countdown is cancelled).
        this.stop();
        void this.start();
      } else if (prevCapture.numFaces !== this.capture.numFaces || prev.delegate !== this.camera_.delegate) {
        void this.reloadBackend();
      }
    }
  }

  /** Head turns move the view only when enabled and a calibration (baseline) exists for this preset. */
  private headTermActive(): boolean {
    return this.camera_.headWeight > 0 && this.view.calibrated;
  }

  setActiveProfile(profile: DisplayProfileId): void {
    if (this.disposed || this.profile === profile) return;
    this.profile = profile;
    this.refreshHeadBias(true);
  }

  /**
   * Takes the head-direction baseline from the configuration when the configured value changed
   * (or `force`): a baseline captured by this tracker stays in use until the application stores
   * a different one, even if configure() is called with the old settings in between.
   */
  private refreshHeadBias(force: boolean): void {
    const configured = headBiasFor(this.camera_, this.profile, this.view.calibrated);
    if (!force && configured.yaw === this.configuredBias.yaw && configured.pitch === this.configuredBias.pitch) return;
    this.configuredBias.yaw = configured.yaw;
    this.configuredBias.pitch = configured.pitch;
    if (configured.yaw !== this.headBias.yaw || configured.pitch !== this.headBias.pitch) {
      this.headBias.yaw = configured.yaw;
      this.headBias.pitch = configured.pitch;
      this.pendingJump = true;
    }
  }

  private applyDerived(): void {
    this.rotation = parseRotation(this.view.camRotation);
    const rawW = this.camera?.width || this.statusValue?.videoWidth || 640;
    const rawH = this.camera?.height || this.statusValue?.videoHeight || 480;
    this.frame = uprightFrame(rawW, rawH, this.rotation, this.view.mirror);
    mountMatrix({ pos: this.view.camPos, pitchDeg: this.view.camPitch, yawDeg: this.view.camYaw, rollDeg: this.view.camRoll }, this.matrix);
    this.focalRef = effectiveFocalRef(this.view.hfov, this.view.calDepthK);
    this.filter.configure({
      minCutoff: this.camera_.filterMinCutoff,
      beta: this.camera_.filterBeta,
      deadzoneM: this.camera_.deadzoneMm / 1000,
      outlierM: this.camera_.outlierM,
    });
    // The head-turn offset is in metres too: same One Euro parameters as the lateral position.
    for (const f of [this.headFilterX, this.headFilterY]) {
      f.minCutoff = this.camera_.filterMinCutoff;
      f.beta = this.camera_.filterBeta;
    }
    this.controller.configure({
      neutral: neutralViewpoint(this.view),
      lostHoldMs: this.camera_.lostHoldMs,
      returnMs: this.camera_.returnMs,
      reacquireMs: this.camera_.reacquireMs,
      smoothMs: this.camera_.smoothMs,
    });
    // Keep the lock a little longer than the viewpoint needs to get back to neutral.
    this.selector.config.releaseAfterMs = Math.max(1200, this.camera_.lostHoldMs + this.camera_.returnMs * 0.75);
  }

  /* ------------------------------------------------------------------ status */

  status(): TrackerStatus {
    return this.statusValue;
  }

  subscribe(listener: (status: TrackerStatus) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private patch(patch: Partial<TrackerStatus>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof TrackerStatus)[]) {
      if (this.statusValue[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    // A fresh object per change so UI stores can compare by reference.
    this.statusValue = { ...this.statusValue, ...patch };
    for (const listener of [...this.listeners]) {
      try {
        listener(this.statusValue);
      } catch (error) {
        console.error('[tracking] status listener threw', error);
      }
    }
  }

  /* ------------------------------------------------------------- start / stop */

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.camera_.enabled) {
      this.patch({ state: 'off', detail: '' });
      return Promise.resolve();
    }
    if (this.startPromise) return this.startPromise;
    if (this.running) return Promise.resolve();
    const promise = this.doStart().catch((error) => {
      // doStart handles its own failures; this is a last line of defence so start() never rejects.
      this.starting = false;
      this.lastError = describe(error);
      this.patch({ state: 'model_error', detail: this.lastError });
      this.failWaitingSession('model_error');
    });
    this.startPromise = promise;
    void promise.finally(() => {
      if (this.startPromise === promise) this.startPromise = null;
    });
    return promise;
  }

  private async doStart(): Promise<void> {
    const gen = ++this.generation;
    this.starting = true;
    this.failedKinds = [];
    this.backendFailures = 0;
    this.patch({ state: 'requesting', detail: '', backend: null });

    // Load the model while the permission prompt is (possibly) open.
    const backendPromise = this.selectBackend(gen);

    // Front camera ('user' facing) unless a device was chosen; reduced frame size on phones / low-power devices.
    const opened = await this.openCameraFn({ deviceId: this.camera_.deviceId, resolution: this.capture.resolution });
    if (gen !== this.generation) {
      // stop() or a restart happened while the prompt was open: release the device right away.
      if (opened.ok) opened.camera.close();
      void backendPromise.then((backend) => backend?.dispose());
      return;
    }
    if (!opened.ok) {
      this.starting = false;
      this.generation++; // cancels the backend probe
      void backendPromise.then((backend) => backend?.dispose());
      this.patch({ state: opened.state, detail: opened.detail });
      this.failWaitingSession(START_FAILURES[opened.state] ?? 'no_device');
      return;
    }

    this.camera = opened.camera;
    this.camera.onEnded((detail) => this.handleCameraEnded(detail));
    this.patch({
      state: 'loading',
      detail: '',
      cameraLabel: this.camera.label,
      videoWidth: this.camera.width,
      videoHeight: this.camera.height,
    });
    this.applyDerived();

    const backend = await backendPromise;
    if (gen !== this.generation) {
      backend?.dispose();
      return;
    }
    if (!backend) {
      this.starting = false;
      this.camera.close();
      this.camera = null;
      this.patch({ state: 'model_error', detail: this.describeAttempts(), cameraLabel: null, videoWidth: 0, videoHeight: 0 });
      this.failWaitingSession('model_error');
      return;
    }
    this.backend = backend;
    this.starting = false;
    this.running = true;
    this.busy = false;
    this.nextDueMs = 0;
    this.frameLandscape = null;
    this.patch({ state: 'searching', detail: '', backend: backend.kind });
    this.unsubscribeFrames = this.camera.onFrame(this.onCameraFrame);
    this.unwatchOrientation?.();
    this.unwatchOrientation = null;
    try {
      this.unwatchOrientation = this.watchOrientation?.(this.onOrientationChange) ?? null;
    } catch {
      this.unwatchOrientation = null;
    }
    // A countdown requested before the camera was running starts counting now.
    if (this.session.phase === 'waiting') {
      this.session.cameraReady(this.now());
      this.publishCalibration();
    }
  }

  private async selectBackend(gen: number): Promise<InferenceBackend | null> {
    const factory = this.backendFactory ?? createBackend;
    const result = await selectBackend(
      this.camera_.delegate,
      {
        wasmBase: `${this.assetBase}wasm`,
        modelUrl: `${this.assetBase}models/face_landmarker.task`,
        numFaces: this.capture.numFaces,
      },
      factory,
      () => gen !== this.generation,
      this.failedKinds,
    );
    this.attempts = [...this.attempts.filter((a) => this.failedKinds.includes(a.kind) && !a.ok), ...result.attempts];
    return result.backend;
  }

  /** Replaces the inference backend while keeping the camera open. */
  private async reloadBackend(): Promise<void> {
    if (!this.running || !this.camera) return;
    const gen = this.generation;
    const old = this.backend;
    this.backend = null;
    this.busy = false;
    old?.dispose();
    this.patch({ state: 'loading', backend: null });
    const backend = await this.selectBackend(gen);
    if (gen !== this.generation || !this.running) {
      backend?.dispose();
      return;
    }
    if (!backend) {
      this.stopInternal('model_error', this.describeAttempts(), 'model_error');
      return;
    }
    this.backend = backend;
    this.backendFailures = 0;
    this.selector.reset();
    this.patch({ state: 'searching', detail: '', backend: backend.kind });
    // A countdown requested while the backend was being replaced starts counting now.
    if (this.session.phase === 'waiting') {
      this.session.cameraReady(this.now());
      this.publishCalibration();
    }
  }

  stop(): void {
    const enabled = this.camera_.enabled;
    this.stopInternal(enabled ? 'idle' : 'off', '');
  }

  /**
   * Releases everything. A running countdown is cancelled (stop() / switched off: the user's
   * choice) or fails with `sessionFailure` (the camera went away on its own).
   */
  private stopInternal(state: TrackerState, detail: string, sessionFailure?: CountdownFailure): void {
    this.generation++;
    this.starting = false;
    this.running = false;
    this.busy = false;
    this.unsubscribeFrames?.();
    this.unsubscribeFrames = null;
    this.unwatchOrientation?.();
    this.unwatchOrientation = null;
    this.backend?.dispose();
    this.backend = null;
    this.camera?.close();
    this.camera = null;
    this.selector.reset();
    this.filter.reset();
    this.hasFiltered = false;
    this.headFiltered = false;
    this.frameLandscape = null;
    this.lastPrimary = null;
    this.lastResult = null;
    this.lastPrimaryIndex = -1;
    this.inferStamps.length = 0;
    this.controller.release(this.now());
    this.finishCalibration({ ok: false, detail: 'stopped', samples: 0 });
    if (this.session.active) {
      if (sessionFailure) this.session.fail(sessionFailure);
      else this.session.cancel();
    } else if (this.session.phase === 'idle') {
      // A rotation prompt makes no sense without a camera.
      this.session.setIdleDetail('');
    }
    this.stopSessionTimer();
    this.patch({
      state,
      detail,
      backend: null,
      cameraLabel: null,
      videoWidth: 0,
      videoHeight: 0,
      inferenceFps: 0,
      inferenceMs: 0,
      facesSeen: 0,
      calibration: this.session.status(),
    });
  }

  private handleCameraEnded(detail: string): void {
    if (!this.running && !this.starting) return;
    this.lastError = detail;
    this.stopInternal('no_device', detail, 'camera_lost');
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.nextDueMs = 0;
    // Hidden page: nobody can look at a countdown. It is dropped (the baseline stays as it was).
    if (paused && this.session.active) {
      this.session.cancel();
      this.stopSessionTimer();
      this.publishCalibration();
    }
  }

  /* ------------------------------------------------------------ inference loop */

  private onCameraFrame = (): void => {
    if (!this.running || this.paused || this.busy) return; // only the newest frame is ever used
    const backend = this.backend;
    const camera = this.camera;
    if (!backend || !camera) return;
    const now = this.now();
    const interval = 1000 / Math.min(60, Math.max(1, this.capture.inferenceHz));
    if (now < this.nextDueMs - 4) return;
    this.nextDueMs = now - this.nextDueMs > interval ? now + interval : this.nextDueMs + interval;

    this.busy = true;
    const gen = this.generation;
    backend.infer(camera, now, this.rotation).then(
      (result) => {
        if (gen !== this.generation || backend !== this.backend) return;
        this.busy = false;
        this.backendFailures = 0;
        this.onResult(result);
      },
      (error) => {
        if (gen !== this.generation || backend !== this.backend) return;
        this.busy = false;
        this.onInferenceError(backend, error);
      },
    );
  };

  private onInferenceError(backend: InferenceBackend, error: unknown): void {
    this.lastError = describe(error);
    this.backendFailures++;
    if (this.backendFailures < MAX_BACKEND_FAILURES) return;
    // This backend keeps failing: mark it bad and try the next one.
    this.failedKinds.push(backend.kind);
    this.attempts.push({ kind: backend.kind, ok: false, detail: `failed while running: ${this.lastError}`, ms: 0 });
    void this.reloadBackend();
  }

  private onResult(result: InferenceResult): void {
    const now = this.now();
    this.inferenceCount++;
    this.lastResult = result;

    // The frame size is only really known once the detector saw a frame.
    if (result.frameWidth > 0) {
      if (result.frameWidth !== this.frame.pixelWidth || result.frameHeight !== this.frame.pixelHeight) {
        const swap = this.rotation === 90 || this.rotation === 270;
        const rawW = swap ? result.frameHeight : result.frameWidth;
        const rawH = swap ? result.frameWidth : result.frameHeight;
        this.frame = uprightFrame(rawW, rawH, this.rotation, this.view.mirror);
        this.patch({ videoWidth: rawW, videoHeight: rawH });
      }
      // Phones rotate the camera picture with the screen: portrait ↔ landscape is a new geometry.
      const landscape = result.frameWidth >= result.frameHeight;
      if (this.frameLandscape !== null && landscape !== this.frameLandscape) this.handleRotation(now);
      this.frameLandscape = landscape;
    }

    const faces = result.faceCount;
    while (this.measurements.length < faces) this.measurements.push(createMeasurement());
    this.candidates.length = 0;
    const measured: (FaceMeasurement | null)[] = [];
    for (let i = 0; i < faces; i++) {
      const m = measureFace(result.faces, i * FLOATS_PER_FACE, this.frame, this.focalRef, this.measurements[i]);
      measured.push(m);
      // Faces that could not be measured stay in the list (with a residual no gate accepts) so indices line up.
      this.candidates.push(m ? { u: m.centerU, v: m.centerV, size: m.sizeU, residual: m.residual } : { u: 0, v: 0, size: 0, residual: 1e9 });
    }

    const wasLocked = this.selector.locked;
    const index = this.selector.update(result.captureMs, this.candidates, this.frame.height / this.frame.width);
    this.lastPrimaryIndex = index;
    const primary = index >= 0 ? measured[index]! : null;
    this.lastPrimary = primary;

    if (primary) {
      if (!wasLocked) {
        // A new player: start the measurement filters from scratch.
        this.filter.reset();
        this.hasFiltered = false;
        this.headFiltered = false;
      }
      eyeInCamera(primary, this.pc);
      cameraToScreen(this.pc, this.matrix, this.view.camPos, this.ps);
      screenToWindow(this.ps, this.window, this.pw);
      // Head direction in screen space, relative to looking at the middle of the window.
      headDirectionScreen(primary.yaw, primary.pitch, this.matrix, this.headDir);
      headRelativeToCentre(this.headDir, this.pw, this.headRel);

      // Countdown calibration: raw (unfiltered) samples, so filter lag cannot bias the baseline.
      if (this.session.phase === 'countdown' || this.session.phase === 'capturing') {
        const completed = this.session.push({ t: result.captureMs, eye: this.pw, yaw: this.headRel.yaw, pitch: this.headRel.pitch });
        if (completed) this.completeBaseline();
        else this.publishCalibration();
      }

      headOffset(
        this.headRel.yaw - this.headBias.yaw,
        this.headRel.pitch - this.headBias.pitch,
        this.camera_.headWeight,
        Math.max(0.2, this.view.eye[2]),
        this.headRaw,
      );
      const filterResult = this.filter.push(result.captureMs, this.pw, this.filtered);
      if (filterResult === 'rejected') {
        this.outliersRejected++;
      } else {
        this.hasFiltered = true;
        const t = result.captureMs / 1000;
        if (filterResult === 'jump' || !this.headFiltered) {
          this.headFilterX.snap(this.headRaw[0], t);
          this.headFilterY.snap(this.headRaw[1], t);
          this.headFiltered = true;
        }
        this.headOff[0] = this.headFilterX.filter(this.headRaw[0], t);
        this.headOff[1] = this.headFilterY.filter(this.headRaw[1], t);
        // The head-turn term is measured from the baseline, so it only applies once one exists.
        mapToViewpoint(this.filtered, this.view, this.viewpoint, this.headTermActive() ? this.headOff : null);
        this.controller.pushSample(result.captureMs, this.viewpoint, filterResult === 'jump' || this.pendingJump);
        this.pendingJump = false;
      }
      if (this.collector.state === 'collecting') {
        this.collector.push(result.captureMs, primary, result.faces, index * FLOATS_PER_FACE);
        this.checkCalibration();
      }
    } else {
      this.controller.pushMiss(result.captureMs);
      if (!this.selector.locked) {
        this.hasFiltered = false;
        this.headFiltered = false;
      }
    }
    if (this.session.phase === 'capturing' || this.session.phase === 'countdown') this.tickSession(now);

    // Status.
    this.inferStamps.push(now);
    while (this.inferStamps.length > 0 && now - this.inferStamps[0]! > 1000) this.inferStamps.shift();
    this.inferMsAvg += (result.inferMs - this.inferMsAvg) * (this.inferMsAvg === 0 ? 1 : 0.15);
    const selectorState = this.selector.state;
    const state: TrackerState = selectorState === 'locked' ? 'tracking' : selectorState === 'missing' ? 'lost' : 'searching';
    const patch: Partial<TrackerStatus> = { state, facesSeen: faces };
    if (now - this.lastStatsMs > 500) {
      this.lastStatsMs = now;
      patch.inferenceFps = Math.round(this.inferStamps.length * 10) / 10;
      patch.inferenceMs = Math.round(this.inferMsAvg * 10) / 10;
    }
    this.patch(patch);
  }

  /* -------------------------------------------------------------- viewpoint */

  sampleEye(nowMs: number, out: Vec3): ViewSource {
    // Drag-to-peek: asked every frame whether the view is being dragged; never while a face (or the
    // test viewpoint) drives it.
    if (this.dragSource) this.controller.setDrag(this.dragSource(nowMs, this.controller.isLive || this.testOffset !== null));
    const source = this.controller.sample(nowMs, out);
    if (source !== this.statusValue.viewSource) this.patch({ viewSource: source });
    // The countdown advances with the render loop (cheap; the status only changes once a second).
    const phase = this.session.phase;
    if (phase === 'countdown' || phase === 'capturing' || phase === 'done') this.tickSession(nowMs);
    return source;
  }

  /** Drag-to-peek (src/app/PeekDrag.ts): see {@link DragSource}. */
  setDragSource(source: DragSource | null): void {
    this.dragSource = source;
    if (!source) this.controller.setDrag(null);
  }

  setTestViewpoint(offset: Vec3 | null): void {
    if (!offset) {
      this.testOffset = null;
      this.controller.setTest(null);
      return;
    }
    this.testOffset = [offset[0], offset[1], offset[2]];
    this.controller.setTest(offsetViewpoint(this.testOffset, this.view));
  }

  /* ------------------------------------------------------------- calibration */

  onCalibration(listener: (event: CalibrationEvent) => void): Unsubscribe {
    this.calibrationListeners.add(listener);
    return () => {
      this.calibrationListeners.delete(listener);
    };
  }

  calibrate(): Promise<CalibrationOutcome> {
    if (!this.running || !this.backend) {
      return Promise.resolve({ ok: false, detail: 'not_running', samples: 0 });
    }
    if (this.calibrationPromise) return this.calibrationPromise;
    this.collector.start(this.now());
    this.calibrationPromise = new Promise<CalibrationOutcome>((resolve) => {
      this.calibrationResolve = resolve;
    });
    // Also tick on a timer so the routine times out even if no inference results arrive.
    this.calibrationTimer = setInterval(() => {
      this.collector.tick(this.now());
      this.checkCalibration();
    }, 100);
    return this.calibrationPromise;
  }

  private checkCalibration(): void {
    if (!this.calibrationResolve) return;
    if (this.collector.state === 'done' && this.collector.result) {
      const average = this.collector.result;
      const solved = solveCalibration({
        face: average.face,
        frame: this.frame,
        matrix: this.matrix,
        cameraPos: this.view.camPos,
        refDistanceM: this.view.refDistance,
        window: this.window,
        focalGuess: this.focalRef,
      });
      if (!solved.ok) {
        this.finishCalibration({ ok: false, detail: solved.reason, samples: average.samples });
        return;
      }
      this.applyCalibration('calibrate', solved.values);
      this.finishCalibration({ ok: true, detail: 'ok', samples: average.samples, values: solved.values, hfovDeg: solved.hfovDeg });
    } else if (this.collector.state === 'failed') {
      this.finishCalibration({ ok: false, detail: this.collector.failure ?? 'unstable', samples: 0 });
    }
  }

  private finishCalibration(outcome: CalibrationOutcome): void {
    if (this.calibrationTimer) clearInterval(this.calibrationTimer);
    this.calibrationTimer = null;
    this.collector.cancel();
    const resolve = this.calibrationResolve;
    this.calibrationResolve = null;
    this.calibrationPromise = null;
    resolve?.(outcome);
  }

  private applyCalibration(kind: CalibrationEvent['kind'], values: CalibrationValues): void {
    const depthChanged = values.calDepthK !== this.view.calDepthK;
    this.view = {
      ...this.view,
      calDepthK: values.calDepthK,
      calNeutral: [values.calNeutral[0], values.calNeutral[1], values.calNeutral[2]],
      calibrated: true,
    };
    this.applyDerived();
    if (depthChanged) {
      this.filter.reset();
      this.hasFiltered = false;
    }
    if (typeof values.headYaw === 'number' && typeof values.headPitch === 'number') {
      this.headBias.yaw = values.headYaw * DEG2RAD;
      this.headBias.pitch = values.headPitch * DEG2RAD;
    }
    this.pendingJump = true;
    this.patch({ calibrated: true });
    const event: CalibrationEvent = { kind, values };
    for (const listener of [...this.calibrationListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[tracking] calibration listener threw', error);
      }
    }
  }

  recenter(): void {
    if (!this.running || !this.hasFiltered || this.selector.state !== 'locked') return;
    this.applyCalibration('recenter', {
      calDepthK: this.view.calDepthK,
      calNeutral: [this.filtered[0], this.filtered[1], this.filtered[2]],
      calibrated: true,
    });
  }

  /* ------------------------------------------------- countdown calibration */

  /**
   * Countdown calibration (TrackerPort contract): `seconds` whole seconds of countdown, then
   * ~0.7 s of steady samples are averaged into the new baseline (eye position + head direction).
   * Starts the camera first when it is enabled but not running (this is a user action); the
   * countdown then waits for it. Calling it again restarts the countdown.
   */
  startCalibration(seconds: number): void {
    if (this.disposed) return;
    const now = this.now();
    if (!this.camera_.enabled) {
      this.session.fail('not_running');
      this.publishCalibration();
      return;
    }
    const ready = this.running && !!this.backend;
    this.session.start(now, countdownSeconds(seconds), !ready);
    this.ensureSessionTimer();
    this.publishCalibration();
    if (!ready && !this.starting) void this.start();
  }

  /** Stops a countdown / capture or clears a result on screen; the stored baseline stays as it was. */
  cancelCalibration(): void {
    if (this.disposed) return;
    this.session.cancel();
    this.stopSessionTimer();
    this.publishCalibration();
  }

  private publishCalibration(): void {
    this.patch({ calibration: this.session.status() });
  }

  private tickSession(nowMs: number): void {
    if (this.session.tick(nowMs)) this.publishCalibration();
    if (!this.session.active && this.session.phase !== 'done') this.stopSessionTimer();
  }

  /** A fallback clock for the countdown: frames and renders may pause, the countdown must not hang. */
  private ensureSessionTimer(): void {
    if (this.sessionTimer || typeof setInterval !== 'function') return;
    this.sessionTimer = setInterval(() => this.tickSession(this.now()), SESSION_TICK_MS);
    (this.sessionTimer as { unref?: () => void }).unref?.();
  }

  private stopSessionTimer(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    this.sessionTimer = null;
  }

  /** The camera could not be started for a countdown that was waiting for it. */
  private failWaitingSession(reason: CountdownFailure): void {
    if (this.session.phase !== 'waiting') return;
    this.session.fail(reason);
    this.stopSessionTimer();
    this.publishCalibration();
  }

  /** A steady capture window was found: it becomes the baseline of the active display preset. */
  private completeBaseline(): void {
    const r = this.session.result;
    if (!r) return;
    this.lastBaseline = r;
    const values: CalibrationValues = {
      calDepthK: this.view.calDepthK,
      calNeutral: [r.eye[0], r.eye[1], r.eye[2]],
      calibrated: true,
      headYaw: roundDegrees(r.yaw * RAD2DEG),
      headPitch: roundDegrees(r.pitch * RAD2DEG),
    };
    this.applyCalibration('baseline', values);
    this.headFiltered = false;
    this.publishCalibration();
  }

  /** Screen orientation changed (phone turned): the camera geometry is new, the baseline is stale. */
  private onOrientationChange = (): void => {
    if (this.running) this.handleRotation(this.now());
  };

  private handleRotation(nowMs: number): void {
    if (nowMs - this.lastRotationMs < ROTATION_DEBOUNCE_MS) return;
    this.lastRotationMs = nowMs;
    // Measurements jump with the new picture: start the filters and the player lock afresh.
    this.filter.reset();
    this.hasFiltered = false;
    this.headFiltered = false;
    this.selector.reset();
    this.pendingJump = true;
    // Ask for a new baseline (the overlay prompts, auto-calibration counts down again).
    this.session.cancel();
    this.session.setIdleDetail(ROTATED);
    this.stopSessionTimer();
    this.publishCalibration();
  }

  /* ------------------------------------------------------------------ extras */

  attachPreview(container: HTMLElement | null): void {
    this.preview?.detach();
    this.preview = null;
    if (!container || this.disposed || typeof document === 'undefined') return;
    this.preview = new TrackingPreview(container, this.previewInfo);
  }

  private previewInfo = (): PreviewInfo => ({
    video: this.camera?.video ?? null,
    rawWidth: this.camera?.width ?? 0,
    rawHeight: this.camera?.height ?? 0,
    rotation: this.rotation,
    mirror: this.view.mirror,
    faces: this.lastResult?.faces ?? null,
    faceCount: this.lastResult?.faceCount ?? 0,
    primaryIndex: this.lastPrimaryIndex,
    locked: this.selector.locked,
  });

  listCameras(): Promise<{ id: string; label: string }[]> {
    return this.listCamerasFn();
  }

  diagnostics(): TrackerDiagnostics {
    const m = this.lastPrimary;
    return {
      attempts: [...this.attempts],
      lastError: this.lastError,
      rawWidth: this.camera?.width ?? 0,
      rawHeight: this.camera?.height ?? 0,
      rotation: this.rotation,
      mirror: this.view.mirror,
      focalRef: this.focalRef,
      hfovDeg: hfovFromFocal(this.focalRef),
      measurement:
        m && this.hasFiltered
          ? {
              ipdPx: m.ipdPx,
              yawDeg: m.yaw * RAD2DEG,
              pitchDeg: m.pitch * RAD2DEG,
              rollDeg: m.roll * RAD2DEG,
              residual: m.residual,
              camera: [this.pc[0], this.pc[1], this.pc[2]],
              window: [this.filtered[0], this.filtered[1], this.filtered[2]],
              viewpoint: [this.viewpoint[0], this.viewpoint[1], this.viewpoint[2]],
              head: {
                yawDeg: this.headDir.yaw * RAD2DEG,
                pitchDeg: this.headDir.pitch * RAD2DEG,
                relYawDeg: (this.headRel.yaw - this.headBias.yaw) * RAD2DEG,
                relPitchDeg: (this.headRel.pitch - this.headBias.pitch) * RAD2DEG,
                offset: [this.headOff[0], this.headOff[1]],
              },
            }
          : null,
      primary: this.selector.state,
      outliersRejected: this.outliersRejected,
      inferences: this.inferenceCount,
      paused: this.paused,
      capture: { ...this.capture },
      profile: this.profile,
      headBaselineDeg: { yaw: this.headBias.yaw * RAD2DEG, pitch: this.headBias.pitch * RAD2DEG },
      lastBaseline: this.lastBaseline
        ? {
            eye: [this.lastBaseline.eye[0], this.lastBaseline.eye[1], this.lastBaseline.eye[2]],
            yawDeg: this.lastBaseline.yaw * RAD2DEG,
            pitchDeg: this.lastBaseline.pitch * RAD2DEG,
            samples: this.lastBaseline.samples,
            spread: { ...this.lastBaseline.spread },
          }
        : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.session.cancel();
    this.stopSessionTimer();
    this.disposed = true;
    this.preview?.detach();
    this.preview = null;
    this.listeners.clear();
    this.calibrationListeners.clear();
  }

  private describeAttempts(): string {
    if (this.attempts.length === 0) return 'no inference backend could be created';
    return this.attempts.map((a) => `${a.kind}: ${a.ok ? 'ok' : 'failed'} (${a.detail})`).join('; ');
  }
}

function cloneView(view: ViewSettings): ViewSettings {
  return {
    ...view,
    eye: [view.eye[0], view.eye[1], view.eye[2]],
    camPos: [view.camPos[0], view.camPos[1], view.camPos[2]],
    maxOffset: [view.maxOffset[0], view.maxOffset[1], view.maxOffset[2]],
    calNeutral: [view.calNeutral[0], view.calNeutral[1], view.calNeutral[2]],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function safeDeviceInfo(read?: () => DeviceInfo): DeviceInfo {
  try {
    return read ? read() : readDeviceInfo();
  } catch {
    return { mobile: false, cores: null, memoryGb: null };
  }
}

/**
 * Creates the head tracker. It does nothing until `start()` is called (from a
 * user gesture), and `sampleEye()` returns the neutral viewpoint whenever no
 * live estimate is available – the game never depends on the camera.
 */
export function createFaceTracker(deps: FaceTrackerDeps = {}): FaceTracker {
  return new FaceTrackerImpl(deps);
}
