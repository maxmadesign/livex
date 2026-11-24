/**
 * Full physical rounds with the real baked characters. Everything here runs
 * the authoritative simulation exactly as the browser does (same fixed step,
 * same input path), only without rendering.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoundPhase } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { CHUTE, CLAW } from '../../../src/physics/fieldSpec';
import { comOf, idle, insideChuteFootprint, inspectWorld, makeCore, playRound, reachableToys } from './harness';

const TIMEOUT = 120_000;
const cores: GameCore[] = [];
async function core(options: Parameters<typeof makeCore>[0] = {}): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed: 7, ...options });
  cores.push(c);
  return c;
}
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

const BUSY_PATH: RoundPhase[] = ['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING', 'RESULT'];
const SLIP_REASONS = ['eccentric', 'weak_support', 'contact_lost', 'transport_swing', 'overload', 'bounced_out'];

function snapshot(c: GameCore): number[] {
  const out: number[] = [];
  for (const toy of c.phys.toys.values()) {
    const t = toy.body.translation();
    const r = toy.body.rotation();
    out.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
  }
  return out;
}

describe('physical rounds (real assets, Arcade defaults)', () => {
  it(
    'a centred grab wins: one award, the prize really went through the exit',
    async () => {
      const c = await core();
      expect(c.field.onField()).toHaveLength(18);
      const toy = reachableToys(c, 0.07)[0]!;
      const at = comOf(toy);
      const trace = playRound(c, at.x, at.z);
      const r = trace.result;

      expect(r.outcome).toBe('won');
      expect(trace.awards).toBe(1);
      expect(r.prizeId).toBe(`test-${r.roundId}`);
      expect(r.targetToyId).toBe(toy.id);
      expect(r.targetTypeId).toBe(toy.asset.id);
      expect(r.contact).toBe('lifted');
      expect(r.slipReason).toBeNull();
      expect(r.liftedMs).toBeGreaterThan(1000);
      expect(r.gripQuality).toBeGreaterThan(0.5);
      expect(r.nearest!.typeId).toBe(toy.asset.id);
      expect(r.nearest!.dist).toBeLessThan(0.015);

      // The whole path, in order, without the watchdog having to step in.
      expect(trace.phases.map((p) => p.phase).filter((p) => BUSY_PATH.includes(p))).toEqual(BUSY_PATH);
      expect(trace.recoveries).toEqual([]);

      // Detected below the floor, inside the chute: not while still dangling above it.
      expect(trace.prizeAt).not.toBeNull();
      expect(trace.prizeAt![1]).toBeLessThan(-0.05);
      expect(insideChuteFootprint(trace.prizeAt![0], trace.prizeAt![2])).toBe(true);
      expect(toy.inBin).toBe(true);
      expect(c.field.inBin()).toEqual([toy]);
      expect(c.field.onField()).toHaveLength(17);

      // Brisk: a successful round takes a handful of seconds from the button press.
      expect(trace.grabSeconds).toBeGreaterThan(3.5);
      expect(trace.grabSeconds).toBeLessThan(8);

      // The prize comes to rest in the bin; nothing else moved out of the cabinet.
      idle(c, 1.5);
      expect(inspectWorld(c)).toEqual([]);
      const rest = comOf(toy);
      expect(rest.y).toBeLessThan(-0.2);
      expect(rest.x).toBeLessThan(CHUTE.xMax + 0.02);

      // The claw is back home and open for the next round.
      expect(Math.abs(c.claw.trolleyX - CLAW.homeX)).toBeLessThan(0.02);
      expect(Math.abs(c.claw.trolleyZ - CLAW.homeZ)).toBeLessThan(0.02);

      // Next round on the same field: a different round id, and nothing is awarded twice.
      const again = playRound(c, at.x, at.z);
      expect(again.result.roundId).toBe(r.roundId + 1);
      expect(again.result.outcome).not.toBe('won'); // that spot is empty now
      expect(again.awards).toBe(0);
      expect(again.result.prizeId).toBeNull();
      expect(c.field.inBin()).toEqual([toy]);
    },
    TIMEOUT,
  );

  it(
    'a grab over an empty spot is honest: no contact, no target, no award',
    async () => {
      const c = await core();
      const trace = playRound(c, CLAW.dropX, CLAW.dropZ);
      const r = trace.result;
      expect(r.outcome).toBe('empty');
      expect(r.contact).toBe('none');
      expect(r.targetToyId).toBeNull();
      expect(r.prizeId).toBeNull();
      expect(r.slipReason).toBeNull();
      expect(r.liftedMs).toBe(0);
      expect(trace.awards).toBe(0);
      expect(trace.slip).toBeNull();
      expect(trace.recoveries).toEqual([]);
      expect(r.nearest).not.toBeNull();
      expect(r.nearest!.dist).toBeGreaterThan(0.1);
      expect(c.field.onField()).toHaveLength(18);
      expect(c.field.inBin()).toHaveLength(0);
      expect(trace.grabSeconds).toBeGreaterThan(2.5);
      expect(trace.grabSeconds).toBeLessThan(5.5);
      expect(inspectWorld(c)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a badly off-centre grab slips for a physical reason and awards nothing',
    async () => {
      // No assist at all: what happens here is pure rigid-body physics.
      const c = await core({ params: { gripAssist: 0 } });
      const toy = reachableToys(c, 0.07)[0]!;
      const at = comOf(toy);
      const trace = playRound(c, at.x + 0.06, at.z);
      const r = trace.result;
      expect(r.outcome).toBe('slipped');
      expect(['gripped', 'lifted']).toContain(r.contact);
      expect(SLIP_REASONS).toContain(r.slipReason);
      expect(['CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING']).toContain(r.slipPhase);
      expect(r.targetToyId).toBe(toy.id);
      expect(r.prizeId).toBeNull();
      expect(trace.awards).toBe(0);
      expect(trace.slip).not.toBeNull();
      expect(trace.slip!.reason).toBe(r.slipReason);
      expect(toy.inBin).toBe(false);
      expect(r.nearest!.dist).toBeGreaterThan(0.045);
      idle(c, 1);
      expect(c.field.onField()).toHaveLength(18);
      expect(inspectWorld(c)).toEqual([]);
      // The toy is back on the mat, not floating and not in the exit.
      expect(comOf(toy).y).toBeGreaterThan(0);
      expect(comOf(toy).y).toBeLessThan(0.25);
    },
    TIMEOUT,
  );

  it(
    'ignores movement and further grab requests while the claw is busy',
    async () => {
      const reference = await core();
      const toy = reachableToys(reference, 0.07)[1]!;
      const at = comOf(toy);
      const clean = playRound(reference, at.x, at.z);

      const mashed = await core();
      let refused = 0;
      let grabStarts = 0;
      mashed.controller.events.on('grabStarted', () => grabStarts++);
      const noisy = playRound(mashed, at.x, at.z, {
        onStep: (c) => {
          if (!c.machine.busy) return;
          // A player hammering every control during the automatic part of the round.
          c.controller.inputX = 1;
          c.controller.inputZ = -1;
          if (!c.controller.requestGrab()) refused++;
        },
      });
      expect(grabStarts).toBe(1);
      expect(refused).toBeGreaterThan(300);
      expect(noisy.phases.filter((p) => p.phase === 'DESCENDING')).toHaveLength(1);
      expect(noisy.awards).toBe(clean.awards);
      expect(noisy.result).toEqual(clean.result);
      expect(noisy.grabSeconds).toBe(clean.grabSeconds);
      expect(snapshot(mashed)).toEqual(snapshot(reference));
    },
    TIMEOUT,
  );

  it(
    'is deterministic: same seed and same inputs give the same round, bit for bit',
    async () => {
      const a = await core({ seed: 21 });
      const b = await core({ seed: 21 });
      expect(snapshot(a)).toEqual(snapshot(b));
      const toy = reachableToys(a, 0.05)[2]!;
      const at = comOf(toy);
      const ra = playRound(a, at.x + 0.03, at.z - 0.01);
      const rb = playRound(b, at.x + 0.03, at.z - 0.01);
      expect(ra.result).toEqual(rb.result);
      expect(ra.phases).toEqual(rb.phases);
      expect(snapshot(a)).toEqual(snapshot(b));
      // A different seed is a different field.
      const other = await core({ seed: 22 });
      expect(snapshot(other)).not.toEqual(snapshot(await core({ seed: 21 })));
    },
    TIMEOUT,
  );

  it(
    'a toy that falls into the exit on its own is a stray, never a prize',
    async () => {
      const c = await core();
      let strays = 0;
      let awards = 0;
      c.controller.events.on('strayInBin', () => strays++);
      c.machine.events.on('award', () => awards++);
      c.machine.start();
      const toy = c.field.onField()[0]!;
      toy.body.setTranslation({ x: (CHUTE.xMin + CHUTE.xMax) / 2, y: 0.3, z: (CHUTE.zMin + CHUTE.zMax) / 2 }, true);
      toy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      idle(c, 2);
      expect(strays).toBe(1);
      expect(awards).toBe(0);
      expect(toy.inBin).toBe(true);
      expect(c.machine.phase).toBe('READY');
      expect(c.machine.award).toBeNull();
      // Playing on does not turn the stray into a win either.
      const trace = playRound(c, CLAW.dropX, CLAW.dropZ);
      expect(trace.result.outcome).toBe('empty');
      expect(trace.awards).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the aim timer starts the grab by itself, exactly once',
    async () => {
      const c = await core({ params: { aimTimeLimit: 2 } });
      const ticks: number[] = [];
      let grabs = 0;
      c.controller.events.on('aimTick', (e) => ticks.push(e.secondsLeft));
      c.controller.events.on('grabStarted', () => grabs++);
      c.machine.start();
      // Waiting without touching anything does not start the clock.
      idle(c, 1);
      expect(c.machine.phase).toBe('READY');
      c.controller.inputX = 1;
      idle(c, 0.5);
      c.controller.clearInput();
      expect(c.machine.phase).toBe('AIMING');
      idle(c, 1.4);
      expect(c.machine.phase).toBe('AIMING');
      idle(c, 0.3);
      expect(c.machine.busy).toBe(true);
      expect(grabs).toBe(1);
      expect(ticks[0]).toBe(2);
      expect(ticks[ticks.length - 1]).toBe(0);
      let result = false;
      c.machine.events.on('result', () => (result = true));
      for (let i = 0; i < 12 && !result; i++) idle(c, 1);
      expect(result).toBe(true);
      expect(grabs).toBe(1);
    },
    TIMEOUT,
  );
});

describe('difficulty only changes physical parameters', () => {
  it(
    'Easy holds a slightly off-centre toy that Skill lets go, on the identical field',
    async () => {
      // Same seed → same toys in the same places for every difficulty.
      const easy = await core({ difficulty: 'easy', seed: 11 });
      const skill = await core({ difficulty: 'skill', seed: 11 });
      expect(snapshot(easy)).toEqual(snapshot(skill));
      let easyWins = 0;
      let skillWins = 0;
      const picks = reachableToys(easy, 0.07).slice(0, 4).map((t) => comOf(t));
      for (const at of picks) {
        const e = await core({ difficulty: 'easy', seed: 11 });
        const s = await core({ difficulty: 'skill', seed: 11 });
        if (playRound(e, at.x + 0.045, at.z).result.outcome === 'won') easyWins++;
        if (playRound(s, at.x + 0.045, at.z).result.outcome === 'won') skillWins++;
      }
      expect(easyWins).toBeGreaterThanOrEqual(skillWins);
      expect(easyWins).toBeGreaterThanOrEqual(2);
    },
    TIMEOUT * 2,
  );
});
