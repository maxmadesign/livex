import type { GameCore } from '../game/GameCore';
import type { AimPlan } from '../game/machines/types';
import { CLAW } from '../physics/fieldSpec';

/** A pilot plays attract-mode rounds through the player's input path (DemoPilot and MachinePilot). */
export interface Pilot {
  /** A new demo round (or a player took over): pick a fresh target. */
  reset(): void;
  /** Once per fixed step while a demo round runs. */
  update(core: GameCore, dt: number): void;
}

/** The genre's aim strategy (GenreModule.aim, bound to the machine's parameters). */
export type AimStrategy = (core: GameCore, demoRound: number) => AimPlan | null;

/** Pause before the pilot starts moving (a player looks first). */
const LOOK_SECONDS = 0.9;
/** A demo round always ends: the claw drops after this long, wherever it got to (plus the plan's patience). */
const SAFETY_SECONDS = 8;

/**
 * Attract-mode steering for the machines other than classic (docs/design/machines.md, section 4.5).
 * Like DemoPilot it only sets the direction input and requests the grab, so a demo try is a real
 * try with real physics; the genre decides where to aim (`GenreModule.aim`: the bridge box's end,
 * the stack nearest the lip, the richest cluster of gems) and how long to let the swing calm down.
 *
 * It never changes the claw, the grip or the physics. Demo rounds are flagged as such: nothing
 * they score is collected, ranked or given a claim code.
 */
export class MachinePilot implements Pilot {
  private plan: AimPlan | null = null;
  private wait = 0;
  private aimTime = 0;
  private steady = 0;
  /** Demo rounds steered so far (the genre may vary its choice with it). */
  private rounds = 0;
  private picked = false;

  constructor(private readonly aim: AimStrategy) {}

  reset(): void {
    this.plan = null;
    this.picked = false;
    this.wait = 0;
    this.aimTime = 0;
    this.steady = 0;
    this.rounds++;
  }

  /** The current plan (tests, diagnostics). */
  get target(): AimPlan | null {
    return this.plan;
  }

  private pick(core: GameCore): void {
    this.picked = true;
    let plan: AimPlan | null = null;
    try {
      plan = this.aim(core, this.rounds);
    } catch {
      plan = null;
    }
    if (plan && (!Number.isFinite(plan.x) || !Number.isFinite(plan.z))) plan = null;
    // Never aim at a point the trolley cannot reach (it would wait there forever).
    this.plan = plan
      ? {
          ...plan,
          x: Math.min(CLAW.maxX, Math.max(CLAW.minX, plan.x)),
          z: Math.min(CLAW.maxZ, Math.max(CLAW.minZ, plan.z)),
          patience: Number.isFinite(plan.patience) ? Math.max(0, plan.patience) : 1,
        }
      : null;
    this.wait = LOOK_SECONDS;
  }

  update(core: GameCore, dt: number): void {
    const phase = core.machine.phase;
    const c = core.controller;
    if (phase !== 'READY' && phase !== 'AIMING') {
      c.clearInput();
      return;
    }
    // A target that left the field (scored, removed) is replaced; a plan without a target is kept.
    const gone = this.plan?.targetToyId != null && !core.phys.toys.has(this.plan.targetToyId);
    if (!this.picked || gone) this.pick(core);
    const plan = this.plan;
    if (!plan) {
      // Nothing worth aiming at: a short look, then a grab where the claw is.
      c.clearInput();
      if ((this.wait -= dt) < -1.5) c.requestGrab();
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      c.clearInput();
      return;
    }
    this.aimTime += dt;
    if (this.aimTime > SAFETY_SECONDS + plan.patience) {
      c.clearInput();
      c.requestGrab();
      return;
    }
    const dx = plan.x - core.claw.trolleyX;
    const dz = plan.z - core.claw.trolleyZ;
    const d = Math.hypot(dx, dz);
    if (d > 0.004) {
      // Ease in towards the target like a careful player.
      const k = Math.min(1, d / 0.05 + 0.06) / d;
      c.inputX = dx * k;
      c.inputZ = dz * k;
      this.steady = 0;
      return;
    }
    c.clearInput();
    if (Math.hypot(core.claw.trolleyVX, core.claw.trolleyVZ) >= 0.01) return;
    // Let the claw stop swinging first, but never longer than the plan's patience.
    this.steady += dt;
    if (core.claw.swingSpeed() < 0.02 || this.steady >= plan.patience) c.requestGrab();
  }
}
