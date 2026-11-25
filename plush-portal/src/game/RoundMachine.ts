import { Emitter } from '../core/events';
import type { MachineItem, RoundPhase, RoundResult } from '../core/types';
import type { ItemSpec } from '../physics/items';

/**
 * Pure round state machine. It knows nothing about physics or rendering: the
 * RoundController reports physical milestones and the machine decides which
 * transitions are legal, enforces "one grab per round" and makes prize
 * settlement idempotent.
 *
 *   ATTRACT → READY → AIMING → DESCENDING → CLOSING → LIFTING → TRANSPORTING
 *           → RELEASING → SETTLING → RESULT → READY
 */

const TRANSITIONS: Record<RoundPhase, readonly RoundPhase[]> = {
  ATTRACT: ['READY'],
  READY: ['AIMING', 'DESCENDING', 'ATTRACT'],
  AIMING: ['DESCENDING', 'READY', 'ATTRACT'],
  DESCENDING: ['CLOSING'],
  CLOSING: ['LIFTING'],
  LIFTING: ['TRANSPORTING'],
  TRANSPORTING: ['RELEASING'],
  RELEASING: ['SETTLING'],
  SETTLING: ['RESULT'],
  RESULT: ['READY', 'ATTRACT'],
};

/** Phases in which the claw runs its automatic sequence and player input is locked. */
export const BUSY_PHASES: ReadonlySet<RoundPhase> = new Set([
  'DESCENDING',
  'CLOSING',
  'LIFTING',
  'TRANSPORTING',
  'RELEASING',
  'SETTLING',
]);

/** Phases in which the awarded toy may legitimately reach the prize sensor (classic; machines may configure others). */
export const AWARD_PHASES: ReadonlySet<RoundPhase> = new Set(['LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);
/** Phases in which a machine item may be scored (items that fall during RESULT count for the next try). */
const ITEM_PHASES: ReadonlySet<RoundPhase> = new Set(['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);

/** Upper bound for each automatic phase in seconds; exceeding it triggers recovery. */
export const PHASE_WATCHDOG: Partial<Record<RoundPhase, number>> = {
  DESCENDING: 7,
  CLOSING: 4,
  LIFTING: 7,
  TRANSPORTING: 10,
  RELEASING: 4,
  SETTLING: 7,
};

export interface PhaseChange {
  phase: RoundPhase;
  prev: RoundPhase;
  roundId: number;
  demo: boolean;
}

export interface PrizeAward {
  roundId: number;
  prizeId: string;
  toyId: string;
  typeId: string;
  demo: boolean;
  /** A session prize (shelf / rush): earned by a whole session, not by one toy. */
  session?: true;
}

/** A machine item scored in a try (shelf, rush). */
export interface ItemScore extends MachineItem {
  roundId: number;
  demo: boolean;
}

export interface RoundMachineEvents extends Record<string, unknown> {
  phase: PhaseChange;
  award: PrizeAward;
  result: RoundResult;
  /** A phase overran its watchdog; the controller must force the next milestone. */
  watchdog: { phase: RoundPhase; roundId: number; seconds: number };
  /** The round was aborted and reset (error recovery / manual restart). */
  abort: { roundId: number; reason: string };
  /** A machine item reached the opening and was scored (items machines only). */
  item: ItemScore;
}

export class RoundMachine {
  readonly events = new Emitter<RoundMachineEvents>();
  private _phase: RoundPhase = 'ATTRACT';
  private _roundId = 0;
  private _demo = false;
  private _phaseTime = 0;
  private grabUsed = false;
  private awarded: PrizeAward | null = null;
  private resultDone = false;
  private watchdogFired = false;
  private readonly awardedRounds = new Set<number>();
  /** Phases in which awardPrize may succeed (machine.configure). */
  private awardPhases: ReadonlySet<RoundPhase> = AWARD_PHASES;
  /** Items scored in the current round, in order. */
  private items: MachineItem[] = [];
  /** Toys already scored since the last configure (an item scores once, ever). */
  private readonly scoredToys = new Set<string>();
  /** Rounds that already earned a session prize. */
  private readonly sessionRounds = new Set<number>();

  /** `sessionId` makes prize ids unique across page loads. */
  constructor(private readonly sessionId: string = Math.random().toString(36).slice(2, 10)) {}

  get phase(): RoundPhase {
    return this._phase;
  }
  get roundId(): number {
    return this._roundId;
  }
  get demo(): boolean {
    return this._demo;
  }
  /** Seconds spent in the current phase (paused time is never added). */
  get phaseTime(): number {
    return this._phaseTime;
  }
  get busy(): boolean {
    return BUSY_PHASES.has(this._phase);
  }
  get award(): PrizeAward | null {
    return this.awarded;
  }
  /** True between rounds, when queued scene / gameplay changes may be applied. */
  get atRoundBoundary(): boolean {
    return this._phase === 'ATTRACT' || this._phase === 'READY' || this._phase === 'RESULT';
  }
  /** Items scored in the current round (cleared when a round begins). */
  get roundItems(): readonly MachineItem[] {
    return this.items;
  }

  /**
   * Machine switch (boundary only): the phases in which awardPrize may succeed. Also forgets which
   * toys were scored, since the bodies of the previous machine are gone.
   */
  configure(options: { awardPhases: ReadonlySet<RoundPhase> }): void {
    if (!this.atRoundBoundary) throw new Error(`RoundMachine.configure: not at a round boundary (${this._phase})`);
    this.awardPhases = options.awardPhases;
    this.scoredToys.clear();
    this.items = [];
  }

  canTransition(to: RoundPhase): boolean {
    return TRANSITIONS[this._phase].includes(to);
  }

  private go(to: RoundPhase): boolean {
    if (!this.canTransition(to)) return false;
    const prev = this._phase;
    this._phase = to;
    this._phaseTime = 0;
    this.watchdogFired = false;
    this.events.emit('phase', { phase: to, prev, roundId: this._roundId, demo: this._demo });
    return true;
  }

  private beginRound(demo: boolean): void {
    this._roundId += 1;
    this._demo = demo;
    this.grabUsed = false;
    this.awarded = null;
    this.resultDone = false;
    this.items = [];
  }

  /** ATTRACT → READY: starts a new round (player or demo). */
  start(demo = false): boolean {
    if (this._phase !== 'ATTRACT') return false;
    this.beginRound(demo);
    return this.go('READY');
  }

  /** RESULT → READY: next round. */
  next(demo = this._demo): boolean {
    if (this._phase !== 'RESULT') return false;
    this.beginRound(demo);
    return this.go('READY');
  }

  /** READY → AIMING on the first movement input. */
  beginAim(): boolean {
    if (this._phase !== 'READY') return false;
    return this.go('AIMING');
  }

  /** One grab per round: READY/AIMING → DESCENDING. Returns false when it is not allowed. */
  grab(): boolean {
    if (this.grabUsed) return false;
    if (this._phase !== 'READY' && this._phase !== 'AIMING') return false;
    this.grabUsed = true;
    return this.go('DESCENDING');
  }

  /** Physical milestones reported by the controller. Each is only accepted in its phase. */
  landed(): boolean {
    return this._phase === 'DESCENDING' && this.go('CLOSING');
  }
  closed(): boolean {
    return this._phase === 'CLOSING' && this.go('LIFTING');
  }
  lifted(): boolean {
    return this._phase === 'LIFTING' && this.go('TRANSPORTING');
  }
  arrived(): boolean {
    return this._phase === 'TRANSPORTING' && this.go('RELEASING');
  }
  released(): boolean {
    return this._phase === 'RELEASING' && this.go('SETTLING');
  }

  /**
   * Settles the prize for this round. Idempotent: only the first call for a
   * round, during a phase in which the toy can really reach the exit, succeeds.
   */
  awardPrize(roundId: number, toyId: string, typeId: string): PrizeAward | null {
    if (roundId !== this._roundId) return null;
    if (!this.awardPhases.has(this._phase)) return null;
    if (this.awarded || this.awardedRounds.has(roundId)) return null;
    this.awardedRounds.add(roundId);
    const award: PrizeAward = {
      roundId,
      prizeId: `${this.sessionId}-${roundId}`,
      toyId,
      typeId,
      demo: this._demo,
    };
    this.awarded = award;
    this.events.emit('award', award);
    return award;
  }

  /**
   * Scores one machine item of this round (shelf, rush). Refused in ATTRACT and RESULT, for a stale
   * round and for a toy that was already scored. Several items per round are fine.
   */
  scoreItem(roundId: number, toyId: string, item: Pick<ItemSpec, 'kind' | 'look' | 'print' | 'value'>): MachineItem | null {
    if (roundId !== this._roundId) return null;
    if (!ITEM_PHASES.has(this._phase)) return null;
    if (this.scoredToys.has(toyId)) return null;
    this.scoredToys.add(toyId);
    const scored: MachineItem = { toyId, kind: item.kind, look: item.look, print: item.print, value: item.value, index: this.items.length + 1 };
    this.items.push(scored);
    this.events.emit('item', { ...scored, roundId, demo: this._demo });
    return scored;
  }

  /**
   * The prize of a whole session (shelf, rush), for the session's last try `roundId`. Never for demo
   * rounds, once per round id, only between tries (READY or RESULT). Emits the ordinary `award`
   * event with `session: true`, so the collection and the claim code work as for any prize.
   */
  awardSessionPrize(roundId: number, typeId: string): PrizeAward | null {
    if (this._demo) return null;
    if (this._phase !== 'RESULT' && this._phase !== 'READY') return null;
    if (!(roundId > 0) || roundId > this._roundId) return null;
    if (this.sessionRounds.has(roundId)) return null;
    this.sessionRounds.add(roundId);
    const award: PrizeAward = { roundId, prizeId: `${this.sessionId}-${roundId}-S`, toyId: '', typeId, demo: false, session: true };
    this.events.emit('award', award);
    return award;
  }

  /** SETTLING → RESULT with the outcome computed from physics. */
  finish(result: RoundResult): boolean {
    if (this._phase !== 'SETTLING' || this.resultDone) return false;
    if (result.roundId !== this._roundId) return false;
    this.resultDone = true;
    this.go('RESULT');
    this.events.emit('result', result);
    return true;
  }

  /** READY/AIMING/RESULT → ATTRACT (idle). */
  toAttract(): boolean {
    if (this._phase === 'AIMING') this.go('READY');
    if (this._phase !== 'READY' && this._phase !== 'RESULT') return false;
    this._demo = false;
    return this.go('ATTRACT');
  }

  /**
   * Error recovery / manual restart: abandons the current round from any phase
   * and starts a fresh one in READY (or ATTRACT). Nothing is awarded.
   */
  abort(reason: string, to: 'READY' | 'ATTRACT' = 'READY'): void {
    const prev = this._phase;
    const roundId = this._roundId;
    this.events.emit('abort', { roundId, reason });
    if (to === 'READY') this.beginRound(false);
    else this._demo = false;
    this._phase = to;
    this._phaseTime = 0;
    this.watchdogFired = false;
    this.events.emit('phase', { phase: to, prev, roundId: this._roundId, demo: this._demo });
  }

  /** Advances phase time. Never call while paused. */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    this._phaseTime += dt;
    const limit = PHASE_WATCHDOG[this._phase];
    if (limit !== undefined && this._phaseTime > limit && !this.watchdogFired) {
      this.watchdogFired = true;
      this.events.emit('watchdog', { phase: this._phase, roundId: this._roundId, seconds: this._phaseTime });
    }
  }
}
