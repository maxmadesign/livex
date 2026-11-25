import { afterEach, describe, expect, it } from 'vitest';
import { MachinePilot } from '../../../src/app/MachinePilot';
import type { RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { GENRES } from '../../../src/game/machines/registry';
import type { AimPlan } from '../../../src/game/machines/types';
import { CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import { makeCore } from '../game/harness';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

async function core(machine?: 'shelf' | 'rush' | 'bridge'): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed: 7, machine });
  cores.push(c);
  return c;
}

/** Runs one demo round with the pilot; returns when the grab was accepted (DESCENDING) or the result. */
function demo(c: GameCore, pilot: MachinePilot, until: 'grab' | 'result', maxSeconds = 40): { seconds: number; result: RoundResult | null; grabAt: { x: number; z: number } | null } {
  let result: RoundResult | null = null;
  let grabAt: { x: number; z: number } | null = null;
  const offs = [
    c.machine.events.on('result', (r) => (result = r)),
    c.machine.events.on('phase', (e) => {
      if (e.phase === 'DESCENDING') grabAt = { x: c.claw.trolleyX, z: c.claw.trolleyZ };
    }),
  ];
  if (c.machine.phase === 'ATTRACT') c.machine.start(true);
  else c.machine.next(true);
  pilot.reset();
  const start = c.time;
  for (let i = 0; i < maxSeconds / FIXED_DT; i++) {
    pilot.update(c, FIXED_DT);
    c.fixedStep();
    if (until === 'grab' ? grabAt : result) break;
  }
  for (const off of offs) off();
  return { seconds: c.time - start, result, grabAt };
}

describe('machine pilot (design 4.5)', () => {
  it('steers through the input path only and converges on the aim before it grabs', { timeout: 60_000 }, async () => {
    const c = await core();
    const before = { ...c.controller.activeParams };
    const plan: AimPlan = { x: 0.21, z: -0.33, patience: 2.5, targetToyId: null };
    const pilot = new MachinePilot(() => plan);
    const run = demo(c, pilot, 'grab');
    expect(run.grabAt).not.toBeNull();
    expect(Math.hypot(run.grabAt!.x - plan.x, run.grabAt!.z - plan.z)).toBeLessThan(0.006);
    expect(c.machine.demo).toBe(true);
    expect(c.controller.activeParams).toEqual(before);
  });

  it('clamps an aim outside the reach and still grabs; no plan (or a failing strategy) grabs after a short look', { timeout: 60_000 }, async () => {
    const c = await core();
    const far = new MachinePilot(() => ({ x: 2, z: 1, patience: 1, targetToyId: null }));
    const a = demo(c, far, 'grab');
    expect(a.grabAt!.x).toBeCloseTo(CLAW.maxX, 2);
    expect(a.grabAt!.z).toBeCloseTo(CLAW.maxZ, 2);
    demo(c, far, 'result');
    for (const aim of [() => null, () => { throw new Error('no aim'); }, () => ({ x: Number.NaN, z: 0, patience: 1, targetToyId: null })]) {
      const run = demo(c, new MachinePilot(aim), 'grab');
      expect(run.grabAt).not.toBeNull();
      expect(run.seconds).toBeLessThan(3);
      demo(c, new MachinePilot(aim), 'result');
    }
  });

  it('the patience timeout always grabs, even while the cable keeps swinging', { timeout: 60_000 }, async () => {
    const c = await core();
    // A claw that never calms down: only the patience can end the wait.
    c.claw.swingSpeed = () => 1;
    for (const patience of [0.4, 1.5]) {
      const pilot = new MachinePilot(() => ({ x: 0.1, z: -0.45, patience, targetToyId: null }));
      let arrivedAt = -1;
      let grabbedAt = -1;
      if (c.machine.phase === 'ATTRACT') c.machine.start(true);
      else c.machine.next(true);
      pilot.reset();
      for (let i = 0; i < 20 / FIXED_DT && grabbedAt < 0; i++) {
        pilot.update(c, FIXED_DT);
        c.fixedStep();
        const still = Math.hypot(c.claw.trolleyVX, c.claw.trolleyVZ) < 0.01 && Math.hypot(0.1 - c.claw.trolleyX, -0.45 - c.claw.trolleyZ) <= 0.004;
        if (still && arrivedAt < 0) arrivedAt = c.time;
        if (c.machine.phase === 'DESCENDING') grabbedAt = c.time;
      }
      expect(grabbedAt).toBeGreaterThan(0);
      expect(grabbedAt - arrivedAt).toBeGreaterThanOrEqual(patience - 0.05);
      expect(grabbedAt - arrivedAt).toBeLessThan(patience + 0.5);
      demo(c, pilot, 'result');
    }
  });

  it("plays each genre's demo rounds to the end with the genre's own aim", { timeout: 120_000 }, async () => {
    for (const id of ['bridge', 'shelf', 'rush'] as const) {
      const c = await core(id);
      const def = c.def;
      const pilot = new MachinePilot((cc, round) => def.module.aim!(cc, round, def.params));
      for (let i = 0; i < 3; i++) {
        const run = demo(c, pilot, 'result');
        expect(run.result, `${id} demo ${i}`).not.toBeNull();
        expect(run.result!.demo).toBe(true);
        expect(pilot.target, `${id} has a target`).not.toBeNull();
        c.field.clearBin();
      }
      expect(GENRES[def.def.genre].aim).toBeDefined();
    }
  });
});
