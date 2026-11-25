/**
 * Headless harness around GameCore used by the regression tests and by
 * tools/dev/grip-sweep.ts: real baked characters, deterministic seeds, a
 * "player" that steers with the same input path as the HUD.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTY_PRESETS } from '../../../src/app/presets';
import type { RoundPhase, RoundResult, SlipReason, ThemeId } from '../../../src/core/types';
import { GameCore } from '../../../src/game/GameCore';
import type { MachineId } from '../../../src/game/machines/ids';
import { resolveMachine } from '../../../src/game/machines/registry';
import type { ResolvedMachine } from '../../../src/game/machines/types';
import type { RoundParams } from '../../../src/game/RoundController';
import { BIN, CHUTE, CLAW, FIELD, FIXED_DT, PRIZE_SENSOR } from '../../../src/physics/fieldSpec';
import { initRapier, type ToyBody } from '../../../src/physics/PhysicsWorld';
import type { PlushAsset, PlushManifest } from '../../../src/plush/manifest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let manifestCache: PlushManifest | null = null;
export function loadManifest(): PlushManifest {
  manifestCache ??= JSON.parse(readFileSync(join(root, 'public', 'assets', 'plush', 'manifest.json'), 'utf8')) as PlushManifest;
  return manifestCache;
}

export function themeAssets(theme: ThemeId): PlushAsset[] {
  return loadManifest().assets.filter((a) => a.theme === theme);
}

export type Difficulty = keyof typeof DIFFICULTY_PRESETS;

export function roundParams(difficulty: Difficulty = 'arcade', overrides: Partial<RoundParams> = {}): RoundParams {
  return { ...DIFFICULTY_PRESETS[difficulty], aimTimeLimit: 0, ...overrides };
}

export interface CoreOptions {
  theme?: ThemeId;
  seed?: number;
  difficulty?: Difficulty;
  params?: Partial<RoundParams>;
  count?: number;
  scale?: number;
  density?: number;
  binFloorY?: number;
  assets?: PlushAsset[];
  /** The machine to build (default classic). An id may name a machine that is not offered to players yet. */
  machine?: MachineId | ResolvedMachine;
}

/** The machine for an id, available or not; throws when its genre module has not landed yet. */
export function testMachine(id: MachineId): ResolvedMachine {
  const machine = resolveMachine(id, undefined, { includeUnavailable: true });
  if (machine.def.id !== id) throw new Error(`machine "${id}" can not be built yet (its genre module is pending)`);
  return machine;
}

/** Default field: exactly what a fresh install plays (18 toys, scale 0.92, density 0.2). */
export async function makeCore(options: CoreOptions = {}): Promise<GameCore> {
  await initRapier();
  const theme = options.theme ?? 'sakura';
  const seed = options.seed ?? 7;
  const core = new GameCore({
    binFloorY: options.binFloorY ?? -0.6,
    toyFriction: 1,
    params: roundParams(options.difficulty ?? 'arcade', options.params),
    field: { count: options.count ?? 18, scale: options.scale ?? 0.92, density: options.density ?? 0.2, massScale: 1, seed },
    themeId: theme,
    sessionId: 'test',
    machine: options.machine === undefined ? undefined : typeof options.machine === 'string' ? testMachine(options.machine) : options.machine,
  });
  core.populate(options.assets ?? themeAssets(theme), seed);
  return core;
}

export interface RoundTrace {
  result: RoundResult;
  /** Simulated seconds from the grab being accepted to the result. */
  grabSeconds: number;
  /** Simulated seconds for the whole round including steering. */
  totalSeconds: number;
  phases: { phase: RoundPhase; at: number }[];
  awards: number;
  recoveries: RoundPhase[];
  slip: { reason: SlipReason; phase: RoundPhase } | null;
  /** Position of the prize's centre of mass when it was detected. */
  prizeAt: [number, number, number] | null;
}

export interface PlayOptions {
  /** Hard cap in simulated seconds. */
  maxSeconds?: number;
  /** Called every fixed step (after the step). */
  onStep?: (core: GameCore) => void;
  demo?: boolean;
  /**
   * A patient player: once the trolley has stopped, wait up to this many
   * seconds for the claw to stop swinging before pressing the button.
   * 0 (default) presses as soon as the trolley stands still.
   */
  settleSwing?: number;
}

/**
 * Plays one complete round: starts it if needed, steers the trolley to
 * (x, z) through the controller's input, requests the grab once the trolley
 * has stopped and waits for the result.
 */
export function playRound(core: GameCore, x: number, z: number, options: PlayOptions = {}): RoundTrace {
  const m = core.machine;
  let result: RoundResult | null = null;
  let awards = 0;
  let grabAt = -1;
  let slip: RoundTrace['slip'] = null;
  let prizeAt: RoundTrace['prizeAt'] = null;
  const phases: RoundTrace['phases'] = [];
  const recoveries: RoundPhase[] = [];
  const offs = [
    m.events.on('result', (r) => (result = r)),
    m.events.on('award', () => awards++),
    m.events.on('phase', (e) => {
      phases.push({ phase: e.phase, at: core.time });
      if (e.phase === 'DESCENDING') grabAt = core.time;
    }),
    core.controller.events.on('recovered', (e) => recoveries.push(e.phase)),
    core.controller.events.on('slipped', (e) => (slip = { reason: e.reason, phase: e.phase })),
    core.controller.events.on('prizeDetected', (e) => {
      const c = e.toy.body.worldCom();
      prizeAt = [c.x, c.y, c.z];
    }),
  ];
  if (m.phase === 'ATTRACT') m.start(options.demo ?? false);
  else if (m.phase === 'RESULT') m.next(options.demo ?? false);
  const start = core.time;
  const maxSteps = Math.ceil((options.maxSeconds ?? 40) / FIXED_DT);
  const ax = Math.min(CLAW.maxX, Math.max(CLAW.minX, x));
  const az = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, z));
  let waited = 0;
  for (let i = 0; i < maxSteps && !result; i++) {
    if (m.phase === 'READY' || m.phase === 'AIMING') {
      const dx = ax - core.claw.trolleyX;
      const dz = az - core.claw.trolleyZ;
      const d = Math.hypot(dx, dz);
      if (d > 0.003) {
        // Proportional approach: full speed far away, gentle near the target (like feathering a button).
        const k = Math.min(1, d / 0.05 + 0.04) / d;
        core.controller.inputX = dx * k;
        core.controller.inputZ = dz * k;
      } else {
        core.controller.clearInput();
        if (Math.hypot(core.claw.trolleyVX, core.claw.trolleyVZ) < 0.01) {
          const calm = core.claw.swingSpeed() < 0.02;
          if (calm || waited >= (options.settleSwing ?? 0)) core.controller.requestGrab();
          else waited += FIXED_DT;
        }
      }
    }
    core.fixedStep();
    options.onStep?.(core);
  }
  for (const off of offs) off();
  core.controller.clearInput();
  if (!result) throw new Error(`round did not finish within ${options.maxSeconds ?? 40}s (phase ${m.phase})`);
  return {
    result,
    grabSeconds: core.time - (grabAt < 0 ? start : grabAt),
    totalSeconds: core.time - start,
    phases,
    awards,
    recoveries,
    slip,
    prizeAt,
  };
}

/** Runs the simulation for a while without any input (lets things settle). */
export function idle(core: GameCore, seconds: number): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) core.fixedStep();
}

export function comOf(toy: ToyBody): { x: number; y: number; z: number } {
  const c = toy.body.worldCom();
  return { x: c.x, y: c.y, z: c.z };
}

/** Toys whose centre the claw can reach, sorted by distance from (cx, cz). */
export function reachableToys(core: GameCore, margin = 0): ToyBody[] {
  return core.field
    .onField()
    .filter((t) => {
      const c = comOf(t);
      return c.x >= CLAW.minX + margin && c.x <= CLAW.maxX - margin && c.z >= CLAW.minZ + margin && c.z <= CLAW.maxZ - margin;
    })
    .sort((a, b) => {
      const ca = comOf(a), cb = comOf(b);
      return Math.hypot(ca.x - 0.08, ca.z + 0.4) - Math.hypot(cb.x - 0.08, cb.z + 0.4);
    });
}

export interface Anomaly {
  kind: 'nan' | 'escaped' | 'on_chute_wall' | 'claw_stuck' | 'award_outside_sensor';
  detail: string;
}

/** Sanity checks on the world state; returns every problem found. */
export function inspectWorld(core: GameCore): Anomaly[] {
  const out: Anomaly[] = [];
  const floorY = core.phys.binFloorY;
  for (const toy of core.phys.toys.values()) {
    const t = toy.body.translation();
    const r = toy.body.rotation();
    if (![t.x, t.y, t.z, r.x, r.y, r.z, r.w].every(Number.isFinite)) {
      out.push({ kind: 'nan', detail: `${toy.asset.id} has a non-finite pose` });
      continue;
    }
    const c = comOf(toy);
    const inCabinet = Math.abs(c.x) <= FIELD.halfWidth + 0.03 && c.z >= -FIELD.depth - 0.03 && c.z <= 0.03 && c.y <= FIELD.ceilingY + 0.02;
    const belowFloor = c.y < -0.02;
    if (!inCabinet || c.y < floorY - 0.08) out.push({ kind: 'escaped', detail: `${toy.asset.id} at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}` });
    else if (belowFloor) {
      const inBinVolume = c.x >= BIN.xMin - 0.03 && c.x <= BIN.xMax + 0.03 && c.z >= BIN.zMin - 0.03;
      if (!inBinVolume) out.push({ kind: 'escaped', detail: `${toy.asset.id} below the floor outside the bin` });
    }
  }
  const hub = core.claw.hub.translation();
  if (![hub.x, hub.y, hub.z].every(Number.isFinite)) out.push({ kind: 'nan', detail: 'claw hub has a non-finite pose' });
  return out;
}

/** Toys that came to rest balanced on top of the chute guard (neither in the field nor in the chute). */
export function toysOnChuteWall(core: GameCore): ToyBody[] {
  const out: ToyBody[] = [];
  for (const toy of core.phys.toys.values()) {
    if (toy.inBin) continue;
    const c = comOf(toy);
    const v = toy.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.05) continue;
    const nearWallX = Math.abs(c.x - CHUTE.xMax) < 0.05 && c.z > CHUTE.zMin - 0.05;
    const nearWallZ = Math.abs(c.z - CHUTE.zMin) < 0.05 && c.x < CHUTE.xMax + 0.05;
    const overHole = c.x < CHUTE.xMax && c.z > CHUTE.zMin;
    // Resting higher than a toy sitting on the floor could, right at the guard or above the hole.
    if ((nearWallX || nearWallZ || overHole) && c.y > 0.02 + toy.asset.comHeight * toy.scale + 0.06) out.push(toy);
  }
  return out;
}

export function insideChuteFootprint(x: number, z: number, margin = 0.02): boolean {
  return x > PRIZE_SENSOR.xMin - margin && x < PRIZE_SENSOR.xMax + margin && z > PRIZE_SENSOR.zMin - margin && z < PRIZE_SENSOR.zMax + margin;
}
