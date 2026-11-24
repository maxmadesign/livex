import { expect, test, type Page } from '@playwright/test';
import { boot, ff, plush, results, start, watch, winARound } from './helpers';

/**
 * Points (src/game/scoring.ts): every round is settled exactly once, whether the prize exit or the
 * round result reports it first; demo rounds score on their own track and are never stored.
 */

const storedScores = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('plush-portal/scores');
    return raw ? (JSON.parse(raw) as { best: number; lifetime: number }) : null;
  });

/** Records every award the score keeper hands out (wraps the live instance; nothing else changes). */
const recordSettlements = (page: Page) =>
  plush(page, (p) => {
    const w = window as any;
    w.__settled = [];
    const keeper = p.game.scores;
    const settle = keeper.settle.bind(keeper);
    keeper.settle = (input: any) => {
      const award = settle(input);
      if (award) w.__settled.push({ roundId: award.roundId, total: award.total, demo: award.demo, outcome: award.outcome, streak: award.streak });
      return award;
    };
  });

const settled = (page: Page): Promise<{ roundId: number; total: number; demo: boolean; outcome: string; streak: number }[]> => page.evaluate(() => (window as any).__settled);

test.describe('21. points', () => {
  test('a demo round scores on the DEMO track only and is never stored; a player win is awarded once and stored', async ({ page }) => {
    test.setTimeout(900_000);
    const w = watch(page);
    await boot(page, { display: 'desktop' });
    await recordSettlements(page);
    expect(await storedScores(page)).toBeNull();

    // --- attract mode plays demo rounds by itself until one is won
    let demoWin: any = null;
    for (let i = 0; i < 12 && !demoWin; i++) {
      await ff(page, 8);
      demoWin = (await results(page)).find((r) => r.demo && r.outcome === 'won') ?? null;
    }
    expect(demoWin, 'a demo round was won').toBeTruthy();
    const afterDemo = await plush(page, (p) => p.score());
    console.log(`demo win round ${demoWin.roundId} (${demoWin.targetTypeId}): demo track ${JSON.stringify(afterDemo.demo)}, player track ${JSON.stringify(afterDemo.player)}`);
    expect(afterDemo.demo.session).toBeGreaterThan(0);
    expect(afterDemo.player).toMatchObject({ session: 0, best: 0, lifetime: 0 });
    expect(afterDemo.ui.demo).toBe(true);
    await expect(page.getByTestId('score-demo')).toBeVisible();
    expect(await storedScores(page), 'demo points are never persisted').toBeNull();
    const demoAwards = (await settled(page)).filter((a) => a.demo);
    expect(demoAwards.length).toBeGreaterThan(0);

    // --- a player takes over: the demo's score is gone, the player starts at 0
    await start(page);
    const fresh = await plush(page, (p) => p.score());
    expect(fresh.ui.demo).toBe(false);
    expect(fresh.ui.session).toBe(0);
    await expect(page.getByTestId('score-value')).toHaveAttribute('data-value', '0');

    // --- a player win
    const { result } = await winARound(page, 8);
    await ff(page, 1.5);
    const after = await plush(page, (p) => p.score());
    const awards = (await settled(page)).filter((a) => !a.demo);
    console.log(`player rounds settled: ${JSON.stringify(awards)}; HUD ${JSON.stringify(after.ui.last && { round: after.ui.last.roundId, total: after.ui.last.total })}; stored ${JSON.stringify(await storedScores(page))}`);
    // Each round id is settled at most once (the exit event and the round result both try).
    const ids = (await settled(page)).map((a) => a.roundId);
    expect(new Set(ids).size, `settled round ids ${ids.join(',')}`).toBe(ids.length);
    const win = awards.find((a) => a.roundId === result.roundId)!;
    expect(win, 'the won round was settled').toBeTruthy();
    expect(win.outcome).toBe('won');
    expect(win.total).toBeGreaterThan(0);
    // The session is exactly the sum of this player's awards; the HUD and the win card show it.
    const sum = awards.reduce((n, a) => n + a.total, 0);
    expect(after.player.session).toBe(sum);
    expect(after.player.lifetime).toBe(sum);
    expect(after.ui.session).toBe(sum);
    expect(after.ui.last.roundId).toBe(result.roundId);
    await expect(page.getByTestId('score-value')).toHaveAttribute('data-value', String(sum));
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-points', String(win.total));
    // Best and lifetime are stored; the demo's points never were.
    const stored = await storedScores(page);
    expect(stored).toMatchObject({ best: sum, lifetime: sum });

    // More game time on the result screen awards nothing more.
    await ff(page, 3);
    expect((await plush(page, (p) => p.score())).player.session).toBe(sum);
    expect((await settled(page)).filter((a) => !a.demo).length).toBe(awards.length);
    expect(w.pageErrors).toEqual([]);
  });
});
