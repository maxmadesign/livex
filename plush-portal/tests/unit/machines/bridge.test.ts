/**
 * TIPPY BRIDGE (docs/design/machines.md, sections 3.1 and 8.1; docs/machines/bridge.md): the
 * geometry, the box on its seeded start pose, wins by physics only through the existing prize
 * sensor, the box persisting between tries, stuck detection, the staff reset, the partial lift,
 * the wind-up before the claw goes home, progress, the two-step input and the debug impulse the
 * e2e spec uses. Real Rapier, through GameCore and the test harness.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoundPhase, RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import {
  BRIDGE_DEFAULTS,
  BRIDGE_LAYOUT,
  BridgeField,
  barCentres,
  bridgeGeometry,
  bridgeModule,
  bridgePit,
  bridgeProgress,
  bridgeState,
  boxPose,
  inOpening,
  restComY,
  restsOnBars,
  type BoxPose,
} from '../../../src/game/machines/bridge';
import { GENRES, resolveMachine } from '../../../src/game/machines/registry';
import type { BridgeParams, ResolvedMachine } from '../../../src/game/machines/types';
import { BIN_FOOTPRINT, REST_CEILING_Y, fixtureBounds, overOpening, validateGeometry } from '../../../src/physics/fieldGeometry';
import { CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import { RAPIER, type ToyBody } from '../../../src/physics/PhysicsWorld';
import { defaultSettings } from '../../../src/settings/spec';
import { idle, inspectWorld, makeCore, playRound } from '../game/harness';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

function bridge(over: Partial<BridgeParams> = {}): ResolvedMachine {
  const base = resolveMachine('bridge', undefined, { includeUnavailable: true });
  if (Object.keys(over).length === 0) return base;
  const params = { ...(base.params as BridgeParams), ...over };
  return { ...base, params, geometry: bridgeGeometry(params), controls: params.controls } as ResolvedMachine;
}

async function bridgeCore(seed = 7, over: Partial<BridgeParams> = {}): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed, machine: bridge(over) });
  cores.push(c);
  return c;
}

const P = BRIDGE_DEFAULTS;
const boxOf = (c: GameCore): ToyBody => {
  const b = bridgeState(c.phys).box;
  if (!b) throw new Error('no box');
  return b;
};
const poseDelta = (a: BoxPose, b: BoxPose) => ({
  move: Math.hypot(a.com[0] - b.com[0], a.com[1] - b.com[1], a.com[2] - b.com[2]),
  turnDeg: (2 * Math.acos(Math.min(1, Math.abs(a.rot[0] * b.rot[0] + a.rot[1] * b.rot[1] + a.rot[2] * b.rot[2] + a.rot[3] * b.rot[3]))) * 180) / Math.PI,
});
/** Starts the next player round (from ATTRACT or RESULT). */
function nextRound(c: GameCore): void {
  if (c.machine.phase === 'ATTRACT') c.machine.start(false);
  else if (c.machine.phase === 'RESULT') c.machine.next(false);
}
/** Runs the round machine until `phase` (or the cap). */
function runUntil(c: GameCore, done: () => boolean, seconds = 20): void {
  for (let i = 0; i < seconds / FIXED_DT && !done(); i++) c.fixedStep();
}
/** A try far away from the box: the claw drops at home and touches nothing on the bars. */
function emptyTry(c: GameCore): RoundResult {
  return playRound(c, 0.3, -0.6).result;
}

/* ------------------------------------------------------------ geometry */

describe('bridge geometry', () => {
  it('is valid, inside the prize bin footprint and below the travel clearance, for the defaults and the settings range', () => {
    for (const over of [{}, { gap: 0.13 }, { gap: 0.18 }, { controls: 'twoStep' as const }]) {
      const p = { ...P, ...over };
      const g = bridgeGeometry(p);
      expect(validateGeometry(g), JSON.stringify(over)).toEqual([]);
      expect(g.floor).toEqual({ kind: 'hole', hole: bridgePit(p) });
      expect(g.chuteGuard).toBe(false);
      for (const r of [g.opening, bridgePit(p)]) {
        expect(r.xMin).toBeGreaterThanOrEqual(BIN_FOOTPRINT.xMin);
        expect(r.xMax).toBeLessThanOrEqual(BIN_FOOTPRINT.xMax);
        expect(r.zMin).toBeGreaterThanOrEqual(BIN_FOOTPRINT.zMin);
        expect(r.zMax).toBeLessThanOrEqual(BIN_FOOTPRINT.zMax);
      }
      expect(g.fixtures.filter((f) => f.kind === 'bar')).toHaveLength(2);
      expect(g.fixtures.filter((f) => f.kind === 'fence')).toHaveLength(4);
      for (const f of g.fixtures) expect(fixtureBounds(f).max[1]).toBeLessThan(REST_CEILING_Y);
      // The inner gap between the bar surfaces is the parameter.
      const [l, r] = barCentres(p);
      expect(r - l - 2 * p.barRadius).toBeCloseTo(p.gap, 9);
      // The box resting on the bars stays below the travel clearance too.
      expect(restComY(p) + p.box[1] / 2).toBeLessThan(REST_CEILING_Y);
    }
    expect(bridgeGeometry(P).home).toEqual(BRIDGE_LAYOUT.home);
    expect(bridgeGeometry({ ...P, controls: 'twoStep' }).home).toEqual(BRIDGE_LAYOUT.twoStepHome);
  });

  it('is the registered genre (sweep gates passed, offered once it is drawn); its defaults agree with the settings defaults', () => {
    expect(GENRES.bridge).toBe(bridgeModule);
    const open = { includeUnavailable: true };
    expect(resolveMachine('bridge', undefined, open).def.id).toBe('bridge');
    expect(resolveMachine('bridge', defaultSettings().machines, open).params).toEqual(P);
    const s = defaultSettings().machines;
    expect({ ...P, ...bridgeModule.fromSettings(s) }).toEqual(P);
    expect(bridgeModule.session(P)).toEqual({ kind: 'open' });
    expect(bridgeModule.presentation).toBe('prize');
    for (const p of ['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING'] as const) expect(bridgeModule.awardPhases.has(p)).toBe(true);
    for (const p of ['ATTRACT', 'READY', 'AIMING', 'RESULT'] as const) expect(bridgeModule.awardPhases.has(p)).toBe(false);
    // Pure friction: the claw scale switches the grip assist off.
    const base = { ...defaultSettings().gameplay, aimTimeLimit: 0 } as unknown as Parameters<typeof bridgeModule.roundParams>[0];
    expect(bridgeModule.roundParams({ ...base, gripAssist: 1.4 }, P).gripAssist).toBe(0);
  });
});

/* ------------------------------------------------------------ the box on the bars */

describe('bridge box', () => {
  it('rests still on its seeded start pose for 5 s; the start pose depends on the seed and the reset count', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    expect(box.item?.kind).toBe('box');
    expect(box.item?.look).toBe('bridgeBox');
    expect(typeof box.item?.print).toBe('string');
    const p0 = boxPose(box);
    expect(restsOnBars(P, p0)).toBe(true);
    expect(Math.abs(p0.com[0] - P.centerX)).toBeLessThanOrEqual(P.startJitter + 0.002);
    expect(p0.com[1]).toBeCloseTo(restComY(P), 2);
    idle(c, 5);
    const d = poseDelta(p0, boxPose(box));
    expect(d.move).toBeLessThan(0.002);
    expect(d.turnDeg).toBeLessThan(1);
    const field = c.field as BridgeField;
    expect(field.startPose(0)).toEqual(field.startPose(0));
    expect(field.startPose(1)).not.toEqual(field.startPose(0));
    const other = await bridgeCore(8);
    expect((other.field as BridgeField).startPose(0)).not.toEqual(field.startPose(0));
  });

  it('persists exactly where physics left it between tries; a new player gets a fresh box', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    const before = boxPose(box);
    // Work the box's left end once.
    const r = playRound(c, before.com[0] - P.box[0] / 2 + 0.015, before.com[2] + 0.025, { settleSwing: 2.5 }).result;
    expect(['won', 'empty']).toContain(r.outcome);
    if (r.outcome === 'won') return; // (not with the tuned defaults: see the one-try sweep gate)
    const after = boxPose(box);
    nextRound(c);
    expect(c.machine.phase).toBe('READY');
    // Same body, same place: no refill, no teleport at the boundary.
    expect(boxOf(c)).toBe(box);
    expect(poseDelta(after, boxPose(box)).move).toBeLessThan(1e-6);
    emptyTry(c);
    expect(poseDelta(after, boxPose(box)).move).toBeLessThan(0.003);
    // Takeover: the start pose again (the next one in the seeded sequence), same print.
    const print = box.item!.print;
    c.field.resetForTakeover!();
    c.settle(1.5);
    const fresh = boxOf(c);
    expect(fresh.item!.print).toBe(print);
    expect(restsOnBars(P, boxPose(fresh))).toBe(true);
    expect(bridgeState(c.phys).tries).toBe(0);
  });
});

/* ------------------------------------------------------------ winning */

/** Puts the box on the bars, at rest: `shift` from the middle, turned by `yawDeg`, as if earlier tries had moved it there. */
function placeBox(c: GameCore, shift: number, yawDeg = 0): void {
  const box = boxOf(c);
  const p = boxPose(box);
  const h = (yawDeg * Math.PI) / 360;
  box.body.setTranslation({ x: P.centerX + shift, y: P.barY + P.barRadius + 0.0005, z: p.com[2] }, true);
  box.body.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }, true);
  box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  c.phys.snapPoses();
}

/**
 * The e2e recipe (docs/machines/bridge.md, "Debug impulses"): machineDebug.nudge(dx, dz, dy) is an
 * impulse at the box's centre. In READY, push it sideways (its far end drops off the far bar into
 * the gap: a wedge), then nudge it up, alternating with sideways pushes, until it has fallen; then
 * drop the claw: the fallen box is paid at that grab. Returns the nudges used.
 */
function nudgeUntilFallen(c: GameCore, box: ToyBody): number {
  const nudge = (dx: number, dz: number, dy: number) => box.body.applyImpulse({ x: dx, y: dy, z: dz }, true);
  nudge(0.2, 0, 0);
  idle(c, 1);
  let k = 0;
  for (; k < 12 && box.body.worldCom().y > 0; k++) {
    if (k % 2 === 0) nudge(0, 0, 1);
    else nudge(k % 4 === 1 ? -0.2 : 0.2, 0, 0);
    idle(c, 1);
  }
  return k + 1;
}

describe('bridge wins', () => {
  it('a box turned across the gap falls between the bars: exactly one award, through the prize sensor, by physics', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    const awards: unknown[] = [];
    c.machine.events.on('award', (a) => awards.push(a));
    let detected: { inOpening: boolean; inSensor: boolean; phase: RoundPhase } | null = null;
    c.controller.events.on('prizeDetected', (e) => {
      expect(e.toy).toBe(box);
      detected = { inOpening: inOpening(c.phys, box), inSensor: c.phys.sensorHits.has(box) || c.phys.isInPrizeSensor(box), phase: c.machine.phase };
    });
    nextRound(c);
    let turned = false;
    const trace = playRound(c, 0.3, -0.6, {
      onStep: (core) => {
        // While the claw descends far away, earlier tries have turned the box almost along the bars:
        // it now spans less than the gap.
        if (!turned && core.machine.phase === 'DESCENDING') {
          turned = true;
          placeBox(core, 0, 85);
          expect(bridgeProgress(P, boxPose(box)).turn).toBe(1);
        }
      },
    });
    expect(trace.result.outcome).toBe('won');
    expect(awards).toHaveLength(1);
    expect(detected).toEqual({ inOpening: true, inSensor: true, phase: expect.any(String) });
    expect(bridgeModule.awardPhases.has(detected!.phase)).toBe(true);
    expect(trace.result.targetToyId).toBe(box.id);
    expect(trace.result.targetTypeId).toBe(box.item!.print);
    expect(trace.result.prizeId).toBe(`test-${trace.result.roundId}`);
    expect(trace.result.machine).toMatchObject({ id: 'bridge', genre: 'bridge', items: [], progress: 1, stuck: false });
    expect(box.inBin).toBe(true);
    expect(box.body.worldCom().y).toBeLessThan(c.phys.opening.awardComY);
    // The next box arrives at the next READY, at rest on its start pose; nothing more is awarded.
    nextRound(c);
    const fresh = boxOf(c);
    expect(fresh).not.toBe(box);
    expect(fresh.inBin).toBe(false);
    expect(restsOnBars(P, boxPose(fresh))).toBe(true);
    expect(bridgeState(c.phys).boxes).toBe(2);
    idle(c, 2);
    expect(awards).toHaveLength(1);
  });

  it('nothing but the opening test awards: a box held below the floor beside the pit is not paid', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    let awards = 0;
    c.machine.events.on('award', () => awards++);
    nextRound(c);
    const r = playRound(c, 0.3, -0.6, {
      onStep: (core) => {
        if (core.machine.phase !== 'DESCENDING') return;
        // Below the floor top but away from the opening and its sensor.
        box.body.setTranslation({ x: 0.3, y: -0.2, z: -0.6 }, true);
        box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        box.body.setGravityScale(0, true);
      },
    }).result;
    expect(awards).toBe(0);
    expect(r.outcome).toBe('empty');
    expect(box.inBin).toBe(false);
  });

  it('a box that falls between tries is paid at the next grab, never outside the award phases', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    let awards = 0;
    c.machine.events.on('award', () => awards++);
    nextRound(c);
    // Turned through the gap while the player is still aiming (READY): no award yet.
    placeBox(c, 0, 85);
    idle(c, 2);
    expect(c.machine.phase).toBe('READY');
    expect(box.body.worldCom().y).toBeLessThan(c.phys.opening.awardComY);
    expect(awards).toBe(0);
    expect(bridgeState(c.phys).dropped).toBe(true);
    // The boundary keeps a player's dropped box for its award (no refill).
    expect(bridgeState(c.phys).box).toBe(box);
    const r = playRound(c, 0.3, -0.6).result;
    expect(awards).toBe(1);
    expect(r.outcome).toBe('won');
    expect(r.targetToyId).toBe(box.id);
  });

  it('the debug impulses the e2e uses (machineDebug.nudge in READY, then a grab) win exactly one box', { timeout: 120_000 }, async () => {
    for (const seed of [7, 11, 23]) {
      const c = await bridgeCore(seed);
      let awards = 0;
      c.machine.events.on('award', () => awards++);
      nextRound(c);
      // What Game's machineDebug.nudge does: an impulse on the box (the first item that is a box).
      const box = [...c.phys.toys.values()].find((t) => t.item?.kind === 'box' && !t.inBin)!;
      nudgeUntilFallen(c, box);
      expect(box.body.worldCom().y, `seed ${seed}`).toBeLessThan(0);
      expect(awards).toBe(0);
      expect(c.machine.phase).toBe('READY');
      expect(c.controller.requestGrab()).toBe(true);
      idle(c, 4);
      expect(awards, `seed ${seed}`).toBe(1);
      expect(box.inBin).toBe(true);
      expect(inspectWorld(c)).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------ one try */

describe('bridge try', () => {
  it('lifts by liftDelta only, releases in place and winds the cable up before the trolley heads home', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const p0 = boxPose(boxOf(c));
    const log: { phase: RoundPhase; rope: number; x: number; z: number }[] = [];
    c.machine.events.on('phase', (e) => log.push({ phase: e.phase, rope: c.claw.ropeLength, x: c.claw.trolleyX, z: c.claw.trolleyZ }));
    let settleAt: { x: number; z: number } | null = null;
    let movedLow = 0;
    const trace = playRound(c, p0.com[0] - P.box[0] / 2 + 0.015, p0.com[2] + 0.025, {
      settleSwing: 2.5,
      onStep: (core) => {
        if (core.machine.phase !== 'SETTLING') return;
        settleAt ??= { x: core.claw.trolleyX, z: core.claw.trolleyZ };
        const moved = Math.hypot(core.claw.trolleyX - settleAt.x, core.claw.trolleyZ - settleAt.z);
        if (core.claw.ropeLength > CLAW.ropeMin + 0.01 && moved > 0.002) movedLow++;
      },
    });
    const at = (p: RoundPhase) => log.find((e) => e.phase === p)!;
    const rules = c.controller.rules as unknown as { ropeAtLift: number };
    expect(rules.ropeAtLift).toBeGreaterThan(CLAW.ropeMin + 0.2);
    expect(at('TRANSPORTING').rope).toBeCloseTo(rules.ropeAtLift - P.liftDelta, 2);
    expect(Math.hypot(at('RELEASING').x - at('TRANSPORTING').x, at('RELEASING').z - at('TRANSPORTING').z)).toBeLessThan(0.002);
    expect(movedLow).toBe(0);
    // The try ends with the claw up and on its way home.
    expect(c.claw.ropeLength).toBeLessThan(CLAW.ropeMin + 0.01);
    expect(Math.hypot(c.claw.trolleyX - settleAt!.x, c.claw.trolleyZ - settleAt!.z)).toBeGreaterThan(0.05);
    expect(trace.result.slipReason).toBeNull();
    expect(trace.recoveries).toEqual([]);
  });

  it('200 random tries: only won / empty, finite poses, the box stays in the pit, every award in the sensor', { timeout: 300_000 }, async () => {
    const c = await bridgeCore(5);
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
    const problems: string[] = [];
    let awards = 0;
    c.machine.events.on('award', () => awards++);
    c.controller.events.on('prizeDetected', (e) => {
      if (!inOpening(c.phys, e.toy)) problems.push('award without the opening test');
    });
    const pit = bridgePit(P);
    let won = 0;
    for (let i = 0; i < 200; i++) {
      const x = pit.xMin + rand() * (pit.xMax - pit.xMin);
      const z = Math.min(CLAW.maxZ, pit.zMin + rand() * (pit.zMax - pit.zMin));
      const r = playRound(c, x, z).result;
      if (r.outcome !== 'won' && r.outcome !== 'empty') problems.push(`try ${i}: ${r.outcome}`);
      if (r.outcome === 'won') won++;
      for (const a of inspectWorld(c)) problems.push(`try ${i}: ${a.kind} ${a.detail}`);
      const box = bridgeState(c.phys).box;
      if (box && !box.inBin) {
        const com = box.body.worldCom();
        if (com.y > -0.02 && (com.x < pit.xMin - 0.02 || com.x > pit.xMax + 0.02 || com.z < pit.zMin - 0.02 || com.z > pit.zMax + 0.02)) problems.push(`try ${i}: box left the pit`);
      }
      if (r.machine?.stuck) {
        c.field.staffReset!();
        c.settle(1.5);
      }
    }
    expect(problems).toEqual([]);
    expect(awards).toBe(won);
  });
});

/* ------------------------------------------------------------ stuck and staff */

/**
 * A wedge as tries make it: the box walked 7 cm to the right; its left end leaves the left bar and
 * drops into the gap, and the box jams between the bars at a steep angle.
 */
function wedge(c: GameCore): void {
  placeBox(c, 0.07);
  c.settle(3);
}

describe('bridge stuck and staff reset', () => {
  it('a box untouched on the bars is never stuck', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    for (let i = 0; i < 4; i++) expect(emptyTry(c).machine?.stuck).toBe(false);
  });

  it('a jammed box that three tries do not move is stuck; Call staff restores the seeded pose and awards nothing', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    wedge(c);
    const jammed = boxPose(box);
    expect(box.inBin).toBe(false);
    expect(restsOnBars(P, jammed)).toBe(false);
    expect(bridgeProgress(P, jammed).tiltDeg).toBeGreaterThan(20);
    expect(c.field.stuck!()).toBe(false);
    // A jam is the usual state just before a drop: one or two tries that miss it are not "stuck" yet.
    expect(emptyTry(c).machine?.stuck).toBe(false);
    expect(emptyTry(c).machine?.stuck).toBe(false);
    const r = emptyTry(c);
    expect(poseDelta(jammed, boxPose(box)).move).toBeLessThan(0.005);
    expect(r.outcome).toBe('empty');
    expect(r.machine?.stuck).toBe(true);
    expect(c.field.stuck!()).toBe(true);
    expect(bridgeState(c.phys).stuckReason).toBe('stale');
    let awards = 0;
    c.machine.events.on('award', () => awards++);
    const field = c.field as BridgeField;
    const pose = field.startPose(bridgeState(c.phys).resets + 1);
    expect(c.field.staffReset!()).toBe(true);
    // Exactly the seeded start pose for this reset count, before it settles onto the bars.
    const t = box.body.translation();
    expect(t.x).toBeCloseTo(pose.pos[0], 6);
    expect(t.y).toBeCloseTo(pose.pos[1], 6);
    expect(t.z).toBeCloseTo(pose.pos[2], 6);
    expect(c.field.stuck!()).toBe(false);
    c.settle(1.5);
    expect(restsOnBars(P, boxPose(box))).toBe(true);
    expect(boxOf(c)).toBe(box);
    idle(c, 2);
    expect(awards).toBe(0);
    expect(bridgeState(c.phys).staffResets).toBe(1);
  });

  it('a box sunk deep between the bars is stuck after one try that does not move it', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const box = boxOf(c);
    // Standing on its side in the middle of the gap, pinned there (no pose on these slick bars holds a
    // box this deep, but the rule only reads the pose).
    const a = Math.PI / 2;
    box.body.setTranslation({ x: P.centerX, y: 0.03, z: P.centerZ }, true);
    box.body.setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }, true);
    box.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    c.phys.snapPoses();
    const sunk = boxPose(box);
    expect(sunk.com[1]).toBeLessThan(restComY(P) - 0.0425);
    const first = emptyTry(c);
    expect(poseDelta(sunk, boxPose(box)).move).toBeLessThan(0.005);
    // The first try only sees where the box is; one that leaves it unmoved flags it.
    expect(first.machine?.stuck).toBe(true);
    expect(bridgeState(c.phys).stuckReason).toBe('wedged');
    expect(bridgeProgress(P, boxPose(box)).progress).toBe(1);
  });

  it('attract mode calls staff by itself for a stuck box', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    wedge(c);
    for (let i = 0; i < 3; i++) emptyTry(c);
    expect(c.field.stuck!()).toBe(true);
    c.machine.toAttract();
    expect(c.field.stuck!()).toBe(false);
    expect(restsOnBars(P, boxPose(boxOf(c)))).toBe(true);
  });

  it('triesPerBox puts the box back on its start pose, never as a win', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7, { triesPerBox: 2 });
    const box = boxOf(c);
    let awards = 0;
    c.machine.events.on('award', () => awards++);
    placeBox(c, 0.03);
    c.settle(1.5);
    emptyTry(c);
    emptyTry(c);
    expect(Math.abs(boxPose(box).com[0] - P.centerX)).toBeGreaterThan(0.03);
    nextRound(c);
    expect(Math.abs(boxPose(box).com[0] - P.centerX)).toBeLessThan(P.startJitter + 0.003);
    expect(awards).toBe(0);
    expect(boxOf(c)).toBe(box);
  });
});

/* ------------------------------------------------------------ progress */

describe('bridge progress', () => {
  const at = (dx: number, yawDeg = 0, rollDeg = 0): BoxPose => {
    const y = (yawDeg * Math.PI) / 180 / 2;
    const r = (rollDeg * Math.PI) / 180 / 2;
    // yaw (about y) then roll (about z): q = qy · qz
    const qy = [0, Math.sin(y), 0, Math.cos(y)];
    const qz = [0, 0, Math.sin(r), Math.cos(r)];
    const q: [number, number, number, number] = [
      qy[3]! * qz[0]! + qy[0]! * qz[3]! + qy[1]! * qz[2]! - qy[2]! * qz[1]!,
      qy[3]! * qz[1]! - qy[0]! * qz[2]! + qy[1]! * qz[3]! + qy[2]! * qz[0]!,
      qy[3]! * qz[2]! + qy[0]! * qz[1]! - qy[1]! * qz[0]! + qy[2]! * qz[3]!,
      qy[3]! * qz[3]! - qy[0]! * qz[0]! - qy[1]! * qz[1]! - qy[2]! * qz[2]!,
    ];
    return { com: [P.centerX + dx, restComY(P), P.centerZ], rot: q };
  };

  it('is 0 centred and grows with shift, tilt and turn up to 1', () => {
    expect(bridgeProgress(P, at(0)).progress).toBe(0);
    const shifts = [0, 0.02, 0.04, 0.06, 0.08].map((d) => bridgeProgress(P, at(d)).progress);
    for (let i = 1; i < shifts.length; i++) expect(shifts[i]!).toBeGreaterThan(shifts[i - 1]!);
    expect(bridgeProgress(P, at(-0.04)).progress).toBeCloseTo(bridgeProgress(P, at(0.04)).progress, 9);
    expect(bridgeProgress(P, at(0.2)).progress).toBe(1);
    // A small turn first makes the box span more across the bars (W·sin yaw grows faster than L·cos
    // yaw shrinks), so turn reads 0 until the span drops below the box length, then grows to 1.
    expect(bridgeProgress(P, at(0, 20)).turn).toBe(0);
    const turns = [50, 60, 70, 80].map((d) => bridgeProgress(P, at(0, d)).turn);
    for (let i = 1; i < turns.length; i++) expect(turns[i]!).toBeGreaterThan(turns[i - 1]!);
    expect(bridgeProgress(P, at(0, 90)).turn).toBe(1);
    expect(bridgeProgress(P, at(0, 0, 12.5)).tilt).toBeCloseTo(0.5, 6);
    expect(bridgeProgress(P, at(0, 0, 40)).progress).toBe(1);
    // The progress of a try lands in the result (presentation and guide only).
  });

  it('a try reports progress, its gain and stuck in the result, and the outcome is never slipped', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7);
    const r = emptyTry(c);
    expect(r.outcome).toBe('empty');
    expect(r.slipReason).toBeNull();
    expect(r.machine).toMatchObject({ id: 'bridge', genre: 'bridge', items: [], stuck: false });
    expect(r.machine!.progress).toBeGreaterThanOrEqual(0);
    expect(r.machine!.progress).toBeLessThan(0.3);
    expect(Math.abs(r.machine!.progressGain!)).toBeLessThan(0.02);
    expect(r.targetToyId).toBe(boxOf(c).id);
    expect(r.targetTypeId).toBe(boxOf(c).item!.print);
  });
});

/* ------------------------------------------------------------ two-step controls */

describe('bridge two-step controls', () => {
  it('button 1 moves +x only, its release moves to stage z; button 2 moves -z only, its release drops the claw', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7, { controls: 'twoStep' });
    expect(c.controller.rules?.filterInput).toBeDefined();
    expect(c.claw.trolleyX).toBeCloseTo(BRIDGE_LAYOUT.twoStepHome.x, 6);
    expect(c.claw.trolleyZ).toBeCloseTo(BRIDGE_LAYOUT.twoStepHome.z, 6);
    const stages: ('x' | 'z' | null)[] = [];
    c.controllerEvents.on('axisStage', (e) => stages.push(e.stage));
    nextRound(c);
    const x0 = c.claw.trolleyX;
    const z0 = c.claw.trolleyZ;
    // Stage x: z input (even with x held) is ignored; the claw goes right only.
    c.controller.inputX = 1;
    c.controller.inputZ = -1;
    idle(c, 0.6);
    expect(c.machine.phase).toBe('AIMING');
    expect(c.claw.trolleyX).toBeGreaterThan(x0 + 0.1);
    expect(Math.abs(c.claw.trolleyZ - z0)).toBeLessThan(1e-6);
    // A -x input does nothing in stage x.
    c.controller.inputX = -1;
    c.controller.inputZ = 0;
    const x1 = c.claw.trolleyX;
    idle(c, 0.3);
    expect(c.claw.trolleyX).toBeGreaterThanOrEqual(x1 - 0.01);
    c.controller.clearInput();
    idle(c, 0.3);
    expect(stages).toEqual(['x', 'z']);
    // Stage z: x input is ignored; the claw goes back only.
    const x2 = c.claw.trolleyX;
    c.controller.inputX = 1;
    c.controller.inputZ = -1;
    idle(c, 0.5);
    expect(c.claw.trolleyZ).toBeLessThan(z0 - 0.1);
    expect(Math.abs(c.claw.trolleyX - x2)).toBeLessThan(0.02);
    expect(c.machine.phase).toBe('AIMING');
    c.controller.clearInput();
    idle(c, 0.05);
    expect(c.machine.phase).toBe('DESCENDING');
    expect(stages).toEqual(['x', 'z', null]);
    runUntil(c, () => c.machine.phase === 'RESULT');
    expect(c.machine.phase).toBe('RESULT');
    // The next try starts at stage x again.
    nextRound(c);
    c.controller.inputX = 1;
    idle(c, 0.1);
    expect(stages[stages.length - 1]).toBe('x');
  });

  it('demo rounds keep the joystick', { timeout: 60_000 }, async () => {
    const c = await bridgeCore(7, { controls: 'twoStep' });
    c.machine.start(true);
    const z0 = c.claw.trolleyZ;
    c.controller.inputX = 0;
    c.controller.inputZ = -1;
    idle(c, 0.5);
    expect(c.claw.trolleyZ).toBeLessThan(z0 - 0.05);
  });
});
