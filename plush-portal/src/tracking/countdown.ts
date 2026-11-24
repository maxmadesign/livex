/**
 * Countdown calibration ("baseline capture"), pure state machine.
 *
 *   idle ─start()─► (waiting for the camera) ─► countdown ─► capturing ─► done ─(hold)─► idle
 *                                                  │            │
 *                                                  └─cancel()─► idle       └─► failed (no_face / unstable / …)
 *
 * During `capturing` the tracker pushes one raw sample per inference of the primary player: the
 * eye position in window space and the head direction relative to "facing the centre of the game
 * window". The newest `captureMs` of samples are averaged as soon as they are steady; when no
 * steady window turns up within `captureTimeoutMs` the capture fails with `no_face` (hardly any
 * face samples) or `unstable` (the face was there but moved too much).
 *
 * All times are passed in (milliseconds, one clock). No DOM, no timers.
 */
import { IDLE_CALIBRATION, type CalibrationPhase, type CalibrationStatus } from '../core/contracts';
import type { Vec3 } from '../core/types';

/** Why a countdown calibration failed (CalibrationStatus.detail while phase = 'failed'). */
export type CountdownFailure =
  | 'no_face' // (almost) no face during the capture window
  | 'unstable' // a face, but never steady enough
  | 'not_running' // head tracking is switched off
  | 'camera_lost' // the camera stopped while calibrating
  | 'denied' // the camera could not be started: permission
  | 'no_device'
  | 'in_use'
  | 'insecure' // not HTTPS / localhost
  | 'model_error';

/** `CalibrationStatus.detail` while counting down but the camera is still starting. */
export const WAITING_CAMERA = 'waiting_camera';
/** `CalibrationStatus.detail` while idle after the camera picture rotated (screen orientation changed). */
export const ROTATED = 'rotated';

export interface BaselineSample {
  /** Capture time of the camera frame, ms. */
  t: number;
  /** Measured (unfiltered) eye position in window space, metres. */
  eye: Readonly<Vec3>;
  /** Head direction minus the direction to the window centre, radians (yaw + = player's right, pitch + = up). */
  yaw: number;
  pitch: number;
}

export interface BaselineResult {
  /** Mean eye position, window space, metres. */
  eye: Vec3;
  /** Mean head direction relative to facing the window centre, radians. */
  yaw: number;
  pitch: number;
  samples: number;
  /** Standard deviations of the averaged window (metres / radians), for diagnostics. */
  spread: { lateral: number; depth: number; angle: number };
}

export interface CountdownOptions {
  /** Length of the averaged window, ms. */
  captureMs: number;
  /** Fewest samples in that window. */
  minSamples: number;
  /**
   * At a low inference rate (a slow phone) `captureMs` may hold fewer than `minSamples`: the window
   * is then stretched back to hold `minSamples`, but never beyond this span, ms.
   */
  maxWindowMs: number;
  /** Give up when no steady window was found this long after the countdown ended, ms. */
  captureTimeoutMs: number;
  /** Largest allowed RMS spread of the lateral eye position (x, y): a + b × distance, metres. */
  lateralStd: [number, number];
  /** Largest allowed spread of the eye distance: a + b × distance, metres. */
  depthStd: [number, number];
  /** Largest allowed RMS spread of the head direction, radians. */
  angleStd: number;
  /** How long `done` is reported before returning to idle, ms. */
  doneHoldMs: number;
}

export const DEFAULT_COUNTDOWN_OPTIONS: CountdownOptions = {
  captureMs: 700,
  minSamples: 4,
  maxWindowMs: 1000,
  captureTimeoutMs: 3000,
  lateralStd: [0.008, 0.012],
  depthStd: [0.01, 0.02],
  angleStd: (4 * Math.PI) / 180,
  doneHoldMs: 1800,
};

/** Longest countdown that is accepted, seconds. */
export const MAX_COUNTDOWN_SECONDS = 30;

type InternalPhase = 'idle' | 'waiting' | 'countdown' | 'capturing' | 'done' | 'failed';

/** Clamps a requested countdown length to whole seconds in [0, MAX_COUNTDOWN_SECONDS] (3 when not a number). */
export function countdownSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 3;
  return Math.min(MAX_COUNTDOWN_SECONDS, Math.max(0, Math.round(seconds)));
}

export class CountdownCalibration {
  readonly options: CountdownOptions;
  private phaseValue: InternalPhase = 'idle';
  private seconds = 3;
  private endMs = 0;
  private captureStartMs = 0;
  private doneUntilMs = 0;
  /**
   * Latest time tick() saw. The tracker ticks from the render loop (frame start time) and from a
   * timer (performance.now()); a slightly older frame time must not make the count step back.
   */
  private clockMs = -Infinity;
  private samples: BaselineSample[] = [];
  private seen = 0;
  private failureValue: CountdownFailure | null = null;
  private resultValue: BaselineResult | null = null;
  private statusValue: CalibrationStatus = IDLE_CALIBRATION;
  /** Detail reported while idle (e.g. ROTATED); cleared by start() / cancel(). */
  private idleDetail = '';

  constructor(options: Partial<CountdownOptions> = {}) {
    this.options = { ...DEFAULT_COUNTDOWN_OPTIONS, ...options };
  }

  /** Raw phase (`waiting` = countdown requested, camera not running yet). */
  get phase(): InternalPhase {
    return this.phaseValue;
  }
  /** True from start() until done / failed / cancel. */
  get active(): boolean {
    return this.phaseValue === 'waiting' || this.phaseValue === 'countdown' || this.phaseValue === 'capturing';
  }
  get failure(): CountdownFailure | null {
    return this.failureValue;
  }
  /** The captured baseline (set when the phase becomes `done`). */
  get result(): BaselineResult | null {
    return this.resultValue;
  }

  /**
   * Starts (or restarts) the countdown. With `waitForCamera` the countdown is held at its full
   * length until cameraReady() is called.
   */
  start(nowMs: number, seconds: number, waitForCamera = false): void {
    this.seconds = countdownSeconds(seconds);
    this.samples = [];
    this.seen = 0;
    this.failureValue = null;
    this.resultValue = null;
    this.idleDetail = '';
    this.clockMs = nowMs;
    if (waitForCamera) {
      this.phaseValue = 'waiting';
    } else {
      this.beginCountdown(nowMs);
    }
    this.refresh(nowMs);
  }

  /** The camera is running now: a waiting countdown starts counting. */
  cameraReady(nowMs: number): void {
    if (this.phaseValue !== 'waiting') return;
    this.clockMs = nowMs;
    this.beginCountdown(nowMs);
    this.refresh(nowMs);
  }

  /** Stops whatever runs and returns to idle; nothing is captured. */
  cancel(): void {
    this.phaseValue = 'idle';
    this.samples = [];
    this.idleDetail = '';
    this.refresh(0);
  }

  /** Ends a running calibration with a failure (camera problems, tracking switched off, …). */
  fail(reason: CountdownFailure): void {
    this.phaseValue = 'failed';
    this.failureValue = reason;
    this.samples = [];
    this.refresh(0);
  }

  /** Detail shown while idle (ROTATED or ''); ignored while a calibration runs or a result is shown. */
  setIdleDetail(detail: string): void {
    this.idleDetail = detail;
    this.refresh(0);
  }

  /** Advances the countdown / timeouts. Returns true when the status changed. */
  tick(time: number): boolean {
    const nowMs = Math.max(time, this.clockMs);
    this.clockMs = nowMs;
    const before = this.statusValue;
    switch (this.phaseValue) {
      case 'countdown':
        if (nowMs >= this.endMs) {
          this.phaseValue = 'capturing';
          this.captureStartMs = this.endMs;
          this.samples = [];
          this.seen = 0;
        }
        break;
      case 'capturing':
        if (nowMs - this.captureStartMs >= this.options.captureTimeoutMs) {
          this.phaseValue = 'failed';
          this.failureValue = this.seen < this.options.minSamples ? 'no_face' : 'unstable';
          this.samples = [];
        }
        break;
      case 'done':
        if (nowMs >= this.doneUntilMs) {
          this.phaseValue = 'idle';
          this.idleDetail = '';
        }
        break;
      default:
        break;
    }
    this.refresh(nowMs);
    return this.statusValue !== before;
  }

  /**
   * Feeds one sample of the primary player while capturing (ignored otherwise and for frames
   * captured before the countdown ended). Returns true when the capture completed.
   */
  push(sample: BaselineSample): boolean {
    if (this.phaseValue === 'countdown' && sample.t >= this.endMs) this.tick(sample.t);
    if (this.phaseValue !== 'capturing' || sample.t < this.captureStartMs) return false;
    if (!isFiniteVec(sample.eye) || !Number.isFinite(sample.yaw) || !Number.isFinite(sample.pitch)) return false;
    this.seen++;
    this.samples.push({ t: sample.t, eye: [sample.eye[0], sample.eye[1], sample.eye[2]], yaw: sample.yaw, pitch: sample.pitch });
    const { captureMs, minSamples } = this.options;
    const maxWindowMs = Math.max(captureMs, this.options.maxWindowMs);
    // The newest captureMs of samples; stretched (up to maxWindowMs) while it would hold fewer than minSamples.
    while (this.samples.length > 0) {
      const span = sample.t - this.samples[0]!.t;
      if (span <= captureMs || (span <= maxWindowMs && this.samples.length <= minSamples)) break;
      this.samples.shift();
    }
    if (this.samples.length < minSamples) return false;
    // The window must really span (most of) captureMs, not just hold enough samples.
    if (sample.t - this.samples[0]!.t < captureMs * 0.75) return false;
    const stats = baselineStats(this.samples);
    const z = Math.max(0.2, stats.mean.eye[2]);
    const o = this.options;
    const lateralMax = o.lateralStd[0] + o.lateralStd[1] * z;
    const depthMax = o.depthStd[0] + o.depthStd[1] * z;
    if (stats.lateral > lateralMax || stats.depth > depthMax || stats.angle > o.angleStd) return false;
    // A slow, steady movement can stay under the spread limits: also require no drift between the
    // first and the second half of the window.
    if (stats.drift.lateral > lateralMax * 0.5 || stats.drift.depth > depthMax * 0.5 || stats.drift.angle > o.angleStd * 0.5) return false;
    this.resultValue = { ...stats.mean, spread: { lateral: stats.lateral, depth: stats.depth, angle: stats.angle } };
    this.phaseValue = 'done';
    this.doneUntilMs = sample.t + o.doneHoldMs;
    this.samples = [];
    this.refresh(sample.t);
    return true;
  }

  /** Contract view of the state. The same object is returned until something changes. */
  status(): CalibrationStatus {
    return this.statusValue;
  }

  private beginCountdown(nowMs: number): void {
    this.endMs = nowMs + this.seconds * 1000;
    if (this.seconds === 0) {
      this.phaseValue = 'capturing';
      this.captureStartMs = nowMs;
    } else {
      this.phaseValue = 'countdown';
    }
  }

  private refresh(nowMs: number): void {
    let phase: CalibrationPhase;
    let remaining = 0;
    let detail = '';
    switch (this.phaseValue) {
      case 'idle':
        phase = 'idle';
        detail = this.idleDetail;
        break;
      case 'waiting':
        phase = 'countdown';
        remaining = this.seconds;
        detail = WAITING_CAMERA;
        break;
      case 'countdown':
        phase = 'countdown';
        remaining = Math.max(1, Math.min(this.seconds, Math.ceil((this.endMs - nowMs) / 1000 - 1e-9)));
        break;
      case 'capturing':
        phase = 'capturing';
        break;
      case 'done':
        phase = 'done';
        detail = 'ok';
        break;
      case 'failed':
        phase = 'failed';
        detail = this.failureValue ?? 'unstable';
        break;
    }
    const s = this.statusValue;
    if (s.phase !== phase || s.remaining !== remaining || s.detail !== detail) {
      this.statusValue = phase === 'idle' && detail === '' ? IDLE_CALIBRATION : Object.freeze({ phase, remaining, detail });
    }
  }
}

function isFiniteVec(v: Readonly<Vec3>): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Fraction of samples dropped at each end before averaging (robust against the tail of a movement). */
const TRIM = 0.2;

/** Mean after dropping the lowest and highest TRIM of the values. */
export function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * TRIM);
  const kept = sorted.slice(k, sorted.length - k);
  let sum = 0;
  for (const v of kept) sum += v;
  return sum / Math.max(1, kept.length);
}

/**
 * Baseline of a window of samples: trimmed means (eye position, head direction), the spreads
 * (standard deviations about the plain mean: lateral = x / y combined, angle = yaw / pitch
 * combined) and the drift between the first and the second half of the window.
 */
export function baselineStats(samples: readonly BaselineSample[]): {
  mean: { eye: Vec3; yaw: number; pitch: number; samples: number };
  lateral: number;
  depth: number;
  angle: number;
  drift: { lateral: number; depth: number; angle: number };
} {
  const n = samples.length;
  const avg = (from: number, to: number) => {
    const m = [0, 0, 0, 0, 0];
    for (let i = from; i < to; i++) {
      const s = samples[i]!;
      m[0]! += s.eye[0];
      m[1]! += s.eye[1];
      m[2]! += s.eye[2];
      m[3]! += s.yaw;
      m[4]! += s.pitch;
    }
    const k = Math.max(1, to - from);
    return m.map((v) => v / k);
  };
  const [x, y, z, yaw, pitch] = avg(0, n) as [number, number, number, number, number];
  let vl = 0, vd = 0, va = 0;
  for (const s of samples) {
    vl += (s.eye[0] - x) ** 2 + (s.eye[1] - y) ** 2;
    vd += (s.eye[2] - z) ** 2;
    va += (s.yaw - yaw) ** 2 + (s.pitch - pitch) ** 2;
  }
  const half = Math.floor(n / 2);
  const a = avg(0, half);
  const b = avg(n - half, n);
  return {
    mean: {
      eye: [trimmedMean(samples.map((s) => s.eye[0])), trimmedMean(samples.map((s) => s.eye[1])), trimmedMean(samples.map((s) => s.eye[2]))],
      yaw: trimmedMean(samples.map((s) => s.yaw)),
      pitch: trimmedMean(samples.map((s) => s.pitch)),
      samples: n,
    },
    lateral: Math.sqrt(vl / n),
    depth: Math.sqrt(vd / n),
    angle: Math.sqrt(va / n),
    drift: {
      lateral: Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!),
      depth: Math.abs(b[2]! - a[2]!),
      angle: Math.hypot(b[3]! - a[3]!, b[4]! - a[4]!),
    },
  };
}
