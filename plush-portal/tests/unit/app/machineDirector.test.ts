/**
 * The machine director with a fake host around a real GameCore (docs/design/machines.md, section
 * 8.1, WS-D): the switch sequence, settlement, session prizes, rankings, today's pick, the guide
 * policy, the idle reset back home and the attract cycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameStore, INITIAL_REWARD } from '../../../src/app/gameStore';
import { MachineDirector, prizeTypeOf, type DirectorHost } from '../../../src/app/MachineDirector';
import { MachinePilot } from '../../../src/app/MachinePilot';
import type { GuideEventType, GuideFacts } from '../../../src/core/contracts';
import type { RoundResult } from '../../../src/core/types';
import { AttractDirector } from '../../../src/game/attract';
import type { GameCore } from '../../../src/game/GameCore';
import { shelfAim } from '../../../src/game/machines/shelf';
import type { ShelfParams } from '../../../src/game/machines/types';
import { ScoreKeeper } from '../../../src/game/scoring';
import { createCollectionStore } from '../../../src/persistence/collection';
import { rankingsOf } from '../../../src/persistence/machines';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import type { ToyBody } from '../../../src/physics/PhysicsWorld';
import { defaultSettings, type Settings } from '../../../src/settings/spec';
import { idle, makeCore, playRound, roundParams, themeAssets } from '../game/harness';
import { installMemoryStorage } from '../settings/memoryStorage';
import { RewardFlow } from '../../../src/rewards/flow';
import type { IssueInput, RewardClient, RewardResult } from '../../../src/rewards/client';
import type { IssueResponseBody } from '../../../src/rewards/protocol';
import { openingCenter } from '../../../src/physics/fieldGeometry';
import { addRanking } from '../../../src/persistence/machines';

beforeEach(() => {
  installMemoryStorage();
});
const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

interface Rig {
  core: GameCore;
  director: MachineDirector;
  host: DirectorHost;
  attract: AttractDirector;
  calls: string[];
  guide: { type: GuideEventType; machine: GuideFacts['machine'] }[];
  rewards: { roundId: number; typeId: string }[];
  sfx: string[];
  toasts: string[];
  settings: Settings;
  clock: { now: number; today: string };
  /** Game's result path: the director first, classic code otherwise (here: nothing). */
  results: RoundResult[];
  /** With `flow: true`: the real RewardFlow and the issue requests waiting for their answer. */
  flow: RewardFlow | null;
  issues: { input: IssueInput; answer: (r: RewardResult<IssueResponseBody>) => void }[];
}

/** A real core and the director around it, with a host that records what the game would do. */
async function rig(options: { settings?: (s: Settings) => void; allowUnavailable?: boolean; flow?: boolean } = {}): Promise<Rig> {
  const core = await makeCore({ theme: 'sakura', seed: 7 });
  cores.push(core);
  const settings = defaultSettings();
  options.settings?.(settings);
  const ui = createGameStore('desktop', true, 'sakura');
  const collection = createCollectionStore();
  const scores = new ScoreKeeper();
  const attract = new AttractDirector(core);
  const r: Partial<Rig> = { core, attract, calls: [], guide: [], rewards: [], sfx: [], toasts: [], settings, clock: { now: 1_000_000, today: '2026-11-25' }, results: [], flow: null, issues: [] };
  const rr = r as Rig;
  if (options.flow) {
    // Game's RewardFlow with a client whose answers the test sends (the code is "issuing" until then).
    const client: RewardClient = {
      session: 'review',
      status: async () => ({ ok: false, reason: 'offline' }),
      issue: (input) => new Promise((answer) => rr.issues.push({ input, answer })),
    };
    rr.flow = new RewardFlow({ ui, settings: () => ({ ...settings.rewards, mode: 'all' }), client, demoBuild: false, now: () => rr.clock.now });
  }
  const host: DirectorHost = {
    core,
    ui,
    collection,
    scores,
    audio: { playSfx: (name) => rr.sfx.push(name), playWin: () => rr.sfx.push('win') },
    debug: true,
    launchMachine: null,
    settings: () => settings,
    themeId: () => 'sakura',
    enabledAssets: () => themeAssets('sakura'),
    roundParams: () => roundParams('arcade'),
    fieldOptions: () => ({ count: 18, scale: 0.92, density: 0.2, massScale: 1, seed: 7 }),
    seed: () => 7,
    difficulty: () => 'arcade',
    inAttract: () => attract.active,
    setBusy: (busy) => rr.calls.push(`busy:${busy}`),
    clearScene: () => rr.calls.push('clearScene'),
    buildScene: () => rr.calls.push('buildScene'),
    syncVisuals: () => rr.calls.push('syncVisuals'),
    warmUp: async () => {
      rr.calls.push('warmUp');
    },
    closeLobby: () => rr.calls.push('closeLobby'),
    pressStart: () => {
      rr.calls.push('pressStart');
      if (!attract.active) return;
      scores.resetSession();
      attract.leave();
      rr.director.onStart();
    },
    publishScore: () => undefined,
    popup: () => rr.calls.push('popup'),
    burst: () => undefined,
    celebrate: () => rr.calls.push('celebrate'),
    lightShow: () => undefined,
    ledPulse: () => undefined,
    emitGuide: (type) => rr.guide.push({ type, machine: rr.director.facts() ?? null }),
    requestReward: (roundId, typeId) => {
      rr.rewards.push({ roundId, typeId });
      rr.flow?.onWin({ roundId, demo: false, themeId: 'sakura', prizeId: typeId, prizeName: typeId, tier: 'common', lang: 'en' });
    },
    cardShown: (roundId) => {
      rr.calls.push('cardShown');
      rr.flow?.onCardShown(roundId);
    },
    resetRewards: () => rr.flow?.reset(),
    toast: (key) => rr.toasts.push(key),
    log: () => undefined,
    now: () => rr.clock.now,
    today: () => rr.clock.today,
    guideLanguage: () => 'en',
  };
  rr.host = host;
  const director = new MachineDirector(host);
  rr.director = director;
  if (options.allowUnavailable ?? true) director.setAllowUnavailable(true);
  // Game.bindCore: results to the director first; awards into the collection for the machine.
  core.machine.events.on('result', (res) => {
    rr.results.push(res);
    director.onResult(res);
  });
  core.machine.events.on('award', (a) => {
    if (!a.demo) collection.getState().addPrize(a.typeId, a.prizeId, director.machineId);
  });
  director.bind();
  // The setMachine call, between the visuals being cleared and the scene being rebuilt.
  const setMachine = core.setMachine.bind(core);
  core.setMachine = (def, ctx) => {
    rr.calls.push(`setMachine:${def.def.id}`);
    setMachine(def, ctx);
  };
  return rr;
}

async function switchTo(r: Rig, id: Parameters<MachineDirector['select']>[0]): Promise<void> {
  expect(r.director.select(id)).toBe(true);
  expect(await r.director.whenSwitched()).toBe(true);
  expect(r.director.machineId).toBe(id);
}

/** One player try on the shelf, aimed like the attract pilot; `push` throws the front stack over the lip. */
function shelfTry(r: Rig, push: boolean): RoundResult {
  const c = r.core;
  const plan = shelfAim(c, 0, c.def.params as ShelfParams);
  let pushed = false;
  const front = c.field.onField().filter((t) => t.item && t.body.worldCom().z > -0.45 && Math.abs(t.body.worldCom().x - 0.1) < 0.03);
  return playRound(c, plan?.x ?? 0, plan?.z ?? -0.4, {
    onStep: (core) => {
      if (!push || pushed || core.machine.phase !== 'DESCENDING') return;
      pushed = true;
      for (const t of front) t.body.setLinvel({ x: 0, y: 0.9, z: 1.3 }, true);
    },
  }).result;
}

/** A demo round steered by the director's pilot (as attract mode plays it), back to ATTRACT after. */
function demoRound(r: Rig): RoundResult {
  const c = r.core;
  let result: RoundResult | null = null;
  const off = c.machine.events.on('result', (res) => (result = res));
  c.machine.start(true);
  r.director.pilot.reset();
  for (let s = 0; s < 40 / FIXED_DT && !result; s++) {
    r.director.pilot.update(c, FIXED_DT);
    c.fixedStep();
  }
  off();
  if (!result) throw new Error('demo round did not finish');
  c.field.clearBin();
  c.machine.toAttract();
  return result;
}

describe('switching (design 4.2)', () => {
  it('clears the visuals, rebuilds the stack, the scene and warms up, in that order; from attract the player round starts', { timeout: 60_000 }, async () => {
    const r = await rig();
    const before = r.core.machine.roundId;
    await switchTo(r, 'shelf');
    expect(r.calls).toEqual(['closeLobby', 'busy:true', 'clearScene', 'setMachine:shelf', 'buildScene', 'warmUp', 'busy:false', 'pressStart']);
    expect(r.core.def.def.id).toBe('shelf');
    expect(r.core.machine.phase).toBe('READY');
    expect(r.core.machine.demo).toBe(false);
    // Round ids keep counting across the switch (claim codes are unique per round id).
    expect(r.core.machine.roundId).toBeGreaterThan(before);
    expect(r.director.pilot).toBeInstanceOf(MachinePilot);
    expect(r.host.ui.getState().machine).toMatchObject({ id: 'shelf', genre: 'shelf', presentation: 'items', switching: false, session: { kind: 'tries', triesTotal: 5 } });
    // Back to classic from a player round: no START, the classic pilot again.
    const id = r.core.machine.roundId;
    r.calls.length = 0;
    await switchTo(r, 'classic');
    expect(r.calls).toEqual(['closeLobby', 'busy:true', 'clearScene', 'setMachine:classic', 'buildScene', 'warmUp', 'busy:false']);
    expect(r.core.machine.roundId).toBeGreaterThan(id);
    expect(r.director.pilot).toBe(r.director.demoPilot);
    expect(r.host.ui.getState().machine).toMatchObject({ id: 'classic', presentation: 'prize', plate: { key: 'machines.plate.free' } });
  });

  it('refuses machines that are not offered, hidden, locked, or when the lobby is off; queues while the claw is busy', { timeout: 60_000 }, async () => {
    const r = await rig({ allowUnavailable: false });
    // An unknown id. (Hidden machines are left out of offered(); this rig is a debug host, which may
    // still pick them, as the e2e debug override does.)
    expect(r.director.select('nope')).toBe(false);
    r.settings.machines.hidden = ['shelf'];
    expect(r.director.offered().map((m) => m.id)).not.toContain('shelf');
    r.settings.machines.hidden = [];
    r.director.setAllowUnavailable(true);
    r.settings.machines.unlock = 'progress';
    expect(r.director.select('rush')).toBe(false);
    expect(r.toasts).toContain('machines.toast.locked');
    r.settings.machines.unlock = 'open';
    // A player round in a busy phase: the switch waits for the try to end.
    r.core.machine.start(false);
    r.core.controller.requestGrab();
    for (let i = 0; i < 30; i++) r.core.fixedStep();
    expect(r.core.machine.busy).toBe(true);
    expect(r.director.select('shelf')).toBe(true);
    expect(r.toasts).toContain('machines.toast.after');
    expect(r.calls).not.toContain('setMachine:shelf');
    for (let i = 0; i < 40 / FIXED_DT && r.core.machine.phase !== 'RESULT'; i++) {
      r.core.fixedStep();
      r.director.update();
    }
    r.director.update();
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.core.def.def.id).toBe('shelf');
  });

  it('a switch that fails puts the scene back, lifts the curtain and reports false', { timeout: 60_000 }, async () => {
    const r = await rig();
    const setMachine = r.core.setMachine;
    r.core.setMachine = () => {
      throw new Error('boom');
    };
    expect(r.director.select('shelf')).toBe(true);
    expect(await r.director.whenSwitched()).toBe(false);
    expect(r.calls).toEqual(['closeLobby', 'busy:true', 'clearScene', 'buildScene', 'busy:false']);
    expect(r.toasts).toContain('machines.toast.failed');
    expect(r.director.machineId).toBe('classic');
    expect(r.host.ui.getState().machine).toMatchObject({ id: 'classic', switching: false });
    r.core.setMachine = setMachine;
    // A theme change under way: the pick waits for it.
    r.host.ui.setState({ themeBusy: true });
    expect(r.director.select('shelf')).toBe(true);
    r.director.update();
    expect(r.director.machineId).toBe('classic');
    r.host.ui.setState({ themeBusy: false });
    r.director.update();
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.director.machineId).toBe('shelf');
  });

  it('a machine switched to from a busy demo round stops the demo and stays in attract mode', { timeout: 60_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.attractCycle = false) });
    r.core.machine.start(true);
    r.core.controller.requestGrab();
    for (let i = 0; i < 30; i++) r.core.fixedStep();
    expect(r.core.machine.busy).toBe(true);
    // The idle reset's switch (no START): from the demo straight to the machine, in attract mode.
    r.settings.machines.home = 'rush';
    r.director.onIdleReset();
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.director.machineId).toBe('rush');
    expect(r.core.machine.phase).toBe('ATTRACT');
    expect(r.calls).not.toContain('pressStart');
  });
});

describe('items machines: settlement, session card, session prize (design 3.5)', () => {
  it('shelf: one settlement per try, one prize and one claim code per qualifying session, the guide policy', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.shelf.rewardItems = 1) });
    await switchTo(r, 'shelf');
    const tries: RoundResult[] = [];
    for (let i = 0; i < 5; i++) {
      tries.push(shelfTry(r, i === 0));
      expect(r.host.ui.getState().result).toBeNull();
      if (i < 4) {
        expect(r.director.sessionOver()).toBe(false);
        expect(r.director.autoAdvance()).toBe(tries[i]!.machine!.items.length > 0 ? 2.0 : 1.15);
      }
      r.core.field.clearBin();
    }
    // One settlement per try, the session points are their sum.
    const settled = r.director.settlements().filter((s) => !s.demo);
    expect(settled.map((s) => s.roundId)).toEqual(tries.map((t) => t.roundId));
    expect(settled.map((s) => s.items)).toEqual(tries.map((t) => t.machine!.items.length));
    const points = settled.reduce((a, s) => a + s.total, 0);
    expect(r.host.scores.totals(false).session).toBe(points);
    // The session is over: the card waits for PLAY AGAIN, no auto-advance.
    expect(r.director.sessionOver()).toBe(true);
    expect(r.director.autoAdvance()).toBeNull();
    const card = r.host.ui.getState().sessionResult!;
    const items = tries.reduce((a, t) => a + t.machine!.items.length, 0);
    expect(items).toBeGreaterThanOrEqual(1);
    expect(card).toMatchObject({ machineId: 'shelf', roundId: tries[4]!.roundId, reason: 'tries', items, points, rank: null });
    // The prize: in the collection (counted for this machine) with exactly one claim code for the last try.
    expect(card.rewardTypeId).not.toBeNull();
    expect(r.rewards).toEqual([{ roundId: tries[4]!.roundId, typeId: card.rewardTypeId! }]);
    expect(r.host.collection.getState().machineWins).toEqual({ shelf: 1 });
    expect(r.calls).toContain('cardShown');
    // Guide: items_scored after scoring tries, session_over at the end with the reason.
    const types = r.guide.map((g) => g.type).filter((t) => t !== 'machine_selected');
    expect(types[0]).toBe('items_scored');
    expect(types.at(-1)).toBe('session_over');
    expect(types).not.toContain('empty_grab');
    expect(r.guide.at(-1)!.machine).toMatchObject({ id: 'shelf', genre: 'shelf', name: 'Tumble Shelf', reason: 'tries', triesLeft: 0, sessionItems: items, score: points });
    // PLAY AGAIN: fresh stacks, a new session, unlocked.
    expect(r.director.newSession()).toBe(true);
    expect(r.core.machine.phase).toBe('READY');
    expect(r.core.controller.inputLocked).toBe(false);
    expect(r.core.session.snapshot()).toMatchObject({ state: 'running', tries: 0, items: 0 });
    expect(r.host.ui.getState().sessionResult).toBeNull();
    expect(r.host.scores.totals(false).session).toBe(0);
    expect(r.core.field.onField().filter((t) => t.item)).toHaveLength(23);
  });

  it('a session below the prize line earns no prize and no code; demo rounds are settled on the demo track only', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => ((s.machines.shelf.tries = 2), (s.machines.shelf.rewardItems = 30)) });
    await switchTo(r, 'shelf');
    shelfTry(r, true);
    shelfTry(r, false);
    expect(r.director.sessionOver()).toBe(true);
    expect(r.host.ui.getState().sessionResult!.rewardTypeId).toBeNull();
    expect(r.rewards).toEqual([]);
    expect(r.host.collection.getState().wins).toBe(0);
    // Demo rounds: never a session, never a prize or a code, never the player's points, no guide lines.
    r.attract.enter('idle_reset');
    const player = r.host.scores.totals(false).lifetime;
    const lines = r.guide.length;
    for (let i = 0; i < 2; i++) demoRound(r);
    expect(r.rewards).toEqual([]);
    expect(r.host.scores.totals(false).lifetime).toBe(player);
    expect(r.director.settlements().filter((s) => s.demo).length).toBe(2);
    expect(r.guide.length).toBe(lines);
  });

  it('rush: a timed run ends on time, ranks without the daily bonus, takes initials; demo runs never rank', { timeout: 180_000 }, async () => {
    const r = await rig({ settings: (s) => ((s.machines.hidden = ['bridge', 'shelf']), (s.machines.rush.rewardValue = 0)) });
    // Today's pick is rush (the only candidate): its points are ×1.5, its ranking score is not.
    expect(r.director.dailyPick()).toBe('rush');
    await switchTo(r, 'rush');
    expect(r.director.bonusFor(false)).toBe(1.5);
    expect(r.director.bonusFor(true)).toBe(1);
    // A few tries, then the clock runs out between tries.
    let scored = 0;
    for (let i = 0; i < 6 && scored === 0; i++) {
      const pieces = r.core.field.onField().filter((t) => t.item);
      const target = pieces.sort((a, b) => b.item!.value - a.item!.value)[0]!.body.worldCom();
      const res = playRound(r.core, target.x, target.z).result;
      scored += res.machine!.items.length;
      r.core.field.clearBin();
      r.core.machine.next(false);
    }
    expect(scored).toBeGreaterThan(0);
    expect(r.director.allowHint()).toBe(false);
    r.core.session.setSecondsLeft(0.05);
    for (let i = 0; i < 20; i++) r.core.fixedStep();
    expect(r.director.sessionOver()).toBe(true);
    const card = r.host.ui.getState().sessionResult!;
    expect(card).toMatchObject({ machineId: 'rush', reason: 'time', rank: 1, rewardTypeId: null });
    const withBonus = r.director.settlements().filter((s) => !s.demo).reduce((a, s) => a + s.total, 0);
    expect(card.points).toBe(withBonus);
    const entry = r.host.ui.getState().rankEntry!;
    expect(entry).toMatchObject({ machineId: 'rush', position: 1 });
    // The ranking score leaves the daily bonus out (days stay comparable).
    expect(entry.score).toBeLessThan(withBonus);
    expect(entry.score).toBeCloseTo(withBonus / 1.5, -1);
    expect(r.sfx).toContain('jackpot');
    expect(r.director.submitInitials('a1')).toBe(false);
    expect(r.director.submitInitials('kim')).toBe(true);
    expect(rankingsOf('rush')).toEqual([{ initials: 'KIM', score: entry.score, at: r.clock.now, difficulty: 'arcade' }]);
    expect(r.host.ui.getState().rankEntry).toBeNull();
    expect(r.director.rankings('rush')[0]!.initials).toBe('KIM');
    expect(r.director.cards().find((c) => c.id === 'rush')!.top).toEqual([{ initials: 'KIM', score: entry.score }]);
    // A demo run never ranks (rush is home here, so the idle reset stays on it).
    r.settings.machines.home = 'rush';
    r.attract.enter('idle_reset');
    r.director.onIdleReset();
    expect(r.director.machineId).toBe('rush');
    demoRound(r);
    expect(r.host.ui.getState().rankEntry).toBeNull();
    expect(rankingsOf('rush')).toHaveLength(1);
  });

  it('an unconfirmed ranking place is saved as ??? after the timeout, dropped by an idle reset', { timeout: 180_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.rush.rewardValue = 0) });
    await switchTo(r, 'rush');
    const run = () => {
      for (let i = 0; i < 6; i++) {
        const p = r.core.field.onField().filter((t) => t.item).sort((a, b) => b.item!.value - a.item!.value)[0]!.body.worldCom();
        const res = playRound(r.core, p.x, p.z).result;
        r.core.field.clearBin();
        if (res.machine!.items.length > 0) break;
      }
      // Time runs out while the last try's result is up.
      r.core.session.setSecondsLeft(0.02);
      for (let i = 0; i < 10; i++) r.core.fixedStep();
    };
    run();
    expect(r.host.ui.getState().rankEntry).not.toBeNull();
    r.clock.now += 31_000;
    r.director.update();
    expect(r.host.ui.getState().rankEntry).toBeNull();
    expect(rankingsOf('rush')[0]!.initials).toBe('???');
    expect(r.host.ui.getState().sessionResult!.rank).toBe(1);
    // A second run: the idle reset drops the waiting place (nothing saved).
    expect(r.director.newSession()).toBe(true);
    run();
    expect(r.host.ui.getState().rankEntry).not.toBeNull();
    r.settings.machines.home = 'rush';
    r.attract.enter('idle_reset');
    r.director.onIdleReset();
    expect(r.host.ui.getState().rankEntry).toBeNull();
    expect(r.host.ui.getState().sessionResult).toBeNull();
    expect(rankingsOf('rush')).toHaveLength(1);
  });
});

describe('prize machines (classic, bridge)', () => {
  it('leave results to Game; the bridge reports progress instead of an empty grab; classic facts carry no machine', { timeout: 60_000 }, async () => {
    const r = await rig();
    expect(r.director.facts()).toBeUndefined();
    const classicMiss = playRound(r.core, -0.1, -0.13).result;
    expect(r.director.onResult(classicMiss)).toBe(false);
    expect(r.director.missEvent(classicMiss)).toBe('empty_grab');
    expect(r.director.bonusFor(false)).toBe(1);
    const exit = r.director.exitPos();
    expect([exit.x, exit.y, exit.z].map((v) => Number(v.toFixed(9)))).toEqual([-0.35, -0.06, -0.15]);
    await switchTo(r, 'bridge');
    expect(r.host.ui.getState().machine).toMatchObject({ id: 'bridge', presentation: 'prize', plate: { key: 'machines.plate.try', params: { n: 1 } }, staff: { available: true, highlighted: false } });
    const miss = playRound(r.core, 0.3, -0.6).result;
    expect(miss.machine?.id).toBe('bridge');
    expect(r.director.onResult(miss)).toBe(false);
    expect(r.director.missEvent(miss)).toBe('machine_progress');
    expect(r.director.facts()).toMatchObject({ id: 'bridge', genre: 'bridge', name: 'Tippy Bridge', stuck: false });
    expect(r.director.autoAdvance()).toBeUndefined();
    // Call staff: at a boundary of a player round only; never an award.
    expect(r.director.machineAction('staff')).toBe(true);
    expect(r.sfx).toContain('restock_drop');
    expect(r.host.collection.getState().wins).toBe(0);
    // The box's character is what a win names.
    const box = r.core.field.onField().find((t) => t.item)!;
    expect(prizeTypeOf(box)).toBe(box.item!.print);
    expect(prizeTypeOf({ asset: { id: 'sakura.bunny' } } as ToyBody)).toBe('sakura.bunny');
  });
});

describe('attract mode with several machines (design 4.5)', () => {
  it('the idle reset returns home; no plush restock on genres over 50 rounds, attract and the reset', { timeout: 180_000 }, async () => {
    const r = await rig();
    await switchTo(r, 'rush');
    for (let i = 0; i < 25; i++) {
      playRound(r.core, 0.1 * ((i % 5) - 2), -0.3 - 0.05 * (i % 4));
      expect(r.core.field.missing()).toBe(0);
      r.core.field.clearBin();
      if (r.director.sessionOver()) r.director.newSession();
    }
    r.attract.enter('idle_reset');
    r.director.onIdleReset();
    expect(r.core.field.missing()).toBe(0);
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.director.machineId).toBe('classic');
    expect(r.core.machine.phase).toBe('ATTRACT');
    // The way back home was not announced (nobody is there) and did not press START.
    expect(r.calls.filter((c) => c === 'pressStart')).toHaveLength(1);
    expect(r.guide.filter((g) => g.type === 'machine_selected')).toHaveLength(1);
    await switchTo(r, 'shelf');
    for (let i = 0; i < 25; i++) {
      if (r.core.machine.phase === 'RESULT') r.core.machine.next(false);
      shelfTry(r, false);
      expect(r.core.field.missing()).toBe(0);
      r.core.field.clearBin();
      if (r.director.sessionOver()) r.director.newSession();
    }
  });

  it('the attract cycle visits the offered machines every 3 demo rounds when on, never when off', { timeout: 240_000 }, async () => {
    for (const on of [false, true]) {
      const r = await rig({ settings: (s) => ((s.machines.attractCycle = on), (s.machines.hidden = ['bridge', 'rush'])) });
      expect(r.director.offered().map((d) => d.id)).toEqual(['classic', 'shelf']);
      for (let i = 0; i < 3; i++) {
        demoRound(r);
        r.director.update();
        if (i < 2) expect(r.director.machineId).toBe('classic');
      }
      await r.director.whenSwitched();
      expect(r.director.machineId).toBe(on ? 'shelf' : 'classic');
      expect(r.core.machine.phase).toBe('ATTRACT');
      expect(r.calls).not.toContain('pressStart');
    }
  });
});

describe("today's pick and the lobby cards (design 4.4)", () => {
  it('candidates are offered, unlocked, available machines; never classic', { timeout: 60_000 }, async () => {
    const r = await rig({ allowUnavailable: false });
    // Only classic offered (the others hidden): no pick.
    r.settings.machines.hidden = ['bridge', 'shelf', 'rush'];
    expect(r.director.dailyPick()).toBeNull();
    r.settings.machines.hidden = [];
    expect(['bridge', 'shelf', 'rush']).toContain(r.director.dailyPick());
    r.settings.machines.hidden = ['bridge', 'rush'];
    expect(r.director.dailyPick()).toBe('shelf');
    r.settings.machines.unlock = 'progress';
    expect(r.director.dailyPick()).toBeNull();
    r.settings.machines.unlock = 'open';
    r.settings.machines.dailyPick = false;
    expect(r.director.dailyPick()).toBeNull();
    r.settings.machines.dailyPick = true;
    // Cards: lobby order, today's pick flagged, the current machine marked.
    const cards = r.director.cards();
    expect(cards.map((c) => c.id)).toEqual(['classic', 'shelf']);
    expect(cards[0]).toMatchObject({ current: true, dailyPick: false, locked: false, prizesHere: 0 });
    expect(cards[1]).toMatchObject({ current: false, dailyPick: true });
    r.settings.machines.unlock = 'progress';
    expect(r.director.cards()[1]).toMatchObject({ locked: true, winsToUnlock: 3 });
  });
});

/* ------------------------------------------------------------------ review (round 4B) */

/** Puts one of the machine's items just inside its opening, falling: the running try scores it. */
function dropItem(c: GameCore): ToyBody {
  const o = openingCenter(c.def.geometry.opening);
  const item = c.field.onField().find((t) => t.item)!;
  item.body.setTranslation({ x: o.x, y: o.y + 0.02, z: o.z }, true);
  item.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  item.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return item;
}

/** A player try that scores one item (dropped into the opening while the claw descends). */
function scoringTry(r: Rig, x = 0.1, z = -0.3): RoundResult {
  let dropped = false;
  const result = playRound(r.core, x, z, {
    onStep: (c) => {
      if (dropped || c.machine.phase !== 'DESCENDING') return;
      dropped = true;
      dropItem(c);
    },
  }).result;
  expect(result.machine!.items.length).toBeGreaterThan(0);
  return result;
}

/** Lets resolved promises run (the reward flow applies an answer in a `then`). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Listeners registered on an Emitter (leak checks). */
function listenerCount(emitter: object): number {
  const map = (emitter as unknown as { listeners: Map<string, Set<unknown>> }).listeners;
  let n = 0;
  for (const set of map.values()) n += set.size;
  return n;
}

const ISSUED: IssueResponseBody = { code: 'K7M2QX9D', url: 'http://192.168.1.20:8788/c/K7M2QX9D', reach: 'lan', issuedAt: '2026-11-25T10:00:00.000Z', expiresAt: '2026-11-27T10:00:00.000Z', options: 'both', repeated: false };

describe('review: session prizes and their claim codes', () => {
  it('the session line waits for its code; PLAY AGAIN, a switch or the idle reset while it waits drop it, so it is never spoken over what follows', { timeout: 180_000 }, async () => {
    const r = await rig({ flow: true, settings: (s) => ((s.machines.shelf.tries = 1), (s.machines.shelf.rewardItems = 1)) });
    await switchTo(r, 'shelf');
    const lines = () => r.guide.filter((g) => g.type === 'session_over');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const prizeSession = () => {
        const t = scoringTry(r);
        const card = r.host.ui.getState().sessionResult!;
        expect(card).toMatchObject({ machineId: 'shelf', roundId: t.roundId });
        expect(card.rewardTypeId).not.toBeNull();
        expect(r.host.ui.getState().reward).toMatchObject({ state: 'issuing', roundId: t.roundId });
        return t;
      };
      // PLAY AGAIN while the code is still being issued.
      prizeSession();
      expect(lines()).toHaveLength(0);
      expect(r.director.newSession()).toBe(true);
      r.issues.at(-1)!.answer({ ok: true, body: ISSUED });
      await flush();
      vi.advanceTimersByTime(2000);
      expect(lines()).toHaveLength(0);
      // A switch while it waits (MACHINES on the session card).
      prizeSession();
      expect(r.director.select('classic')).toBe(true);
      expect(await r.director.whenSwitched()).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(lines()).toHaveLength(0);
      // The idle reset: Game resets the rewards first, then tells the director (Game.idleReset).
      await switchTo(r, 'shelf');
      prizeSession();
      r.flow!.reset();
      r.attract.enter('idle_reset');
      r.director.onIdleReset();
      expect(await r.director.whenSwitched()).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(lines()).toHaveLength(0);
      // Control: the code arrives in time, the line goes out once.
      await switchTo(r, 'shelf');
      const t = prizeSession();
      r.issues.at(-1)!.answer({ ok: true, body: ISSUED });
      await flush();
      expect(lines()).toHaveLength(1);
      vi.advanceTimersByTime(2000);
      expect(lines()).toHaveLength(1);
      // Exactly one claim code per session prize, each for its own round id.
      expect(r.issues.map((i) => i.input.roundId)).toEqual(r.rewards.map((x) => x.roundId));
      expect(new Set(r.rewards.map((x) => x.roundId)).size).toBe(4);
      expect(r.rewards.at(-1)!.roundId).toBe(t.roundId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('review: timed runs and rankings', () => {
  it('rush: a piece that falls in after the run has ended plays no score sound (it is not the run’s)', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.rush.rewardValue = 0) });
    await switchTo(r, 'rush');
    scoringTry(r);
    r.core.field.clearBin();
    r.core.machine.next(false);
    r.core.session.setSecondsLeft(0.05);
    idle(r.core, 0.2);
    expect(r.director.sessionOver()).toBe(true);
    expect(r.core.machine.phase).toBe('READY');
    const sfx = r.sfx.length;
    const points = r.host.ui.getState().sessionResult!.points;
    dropItem(r.core);
    idle(r.core, 1);
    // The round machine records it for the dangling round; the run and the sounds ignore it.
    expect(r.core.machine.roundItems.length).toBeGreaterThan(0);
    expect(r.sfx.slice(sfx).filter((n) => n === 'sparkle' || n === 'score_count' || n === 'chute_drop' || n === 'combo')).toEqual([]);
    expect(r.host.ui.getState().sessionResult!.points).toBe(points);
  });

  it('a top-10 place still waiting for initials is saved as ??? when the player switches machine (as PLAY AGAIN does)', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.rush.rewardValue = 0) });
    await switchTo(r, 'rush');
    scoringTry(r);
    r.core.session.setSecondsLeft(0.02);
    idle(r.core, 0.1);
    const entry = r.host.ui.getState().rankEntry!;
    expect(entry).toMatchObject({ machineId: 'rush', position: 1 });
    expect(r.director.select('shelf')).toBe(true);
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.host.ui.getState().rankEntry).toBeNull();
    expect(rankingsOf('rush')).toEqual([{ initials: '???', score: entry.score, at: r.clock.now, difficulty: 'arcade' }]);
  });

  it('ties keep the older run first; a tie with the 10th place does not rank', () => {
    for (let i = 0; i < 10; i++) expect(addRanking('rush', { initials: 'AAA', score: 1000 - i * 10, at: 100 + i, difficulty: 'arcade' })).toBe(i + 1);
    expect(addRanking('rush', { initials: 'BBB', score: 960, at: 500, difficulty: 'arcade' })).toBe(6);
    const board = rankingsOf('rush');
    expect(board).toHaveLength(10);
    expect(board.slice(4, 7).map((e) => [e.initials, e.score])).toEqual([
      ['AAA', 960],
      ['BBB', 960],
      ['AAA', 950],
    ]);
    // The 10th place now holds 920: another 920 does not make it.
    expect(board[9]!.score).toBe(920);
    expect(addRanking('rush', { initials: 'CCC', score: 920, at: 600, difficulty: 'arcade' })).toBeNull();
    expect(rankingsOf('rush').map((e) => e.initials)).not.toContain('CCC');
  });
});

describe('review: attract mode and settings', () => {
  it('the attract cycle skips machines that are still locked and so comes back home', { timeout: 240_000 }, async () => {
    const r = await rig({ settings: (s) => ((s.machines.attractCycle = true), (s.machines.unlock = 'progress')) });
    // One prize collected: the bridge is open, shelf (3) and rush (5) are not.
    r.host.collection.getState().addPrize(themeAssets('sakura')[0]!.id, 'p-1');
    const visited: string[] = [r.director.machineId];
    for (let round = 0; round < 9 && visited.length < 3; round++) {
      demoRound(r);
      r.director.update();
      await r.director.whenSwitched();
      if (r.director.machineId !== visited.at(-1)) visited.push(r.director.machineId);
    }
    expect(visited).toEqual(['classic', 'bridge', 'classic']);
  });

  it('with the lobby off the kiosk is a single machine: the attract cycle stays on home', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => ((s.machines.attractCycle = true), (s.machines.lobby = false), (s.machines.hidden = ['bridge', 'rush'])) });
    for (let i = 0; i < 3; i++) {
      demoRound(r);
      r.director.update();
    }
    await r.director.whenSwitched();
    expect(r.director.machineId).toBe('classic');
  });

  it('a new home machine (Settings → Machines) takes over attract mode at once, not after some later player', { timeout: 120_000 }, async () => {
    const r = await rig();
    expect(r.core.machine.phase).toBe('ATTRACT');
    r.settings.machines.home = 'shelf';
    r.director.onSettingsChanged(['machines.home']);
    r.director.update();
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.director.machineId).toBe('shelf');
    expect(r.core.machine.phase).toBe('ATTRACT');
    expect(r.calls).not.toContain('pressStart');
    expect(r.guide.filter((g) => g.type === 'machine_selected')).toHaveLength(0);
  });

  it('a settings rebuild of the bridge waits for READY: it never wipes the result card (or a win’s claim QR)', { timeout: 120_000 }, async () => {
    const r = await rig();
    await switchTo(r, 'bridge');
    const miss = playRound(r.core, 0.3, -0.6).result;
    expect(r.core.machine.phase).toBe('RESULT');
    r.host.ui.setState({ result: miss });
    r.calls.length = 0;
    r.director.onSettingsChanged(['machines.bridge.gap']);
    r.director.update();
    expect(r.calls).not.toContain('setMachine:bridge');
    expect(r.host.ui.getState().result).not.toBeNull();
    r.core.machine.next(false);
    r.director.update();
    expect(await r.director.whenSwitched()).toBe(true);
    expect(r.calls).toContain('setMachine:bridge');
  });
});

describe('review: many switches', () => {
  it('48 switches over every machine leave no emitter listeners, store subscriptions or timers behind', { timeout: 300_000 }, async () => {
    const r = await rig({ flow: true });
    let subscribed = 0;
    const subscribe = r.host.ui.subscribe;
    r.host.ui.subscribe = ((listener: Parameters<typeof subscribe>[0]) => {
      subscribed++;
      const off = subscribe(listener);
      return () => {
        subscribed--;
        off();
      };
    }) as typeof subscribe;
    const emitters = () => [listenerCount(r.core.machine.events), listenerCount(r.core.controllerEvents), listenerCount(r.core.session.events)];
    const before = emitters();
    const bodies = r.core.phys.world.bodies.len();
    const colliders = r.core.phys.world.colliders.len();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      for (let i = 0; i < 12; i++) for (const id of ['bridge', 'shelf', 'rush', 'classic'] as const) await switchTo(r, id);
      expect(emitters()).toEqual(before);
      expect(subscribed).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      // Classic after 48 switches is a fresh classic (a body per toy, the same static parts).
      expect(r.core.phys.world.bodies.len()).toBe(bodies);
      expect(r.core.phys.world.colliders.len()).toBe(colliders);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('review: bridge staff resets', () => {
  it('Call staff pressed again and again only cycles the seeded start poses: never an award, never a lost latched drop', { timeout: 120_000 }, async () => {
    const r = await rig();
    await switchTo(r, 'bridge');
    const box = r.core.field.onField().find((t) => t.item)!;
    const startPoses = new Set<string>();
    for (let i = 0; i < 20; i++) {
      expect(r.director.machineAction('staff')).toBe(true);
      const p = box.body.translation();
      startPoses.add(`${p.x.toFixed(4)},${p.z.toFixed(4)}`);
      // On the bars, at rest, the same box (nothing was won).
      expect(p.y).toBeGreaterThan(0.1);
      expect(box.inBin).toBe(false);
    }
    expect(r.host.collection.getState().wins).toBe(0);
    expect(r.host.ui.getState().prize).toBeNull();
    expect(startPoses.size).toBeGreaterThan(10);
    // A box that went through the pit between tries waits for its award: staff can not take it back.
    dropItem(r.core);
    idle(r.core, 1);
    expect(r.director.machineAction('staff')).toBe(false);
    const paid = playRound(r.core, 0.2, -0.5);
    expect(paid.awards).toBe(1);
    expect(paid.result.outcome).toBe('won');
    expect(r.host.collection.getState().wins).toBe(1);
  });
});

describe('review: a fresh field mid-session', () => {
  /** What Game.populate does on a theme change (the player's theme button) or Settings → rebuild. */
  function repopulate(r: Rig): void {
    r.core.populate(themeAssets('sakura'), 7);
    r.director.afterPopulate();
  }

  it('rush: a theme change mid-run does not hand the player a full pile with the clock and the points running on; the run starts over', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.rush.rewardValue = 0) });
    await switchTo(r, 'rush');
    const diamonds = () => r.core.field.onField().filter((t) => t.item?.look === 'gemDiamond').length;
    const full = diamonds();
    // The player scores a diamond…
    let dropped = false;
    playRound(r.core, 0.1, -0.3, {
      onStep: (c) => {
        if (dropped || c.machine.phase !== 'DESCENDING') return;
        dropped = true;
        const d = c.field.onField().find((t) => t.item?.look === 'gemDiamond')!;
        const o = openingCenter(c.def.geometry.opening);
        d.body.setTranslation({ x: o.x, y: o.y + 0.02, z: o.z }, true);
        d.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
      },
    });
    r.core.field.clearBin();
    expect(diamonds()).toBe(full - 1);
    const before = r.core.session.snapshot();
    expect(before).toMatchObject({ state: 'running', tries: 1, timerStarted: true });
    expect(before.value).toBeGreaterThanOrEqual(150);
    r.core.machine.next(false);
    // …then changes the theme between tries: the pile is full again.
    repopulate(r);
    expect(diamonds()).toBe(full);
    const after = r.core.session.snapshot();
    expect(after).toMatchObject({ state: 'running', tries: 0, value: 0, items: 0, timerStarted: false, secondsLeft: 75 });
    expect(after.id).toBe(before.id + 1);
    expect(r.core.machine.phase).toBe('READY');
    expect(r.host.ui.getState().machine.session.points).toBe(0);
  });

  it('shelf: the same for a tries session; nothing changes before the first try, after the session or on the bridge', { timeout: 120_000 }, async () => {
    const r = await rig({ settings: (s) => (s.machines.shelf.tries = 3) });
    await switchTo(r, 'shelf');
    const fresh = r.core.session.snapshot();
    repopulate(r);
    expect(r.core.session.snapshot()).toMatchObject({ id: fresh.id, state: 'running', tries: 0 });
    scoringTry(r);
    r.core.field.clearBin();
    r.core.machine.next(false);
    repopulate(r);
    expect(r.core.session.snapshot()).toMatchObject({ id: fresh.id + 1, state: 'running', tries: 0, items: 0 });
    // A session that is over keeps its card (PLAY AGAIN starts the next one).
    for (let i = 0; i < 3; i++) playRound(r.core, 0.1, -0.3);
    expect(r.director.sessionOver()).toBe(true);
    const card = r.host.ui.getState().sessionResult;
    repopulate(r);
    expect(r.director.sessionOver()).toBe(true);
    expect(r.host.ui.getState().sessionResult).toEqual(card);
    // The bridge's open session simply goes on (a fresh box only loses progress).
    await switchTo(r, 'bridge');
    playRound(r.core, 0.3, -0.6);
    const open = r.core.session.snapshot();
    repopulate(r);
    expect(r.core.session.snapshot()).toMatchObject({ id: open.id, tries: open.tries, state: 'running' });
  });
});
