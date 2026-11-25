/**
 * A small test-only genre that exercises every seam of the machine framework with real physics:
 * the designed bridge layout (a pit, two bars, four fences), a printed box resting on the bars, a
 * few gems on the floor, TryRules with a partial lift, an in-place transport and a retract before
 * the claw goes home, award detection by the opening test of section 2.5 (the box is a prize, a gem
 * is a scored item), refills at rest at round boundaries and a configurable session rule.
 *
 * It is not a game design: the bridge, shelf and rush genres (WS-B, WS-C) build the real ones.
 */
import type { RoundPhase, RoundResult } from '../../../src/core/types';
import type { MachineId } from '../../../src/game/machines/ids';
import type { GenreModule, MachineDef, MachineField, ResolvedMachine, SessionRule, TryContext, TryRules } from '../../../src/game/machines/types';
import type { FieldOptions } from '../../../src/game/ToyField';
import { overOpening, type FieldGeometry } from '../../../src/physics/fieldGeometry';
import { CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import { boxItem, gemItem, type ItemSpec } from '../../../src/physics/items';
import type { PhysicsWorld, ToyBody } from '../../../src/physics/PhysicsWorld';
import type { PlushAsset } from '../../../src/plush/manifest';
import { BRIDGE_GEOMETRY } from './designGeometry';

const LIFT_DELTA = 0.08;
const BOX_REST: [number, number, number] = [-0.2, 0.1125, -0.22];
const GEM_SPOTS: [number, number, number][] = [
  [0.2, 0.06, -0.6],
  [0.28, 0.06, -0.45],
  [0.12, 0.06, -0.3],
];
/** A gem that is pushed off the field counts as scored only once it is really below the floor. */
const SENSOR_PHASES: ReadonlySet<RoundPhase> = new Set(['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);

export class ProbeField implements MachineField {
  private assets: PlushAsset[] = [];
  /** Bodies added since construction (refills included). */
  added = 0;
  constructor(
    private readonly phys: PhysicsWorld,
    private options: FieldOptions,
  ) {}

  setOptions(options: FieldOptions): void {
    this.options = { ...options };
  }
  fill(assets: PlushAsset[], seed = this.options.seed): ToyBody[] {
    this.phys.removeAllToys();
    this.assets = [...assets];
    void seed;
    const placed = [this.placeBox(), ...GEM_SPOTS.map((p, i) => this.phys.addItem(gemItem({ look: i === 0 ? 'gemDiamond' : 'gemEmerald', radius: 0.036, mass: 0.032, value: i === 0 ? 150 : 10 }), 'sakura', p, [0, 0, 0, 1]))];
    this.added += placed.length;
    this.phys.snapPoses();
    return placed;
  }
  private placeBox(): ToyBody {
    const print = this.assets[0]?.id ?? 'sakura.bunny';
    return this.phys.addItem(boxItem({ look: 'bridgeBox', size: [0.24, 0.1, 0.13], mass: 0.4, round: 0.004, friction: 0.6, print }), 'sakura', BOX_REST, [0, 0, 0, 1]);
  }
  onField(): ToyBody[] {
    return [...this.phys.toys.values()].filter((t) => !t.inBin);
  }
  inBin(): ToyBody[] {
    return [...this.phys.toys.values()].filter((t) => t.inBin);
  }
  missing(): number {
    return 0;
  }
  restockOne(): ToyBody | null {
    return null;
  }
  clearBin(): ToyBody[] {
    const out = this.inBin();
    for (const t of out) this.phys.removeToy(t);
    return out;
  }
  clearFallen(): ToyBody[] {
    const out = [...this.phys.toys.values()].filter((t) => t.inBin || t.body.worldCom().y < this.phys.opening.awardComY);
    for (const t of out) this.phys.removeToy(t);
    return out;
  }
  settle(maxSeconds = 2.5, preStep?: () => void, postStep?: () => void): number {
    let calm = 0;
    let steps = 0;
    for (; steps < Math.ceil(maxSeconds / FIXED_DT); steps++) {
      preStep?.();
      this.phys.step();
      postStep?.();
      calm = this.phys.maxToySpeed() < 0.02 ? calm + 1 : 0;
      if (steps > 40 && calm > 24) break;
    }
    this.phys.snapPoses();
    return steps * FIXED_DT;
  }
  /** A won box is replaced at the next boundary, placed at rest on the bars. */
  atBoundary(): number {
    if (this.onField().some((t) => t.item?.kind === 'box')) return 0;
    this.clearBin();
    this.placeBox();
    this.added++;
    this.phys.snapPoses();
    return 1;
  }
  resetForTakeover(): number {
    return this.fill(this.assets).length;
  }
}

/** Rules of one probe try; records what it saw for the tests. */
export class ProbeRules implements TryRules {
  readonly home = { x: BRIDGE_GEOMETRY.home.x, z: BRIDGE_GEOMETRY.home.z };
  /** Every phase postStep was called in (deduplicated, in order of first appearance). */
  readonly seenPhases: RoundPhase[] = [];
  tries = 0;
  ropeAtLift = 0;
  private retracting = false;
  private settleFrom = { x: 0, z: 0 };
  private box: ToyBody | null = null;

  beginTry(ctx: TryContext): void {
    this.tries++;
    this.box = [...ctx.phys.toys.values()].find((t) => t.item?.kind === 'box' && !t.inBin) ?? null;
  }
  liftTarget(ctx: TryContext): number {
    this.ropeAtLift = ctx.claw.ropeLength;
    return Math.max(CLAW.ropeMin, ctx.claw.ropeLength - LIFT_DELTA);
  }
  transportTarget(ctx: TryContext): { x: number; z: number; speed: number; toOpening: boolean } {
    return { x: ctx.claw.trolleyX, z: ctx.claw.trolleyZ, speed: ctx.params.moveSpeed, toOpening: false };
  }
  beginSettling(ctx: TryContext): void {
    // Wind the cable up first; the trolley only heads home once the claw is clear of the box.
    this.retracting = true;
    this.settleFrom = { x: ctx.claw.trolleyX, z: ctx.claw.trolleyZ };
    ctx.claw.stopTrolley();
    ctx.claw.setWinch(CLAW.ropeMin, ctx.params.liftSpeed);
  }
  postStep(ctx: TryContext, phase: RoundPhase): void {
    if (!this.seenPhases.includes(phase)) this.seenPhases.push(phase);
    if (phase === 'SETTLING' && this.retracting && ctx.claw.winchArrived()) {
      this.retracting = false;
      ctx.claw.setTrolleyTarget(this.home.x, this.home.z, ctx.params.moveSpeed);
    }
    const m = ctx.machine;
    const o = ctx.opening;
    for (const toy of ctx.phys.toys.values()) {
      if (toy.inBin || !toy.item) continue;
      const com = toy.body.worldCom(ctx.phys.scratchV);
      if (com.y > o.awardComY || !overOpening(o, com.x, com.z)) continue;
      if (!ctx.phys.sensorHits.has(toy) && !ctx.phys.isInPrizeSensor(toy)) continue;
      if (toy.item.kind === 'box') {
        if (!SENSOR_PHASES.has(phase)) continue;
        if (!m.awardPrize(m.roundId, toy.id, toy.item.print ?? toy.asset.id)) continue;
        toy.inBin = true;
        ctx.events.emit('prizeDetected', { roundId: m.roundId, toy });
      } else if (m.scoreItem(m.roundId, toy.id, toy.item)) {
        toy.inBin = true;
        ctx.events.emit('itemScored', { roundId: m.roundId, toy, item: toy.item as ItemSpec });
      }
    }
  }
  canFinish(ctx: TryContext, phaseTime: number): boolean {
    const moved = Math.hypot(ctx.claw.trolleyX - this.settleFrom.x, ctx.claw.trolleyZ - this.settleFrom.z) > 0.05;
    const home = ctx.claw.trolleyArrived();
    return (!this.retracting && (home || moved) && phaseTime > 0.3) || phaseTime > 5;
  }
  resultExtras(ctx: TryContext, base: RoundResult): Partial<RoundResult> {
    const award = ctx.machine.award;
    const items = [...ctx.machine.roundItems];
    return {
      outcome: award || items.length > 0 ? 'won' : 'empty',
      slipReason: null,
      slipPhase: null,
      targetToyId: award ? award.toyId : (this.box?.id ?? base.targetToyId),
      targetTypeId: award ? award.typeId : (this.box?.item?.print ?? null),
      machine: { id: 'probe', genre: 'probe', items, progress: null, progressGain: null, stuck: false },
    };
  }
  debugState(): Record<string, unknown> {
    return { tries: this.tries, retracting: this.retracting };
  }
}

export interface ProbeOptions {
  session?: SessionRule;
  geometry?: FieldGeometry;
  /** Which registered machine id the probe stands in for (a test-only machine has no id of its own). */
  id?: MachineId;
  /** Every rules object the module created (newest last). */
  created?: ProbeRules[];
  presentation?: 'prize' | 'items';
}

/** A ResolvedMachine for the probe genre (typed as a bridge: the genre list is closed). */
export function probeMachine(o: ProbeOptions = {}): ResolvedMachine {
  const geometry = o.geometry ?? BRIDGE_GEOMETRY;
  const session = o.session ?? { kind: 'open' };
  const module = {
    genre: 'bridge',
    defaults: {},
    presentation: o.presentation ?? 'prize',
    awardPhases: SENSOR_PHASES,
    fromSettings: () => ({}),
    geometry: () => geometry,
    session: () => session,
    controls: () => 'joystick',
    roundParams: (base: never) => base,
    createRules: () => {
      const rules = new ProbeRules();
      o.created?.push(rules);
      return rules;
    },
    createField: (phys: PhysicsWorld, options: FieldOptions) => new ProbeField(phys, options),
    sessionReward: (s: { items: readonly { print: string | null }[] }, _p: unknown, prints: readonly { id: string }[]) => (s.items.length > 0 ? { typeId: prints[0]?.id ?? 'sakura.bunny' } : null),
  } as unknown as GenreModule;
  const def: MachineDef = { id: o.id ?? 'bridge', genre: 'bridge', order: 99, params: {}, available: true, unlockAfterWins: 0 };
  return { def, module, params: {} as never, geometry, session, controls: 'joystick' };
}
