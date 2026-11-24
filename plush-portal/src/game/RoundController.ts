import { Vector3 } from 'three';
import { Emitter } from '../core/events';
import { clamp } from '../core/math';
import type { ContactLevel, RoundPhase, RoundResult, SlipReason, ThemeId } from '../core/types';
import type { ClawParams, ClawRig } from '../physics/ClawRig';
import { CLAW, FIXED_DT, PRIZE_SENSOR, isOverChute } from '../physics/fieldSpec';
import type { GripFacts, GripMonitor } from '../physics/GripMonitor';
import type { PhysicsWorld, ToyBody } from '../physics/PhysicsWorld';
import type { RoundMachine } from './RoundMachine';

/** Gameplay values latched at the start of every round (never changed mid-round). */
export interface RoundParams extends ClawParams {
  gripAssist: number;
  /** Seconds allowed for aiming; 0 = unlimited. */
  aimTimeLimit: number;
}

export interface RoundControllerEvents extends Record<string, unknown> {
  /** The grab was accepted and the claw starts to descend. */
  grabStarted: { roundId: number; nearest: RoundResult['nearest'] };
  /** First real contact between the claw and something during the descent. */
  clawTouch: { roundId: number; onToy: boolean };
  /** Fingers finished closing; `facts` is null when nothing is between them. */
  gripEvaluated: { roundId: number; facts: GripFacts | null; toy: ToyBody | null };
  liftStarted: { roundId: number; holding: boolean };
  /** The target got away before it was released on purpose. */
  slipped: { roundId: number; reason: SlipReason; phase: RoundPhase; toy: ToyBody };
  /** Fingers open (over the chute when holding, anywhere when empty). */
  released: { roundId: number; holding: boolean; toy: ToyBody | null };
  /** The awarded toy passed the prize sensor. */
  prizeDetected: { roundId: number; toy: ToyBody };
  /** A toy that is not this round's prize fell into the bin; it is returned at restock. */
  strayInBin: { toy: ToyBody };
  /** Optional aim timer crossed a whole second. */
  aimTick: { secondsLeft: number };
  /** A watchdog had to force the sequence forward. */
  recovered: { phase: RoundPhase; roundId: number };
}

const _v = new Vector3();
/** Timing of the automatic sequence (see docs/PHYSICS.md). Never changed at run time. */
export const ROUND_TUNING = {
  /** How far the winch may run ahead of the claw once the cable has gone slack (m). */
  slackAllowance: 0.022,
  /** Seconds the claw must sit still on something before the descent is declared finished. */
  stallTime: 0.12,
  /** Total time the claw may be carried by toys before the descent ends regardless of motion. */
  maxSlackTime: 0.9,
  /** Hub speed below which the claw counts as "sitting still" (m/s). */
  stallSpeed: 0.035,
};

/**
 * Drives one round: translates player input into trolley motion, runs the
 * automatic grab sequence from real physical milestones and reports the
 * outcome. All decisions (landing, grip, slip, prize) are read from the
 * physics state; nothing is pre-determined.
 */
export class RoundController {
  readonly events = new Emitter<RoundControllerEvents>();
  /** Player (or demo pilot) input: unit-clamped direction, +x right, +z towards the player. */
  inputX = 0;
  inputZ = 0;
  private grabQueued = false;
  private params: RoundParams;
  private pendingParams: RoundParams | null = null;

  private nearest: RoundResult['nearest'] = null;
  private touched = false;
  private wasHolding = false;
  private destinationIsChute = false;
  private slipReported = false;
  private releasedHolding = false;
  private palmTime = 0;
  private stallTime = 0;
  private slackTotal = 0;
  private awardTime = -1;
  /** Seconds left on the aim timer, or -1 when there is no limit. */
  aimTimeLeft = -1;
  private lastAimSecond = -1;
  private readonly strays = new Set<ToyBody>();

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly claw: ClawRig,
    private readonly grip: GripMonitor,
    readonly machine: RoundMachine,
    params: RoundParams,
    private readonly themeId: () => ThemeId,
  ) {
    this.params = { ...params };
    this.applyParams();
    machine.events.on('phase', (e) => this.onPhase(e.phase, e.prev));
    machine.events.on('watchdog', (e) => this.onWatchdog(e.phase));
  }

  /** New gameplay values; they take effect at the next round boundary. */
  setParams(params: RoundParams): void {
    this.pendingParams = { ...params };
    if (this.machine.atRoundBoundary) this.latchParams();
  }

  private latchParams(): void {
    if (!this.pendingParams) return;
    this.params = this.pendingParams;
    this.pendingParams = null;
    this.applyParams();
  }

  private applyParams(): void {
    this.claw.setParams(this.params);
    this.grip.settings = { assist: this.params.gripAssist, clawForce: this.params.clawForce };
  }

  get activeParams(): Readonly<RoundParams> {
    return this.params;
  }

  /** Requests the (single) grab of this round. Returns false when it cannot be accepted right now. */
  requestGrab(): boolean {
    const phase = this.machine.phase;
    if (phase !== 'READY' && phase !== 'AIMING') return false;
    this.grabQueued = true;
    return true;
  }

  clearInput(): void {
    this.inputX = 0;
    this.inputZ = 0;
  }

  /** Manual restart / error recovery: drops everything and puts the claw back home. */
  resetRound(reason: string, to: 'READY' | 'ATTRACT' = 'READY'): void {
    this.grip.release();
    this.grip.beginRound();
    this.claw.reset(CLAW.homeX, CLAW.homeZ);
    this.grabQueued = false;
    this.clearInput();
    this.machine.abort(reason, to);
  }

  /* ------------------------------------------------------------ transitions */

  private onPhase(phase: RoundPhase, prev: RoundPhase): void {
    const claw = this.claw;
    switch (phase) {
      case 'READY':
        this.latchParams();
        this.grabQueued = false;
        this.touched = false;
        this.wasHolding = false;
        this.slipReported = false;
        this.releasedHolding = false;
        this.awardTime = -1;
        this.nearest = null;
        this.aimTimeLeft = this.params.aimTimeLimit > 0 ? this.params.aimTimeLimit : -1;
        this.lastAimSecond = -1;
        this.grip.beginRound();
        claw.setFingers(1);
        claw.setWinch(CLAW.ropeMin, this.params.liftSpeed);
        if (prev === 'ATTRACT' || prev === 'RESULT') claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, this.params.moveSpeed);
        break;
      case 'ATTRACT':
        this.latchParams();
        claw.setFingers(1);
        claw.setWinch(CLAW.ropeMin, this.params.liftSpeed);
        claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, this.params.moveSpeed * 0.7);
        break;
      case 'AIMING':
        break;
      case 'DESCENDING':
        this.nearest = this.findNearest();
        this.grip.markAim();
        this.palmTime = 0;
        this.stallTime = 0;
        this.slackTotal = 0;
        claw.stopTrolley();
        claw.setFingers(1);
        claw.setWinch(CLAW.ropeMax, this.params.descendSpeed);
        this.events.emit('grabStarted', { roundId: this.machine.roundId, nearest: this.nearest });
        break;
      case 'CLOSING':
        claw.holdWinch();
        claw.setFingers(0);
        break;
      case 'LIFTING': {
        claw.setWinch(CLAW.ropeMin, this.params.liftSpeed);
        this.events.emit('liftStarted', { roundId: this.machine.roundId, holding: this.grip.target !== null });
        break;
      }
      case 'TRANSPORTING': {
        this.wasHolding = this.grip.holding();
        this.destinationIsChute = this.wasHolding;
        if (this.wasHolding) claw.setTrolleyTarget(CLAW.dropX, CLAW.dropZ, this.params.moveSpeed * 0.92);
        else claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, this.params.moveSpeed * 1.15);
        break;
      }
      case 'RELEASING': {
        const holding = this.grip.holding();
        this.releasedHolding = holding;
        const toy = this.grip.target;
        this.grip.release();
        claw.setFingers(1, 1.3);
        this.events.emit('released', { roundId: this.machine.roundId, holding, toy: holding ? toy : null });
        break;
      }
      case 'SETTLING':
        claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, this.params.moveSpeed);
        break;
      case 'RESULT':
        break;
    }
  }

  private onWatchdog(phase: RoundPhase): void {
    const m = this.machine;
    this.events.emit('recovered', { phase, roundId: m.roundId });
    switch (phase) {
      case 'DESCENDING':
        m.landed();
        break;
      case 'CLOSING':
        this.grip.establish();
        m.closed();
        break;
      case 'LIFTING':
        m.lifted();
        break;
      case 'TRANSPORTING':
        m.arrived();
        break;
      case 'RELEASING':
        m.released();
        break;
      case 'SETTLING':
        m.finish(this.buildResult());
        break;
    }
  }

  /* ---------------------------------------------------------------- stepping */

  /** Call once per fixed step, before the claw / world are stepped. */
  preStep(dt: number = FIXED_DT): void {
    const m = this.machine;
    m.tick(dt);
    const claw = this.claw;
    const p = this.params;
    switch (m.phase) {
      case 'READY':
      case 'AIMING': {
        const moving = Math.abs(this.inputX) > 1e-3 || Math.abs(this.inputZ) > 1e-3;
        if (m.phase === 'READY' && moving) m.beginAim();
        if (m.phase === 'AIMING' || moving) {
          // Diagonals are normalised so they are not faster than straight moves.
          let x = clamp(this.inputX, -1, 1);
          let z = clamp(this.inputZ, -1, 1);
          const len = Math.hypot(x, z);
          if (len > 1) {
            x /= len;
            z /= len;
          }
          claw.setTrolleyVelocity(x * p.moveSpeed, z * p.moveSpeed);
        }
        if (m.phase === 'AIMING' && this.aimTimeLeft >= 0) {
          this.aimTimeLeft = Math.max(0, this.aimTimeLeft - dt);
          const whole = Math.ceil(this.aimTimeLeft);
          if (whole !== this.lastAimSecond) {
            this.lastAimSecond = whole;
            this.events.emit('aimTick', { secondsLeft: whole });
          }
          if (this.aimTimeLeft === 0) this.grabQueued = true;
        }
        if (this.grabQueued) {
          this.grabQueued = false;
          m.grab();
        }
        break;
      }
      case 'DESCENDING': {
        // Soft landing: slow the winch down just before the palm or the finger tips touch something.
        const clearance = claw.clearanceBelow(0.16);
        const hubY = claw.hubPose.pos[1]!;
        const tipClear = hubY - 0.2;
        const near = Math.min(clearance, tipClear);
        const scale = near < 0.08 ? clamp(0.32 + (0.68 * near) / 0.08, 0.32, 1) : 1;
        // Pay the cable out only a little ahead of the claw: when a finger rests on something the
        // claw keeps working its way down under its own weight instead of dropping onto a slack rope.
        const limit = claw.slackTime > 0 ? Math.min(CLAW.ropeMax, claw.tautLength() + ROUND_TUNING.slackAllowance) : CLAW.ropeMax;
        claw.setWinch(limit, p.descendSpeed * scale);
        break;
      }
      default:
        break;
    }
  }

  /** Call once per fixed step, after the world and the claw were stepped. */
  postStep(dt: number = FIXED_DT): void {
    const m = this.machine;
    const claw = this.claw;
    const grip = this.grip;
    const phase = m.phase;
    if (m.busy) grip.scan(dt);

    switch (phase) {
      case 'DESCENDING': {
        if (!this.touched && grip.contacts.length > 0) {
          this.touched = true;
          this.events.emit('clawTouch', { roundId: m.roundId, onToy: true });
        }
        // Landed = the palm rests on a toy, or the claw cannot get any lower (it sits on the floor,
        // the chute guard or wedged between toys), or the cable is fully paid out. A finger tip that
        // merely touches a neighbour does not count: the claw gets time to slide past it.
        let palm = false;
        for (const c of grip.contacts) if (c.part === 3) palm = true;
        this.palmTime = palm ? this.palmTime + dt : 0;
        const resting = claw.slackTime > 0.05 && claw.hubSpeed() < ROUND_TUNING.stallSpeed;
        this.stallTime = resting ? this.stallTime + dt : 0;
        // Fallback: a claw that keeps wriggling on top of a wobbling toy never looks "stalled".
        // After it has been carried by something for a while in total, it has landed.
        if (claw.slackTime > 0) this.slackTotal += dt;
        const slack =
          (this.palmTime > 0.05 && claw.slackTime > 0.03) ||
          this.stallTime > ROUND_TUNING.stallTime ||
          this.slackTotal > ROUND_TUNING.maxSlackTime;
        const bottom = claw.ropeLength > CLAW.ropeMax - 0.004 && Math.abs(claw.ropeSpeed) < 0.02;
        if (m.phaseTime > 0.25 && (slack || bottom)) {
          if (!this.touched) {
            this.touched = true;
            this.events.emit('clawTouch', { roundId: m.roundId, onToy: false });
          }
          m.landed();
        }
        break;
      }
      case 'CLOSING': {
        const t = m.phaseTime;
        if ((t > 0.42 && claw.fingersSettled()) || t > 1.5) {
          const facts = grip.establish();
          this.events.emit('gripEvaluated', { roundId: m.roundId, facts, toy: grip.target });
          m.closed();
        }
        break;
      }
      case 'LIFTING': {
        grip.track(dt, true);
        this.checkSlip(phase);
        this.checkPrize();
        if (claw.winchArrived()) m.lifted();
        break;
      }
      case 'TRANSPORTING': {
        grip.track(dt, false);
        this.checkSlip(phase);
        this.checkPrize();
        if (this.destinationIsChute && !grip.holding()) {
          // Lost the toy on the way: no reason to visit the chute any more.
          this.destinationIsChute = false;
          claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, this.params.moveSpeed * 1.1);
        }
        if (claw.trolleyArrived()) {
          const calm = !this.destinationIsChute || claw.swingSpeed() < 0.14 || m.phaseTime > 6;
          if (calm) m.arrived();
        }
        break;
      }
      case 'RELEASING': {
        this.checkPrize();
        const wait = this.releasedHolding ? 0.5 : 0.18;
        if (m.phaseTime > wait && claw.fingersAtGoal()) m.released();
        break;
      }
      case 'SETTLING': {
        this.checkPrize();
        const t = m.phaseTime;
        const award = m.award;
        const toy = grip.target;
        if (award) {
          if (this.awardTime < 0) this.awardTime = t;
          // Give the prize a moment to land in the bin before the result is shown.
          const landed = toy ? toy.body.translation(this.phys.scratchV).y < this.phys.binFloorY + 0.3 && this.speedOf(toy) < 0.6 : true;
          if ((landed && t - this.awardTime > 0.35) || t - this.awardTime > 1.6) m.finish(this.buildResult());
        } else {
          const minWait = this.releasedHolding || grip.slipped ? 0.9 : 0.3;
          const falling = toy ? this.speedOf(toy) > 0.35 : false;
          if ((t > minWait && !falling) || t > 3.2) m.finish(this.buildResult());
        }
        break;
      }
      default:
        break;
    }
    this.checkStrays();
  }

  private speedOf(toy: ToyBody): number {
    const v = toy.body.linvel(this.phys.scratchV);
    return Math.hypot(v.x, v.y, v.z);
  }

  private checkSlip(phase: RoundPhase): void {
    const grip = this.grip;
    if (this.slipReported || !grip.slipped || !grip.target) return;
    this.slipReported = true;
    this.events.emit('slipped', {
      roundId: this.machine.roundId,
      reason: grip.slipReason ?? 'overload',
      phase,
      toy: grip.target,
    });
    this.slipPhase = phase;
  }
  private slipPhase: RoundPhase | null = null;

  /**
   * Awards the prize only when this round's valid target is really inside the
   * exit: it overlaps the sensor volume below floor level and its centre of
   * mass is below the floor. Idempotent through RoundMachine.awardPrize.
   */
  private checkPrize(): void {
    const toy = this.grip.target;
    const m = this.machine;
    if (!toy || m.award || toy.inBin) return;
    const com = toy.body.worldCom(this.phys.scratchV);
    if (com.y > PRIZE_SENSOR.awardComY) return;
    if (!isOverChute(com.x, com.z, 0.02)) return;
    if (!this.phys.sensorHits.has(toy) && !this.phys.isInPrizeSensor(toy)) return;
    const award = m.awardPrize(m.roundId, toy.id, toy.asset.id);
    if (!award) return;
    toy.inBin = true;
    this.events.emit('prizeDetected', { roundId: m.roundId, toy });
  }

  /** Toys that fell into the exit without being this round's prize are flagged so they can be returned. */
  private checkStrays(): void {
    if (this.phys.sensorHits.size === 0) return;
    for (const toy of this.phys.sensorHits) {
      if (toy.inBin || this.strays.has(toy)) continue;
      const y = toy.body.worldCom(this.phys.scratchV).y;
      if (y > PRIZE_SENSOR.awardComY) continue;
      if (toy === this.grip.target && this.machine.busy) continue; // handled by checkPrize
      toy.inBin = true;
      this.strays.add(toy);
      this.events.emit('strayInBin', { toy });
    }
    // Forget hits of toys that left the sensor again above the floor.
    for (const toy of [...this.phys.sensorHits]) {
      if (!toy.inBin && !this.phys.isInPrizeSensor(toy)) this.phys.sensorHits.delete(toy);
    }
  }

  /** Called by the field when stray toys were removed / returned. */
  forgetStrays(): void {
    this.strays.clear();
  }

  private findNearest(): RoundResult['nearest'] {
    let best: RoundResult['nearest'] = null;
    for (const toy of this.phys.toys.values()) {
      if (toy.inBin) continue;
      const com = toy.body.worldCom(this.phys.scratchV);
      const dx = com.x - this.claw.trolleyX;
      const dz = com.z - this.claw.trolleyZ;
      const dist = Math.hypot(dx, dz);
      if (!best || dist < best.dist) best = { dx, dz, dist, typeId: toy.asset.id };
    }
    return best;
  }

  private buildResult(): RoundResult {
    const m = this.machine;
    const grip = this.grip;
    const award = m.award;
    const contact: ContactLevel = grip.contactLevel;
    let outcome: RoundResult['outcome'];
    let slipReason: SlipReason | null = null;
    let slipPhase: RoundPhase | null = null;
    if (award) outcome = 'won';
    else if (contact === 'gripped' || contact === 'lifted') {
      outcome = 'slipped';
      if (this.releasedHolding && !grip.slipped) {
        slipReason = 'bounced_out';
        slipPhase = 'RELEASING';
      } else {
        slipReason = grip.slipReason ?? (grip.facts && grip.facts.centering < 0.45 ? 'eccentric' : 'weak_support');
        slipPhase = this.slipPhase ?? 'LIFTING';
      }
    } else outcome = 'empty';
    const target = grip.target;
    return {
      roundId: m.roundId,
      outcome,
      demo: m.demo,
      themeId: this.themeId(),
      targetToyId: target ? target.id : null,
      targetTypeId: target ? target.asset.id : null,
      prizeId: award ? award.prizeId : null,
      contact,
      slipReason,
      slipPhase,
      liftedMs: Math.round(grip.liftedMs),
      gripQuality: grip.facts ? Number(grip.facts.quality.toFixed(3)) : 0,
      nearest: this.nearest,
    };
  }

  /** Position of the claw axis on the floor plane (for the aim reticle). */
  aimPoint(out: Vector3): Vector3 {
    return out.set(this.claw.hubPose.pos[0]!, 0, this.claw.hubPose.pos[2]!);
  }

  /** Scratch accessor used by tests. */
  debugState(): { phase: RoundPhase; holding: boolean; contact: ContactLevel; load: number } {
    void _v;
    return { phase: this.machine.phase, holding: this.grip.holding(), contact: this.grip.contactLevel, load: this.grip.load };
  }
}
