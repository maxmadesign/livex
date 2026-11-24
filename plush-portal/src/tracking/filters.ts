/**
 * Measurement filters for the eye position. Pure, time is always passed in.
 */
import type { Vec3 } from '../core/types';

const TAU = Math.PI * 2;

/** Smoothing factor of a first-order low-pass with the given cutoff for a step of `dt` seconds. */
export function lowPassAlpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (TAU * Math.max(cutoffHz, 1e-4));
  return 1 / (1 + tau / Math.max(dt, 1e-6));
}

/**
 * One Euro filter (Casiez, Roussel, Vogel 2012). The smoothing factors are
 * derived from the real time step of every sample, so the response does not
 * depend on the inference rate.
 */
export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private initialized = false;
  private lastTime = 0;
  private lastRaw = 0;
  private value = 0;
  private derivative = 0;

  constructor(minCutoffHz = 1.4, beta = 6, dCutoffHz = 1.5) {
    this.minCutoff = minCutoffHz;
    this.beta = beta;
    this.dCutoff = dCutoffHz;
  }

  /** Filters `raw` sampled at `timeSec` (seconds, monotonic). */
  filter(raw: number, timeSec: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.lastTime = timeSec;
      this.lastRaw = raw;
      this.value = raw;
      this.derivative = 0;
      return raw;
    }
    const dt = timeSec - this.lastTime;
    if (!(dt > 1e-5)) {
      // Duplicate / out-of-order timestamp: ignore the time step, keep the state.
      return this.value;
    }
    const rawDerivative = (raw - this.lastRaw) / dt;
    this.derivative += lowPassAlpha(this.dCutoff, dt) * (rawDerivative - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += lowPassAlpha(cutoff, dt) * (raw - this.value);
    this.lastRaw = raw;
    this.lastTime = timeSec;
    return this.value;
  }

  /** Current filtered value (undefined behaviour before the first sample). */
  current(): number {
    return this.value;
  }

  /** Smoothed derivative in units per second. */
  velocity(): number {
    return this.derivative;
  }

  reset(): void {
    this.initialized = false;
    this.derivative = 0;
  }

  /** Re-seeds the filter at `value` without any history (used after an accepted jump). */
  snap(value: number, timeSec: number): void {
    this.initialized = true;
    this.lastTime = timeSec;
    this.lastRaw = value;
    this.value = value;
    this.derivative = 0;
  }
}

export type GateDecision = 'accept' | 'reject' | 'jump';

/**
 * Rejects single-sample jumps (tracking glitches, a second face for one frame)
 * but accepts a jump once several consecutive samples agree with each other –
 * a person really can step sideways.
 */
export class OutlierGate {
  /** Distance (metres) between two samples above which a sample is suspicious. */
  threshold = 0.35;
  /** A persistent jump is accepted after this many consistent samples … */
  persistSamples = 3;
  /** … spanning at least this many milliseconds. */
  persistMs = 180;
  /** Plausible head speed, so long gaps between samples do not look like jumps. */
  speedLimit = 2.5;

  private hasReference = false;
  private readonly reference: Vec3 = [0, 0, 0];
  /** Time of the previous sample, accepted or not: only a real gap in the data widens the gate. */
  private lastSampleTime = 0;
  private pendingCount = 0;
  private pendingStart = 0;
  private readonly pending: Vec3 = [0, 0, 0];

  reset(): void {
    this.hasReference = false;
    this.pendingCount = 0;
  }

  /** Position that a 'jump' decision settled on (mean of the consistent samples). */
  jumpTarget(): Readonly<Vec3> {
    return this.pending;
  }

  check(timeMs: number, p: Readonly<Vec3>): GateDecision {
    if (!this.hasReference) {
      this.setReference(timeMs, p);
      return 'accept';
    }
    const dtSec = Math.max(0, (timeMs - this.lastSampleTime) / 1000);
    this.lastSampleTime = timeMs;
    const allowed = Math.max(this.threshold, this.speedLimit * dtSec);
    const d = Math.hypot(p[0] - this.reference[0], p[1] - this.reference[1], p[2] - this.reference[2]);
    if (d <= allowed) {
      this.setReference(timeMs, p);
      this.pendingCount = 0;
      return 'accept';
    }
    // Suspicious sample: does it agree with the previous suspicious ones?
    if (this.pendingCount > 0) {
      const dp = Math.hypot(p[0] - this.pending[0], p[1] - this.pending[1], p[2] - this.pending[2]);
      if (dp <= this.threshold * 0.5) {
        const n = this.pendingCount;
        this.pending[0] = (this.pending[0] * n + p[0]) / (n + 1);
        this.pending[1] = (this.pending[1] * n + p[1]) / (n + 1);
        this.pending[2] = (this.pending[2] * n + p[2]) / (n + 1);
        this.pendingCount = n + 1;
        if (this.pendingCount >= this.persistSamples && timeMs - this.pendingStart >= this.persistMs) {
          this.setReference(timeMs, this.pending);
          this.pendingCount = 0;
          return 'jump';
        }
        return 'reject';
      }
    }
    this.pending[0] = p[0];
    this.pending[1] = p[1];
    this.pending[2] = p[2];
    this.pendingCount = 1;
    this.pendingStart = timeMs;
    return 'reject';
  }

  private setReference(timeMs: number, p: Readonly<Vec3>): void {
    this.hasReference = true;
    this.reference[0] = p[0];
    this.reference[1] = p[1];
    this.reference[2] = p[2];
    this.lastSampleTime = timeMs;
  }
}

/**
 * Spherical dead band with hysteresis: the output only moves once the input
 * leaves a ball of `radius` around it, and then follows the surface of that
 * ball. Removes micro jitter of a person standing still without adding lag to
 * real movement (the offset is at most `radius`).
 */
export class DeadZone {
  private initialized = false;
  private readonly value: Vec3 = [0, 0, 0];

  reset(): void {
    this.initialized = false;
  }

  snap(p: Readonly<Vec3>): void {
    this.initialized = true;
    this.value[0] = p[0];
    this.value[1] = p[1];
    this.value[2] = p[2];
  }

  apply(p: Readonly<Vec3>, radius: number, out: Vec3 = [0, 0, 0]): Vec3 {
    if (!this.initialized) this.snap(p);
    const dx = p[0] - this.value[0];
    const dy = p[1] - this.value[1];
    const dz = p[2] - this.value[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > radius && d > 0) {
      const k = (d - Math.max(0, radius)) / d;
      this.value[0] += dx * k;
      this.value[1] += dy * k;
      this.value[2] += dz * k;
    }
    out[0] = this.value[0];
    out[1] = this.value[1];
    out[2] = this.value[2];
    return out;
  }
}

export interface MeasurementFilterConfig {
  /** One Euro minimum cutoff, Hz. */
  minCutoff: number;
  /** One Euro speed coefficient (positions in metres). */
  beta: number;
  /** Dead zone radius, metres. */
  deadzoneM: number;
  /** Outlier threshold, metres. */
  outlierM: number;
}

export type FilterResult = 'ok' | 'rejected' | 'jump';

/** Depth is estimated from the face scale and is noisier than x / y, so it is filtered harder. */
const DEPTH_CUTOFF_SCALE = 0.6;
const DEPTH_BETA_SCALE = 0.5;

/** Outlier gate → One Euro (per axis) → dead zone. */
export class MeasurementFilter {
  private readonly gate = new OutlierGate();
  private readonly fx = new OneEuroFilter();
  private readonly fy = new OneEuroFilter();
  private readonly fz = new OneEuroFilter();
  private readonly dead = new DeadZone();
  private deadzoneM = 0.002;
  private readonly scratch: Vec3 = [0, 0, 0];

  constructor(config?: MeasurementFilterConfig) {
    if (config) this.configure(config);
  }

  configure(config: MeasurementFilterConfig): void {
    this.fx.minCutoff = config.minCutoff;
    this.fy.minCutoff = config.minCutoff;
    this.fz.minCutoff = config.minCutoff * DEPTH_CUTOFF_SCALE;
    this.fx.beta = config.beta;
    this.fy.beta = config.beta;
    this.fz.beta = config.beta * DEPTH_BETA_SCALE;
    this.deadzoneM = Math.max(0, config.deadzoneM);
    this.gate.threshold = Math.max(0.01, config.outlierM);
  }

  reset(): void {
    this.gate.reset();
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.dead.reset();
  }

  /**
   * Feeds one measurement taken at `timeMs`. Writes the filtered position to
   * `out` for 'ok' and 'jump'; leaves `out` untouched for 'rejected'.
   */
  push(timeMs: number, p: Readonly<Vec3>, out: Vec3): FilterResult {
    const decision = this.gate.check(timeMs, p);
    if (decision === 'reject') return 'rejected';
    const t = timeMs / 1000;
    if (decision === 'jump') {
      const target = this.gate.jumpTarget();
      this.fx.snap(target[0], t);
      this.fy.snap(target[1], t);
      this.fz.snap(target[2], t);
      this.dead.snap(target);
      out[0] = target[0];
      out[1] = target[1];
      out[2] = target[2];
      return 'jump';
    }
    this.scratch[0] = this.fx.filter(p[0], t);
    this.scratch[1] = this.fy.filter(p[1], t);
    this.scratch[2] = this.fz.filter(p[2], t);
    this.dead.apply(this.scratch, this.deadzoneM, out);
    return 'ok';
  }
}
