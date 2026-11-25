/**
 * The RoundController's rules seam (docs/design/machines.md, section 2.3): with rules the machine
 * decides the lift, the transport, the settle and the awards; without rules (classic) the
 * controller runs today's code, which classicGolden.test.ts holds bit for bit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoundPhase, RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import type { TryContext } from '../../../src/game/machines/types';
import { CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import { idle, makeCore, playRound } from '../game/harness';
import { ProbeRules, probeMachine, type ProbeOptions } from './probeGenre';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function probeCore(o: ProbeOptions = {}): Promise<{ core: GameCore; rules: () => ProbeRules }> {
  const created: ProbeRules[] = [];
  const core = await makeCore({ theme: 'sakura', seed: 7, machine: probeMachine({ ...o, created }) });
  cores.push(core);
  return { core, rules: () => created[created.length - 1]! };
}

/** Phase changes with the trolley position and rope length at that moment. */
function watch(core: GameCore) {
  const log: { phase: RoundPhase; t: number; x: number; z: number; rope: number }[] = [];
  core.machine.events.on('phase', (e) => log.push({ phase: e.phase, t: core.time, x: core.claw.trolleyX, z: core.claw.trolleyZ, rope: core.claw.ropeLength }));
  return log;
}

describe('RoundController with TryRules', () => {
  it('classic has no rules; a machine with rules uses its own', async () => {
    const classic = await makeCore({ theme: 'sakura', seed: 7 });
    cores.push(classic);
    expect(classic.controller.rules).toBeNull();
    const { core, rules } = await probeCore();
    expect(core.controller.rules).toBe(rules());
    expect(core.controller.opening).toBe(core.def.geometry.opening);
    // The rules start where the machine's home is.
    expect(core.claw.trolleyX).toBeCloseTo(0.2, 6);
    expect(core.claw.trolleyZ).toBeCloseTo(-0.5, 6);
  });

  it('sees postStep in every phase but ATTRACT; partial lift and in-place transport go straight to RELEASING', { timeout: 60_000 }, async () => {
    const { core, rules } = await probeCore();
    idle(core, 1); // attract mode: never reported to the rules
    expect(rules().seenPhases).toEqual([]);
    const log = watch(core);
    core.machine.start(false);
    idle(core, 0.2); // READY without input
    const trace = playRound(core, 0.1, -0.6);
    idle(core, 0.2);
    const r = rules();
    expect(r.seenPhases).not.toContain('ATTRACT');
    for (const p of ['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING', 'RESULT'] as const) expect(r.seenPhases, p).toContain(p);
    expect(r.tries).toBe(1);
    const at = (p: RoundPhase) => log.find((e) => e.phase === p)!;
    // Partial lift: the cable winds up by the lift delta only.
    expect(r.ropeAtLift).toBeGreaterThan(CLAW.ropeMin + 0.2);
    expect(at('TRANSPORTING').rope).toBeCloseTo(r.ropeAtLift - 0.08, 2);
    // In place: the trolley does not travel, and the release follows almost at once.
    expect(Math.hypot(at('RELEASING').x - at('TRANSPORTING').x, at('RELEASING').z - at('TRANSPORTING').z)).toBeLessThan(0.002);
    expect(at('RELEASING').t - at('TRANSPORTING').t).toBeLessThan(0.1);
    expect(trace.result.outcome).toBe('empty');
    expect(trace.result.machine).toEqual({ id: 'probe', genre: 'probe', items: [], progress: null, progressGain: null, stuck: false });
    expect(trace.result.slipReason).toBeNull();
  });

  it('beginSettling winds the cable up before the trolley heads home', { timeout: 60_000 }, async () => {
    const { core } = await probeCore();
    let settleAt: { x: number; z: number } | null = null;
    let movedLow = 0;
    playRound(core, 0.1, -0.6, {
      onStep: (c) => {
        if (c.machine.phase !== 'SETTLING') return;
        settleAt ??= { x: c.claw.trolleyX, z: c.claw.trolleyZ };
        const moved = Math.hypot(c.claw.trolleyX - settleAt.x, c.claw.trolleyZ - settleAt.z);
        if (c.claw.ropeLength > CLAW.ropeMin + 0.01 && moved > 0.002) movedLow++;
      },
    });
    expect(settleAt).not.toBeNull();
    expect(movedLow).toBe(0);
    // And the try still ended with the claw on its way home.
    expect(Math.hypot(core.claw.trolleyX - settleAt!.x, core.claw.trolleyZ - settleAt!.z)).toBeGreaterThan(0.05);
  });

  it('awards through the rules: a box pushed into the pit is the try\'s one prize', { timeout: 60_000 }, async () => {
    const { core } = await probeCore();
    const box = core.field.onField().find((t) => t.item?.kind === 'box')!;
    let prizes = 0;
    core.controller.events.on('prizeDetected', (e) => {
      prizes++;
      expect(e.toy).toBe(box);
    });
    let pushed = false;
    const trace = playRound(core, 0.1, -0.6, {
      onStep: (c) => {
        // While the claw descends elsewhere the box is tipped onto its side over the strip next to
        // the left bar: physics drops it into the pit, the rules award it.
        if (!pushed && c.machine.phase === 'DESCENDING') {
          pushed = true;
          box.body.setTranslation({ x: -0.31, y: 0.15, z: -0.22 }, true);
          box.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
          box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      },
    });
    expect(trace.result.outcome).toBe('won');
    expect(trace.awards).toBe(1);
    expect(prizes).toBe(1);
    expect(trace.result.targetToyId).toBe(box.id);
    expect(trace.result.targetTypeId).toBe(box.item!.print);
    expect(trace.result.prizeId).toBe(`test-${trace.result.roundId}`);
    expect(box.inBin).toBe(true);
    // The next boundary places a fresh box at rest on the bars.
    core.machine.next(false);
    const fresh = core.field.onField().find((t) => t.item?.kind === 'box');
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(box);
  });

  it('resultExtras can not change the round\'s identity', { timeout: 60_000 }, async () => {
    const { core, rules } = await probeCore();
    const r = rules();
    const original = r.resultExtras.bind(r);
    r.resultExtras = (ctx: TryContext, base: RoundResult) => ({ ...original(ctx, base), roundId: 999, demo: true, themeId: 'gpu', prizeId: 'forged' });
    const trace = playRound(core, 0.1, -0.6);
    expect(trace.result.roundId).toBe(core.machine.roundId);
    expect(trace.result.demo).toBe(false);
    expect(trace.result.themeId).toBe('sakura');
    expect(trace.result.prizeId).toBeNull();
  });

  it('inputLocked holds the claw and refuses the grab', { timeout: 60_000 }, async () => {
    const { core } = await probeCore();
    core.machine.start(false);
    core.controller.inputLocked = true;
    const x0 = core.claw.trolleyX;
    core.controller.inputX = 1;
    expect(core.controller.requestGrab()).toBe(false);
    idle(core, 1);
    expect(core.machine.phase).toBe('READY');
    expect(core.claw.trolleyX).toBeCloseTo(x0, 6);
    core.controller.inputLocked = false;
    idle(core, 0.3);
    expect(core.machine.phase).toBe('AIMING');
    expect(core.claw.trolleyX).toBeGreaterThan(x0 + 0.01);
  });

  it('filterInput maps the input one axis at a time, queues the grab and reports the live stage', { timeout: 60_000 }, async () => {
    const { core, rules } = await probeCore();
    const r = rules();
    // A two-step mapping: +x while "button 1" (input x > 0) is held, then -z while "button 2" (z < 0) is held.
    let stage: 'x' | 'z' | null = 'x';
    let pressed = false;
    r.filterInput = (_ctx, x, z) => {
      if (stage === 'x') {
        if (x > 0) pressed = true;
        else if (pressed) {
          stage = 'z';
          pressed = false;
        }
        return { x: Math.max(0, x), z: 0, grab: false, stage };
      }
      if (stage === 'z') {
        if (z < 0) pressed = true;
        else if (pressed) {
          stage = null;
          return { x: 0, z: 0, grab: true, stage };
        }
        return { x: 0, z: Math.min(0, z), grab: false, stage };
      }
      return { x: 0, z: 0, grab: false, stage };
    };
    const stages: (string | null)[] = [];
    core.controller.events.on('axisStage', (e) => stages.push(e.stage));
    core.machine.start(false);
    const start = { x: core.claw.trolleyX, z: core.claw.trolleyZ };
    const hold = (x: number, z: number, seconds: number) => {
      core.controller.inputX = x;
      core.controller.inputZ = z;
      for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) core.fixedStep();
    };
    hold(-1, 1, 0.3); // a diagonal on stage x: only +x counts (here nothing: x < 0)
    expect(core.claw.trolleyX).toBeCloseTo(start.x, 3);
    hold(1, 1, 0.3); // button 1: +x only
    const afterX = { x: core.claw.trolleyX, z: core.claw.trolleyZ };
    expect(afterX.x).toBeGreaterThan(start.x + 0.02);
    expect(afterX.z).toBeCloseTo(start.z, 3);
    hold(0, 0, 0.5); // released: stage z
    const beforeZ = { x: core.claw.trolleyX, z: core.claw.trolleyZ };
    hold(1, -1, 0.3); // button 2: -z only
    expect(core.claw.trolleyZ).toBeLessThan(beforeZ.z - 0.02);
    expect(core.claw.trolleyX).toBeCloseTo(beforeZ.x, 3);
    hold(0, 0, 0.2); // released: the claw drops
    expect(stages).toEqual(['x', 'z', null]);
    expect(core.machine.phase).toBe('DESCENDING');
  });
});
