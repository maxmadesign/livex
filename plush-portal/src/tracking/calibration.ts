/**
 * Quick calibration: the player stands at their usual spot, at the reference
 * distance from the screen, and holds still for about a second.
 *
 *   1. depth scale  – the focal constant `calDepthK` is solved so that the
 *      measured eye is exactly `refDistance` in front of the screen plane
 *      (taking the camera position and tilt into account);
 *   2. neutral pose – the resulting eye position (window space) becomes
 *      `calNeutral`, the measured position that maps onto the reference eye.
 *
 * Pure functions / classes; the tracker feeds measurements in.
 */
import type { Vec3 } from '../core/types';
import { cameraToScreen } from './cameraTransform';
import { depthKFromFocal, type FaceMeasurement } from './eyeEstimator';
import type { UprightFrame } from './frameGeometry';
import { REFERENCE_FRAME_WIDTH } from './landmarks';
import type { PhysicalWindow } from './viewMapping';

export interface CalibrationValues {
  /** focal length (reference px) × 63 mm; 0 = not calibrated (derive from hfov). */
  calDepthK: number;
  /** Measured eye position in window space that corresponds to the neutral pose, metres. */
  calNeutral: Vec3;
  calibrated: true;
}

export interface AveragedMeasurement {
  eyeX: number;
  eyeY: number;
  pxPerM: number;
  eyeDepthOffsetM: number;
  samples: number;
}

export type CollectorState = 'idle' | 'collecting' | 'done' | 'failed';
export type CalibrationFailure = 'no_face' | 'unstable';

export interface CollectorOptions {
  /** Length of the stable window that is averaged, ms. */
  windowMs: number;
  minSamples: number;
  /** Give up after this long, ms. */
  timeoutMs: number;
  /** Largest allowed standard deviation of the eye position, as a fraction of the IPD in pixels. */
  maxPositionStd: number;
  /** Largest allowed relative standard deviation of the face scale. */
  maxScaleStd: number;
}

export const DEFAULT_COLLECTOR_OPTIONS: CollectorOptions = {
  windowMs: 1000,
  minSamples: 8,
  timeoutMs: 5000,
  maxPositionStd: 0.14,
  maxScaleStd: 0.035,
};

interface Sample {
  t: number;
  eyeX: number;
  eyeY: number;
  pxPerM: number;
  eyeDepthOffsetM: number;
}

/** Collects measurements until the last `windowMs` of them are stable. */
export class CalibrationCollector {
  readonly options: CollectorOptions;
  private samples: Sample[] = [];
  private startMs = 0;
  private stateValue: CollectorState = 'idle';
  private failureValue: CalibrationFailure | null = null;
  private resultValue: AveragedMeasurement | null = null;
  private totalSeen = 0;

  constructor(options: Partial<CollectorOptions> = {}) {
    this.options = { ...DEFAULT_COLLECTOR_OPTIONS, ...options };
  }

  get state(): CollectorState {
    return this.stateValue;
  }
  get failure(): CalibrationFailure | null {
    return this.failureValue;
  }
  get result(): AveragedMeasurement | null {
    return this.resultValue;
  }

  start(nowMs: number): void {
    this.samples = [];
    this.startMs = nowMs;
    this.stateValue = 'collecting';
    this.failureValue = null;
    this.resultValue = null;
    this.totalSeen = 0;
  }

  cancel(): void {
    this.stateValue = 'idle';
    this.samples = [];
  }

  /** Feeds a measurement of the primary player taken at `timeMs`. */
  push(timeMs: number, m: Pick<FaceMeasurement, 'eyeX' | 'eyeY' | 'pxPerM' | 'eyeDepthOffsetM'>): void {
    if (this.stateValue !== 'collecting') return;
    this.totalSeen++;
    this.samples.push({ t: timeMs, eyeX: m.eyeX, eyeY: m.eyeY, pxPerM: m.pxPerM, eyeDepthOffsetM: m.eyeDepthOffsetM });
    const { windowMs, minSamples } = this.options;
    // Keep only the most recent window.
    while (this.samples.length > 0 && timeMs - this.samples[0]!.t > windowMs) this.samples.shift();
    if (this.samples.length < minSamples) return;
    // The window must really span (most of) windowMs, not just hold enough samples.
    if (timeMs - this.samples[0]!.t < windowMs * 0.8) return;
    const stats = this.stats();
    if (stats.positionStd <= this.options.maxPositionStd && stats.scaleStd <= this.options.maxScaleStd) {
      this.resultValue = stats.mean;
      this.stateValue = 'done';
    }
  }

  /** Call regularly (e.g. per inference) so the collector can time out. */
  tick(nowMs: number): void {
    if (this.stateValue !== 'collecting') return;
    if (nowMs - this.startMs >= this.options.timeoutMs) {
      this.failureValue = this.totalSeen < 3 ? 'no_face' : 'unstable';
      this.stateValue = 'failed';
    }
  }

  private stats(): { mean: AveragedMeasurement; positionStd: number; scaleStd: number } {
    const n = this.samples.length;
    let ex = 0, ey = 0, s = 0, d = 0;
    for (const sample of this.samples) {
      ex += sample.eyeX;
      ey += sample.eyeY;
      s += sample.pxPerM;
      d += sample.eyeDepthOffsetM;
    }
    ex /= n; ey /= n; s /= n; d /= n;
    let vp = 0, vs = 0;
    for (const sample of this.samples) {
      vp += (sample.eyeX - ex) ** 2 + (sample.eyeY - ey) ** 2;
      vs += (sample.pxPerM - s) ** 2;
    }
    const ipdPx = s * 0.063;
    return {
      mean: { eyeX: ex, eyeY: ey, pxPerM: s, eyeDepthOffsetM: d, samples: n },
      positionStd: Math.sqrt(vp / n) / Math.max(ipdPx, 1e-6),
      scaleStd: Math.sqrt(vs / n) / Math.max(s, 1e-6),
    };
  }
}

export interface SolveInput {
  measurement: Pick<AveragedMeasurement, 'eyeX' | 'eyeY' | 'pxPerM' | 'eyeDepthOffsetM'>;
  frame: UprightFrame;
  /** Camera → screen rotation (see mountMatrix) and camera position. */
  matrix: Float64Array;
  cameraPos: Readonly<Vec3>;
  /** Known distance between the eyes and the screen plane during calibration, metres. */
  refDistanceM: number;
  window: PhysicalWindow;
}

export type SolveResult =
  | { ok: true; values: CalibrationValues; focalRef: number; hfovDeg: number }
  | { ok: false; reason: 'geometry' | 'implausible' };

/** Field of view implied by a focal length in reference pixels. */
export function hfovFromFocal(focalRef: number): number {
  return (2 * Math.atan(REFERENCE_FRAME_WIDTH / 2 / focalRef) * 180) / Math.PI;
}

/**
 * Solves the focal constant so that the measured eye lies `refDistanceM` in
 * front of the screen plane, then evaluates the neutral position with it.
 *
 * With ray r = (ex, ey, f)/f and depth Z = f/S + δ the screen-space depth is
 *   z = pz + (m6·ex + m7·ey)/f · Z + m8 · Z
 * which is a quadratic in f:  (m8/S)·f² + (c/S + m8·δ + pz − D)·f + δ·c = 0,
 * c = m6·ex + m7·ey.
 */
export function solveCalibration(input: SolveInput): SolveResult {
  const { measurement: m, frame, matrix, cameraPos, refDistanceM, window } = input;
  const ex = m.eyeX - frame.width / 2;
  const ey = m.eyeY - frame.height / 2;
  const S = m.pxPerM;
  const delta = m.eyeDepthOffsetM;
  const m6 = matrix[6]!, m7 = matrix[7]!, m8 = matrix[8]!;
  const c = m6 * ex + m7 * ey;
  const a = m8 / S;
  const b = c / S + m8 * delta + cameraPos[2] - refDistanceM;
  const cc = delta * c;
  let focal: number;
  if (Math.abs(a) < 1e-12) return { ok: false, reason: 'geometry' };
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return { ok: false, reason: 'geometry' };
  const root = Math.sqrt(disc);
  // The physical solution is the large positive root (the other one is ≈ 0).
  focal = (-b + root) / (2 * a);
  if (!(focal > 0)) focal = (-b - root) / (2 * a);
  if (!Number.isFinite(focal) || !(focal > 0)) return { ok: false, reason: 'geometry' };

  const hfov = hfovFromFocal(focal);
  // Guard against a wildly wrong reference distance or mounting geometry.
  if (hfov < 15 || hfov > 150) return { ok: false, reason: 'implausible' };

  const z = focal / S + delta;
  const pc: Vec3 = [(ex * z) / focal, (ey * z) / focal, z];
  const ps = cameraToScreen(pc, matrix, cameraPos);
  const neutral: Vec3 = [ps[0] - window.centerOffsetM[0], ps[1] - window.centerOffsetM[1], ps[2]];
  return {
    ok: true,
    values: { calDepthK: depthKFromFocal(focal), calNeutral: neutral, calibrated: true },
    focalRef: focal,
    hfovDeg: hfov,
  };
}
