/**
 * One GameCore for the page's lifetime, a rebuildable physics stack behind it (docs/design/
 * machines.md, sections 2.4 and 2.8): classic after classic → another machine → classic replays the
 * golden trace; round ids keep counting, toy ids never repeat, listeners survive the switch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameCore } from '../../../src/game/GameCore';
import { resolveMachine } from '../../../src/game/machines/registry';
import { CLASSIC_FIELD } from '../../../src/physics/fieldGeometry';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { idle, inspectWorld, makeCore, playRound, roundParams, themeAssets } from '../game/harness';
import { GOLDEN_CASES, beforeDemos, counts, poseHash, recordGolden, type GoldenTrace } from './goldenScenario';
import { probeMachine } from './probeGenre';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, '__golden__', 'classic.json'), 'utf8')) as { traces: GoldenTrace[] };

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function core(theme: (typeof GOLDEN_CASES)[number]['theme'], seed: number): Promise<GameCore> {
  const c = await makeCore({ theme, seed });
  cores.push(c);
  return c;
}

/** Listener counts of an emitter (white-box: the emitter keeps a Set per event). */
function listenerCounts(emitter: unknown): Record<string, number> {
  const map = (emitter as { listeners: Map<string, Set<unknown>> }).listeners;
  return Object.fromEntries([...map.entries()].filter(([, v]) => v.size > 0).map(([k, v]) => [k, v.size]));
}

function switchTo(c: GameCore, machine: ReturnType<typeof resolveMachine>, theme: (typeof GOLDEN_CASES)[number]['theme'], seed: number): void {
  c.setMachine(machine, { assets: themeAssets(theme), seed, params: roundParams('arcade'), field: { count: 18, scale: 0.92, density: 0.2, massScale: 1, seed } });
}

describe('machine switch: one simulation identity, a fresh physics stack', () => {
  for (const g of GOLDEN_CASES) {
    it(`${g.theme} seed ${g.seed}: classic → probe machine → classic replays the golden trace`, { timeout: 120_000 }, async () => {
      const expected = golden.traces.find((t) => t.theme === g.theme && t.seed === g.seed)!;
      const c = await core(g.theme, g.seed);
      const fresh = { hash: poseHash(c), counts: counts(c) };
      expect(fresh.hash).toBe(expected.fill);

      // Away to a machine with its own floor, fixtures and items, and play a try there.
      switchTo(c, probeMachine(), g.theme, g.seed);
      expect(c.phys.field).not.toBe(CLASSIC_FIELD);
      expect(c.phys.world.bodies.len()).toBeGreaterThan(fresh.counts.bodies - 18);
      c.machine.start(false);
      playRound(c, -0.2, -0.22);
      idle(c, 0.5);
      expect(c.machine.phase).toBe('RESULT');
      // Back to classic from attract (the idle reset's path): round ids do not move in attract mode.
      c.machine.toAttract();
      switchTo(c, resolveMachine('classic'), g.theme, g.seed);
      expect(c.def.def.id).toBe('classic');
      expect(c.phys.field).toBe(CLASSIC_FIELD);
      expect(c.controller.rules).toBeNull();
      expect(poseHash(c)).toBe(fresh.hash);
      expect(counts(c)).toEqual(fresh.counts);

      const awardsBefore = c.machine.roundId;
      const trace = recordGolden(c, g);
      // Round and prize ids keep counting by design; the physics is the fixture's, bit for bit: the
      // fill, three player rounds with their restocks and every pose hash up to the first demo round.
      expect(beforeDemos(trace)).toEqual(beforeDemos(expected));
      // From there the demo pilot decides. Its variety term reads toy id lengths and round ids, which
      // a switch changes (design V13), so its picks may differ; attract mode must still run cleanly.
      const demos = trace.results.filter((r) => r.demo);
      expect(demos.length).toBeGreaterThanOrEqual(1);
      expect(trace.timeline.filter((l) => l.endsWith('ATTRACT>READY demo'))).toHaveLength(2);
      expect(trace.timeline.some((l) => l.includes('abort player_took_over'))).toBe(true);
      expect(trace.awards.filter((a) => !a.demo && a.roundId > awardsBefore + 3)).toEqual([]);
      expect(trace.end.toys).toBe(18);
      expect(inspectWorld(c)).toEqual([]);
      expect(c.machine.phase).toBe('READY');
      expect(c.machine.demo).toBe(false);
    });
  }

  it('round ids keep counting across a switch, toy ids never repeat, listeners survive', { timeout: 120_000 }, async () => {
    const c = await core('sakura', 7);
    const machineListeners = listenerCounts(c.machine.events);
    const controllerListeners = listenerCounts(c.controllerEvents);
    const seenIds = new Set([...c.phys.toys.keys()]);
    const results: number[] = [];
    c.machine.events.on('result', (r) => results.push(r.roundId));
    let phases = 0;
    c.machine.events.on('phase', () => phases++);
    let touches = 0;
    c.controller.events.on('clawTouch', () => touches++);

    c.machine.start(false);
    playRound(c, 0.003, -0.402);
    const first = c.machine.roundId;
    // Switch at the RESULT boundary: the round restarts on the new machine with a new id.
    switchTo(c, probeMachine(), 'sakura', 7);
    expect(c.machine.phase).toBe('READY');
    expect(c.machine.roundId).toBe(first + 1);
    for (const id of c.phys.toys.keys()) {
      expect(seenIds.has(id), id).toBe(false);
      seenIds.add(id);
    }
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e2-'))).toBe(true);
    playRound(c, -0.2, -0.22);
    switchTo(c, resolveMachine('classic'), 'sakura', 7);
    for (const id of c.phys.toys.keys()) expect(seenIds.has(id), id).toBe(false);
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e3-toy-'))).toBe(true);
    playRound(c, 0.003, -0.402);
    expect(results).toEqual([first, first + 1, first + 2]);
    expect(new Set(results).size).toBe(results.length);
    // The listeners bound once to the core (Game.bindCore, the e2e capture) still hear everything.
    expect(phases).toBeGreaterThan(10);
    expect(touches).toBeGreaterThanOrEqual(2);
    // Nothing was added to the core's own emitters by the switches (the test's three listeners aside).
    const after = listenerCounts(c.machine.events);
    expect(after).toEqual({ ...machineListeners, result: (machineListeners.result ?? 0) + 1, phase: (machineListeners.phase ?? 0) + 1 });
    expect(listenerCounts(c.controllerEvents)).toEqual({ ...controllerListeners, clawTouch: (controllerListeners.clawTouch ?? 0) + 1 });
  });

  it('refuses to switch in the middle of a try', { timeout: 60_000 }, async () => {
    const c = await core('sakura', 7);
    c.machine.start(false);
    c.controller.requestGrab();
    for (let i = 0; i < 30; i++) c.fixedStep();
    expect(c.machine.phase).toBe('DESCENDING');
    expect(() => switchTo(c, probeMachine(), 'sakura', 7)).toThrow(/not at a round boundary/);
    expect(c.def.def.id).toBe('classic');
    // The machine keeps playing normally.
    for (let i = 0; i < Math.round(15 / FIXED_DT) && c.machine.phase !== 'RESULT'; i++) c.fixedStep();
    expect(c.machine.phase).toBe('RESULT');
  });

  it('keeps the bin depth and toy friction of the running machine', { timeout: 60_000 }, async () => {
    const c = await core('sakura', 7);
    c.phys.setBinFloor(-0.9);
    c.phys.setToyFriction(0.8);
    switchTo(c, probeMachine(), 'sakura', 7);
    expect(c.phys.binFloorY).toBeCloseTo(-0.9, 9);
    expect(c.phys.toyFriction).toBe(0.8);
    switchTo(c, resolveMachine('classic'), 'sakura', 7);
    expect(c.phys.binFloorY).toBeCloseTo(-0.9, 9);
    expect(c.phys.toyFriction).toBe(0.8);
  });

  it('the old stack is gone: its world is freed and the claw is new', { timeout: 60_000 }, async () => {
    const c = await core('sakura', 7);
    const oldClaw = c.claw;
    const oldPhys = c.phys;
    const oldController = c.controller;
    switchTo(c, probeMachine(), 'sakura', 7);
    expect(c.claw).not.toBe(oldClaw);
    expect(c.phys).not.toBe(oldPhys);
    expect(c.controller).not.toBe(oldController);
    expect(oldPhys.toys.size).toBe(0);
    // The probe's home differs from classic: the claw starts there.
    expect(c.claw.trolleyX).toBeCloseTo(0.2, 6);
    expect(c.claw.trolleyZ).toBeCloseTo(-0.5, 6);
  });
});
