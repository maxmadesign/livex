/**
 * TUMBLE SHELF with real physics (docs/design/machines.md, sections 3.2 and 8.1): the designed
 * geometry, stacks that stand still, the trough and the gutter that drains into it, item awards
 * (several per try, each once, a late fall counts for the next try), the forward transport, the
 * five-try session and its prize, the takeover restack and the attract refill.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RoundResult } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { SHELF_DEFAULTS, ShelfRules, shelfAim, shelfGeometry, shelfModule } from '../../../src/game/machines/shelf';
import { rarestPrint } from '../../../src/game/machines/pieces';
import type { ResolvedMachine, ScoredItem, SessionSnapshot, ShelfParams } from '../../../src/game/machines/types';
import type { ItemScore, PrizeAward } from '../../../src/game/RoundMachine';
import { BIN_FOOTPRINT, fixtureBounds, validateGeometry } from '../../../src/physics/fieldGeometry';
import { CLAW, FIXED_DT } from '../../../src/physics/fieldSpec';
import { RAPIER, type ToyBody } from '../../../src/physics/PhysicsWorld';
import { resolveMachine } from '../../../src/game/machines/registry';
import { idle, inspectWorld, makeCore, playRound, roundParams, themeAssets } from '../game/harness';
import { counts, poseHash } from './goldenScenario';

/** The shelf machine straight from its module (whatever the registry says about it). */
function shelfMachine(params: Partial<ShelfParams> = {}): ResolvedMachine {
  const p = { ...SHELF_DEFAULTS, ...params };
  return {
    def: { id: 'shelf', genre: 'shelf', order: 2, params: {}, available: false, unlockAfterWins: 3 },
    module: shelfModule,
    params: p,
    geometry: shelfModule.geometry(p),
    session: shelfModule.session(p),
    controls: shelfModule.controls(p),
  } as unknown as ResolvedMachine;
}

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function shelf(seed = 7, params: Partial<ShelfParams> = {}): Promise<GameCore> {
  const c = await makeCore({ theme: 'sakura', seed, machine: shelfMachine(params) });
  cores.push(c);
  return c;
}

const com = (t: ToyBody) => {
  const c = t.body.worldCom();
  return { x: c.x, y: c.y, z: c.z };
};
/** Largest displacement of any body over `seconds` of idling. */
function maxMove(c: GameCore, seconds: number): number {
  const before = new Map([...c.phys.toys.values()].map((t) => [t.id, com(t)]));
  idle(c, seconds);
  let worst = 0;
  for (const t of c.phys.toys.values()) {
    const a = before.get(t.id)!;
    const b = com(t);
    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return worst;
}
/** The boxes of the stack nearest (x, z), bottom first. */
function stackAt(c: GameCore, x: number, z: number): ToyBody[] {
  return c.field
    .onField()
    .filter((t) => Math.hypot(com(t).x - x, com(t).z - z) < 0.03)
    .sort((a, b) => com(a).y - com(b).y);
}
/** Steps until `done` (or the cap, in simulated seconds). */
function stepUntil(c: GameCore, done: () => boolean, seconds = 10): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !done(); i++) c.fixedStep();
}

describe('shelf geometry', () => {
  it('is the designed layout: shelf block, lip, the trough inside the bin footprint, a gutter sloping down to it', () => {
    const g = shelfGeometry(SHELF_DEFAULTS);
    expect(validateGeometry(g)).toEqual([]);
    expect(g.opening).toMatchObject({ xMin: -0.5, xMax: 0, zMin: -0.3, zMax: 0, sensorTop: -0.1, sensorBottom: -0.3, awardComY: -0.06 });
    expect(g.opening.xMin).toBeGreaterThanOrEqual(BIN_FOOTPRINT.xMin);
    expect(g.opening.zMin).toBeGreaterThanOrEqual(BIN_FOOTPRINT.zMin);
    expect(g.floor).toEqual({ kind: 'hole', hole: { xMin: -0.5, xMax: 0, zMin: -0.3, zMax: 0 } });
    expect(g.chuteGuard).toBe(false);
    expect(g.fixtures.map((f) => f.id)).toEqual(['shelf', 'lip', 'gutter']);
    const shelfBox = fixtureBounds(g.fixtures[0]!);
    expect(shelfBox.max[1]).toBeCloseTo(0.16, 6);
    expect(shelfBox.max[2]).toBeCloseTo(-0.3, 6);
    expect(fixtureBounds(g.fixtures[1]!).max[1]).toBeCloseTo(0.174, 6);
    // The gutter's top surface: y 0.02 where it meets the trough (x 0), y 0.10 at the right glass.
    const gutter = g.fixtures[2]!;
    expect(gutter.frictionCombine).toBe('min');
    const [qx, qy, qz, qw] = gutter.rot!;
    void qx;
    void qy;
    const angle = 2 * Math.atan2(qz, qw);
    const half = gutter.shape.type === 'box' ? gutter.shape.half : [0, 0, 0];
    const top = (sx: number) => [gutter.center[0] + sx * half[0] * Math.cos(angle) - half[1] * Math.sin(angle), gutter.center[1] + sx * half[0] * Math.sin(angle) + half[1] * Math.cos(angle)];
    expect(top(-1)[0]).toBeCloseTo(0, 3);
    expect(top(-1)[1]).toBeCloseTo(0.02, 3);
    expect(top(1)[0]).toBeCloseTo(0.5, 3);
    expect(top(1)[1]).toBeCloseTo(0.1, 3);
    // The slope is steeper than the friction angle of the slick surface (Min combine with 0.05).
    expect(Math.atan(gutter.friction)).toBeLessThan(angle);
    // No lip at lipHeight 0.
    expect(shelfGeometry({ ...SHELF_DEFAULTS, lipHeight: 0 }).fixtures.map((f) => f.id)).toEqual(['shelf', 'gutter']);
  });

  it('builds the fixtures with the Min friction rule on the gutter only', { timeout: 60_000 }, async () => {
    const c = await shelf();
    const rules = new Map<string, number>();
    c.phys.world.forEachCollider((col) => {
      const kind = c.phys.staticKind(col.handle);
      if (kind === 'gutter' || kind === 'shelf' || kind === 'lip') rules.set(kind, col.frictionCombineRule());
    });
    expect(rules.get('gutter')).toBe(RAPIER.CoefficientCombineRule.Min);
    expect(rules.get('shelf')).toBe(RAPIER.CoefficientCombineRule.Average);
    expect(rules.get('lip')).toBe(RAPIER.CoefficientCombineRule.Average);
  });
});

describe('shelf field', () => {
  it('stacks 23 printed snack boxes in 8 stacks, below the claw\'s travel clearance', { timeout: 60_000 }, async () => {
    const c = await shelf(11);
    const items = c.field.onField();
    expect(items).toHaveLength(23);
    const looks = (l: string) => items.filter((t) => t.item?.look === l).length;
    expect([looks('snackS'), looks('snackM'), looks('snackL')]).toEqual([15, 6, 2]);
    for (const t of items) {
      expect(t.item?.kind).toBe('snack');
      expect(t.item?.print?.startsWith('sakura.')).toBe(true);
      expect(t.inBin).toBe(false);
      const top = t.body.translation().y + t.item!.size[1];
      expect(top).toBeLessThanOrEqual(0.341);
      expect(com(t).y).toBeGreaterThan(SHELF_DEFAULTS.shelfY);
    }
    // Small boxes carry common / rare prints, large ones rare or better.
    for (const t of items.filter((t) => t.item?.look === 'snackS')) expect(['sakura.bunny', 'sakura.capybara', 'sakura.sakuracat', 'sakura.tanuki']).toContain(t.item!.print);
    for (const t of items.filter((t) => t.item?.look === 'snackL')) expect(['sakura.bunny', 'sakura.capybara']).not.toContain(t.item!.print);
    expect(c.field.missing()).toBe(0);
    expect(c.field.restockOne()).toBeNull();
    expect(inspectWorld(c)).toEqual([]);
  });

  it('fills deterministically per seed', { timeout: 60_000 }, async () => {
    const a = await shelf(21);
    const b = await shelf(21);
    const d = await shelf(22);
    expect(poseHash(a)).toBe(poseHash(b));
    expect(poseHash(d)).not.toBe(poseHash(a));
  });

  it('stacks stand still: no box moves 2 mm in 5 s idle, fresh or restacked', { timeout: 120_000 }, async () => {
    for (const seed of [11, 28, 45]) {
      const c = await shelf(seed);
      expect(maxMove(c, 5), `seed ${seed} fill`).toBeLessThan(0.002);
      for (let r = 0; r < 2; r++) {
        c.field.resetForTakeover!();
        c.settle(1.5);
        expect(maxMove(c, 5), `seed ${seed} restack ${r + 1}`).toBeLessThan(0.002);
      }
    }
  });

  it('a takeover restacks the start layout; attract mode refills below 60 %, READY never does', { timeout: 60_000 }, async () => {
    const c = await shelf(7);
    const colliders = c.phys.world.colliders.len();
    // Knock four boxes into the trough and play on.
    for (const t of c.field.onField().slice(0, 4)) {
      t.body.setTranslation({ x: -0.25, y: 0.05, z: -0.12 }, true);
      t.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
    }
    playRound(c, 0.1, -0.4);
    c.field.clearBin();
    expect(c.field.onField().length).toBeLessThan(23);
    expect(c.field.atBoundary!('READY', false)).toBe(0);
    expect(c.field.atBoundary!('ATTRACT', true)).toBe(0); // still more than 60 % left
    expect(c.field.resetForTakeover!()).toBe(23);
    c.settle(1.5);
    expect(c.phys.world.colliders.len()).toBe(colliders);
    expect(c.field.onField().every((t) => com(t).y > SHELF_DEFAULTS.shelfY)).toBe(true);
    // Fewer than 60 % left (13 of 23): attract mode restacks.
    for (const t of c.field.onField().slice(0, 10)) c.phys.removeToy(t);
    expect(c.field.atBoundary!('READY', false)).toBe(0);
    expect(c.field.atBoundary!('ATTRACT', true)).toBe(23);
    expect(c.field.onField()).toHaveLength(23);
  });
});

describe('shelf tries', () => {
  it('one push over the lip delivers N boxes: N scored items with distinct ids and one won result', { timeout: 60_000 }, async () => {
    const c = await shelf(7);
    // Only the front stack at x -0.3 stays, so the claw (aimed at an empty spot) cannot add any.
    const keep = stackAt(c, -0.3, -0.39);
    expect(keep.length).toBeGreaterThanOrEqual(2);
    for (const t of c.field.onField()) if (!keep.includes(t)) c.phys.removeToy(t);
    const scored: ItemScore[] = [];
    c.machine.events.on('item', (e) => scored.push(e));
    let pushed = false;
    const trace = playRound(c, 0.3, -0.55, {
      onStep: (core) => {
        if (pushed || core.machine.phase !== 'DESCENDING') return;
        pushed = true;
        // Up a little too: the 14 mm lip stops a box that only slides.
        for (const t of keep) t.body.setLinvel({ x: 0, y: 0.9, z: 1.3 }, true);
      },
    });
    expect(trace.result.outcome).toBe('won');
    expect(trace.result.machine!.items.map((i) => i.toyId).sort()).toEqual(keep.map((t) => t.id).sort());
    expect(scored).toHaveLength(keep.length);
    expect(new Set(scored.map((s) => s.toyId)).size).toBe(keep.length);
    expect(scored.every((s) => s.roundId === trace.result.roundId && !s.demo)).toBe(true);
    expect(trace.result.machine!.items.map((i) => i.index)).toEqual(keep.map((_, i) => i + 1));
    expect(trace.awards).toBe(0); // items are points, not prizes
    expect(keep.every((t) => t.inBin)).toBe(true);
  });

  it('nothing that leaves the shelf comes to rest outside the opening: the gutter drains into the trough', { timeout: 60_000 }, async () => {
    const c = await shelf(7);
    const boxes = c.field.onField().slice(0, 9);
    const xs = [-0.45, -0.3, -0.15, -0.02, 0.05, 0.15, 0.25, 0.35, 0.45];
    c.machine.start(false); // a player READY: items score in READY … SETTLING
    const scored = new Set<string>();
    c.controller.events.on('itemScored', (e) => scored.add(e.toy.id));
    boxes.forEach((t, i) => {
      t.body.setTranslation({ x: xs[i]!, y: 0.24, z: -0.15 }, true);
      t.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    stepUntil(c, () => scored.size === boxes.length, 6);
    expect([...scored].sort()).toEqual(boxes.map((t) => t.id).sort());
    expect(c.machine.phase).toBe('READY');
    expect(inspectWorld(c)).toEqual([]);
  });

  it('a box that falls during RESULT is credited at the next READY, to the next try', { timeout: 60_000 }, async () => {
    const c = await shelf(7);
    const first = playRound(c, 0.1, -0.53);
    const box = c.field.onField().find((t) => com(t).z < -0.45)!;
    expect(c.machine.phase).toBe('RESULT');
    box.body.setTranslation({ x: -0.25, y: 0.02, z: -0.15 }, true);
    box.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
    idle(c, 0.6);
    expect(com(box).y).toBeLessThan(-0.1);
    expect(box.inBin).toBe(false); // RESULT never scores
    const second: RoundResult[] = [];
    c.machine.events.on('result', (r) => second.push(r));
    c.machine.next(false);
    c.fixedStep();
    expect(box.inBin).toBe(true);
    expect(c.machine.roundItems.map((i) => i.toyId)).toEqual([box.id]);
    const trace = playRound(c, 0.3, -0.39);
    expect(trace.result.roundId).toBe(first.result.roundId + 1);
    expect(trace.result.machine!.items[0]!.toyId).toBe(box.id);
    expect(trace.result.outcome).toBe('won');
  });

  it('carries forward to dropZ in the same lane and opens there; outcomes are only won or empty', { timeout: 120_000 }, async () => {
    const c = await shelf(28);
    for (let i = 0; i < 4; i++) {
      const plan = shelfAim(c, i, SHELF_DEFAULTS)!;
      let at: { x: number; z: number } | null = null;
      const trace = playRound(c, plan.x, plan.z, {
        settleSwing: plan.patience,
        onStep: (core) => {
          if (!at && core.machine.phase === 'RELEASING') at = { x: core.claw.trolleyX, z: core.claw.trolleyZ };
        },
      });
      expect(at).not.toBeNull();
      expect(at!.z).toBeCloseTo(SHELF_DEFAULTS.dropZ, 2);
      expect(Math.abs(at!.x - plan.x)).toBeLessThan(0.012);
      expect(['won', 'empty']).toContain(trace.result.outcome);
      expect(trace.result.outcome === 'won').toBe(trace.result.machine!.items.length > 0);
      expect(trace.result.slipReason).toBeNull();
      expect(trace.recoveries).toEqual([]);
      c.field.clearBin();
    }
    expect(inspectWorld(c)).toEqual([]);
    const rules = c.controller.rules as ShelfRules;
    expect(rules).toBeInstanceOf(ShelfRules);
    expect(rules.liftTarget(c.controller.tryContext)).toBe(CLAW.ropeMin);
  });

  it('items per grab: one box or a few, not a whole stack every time (pilot, two fields)', { timeout: 120_000 }, async () => {
    const counts: number[] = [];
    for (const seed of [11, 45]) {
      const c = await shelf(seed);
      for (let i = 0; i < 10; i++) {
        if (c.session.snapshot().state === 'over') c.session.newSession();
        const plan = shelfAim(c, i, SHELF_DEFAULTS)!;
        counts.push(playRound(c, plan.x, plan.z, { settleSwing: plan.patience }).result.machine!.items.length);
        idle(c, 1.15);
        c.field.clearBin();
      }
      expect(inspectWorld(c)).toEqual([]);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(2);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
    expect(counts.filter((n) => n >= 3).length / counts.length).toBeLessThan(0.5);
  });
});

describe('shelf session', () => {
  it('five tries end the session; three boxes earn one prize, the rarest print; then the claw is locked', { timeout: 120_000 }, async () => {
    const c = await shelf(7);
    const over: SessionSnapshot[] = [];
    const awards: PrizeAward[] = [];
    const items: ScoredItem[] = [];
    c.session.events.on('over', (s) => over.push(s));
    c.machine.events.on('award', (a) => awards.push(a));
    c.machine.events.on('item', (e) => items.push({ ...e, look: e.look as ScoredItem['look'] }));
    // The first try pushes a whole front stack over the lip, so the session surely reaches three.
    const front = stackAt(c, 0.1, -0.39);
    let pushed = false;
    let last: RoundResult | null = null;
    for (let i = 0; i < 5; i++) {
      expect(c.session.snapshot().state === 'over').toBe(false);
      last = playRound(c, -0.3, -0.53, {
        onStep: (core) => {
          if (pushed || core.machine.phase !== 'DESCENDING') return;
          pushed = true;
          for (const t of front) t.body.setLinvel({ x: 0, y: 0.9, z: 1.3 }, true);
        },
      }).result;
      idle(c, 1.15);
      c.field.clearBin();
    }
    expect(over).toHaveLength(1);
    const s = over[0]!;
    expect(s).toMatchObject({ state: 'over', reason: 'tries', tries: 5, triesTotal: 5, machineId: 'shelf' });
    expect(s.items).toBe(items.length);
    expect(s.items).toBeGreaterThanOrEqual(3);
    const expected = rarestPrint(items);
    expect(s.reward).toMatchObject({ typeId: expected, prizeId: `test-${last!.roundId}-S`, roundId: last!.roundId });
    expect(awards.filter((a) => a.session)).toHaveLength(1);
    expect(awards).toHaveLength(1);
    // Locked: no sixth try, and a box that falls in now changes nothing for this session.
    expect(c.controller.inputLocked).toBe(true);
    c.machine.next(false);
    expect(c.controller.requestGrab()).toBe(false);
    const late = c.field.onField()[0]!;
    late.body.setTranslation({ x: -0.25, y: 0.03, z: -0.15 }, true);
    late.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
    idle(c, 1);
    expect(c.session.snapshot()).toMatchObject({ state: 'over', items: s.items, value: s.value, reward: s.reward });
    expect(awards).toHaveLength(1);
    // PLAY AGAIN: fresh stacks, unlocked, a new session at the next READY.
    c.session.newSession();
    expect(c.field.onField()).toHaveLength(23);
    expect(c.controller.inputLocked).toBe(false);
    c.machine.abort('play_again', 'READY');
    expect(c.session.snapshot()).toMatchObject({ state: 'running', tries: 0, items: 0, reward: null });
  });

  it('a session below rewardItems earns nothing; demo rounds never start one', { timeout: 120_000 }, async () => {
    const c = await shelf(7, { tries: 2, rewardItems: 30 });
    const over: SessionSnapshot[] = [];
    c.session.events.on('over', (s) => over.push(s));
    playRound(c, 0.3, -0.53, { demo: true });
    expect(c.session.snapshot()).toMatchObject({ state: 'idle', tries: 0 });
    c.machine.toAttract();
    playRound(c, 0.3, -0.53);
    playRound(c, -0.1, -0.39);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ reason: 'tries', tries: 2, reward: null });
  });
});

describe('shelf pilot', () => {
  it('drags the box nearest the lip; every third demo round goes for a back-row stack top', { timeout: 60_000 }, async () => {
    const c = await shelf(7);
    const plan = shelfAim(c, 0, SHELF_DEFAULTS)!;
    const target = c.phys.toys.get(plan.targetToyId!)!;
    const front = Math.max(...c.field.onField().map((t) => com(t).z));
    expect(com(target).z).toBeCloseTo(front, 6);
    expect(plan.z).toBeCloseTo(com(target).z + 0.04, 6);
    expect(plan.x).toBeCloseTo(com(target).x, 6);
    expect(plan.patience).toBe(1.5);
    const back = shelfAim(c, 2, SHELF_DEFAULTS)!;
    const backTarget = c.phys.toys.get(back.targetToyId!)!;
    expect(com(backTarget).z).toBeLessThan(-0.46);
    expect(back.z).toBeCloseTo(com(backTarget).z, 6);
    for (const p of [plan, back]) {
      expect(p.x).toBeGreaterThanOrEqual(CLAW.minX);
      expect(p.x).toBeLessThanOrEqual(CLAW.maxX);
      expect(p.z).toBeGreaterThanOrEqual(CLAW.minZ);
      expect(p.z).toBeLessThanOrEqual(CLAW.maxZ);
    }
    // Nothing left on the shelf: no plan.
    for (const t of c.field.onField()) c.phys.removeToy(t);
    expect(shelfAim(c, 0, SHELF_DEFAULTS)).toBeNull();
  });
});

describe('machine switch', () => {
  it('classic → shelf → classic: classic is a fresh classic again; ids never repeat', { timeout: 120_000 }, async () => {
    const fresh = await makeCore({ theme: 'gpu', seed: 3 });
    cores.push(fresh);
    const c = await makeCore({ theme: 'gpu', seed: 3 });
    cores.push(c);
    const field = { count: 18, scale: 0.92, density: 0.2, massScale: 1, seed: 3 };
    c.setMachine(shelfMachine(), { assets: themeAssets('gpu'), seed: 3, params: roundParams('arcade'), field });
    expect(c.def.def.id).toBe('shelf');
    expect(c.phys.field.fixtures.map((f) => f.id)).toEqual(['shelf', 'lip', 'gutter']);
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e2-item-'))).toBe(true);
    expect(c.field.onField().every((t) => t.item?.print?.startsWith('gpu.'))).toBe(true);
    playRound(c, 0.1, -0.35);
    c.machine.toAttract();
    c.setMachine(resolveMachine('classic'), { assets: themeAssets('gpu'), seed: 3, params: roundParams('arcade'), field });
    expect(poseHash(c)).toBe(poseHash(fresh));
    expect(counts(c)).toEqual(counts(fresh));
    expect([...c.phys.toys.keys()].every((id) => id.startsWith('e3-toy-'))).toBe(true);
    expect(c.controller.rules).toBeNull();
  });
});
