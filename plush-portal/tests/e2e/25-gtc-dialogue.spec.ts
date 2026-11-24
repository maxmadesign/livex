import { expect, test, type Page } from '@playwright/test';
import { boot, ff, plush, start, state, watch, winARound } from './helpers';

/*
 * Momo as a GTC booth host (docs/AI.md, "GTC kit"): the default build dresses the gpu theme with the
 * GTC kit, so Game.facts() sends facts.brand and the local lines talk about the show floor. The claim
 * QR itself is issued by the rewards work; here the reward slice of the UI store is set by hand to
 * check that facts.reward reaches the guide on the win and on the retry prompt, and only then.
 * Runs keyless (local lines), like every e2e spec. PLUSH_GTC_SHOTS=<dir> also saves screenshots.
 */
const SHOTS = process.env.PLUSH_GTC_SHOTS ?? '';
const QR = /\bQR\b|\bscan/i;

interface Line {
  id: string;
  text: string;
  event: string;
  source: string;
}

/** Records every event the game hands to the guide and every line the HUD shows. */
const record = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__guideEvents = [];
    w.__lines = [];
    const guide = w.__plush.game.deps.guide;
    const handle = guide.handle.bind(guide);
    guide.handle = (event: unknown) => {
      w.__guideEvents.push(JSON.parse(JSON.stringify(event)));
      handle(event);
    };
    const sample = () => {
      const l = w.__plush.guide().line;
      if (l && !w.__lines.some((x: any) => x.id === l.id)) w.__lines.push({ id: l.id, text: l.text, event: l.eventType, source: l.source });
    };
    w.__lineTimer = setInterval(sample, 30);
  });
const events = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__guideEvents);
const lines = (page: Page): Promise<Line[]> => page.evaluate(() => (window as any).__lines);

/** Waits for the next line (after `after` lines were recorded) for `event`. */
async function nextLine(page: Page, after: number, event: string): Promise<Line> {
  await expect.poll(async () => (await lines(page)).slice(after).some((l) => l.event === event), { timeout: 60_000 }).toBe(true);
  return (await lines(page)).slice(after).find((l) => l.event === event)!;
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Puts a ready claim QR for the current round into the UI store, as the rewards flow would. */
const setReward = (page: Page, options: 'both' | 'prize' | 'swag') =>
  plush(
    page,
    (p, o) => {
      const roundId = p.state().roundId;
      p.game.deps.ui.setState({
        reward: { state: 'ready', roundId, code: 'TEST0000', url: 'http://127.0.0.1/c/TEST0000', reach: 'loopback', options: o, expiresAt: null, visibleUntil: Date.now() + 60_000, reason: null },
      });
      return roundId;
    },
    options,
  );

const emit = (page: Page, type: string, result?: unknown) =>
  page.evaluate(([t, r]) => (window as any).__plush.game.emitGuide(t, r ?? undefined), [type, result ?? null] as const);

test.describe('25. GTC booth host dialogue', () => {
  test('gpu theme with the GTC kit: brand facts, show-floor lines, QR lines only with a QR', async ({ page }) => {
    const w = watch(page);
    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'en' });
    expect((await state(page)).theme).toBe('gpu');
    await record(page);
    await start(page);
    await expect.poll(async () => (await events(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const first = (await events(page))[0]!;
    expect(first.themeId).toBe('gpu');
    expect(first.facts.brand).toEqual({ event: 'GTC', host: 'NVIDIA' });
    expect(first.facts.reward).toBeUndefined();
    const opening = await nextLine(page, 0, first.type);
    console.log(`opening line (${opening.event}, ${opening.source}): "${opening.text}"`);
    await expect(page.getByTestId('guide-line')).toBeVisible();
    await shot(page, 'e2e-gtc-opening-line');

    // A real win: the prize_won event carries the brand, and no QR facts while no code is on screen.
    let seen = (await lines(page)).length;
    const { result, tries } = await winARound(page, 8);
    expect(result.outcome).toBe('won');
    const won = (await events(page)).filter((e) => e.type === 'prize_won');
    expect(won.length).toBe(1);
    expect(won[0].facts.brand).toEqual({ event: 'GTC', host: 'NVIDIA' });
    expect(won[0].facts.reward).toBeUndefined();
    const winLine = await nextLine(page, seen, 'prize_won');
    console.log(`win after ${tries} tries: "${winLine.text}"`);
    expect(winLine.text).not.toMatch(QR);

    // The code arrives while the result card is up: the same win, re-announced, now invites a scan.
    const roundId = await setReward(page, 'both');
    expect(roundId).toBe(result.roundId);
    seen = (await lines(page)).length;
    await emit(page, 'prize_won', result);
    expect((await events(page)).at(-1)!.facts.reward).toEqual({ qr: true, options: 'both' });
    const rewardLine = await nextLine(page, seen, 'prize_won');
    console.log(`win with QR: "${rewardLine.text}"`);
    expect(rewardLine.text).toMatch(QR);
    await shot(page, 'e2e-gtc-win-reward-line');

    // About seven seconds into the result the retry prompt nudges to scan while the card is up.
    // (A hint never interrupts a line or follows one within 2.5 s, so let the win line go first.)
    await plush(page, (p) => p.game.deps.guide.silence());
    await page.waitForTimeout(3000);
    seen = (await lines(page)).length;
    await ff(page, 8.5);
    await expect.poll(async () => (await events(page)).some((e) => e.type === 'retry_prompt'), { timeout: 60_000 }).toBe(true);
    const retry = (await events(page)).find((e) => e.type === 'retry_prompt')!;
    expect(retry.facts.reward).toEqual({ qr: true, options: 'both' });
    const nudge = await nextLine(page, seen, 'retry_prompt');
    console.log(`retry nudge: "${nudge.text}"`);
    expect(nudge.text).toMatch(QR);
    await shot(page, 'e2e-gtc-retry-nudge');

    // Card dismissed (state back to idle): no QR facts any more.
    await plush(page, (p) => p.game.deps.ui.setState({ reward: { ...p.ui().reward, state: 'idle' } }));
    await emit(page, 'user_requested_tip');
    expect((await events(page)).at(-1)!.facts.reward).toBeUndefined();
    const all = await lines(page);
    expect(all.every((l) => l.source === 'local')).toBe(true);
    // Only the two lines that had a QR on screen talk about one.
    expect(all.filter((l) => QR.test(l.text)).map((l) => l.id).sort()).toEqual([rewardLine.id, nudge.id].sort());
    console.log(`all lines: ${all.map((l) => `${l.event}: "${l.text}"`).join(' | ')}`);
    expect(w.pageErrors).toEqual([]);
  });

  test('Momo speaking the interface language: GTC lines in Chinese, QR line on a win', async ({ page }) => {
    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'zh', settings: { ai: { voiceLanguage: 'ui' } } });
    await record(page);
    await start(page);
    await expect.poll(async () => (await lines(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const opening = (await lines(page))[0]!;
    console.log(`zh opening (${opening.event}): "${opening.text}"`);
    expect(opening.text).toMatch(/[一-鿿]/);
    const s = await state(page);
    const result = { roundId: s.roundId, outcome: 'won', contact: 'lifted', slipReason: null, liftedMs: 1800, targetTypeId: 'gpu.chief', targetToyId: null, nearest: null, demo: false };
    await setReward(page, 'swag');
    const seen = (await lines(page)).length;
    await emit(page, 'prize_won', result);
    const zh = await nextLine(page, seen, 'prize_won');
    console.log(`zh win with QR (swag): "${zh.text}"`);
    expect(zh.text).toMatch(/二维码|扫/);
    expect(zh.text).toMatch(/折扣|优惠/);
    expect((await events(page)).at(-1)!.facts.toy.name).toMatch(/[一-鿿]/);
    await shot(page, 'e2e-gtc-zh-win-reward-line');
  });
});
