/**
 * The machine director with a fake host around a real GameCore (docs/design/machines.md, section
 * 8.1, WS-D): the switch sequence, settlement, session prizes, rankings, today's pick, the guide
 * policy, the idle reset back home and the attract cycle.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameStore } from '../../../src/app/gameStore';
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
import { makeCore, playRound, roundParams, themeAssets } from '../game/harness';
import { installMemoryStorage } from '../settings/memoryStorage';

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
}

/** A real core and the director around it, with a host that records what the game would do. */
async function rig(options: { settings?: (s: Settings) => void; allowUnavailable?: boolean } = {}): Promise<Rig> {
  const core = await makeCore({ theme: 'sakura', seed: 7 });
  cores.push(core);
  const settings = defaultSettings();
  options.settings?.(settings);
  const ui = createGameStore('desktop', true, 'sakura');
  const collection = createCollectionStore();
  const scores = new ScoreKeeper();
  const attract = new AttractDirector(core);
  const r: Partial<Rig> = { core, attract, calls: [], guide: [], rewards: [], sfx: [], toasts: [], settings, clock: { now: 1_000_000, today: '2026-11-25' }, results: [] };
  const rr = r as Rig;
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
    requestReward: (roundId, typeId) => rr.rewards.push({ roundId, typeId }),
    cardShown: () => rr.calls.push('cardShown'),
    resetRewards: () => undefined,
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
    // Not offered yet (available: false) and no debug override.
    expect(r.director.select('shelf')).toBe(false);
    expect(r.director.select('nope')).toBe(false);
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
  it('the idle reset returns home; no plush restock on genres over many rounds, attract and the reset', { timeout: 180_000 }, async () => {
    const r = await rig();
    await switchTo(r, 'rush');
    for (let i = 0; i < 8; i++) {
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
    for (let i = 0; i < 12; i++) {
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
    // Nothing but classic is offered yet: no pick.
    expect(r.director.dailyPick()).toBeNull();
    r.director.setAllowUnavailable(true);
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
