import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { awards, boot, click, collection, ff, ffUntil, finishRound, frames, plush, results, state, watch, winARound } from './helpers';

/**
 * The machine framework's app glue (docs/design/machines.md, workstream D) in the real game:
 * switching classic → Tumble Shelf → classic behind the curtain leaves nothing behind (physics
 * objects, GPU geometries), every items try is settled exactly once, a qualifying session earns one
 * prize with one claim code, and classic still plays and wins after the round trip. A Tippy Bridge
 * drop takes classic's win path with the printed character.
 *
 * The machines are not offered to players yet (their cabinets are not drawn), so the spec uses the
 * debug override (`selectMachine(id, { includeUnavailable: true })`).
 *
 * PLUSH_GLUE_SHOTS=<folder> also saves screenshots there.
 */
const SHOTS = process.env.PLUSH_GLUE_SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await frames(page, 2);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

/** Physics objects and GPU resources (as 19-stability splits them: toy colliders vs everything else). */
const counts = (page: Page) =>
  plush(page, (p) => {
    const phys = p.game.core.phys;
    let toyColliders = 0;
    let proxies = 0;
    let stale = 0;
    for (const t of phys.toys.values()) {
      toyColliders += t.colliders.length;
      proxies += t.asset.proxies.length;
      for (const c of t.colliders) if (!phys.world.getCollider(c.collider.handle)) stale++;
    }
    const b = p.bodies();
    return { ...p.memory(), ...b, toyColliders, proxies, stale, otherColliders: b.colliders - toyColliders, otherBodies: b.bodies - b.toys } as Record<string, number>;
  });

const machine = (page: Page) => plush(page, (p) => p.machine());
const settlements = (page: Page): Promise<{ roundId: number; machineId: string; demo: boolean; items: number; total: number }[]> => plush(page, (p) => p.machineDebug.settlements());

/** Aims like the shelf's attract pilot: the box nearest the lip, 4 cm in front of it. */
async function aimAtShelf(page: Page): Promise<{ x: number; z: number }> {
  const at = await plush(page, (p) => {
    const core = p.core();
    const C = p.claw;
    let best: { x: number; z: number } | null = null;
    for (const t of core.phys.toys.values()) {
      if (!t.item || t.inBin) continue;
      const c = t.body.worldCom();
      if (c.y < 0.16 || c.z > -0.28 || c.x < C.minX || c.x > C.maxX) continue;
      if (!best || c.z > best.z) best = { x: c.x, z: c.z };
    }
    const aim = best ?? { x: 0.1, z: -0.4 };
    const x = Math.min(C.maxX, Math.max(C.minX, aim.x));
    const z = Math.min(C.maxZ, Math.max(C.minZ, aim.z + 0.04));
    p.placeClaw(x, z);
    return { x, z };
  });
  await ff(page, 0.25);
  return at;
}

test.describe('29. machines: app glue', () => {
  test('classic → shelf → classic: no leaks, one settlement per try, one session prize and code, classic still wins', async ({ page }) => {
    test.setTimeout(1_200_000);
    const w = watch(page);
    // No demo rounds: the classic baseline is the untouched field.
    await boot(page, { display: 'desktop', settings: { system: { attractDemo: false }, rewards: { mode: 'all' }, machines: { shelf: { tries: 3, rewardItems: 1 } } } });
    await frames(page, 2);
    const base = await counts(page);
    const before = await collection(page);
    expect((await machine(page)).id).toBe('classic');
    // Not offered to players yet: refused without the debug override; nothing changed.
    expect(await plush(page, (p) => p.selectMachine('shelf'))).toBe(false);
    expect((await machine(page)).id).toBe('classic');

    // From attract mode: the switch happens behind the curtain and the player's round starts on the shelf.
    expect(await plush(page, (p) => p.selectMachine('shelf', { includeUnavailable: true }))).toBe(true);
    const m = await machine(page);
    expect(m).toMatchObject({ id: 'shelf', genre: 'shelf', presentation: 'items', session: { kind: 'tries', state: 'running', triesTotal: 3 } });
    expect(m.ui).toMatchObject({ id: 'shelf', switching: false, plate: { key: 'machines.plate.tries', params: { left: 3, total: 3 } } });
    expect(await plush(page, (p) => ({ busy: p.ui().themeBusy, paused: p.state().paused }))).toEqual({ busy: false, paused: false });
    let s = await state(page);
    expect(s.phase).toBe('READY');
    expect(s.toys.every((t) => t.type.startsWith('item.'))).toBe(true);
    const onShelf = await counts(page);
    await shot(page, 'shelf-ready');

    // Three tries. A box is dropped into the trough by hand before the first one (in READY: it counts
    // for that try), so the session surely reaches rewardItems 1.
    await plush(page, (p) => {
      const box = [...p.core().phys.toys.values()].find((t: any) => t.item && !t.inBin && t.body.worldCom().y > 0.16);
      box.body.setTranslation({ x: -0.25, y: 0.06, z: -0.15 }, true);
      box.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
    });
    await ff(page, 1);
    const tries: any[] = [];
    for (let i = 0; i < 3; i++) {
      expect(await ffUntil(page, ['READY', 'AIMING'], 10)).toMatch(/READY|AIMING/);
      await aimAtShelf(page);
      const n = (await results(page)).length;
      await click(page, 'grab');
      const r = await finishRound(page, n);
      expect(r, `try ${i + 1} finished`).toBeTruthy();
      tries.push(r);
      // Items tries show the try toast, never the classic result card.
      expect(await plush(page, (p) => p.ui().result)).toBeNull();
      const settled = (await settlements(page)).filter((x) => !x.demo);
      expect(settled.map((x) => x.roundId)).toEqual(tries.map((t) => t.roundId));
    }
    expect(tries[0].machine.items.length).toBeGreaterThanOrEqual(1);
    const settled = (await settlements(page)).filter((x) => !x.demo);
    expect(settled.map((x) => x.items)).toEqual(tries.map((t) => t.machine.items.length));
    const points = settled.reduce((a, x) => a + x.total, 0);
    expect((await plush(page, (p) => p.score())).player.session).toBe(points);
    // The session is over: its card, one session prize, one claim code for its last try.
    await ff(page, 3);
    expect((await state(page)).phase).toBe('RESULT');
    const card = await plush(page, (p) => p.ui().sessionResult);
    expect(card).toMatchObject({ machineId: 'shelf', reason: 'tries', roundId: tries[2].roundId, points });
    expect(card.rewardTypeId).toMatch(/^sakura\./);
    const prizeAwards = (await awards(page)).filter((a) => !a.demo);
    expect(prizeAwards).toHaveLength(1);
    expect(prizeAwards[0]).toMatchObject({ session: true, roundId: tries[2].roundId, typeId: card.rewardTypeId, prizeId: expect.stringMatching(/-S$/) });
    const after = await collection(page);
    expect(after.wins).toBe(before.wins + 1);
    expect(after.counts[card.rewardTypeId]).toBe((before.counts[card.rewardTypeId] ?? 0) + 1);
    expect(await plush(page, (p) => p.game.deps.collection.getState().machineWins)).toEqual({ shelf: 1 });
    const reward = await plush(page, (p) => p.ui().reward);
    expect(reward.roundId).toBe(tries[2].roundId);
    expect(['issuing', 'ready', 'unavailable']).toContain(reward.state);
    await shot(page, 'shelf-session-over');

    // Back to classic from the session card: a fresh classic field, nothing left behind.
    expect(await plush(page, (p) => p.selectMachine('classic'))).toBe(true);
    expect(await machine(page)).toMatchObject({ id: 'classic', presentation: 'prize', rules: null });
    expect(await plush(page, (p) => p.ui().sessionResult)).toBeNull();
    s = await state(page);
    expect(s.phase).toBe('READY');
    expect(s.toys.some((t) => t.type.startsWith('item.'))).toBe(false);
    await ff(page, 1.5);
    await frames(page, 2);
    const back = await counts(page);
    console.log(`classic ${JSON.stringify(base)}\nshelf   ${JSON.stringify(onShelf)}\nclassic ${JSON.stringify(back)}`);
    for (const k of ['toys', 'bodies', 'otherBodies', 'otherColliders', 'joints', 'toyColliders']) expect(back[k], `${k} back to the classic level`).toBe(base[k]);
    expect(back.toyColliders).toBe(back.proxies);
    expect(back.stale).toBe(0);
    expect(Math.abs(back.geometries - base.geometries), 'GPU geometries back to the classic level').toBeLessThanOrEqual(6);
    expect(Math.abs(back.textures - base.textures), 'GPU textures back to the classic level').toBeLessThanOrEqual(6);
    await shot(page, 'classic-after-round-trip');

    // Classic still plays and wins, through its own path (no machine facts, no machine on the prize).
    const { result } = await winARound(page, 8);
    expect(result.machine).toBeUndefined();
    const win = (await awards(page)).filter((a) => !a.demo).at(-1);
    expect(win).toMatchObject({ roundId: result.roundId, typeId: result.targetTypeId });
    expect(win.session).toBeUndefined();
    expect(win.typeId).toMatch(/^sakura\./);
    expect((await collection(page)).wins).toBe(after.wins + 1);
    expect(await plush(page, (p) => p.game.deps.collection.getState().machineWins)).toEqual({ shelf: 1 });
    // Round ids kept counting across both switches.
    const ids = (await results(page)).map((r: any) => r.roundId);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('a Tippy Bridge drop takes the classic win path with the printed character; the idle reset returns home', async ({ page }) => {
    test.setTimeout(900_000);
    const w = watch(page);
    await boot(page, { display: 'desktop', settings: { rewards: { mode: 'all' } } });
    const before = await collection(page);
    expect(await plush(page, (p) => p.selectMachine('bridge', { includeUnavailable: true }))).toBe(true);
    expect(await machine(page)).toMatchObject({ id: 'bridge', presentation: 'prize', session: { kind: 'open', state: 'running' } });
    expect((await state(page)).phase).toBe('READY');
    // docs/machines/bridge.md, "Debug impulses": nudge the box until it has fallen (READY: no award
    // yet), then drop the claw: the fallen box is paid at that grab. A box that stays jammed is put
    // back by "Call staff" and the recipe is run again.
    const boxY = () => plush(page, (p) => p.machineDebug.itemPoses().find((i: any) => i.look === 'bridgeBox')?.pos[1] ?? -1);
    let fell = false;
    for (let attempt = 0; attempt < 3 && !fell; attempt++) {
      if (attempt > 0) expect(await plush(page, (p) => p.game.machineAction('staff'))).toBe(true);
      await plush(page, (p) => p.machineDebug.nudge(0.2, 0, 0));
      await ff(page, 1);
      for (let k = 0; k < 12 && (await boxY()) > 0; k++) {
        await plush(page, (p, kk) => (kk % 2 === 0 ? p.machineDebug.nudge(0, 0, 1) : p.machineDebug.nudge(kk % 4 === 1 ? -0.2 : 0.2, 0, 0)), k);
        await ff(page, 1);
      }
      fell = (await boxY()) < 0;
    }
    expect(fell).toBe(true);
    expect((await awards(page)).filter((a) => !a.demo)).toHaveLength(0);
    const print: string = await plush(page, (p) => [...p.core().phys.toys.values()].find((t: any) => t.item?.kind === 'box').item.print);
    expect(print).toMatch(/^sakura\./);
    const n = (await results(page)).length;
    await click(page, 'grab');
    const result = await finishRound(page, n);
    expect(result).toMatchObject({ outcome: 'won', targetTypeId: print, machine: { id: 'bridge', progress: 1 } });
    const won = (await awards(page)).filter((a) => !a.demo);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ roundId: result.roundId, typeId: print });
    expect(won[0].session).toBeUndefined();
    // The collection, the points and the win card name the printed character, not the box.
    const after = await collection(page);
    expect(after.wins).toBe(before.wins + 1);
    expect(after.counts[print]).toBe((before.counts[print] ?? 0) + 1);
    expect(await plush(page, (p) => p.game.deps.collection.getState().machineWins)).toEqual({ bridge: 1 });
    const ui = await plush(page, (p) => ({ prize: p.ui().prize, result: p.ui().result, last: p.ui().score.last, reward: p.ui().reward }));
    expect(ui.prize.typeId).toBe(print);
    expect(ui.result.outcome).toBe('won');
    expect(ui.last).toMatchObject({ roundId: result.roundId, outcome: 'won', typeId: print });
    expect(ui.last.total).toBeGreaterThan(0);
    expect(ui.reward.roundId).toBe(result.roundId);
    expect(['issuing', 'ready', 'unavailable']).toContain(ui.reward.state);
    await shot(page, 'bridge-win');

    // The idle reset ends the session and switches back to home (classic) in attract mode.
    await plush(page, (p) => p.idleReset());
    await expect.poll(async () => (await machine(page)).id, { timeout: 240_000 }).toBe('classic');
    await expect.poll(() => plush(page, (p) => p.ui().themeBusy), { timeout: 240_000 }).toBe(false);
    expect(await plush(page, (p) => p.attract().active)).toBe(true);
    expect(await plush(page, (p) => p.ui().sessionResult)).toBeNull();
    expect(await plush(page, (p) => p.ui().machine.id)).toBe('classic');
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });
});
