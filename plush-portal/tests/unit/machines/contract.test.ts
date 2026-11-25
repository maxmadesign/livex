/**
 * The machine registry and the contract every machine must meet (docs/design/machines.md, sections
 * 2.9, 8.1 and D10). A new MachineDef or genre module gets these checks for free; a machine stays
 * unavailable to players until its genre module exists and passes them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DemoPilot } from '../../../src/app/DemoPilot';
import type { RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { GENRE_IDS, MACHINE_IDS } from '../../../src/game/machines/ids';
import { GENRES, MACHINES, isPendingGenre, isPlayable, machineDef, neighbours, offeredMachines, resolveMachine, scaleRoundParams } from '../../../src/game/machines/registry';
import type { MachineDef, ResolvedMachine } from '../../../src/game/machines/types';
import { CLASSIC_FIELD, overOpening, validateGeometry } from '../../../src/physics/fieldGeometry';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { defaultSettings } from '../../../src/settings/spec';
import { inspectWorld, makeCore, playRound, roundParams } from '../game/harness';
import { poseHash } from './goldenScenario';
import { probeMachine } from './probeGenre';

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function core(machine: ResolvedMachine, seed = 7): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed, machine });
  cores.push(c);
  return c;
}

describe('machine registry', () => {
  it('registers every machine id once, with a known genre, classic first and playable', () => {
    expect(MACHINES.map((m) => m.id).sort()).toEqual([...MACHINE_IDS].sort());
    for (const m of MACHINES) expect(GENRE_IDS).toContain(m.genre);
    expect(Object.keys(GENRES).sort()).toEqual([...GENRE_IDS].sort());
    expect(MACHINES[0]!.id).toBe('classic');
    expect(isPlayable(MACHINES[0]!)).toBe(true);
    expect([...MACHINES].sort((a, b) => a.order - b.order)).toEqual([...MACHINES]);
  });

  it('gates the machines whose genre modules have not landed: unavailable, never resolved for players', () => {
    for (const def of MACHINES.filter((m) => isPendingGenre(GENRES[m.genre]))) {
      const id = def.id;
      expect(def.available, id).toBe(false);
      expect(isPlayable(def), id).toBe(false);
      expect(resolveMachine(id).def.id).toBe('classic');
      // Not even tests can build a pending genre: there is no physics for it yet.
      expect(resolveMachine(id, undefined, { includeUnavailable: true }).def.id).toBe('classic');
      expect(() => GENRES[def.genre].geometry(GENRES[def.genre].defaults as never)).toThrow(/not implemented yet/);
    }
    // A genre that has landed but whose gates have not passed yet: tests and sweeps can build it, players never get it.
    for (const def of MACHINES.filter((m) => !m.available && !isPendingGenre(GENRES[m.genre]))) {
      expect(isPlayable(def), def.id).toBe(false);
      expect(resolveMachine(def.id).def.id).toBe('classic');
      expect(resolveMachine(def.id, undefined, { includeUnavailable: true }).def.id).toBe(def.id);
    }
    expect(resolveMachine('pinball').def.id).toBe('classic');
    expect(resolveMachine(null).def.id).toBe('classic');
  });

  it('classic resolves to today\'s machine', () => {
    const r = resolveMachine('classic', defaultSettings().machines);
    expect(r.geometry).toBe(CLASSIC_FIELD);
    expect(r.session).toEqual({ kind: 'open' });
    expect(r.controls).toBe('joystick');
    expect(r.module.presentation).toBe('prize');
    expect(r.module.createRules(r.params, r.geometry)).toBeNull();
    const base = roundParams('arcade');
    expect(r.module.roundParams(base, r.params)).toBe(base);
  });

  it('offers only playable machines; home is always offered; neighbours wrap around', () => {
    const s = defaultSettings().machines;
    expect(offeredMachines(s, 'classic').map((m) => m.id)).toEqual(['classic']);
    expect(offeredMachines({ hidden: ['classic'] }, 'classic').map((m) => m.id)).toEqual(['classic']);
    expect(neighbours('classic', offeredMachines(s, 'classic'))).toEqual({ prev: null, next: null });
    const three = MACHINES.slice(0, 3) as MachineDef[];
    expect(neighbours('classic', three)).toEqual({ prev: three[2], next: three[1] });
    expect(neighbours('shelf', three)).toEqual({ prev: three[1], next: three[0] });
  });

  it('every genre\'s defaults agree with the settings defaults', () => {
    const s = defaultSettings().machines;
    for (const id of GENRE_IDS) {
      const m = GENRES[id];
      expect({ ...m.defaults, ...m.fromSettings(s) }, id).toEqual(m.defaults);
    }
    // The designed session rules (section 2.6).
    expect(GENRES.bridge.session(GENRES.bridge.defaults)).toEqual({ kind: 'open' });
    expect(GENRES.shelf.session(GENRES.shelf.defaults)).toEqual({ kind: 'tries', tries: 5 });
    expect(GENRES.rush.session(GENRES.rush.defaults)).toEqual({ kind: 'timed', seconds: 75 });
    expect(GENRES.shelf.presentation).toBe('items');
    expect(GENRES.bridge.awardPhases.has('DESCENDING')).toBe(true);
  });

  it('scales the difficulty preset by a genre\'s claw multipliers', () => {
    const base = roundParams('arcade', { aimTimeLimit: 12 });
    const scaled = scaleRoundParams(base, { moveSpeed: 1.2, gripAssist: 0 });
    expect(scaled.moveSpeed).toBeCloseTo(base.moveSpeed * 1.2, 12);
    expect(scaled.gripAssist).toBe(0);
    expect(scaled.descendSpeed).toBe(base.descendSpeed);
    expect(scaled.aimTimeLimit).toBe(12);
    const rush = GENRES.rush.roundParams(base, GENRES.rush.defaults);
    expect(rush.liftSpeed).toBeCloseTo(base.liftSpeed * 1.25, 12);
  });
});

/* ------------------------------------------------------------ the contract */

interface ContractCase {
  name: string;
  machine: () => ResolvedMachine;
  /** The field's layout depends on the seed (the probe's does not). */
  seeded: boolean;
}

const CASES: ContractCase[] = [
  ...MACHINES.filter((m) => !isPendingGenre(GENRES[m.genre])).map((m) => ({ name: m.id, machine: () => resolveMachine(m.id, undefined, { includeUnavailable: true }), seeded: true })),
  // A test-only genre with its own floor, fixtures, items and rules: proves the contract harness
  // works for a machine other than classic before the real genres land.
  { name: 'probe (test genre)', machine: () => probeMachine(), seeded: false },
];

/** Ten tries by the machine's pilot (classic: the demo pilot) or plain aims; returns every problem seen. */
function tenTries(c: GameCore): { results: RoundResult[]; problems: string[] } {
  const problems: string[] = [];
  const results: RoundResult[] = [];
  const awardsByRound = new Map<number, number>();
  c.machine.events.on('award', (a) => awardsByRound.set(a.roundId, (awardsByRound.get(a.roundId) ?? 0) + 1));
  c.controller.events.on('prizeDetected', (e) => {
    const com = e.toy.body.worldCom();
    const o = c.phys.opening;
    if (!(com.y < o.awardComY && overOpening(o, com.x, com.z))) problems.push(`award outside the sensor at ${com.x.toFixed(3)},${com.y.toFixed(3)},${com.z.toFixed(3)}`);
  });
  const classic = c.def.def.genre === 'classic' && c.controller.rules === null;
  const pilot = new DemoPilot();
  for (let i = 0; i < 10; i++) {
    if (classic) {
      let result: RoundResult | null = null;
      const off = c.machine.events.on('result', (r) => (result = r));
      if (c.machine.phase === 'ATTRACT') c.machine.start(true);
      else c.machine.next(true);
      pilot.reset();
      for (let s = 0; s < 40 / FIXED_DT && !result; s++) {
        pilot.update(c, FIXED_DT);
        c.fixedStep();
      }
      off();
      if (!result) problems.push(`try ${i + 1} did not finish`);
      else results.push(result);
      c.field.clearBin();
      c.controller.forgetStrays();
      for (let guard = 0; c.field.missing() > 0 && guard < 40; guard++) {
        c.field.restockOne();
        for (let s = 0; s < 50; s++) c.fixedStep();
      }
    } else {
      const x = -0.3 + ((i * 0.137) % 0.6);
      const z = -0.62 + ((i * 0.211) % 0.45);
      results.push(playRound(c, x, z).result);
    }
    for (const a of inspectWorld(c)) problems.push(`${a.kind}: ${a.detail}`);
  }
  for (const [round, n] of awardsByRound) if (n > 1) problems.push(`round ${round}: ${n} awards`);
  for (const r of results) {
    for (const v of [r.liftedMs, r.gripQuality]) if (!Number.isFinite(v)) problems.push(`round ${r.roundId}: non-finite result`);
  }
  return { results, problems };
}

describe('machine contract', () => {
  for (const pendingDef of MACHINES.filter((m) => isPendingGenre(GENRES[m.genre]))) {
    it.todo(`${pendingDef.id}: the contract runs once its genre module lands`);
  }

  for (const cc of CASES) {
    describe(cc.name, () => {
      it('has a valid geometry', () => {
        expect(validateGeometry(cc.machine().geometry)).toEqual([]);
      });

      it('fills deterministically', { timeout: 60_000 }, async () => {
        const a = await core(cc.machine(), 21);
        const b = await core(cc.machine(), 21);
        expect(poseHash(a)).toBe(poseHash(b));
        if (cc.seeded) {
          const other = await core(cc.machine(), 22);
          expect(poseHash(other)).not.toBe(poseHash(a));
        }
      });

      it('plays ten tries with no anomaly and at most one award per try', { timeout: 180_000 }, async () => {
        const c = await core(cc.machine());
        const { results, problems } = tenTries(c);
        expect(problems).toEqual([]);
        expect(results).toHaveLength(10);
        for (const r of results) expect(['won', 'empty', 'slipped']).toContain(r.outcome);
      });

      it('keeps its collider count across a takeover reset', { timeout: 60_000 }, async () => {
        const c = await core(cc.machine());
        if (!c.field.resetForTakeover) return; // classic restocks instead (its toys differ in shape)
        const before = c.phys.world.colliders.len();
        playRound(c, 0.1, -0.6);
        c.field.resetForTakeover();
        c.settle(1.5);
        expect(c.phys.world.colliders.len()).toBe(before);
        expect(inspectWorld(c)).toEqual([]);
      });
    });
  }
});
