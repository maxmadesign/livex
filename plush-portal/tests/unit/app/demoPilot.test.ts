import { afterEach, describe, expect, it } from 'vitest';
import { DemoPilot } from '../../../src/app/DemoPilot';
import type { RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { makeCore, roundParams } from '../game/harness';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

/** Plays `count` demo rounds back to back, restocking between them like attract mode does. */
function demoRounds(core: GameCore, count: number): RoundResult[] {
  const pilot = new DemoPilot();
  const results: RoundResult[] = [];
  for (let i = 0; i < count; i++) {
    let result: RoundResult | null = null;
    const off = core.machine.events.on('result', (r) => (result = r));
    if (core.machine.phase === 'ATTRACT') core.machine.start(true);
    else core.machine.next(true);
    pilot.reset();
    for (let s = 0; s < 40 / FIXED_DT && !result; s++) {
      pilot.update(core, FIXED_DT);
      core.fixedStep();
    }
    off();
    if (!result) throw new Error(`demo round ${i + 1} did not finish`);
    results.push(result);
    core.field.clearBin();
    core.controller.forgetStrays();
    for (let guard = 0; core.field.missing() > 0 && guard < 40; guard++) {
      core.field.restockOne();
      for (let s = 0; s < 50; s++) core.fixedStep();
    }
  }
  return results;
}

describe('demo pilot', () => {
  it('plays like a careful player: wins most demo rounds on Skill, through the normal input path only', { timeout: 180_000 }, async () => {
    const core = await makeCore({ theme: 'sakura', seed: 23, difficulty: 'skill' });
    cores.push(core);
    const before = { ...core.controller.activeParams };
    const results = demoRounds(core, 6);
    expect(results.every((r) => r.demo)).toBe(true);
    const won = results.filter((r) => r.outcome === 'won').length;
    // Measured with tools in this round: 22 of 24 on Skill (sakura + ocean, seed 23); the old pilot won 15 of 24.
    expect(won).toBeGreaterThanOrEqual(4);
    // The pilot never touches the claw's parameters: a demo win is a real win.
    expect(core.controller.activeParams).toEqual(before);
    expect(core.controller.activeParams).toEqual({ ...roundParams('skill') });
  });
});
