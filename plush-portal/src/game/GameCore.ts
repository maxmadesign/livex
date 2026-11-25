import { Emitter } from '../core/events';
import type { ThemeId } from '../core/types';
import { ClawRig } from '../physics/ClawRig';
import { CLAW, FIXED_DT } from '../physics/fieldSpec';
import { GripMonitor } from '../physics/GripMonitor';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlushAsset } from '../plush/manifest';
import { resolveMachine } from './machines/registry';
import { PlaySession } from './machines/session';
import type { MachineField, ResolvedMachine } from './machines/types';
import { rarityOf } from './rarity';
import { RoundController, type RoundControllerEvents, type RoundParams } from './RoundController';
import { RoundMachine, type PhaseChange } from './RoundMachine';
import type { FieldOptions } from './ToyField';

export interface GameCoreOptions {
  binFloorY: number;
  toyFriction: number;
  params: RoundParams;
  field: FieldOptions;
  themeId: ThemeId;
  sessionId?: string;
  /** The machine to build (default: classic). */
  machine?: ResolvedMachine;
}

/** Everything that belongs to one machine and is rebuilt when the machine changes. */
interface Stack {
  /** 1 for the first machine of the page, +1 per switch (toy ids carry it from the second on). */
  epoch: number;
  def: ResolvedMachine;
  phys: PhysicsWorld;
  claw: ClawRig;
  grip: GripMonitor;
  controller: RoundController;
  field: MachineField;
}

/**
 * The authoritative simulation: physics world, claw, grip logic, round state
 * machine and the toy field. It has no dependency on rendering, audio or the
 * DOM, so the exact same code runs in the browser and in headless tests, and
 * graphics settings cannot influence the outcome of a round.
 *
 * One GameCore, one RoundMachine and one controller event emitter live for the page's lifetime
 * (round ids keep counting, listeners bound once keep working). The physics stack (world, claw,
 * grip monitor, round controller and field) belongs to the current machine: setMachine() builds a
 * fresh one behind the getters, so classic after any number of switches is a fresh classic world
 * (docs/design/machines.md, section 2.4).
 */
export class GameCore {
  readonly machine: RoundMachine;
  /** The round controller's events; outlives every rebuilt controller. */
  readonly controllerEvents = new Emitter<RoundControllerEvents>();
  readonly session: PlaySession;
  themeId: ThemeId;
  /** Simulated time in seconds (only advances in `fixedStep`). */
  time = 0;
  private stack: Stack;
  /** The difficulty preset's parameters before the machine's claw scale (setParams). */
  private baseParams: RoundParams;
  private fieldOptions: FieldOptions;

  get phys(): PhysicsWorld {
    return this.stack.phys;
  }
  get claw(): ClawRig {
    return this.stack.claw;
  }
  get grip(): GripMonitor {
    return this.stack.grip;
  }
  get controller(): RoundController {
    return this.stack.controller;
  }
  get field(): MachineField {
    return this.stack.field;
  }
  /** The machine being played. */
  get def(): ResolvedMachine {
    return this.stack.def;
  }

  constructor(options: GameCoreOptions) {
    this.themeId = options.themeId;
    this.baseParams = { ...options.params };
    this.fieldOptions = { ...options.field };
    this.machine = new RoundMachine(options.sessionId);
    // Registered first, exactly where the classic controller registered its own listeners: the
    // controller always reacts to a phase change before anything else does.
    this.machine.events.on('phase', (e) => this.stack.controller.handlePhase(e.phase, e.prev));
    this.machine.events.on('watchdog', (e) => this.stack.controller.handleWatchdog(e.phase));
    this.session = new PlaySession(this);
    this.machine.events.on('phase', (e) => this.onBoundary(e));
    const def = options.machine ?? resolveMachine('classic');
    this.stack = this.build(def, 1, options.binFloorY, options.toyFriction);
    this.configureMachine(def);
  }

  /** phys → claw → grip → controller → field: the classic construction order. */
  private build(def: ResolvedMachine, epoch: number, binFloorY: number, toyFriction: number): Stack {
    const phys = new PhysicsWorld({ binFloorY, toyFriction, field: def.geometry, idPrefix: epoch > 1 ? `e${epoch}-` : '' });
    const claw = new ClawRig(phys);
    const grip = new GripMonitor(phys, claw);
    const controller = new RoundController(phys, claw, grip, this.machine, def.module.roundParams(this.baseParams, def.params), () => this.themeId, {
      events: this.controllerEvents,
      rules: def.module.createRules(def.params, def.geometry),
      opening: def.geometry.opening,
      subscribe: false,
    });
    const field = def.module.createField(phys, this.fieldOptions, def.params, def.geometry);
    return { epoch, def, phys, claw, grip, controller, field };
  }

  private configureMachine(def: ResolvedMachine): void {
    this.machine.configure({ awardPhases: def.module.awardPhases });
    this.session.configure(def.session, def.def.id);
  }

  /** Genre fields refill at rest at round boundaries (classic's ToyField has no such hook). */
  private onBoundary(e: PhaseChange): void {
    if (e.phase !== 'READY' && e.phase !== 'ATTRACT') return;
    const atBoundary = this.stack.field.atBoundary;
    if (!atBoundary) return;
    if (atBoundary.call(this.stack.field, e.phase, e.demo) > 0) this.settle(1.5);
  }

  /**
   * Switches to another machine (boundary only: ATTRACT, READY or RESULT). A running session ends
   * without a result, the old stack is disposed and a fresh one is built and filled off-screen.
   * The round machine then restarts the round on the new machine (a new round id unless in
   * attract mode), so every listener sees a clean READY / ATTRACT there.
   */
  setMachine(def: ResolvedMachine, ctx: { assets: PlushAsset[]; seed?: number; params?: RoundParams; field?: FieldOptions }): void {
    const m = this.machine;
    if (!m.atRoundBoundary) throw new Error(`GameCore.setMachine: not at a round boundary (${m.phase})`);
    this.session.end('abandoned');
    const old = this.stack;
    const binFloorY = old.phys.binFloorY;
    const toyFriction = old.phys.toyFriction;
    if (ctx.params) this.baseParams = { ...ctx.params };
    if (ctx.field) this.fieldOptions = { ...ctx.field };
    old.controller.dispose();
    old.claw.dispose();
    old.phys.dispose();
    this.stack = this.build(def, old.epoch + 1, binFloorY, toyFriction);
    this.configureMachine(def);
    // The claw is built at the classic home; a machine with another home starts there (before the
    // fill settles, so the field comes to rest around the claw where it will be).
    const home = def.geometry.home;
    if (home.x !== CLAW.homeX || home.z !== CLAW.homeZ) this.claw.reset(home.x, home.z);
    this.populate(ctx.assets, ctx.seed);
    // No controller.resetRound(): the stack is fresh (nothing to release) and a claw reset now
    // would move the claw out of the rest pose the fill just settled it into.
    m.abort('machine_switch', m.phase === 'ATTRACT' ? 'ATTRACT' : 'READY');
  }

  /**
   * New difficulty / gameplay values (Game's settings path). The machine's claw scale is applied
   * on top; the controller latches them at the next round boundary.
   */
  setParams(base: RoundParams): void {
    this.baseParams = { ...base };
    const def = this.stack.def;
    this.controller.setParams(def.module.roundParams(this.baseParams, def.params));
  }

  /** Advances the whole simulation by one fixed step. */
  fixedStep(): void {
    this.session.preStep(FIXED_DT);
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
    this.session.prints = () => assets.map((a) => ({ id: a.id, tier: rarityOf(a.id) }));
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
    this.stack.controller.dispose();
    this.claw.dispose();
    this.phys.dispose();
  }
}
