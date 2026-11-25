/** PlaySession (docs/design/machines.md, section 2.6): open, tries and timed sessions above the rounds. */
import { afterEach, describe, expect, it } from 'vitest';
import type { GameCore } from '../../../src/game/GameCore';
import type { SessionRule, SessionSnapshot } from '../../../src/game/machines/types';
import type { PrizeAward } from '../../../src/game/RoundMachine';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import type { ToyBody } from '../../../src/physics/PhysicsWorld';
import { idle, makeCore, playRound } from '../game/harness';
import { probeMachine } from './probeGenre';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function core(session?: SessionRule): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed: 7, machine: session ? probeMachine({ session }) : undefined });
  cores.push(c);
  return c;
}
/** Steps until `done` or the cap (simulated seconds). */
function stepUntil(c: GameCore, done: () => boolean, seconds = 20): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !done(); i++) c.fixedStep();
}
/** Drops a gem of the probe field into the pit, so the try scores an item. */
function dropGem(c: GameCore): ToyBody {
  const gem = c.field.onField().find((t) => t.item?.kind === 'gem')!;
  gem.body.setTranslation({ x: -0.36, y: 0.05, z: -0.3 }, true);
  gem.body.setLinvel({ x: 0, y: -0.5, z: 0 }, true);
  return gem;
}

describe('open session (classic)', () => {
  it('starts at the first player READY, counts player grabs only, ends without a result in attract mode', { timeout: 60_000 }, async () => {
    const c = await core();
    const started: SessionSnapshot[] = [];
    const over: SessionSnapshot[] = [];
    c.session.events.on('started', (s) => started.push(s));
    c.session.events.on('over', (s) => over.push(s));
    expect(c.session.snapshot()).toMatchObject({ kind: 'open', state: 'idle', machineId: 'classic', triesTotal: null, secondsLeft: null });
    // A demo round never starts a session.
    playRound(c, 0.003, -0.402, { demo: true });
    expect(c.session.snapshot().state).toBe('idle');
    c.machine.toAttract();
    playRound(c, 0.003, -0.402);
    playRound(c, 0.2, -0.3);
    const s = c.session.snapshot();
    expect(s).toMatchObject({ state: 'running', tries: 2, id: 1 });
    expect(started).toHaveLength(1);
    c.machine.toAttract();
    expect(c.session.snapshot()).toMatchObject({ state: 'idle', reason: 'abandoned' });
    expect(over).toEqual([]);
    expect(c.controller.inputLocked).toBe(false);
  });
});

describe('tries session', () => {
  it('ends at the RESULT of the last try with one session prize, then locks input until a new session', { timeout: 120_000 }, async () => {
    const c = await core({ kind: 'tries', tries: 2 });
    const awards: PrizeAward[] = [];
    const over: SessionSnapshot[] = [];
    c.machine.events.on('award', (a) => awards.push(a));
    c.session.events.on('over', (s) => over.push(s));
    let dropped = false;
    const t1 = playRound(c, 0.1, -0.6, {
      onStep: (core) => {
        if (!dropped && core.machine.phase === 'DESCENDING') {
          dropped = true;
          dropGem(core);
        }
      },
    });
    expect(t1.result.machine!.items).toHaveLength(1);
    expect(c.session.snapshot()).toMatchObject({ state: 'running', tries: 1, triesTotal: 2, items: 1, value: 150 });
    const t2 = playRound(c, 0.1, -0.6);
    expect(over).toHaveLength(1);
    const snap = c.session.snapshot();
    expect(snap).toMatchObject({ state: 'over', reason: 'tries', tries: 2, items: 1, lastRoundId: t2.result.roundId });
    expect(snap.reward).toEqual({ typeId: over[0]!.reward!.typeId, tier: expect.any(String), prizeId: `test-${t2.result.roundId}-S`, roundId: t2.result.roundId });
    expect(awards.filter((a) => a.session)).toHaveLength(1);
    expect(c.controller.inputLocked).toBe(true);
    // The next READY is a locked machine: no input, no grab, no new session.
    c.machine.next(false);
    c.controller.inputX = 1;
    expect(c.controller.requestGrab()).toBe(false);
    idle(c, 0.5);
    expect(c.machine.phase).toBe('READY');
    expect(c.session.snapshot().state).toBe('over');
    // PLAY AGAIN: the field is reset, input unlocked, and the next READY starts session 2.
    c.controller.clearInput();
    c.session.newSession();
    expect(c.controller.inputLocked).toBe(false);
    expect(c.field.onField()).toHaveLength(4);
    c.machine.abort('play_again', 'READY');
    expect(c.session.snapshot()).toMatchObject({ id: 2, state: 'running', tries: 0, items: 0, reward: null });
  });

  it('latches its rule when it starts', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'tries', tries: 3 });
    c.machine.start(false);
    c.session.configure({ kind: 'tries', tries: 1 }, 'shelf');
    expect(c.session.snapshot()).toMatchObject({ triesTotal: 3, machineId: 'bridge' });
    playRound(c, 0.1, -0.6);
    expect(c.session.snapshot().state).toBe('running');
    c.machine.toAttract();
    expect(c.session.snapshot()).toMatchObject({ state: 'idle', triesTotal: 1, machineId: 'shelf' });
  });

  it('a demo round neither counts nor ends a session', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'tries', tries: 1 });
    playRound(c, 0.1, -0.6, { demo: true });
    expect(c.session.snapshot()).toMatchObject({ state: 'idle', tries: 0 });
    expect(c.controller.inputLocked).toBe(false);
  });
});

describe('timed session', () => {
  it('the clock starts at the first input and only runs in fixed steps', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'timed', seconds: 30 });
    const seconds: number[] = [];
    c.session.events.on('second', (e) => seconds.push(e.secondsLeft));
    c.machine.start(false);
    idle(c, 1);
    expect(c.session.snapshot()).toMatchObject({ state: 'running', secondsLeft: 30, timerStarted: false });
    c.controller.inputX = 0.5;
    idle(c, 2.1);
    const left = c.session.snapshot().secondsLeft!;
    expect(c.session.snapshot().timerStarted).toBe(true);
    expect(left).toBeCloseTo(27.9, 1);
    // No fixed step, no time: a paused game (dialog, hidden tab) gains nothing.
    expect(c.session.snapshot().secondsLeft).toBe(left);
    expect(seconds.slice(0, 3)).toEqual([30, 29, 28]);
  });

  it('time up while aiming drops the claw where it is; the try counts and the run ends at its RESULT', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'timed', seconds: 1 });
    const over: SessionSnapshot[] = [];
    const low: number[] = [];
    c.session.events.on('over', (s) => over.push(s));
    c.session.events.on('timeLow', (e) => low.push(e.secondsLeft));
    c.machine.start(false);
    c.controller.inputX = -0.2;
    stepUntil(c, () => c.machine.phase === 'DESCENDING', 3);
    expect(c.machine.phase).toBe('DESCENDING');
    expect(c.session.snapshot().secondsLeft).toBe(0);
    c.controller.clearInput();
    stepUntil(c, () => c.machine.phase === 'RESULT');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1, state: 'over' });
    expect(low).toEqual([1]);
  });

  it('time up between tries ends the run without another try', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'timed', seconds: 60 });
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    playRound(c, 0.1, -0.6);
    c.machine.next(false);
    c.session.setSecondsLeft(0.05);
    idle(c, 0.2);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1 });
    expect(c.machine.phase).toBe('READY');
    expect(c.controller.inputLocked).toBe(true);
  });

  it('time up during a busy phase: the last grab completes and counts', { timeout: 60_000 }, async () => {
    const c = await core({ kind: 'timed', seconds: 60 });
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    let dropped = false;
    const trace = playRound(c, 0.1, -0.6, {
      onStep: (core) => {
        if (core.machine.phase === 'DESCENDING' && !dropped) {
          dropped = true;
          core.session.setSecondsLeft(0.02);
          dropGem(core);
        }
      },
    });
    expect(trace.result.machine!.items).toHaveLength(1);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'time', tries: 1, items: 1, value: 150 });
    expect(over[0]!.reward!.prizeId).toBe(`test-${trace.result.roundId}-S`);
  });
});
