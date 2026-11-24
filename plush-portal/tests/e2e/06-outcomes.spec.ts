import { expect, test } from '@playwright/test';
import { aim, awards, boot, click, collection, ff, ffUntil, fieldToys, finishRound, grabAndWait, plush, readyForNext, results, start, state, winARound } from './helpers';

test.describe('6. honest outcomes', () => {
  test('a grab at the centre of mass wins; a second GRAB during the round is ignored; exactly one award', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    // Find a winnable toy first (the exact odds depend on grip tuning), then inspect that round closely.
    const { result, tries, all } = await winARound(page, 8);
    console.log(`win after ${tries} centred grab(s): ${all.map((r) => `${r.outcome}${r.slipReason ? `(${r.slipReason})` : ''} q=${r.gripQuality}`).join(', ')}`);
    expect(result.outcome).toBe('won');
    expect(result.contact).toBe('lifted');
    expect(result.prizeId).toBeTruthy();
    expect(result.nearest.dist, 'the winning grab really was close to a toy centre').toBeLessThan(0.03);
    expect((await awards(page)).length).toBe(1);
    const c1 = await collection(page);
    expect(c1.wins).toBe(1);
    expect(c1.attempts).toBe(tries);
    expect(c1.counts[result.targetTypeId]).toBe(1);

    // PLAY AGAIN twice in a row only starts one new round.
    const round = (await state(page)).roundId;
    await click(page, 'result-again');
    await plush(page, (p) => p.game.playAgain());
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    expect((await state(page)).roundId).toBe(round + 1);

    // Next round: press GRAB again (button, API and keyboard) while the claw is already going down.
    await readyForNext(page);
    const toys = await fieldToys(page);
    await aim(page, toys[0]!.x, toys[0]!.z);
    const before = (await results(page)).length;
    const awardsBefore = (await awards(page)).length;
    const r0 = (await state(page)).roundId;
    await click(page, 'grab');
    expect(await ffUntil(page, ['DESCENDING'], 2)).toBe('DESCENDING');
    await expect(page.getByTestId('grab')).toBeDisabled();
    await page.getByTestId('grab').click({ force: true });
    expect(await plush(page, (p) => p.game.grab()), 'grab() during a round is refused').toBe(false);
    await page.mouse.click(640, 120);
    await page.keyboard.press('Space');
    expect(await ffUntil(page, ['CLOSING'], 10)).toBe('CLOSING');
    expect(await plush(page, (p) => p.game.grab())).toBe(false);
    expect(await ffUntil(page, ['LIFTING'], 10)).toBe('LIFTING');
    expect(await plush(page, (p) => p.game.grab())).toBe(false);
    const second = await finishRound(page, before);
    expect(second, 'the round finished').toBeTruthy();
    expect((await results(page)).length).toBe(before + 1);
    expect(second.roundId).toBe(r0);
    const newAwards = (await awards(page)).length - awardsBefore;
    expect(newAwards).toBe(second.outcome === 'won' ? 1 : 0);
    const c2 = await collection(page);
    expect(c2.wins).toBe(1 + (second.outcome === 'won' ? 1 : 0));
    expect(c2.attempts).toBe(tries + 1);
    expect(new Set(c2.prizeIds).size, 'prize ids are unique').toBe(c2.prizeIds.length);
  });

  test('a grab on an empty spot is reported as "empty" and awards nothing', async ({ page }) => {
    // Fewer toys so that the floor really has an empty area.
    await boot(page, { display: 'desktop', settings: { gameplay: { toyCount: 6 } } });
    await start(page);
    const spot = await plush(page, (p) => {
      const toys = [...p.core().phys.toys.values()].filter((t: any) => !t.inBin).map((t: any) => t.body.worldCom());
      const C = p.claw;
      let best = { x: 0, z: 0, d: -1 };
      for (let x = C.minX + 0.03; x <= C.maxX - 0.03; x += 0.01) {
        for (let z = C.minZ + 0.03; z <= C.maxZ - 0.03; z += 0.01) {
          if (x < 0 && z > -0.45) continue; // keep away from the prize chute
          let d = 9;
          for (const t of toys) d = Math.min(d, Math.hypot(t.x - x, t.z - z));
          if (d > best.d) best = { x, z, d };
        }
      }
      return { ...best, toys: toys.length };
    });
    console.log(`empty spot (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}): nearest of ${spot.toys} toys is ${(spot.d * 100).toFixed(1)} cm away`);
    expect(spot.d).toBeGreaterThan(0.12);
    await aim(page, spot.x, spot.z);
    const result = await grabAndWait(page);
    console.log(`empty grab: outcome=${result.outcome} contact=${result.contact} nearest=${(result.nearest?.dist * 100).toFixed(1)}cm`);
    expect(result.outcome).toBe('empty');
    expect(result.prizeId).toBeNull();
    expect(result.slipReason).toBeNull();
    expect((await awards(page)).length).toBe(0);
    const c = await collection(page);
    expect(c.wins).toBe(0);
    expect(c.attempts).toBe(1);
    // A miss never blocks: the next round is ready without pressing anything.
    await ff(page, 2);
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    await expect(page.getByTestId('result-win')).toHaveCount(0);
  });

  test('off-centre grabs can slip: at least one round ends as "slipped" with a physical reason and no award', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    const log: string[] = [];
    let slipped: any = null;
    let wins = 0;
    const offsets = [0.045, 0.06, 0.035, 0.075];
    outer: for (const off of offsets) {
      for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        await readyForNext(page);
        const toys = await fieldToys(page);
        const toy = toys[log.length % Math.min(5, toys.length)]!;
        await aim(page, toy.x + sx * off, toy.z + sz * off);
        const r = await grabAndWait(page);
        if (r.outcome === 'won') wins++;
        log.push(`${(off * 100).toFixed(1)}cm ${sx},${sz} ${toy.type}: ${r.outcome}${r.slipReason ? `(${r.slipReason}@${r.slipPhase})` : ''} contact=${r.contact} q=${r.gripQuality}`);
        if (r.outcome === 'slipped') {
          slipped = r;
          break outer;
        }
      }
    }
    console.log(`off-centre sweep (${log.length} rounds):\n  ${log.join('\n  ')}`);
    expect(slipped, 'no off-centre grab slipped').not.toBeNull();
    expect(['eccentric', 'weak_support', 'contact_lost', 'transport_swing', 'overload', 'bounced_out']).toContain(slipped.slipReason);
    expect(['gripped', 'lifted']).toContain(slipped.contact);
    expect(slipped.prizeId).toBeNull();
    expect(slipped.targetTypeId).toBeTruthy();
    const c = await collection(page);
    expect(c.wins, 'only real wins are in the collection').toBe(wins);
    expect((await awards(page)).length).toBe(wins);
    expect(c.attempts).toBe(log.length);
  });
});
