/**
 * When to start the countdown calibration by itself (`camera.autoCalibrate`). Pure: the caller
 * feeds the current situation in and executes the returned action on the tracker.
 *
 * Rules
 *  - Every time head tracking is (re)enabled – the tracker goes from a stopped / failed state to
 *    starting or running – the policy is armed once.
 *  - It fires when the tracker has followed a face steadily for `stableMs`, no calibration is
 *    running or shown, no dialog is open and the round is not in progress (READY / ATTRACT, or a
 *    demo round). It never starts while the player aims or the claw is busy.
 *  - An automatic countdown that the round interrupts (the player starts aiming, a dialog opens)
 *    is cancelled and the policy re-arms, so it tries again at the next READY / ATTRACT.
 *  - A finished calibration (automatic or manual) disarms it until the next enable. A failed
 *    automatic one is not retried automatically: the overlay offers Retry / Skip. A failure left
 *    on screen is dismissed when a round starts (automatic ones) or after `failedHoldMs`.
 *  - After the camera picture rotated (phone turned) the policy re-arms, so the countdown runs
 *    again for the new orientation.
 */
import type { CalibrationStatus, TrackerState } from '../core/contracts';
import { ROTATED } from './countdown';

export interface AutoCalibrationInput {
  nowMs: number;
  /** camera.enabled (and the camera allowed in this session). */
  enabled: boolean;
  /** camera.autoCalibrate */
  autoCalibrate: boolean;
  trackerState: TrackerState;
  calibration: CalibrationStatus;
  /** Round phase is READY or ATTRACT, or a demo round is playing. */
  roundIdle: boolean;
  /** A dialog is open (the game is paused, the overlay would be hidden). */
  modalOpen: boolean;
  /** The page is visible. */
  visible: boolean;
}

/** start: call startCalibration(seconds); cancel / dismiss: call cancelCalibration(). */
export type AutoCalibrationAction = 'start' | 'cancel' | 'dismiss' | null;

const ACTIVE_STATES: ReadonlySet<TrackerState> = new Set<TrackerState>(['requesting', 'loading', 'searching', 'tracking', 'lost']);

export interface AutoCalibrationOptions {
  /** The face must be tracked this long before the countdown starts, ms. */
  stableMs: number;
  /** A failure still on screen is dismissed after this long, ms. */
  failedHoldMs: number;
}

export const DEFAULT_AUTO_OPTIONS: AutoCalibrationOptions = { stableMs: 700, failedHoldMs: 30000 };

export class AutoCalibrationPolicy {
  readonly options: AutoCalibrationOptions;
  private armedValue = false;
  /** An automatic countdown / capture is running. */
  private autoRunning = false;
  /** The automatic run was seen counting / capturing (so going idle means it was interrupted). */
  private sawActive = false;
  /** The failure on screen came from an automatic run. */
  private autoFailure = false;
  private wasActive = false;
  private trackingSince = -1;
  private failedSince = -1;
  private rotationSeen = false;

  constructor(options: Partial<AutoCalibrationOptions> = {}) {
    this.options = { ...DEFAULT_AUTO_OPTIONS, ...options };
  }

  /** True while an automatic countdown is waiting for its moment. */
  get armed(): boolean {
    return this.armedValue;
  }

  /** True while the running countdown was started by this policy. */
  get running(): boolean {
    return this.autoRunning;
  }

  /** The player pressed Skip (or Cancel): no automatic countdown until the next enable / rotation. */
  skip(): void {
    this.armedValue = false;
    this.autoRunning = false;
    this.autoFailure = false;
  }

  update(input: AutoCalibrationInput): AutoCalibrationAction {
    const now = input.nowMs;
    const active = input.enabled && ACTIVE_STATES.has(input.trackerState);
    if (active && !this.wasActive) {
      // Head tracking was (re)enabled: one automatic calibration for this run.
      this.armedValue = input.autoCalibrate;
      this.autoRunning = false;
      this.autoFailure = false;
    } else if (!active && this.wasActive) {
      this.armedValue = false;
      this.autoRunning = false;
    }
    this.wasActive = active;
    if (!input.autoCalibrate) this.armedValue = false;

    this.trackingSince = input.trackerState === 'tracking' ? (this.trackingSince < 0 ? now : this.trackingSince) : -1;

    const cal = input.calibration;
    // The picture rotated: calibrate again for the new orientation.
    const rotated = cal.phase === 'idle' && cal.detail === ROTATED;
    if (rotated && !this.rotationSeen && active && input.autoCalibrate) this.armedValue = true;
    this.rotationSeen = rotated;

    const roundAllows = input.roundIdle && !input.modalOpen && input.visible;
    switch (cal.phase) {
      case 'countdown':
      case 'capturing':
        this.failedSince = -1;
        if (this.autoRunning) this.sawActive = true;
        if (this.autoRunning && !roundAllows) {
          // The round started (or a dialog opened): try again at the next READY / ATTRACT.
          this.autoRunning = false;
          this.armedValue = active && input.autoCalibrate;
          return 'cancel';
        }
        return null;
      case 'done':
        // A calibration happened (automatic or manual): nothing left to do for this run.
        this.armedValue = false;
        this.autoRunning = false;
        this.autoFailure = false;
        this.failedSince = -1;
        return null;
      case 'failed':
        if (this.autoRunning) {
          this.autoRunning = false;
          this.autoFailure = true;
          this.armedValue = false;
        }
        // The hold time counts only while the failure card can be seen (no dialog over it).
        if (this.failedSince < 0 || input.modalOpen || !input.visible) this.failedSince = now;
        if ((this.autoFailure && !input.roundIdle && !input.modalOpen) || (!input.modalOpen && now - this.failedSince >= this.options.failedHoldMs)) {
          this.autoFailure = false;
          this.failedSince = -1;
          return 'dismiss';
        }
        return null;
      case 'idle':
      default:
        this.failedSince = -1;
        this.autoFailure = false;
        if (this.autoRunning) {
          // Interrupted (page hidden, camera restarted, picture rotated): try again later. A start
          // the tracker never acted on is not retried (no start loop against a tracker that cannot).
          this.autoRunning = false;
          this.armedValue = this.sawActive && active && input.autoCalibrate;
        }
        break;
    }

    if (
      this.armedValue &&
      active &&
      roundAllows &&
      input.trackerState === 'tracking' &&
      this.trackingSince >= 0 &&
      now - this.trackingSince >= this.options.stableMs
    ) {
      this.armedValue = false;
      this.autoRunning = true;
      this.sawActive = false;
      return 'start';
    }
    return null;
  }
}
