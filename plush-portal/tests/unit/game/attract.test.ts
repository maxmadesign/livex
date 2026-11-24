import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoPilot } from '../../../src/app/DemoPilot';
import { ATTRACT_TIMING, AttractDirector, IdleTimer } from '../../../src/game/attract';
import type { GameCore } from '../../../src/game/GameCore';
import { CLAW, FIXED_DT, PRIZE_SENSOR } from '../../../src/physics/fieldSpec';
import { comOf, makeCore, playRound, reachableToys } from './harness';

describe('idle timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('fires once after the limit without input, then starts over', () => {
    const idle = new IdleTimer();
    vi.advanceTimersByTime(59_000);
    expect(idle.idleSeconds()).toBeCloseTo(59, 5);
    expect(idle.due(60)).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(idle.due(60)).toBe(true);
    expect(idle.due(60)).toBe(false); // re-armed
    vi.advanceTimersByTime(60_000);
    expect(idle.due(60)).toBe(true);
  });

  it('any input restarts the count', () => {
    const idle = new IdleTimer();
    vi.advanceTimersByTime(50_000);
    idle.touch();
    vi.advanceTimersByTime(50_000);
    expect(idle.due(60)).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(idle.due(60)).toBe(true);
  });

  it('a running player round counts as activity until it ends', () => {
    const idle = new IdleTimer();
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(10_000);
      expect(idle.due(60, true)).toBe(false);
    }
    // The round ended: the full limit runs from now.
    vi.advanceTimersByTime(59_000);
    expect(idle.due(60, false)).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(idle.due(60, false)).toBe(true);
  });

  it('0 means never', () => {
    const idle = new IdleTimer();
    vi.advanceTimersByTime(3_600_000);
    expect(idle.due(0)).toBe(false);
    expect(idle.idleSeconds()).toBeCloseTo(3600, 5);
  });
});

describe('attract mode flow (real physics)', () => {
  const cores: GameCore[] = [];
  afterEach(() => {
    for (const c of cores.splice(0)) c.dispose();
  });
  async function core(): Promise<GameCore> {
    const c = await makeCore({ theme: 'sakura', seed: 7 });
    cores.push(c);
    return c;
  }
  /** Steps the simulation like the game does: flow per frame, pilot + physics per fixed step. */
  function run(c: GameCore, director: AttractDirector, pilot: DemoPilot, seconds: number, until?: () => boolean): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      if (c.machine.demo) pilot.update(c, FIXED_DT);
      c.fixedStep();
      if (director.update(FIXED_DT, { demoEnabled: true, firstDemo: false, restockPending: false }) === 'demoStarted') pilot.reset();
      if (until?.()) return;
    }
  }
  const belowFloor = (c: GameCore) => [...c.phys.toys.values()].filter((t) => comOf(t).y < PRIZE_SENSOR.awardComY);

  it('plays demo rounds by itself and a player takes over on the spot', { timeout: 120_000 }, async () => {
    const c = await core();
    const director = new AttractDirector(c);
    const pilot = new DemoPilot();
    expect(c.machine.phase).toBe('ATTRACT');
    expect(director.active).toBe(true);

    // The first demo round starts after the delay.
    run(c, director, pilot, ATTRACT_TIMING.demoDelay - 0.2);
    expect(c.machine.phase).toBe('ATTRACT');
    run(c, director, pilot, 0.4);
    expect(c.machine.demo).toBe(true);
    expect(c.machine.phase).toBe('READY');

    // Mid-demo (the claw is somewhere in its automatic sequence) a player presses the call to action.
    run(c, director, pilot, 30, () => c.machine.phase === 'LIFTING' || c.machine.phase === 'TRANSPORTING');
    expect(['LIFTING', 'TRANSPORTING']).toContain(c.machine.phase);
    const awards: unknown[] = [];
    c.machine.events.on('award', (a) => awards.push(a));
    const demoRound = c.machine.roundId;
    expect(director.leave()).toBe(true);
    expect(c.machine.phase).toBe('READY');
    expect(c.machine.demo).toBe(false);
    expect(c.machine.roundId).toBeGreaterThan(demoRound);
    expect(director.active).toBe(false);
    // Claw home, field complete and at rest, nothing in the exit, nothing awarded.
    expect(c.claw.trolleyX).toBeCloseTo(CLAW.homeX, 3);
    expect(c.claw.trolleyZ).toBeCloseTo(CLAW.homeZ, 3);
    expect(c.field.onField()).toHaveLength(18);
    expect(c.phys.toys.size).toBe(18);
    expect(belowFloor(c)).toEqual([]);
    expect(c.phys.maxToySpeed()).toBeLessThan(0.2);
    expect(awards).toEqual([]);
    // Not in attract mode any more: leaving again does nothing.
    expect(director.leave()).toBe(false);

    // The player round is a normal round that is ready to aim.
    const toy = reachableToys(c, 0.07)[0]!;
    const at = comOf(toy);
    const trace = playRound(c, at.x, at.z);
    expect(trace.result.demo).toBe(false);
    expect(['won', 'slipped', 'empty']).toContain(trace.result.outcome);
  });

  it('enters attract mode from a player round: between rounds, mid-round, and after a result', { timeout: 120_000 }, async () => {
    const c = await core();
    const director = new AttractDirector(c);
    const pilot = new DemoPilot();
    expect(director.enter()).toBe(false); // already there
    c.machine.start(false);
    expect(director.active).toBe(false);
    c.controller.inputX = 1;
    run(c, director, pilot, 0.3);
    expect(c.machine.phase).toBe('AIMING');
    expect(director.enter()).toBe(true);
    expect(c.machine.phase).toBe('ATTRACT');
    expect(c.controller.inputX).toBe(0);

    // A running round (claw descending) is abandoned without an award.
    expect(director.leave()).toBe(true);
    c.controller.requestGrab();
    run(c, director, pilot, 0.5);
    expect(c.machine.busy).toBe(true);
    let awarded = 0;
    c.machine.events.on('award', () => awarded++);
    expect(director.enter('idle_reset')).toBe(true);
    expect(c.machine.phase).toBe('ATTRACT');
    expect(c.machine.demo).toBe(false);
    run(c, director, pilot, 0.5);
    expect(awarded).toBe(0);

    // After a result.
    director.leave();
    const toy = reachableToys(c, 0.07)[0]!;
    const at = comOf(toy);
    playRound(c, at.x, at.z);
    expect(c.machine.phase).toBe('RESULT');
    expect(director.enter()).toBe(true);
    expect(c.machine.phase).toBe('ATTRACT');
  });

  it('a finished demo round goes back to attract mode after its result was shown', { timeout: 120_000 }, async () => {
    const c = await core();
    const director = new AttractDirector(c);
    const pilot = new DemoPilot();
    run(c, director, pilot, 40, () => c.machine.phase === 'RESULT');
    expect(c.machine.phase).toBe('RESULT');
    expect(c.machine.demo).toBe(true);
    run(c, director, pilot, ATTRACT_TIMING.demoResultHold + 0.1, () => c.machine.phase === 'ATTRACT');
    expect(c.machine.phase).toBe('ATTRACT');
    expect(director.active).toBe(true);
  });

  it('without the demo setting the machine waits in attract mode', async () => {
    const c = await core();
    const director = new AttractDirector(c);
    for (let i = 0; i < Math.round(10 / FIXED_DT); i++) director.update(FIXED_DT, { demoEnabled: false, firstDemo: false, restockPending: false });
    expect(c.machine.phase).toBe('ATTRACT');
    expect(director.attractTime).toBeGreaterThan(9.9);
  });
});
