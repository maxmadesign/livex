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
import { createMeasurement, depthKFromFocal, measureFace, type FaceMeasurement } from './eyeEstimator';
import type { UprightFrame } from './frameGeometry';
import { FLOATS_PER_FACE, REFERENCE_FRAME_WIDTH } from './landmarks';
import type { PhysicalWindow } from './viewMapping';

export interface CalibrationValues {
  /** focal length (reference px) × 63 mm; 0 = not calibrated (derive from hfov). */
  calDepthK: number;
  /** Measured eye position in window space that corresponds to the neutral pose, metres. */
  calNeutral: Vec3;
  calibrated: true;
  /**
   * Head-direction baseline in degrees (yaw + = turned to the player's right, pitch + = up),
   * relative to facing the centre of the game window. Only the countdown calibration measures it;
   * persist it as `camera.headBaseline.<profile>` (see baseline.ts).
   */
  headYaw?: number;
  headPitch?: number;
}

export interface AveragedMeasurement {
  eyeX: number;
  eyeY: number;
  pxPerM: number;
  samples: number;
  /** Mean of the packed landmarks over the stable window (one face, FLOATS_PER_FACE floats). */
  face: Float32Array;
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
  face: Float32Array;
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

  /**
   * Feeds a measurement of the primary player taken at `timeMs`, together with
   * its packed landmarks (`packed` from `offset`). The landmarks only live in
   * this short window and are discarded when the calibration finishes.
   */
  push(
    timeMs: number,
    m: Pick<FaceMeasurement, 'eyeX' | 'eyeY' | 'pxPerM'>,
    packed: ArrayLike<number>,
    offset = 0,
  ): void {
    if (this.stateValue !== 'collecting') return;
    this.totalSeen++;
    const face = new Float32Array(FLOATS_PER_FACE);
    for (let i = 0; i < FLOATS_PER_FACE; i++) face[i] = packed[offset + i]!;
    this.samples.push({ t: timeMs, eyeX: m.eyeX, eyeY: m.eyeY, pxPerM: m.pxPerM, face });
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
      this.samples = [];
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
    let ex = 0, ey = 0, s = 0;
    for (const sample of this.samples) {
      ex += sample.eyeX;
      ey += sample.eyeY;
      s += sample.pxPerM;
    }
    ex /= n; ey /= n; s /= n;
    let vp = 0, vs = 0;
    for (const sample of this.samples) {
      vp += (sample.eyeX - ex) ** 2 + (sample.eyeY - ey) ** 2;
      vs += (sample.pxPerM - s) ** 2;
    }
    const face = new Float32Array(FLOATS_PER_FACE);
    for (const sample of this.samples) for (let i = 0; i < FLOATS_PER_FACE; i++) face[i]! += sample.face[i]! / n;
    const ipdPx = s * 0.063;
    return {
      mean: { eyeX: ex, eyeY: ey, pxPerM: s, samples: n, face },
      positionStd: Math.sqrt(vp / n) / Math.max(ipdPx, 1e-6),
      scaleStd: Math.sqrt(vs / n) / Math.max(s, 1e-6),
    };
  }
}

export interface SolveInput {
  /** Mean packed landmarks of the player while standing still (see AveragedMeasurement.face). */
  face: ArrayLike<number>;
  frame: UprightFrame;
  /** Camera → screen rotation (see mountMatrix) and camera position. */
  matrix: Float64Array;
  cameraPos: Readonly<Vec3>;
  /** Known distance between the eyes and the screen plane during calibration, metres. */
  refDistanceM: number;
  window: PhysicalWindow;
  /** Starting value for the focal length (reference pixels), e.g. the current effective focal length. */
  focalGuess: number;
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
 * The estimated depth is (almost exactly) proportional to the focal length,
 * so a secant iteration on  g(f) = z_screen(f) − refDistance  converges in a
 * handful of steps; the weak dependence of the face fit on f is included
 * because the fit is re-evaluated for every candidate.
 */
export function solveCalibration(input: SolveInput): SolveResult {
  const { face, frame, matrix, cameraPos, refDistanceM, window } = input;
  const scratch = createMeasurement();
  const ps: Vec3 = [0, 0, 0];
  const evaluate = (focal: number): boolean => {
    const m = measureFace(face, 0, frame, focal, scratch);
    if (!m) return false;
    cameraToScreen([m.camX, m.camY, m.camZ], matrix, cameraPos, ps);
    return Number.isFinite(ps[2]);
  };
  const MIN_FOCAL = 40;
  const MAX_FOCAL = 20000;
  const clampFocal = (f: number) => Math.min(MAX_FOCAL, Math.max(MIN_FOCAL, f));

  let f0 = clampFocal(input.focalGuess > 0 ? input.focalGuess : REFERENCE_FRAME_WIDTH * 0.8);
  if (!evaluate(f0)) return { ok: false, reason: 'geometry' };
  let g0 = ps[2] - refDistanceM;
  // Second point: scale the focal length by the depth ratio (exact for an untilted camera).
  const along0 = ps[2] - cameraPos[2];
  if (!(along0 > 1e-6) || !(refDistanceM - cameraPos[2] > 1e-6)) return { ok: false, reason: 'geometry' };
  let f1 = clampFocal((f0 * (refDistanceM - cameraPos[2])) / along0);
  if (!evaluate(f1)) return { ok: false, reason: 'geometry' };
  let g1 = ps[2] - refDistanceM;
  for (let i = 0; i < 20 && Math.abs(g1) > 1e-7; i++) {
    const denom = g1 - g0;
    if (Math.abs(denom) < 1e-15) break;
    const f2 = clampFocal(f1 - (g1 * (f1 - f0)) / denom);
    f0 = f1;
    g0 = g1;
    f1 = f2;
    if (!evaluate(f1)) return { ok: false, reason: 'geometry' };
    g1 = ps[2] - refDistanceM;
  }
  if (Math.abs(g1) > 1e-3) return { ok: false, reason: 'geometry' };
  const focal = f1;

  const hfov = hfovFromFocal(focal);
  // Guard against a wildly wrong reference distance or mounting geometry.
  if (hfov < 15 || hfov > 150) return { ok: false, reason: 'implausible' };

  const neutral: Vec3 = [ps[0] - window.centerOffsetM[0], ps[1] - window.centerOffsetM[1], ps[2]];
  return {
    ok: true,
    values: { calDepthK: depthKFromFocal(focal), calNeutral: neutral, calibrated: true },
    focalRef: focal,
    hfovDeg: hfov,
  };
}
