/**
 * SPARKLE RUSH with real physics (docs/design/machines.md, sections 3.3 and 8.1): the classic
 * cabinet, a pile of 44 gem and coin hulls that settles quickly, the always-to-the-chute transport,
 * the guard that keeps floor pieces out, the 75 s run on simulated time with its edge cases, no award
 * after the run ends, demo rounds that never make a run, the step-time budget and a clean switch
 * back to classic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { RUSH_DEFAULTS, RUSH_PIECES, RushRules, rushAim, rushModule } from '../../../src/game/machines/rush';
import { resolveMachine } from '../../../src/game/machines/registry';
import type { ResolvedMachine, RushParams, SessionSnapshot } from '../../../src/game/machines/types';
import type { ItemScore, PrizeAward } from '../../../src/game/RoundMachine';
import { isFreeSpot } from '../../../src/game/ToyField';
import { CLASSIC_FIELD, validateGeometry } from '../../../src/physics/fieldGeometry';
import { CHUTE, CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import type { ToyBody } from '../../../src/physics/PhysicsWorld';
import { idle, inspectWorld, makeCore, playRound, roundParams, themeAssets } from '../game/harness';
import { counts, poseHash } from './goldenScenario';

/** The rush machine straight from its module (whatever the registry says about it). */
function rushMachine(params: Partial<RushParams> = {}): ResolvedMachine {
  const p = { ...RUSH_DEFAULTS, ...params };
  return {
    def: { id: 'rush', genre: 'rush', order: 3, params: {}, available: false, unlockAfterWins: 5 },
    module: rushModule,
    params: p,
    geometry: rushModule.geometry(p),
    session: rushModule.session(p),
    controls: rushModule.controls(p),
  } as unknown as ResolvedMachine;
}

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function rush(seed = 7, params: Partial<RushParams> = {}): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed, machine: rushMachine(params) });
  cores.push(c);
  return c;
}
const com = (t: ToyBody) => {
  const c = t.body.worldCom();
  return { x: c.x, y: c.y, z: c.z };
};
function stepUntil(c: GameCore, done: () => boolean, seconds = 20): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !done(); i++) c.fixedStep();
}
/** The pilot's next try (aim straight at its target). */
function pilotTry(c: GameCore, i: number, onStep?: (core: GameCore) => void) {
  const plan = rushAim(c, i, RUSH_DEFAULTS) ?? { x: 0.1, z: -0.45, patience: 1, targetToyId: null };
  return playRound(c, plan.x, plan.z, { settleSwing: plan.patience, onStep });
}
/** A piece dropped straight into the chute (it falls through the sensor into the bin). */
function dropInChute(t: ToyBody): void {
  t.body.setTranslation({ x: -0.35, y: 0.05, z: -0.15 }, true);
  t.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
}

describe('rush machine', () => {
  it('is the classic cabinet as it is', () => {
    const g = rushModule.geometry(RUSH_DEFAULTS);
    expect(g).toBe(CLASSIC_FIELD);
    expect(validateGeometry(g)).toEqual([]);
    expect(rushModule.session(RUSH_DEFAULTS)).toEqual({ kind: 'timed', seconds: 75 });
    expect(rushModule.presentation).toBe('items');
    const base = roundParams('arcade');
    const p = rushModule.roundParams(base, RUSH_DEFAULTS);
    expect(p.moveSpeed).toBeCloseTo(base.moveSpeed * 1.2, 12);
    expect(p.liftSpeed).toBeCloseTo(base.liftSpeed * 1.25, 12);
    expect(p.ropeSwing).toBeLessThan(base.ropeSwing);
  });

  it('lays out 44 gem and coin hulls in one layer over the claw\'s reach, clear of the chute guard', { timeout: 60_000 }, async () => {
    const c = await rush(11);
    const pieces = c.field.onField();
    expect(pieces).toHaveLength(44);
    for (const k of RUSH_PIECES) {
      const of = pieces.filter((t) => t.item?.look === k.look);
      expect(of, k.look).toHaveLength(k.count);
      for (const t of of) expect(t.item!.value).toBe(k.value);
    }
    expect(pieces.filter((t) => t.item?.kind === 'gem').every((t) => t.colliders.length === 1)).toBe(true);
    for (const t of pieces) {
      const p = com(t);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(0.06);
      expect(Math.abs(p.x)).toBeLessThan(0.45);
      expect(p.z).toBeGreaterThan(-0.75);
      expect(p.z).toBeLessThan(-0.05);
      expect(isFreeSpot(p.x, p.z, 0.03), `${t.item!.look} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(true);
    }
    expect(inspectWorld(c)).toEqual([]);
    expect(c.field.missing()).toBe(0);
  });

  it('44 pieces settle in under 3 s, deterministically per seed', { timeout: 60_000 }, async () => {
    for (const seed of [11, 28, 45, 62]) {
      const c = await rush(seed);
      c.field.fill(themeAssets('sakura'), seed);
      const seconds = c.field.settle(3);
      expect(seconds, `seed ${seed}`).toBeLessThan(3);
      expect(c.phys.maxToySpeed()).toBeLessThan(0.02);
    }
    const a = await rush(21);
    const b = await rush(21);
    const d = await rush(22);
    expect(poseHash(a)).toBe(poseHash(b));
    expect(poseHash(d)).not.toBe(poseHash(a));
  });

  it('the pieces setting scales the pile; radiusScale scales the gems', { timeout: 60_000 }, async () => {
    const small = await rush(7, { pieces: 24 });
    expect(small.field.onField()).toHaveLength(24);
    expect(small.field.onField().filter((t) => t.item?.look === 'gemDiamond').length).toBeGreaterThanOrEqual(1);
    const big = await rush(7, { pieces: 48, radiusScale: 1.2 });
    expect(big.field.onField()).toHaveLength(48);
    const ruby = big.field.onField().find((t) => t.item?.look === 'gemRuby')!;
    expect(ruby.item!.size[0]).toBeCloseTo(2 * 0.038 * 1.2, 9);
  });
});

describe('rush tries', () => {
  it('always goes to the chute, even with nothing in the claw', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    // Clear a patch of floor and grab there: nothing to carry, still a trip to the chute.
    for (const t of c.field.onField()) if (Math.hypot(com(t).x - 0.25, com(t).z + 0.55) < 0.2) c.phys.removeToy(t);
    let at: { x: number; z: number } | null = null;
    const trace = playRound(c, 0.25, -0.55, {
      onStep: (core) => {
        if (!at && core.machine.phase === 'RELEASING') at = { x: core.claw.trolleyX, z: core.claw.trolleyZ };
      },
    });
    expect(trace.result.outcome).toBe('empty');
    expect(trace.result.machine!.items).toEqual([]);
    expect(at!.x).toBeCloseTo(CLAW.dropX, 2);
    expect(at!.z).toBeCloseTo(CLAW.dropZ, 2);
    expect(c.controller.rules).toBeInstanceOf(RushRules);
  });

  it('a well-aimed grab delivers at least one piece in most tries; every scored piece was carried', { timeout: 120_000 }, async () => {
    const got: number[] = [];
    for (const seed of [11, 45]) {
      const c = await rush(seed);
      for (let i = 0; i < 6; i++) {
        c.session.end('abandoned'); // single grabs, not a run
        got.push(pilotTry(c, i).result.machine!.items.length);
        c.field.clearBin();
      }
    }
    const scoring = got.filter((n) => n > 0).length / got.length;
    expect(scoring).toBeGreaterThanOrEqual(0.6);
  });

  it('the chute guard keeps floor pieces out: over 120 random grabs nothing scores without a carry', { timeout: 240_000 }, async () => {
    const c = await rush(23);
    const highest = new Map<string, number>();
    const track = (core: GameCore) => {
      for (const t of core.phys.toys.values()) highest.set(t.id, Math.max(highest.get(t.id) ?? -1, t.body.translation().y));
    };
    const uncarried: string[] = [];
    let scored = 0;
    c.controller.events.on('itemScored', (e) => {
      scored++;
      if ((highest.get(e.toy.id) ?? -1) < CHUTE.wallHeight) uncarried.push(`${e.item.look} (highest ${highest.get(e.toy.id)?.toFixed(3)})`);
    });
    // Deterministic pseudo-random aims over the whole reach.
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 120; i++) {
      if (c.session.snapshot().state === 'over' || c.field.onField().length < 12) c.session.newSession();
      track(c);
      const x = CLAW.minX + rnd() * (CLAW.maxX - CLAW.minX);
      const z = CLAW.minZ + rnd() * (CLAW.maxZ - CLAW.minZ);
      const trace = playRound(c, x, z, { onStep: track });
      expect(['won', 'empty']).toContain(trace.result.outcome);
      expect(trace.recoveries).toEqual([]);
      idle(c, 0.35);
      c.field.clearBin();
    }
    expect(uncarried).toEqual([]);
    expect(scored).toBeGreaterThan(10);
    expect(inspectWorld(c)).toEqual([]);
  });
});

describe('rush run (timed, simulated time)', () => {
  it('a 75 s run ends on time at a RESULT, with one prize when the raw value reaches rewardValue', { timeout: 180_000 }, async () => {
    for (const rewardValue of [50, 5000]) {
      const c = await rush(11, { rewardValue });
      const over: SessionSnapshot[] = [];
      const awards: PrizeAward[] = [];
      const steps: number[] = [];
      c.session.events.on('over', (s) => over.push(s));
      c.machine.events.on('award', (a) => awards.push(a));
      let last: RoundResult | null = null;
      for (let i = 0; i < 30 && over.length === 0; i++) {
        last = pilotTry(c, i, (core) => {
          if (core.machine.busy) steps.push(core.phys.lastStepMs);
        }).result;
        if (over.length === 0) idle(c, 0.35);
        c.field.clearBin();
      }
      expect(over).toHaveLength(1);
      const s = over[0]!;
      expect(s).toMatchObject({ state: 'over', reason: 'time', kind: 'timed', secondsLeft: 0, machineId: 'rush', lastRoundId: last!.roundId });
      expect(s.tries).toBeGreaterThanOrEqual(11);
      expect(s.tries).toBeLessThanOrEqual(16);
      expect(c.machine.phase).toBe('RESULT');
      expect(c.controller.inputLocked).toBe(true);
      if (rewardValue === 50) {
        expect(s.value).toBeGreaterThanOrEqual(50);
        expect(s.reward).toMatchObject({ prizeId: `test-${last!.roundId}-S`, roundId: last!.roundId });
        expect(awards.filter((a) => a.session)).toHaveLength(1);
      } else {
        expect(s.reward).toBeNull();
        expect(awards).toEqual([]);
      }
      // The physics step stays inside the budget while the claw works the pile (p95 ≤ 1.5 ms).
      steps.sort((a, b) => a - b);
      expect(steps[Math.floor(0.95 * (steps.length - 1))]!).toBeLessThanOrEqual(1.5);
    }
  });

  it('no award after the run ends: late pieces change nothing, no second prize, no grab', { timeout: 120_000 }, async () => {
    const c = await rush(7, { rewardValue: 5 });
    const awards: PrizeAward[] = [];
    c.machine.events.on('award', (a) => awards.push(a));
    pilotTry(c, 0);
    c.machine.next(false);
    c.session.setSecondsLeft(0.05);
    idle(c, 0.2);
    const s = c.session.snapshot();
    expect(s).toMatchObject({ state: 'over', reason: 'time' });
    expect(c.machine.phase).toBe('READY');
    const prizes = awards.length;
    // A piece that falls in now is not the run's (the round machine may score it for the round, the run is closed).
    dropInChute(c.field.onField()[0]!);
    idle(c, 1);
    expect(c.session.snapshot()).toMatchObject({ state: 'over', items: s.items, value: s.value, reward: s.reward });
    expect(awards).toHaveLength(prizes);
    expect(c.controller.requestGrab()).toBe(false);
    c.controller.inputX = 1;
    idle(c, 0.5);
    expect(c.machine.phase).toBe('READY');
    expect(c.session.snapshot().reward).toEqual(s.reward);
    expect(awards).toHaveLength(prizes);
  });

  it('time up while aiming drops the claw where it is; that try counts and the run ends at its RESULT', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    c.machine.start(false);
    c.controller.inputX = 0.4;
    stepUntil(c, () => c.machine.phase === 'AIMING', 1);
    c.session.setSecondsLeft(0.1);
    stepUntil(c, () => c.machine.phase === 'DESCENDING', 1);
    expect(c.machine.phase).toBe('DESCENDING');
    expect(c.session.snapshot().secondsLeft).toBe(0);
    c.controller.clearInput();
    stepUntil(c, () => c.machine.phase === 'RESULT');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1 });
  });

  it('time up between tries ends the run without another try', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    pilotTry(c, 0);
    c.machine.next(false);
    c.session.setSecondsLeft(0.02);
    idle(c, 0.1);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1 });
    expect(c.machine.phase).toBe('READY');
  });

  it('time up during a busy phase: the last grab completes and its pieces count', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    let done = false;
    const piece = c.field.onField().find((t) => t.item?.look === 'gemDiamond')!;
    const trace = playRound(c, 0.2, -0.5, {
      onStep: (core) => {
        if (done || core.machine.phase !== 'LIFTING') return;
        done = true;
        core.session.setSecondsLeft(0.02);
        dropInChute(piece);
      },
    });
    expect(trace.result.machine!.items.map((i) => i.toyId)).toContain(piece.id);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1 });
    expect(over[0]!.value).toBeGreaterThanOrEqual(150);
  });

  // Known defect in src/game/machines/session.ts (WS-A): when the clock runs out while the machine
  // sits in RESULT (Game's 0.35 s auto-advance hold), PlaySession.preStep marks the run expired but
  // does not end it, so the player gets one more full try. The fix is one branch in preStep: end the
  // run in RESULT as in READY. This test flips to passing once it lands (then drop `.fails`).
  it('time up during the RESULT hold ends the run (no extra try)', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    pilotTry(c, 0);
    expect(c.machine.phase).toBe('RESULT');
    c.session.setSecondsLeft(0.1);
    idle(c, 0.35);
    expect(over).toHaveLength(1);
  });

  it('a demo round never starts a run (nothing to rank); its pieces are marked demo', { timeout: 60_000 }, async () => {
    const c = await rush(7);
    const items: ItemScore[] = [];
    const started: SessionSnapshot[] = [];
    c.machine.events.on('item', (e) => items.push(e));
    c.session.events.on('started', (s) => started.push(s));
    const piece = c.field.onField()[0]!;
    playRound(c, 0.2, -0.5, {
      demo: true,
      onStep: (core) => {
        if (core.machine.phase === 'DESCENDING' && !piece.inBin && com(piece).y > 0) dropInChute(piece);
      },
    });
    expect(started).toEqual([]);
    expect(c.session.snapshot()).toMatchObject({ state: 'idle', tries: 0, timerStarted: false });
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((e) => e.demo)).toBe(true);
  });
});

describe('machine switch', () => {
  it('classic → rush → classic: classic is a fresh classic again; ids never repeat', { timeout: 120_000 }, async () => {
    const fresh = await makeCore({ theme: 'sakura', seed: 7 });
    cores.push(fresh);
    const c = await makeCore({ theme: 'sakura', seed: 7 });
    cores.push(c);
    const field = { count: 18, scale: 0.92, density: 0.2, massScale: 1, seed: 7 };
    c.setMachine(rushMachine(), { assets: themeAssets('sakura'), seed: 7, params: roundParams('arcade'), field });
    expect(c.def.def.id).toBe('rush');
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e2-item-'))).toBe(true);
    expect(c.field.onField()).toHaveLength(44);
    pilotTry(c, 0);
    c.machine.toAttract();
    c.setMachine(resolveMachine('classic'), { assets: themeAssets('sakura'), seed: 7, params: roundParams('arcade'), field });
    expect(poseHash(c)).toBe(poseHash(fresh));
    expect(counts(c)).toEqual(counts(fresh));
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e3-toy-'))).toBe(true);
    expect(c.controller.rules).toBeNull();
  });
});
