import type { ThemeId } from '../core/types';
import { ClawRig } from '../physics/ClawRig';
import { FIXED_DT } from '../physics/fieldSpec';
import { GripMonitor } from '../physics/GripMonitor';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlushAsset } from '../plush/manifest';
import { RoundController, type RoundParams } from './RoundController';
import { RoundMachine } from './RoundMachine';
import { ToyField, type FieldOptions } from './ToyField';

export interface GameCoreOptions {
  binFloorY: number;
  toyFriction: number;
  params: RoundParams;
  field: FieldOptions;
  themeId: ThemeId;
  sessionId?: string;
}

/**
 * The authoritative simulation: physics world, claw, grip logic, round state
 * machine and the toy field. It has no dependency on rendering, audio or the
 * DOM, so the exact same code runs in the browser and in headless tests, and
 * graphics settings cannot influence the outcome of a round.
 */
export class GameCore {
  readonly phys: PhysicsWorld;
  readonly claw: ClawRig;
  readonly grip: GripMonitor;
  readonly machine: RoundMachine;
  readonly controller: RoundController;
  readonly field: ToyField;
  themeId: ThemeId;
  /** Simulated time in seconds (only advances in `fixedStep`). */
  time = 0;

  constructor(options: GameCoreOptions) {
    this.themeId = options.themeId;
    this.phys = new PhysicsWorld({ binFloorY: options.binFloorY, toyFriction: options.toyFriction });
    this.claw = new ClawRig(this.phys);
    this.grip = new GripMonitor(this.phys, this.claw);
    this.machine = new RoundMachine(options.sessionId);
    this.controller = new RoundController(this.phys, this.claw, this.grip, this.machine, options.params, () => this.themeId);
    this.field = new ToyField(this.phys, options.field);
  }

  /** Advances the whole simulation by one fixed step. */
  fixedStep(): void {
    this.controller.preStep(FIXED_DT);
    this.claw.preStep(FIXED_DT);
    this.grip.preStep(FIXED_DT);
    this.phys.step();
    this.claw.postStep(FIXED_DT);
    this.controller.postStep(FIXED_DT);
    this.time += FIXED_DT;
  }

  /** Fills the field and lets it come to rest without rendering. */
  populate(assets: PlushAsset[], seed?: number): void {
    this.field.fill(assets, seed);
    this.field.settle(
      3,
      () => {
        this.claw.preStep(FIXED_DT);
      },
      () => {
        this.claw.postStep(FIXED_DT);
      },
    );
  }

  /**
   * Lets the field come to rest without rendering, exactly like `populate` does after
   * filling it. Used when the machine is reset on the spot (a player takes over from the
   * demo): the reset toys are at rest when the player first sees them.
   */
  settle(maxSeconds = 1.5): number {
    return this.field.settle(
      maxSeconds,
      () => this.claw.preStep(FIXED_DT),
      () => this.claw.postStep(FIXED_DT),
    );
  }

  dispose(): void {
    this.claw.dispose();
    this.phys.dispose();
  }
}
