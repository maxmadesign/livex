/**
 * Turns the stream of tracked viewpoint samples (15–20 Hz, irregular) into a
 * continuous viewpoint for every render frame, and handles loss and recovery:
 *
 *   tracking  → extrapolate a little from the newest sample, smooth with smoothMs
 *   hold      → the player vanished: keep the last output for lostHoldMs
 *   returning → still gone: ease back to the neutral viewpoint over returnMs
 *   reacquire → a sample arrived while not tracking (or the measurement
 *               jumped): cross-fade from the current output to the live value
 *   test      → manual test viewpoint (never reported as tracking)
 *   drag      → drag-to-peek: an offset added to the neutral / hold / returning viewpoint while
 *               no live sample drives the view (src/app/PeekDrag.ts); a live sample wins
 *
 * The output is continuous across every transition. Pure: all times are
 * passed in (milliseconds, same clock for samples and render frames).
 */
import type { ViewSource } from '../core/contracts';
import type { Vec3 } from '../core/types';

export interface ViewpointConfig {
  /** Viewpoint used when nothing is tracked (window space, metres). */
  neutral: Readonly<Vec3>;
  lostHoldMs: number;
  returnMs: number;
  reacquireMs: number;
  /** Time constant of the per-frame follow smoothing, ms (0 = none). */
  smoothMs: number;
}

type Mode = 'neutral' | 'tracking' | 'hold' | 'returning' | 'reacquire';

/** Fraction of the measured velocity used to extrapolate between samples. */
const EXTRAPOLATION_GAIN = 0.7;
/** Never extrapolate further than this past the newest sample, ms. */
const MAX_EXTRAPOLATION_MS = 120;
/** No sample for this long while "tracking" counts as a loss (stalled inference), ms. */
const WATCHDOG_MS = 400;
/** Distance (m) at which a re-acquire blend uses the full reacquireMs. */
const FULL_BLEND_DISTANCE = 0.1;
/** Time constant used to approach the neutral / test viewpoint when it is edited, s. */
const SETTLE_TAU = 0.12;
/** Largest render step that is integrated in one go, s. */
const MAX_STEP = 0.1;

const smooth = (t: number) => {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

function copy(dst: Vec3, src: Readonly<Vec3>): void {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

export class ViewpointController {
  private readonly neutral: Vec3 = [0, 0, 0.6];
  private lostHoldMs = 700;
  private returnMs = 1500;
  private reacquireMs = 450;
  private smoothMs = 70;

  private mode: Mode = 'neutral';
  private readonly out: Vec3 = [0, 0, 0.6];
  private hasOutput = false;
  private lastNow = 0;

  // Newest two samples and the velocity between them.
  private readonly p1: Vec3 = [0, 0, 0];
  private t1 = 0;
  private sampleIntervalMs = 60;
  private readonly velocity: Vec3 = [0, 0, 0];
  private readonly follower: Vec3 = [0, 0, 0];
  /** Target of the previous render frame (the follower integrates a linearly moving target exactly). */
  private readonly prevTarget: Vec3 = [0, 0, 0];

  private readonly holdFrom: Vec3 = [0, 0, 0];
  private lossStartMs = 0;
  private returnStartMs = 0;

  private readonly blendFrom: Vec3 = [0, 0, 0];
  private blendStartMs = 0;
  private blendDurationMs = 1;

  private test: Vec3 | null = null;

  /** Drag-to-peek offset (window space, metres) and whether one is set. */
  private readonly drag: Vec3 = [0, 0, 0];
  private dragOn = false;

  constructor(config?: ViewpointConfig) {
    if (config) this.configure(config);
  }

  configure(config: ViewpointConfig): void {
    copy(this.neutral, config.neutral);
    this.lostHoldMs = Math.max(0, config.lostHoldMs);
    this.returnMs = Math.max(1, config.returnMs);
    this.reacquireMs = Math.max(1, config.reacquireMs);
    this.smoothMs = Math.max(0, config.smoothMs);
    if (!this.hasOutput) copy(this.out, this.neutral);
  }

  /** Current mode, for status reporting. */
  get source(): ViewSource {
    if (this.test) return 'test';
    return this.mode;
  }

  /** True while a live sample drives (or is being blended into) the output. */
  get isLive(): boolean {
    return this.mode === 'tracking' || this.mode === 'reacquire';
  }

  /**
   * A tracked viewpoint captured at `timeMs`. `jump` marks a discontinuity in
   * the measurement (accepted outlier, recalibration) so it is blended in.
   */
  pushSample(timeMs: number, eye: Readonly<Vec3>, jump = false): void {
    if (this.mode === 'tracking' || this.mode === 'reacquire') {
      if (!jump) {
        const dt = timeMs - this.t1;
        if (dt > 4 && dt < 400) {
          const inv = 1000 / dt;
          // Blend the new finite difference into the velocity; the samples are already filtered.
          for (let i = 0; i < 3; i++) {
            const v = (eye[i]! - this.p1[i]!) * inv;
            this.velocity[i] = this.velocity[i]! + (v - this.velocity[i]!) * 0.65;
          }
          this.sampleIntervalMs += (dt - this.sampleIntervalMs) * 0.3;
        } else if (dt >= 400) {
          this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
        } else {
          return; // duplicate / out-of-order sample
        }
        copy(this.p1, eye);
        this.t1 = timeMs;
        return;
      }
    }
    // Not tracking (or a jump): cross-fade from wherever the output is now.
    this.beginBlend(Math.max(this.lastNow, timeMs), eye);
    copy(this.p1, eye);
    this.t1 = timeMs;
    this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
    copy(this.follower, eye);
    copy(this.prevTarget, eye);
    this.mode = 'reacquire';
  }

  /** An inference finished at `timeMs` without the primary player. */
  pushMiss(timeMs: number): void {
    if (this.mode === 'tracking' || this.mode === 'reacquire') this.beginHold(Math.max(this.lastNow, timeMs));
  }

  /** Tracking was switched off: ease back to neutral right away (no hold). */
  release(nowMs: number): void {
    if (this.mode === 'neutral') return;
    copy(this.holdFrom, this.out);
    this.returnStartMs = Math.max(this.lastNow, nowMs);
    this.mode = 'returning';
  }

  /**
   * Manual test viewpoint (absolute, window space); null returns to normal
   * operation. The output glides to and from it.
   */
  setTest(viewpoint: Readonly<Vec3> | null): void {
    if (viewpoint) {
      if (!this.test) this.test = [0, 0, 0];
      copy(this.test, viewpoint);
      return;
    }
    if (!this.test) return;
    this.test = null;
    if (this.mode === 'tracking' || this.mode === 'reacquire') {
      this.beginBlend(this.lastNow, this.follower);
      this.mode = 'reacquire';
    } else {
      copy(this.holdFrom, this.out);
      this.returnStartMs = this.lastNow;
      this.mode = 'returning';
    }
  }

  /**
   * Drag-to-peek offset from the current viewpoint (window space, metres), or null for none. It is
   * added only while nothing live drives the view (neutral, hold, returning) and then reported as
   * the 'drag' source; live tracking and the test viewpoint ignore it.
   */
  setDrag(offset: Readonly<Vec3> | null): void {
    if (!offset) {
      this.dragOn = false;
      this.drag[0] = this.drag[1] = this.drag[2] = 0;
      return;
    }
    this.dragOn = true;
    copy(this.drag, offset);
  }

  /** Writes the viewpoint for the render frame at `nowMs` to `out`. */
  sample(nowMs: number, out: Vec3): ViewSource {
    if (!this.hasOutput) {
      this.hasOutput = true;
      copy(this.out, this.neutral);
      this.lastNow = nowMs;
    }
    const dt = Math.min(MAX_STEP, Math.max(0, (nowMs - this.lastNow) / 1000));
    this.lastNow = Math.max(this.lastNow, nowMs);
    const now = this.lastNow;

    // Keep the internal tracking state moving even while the test viewpoint is shown.
    if ((this.mode === 'tracking' || this.mode === 'reacquire') && now - this.t1 > Math.max(WATCHDOG_MS, this.sampleIntervalMs * 4)) {
      this.beginHold(now);
    }

    if (this.test) {
      this.approach(this.out, this.test, SETTLE_TAU, dt);
      copy(out, this.out);
      return 'test';
    }

    if (this.mode === 'hold' && now - this.lossStartMs >= this.lostHoldMs) {
      // Held long enough: start easing back to neutral from where the hold ended.
      this.returnStartMs = this.lossStartMs + this.lostHoldMs;
      this.mode = 'returning';
    }

    let source: ViewSource = 'neutral';
    switch (this.mode) {
      case 'neutral':
        this.approach(this.out, this.neutral, SETTLE_TAU, dt);
        source = 'neutral';
        break;
      case 'tracking':
      case 'reacquire': {
        const horizon = Math.min(Math.max(0, now - this.t1), MAX_EXTRAPOLATION_MS, this.sampleIntervalMs * 1.5);
        const k = (horizon / 1000) * EXTRAPOLATION_GAIN;
        const tx = this.p1[0] + this.velocity[0]! * k;
        const ty = this.p1[1] + this.velocity[1]! * k;
        const tz = this.p1[2] + this.velocity[2]! * k;
        if (this.smoothMs > 0.5 && dt > 0) {
          // First-order follower, integrated exactly for a target that moved linearly during the
          // frame. Unlike the usual `y += (t - y) * alpha` this has the same lag at any frame rate.
          const tau = this.smoothMs / 1000;
          const decay = Math.exp(-dt / tau);
          const vx = ((tx - this.prevTarget[0]) / dt) * tau;
          const vy = ((ty - this.prevTarget[1]) / dt) * tau;
          const vz = ((tz - this.prevTarget[2]) / dt) * tau;
          this.follower[0] = tx - vx + (this.follower[0] - this.prevTarget[0] + vx) * decay;
          this.follower[1] = ty - vy + (this.follower[1] - this.prevTarget[1] + vy) * decay;
          this.follower[2] = tz - vz + (this.follower[2] - this.prevTarget[2] + vz) * decay;
        } else if (this.smoothMs <= 0.5) {
          this.follower[0] = tx;
          this.follower[1] = ty;
          this.follower[2] = tz;
        }
        this.prevTarget[0] = tx;
        this.prevTarget[1] = ty;
        this.prevTarget[2] = tz;
        if (this.mode === 'reacquire') {
          const w = smooth((now - this.blendStartMs) / this.blendDurationMs);
          this.out[0] = this.blendFrom[0] + (this.follower[0] - this.blendFrom[0]) * w;
          this.out[1] = this.blendFrom[1] + (this.follower[1] - this.blendFrom[1]) * w;
          this.out[2] = this.blendFrom[2] + (this.follower[2] - this.blendFrom[2]) * w;
          source = 'reacquire';
          if (w >= 1) this.mode = 'tracking';
        } else {
          copy(this.out, this.follower);
          source = 'tracking';
        }
        break;
      }
      case 'hold':
        copy(this.out, this.holdFrom);
        source = 'hold';
        break;
      case 'returning': {
        const w = smooth((now - this.returnStartMs) / this.returnMs);
        this.out[0] = this.holdFrom[0] + (this.neutral[0] - this.holdFrom[0]) * w;
        this.out[1] = this.holdFrom[1] + (this.neutral[1] - this.holdFrom[1]) * w;
        this.out[2] = this.holdFrom[2] + (this.neutral[2] - this.holdFrom[2]) * w;
        source = 'returning';
        if (w >= 1) this.mode = 'neutral';
        break;
      }
    }
    copy(out, this.out);
    if (this.dragOn && source !== 'tracking' && source !== 'reacquire') {
      out[0] += this.drag[0];
      out[1] += this.drag[1];
      out[2] += this.drag[2];
      return 'drag';
    }
    return source;
  }

  /** Forgets everything and jumps to neutral (only for tests / hard resets). */
  reset(): void {
    this.mode = 'neutral';
    this.test = null;
    this.setDrag(null);
    this.hasOutput = false;
    this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
    copy(this.out, this.neutral);
  }

  private beginHold(nowMs: number): void {
    copy(this.holdFrom, this.out);
    this.lossStartMs = nowMs;
    this.mode = 'hold';
  }

  private beginBlend(nowMs: number, target: Readonly<Vec3>): void {
    copy(this.blendFrom, this.out);
    // A face found while the view is dragged: blend from where the dragged view is, not from under it.
    if (this.dragOn && !this.isLive && !this.test) {
      this.blendFrom[0] += this.drag[0];
      this.blendFrom[1] += this.drag[1];
      this.blendFrom[2] += this.drag[2];
    }
    this.blendStartMs = nowMs;
    const d = Math.hypot(target[0] - this.out[0], target[1] - this.out[1], target[2] - this.out[2]);
    const scale = Math.min(1, Math.max(0.15, d / FULL_BLEND_DISTANCE));
    this.blendDurationMs = Math.max(1, this.reacquireMs * scale);
  }

  private approach(value: Vec3, target: Readonly<Vec3>, tau: number, dt: number): void {
    const a = 1 - Math.exp(-dt / tau);
    value[0] += (target[0] - value[0]) * a;
    value[1] += (target[1] - value[1]) * a;
    value[2] += (target[2] - value[2]) * a;
  }
}
