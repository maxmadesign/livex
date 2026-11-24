/**
 * Idle detection and the flow of the attract / demo mode. Headless (no DOM, no
 * rendering): the browser shell feeds it input events and frame times, asks it
 * when the machine should reset itself and lets it move the round machine
 * between attract mode, demo rounds and player rounds.
 */
import type { GameCore } from './GameCore';

/** Timing of the attract mode in seconds (presentation only; outcomes come from physics). */
export const ATTRACT_TIMING = Object.freeze({
  /** After boot: time before the first demo round (the field and the call to action are shown first). */
  firstDemoDelay: 4,
  /** Between two demo rounds (restocking happens meanwhile). */
  demoDelay: 1.6,
  /** How long a demo round's result stays before the next round. */
  demoResultHold: 2.4,
  /** Interval of the sparkle burst around the call to action. */
  ctaSparkle: 2.4,
  /** How long the win / jackpot light show runs before returning to the base mode. */
  winShow: 4.5,
});

/**
 * Seconds since the last player input, measured on a wall clock (it keeps
 * counting while a dialog is open or the game is paused, which is exactly when
 * a walked-away player leaves the machine in a half-finished state).
 */
export class IdleTimer {
  private last: number;

  constructor(private readonly clock: () => number = () => Date.now()) {
    this.last = clock();
  }

  /** Any player input: pointer, touch, key, a button press. */
  touch(): void {
    this.last = this.clock();
  }

  /** Seconds without input. */
  idleSeconds(): number {
    return Math.max(0, (this.clock() - this.last) / 1000);
  }

  /**
   * True once when `limitSeconds` passed without input; the timer then starts over.
   * `active`: something counts as activity right now (a player round that is still
   * running) and keeps the timer at zero. A limit of 0 (or less) means never.
   */
  due(limitSeconds: number, active = false): boolean {
    if (active) {
      this.touch();
      return false;
    }
    if (!(limitSeconds > 0)) return false;
    if (this.idleSeconds() < limitSeconds) return false;
    this.touch();
    return true;
  }
}

export interface AttractUpdate {
  /** system.attractDemo */
  demoEnabled: boolean;
  /** True until the first player round: the first demo waits a little longer. */
  firstDemo: boolean;
  /** Toys are still being dropped in: the next demo round waits for them. */
  restockPending: boolean;
}

/**
 * Moves the round machine in and out of attract mode. Attract mode is the
 * ATTRACT phase plus the demo rounds played from it; a player round is anything else.
 */
export class AttractDirector {
  /** Seconds spent in the ATTRACT phase (since it was last entered). */
  attractTime = 0;
  /** Seconds a demo round's result has been on screen. */
  resultTime = 0;

  constructor(private readonly core: GameCore) {}

  /** True in the ATTRACT phase and during demo rounds. */
  get active(): boolean {
    const m = this.core.machine;
    return m.phase === 'ATTRACT' || m.demo;
  }

  /**
   * Enters attract mode from a player round (idle reset). An unfinished round is abandoned:
   * nothing is awarded and the claw goes home. Returns false when already in attract mode.
   */
  enter(reason = 'idle_reset'): boolean {
    const m = this.core.machine;
    if (this.active) return false;
    if (m.phase === 'READY' || m.phase === 'AIMING' || m.phase === 'RESULT') {
      this.core.controller.clearInput();
      m.toAttract();
    } else this.core.controller.resetRound(reason, 'ATTRACT');
    this.attractTime = 0;
    return true;
  }

  /**
   * A player takes over (call to action, START, Space / Enter): a running demo round is
   * stopped on the spot, the claw is put back home, the field is made whole again at once
   * and a player round starts, ready to aim. Returns false when not in attract mode.
   */
  leave(): boolean {
    if (!this.active) return false;
    this.core.controller.resetRound('player_took_over', 'READY');
    this.resetField();
    return true;
  }

  /**
   * Instant field reset: toys that ended up in the exit are removed, missing toys are dropped
   * in and the pile is settled off-screen (the same settling as at load). Returns the number of
   * toys added.
   */
  resetField(): number {
    const { field, controller } = this.core;
    let added = 0;
    for (let pass = 0; pass < 2; pass++) {
      if (field.clearFallen().length > 0) controller.forgetStrays();
      let guard = 0;
      while (field.missing() > 0 && guard++ < 64) {
        if (!field.restockOne()) break;
        added++;
      }
      this.core.settle(1.5);
    }
    if (field.clearFallen().length > 0) controller.forgetStrays();
    return added;
  }

  /**
   * Per-frame scheduling of demo rounds. Returns 'demoStarted' when a demo round was just
   * started (the pilot should begin from scratch) and 'demoEnded' when one went back to attract.
   */
  update(dt: number, options: AttractUpdate): 'demoStarted' | 'demoEnded' | null {
    const m = this.core.machine;
    if (m.phase === 'ATTRACT') {
      this.attractTime += dt;
      this.resultTime = 0;
      const delay = options.firstDemo ? ATTRACT_TIMING.firstDemoDelay : ATTRACT_TIMING.demoDelay;
      if (options.demoEnabled && this.attractTime > delay && (!options.restockPending || this.attractTime > delay + 6)) {
        if (m.start(true)) return 'demoStarted';
      }
      return null;
    }
    if (m.demo && m.phase === 'RESULT') {
      this.resultTime += dt;
      if (this.resultTime > ATTRACT_TIMING.demoResultHold) {
        this.resultTime = 0;
        this.attractTime = 0;
        if (m.toAttract()) return 'demoEnded';
      }
      return null;
    }
    this.resultTime = 0;
    return null;
  }
}
