import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { boot, box, click, closeSettings, openSettings, plush, settle, start, watch, winARound, type Display, type Watch } from './helpers';

/**
 * The prize-claim flow end to end against the REAL API server that playwright.config.ts starts
 * (production build, keyless, a fresh PLUSH_DATA_DIR, the claim listener on a free port): a real
 * win issues a code, its QR is read back from a screenshot, the claim page is opened on a phone
 * sized page, the prize is chosen, booth staff redeem it on the prize desk, and the claim page then
 * says it was collected. Server answers are never invented here (spec 26 covers the card with
 * scripted answers): the slow-server test only delays the real answer, and the loopback test
 * rewrites the reach of the real answer, because the server's own reach is fixed at start-up.
 *
 * Screenshots go to PLUSH_SHOTS_DIR (default test-results/rewards-integration).
 */

const SHOTS = process.env.PLUSH_SHOTS_DIR ?? path.join('test-results', 'rewards-integration');
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const QR_WORDS = /\bQR\b|\bscan/i;
const QR_LABEL = 'QR code that opens the prize claim page';

interface Status {
  enabled: boolean;
  canIssue: boolean;
  claimBase: string;
  reach: 'external' | 'lan' | 'loopback';
  ttlHours: number;
}

interface Reward {
  state: string;
  roundId: number;
  code: string | null;
  url: string | null;
  reach: string | null;
  options: string;
  visibleUntil: number;
  reason: string | null;
}

interface StoredCode {
  code: string;
  status: string;
  choice: string;
  prizeName: string;
  themeId: string;
  lang: string;
  options: string;
}

const formatted = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

async function serverStatus(request: APIRequestContext): Promise<Status> {
  const response = await request.get('/api/rewards/status');
  expect(response.status()).toBe(200);
  return (await response.json()) as Status;
}

/** Every code the server has stored, read from the staff CSV (this test runner is on the booth machine: loopback). */
async function storedCodes(request: APIRequestContext): Promise<StoredCode[]> {
  const response = await request.get('/staff/rewards.csv');
  expect(response.status()).toBe(200);
  const lines = (await response.text()).replace(/^﻿/, '').trim().split(/\r\n/);
  const head = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split('","').map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const row = Object.fromEntries(head.map((name, i) => [name, cells[i] ?? '']));
    return { code: row.code!.replace('-', ''), status: row.status!, choice: row.choice!, prizeName: row.prizeName!, themeId: row.themeId!, lang: row.lang!, options: row.options! };
  });
}

const rewardState = (page: Page) => plush<Reward>(page, (p) => p.ui().reward);
const plushName = (page: Page, typeId: string) => plush<string>(page, (p, id) => p.game.library.assets().find((a: any) => a.id === id).name.en, typeId);

async function shot(page: Page, name: string, fullPage = false): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

async function decodePng(png: Buffer): Promise<string | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height)?.data ?? null;
}

/** Reads the QR code from a screenshot of the whole page (the 3D scene and the card around it included). */
async function decodePage(page: Page): Promise<string | null> {
  await settle(page);
  return decodePng(await page.screenshot());
}

/** Records every event the game hands to the guide, every line it shows and when each result came. */
const recordGuide = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__guideEvents = [];
    w.__lines = [];
    w.__resultAt = {};
    const guide = w.__plush.game.deps.guide;
    const handle = guide.handle.bind(guide);
    guide.handle = (event: any) => {
      w.__guideEvents.push({ ...JSON.parse(JSON.stringify(event)), at: Date.now() });
      handle(event);
    };
    guide.subscribe((line: any) => {
      if (line && !w.__lines.some((x: any) => x.id === line.id)) w.__lines.push({ id: line.id, text: line.text, event: line.eventType, source: line.source, at: Date.now() });
    });
    w.__plush.core().machine.events.on('result', (r: any) => (w.__resultAt[r.roundId] = Date.now()));
    // When the page got each code (the store's reward slice turns ready).
    w.__readyAt = {};
    w.__plush.game.deps.ui.subscribe((s: any) => {
      if (s.reward.state === 'ready' && !w.__readyAt[s.reward.roundId]) w.__readyAt[s.reward.roundId] = Date.now();
    });
  });
const readyAt = (page: Page, roundId: number): Promise<number> => page.evaluate((id) => (window as any).__readyAt[id] ?? 0, roundId);

/**
 * The win line waits up to 1.5 s for the code (Game.emitPrizeWon). With the code in time it goes
 * out with it and invites the scan; a code that comes later (a loaded machine: in these runs the
 * request can only complete after the fast-forwarded round, while the page renders slowly) lets the
 * line go at the limit without the invitation. Either way the line never invites a scan without a code.
 */
async function expectWinLine(page: Page, roundId: number, label: string): Promise<{ invited: boolean; text: string }> {
  const { event, line } = await winLineOf(page, roundId);
  const shownAt = await resultAt(page, roundId);
  const codeAfter = (await readyAt(page, roundId)) - shownAt;
  const waited = event.at - shownAt;
  console.log(`${label}: code ${codeAfter} ms, win line ${waited} ms after the result: "${line.text}"`);
  if (event.facts.reward) {
    expect(event.facts.reward).toEqual({ qr: true, options: 'both' });
    expect(line.text).toMatch(QR_WORDS);
    expect(waited, 'the line went out with the code, not before').toBeGreaterThanOrEqual(codeAfter - 50);
    return { invited: true, text: line.text };
  }
  console.log(`${label}: the code came after the 1.5 s wait on this loaded machine; checked the fallback instead`);
  expect(waited, 'the line waited the full 1.5 s').toBeGreaterThanOrEqual(1500 - 50);
  expect(codeAfter, 'the code really was late').toBeGreaterThanOrEqual(waited - 50);
  expect(line.text).not.toMatch(QR_WORDS);
  return { invited: false, text: line.text };
}

/** The win card's content fits its box (nothing sticks out of it). */
async function expectNoOverflow(page: Page): Promise<void> {
  const o = await page.getByTestId('result-win').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
  expect(o.sh, 'card content height').toBeLessThanOrEqual(o.ch + 1);
  expect(o.sw, 'card content width').toBeLessThanOrEqual(o.cw + 1);
}
const guideEvents = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__guideEvents);
const guideLines = (page: Page): Promise<{ id: string; text: string; event: string; source: string; at: number }[]> => page.evaluate(() => (window as any).__lines);
const resultAt = (page: Page, roundId: number): Promise<number> => page.evaluate((id) => (window as any).__resultAt[id], roundId);

/** The prize_won line of a round (waits for it). */
async function winLineOf(page: Page, roundId: number): Promise<{ event: any; line: { text: string; source: string; at: number } }> {
  await expect.poll(async () => (await guideEvents(page)).some((e) => e.type === 'prize_won' && e.roundId === roundId), { timeout: 60_000 }).toBe(true);
  const event = (await guideEvents(page)).find((e) => e.type === 'prize_won' && e.roundId === roundId);
  await expect.poll(async () => (await guideLines(page)).some((l) => l.event === 'prize_won' && l.at >= event.at), { timeout: 60_000 }).toBe(true);
  const line = (await guideLines(page)).find((l) => l.event === 'prize_won' && l.at >= event.at)!;
  return { event, line };
}

/** A phone of a visitor: its own browser context (no cookies of the kiosk), 390 × 844 CSS px. */
async function phoneContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'en-US' });
}

/** Nothing went wrong in the page: no uncaught errors, no failed requests, no console errors. */
function expectClean(w: Watch, label: string): void {
  console.log(`${label}: console errors ${JSON.stringify(w.consoleErrors)}, failed requests ${JSON.stringify(w.failedRequests)}, HTTP errors ${JSON.stringify(w.badResponses)}`);
  expect(w.pageErrors, `${label}: page errors`).toEqual([]);
  expect(w.consoleErrors, `${label}: console errors`).toEqual([]);
  expect(w.failedRequests, `${label}: failed requests`).toEqual([]);
}

/** Booth staff on the kiosk machine (loopback): find the code on the prize desk and mark it redeemed. */
async function redeemAtDesk(page: Page, code: string, name: string, shots?: string): Promise<Watch> {
  const staff = await page.context().newPage();
  const sw = watch(staff);
  await staff.goto('/staff/rewards');
  await expect(staff.locator('h1')).toHaveText('Prize desk');
  await staff.locator('#q').fill(formatted(code).toLowerCase());
  await staff.locator('form.search button[type="submit"]').click();
  const row = staff.locator('li.row', { has: staff.locator('.row-code', { hasText: formatted(code) }) });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.row-choice')).toHaveText('Plush prize');
  await expect(row.locator('.row-plush')).toContainText(name);
  if (shots) await shot(staff, `${shots}-staff-found`);
  await row.locator('button[type="submit"]').click();
  await expect(staff.locator('.notice')).toContainText(`${formatted(code)} marked as redeemed`);
  await expect(staff.locator('li.row.state-redeemed .row-code')).toHaveText(formatted(code));
  if (shots) await shot(staff, `${shots}-staff-redeemed`);
  await staff.close();
  return sw;
}

interface QrRecord {
  layout: string;
  viewport: string;
  qrCssPx: number;
  modules: number;
  version: number;
  pxPerModule: number;
  physicalCm: number | null;
  basis: string;
  decoded: boolean;
}
const QR_RECORDS: QrRecord[] = [];

/**
 * Size of the QR on screen: CSS px, modules (quiet zone included) and version, the physical size
 * implied by the display profile, and whether jsQR reads it from a screenshot of the whole page.
 */
async function recordQr(page: Page, display: Display, layout: string, url: string): Promise<QrRecord> {
  const qr = await box(page, 'reward-qr');
  const modules = Number(await page.getByTestId('reward-qr').getAttribute('data-modules'));
  const version = (modules - 8 - 17) / 4;
  const canvas = await box(page, 'game-canvas');
  const env = await plush<{ screenW: number; screenH: number; windowMode: string; screenCss: number }>(
    page,
    (p, d) => {
      const v = p.settings().profiles[d].view;
      return { screenW: v.screenW, screenH: v.screenH, windowMode: v.windowMode, screenCss: Math.max(screen.width, screen.height) };
    },
    display,
  );
  let physicalCm: number | null = null;
  let basis = '';
  if (display === 'portrait32' || display === 'portrait86') {
    // The 9:16 panel (simulated or real) spans the game's box: its width is the panel's width.
    const panelW = Math.min(env.screenW, env.screenH);
    physicalCm = (qr.width / canvas.width) * panelW * 100;
    basis = `${(panelW * 100).toFixed(1)} cm wide panel across ${canvas.width.toFixed(0)} CSS px`;
  } else if (display === 'desktop') {
    // A window on the profile's monitor: metres per CSS px of the screen the browser reports.
    const pitch = Math.max(env.screenW, env.screenH) / env.screenCss;
    physicalCm = qr.width * pitch * 100;
    basis = `${(env.screenW * 100).toFixed(1)} cm monitor across ${env.screenCss} CSS px (profile default 24-inch)`;
  }
  const decoded = (await decodePage(page)) === url;
  const record: QrRecord = {
    layout,
    viewport: `${page.viewportSize()!.width}x${page.viewportSize()!.height}`,
    qrCssPx: Math.round(qr.width),
    modules,
    version,
    pxPerModule: +(qr.width / modules).toFixed(2),
    physicalCm: physicalCm === null ? null : +physicalCm.toFixed(1),
    basis,
    decoded,
  };
  QR_RECORDS.push(record);
  console.log(`QR ${JSON.stringify(record)}`);
  return record;
}

test.afterAll(() => {
  if (QR_RECORDS.length) console.log(`QR sizes:\n${QR_RECORDS.map((r) => JSON.stringify(r)).join('\n')}`);
});

test.describe('27. prize claims against the real server', () => {
  test('desktop GPU theme: demo rounds issue nothing; a real win → QR → phone claim page → prize ticket → prize desk → collected', async ({ page, browser, request }) => {
    test.setTimeout(2_400_000);
    const w = watch(page);
    const status = await serverStatus(request);
    console.log(`server: ${JSON.stringify(status)}`);
    expect(status).toMatchObject({ enabled: true, canIssue: true });
    expect(status.claimBase).toMatch(/^http:\/\/[^/]+:\d+$/);
    // The sandbox has a LAN address, so the claim listener's link is what the QR must hold.
    expect(status.reach, 'this machine has a LAN address: the claim listener is reachable').toBe('lan');
    const before = await storedCodes(request);

    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'en', settings: { system: { attractDemo: true } } });
    await recordGuide(page);

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
    expect(demo.reward.state).toBe('idle');
    // Give a request that might have been sent time to arrive before counting.
    await page.waitForTimeout(500);
    expect((await storedCodes(request)).length, 'demo rounds issue no code on the server').toBe(before.length);

    // A real win: exactly one code per round on the server, although the exit and the result both ask.
    await start(page);
    const { result, tries } = await winARound(page, 12);
    console.log(`won round ${result.roundId} (${result.targetTypeId}) after ${tries} tries`);
    await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('ready');
    const reward = await rewardState(page);
    expect(reward.roundId).toBe(result.roundId);
    expect(reward.code).toMatch(CODE);
    expect(reward.reach).toBe('lan');
    expect(reward.url).toBe(`${status.claimBase}/c/${reward.code}`);
    const code = reward.code!;
    const url = reward.url!;
    const after = await storedCodes(request);
    expect(after.length, 'one code for the won round').toBe(before.length + 1);
    const stored = after.find((r) => r.code === code)!;
    const name = await plushName(page, result.targetTypeId);
    expect(stored).toMatchObject({ status: 'open', choice: '', prizeName: name, themeId: 'gpu', lang: 'en', options: 'both' });

    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'ready');
    await expect(page.getByTestId('reward-code')).toHaveText(formatted(code));
    // The QR holds exactly the claim page link: read back from a screenshot of the whole page.
    const decoded = await decodePage(page);
    console.log(`QR from the page screenshot: ${decoded}`);
    expect(decoded).toBe(url);
    await shot(page, 'desktop-win-real-code');
    await recordQr(page, 'desktop', 'desktop', url);
    await expectNoOverflow(page);

    // Screen readers: the card is a status region, the QR an image with a name, the code a named group.
    await expect(page.getByTestId('result-win')).toHaveAttribute('role', 'status');
    await expect(page.getByRole('img', { name: QR_LABEL })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Prize code' })).toContainText(formatted(code));
    await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /The QR code stays for \d+ more seconds/);
    console.log(`card accessibility tree:\n${await page.getByTestId('result-win').ariaSnapshot()}`);

    // The win line waited for the code and invites the scan (local lines: the server has no key).
    const { event: wonEvent, line: winLine } = await winLineOf(page, result.roundId);
    expect(wonEvent.facts.reward).toEqual({ qr: true, options: 'both' });
    console.log(`win line (${winLine.source}): "${winLine.text}"`);
    expect(winLine.source).toBe('local');
    expect(winLine.text).toMatch(QR_WORDS);
    expect((await guideEvents(page)).filter((e) => e.type === 'prize_won' && e.roundId === result.roundId)).toHaveLength(1);
    // The card leaves Momo's line readable, at the tallest the bubble may grow (it used to cut into
    // the bubble once the card made room for the code). The line itself may be gone by now.
    const card = await box(page, 'result-win');
    const g = await plush<{ x: number; y: number; w: number; maxH: number }>(page, (p) => p.state().hud.guide);
    const covers = card.x < g.x + g.w && g.x < card.x + card.width && card.y < g.y + g.maxH && g.y < card.y + card.height;
    expect(covers, `card ${JSON.stringify(card)} over Momo's line ${JSON.stringify(g)}`).toBe(false);

    // The visitor scans the QR with a phone.
    const phone = await phoneContext(browser);
    const claim = await phone.newPage();
    const cw = watch(claim);
    await claim.goto(decoded!);
    await expect(claim.locator('h1')).toHaveText(`You caught ${name}!`);
    await expect(claim.locator('button[name="choice"]')).toHaveCount(2);
    await expect(claim.locator('button[value="prize"]')).toContainText('Collect your plush at the booth');
    await expect(claim.locator('button[value="swag"]')).toContainText('Get your swag discount');
    await expect(claim.locator('.meta')).toContainText(`Code ${formatted(code)}`);
    const noScroll = await claim.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noScroll, 'claim page fits 390 px').toBe(true);
    await shot(claim, 'phone-claim-choose');

    // One tap on the prize: the ticket with the code.
    await claim.locator('button[value="prize"]').click();
    await expect(claim.locator('h1')).toHaveText('Show this screen to booth staff');
    await expect(claim.locator('.ticket .code')).toHaveText(formatted(code));
    await expect(claim.locator('.ticket .status')).toHaveText('Ready to collect');
    await expect(claim.locator('.ticket-plush')).toContainText(name);
    await shot(claim, 'phone-claim-ticket');
    // The other option is refused now; the same one again is harmless.
    const other = await phone.request.post(`${url}/choose`, { form: { choice: 'swag' }, headers: { accept: 'application/json' }, maxRedirects: 0 });
    expect(other.status()).toBe(409);
    expect((await other.json()).error.code).toBe('already_chosen');
    const same = await phone.request.post(`${url}/choose`, { form: { choice: 'prize' }, maxRedirects: 0 });
    expect(same.status()).toBe(303);
    expect((await storedCodes(request)).find((r) => r.code === code)).toMatchObject({ status: 'chosen', choice: 'prize' });

    // Booth staff on the kiosk machine (loopback): find the code, mark it redeemed.
    const sw = await redeemAtDesk(page, code, name, 'desktop');
    expect((await storedCodes(request)).find((r) => r.code === code)).toMatchObject({ status: 'redeemed', choice: 'prize' });

    // The visitor's page now says collected; any further choice is refused.
    await claim.reload();
    await expect(claim.locator('h1')).toHaveText('Already collected');
    await expect(claim.locator('.ticket .status')).toHaveText('Collected');
    await shot(claim, 'phone-claim-collected');
    for (const choice of ['prize', 'swag']) {
      const again = await phone.request.post(`${url}/choose`, { form: { choice }, headers: { accept: 'application/json' }, maxRedirects: 0 });
      expect(again.status(), `choose ${choice} after redeeming`).toBe(409);
      expect((await again.json()).error.code).toBe('already_redeemed');
    }
    // The same through the form a visitor would post (the page explains it, nothing changes).
    const form = await phone.request.post(`${url}/choose`, { form: { choice: 'swag' }, maxRedirects: 0 });
    expect(form.status()).toBe(409);
    expect(await form.text()).toContain('Already collected');

    // Settings → Rewards on the kiosk: server on, the claim address and who can open it.
    await page.bringToFront();
    await openSettings(page, 'menu-settings', 'rewards');
    await expect(page.getByTestId('rewards-status')).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('rewards-server')).toHaveText('On');
    await expect(page.getByTestId('rewards-claim-base')).toHaveText(status.claimBase);
    await expect(page.getByTestId('rewards-reach')).toHaveAttribute('data-reach', 'lan');
    await expect(page.getByTestId('rewards-reach')).toHaveText('Phones on this network');
    await expect(page.getByTestId('rewards-can-issue')).toBeVisible();
    await expect(page.getByTestId('rewards-loopback-warning')).toHaveCount(0);
    await page.getByTestId('rewards-status').scrollIntoViewIfNeeded();
    await shot(page, 'desktop-settings-rewards-status');
    await closeSettings(page, 'cancel');

    await phone.close();
    expectClean(w, 'kiosk');
    expectClean(cw, 'claim page');
    expectClean(sw, 'staff page');
  });

  test('slow server: the card counts down before the code arrives, the win line waits for it; PLAY AGAIN while issuing drops the late answer', async ({ page, request }) => {
    test.setTimeout(2_400_000);
    const w = watch(page);
    // The real server answers at once; the answer reaches the page only when the test opens the
    // gate (a busy booth machine), so "the code is still on its way" is a state, not a race.
    let open: () => void = () => undefined;
    let gate = Promise.resolve();
    const delivered: string[] = [];
    const closeGate = () => {
      gate = new Promise<void>((resolve) => (open = resolve));
    };
    await page.route('**/api/rewards/issue', async (route) => {
      const response = await route.fetch();
      await gate;
      try {
        await route.fulfill({ response });
        delivered.push('answer');
      } catch {
        delivered.push('aborted'); // the client's own timeout came first
      }
    });
    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'en', settings: { system: { attractDemo: false }, rewards: { qrSeconds: 60 } } });
    await recordGuide(page);
    await start(page);

    // Round A: the code comes shortly after the card (within the win line's 1.5 s wait).
    closeGate();
    const a = (await winARound(page, 12)).result;
    const early = await rewardState(page);
    // Released at once: the line's 1.5 s wait runs from the result, and checks here take time.
    open();
    expect(early.state, 'the code is on its way when the card appears').toBe('issuing');
    // The countdown already runs while the code is on its way.
    expect(early.visibleUntil).toBeGreaterThan(0);
    await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('ready');
    const ready = await rewardState(page);
    // The QR's time started when the card appeared, not when the code came.
    expect(ready.visibleUntil).toBe(early.visibleUntil);
    await expect(page.getByTestId('reward-qr')).toBeVisible();
    expect(await decodePage(page)).toBe(ready.url);
    await expectWinLine(page, a.roundId, `round ${a.roundId}`);

    // Round B: PLAY AGAIN while the code is still on its way.
    await click(page, 'result-again');
    const count = (await storedCodes(request)).length;
    closeGate();
    // A quick player: PLAY AGAIN 0.3 s after the card appears, well inside the win line's 1.5 s wait
    // (a pointer click through Playwright takes longer than that under software rendering; the
    // button calls the same game.playAgain()).
    await page.evaluate(() => {
      const w = window as any;
      const off = w.__plush.core().machine.events.on('result', (r: any) => {
        if (r.outcome !== 'won') return;
        off();
        setTimeout(() => {
          w.__playAgainAt = Date.now();
          w.__plush.game.playAgain();
        }, 300);
      });
    });
    const b = (await winARound(page, 12)).result;
    await expect.poll(() => page.evaluate(() => (window as any).__playAgainAt ?? 0)).toBeGreaterThan(0);
    const pressedAfter = (await page.evaluate(() => (window as any).__playAgainAt)) - (await resultAt(page, b.roundId));
    console.log(`round ${b.roundId}: PLAY AGAIN ${pressedAfter} ms after the result`);
    expect(pressedAfter, 'PLAY AGAIN came within the 1.5 s wait').toBeLessThan(1500);
    await expect(page.getByTestId('result-win')).toHaveCount(0);
    expect((await rewardState(page)).state).toBe('idle');
    // The late answer arrives (the server did store the code) and is dropped: no card, no QR.
    open();
    await expect.poll(() => delivered.length, { timeout: 30_000 }).toBe(2);
    console.log(`late answer of round ${b.roundId}: ${delivered[1]}`);
    expect(delivered[1], 'a real answer, after PLAY AGAIN').toBe('answer');
    expect(await storedCodes(request)).toHaveLength(count + 1);
    await page.waitForTimeout(1500);
    expect(await rewardState(page)).toMatchObject({ state: 'idle', code: null });
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await expect(page.getByTestId('reward-block')).toHaveCount(0);
    // Round B ended before its code came: no win line for it (it would talk about a card that is gone).
    expect((await guideEvents(page)).filter((e) => e.type === 'prize_won' && e.roundId === b.roundId)).toEqual([]);
    expectClean(w, 'kiosk (slow server, rounds A and B)');

    // Round C: the answer never comes in time. The card shows the placeholder, then after the
    // client's time limit (it asks once more after the first timeout, see src/rewards/client.ts)
    // the honest note; the code the server stored is never shown (an orphan).
    closeGate();
    const c = (await winARound(page, 12)).result;
    const pending = await rewardState(page);
    expect(pending.state, 'the code is on its way').toBe('issuing');
    // The card is up before the code: placeholder, "getting your code", the countdown running.
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'issuing');
    await expect(page.getByTestId('reward-qr-pending')).toBeVisible();
    await expect(page.getByTestId('reward-instruction')).toHaveText('Getting your prize code…');
    await expect(page.getByTestId('reward-ring')).toBeVisible();
    expect(pending.visibleUntil).toBeGreaterThan(0);
    await shot(page, 'desktop-slow-issuing');
    await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('unavailable');
    expect(await rewardState(page)).toMatchObject({ roundId: c.roundId, reason: 'offline', code: null, url: null, visibleUntil: 0 });
    await expect(page.getByTestId('reward-unavailable')).toHaveText('Prize code unavailable — please ask booth staff');
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await shot(page, 'desktop-slow-timeout');
    const { event: late } = await winLineOf(page, c.roundId);
    expect(late.facts.reward).toBeUndefined();
    open();
    // Two requests for round C (the first and its retry), both answered only after the client gave up.
    await expect.poll(() => delivered.length, { timeout: 30_000 }).toBe(4);
    console.log(`answers of round ${c.roundId} after the client gave up: ${delivered.slice(2).join(', ')}`);
    // The server keys codes on session + round, so the retry stored no second code.
    expect(await storedCodes(request), 'the server stored the code the kiosk gave up on').toHaveLength(count + 2);
    // The late answers change nothing on the kiosk.
    expect(await rewardState(page)).toMatchObject({ state: 'unavailable', code: null });
    expect(w.pageErrors).toEqual([]);
    console.log(`round C: console errors ${JSON.stringify(w.consoleErrors)}, failed requests ${JSON.stringify(w.failedRequests)}`);
    expect(w.failedRequests.every((r) => r.includes('/api/rewards/issue'))).toBe(true);
  });

  test('reach loopback: no QR phones could not open, the code for booth staff, no scan line, the settings warn', async ({ page, request }) => {
    test.setTimeout(2_400_000);
    const w = watch(page);
    const status = await serverStatus(request);
    // A server without a LAN address answers with its claim listener on 127.0.0.1 (server/rewards/claimBase.ts).
    const loopbackBase = `http://127.0.0.1:${new URL(status.claimBase).port}`;
    await page.route('**/api/rewards/status', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), claimBase: loopbackBase, reach: 'loopback' } });
    });
    await page.route('**/api/rewards/issue', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: response.ok() ? { ...body, url: `${loopbackBase}/c/${body.code}`, reach: 'loopback' } : body });
    });
    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'en', settings: { system: { attractDemo: false } } });
    await recordGuide(page);
    await start(page);
    const { result } = await winARound(page, 12);
    await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('ready');
    const reward = await rewardState(page);
    expect(reward).toMatchObject({ reach: 'loopback', url: `${loopbackBase}/c/${reward.code}` });
    const code = reward.code!;
    expect((await storedCodes(request)).some((r) => r.code === code), 'a real, stored code').toBe(true);

    // The card: the code and "show it to booth staff", no QR, the countdown still running.
    await expect(page.getByTestId('result-win')).toHaveAttribute('data-reward', 'ready');
    await expect(page.getByTestId('reward-qr')).toHaveCount(0);
    await expect(page.getByTestId('reward-qr-local')).toHaveText('No QR code on this kiosk');
    await expect(page.getByTestId('reward-instruction')).toHaveText('Show this code to booth staff to claim your prize');
    await expect(page.getByTestId('reward-code')).toHaveText(formatted(code));
    await expect(page.getByTestId('reward-ring')).toBeVisible();
    expect(await decodePage(page), 'nothing on screen to scan').toBeNull();
    await shot(page, 'desktop-loopback-card');

    // Momo does not invite anyone to scan a QR that is not there.
    const { event, line } = await winLineOf(page, result.roundId);
    console.log(`loopback win line: "${line.text}"`);
    expect(event.facts.reward).toBeUndefined();
    expect(line.text).not.toMatch(QR_WORDS);

    // Settings: who can open the link, the warning, and a preview that matches the card.
    await openSettings(page, 'menu-settings', 'rewards');
    await expect(page.getByTestId('rewards-reach')).toHaveAttribute('data-reach', 'loopback');
    await expect(page.getByTestId('rewards-reach')).toHaveText('Only this machine');
    await expect(page.getByTestId('rewards-loopback-warning')).toBeVisible();
    await page.getByTestId('rewards-loopback-warning').scrollIntoViewIfNeeded();
    await shot(page, 'desktop-loopback-settings');
    await click(page, 'rewards-preview');
    await expect(page.getByTestId('reward-preview-card')).toBeVisible();
    await expect(page.getByTestId('reward-preview-card').getByTestId('reward-qr-local')).toBeVisible();
    await expect(page.getByTestId('reward-preview-card').getByTestId('reward-qr')).toHaveCount(0);
    await shot(page, 'desktop-loopback-preview');
    await click(page, 'reward-preview-close');
    await closeSettings(page, 'cancel');

    // The code is still good at the booth: staff open the claim page on this machine, then redeem.
    const desk = await page.context().newPage();
    const dw = watch(desk);
    await desk.goto(reward.url!);
    const name = await plushName(page, result.targetTypeId);
    await expect(desk.locator('h1')).toHaveText(`You caught ${name}!`);
    await desk.locator('button[value="prize"]').click();
    await expect(desk.locator('.ticket .code')).toHaveText(formatted(code));
    await desk.close();
    const sw = await redeemAtDesk(page, code, name);
    expect((await storedCodes(request)).find((r) => r.code === code)).toMatchObject({ status: 'redeemed', choice: 'prize' });
    expectClean(w, 'kiosk (loopback)');
    expectClean(dw, 'claim page on the booth machine');
    expectClean(sw, 'staff page');
  });

  test('owner settings reach the server cleaned: claim link template, swag link and discount wording', async ({ page, browser, request }) => {
    test.setTimeout(2_400_000);
    const w = watch(page);
    const status = await serverStatus(request);
    // As an owner might paste them: spaces around the links, a tab inside the wording.
    const rewards = { claimUrl: ' https://claim.example.com/c/{code}?event=gtc ', swagUrl: ' https://shop.example.com/gtc', discountText: '20% off\tall swag' };
    await boot(page, { display: 'desktop', theme: 'gpu', lang: 'en', settings: { system: { attractDemo: false }, rewards } });
    await start(page);
    await winARound(page, 12);
    await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('ready');
    const reward = await rewardState(page);
    const code = reward.code!;
    expect(reward).toMatchObject({ reach: 'external', url: `https://claim.example.com/c/${code}?event=gtc` });
    expect(await decodePage(page)).toBe(reward.url);
    await expect(page.getByTestId('reward-instruction')).toHaveText('Scan to collect your prize or get 20% off all swag');
    await shot(page, 'desktop-owner-link-card');

    // The code is stored here as well: its built-in claim page shows the cleaned wording and the swag link.
    const phone = await phoneContext(browser);
    const claim = await phone.newPage();
    await claim.goto(`${status.claimBase}/c/${code}`);
    await expect(claim.locator('button[value="swag"] .btn-sub')).toHaveText('20% off all swag');
    await claim.locator('button[value="swag"]').click();
    await expect(claim.locator('h1')).toHaveText('20% off all swag');
    const store = claim.locator('a.btn', { hasText: 'Open the swag store' });
    await expect(store).toHaveAttribute('href', 'https://shop.example.com/gtc');
    await expect(store).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(claim.locator('.ticket .code')).toHaveText(formatted(code));
    await shot(claim, 'phone-claim-swag');
    await phone.close();

    // Settings → Rewards: the owner's link is what visitors open.
    await openSettings(page, 'menu-settings', 'rewards');
    await expect(page.getByTestId('rewards-reach')).toHaveAttribute('data-reach', 'external');
    await expect(page.getByTestId('rewards-claim-base')).toHaveText('https://claim.example.com/c/{code}?event=gtc');
    await closeSettings(page, 'cancel');
    expectClean(w, 'kiosk (owner settings)');
  });

  for (const [name, display, width, height] of [
    ['portrait32', 'portrait32', 1080, 1920],
    ['portrait86', 'portrait86', 2160, 3840],
    ['phone', 'mobile', 844, 390],
  ] as const) {
    test(`QR scannability with the real code: ${name} (${width}×${height})`, async ({ page, browser, request }) => {
      test.setTimeout(2_400_000);
      await page.setViewportSize({ width, height });
      const w = watch(page);
      await boot(page, { display, theme: 'gpu', lang: 'en', settings: { system: { attractDemo: false } } });
      await recordGuide(page);
      await start(page);
      const { result } = await winARound(page, 12);
      await expect.poll(async () => (await rewardState(page)).state, { timeout: 30_000 }).toBe('ready');
      const reward = await rewardState(page);
      expect((await storedCodes(request)).some((r) => r.code === reward.code)).toBe(true);
      await expect(page.getByTestId('reward-code')).toHaveText(formatted(reward.code!));
      const { event, line } = await winLineOf(page, result.roundId);
      console.log(`${name} win line: "${line.text}"`);
      if (display === 'mobile') {
        // The player holds the phone: a claim link and the code, no QR, and no line about scanning one.
        await expect(page.getByTestId('reward-qr')).toHaveCount(0);
        const link = page.getByTestId('reward-link');
        await expect(link).toHaveAttribute('href', reward.url!);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(event.facts.reward).toBeUndefined();
        expect(line.text).not.toMatch(QR_WORDS);
        await shot(page, `${name}-win-real-code`);
        // The link opens the claim page of this code (keyboard: it is a real, focusable link).
        await link.focus();
        await expect(link).toBeFocused();
        const [claim] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')]);
        await claim.waitForLoadState();
        expect(claim.url()).toBe(reward.url);
        await expect(claim.locator('h1')).toHaveText(`You caught ${await plushName(page, result.targetTypeId)}!`);
        await claim.close();
        // Enter opened the link and nothing else: the card with the code is still there (the game's
        // Enter key would have pressed PLAY AGAIN).
        await expect(page.getByTestId('result-win')).toBeVisible();
        expect(await rewardState(page)).toMatchObject({ state: 'ready', code: reward.code });
      } else {
        await expectWinLine(page, result.roundId, name);
        await expectNoOverflow(page);
        const rec = await recordQr(page, display, name, reward.url!);
        expect(rec.decoded, 'jsQR reads the QR from the page screenshot').toBe(true);
        expect(rec.qrCssPx).toBeGreaterThanOrEqual(160);
        expect(rec.physicalCm!, 'at least 8 cm on the kiosk').toBeGreaterThanOrEqual(8);
        await shot(page, `${name}-win-real-code`);
        // Opened on a phone, the decoded link is the claim page of this code.
        const phone = await phoneContext(browser);
        const claim = await phone.newPage();
        await claim.goto(reward.url!);
        await expect(claim.locator('h1')).toHaveText(`You caught ${await plushName(page, result.targetTypeId)}!`);
        await phone.close();
      }
      expectClean(w, `kiosk (${name})`);
    });
  }
});
