/**
 * A play session (docs/design/machines.md, section 2.6): what a player gets for one START (or PLAY
 * AGAIN on a session card). A round is still one grab; the session sits above the rounds:
 *
 *   open   – classic, bridge: never ends by itself (only an idle reset or a machine switch ends it)
 *   tries  – shelf: ends at the RESULT of try N
 *   timed  – rush: a simulated-time clock that starts at the first input of the run
 *
 * Headless and driven by the round machine's events and by fixed steps only (simulated time), so
 * pausing the game pauses the clock. Demo rounds are ignored. At the end of a tries / timed session
 * the genre may grant one session prize from physics facts (RoundMachine.awardSessionPrize), and
 * the controller's input is locked until newSession().
 */
import { Emitter } from '../../core/events';
import type { RoundResult } from '../../core/types';
import type { PhaseChange } from '../RoundMachine';
import type { GameCore } from '../GameCore';
import { rarityOf, type RarityTier } from '../rarity';
import type { MachineId, SessionEndReason, SessionState } from './ids';
import type { PlaySessionEvents, ScoredItem, SessionReward, SessionRule, SessionSnapshot, SessionSummary } from './types';

/** The timed run announces the last seconds once (guide line, countdown sound). */
export const TIME_LOW_SECONDS = 10;

export class PlaySession {
  readonly events = new Emitter<PlaySessionEvents>();
  /** What the next session will be (configure). */
  private rule: SessionRule = { kind: 'open' };
  private machineId: MachineId = 'classic';
  /** The rule of the running session: latched when it starts. */
  private active: SessionRule = { kind: 'open' };
  private activeMachine: MachineId = 'classic';
  private id = 0;
  private state: SessionState = 'idle';
  private tries = 0;
  private secondsLeft: number | null = null;
  private timerStarted = false;
  private expired = false;
  private lastWhole = -1;
  private timeLowSent = false;
  private items: ScoredItem[] = [];
  private value = 0;
  private reason: SessionEndReason | null = null;
  private reward: SessionReward | null = null;
  private lastRoundId = 0;
  /**
   * The characters a session prize may be (genre sessionReward). Defaults to the field's prints in
   * manifest order; the app may supply an order that prefers the least-collected ones.
   */
  prints: () => readonly { id: string; tier: RarityTier }[] = () => [];

  constructor(private readonly core: GameCore) {
    core.machine.events.on('phase', (e) => this.onPhase(e));
    core.machine.events.on('result', (r) => this.onResult(r));
  }

  /** The kind of the next session and the machine it belongs to. Boundary only; a running session keeps its rule. */
  configure(rule: SessionRule, machineId: MachineId): void {
    this.rule = rule;
    this.machineId = machineId;
  }

  get kind(): SessionRule['kind'] {
    return this.state === 'idle' ? this.rule.kind : this.active.kind;
  }

  get running(): boolean {
    return this.state === 'running';
  }

  snapshot(): SessionSnapshot {
    const idle = this.state === 'idle';
    const rule = idle ? this.rule : this.active;
    return {
      id: this.id,
      machineId: idle ? this.machineId : this.activeMachine,
      kind: rule.kind,
      state: this.state,
      tries: this.tries,
      triesTotal: rule.kind === 'tries' ? rule.tries : null,
      secondsLeft: rule.kind === 'timed' ? (idle ? rule.seconds : this.secondsLeft) : null,
      timerStarted: this.timerStarted,
      items: this.items.length,
      value: this.value,
      reason: this.reason,
      reward: this.reward,
      lastRoundId: this.lastRoundId,
    };
  }

  /**
   * Ends a running session without a result: an idle reset, attract mode or a machine switch. No
   * prize, no ranking, no `over` event; the next player READY starts a fresh session.
   */
  end(reason: SessionEndReason = 'abandoned'): void {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.reason = reason;
    this.core.controller.inputLocked = false;
  }

  /**
   * PLAY AGAIN after a session card: the field goes back to its start layout (settled off-screen),
   * input is unlocked and the next player READY starts a new session. The app then calls next().
   */
  newSession(): void {
    const added = this.core.field.resetForTakeover?.();
    if (added !== undefined) this.core.settle(1.5);
    this.core.controller.inputLocked = false;
    this.state = 'idle';
    this.reason = null;
  }

  /** Simulated time, once per fixed step before the controller: the clock of a timed run. */
  preStep(dt: number): void {
    if (this.state !== 'running' || this.active.kind !== 'timed' || !this.timerStarted || this.expired) return;
    const left = Math.max(0, (this.secondsLeft ?? 0) - dt);
    this.secondsLeft = left;
    const whole = Math.ceil(left);
    if (whole !== this.lastWhole) {
      this.lastWhole = whole;
      this.events.emit('second', { secondsLeft: whole });
    }
    if (!this.timeLowSent && left <= TIME_LOW_SECONDS) {
      this.timeLowSent = true;
      this.events.emit('timeLow', { secondsLeft: whole });
    }
    if (left > 0) return;
    this.expired = true;
    const phase = this.core.machine.phase;
    // Aiming when the time runs out: the claw drops where it is (like the aim timer); the try counts.
    if (phase === 'AIMING') this.core.controller.requestGrab();
    // Waiting for the next try, or still showing the last result (the short RESULT hold before the
    // next READY): the run ends now, without another try.
    else if (phase === 'READY' || phase === 'RESULT') this.finish('time');
    // Otherwise the claw is busy: the try completes and the run ends at its RESULT ("last grab counts").
  }

  /** Test / debug hook (machineDebug.setSessionSeconds): the clock of a running timed run. */
  setSecondsLeft(seconds: number): void {
    if (this.state !== 'running' || this.active.kind !== 'timed') return;
    this.secondsLeft = Math.max(0, seconds);
    this.expired = false;
    if (seconds > TIME_LOW_SECONDS) this.timeLowSent = false;
  }

  private onPhase(e: PhaseChange): void {
    if (e.phase === 'ATTRACT') {
      this.end('abandoned');
      return;
    }
    if (e.demo) return;
    if (e.phase === 'READY' && this.state === 'idle') this.start();
    else if (e.phase === 'AIMING' && this.state === 'running') this.timerStarted = true;
    else if (e.phase === 'DESCENDING' && this.state === 'running') {
      this.tries++;
      // A grab without a move first (READY → DESCENDING) also starts the clock.
      this.timerStarted = true;
    }
  }

  private start(): void {
    this.active = this.rule;
    this.activeMachine = this.machineId;
    this.id++;
    this.state = 'running';
    this.tries = 0;
    this.secondsLeft = this.active.kind === 'timed' ? this.active.seconds : null;
    this.timerStarted = false;
    this.expired = false;
    this.lastWhole = -1;
    this.timeLowSent = false;
    this.items = [];
    this.value = 0;
    this.reason = null;
    this.reward = null;
    this.events.emit('started', this.snapshot());
  }

  private onResult(r: RoundResult): void {
    if (r.demo || this.state !== 'running') return;
    this.lastRoundId = r.roundId;
    for (const item of r.machine?.items ?? []) {
      this.items.push({ toyId: item.toyId, kind: item.kind, look: item.look as ScoredItem['look'], print: item.print, value: item.value, index: this.items.length + 1 });
      this.value += item.value;
    }
    const rule = this.active;
    if (rule.kind === 'tries' && this.tries >= rule.tries) this.finish('tries');
    else if (rule.kind === 'timed' && this.expired) this.finish('time');
  }

  /** The session ran its course: the session prize (if the genre grants one), then the card. */
  private finish(reason: 'tries' | 'time'): void {
    this.state = 'over';
    this.reason = reason;
    const def = this.core.def;
    const summary: SessionSummary = {
      machineId: this.activeMachine,
      sessionId: this.id,
      tries: this.tries,
      items: [...this.items],
      value: this.value,
      lastRoundId: this.lastRoundId,
      reason,
    };
    const pick = def.module.sessionReward?.(summary, def.params, this.prints()) ?? null;
    if (pick && this.lastRoundId > 0) {
      const award = this.core.machine.awardSessionPrize(this.lastRoundId, pick.typeId);
      if (award) this.reward = { typeId: award.typeId, tier: rarityOf(award.typeId), prizeId: award.prizeId, roundId: award.roundId };
    }
    this.core.controller.inputLocked = true;
    this.events.emit('over', this.snapshot());
  }
}
