import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { boot, box, click, plush, settle, start, switchTheme, watch, winARound, type Box, type Display } from './helpers';

/**
 * Prize-claim QR on the win card (src/rewards, src/ui/RewardCard.tsx), with the rewards API mocked
 * (page.route) in the shapes of src/rewards/protocol.ts: the server side is tested elsewhere.
 *
 * Wins are real rounds played through the debug API (physics, settlement and the result card are
 * the game's own); only the server's answers are scripted. The QR code is read back from a page
 * screenshot with jsQR. Screenshots of the card go to PLUSH_SHOTS_DIR (default test-results/rewards).
 */

const SHOTS = process.env.PLUSH_SHOTS_DIR ?? path.join('test-results', 'rewards');
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

interface RewardsMock {
  /** Bodies of every POST /api/rewards/issue. */
  issued: Record<string, unknown>[];
  /** 'ok': a code per request; 'fail': the server could not store it. */
  mode: 'ok' | 'fail';
}

/** A code in the claim alphabet for a round (stable, so the test knows what the QR must hold). */
function codeFor(roundId: number): string {
  let code = 'K7M2';
  let n = roundId * 7919 + 12345;
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[n % 32];
    n = Math.floor(n / 32);
  }
  return code;
}
const claimUrl = (code: string) => `http://192.168.1.20:8788/c/${code}`;
const formatted = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

async function mockRewards(page: Page): Promise<RewardsMock> {
  const mock: RewardsMock = { issued: [], mode: 'ok' };
  await page.route('**/api/rewards/status', (route) =>
    route.fulfill({ status: 200, json: { enabled: true, canIssue: true, claimBase: 'http://192.168.1.20:8788', reach: 'lan', ttlHours: 48 } }),
  );
  await page.route('**/api/rewards/issue', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    mock.issued.push(body);
    if (mock.mode === 'fail') return route.fulfill({ status: 500, json: { error: { code: 'storage', message: 'the code could not be written' } } });
    const code = codeFor(Number(body.roundId));
    const now = Date.now();
    return route.fulfill({
      status: 200,
      json: { code, url: claimUrl(code), reach: 'lan', issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 48 * 3600_000).toISOString(), options: body.options, repeated: false },
    });
  });
  return mock;
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Reads the QR code on the card back from a screenshot of the page (the tile plus a margin). */
async function decodeQr(page: Page): Promise<string | null> {
  await settle(page);
  const b = await box(page, 'reward-qr');
  const vp = page.viewportSize()!;
  const x = Math.max(0, Math.floor(b.x - 16));
  const y = Math.max(0, Math.floor(b.y - 16));
  const clip = { x, y, width: Math.min(vp.width - x, Math.ceil(b.width + 32)), height: Math.min(vp.height - y, Math.ceil(b.height + 32)) };
  const png = await page.screenshot({ clip });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return found?.data ?? null;
}

const rewardState = (page: Page) => plush<{ state: string; roundId: number; code: string | null; url: string | null; visibleUntil: number; reason: string | null }>(page, (p) => p.ui().reward);

const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** The win card's content fits its box (nothing spills over the controls). */
async function expectNoOverflow(page: Page): Promise<void> {
  const o = await page.getByTestId('result-win').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
  expect(o.sh, 'card content height').toBeLessThanOrEqual(o.ch + 1);
  expect(o.sw, 'card content width').toBeLessThanOrEqual(o.cw + 1);
}

/** Card inside the safe zone (in page coordinates: the game's box may be a simulated 9:16 screen) and clear of the controls. */
async function expectCardPlacement(page: Page, display: Display): Promise<{ card: Box; zone: { top: number; bottom: number } }> {
  const card = await box(page, 'result-win');
  const hud = await plush<{ safeTop: number; safeBottom: number }>(page, (p) => ({ safeTop: p.state().hud.safeTop, safeBottom: p.state().hud.safeBottom }));
  const canvas = await box(page, 'game-canvas');
  const zone = { top: canvas.y + hud.safeTop, bottom: canvas.y + hud.safeBottom };
  expect(card.y, 'card top in the safe zone').toBeGreaterThanOrEqual(zone.top - 1);
  expect(card.y + card.height, 'card bottom in the safe zone').toBeLessThanOrEqual(zone.bottom + 1);
  const controls = display === 'mobile' ? ['slot-dpad', 'slot-action', 'status', 'panel-menu'] : display === 'desktop' ? ['status', 'panel-menu', 'dpad', 'again'] : ['panel'];
  for (const id of controls) expect(overlap(card, await box(page, id)), `card covers ${id}`).toBe(false);
  await expectNoOverflow(page);
  return { card, zone };
}

test.describe('26. prize-claim QR on the win card', () => {
  test('desktop GPU theme: demo rounds get nothing; a real win shows a scannable QR; a failed issue an honest note; another theme no QR', async ({ page }) => {
    test.setTimeout(2_400_000);
    const w = watch(page);
    const mock = await mockRewards(page);
    await boot(page, { display: 'desktop', theme: 'gpu', settings: { system: { attractDemo: true } } });
    expect(await plush(page, (p) => p.settings().rewards.mode)).toBe('gtc');

    // Attract mode plays demo rounds by itself: let them run until one wins (or 8 were played).
    const demo = await plush(page, (p) => {
      const w = window as any;
      let wins = 0;
      for (let t = 0; t < 360 && wins === 0 && w.__results.length < 8; t += 0.25) {
        p.fastForward(0.25);
        wins = w.__results.filter((r: any) => r.outcome === 'won').length;
      }
      return { results: w.__results.map((r: any) => `${r.outcome}${r.demo ? '/demo' : ''}`), reward: p.ui().reward };
    });
    console.log(`demo rounds: ${demo.results.join(', ')}`);
    expect(demo.results.length).toBeGreaterThan(0);
    for (const r of demo.results) expect(r.endsWith('/demo')).toBe(true);
    expect(demo.reward.state, 'no reward state for demo rounds').toBe('idle');
    expect(mock.issued, 'no code requested for demo rounds').toEqual([]);
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);

    // A real win: the code is requested once, at the prize exit, and its QR is on the card.
    await start(page);
    const { result, tries } = await winARound(page, 12);
    console.log(`won round ${result.roundId} (${result.targetTypeId}) after ${tries} tries`);
    await expect(page.getByTestId('result-win')).toBeVisible();
    // The win's score popup (it lives about 2 s) is drawn clear of the card.
    const pops = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="result-win"]')!.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="score-popup"][data-kind="win"]')].map((el) => {
        const r = el.getBoundingClientRect();
        const hit = r.x < card.right && r.right > card.x && r.y < card.bottom && r.bottom > card.y;
        return { moved: el.getAttribute('data-moved'), skipped: el.getAttribute('data-skipped'), hit, box: [r.x, r.y, r.width, r.height].map(Math.round) };
      });
    });
    console.log(`win popups while the card is up: ${JSON.stringify(pops)}`);
    for (const p of pops) if (p.skipped !== 'true') expect(p.hit, `popup ${JSON.stringify(p.box)} covers the card`).toBe(false);
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'ready');
    expect(mock.issued.length, 'one issue request for the win').toBe(1);
    const sent = mock.issued[0]!;
    expect(sent).toMatchObject({ roundId: result.roundId, prizeId: result.targetTypeId, themeId: 'gpu', options: 'both', claimUrl: '', lang: 'en' });
    expect(String(sent.session).length).toBeGreaterThan(8);
    const code = codeFor(result.roundId);
    await expect(page.getByTestId('reward-code')).toHaveText(formatted(code));
    await expect(page.getByTestId('reward-instruction')).toHaveText('Scan to collect your prize or get a swag discount');
    const reward = await rewardState(page);
    expect(reward).toMatchObject({ state: 'ready', roundId: result.roundId, code, url: claimUrl(code), reason: null });
    expect(reward.visibleUntil).toBeGreaterThan(await page.evaluate(() => Date.now()));

    const qr = await box(page, 'reward-qr');
    console.log(`desktop QR ${qr.width.toFixed(0)}×${qr.height.toFixed(0)} px`);
    expect(Math.min(qr.width, qr.height)).toBeGreaterThanOrEqual(160);
    await expectCardPlacement(page, 'desktop');
    // The QR really holds the claim link: read it back from a screenshot.
    expect(await decodeQr(page)).toBe(claimUrl(code));
    await shot(page, 'desktop-gpu-qr');

    // PLAY AGAIN dismisses the QR with the card.
    await click(page, 'result-again');
    await expect(page.getByTestId('result-win')).toHaveCount(0);
    expect((await rewardState(page)).state).toBe('idle');

    // The server cannot issue a code: the card says so, and no QR is drawn.
    mock.mode = 'fail';
    const second = await winARound(page, 12);
    await expect(page.getByTestId('result-win')).toBeVisible();
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'unavailable');
    await expect(page.getByTestId('reward-unavailable')).toHaveText('Prize code unavailable — please ask booth staff');
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await expect(page.getByTestId('reward-qr-pending')).toHaveCount(0);
    expect(mock.issued.length).toBe(2);
    expect(await rewardState(page)).toMatchObject({ state: 'unavailable', roundId: second.result.roundId, reason: 'storage', code: null, url: null });
    await expectCardPlacement(page, 'desktop');
    await shot(page, 'desktop-gpu-unavailable');
    await click(page, 'result-again');

    // Another theme with the default mode (gtc): a normal win card, no request.
    await switchTheme(page, 'sakura');
    expect((await rewardState(page)).state).toBe('idle');
    await winARound(page, 12);
    await expect(page.getByTestId('result-win')).toBeVisible();
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'none');
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await expect(page.getByTestId('reward-unavailable')).toHaveCount(0);
    expect(mock.issued.length, 'no request outside the GPU theme').toBe(2);
    await shot(page, 'desktop-sakura-no-qr');
    expect(w.pageErrors).toEqual([]);
  });

  test('the idle reset waits until the QR has hidden itself', async ({ page }) => {
    test.setTimeout(1_200_000);
    const w = watch(page);
    await mockRewards(page);
    // Reset after 15 s without input; the QR stays 30 s.
    await boot(page, { display: 'desktop', theme: 'gpu', settings: { system: { attractDemo: false, idleSeconds: 15 }, rewards: { qrSeconds: 30 } } });
    await start(page);
    await winARound(page, 12);
    await expect(page.getByTestId('reward-qr')).toBeVisible();
    // This is the last call that counts as input: from here on only the DOM and the clock are watched.
    const t0 = await plush<{ now: number; visibleUntil: number; idle: number }>(page, (p) => ({ now: Date.now(), visibleUntil: p.ui().reward.visibleUntil, idle: p.settings().system.idleSeconds }));
    expect(t0.idle).toBe(15);
    const holdMs = t0.visibleUntil - t0.now;
    console.log(`QR hides in ${(holdMs / 1000).toFixed(1)} s; the idle reset is due in 15 s`);
    expect(holdMs).toBeGreaterThan(25_000);
    // Past the idle time (15 s + margin): the QR card is still there.
    const browserNow = () => page.evaluate(() => Date.now());
    while ((await browserNow()) < t0.now + 19_000) await page.waitForTimeout(500);
    await expect(page.getByTestId('reward-qr'), 'the QR survives the idle time').toBeVisible();
    await expect(page.getByTestId('result-win')).toBeVisible();
    await expect(page.getByTestId('attract-cta')).toHaveCount(0);
    // Once visibleUntil has passed the card goes and the overdue reset follows: attract mode.
    await expect(page.getByTestId('attract-cta')).toBeVisible({ timeout: 240_000 });
    const resetAt = await browserNow();
    console.log(`attract mode ${((resetAt - t0.now) / 1000).toFixed(1)} s after the win (QR until ${(holdMs / 1000).toFixed(1)} s)`);
    expect(resetAt).toBeGreaterThanOrEqual(t0.visibleUntil);
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await expect(page.getByTestId('result-win')).toHaveCount(0);
    const after = await plush(page, (p) => ({ reward: p.ui().reward, attract: p.attract().active, log: p.log() }));
    expect(after.reward.state).toBe('idle');
    expect(after.attract).toBe(true);
    expect(after.log.some((l: string) => l.includes('idle reset (15 s without input)'))).toBe(true);
    expect(w.pageErrors).toEqual([]);
  });

  for (const [name, display, width, height] of [
    ['portrait32', 'portrait32', 1080, 1920],
    ['portrait86-simulated', 'portrait86', 1280, 720],
    ['phone', 'mobile', 844, 390],
  ] as const) {
    test(`win card with the claim code on ${name} (${width}×${height})`, async ({ page }) => {
      test.setTimeout(1_200_000);
      await page.setViewportSize({ width, height });
      const w = watch(page);
      const mock = await mockRewards(page);
      await boot(page, { display, theme: 'gpu', settings: { system: { attractDemo: false } } });
      await start(page);
      const { result } = await winARound(page, 12);
      await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'ready');
      expect(mock.issued.length).toBe(1);
      const code = codeFor(result.roundId);
      await expect(page.getByTestId('reward-code')).toHaveText(formatted(code));
      const { card } = await expectCardPlacement(page, display);
      if (display === 'mobile') {
        // The player holds the phone and cannot scan it: a claim link and the code instead.
        await expect(page.getByTestId('reward-qr')).toHaveCount(0);
        await expect(page.getByTestId('reward-link')).toHaveAttribute('href', claimUrl(code));
        const link = await box(page, 'reward-link');
        expect(link.height).toBeGreaterThanOrEqual(43.5);
        // It used to reach about 9 px into the menu row.
        const menu = await box(page, 'panel-menu');
        expect(card.y + card.height).toBeLessThanOrEqual(menu.y);
      } else {
        const qr = await box(page, 'reward-qr');
        const canvas = await box(page, 'game-canvas');
        const screenW = await plush<number>(page, (p, d) => {
          const v = p.settings().profiles[d].view;
          return Math.min(v.screenW, v.screenH);
        }, display);
        const cm = (qr.width / canvas.width) * screenW * 100;
        console.log(`${name}: QR ${qr.width.toFixed(0)} px = ${cm.toFixed(1)} cm on the ${screenW} m wide panel`);
        expect(qr.width).toBeGreaterThanOrEqual(160);
        expect(cm, 'at least 8 cm wide on the kiosk').toBeGreaterThanOrEqual(8);
        expect(await decodeQr(page)).toBe(claimUrl(code));
      }
      await shot(page, `${name}-gpu-qr`);
      expect(w.pageErrors).toEqual([]);
    });
  }
});
