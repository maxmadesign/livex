import { expect, test } from '@playwright/test';
import { aim, awards, boot, click, closeSettings, collection, ff, ffUntil, fieldToys, finishRound, openSettings, plush, readyForNext, results, start, state, switchTheme, winARound } from './helpers';

const stored = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('plush-portal/collection/v1');
    return raw ? JSON.parse(raw) : null;
  });

test.describe('7. prize settlement', () => {
  test('the collection changes only when the prize passes the chute sensor, exactly once', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    // Record the collection counter at every phase change and at the sensor / award events.
    await page.evaluate(() => {
      const w = window as any;
      w.__trace = [];
      const core = w.__plush.core();
      const wins = () => w.__plush.collection().wins;
      const step = () => core.phys.stepCount;
      core.machine.events.on('phase', (e: any) => w.__trace.push({ ev: `phase:${e.phase}`, round: e.roundId, wins: wins(), step: step() }));
      core.controller.events.on('prizeDetected', (e: any) => w.__trace.push({ ev: 'sensor', round: e.roundId, wins: wins(), step: step(), toy: Array.from(e.toy.pose.pos), inBin: e.toy.inBin }));
      core.machine.events.on('award', () => w.__trace.push({ ev: 'award', round: core.machine.roundId, wins: wins(), step: step() }));
    });
    const { result, tries } = await winARound(page, 8);
    const trace: { ev: string; round: number; wins: number; step: number; toy?: number[]; inBin?: boolean }[] = await page.evaluate(() => (window as any).__trace);
    const winning = trace.filter((t) => t.round === result.roundId);
    console.log(`winning round ${result.roundId} (try ${tries}): ${winning.map((t) => `${t.ev}=${t.wins}@${t.step}`).join(' → ')}`);
    const sensorAt = trace.findIndex((t) => t.ev === 'sensor' && t.round === result.roundId);
    const awardAt = trace.findIndex((t) => t.ev === 'award');
    expect(sensorAt, 'the chute sensor fired in the winning round').toBeGreaterThan(-1);
    expect(awardAt).toBeGreaterThan(-1);
    // Nothing was credited before the sensor step: not on contact, not while lifting or carrying.
    for (const t of trace.slice(0, awardAt)) expect(t.wins, `${t.ev} before the award`).toBe(0);
    const phasesBefore = trace.slice(0, awardAt).filter((t) => t.round === result.roundId).map((t) => t.ev);
    expect(phasesBefore).toEqual(expect.arrayContaining(['phase:LIFTING', 'phase:TRANSPORTING', 'phase:RELEASING']));
    // The credit is booked in the very simulation step in which the sensor saw the toy ...
    expect(trace[awardAt]!.step).toBe(trace[sensorAt]!.step);
    expect(trace[awardAt]!.wins).toBe(1);
    // ... and at that moment the toy really is down in the prize chute (front-left corner), not in the claw.
    const sensor = trace[sensorAt]!;
    const chute = await plush(page, (p) => ({ x: p.claw.dropX as number, z: p.claw.dropZ as number }));
    console.log(`sensor: toy at (${sensor.toy!.map((v) => v.toFixed(3)).join(', ')}), chute centre (${chute.x}, ${chute.z}), inBin=${sensor.inBin}`);
    expect(Math.hypot(sensor.toy![0]! - chute.x, sensor.toy![2]! - chute.z)).toBeLessThan(0.2);
    expect(sensor.toy![1]!, 'below the play floor').toBeLessThan(0.05);
    expect((await awards(page)).length).toBe(1);
    const c = await collection(page);
    expect(c.wins).toBe(1);
    expect(c.prizeIds).toEqual([result.prizeId]);
    const persisted = await stored(page);
    expect(JSON.stringify(persisted)).toContain(result.prizeId);

    // Restart round on the win card: no second credit.
    await openSettings(page, 'menu-settings', 'gameplay');
    await click(page, 'btn-restart-round');
    if (await page.getByTestId('settings').count()) await closeSettings(page, 'cancel');
    await ff(page, 3);
    expect((await collection(page)).wins).toBe(1);
    expect((await awards(page)).length).toBe(1);

    // Restart while a toy is in the air: that round is abandoned, never credited.
    let lifted = false;
    for (let i = 0; i < 6 && !lifted; i++) {
      await readyForNext(page);
      const toys = await fieldToys(page);
      const toy = toys[i % toys.length]!;
      await aim(page, toy.x, toy.z);
      const before = (await results(page)).length;
      await click(page, 'grab');
      const phase = await ffUntil(page, ['TRANSPORTING', 'RESULT', 'READY'], 25);
      if (phase !== 'TRANSPORTING') {
        await finishRound(page, before, 20);
        continue;
      }
      lifted = true;
      const abandoned = (await state(page)).roundId;
      const resultsBefore = (await results(page)).length;
      await openSettings(page, 'menu-settings', 'gameplay');
      await click(page, 'btn-restart-round');
      if (await page.getByTestId('settings').count()) await closeSettings(page, 'cancel');
      await ff(page, 8);
      const s = await state(page);
      expect(s.phase).toMatch(/READY|AIMING/);
      const later = (await results(page)).slice(resultsBefore);
      expect(later.filter((r: any) => r.roundId === abandoned && r.outcome === 'won')).toEqual([]);
      console.log(`restart during TRANSPORTING of round ${abandoned}: phase ${s.phase}, round ${s.roundId}, wins ${(await collection(page)).wins}`);
    }
    expect(lifted, 'a toy was in the air when the round was restarted').toBe(true);
    const winsNow = (await collection(page)).wins;
    expect((await awards(page)).length).toBe(winsNow);

    // Switching the theme does not re-credit old prizes; a win in the new theme is a new, distinct prize.
    await readyForNext(page);
    await switchTheme(page, 'ocean');
    expect((await collection(page)).wins).toBe(winsNow);
    const next = await winARound(page, 8);
    expect(next.result.targetTypeId).toMatch(/^ocean\./);
    const end = await collection(page);
    expect(end.wins).toBe(winsNow + 1);
    expect(new Set(end.prizeIds).size).toBe(end.prizeIds.length);
    expect((await awards(page)).filter((a: any) => !a.demo).length).toBe(end.wins);

    // Reload: the collection is restored, nothing is added again.
    await page.reload();
    await page.waitForFunction(() => (window as any).__bootDone === true, null, { timeout: 240_000 });
    const reloaded = await collection(page);
    expect(reloaded.wins).toBe(end.wins);
    expect(reloaded.counts).toEqual(end.counts);
  });

  test('attract-mode demo rounds show a DEMO badge and never touch the collection', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    expect((await state(page)).phase).toBe('ATTRACT');
    await expect(page.getByTestId('demo-badge')).toHaveCount(0);
    // Nobody plays: the demo starts on its own.
    await plush(page, (p) => {
      for (let t = 0; t < 15 && !p.state().demo; t += 0.25) p.fastForward(0.25);
    });
    const s = await state(page);
    expect(s.demo).toBe(true);
    await expect(page.getByTestId('demo-badge')).toBeVisible();
    await expect(page.getByTestId('start'), 'START stays available during the demo').toBeVisible();

    // Let demo rounds play until one of them wins (or 8 rounds have been played).
    const demo = await plush(page, (p) => {
      const w = window as any;
      for (let t = 0; t < 400; t += 0.25) {
        p.fastForward(0.25);
        const rs = w.__results;
        if (rs.some((r: any) => r.outcome === 'won') || rs.length >= 8) break;
      }
      return w.__results.map((r: any) => ({ outcome: r.outcome, demo: r.demo, prizeId: r.prizeId }));
    });
    console.log(`demo rounds: ${demo.map((r: any) => r.outcome).join(', ')}`);
    expect(demo.length).toBeGreaterThan(0);
    for (const r of demo) expect(r.demo).toBe(true);
    for (const a of await awards(page)) expect(a.demo).toBe(true);
    const c = await collection(page);
    expect(c.wins).toBe(0);
    expect(c.attempts).toBe(0);
    expect(c.counts).toEqual({});
    const persisted = await stored(page);
    expect(persisted === null || JSON.stringify(persisted).includes('"wins":0') || !JSON.stringify(persisted).includes('prize')).toBeTruthy();
    await expect(page.getByTestId('result-win'), 'no prize card for a demo').toHaveCount(0);

    // A player takes over in the middle of a demo round.
    await plush(page, (p) => {
      for (let t = 0; t < 40 && !(p.state().demo && ['DESCENDING', 'CLOSING', 'LIFTING'].includes(p.state().phase)); t += 0.1) p.fastForward(0.1);
    });
    const mid = await state(page);
    console.log(`taking over during demo phase ${mid.phase}`);
    await click(page, 'start');
    await expect.poll(async () => `${(await state(page)).demo}/${(await state(page)).phase}`).toMatch(/false\/(READY|AIMING)/);
    await expect(page.getByTestId('demo-badge')).toHaveCount(0);
    await ff(page, 4);
    expect((await collection(page)).wins).toBe(0);
    // And the player's own round counts normally.
    const { result } = await winARound(page, 8);
    expect(result.demo).toBe(false);
    expect((await collection(page)).wins).toBe(1);
  });
});
