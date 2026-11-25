import { expect, test, type Page } from '@playwright/test';
import { aim, box, boot, click, expectInZone, ff, ffUntil, fieldToys, finishRound, frames, input, outsideZone, plush, results, settle, state, watch } from './helpers';

/**
 * The machine lobby and the session UI (docs/design/machines.md, sections 4.1 and 4.11; workstream F):
 * the MACHINES deck button opens "Which machine today?" with a card per machine and today's pick;
 * a pick switches behind the curtain; the session HUD counts the tries, a try toast follows each
 * items try and a session card ends the session; the lobby goes back to classic, which still plays.
 * A Sparkle Rush run fast-forwarded to time up asks for initials and the local ranking keeps them.
 * On the 86" portrait preset every control of the lobby, the HUD, the initials entry and the session
 * card stays inside the reachable band (normalised y 0.25-0.75), with Chinese labels.
 *
 * Every machine is offered to players (registry `available: true`): the spec uses the lobby and the
 * deck as a player does, without the debug override for machines that are not offered.
 */

/** The machine the game is on once no switch is running. */
const settled = (page: Page) => plush(page, (p) => `${p.machine().id}/${p.ui().themeBusy}`);
const machineUi = (page: Page) => plush(page, (p) => p.ui().machine);
/** The claw's hub on screen (CSS px): where the player looks while aiming and carrying. */
const clawOnScreen = (page: Page) =>
  plush(page, (p) => {
    const cam = p.game.stage.camera;
    const hub = p.core().claw.hubPose.pos;
    const v = new cam.position.constructor(hub[0], hub[1], hub[2]).project(cam);
    const b = document.querySelector('[data-testid="game-canvas"]')!.getBoundingClientRect();
    return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((1 - v.y) / 2) * b.height };
  });
/** Only the reach exception every spec allows: the corner "i". */
const ALLOW = ['info-button'];

/** Drops one item of the current machine straight into its opening (in READY: it counts for the next try). */
async function dropAnItem(page: Page): Promise<void> {
  await plush(page, (p) => {
    const g = p.core().def.geometry.opening;
    const toy = [...p.core().phys.toys.values()].find((t: any) => t.item && !t.inBin && t.body.worldCom().y > 0.02);
    toy.body.setTranslation({ x: (g.xMin + g.xMax) / 2, y: 0.08, z: (g.zMin + g.zMax) / 2 }, true);
    toy.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  });
  await ff(page, 0.6);
}

/** One try through the real GRAB button, to its result. */
async function oneTry(page: Page): Promise<any> {
  expect(await ffUntil(page, ['READY', 'AIMING'], 12)).toMatch(/READY|AIMING/);
  const n = (await results(page)).length;
  await click(page, 'grab');
  const r = await finishRound(page, n);
  expect(r, 'the try finished').toBeTruthy();
  return r;
}

test.describe('30. machine lobby and session UI', () => {
  test('desktop: lobby and today’s pick, a shelf session with its HUD, toast and card, back to classic', async ({ page }) => {
    test.setTimeout(1_200_000);
    const w = watch(page);
    await boot(page, { display: 'desktop', settings: { system: { attractDemo: false }, rewards: { mode: 'all' }, machines: { shelf: { tries: 2, rewardItems: 1 } } } });
    // Four machines are offered, so the deck has MACHINES; classic has no session HUD.
    await frames(page, 2);
    expect(await plush(page, (p) => p.game.machineCards().map((c: any) => c.id))).toEqual(['classic', 'bridge', 'shelf', 'rush']);
    await expect(page.getByTestId('session-hud')).toHaveCount(0);
    const pick: string = await plush(page, (p) => p.dailyPick());
    expect(['bridge', 'shelf', 'rush']).toContain(pick);

    // From attract mode: the deck button opens the lobby.
    await expect(page.getByTestId('menu-machines')).toBeVisible({ timeout: 60_000 });
    await click(page, 'menu-machines');
    await expect(page.getByTestId('lobby')).toBeVisible();
    expect(await plush(page, (p) => p.ui().modal)).toBe('lobby');
    for (const id of ['classic', 'bridge', 'shelf', 'rush']) await expect(page.getByTestId(`lobby-card-${id}`)).toHaveCount(1);
    await expect(page.getByTestId('lobby-card-classic')).toHaveAttribute('data-current', 'true');
    // Exactly one TODAY'S PICK ribbon, on the machine the director picked (never classic).
    await expect(page.locator('[data-testid^="lobby-card-"][data-pick="true"]')).toHaveCount(1);
    await expect(page.getByTestId(`lobby-card-${pick}`)).toHaveAttribute('data-pick', 'true');
    await expect(page.getByTestId(`lobby-card-${pick}`).getByTestId('lobby-pick')).toContainText('×1.5');
    await expect(page.getByTestId('lobby-card-shelf')).toContainText('Tumble Shelf');
    await expect(page.getByTestId('lobby-card-shelf')).toContainText('2 tries');
    // The keys move the focus; Esc closes without switching.
    await expect(page.getByTestId('lobby-card-classic')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('lobby-card-bridge')).toHaveAttribute('data-focused', 'true');
    await click(page, 'lobby-next');
    await expect(page.getByTestId('lobby-card-shelf')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lobby')).toHaveCount(0);
    expect((await state(page)).phase).toBe('ATTRACT');

    // Pick the shelf from attract mode: switched behind the curtain, straight into a player READY.
    await click(page, 'menu-machines');
    await expect(page.getByTestId('lobby')).toBeVisible();
    await click(page, 'lobby-play-shelf');
    await expect.poll(() => settled(page), { timeout: 240_000 }).toBe('shelf/false');
    await expect(page.getByTestId('lobby')).toHaveCount(0);
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);
    const hud = page.getByTestId('session-hud');
    await expect(hud).toBeVisible();
    await expect(hud).toHaveAttribute('data-genre', 'shelf');
    await expect(hud).toHaveAttribute('data-tries', '0');
    await expect(page.getByTestId('session-tries')).toHaveText('Tries 2/2');
    await expect(page.getByTestId('machine-plate')).toHaveText('TRIES 2/2');
    if (pick === 'shelf') await expect(page.getByTestId('session-bonus')).toContainText('×1.5');

    // Try 1 drops a box: the HUD counts it and the try toast shows what dropped and the points.
    await dropAnItem(page);
    const first = await oneTry(page);
    expect(first.machine.items.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('try-toast')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('try-toast')).toHaveAttribute('data-scored', 'true');
    await expect(page.getByTestId('try-toast')).toContainText('Boxes +');
    await expect(hud).toHaveAttribute('data-tries', '1');
    await expect(page.getByTestId('session-items')).toHaveText(String(first.machine.items.length));
    await expect(page.getByTestId('session-tries')).toHaveText('Tries 1/2');
    // Items tries never raise the classic result card.
    await expect(page.getByTestId('result-win')).toHaveCount(0);

    // Try 2 ends the session: the session card with the points, the prize and PLAY AGAIN / MACHINES.
    await oneTry(page);
    await ff(page, 3);
    const card = page.getByTestId('session-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const sessionResult = await plush(page, (p) => p.ui().sessionResult);
    expect(sessionResult).toMatchObject({ machineId: 'shelf', reason: 'tries' });
    await expect(card).toHaveAttribute('data-points', String(sessionResult.points));
    await expect(card).toContainText('SESSION OVER');
    await expect(page.getByTestId('session-total')).toHaveText(String(sessionResult.points));
    expect(sessionResult.rewardTypeId).toBeTruthy();
    await expect(card).toHaveAttribute('data-reward', /issuing|ready|unavailable/);
    await expect(page.getByTestId('session-hud')).toHaveCount(0);
    for (const id of ['session-card', 'session-again', 'session-lobby']) {
      const b = await box(page, id);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(720.5);
    }

    // PLAY AGAIN starts a fresh session on the shelf.
    await click(page, 'session-again');
    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await machineUi(page)).session.tries).toBe(0);
    await expect(page.getByTestId('session-tries')).toHaveText('Tries 2/2');

    // Back to classic through the lobby: no session HUD, and classic still plays a round to its result.
    await click(page, 'menu-machines');
    await expect(page.getByTestId('lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-card-shelf')).toHaveAttribute('data-current', 'true');
    await click(page, 'lobby-play-classic');
    await expect.poll(() => settled(page), { timeout: 240_000 }).toBe('classic/false');
    await expect(page.getByTestId('session-hud')).toHaveCount(0);
    await expect(page.getByTestId('machine-plate')).toHaveCount(0);
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);
    const toys = await fieldToys(page);
    expect(toys.length).toBeGreaterThan(0);
    await aim(page, toys[0]!.x, toys[0]!.z);
    const n = (await results(page)).length;
    await click(page, 'grab');
    const classic = await finishRound(page, n);
    expect(classic).toBeTruthy();
    expect(['won', 'slipped', 'empty']).toContain(classic.outcome);
    expect(classic.machine).toBeUndefined();
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('portrait86 in Chinese: lobby, a Sparkle Rush run to time up, initials and the ranking, all inside the band', async ({ page }) => {
    test.setTimeout(1_200_000);
    const w = watch(page);
    await page.setViewportSize({ width: 1080, height: 1920 });
    await boot(page, { display: 'portrait86', lang: 'zh', settings: { system: { attractDemo: false, language: 'zh' } } });
    expect((await state(page)).profile).toBe('portrait86');
    await plush(page, (p) => p.game.pressStart());
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);

    // The deck button inside the band; the lobby with Chinese labels, every control inside the band.
    await expect(page.getByTestId('menu-machines')).toBeVisible({ timeout: 60_000 });
    await expectInZone(page, 'menu-machines');
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await click(page, 'menu-machines');
    await expect(page.getByTestId('lobby')).toBeVisible();
    await settle(page);
    await expect(page.getByTestId('lobby')).toContainText('今天玩哪台？');
    await expect(page.getByTestId('lobby-card-rush')).toContainText('闪耀冲刺');
    await expect(page.getByTestId('lobby-card-shelf')).toContainText('翻落货架');
    await expect(page.locator('[data-testid^="lobby-card-"][data-pick="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="lobby-pick"]')).toContainText('今日推荐');
    await expectInZone(page, 'lobby');
    expect(await outsideZone(page, ALLOW), 'lobby').toEqual([]);
    // Scrolled to its end, the list's controls stay inside too.
    await page.getByTestId('lobby-track').evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await outsideZone(page, ALLOW), 'lobby scrolled').toEqual([]);
    for (let i = 0; i < 4 && (await page.getByTestId('lobby-card-rush').getAttribute('data-focused')) !== 'true'; i++) await click(page, 'lobby-next');
    await expect(page.getByTestId('lobby-card-rush')).toHaveAttribute('data-focused', 'true');
    // The list scrolls the focused card into view (smoothly): once there, its PLAY is inside the band.
    await expect
      .poll(async () => {
        const b = await box(page, 'lobby-play-rush');
        return b.y / 1920 >= 0.248 && (b.y + b.height) / 1920 <= 0.752;
      }, { timeout: 60_000 })
      .toBe(true);
    await click(page, 'lobby-play-rush');
    await expect.poll(() => settled(page), { timeout: 240_000 }).toBe('rush/false');
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);

    // The session HUD: the clock, in the band; one gem into the chute, then one try.
    const hud = page.getByTestId('session-hud');
    await expect(hud).toBeVisible();
    await expect(hud).toHaveAttribute('data-genre', 'rush');
    await expectInZone(page, 'session-hud');
    await expect(page.getByTestId('session-clock')).toHaveText(/^1:15$/);
    await dropAnItem(page);
    await oneTry(page);
    await expect(hud).toHaveAttribute('data-tries', '1');
    await expect(page.getByTestId('session-items')).not.toHaveText('0');
    // The last seconds: the clock turns urgent.
    await plush(page, (p) => p.machineDebug.setSessionSeconds(6));
    await ff(page, 0.5);
    await expect(page.getByTestId('session-clock')).toHaveAttribute('data-low', 'true');
    await expect(page.getByTestId('machine-plate')).toHaveAttribute('data-low', 'true');

    // Time up: a first place on the empty board asks for initials (in the band, in Chinese).
    await plush(page, (p) => p.machineDebug.setSessionSeconds(0.3));
    await ff(page, 3);
    const entry = page.getByTestId('initials-entry');
    await expect(entry).toBeVisible({ timeout: 60_000 });
    // The run ended with the claw waiting in READY: the claw is locked until PLAY AGAIN, and the deck
    // says so (GRAB down, the joystick off) instead of inviting another try under the card.
    expect((await state(page)).phase).toBe('READY');
    await expect(page.getByTestId('grab')).toBeDisabled();
    await expect(page.getByTestId('stick')).toHaveAttribute('aria-disabled', 'true');
    // Nor does Momo's idle hint ("move the claw whenever you're ready") come up under the card.
    expect(await plush(page, (p) => p.game.director.allowHint())).toBe(false);
    // The entry times out after 30 s of wall clock; software rendering at 1080 × 1920 can take that
    // long for a few clicks, so the spec moves the deadline out (the timeout has its unit test).
    await plush(page, (p) => {
      const e = p.ui().rankEntry;
      p.game.deps.ui.setState({ rankEntry: { ...e, deadline: Date.now() + 600_000 } });
    });
    await settle(page);
    await expect(entry).toContainText('新高分！');
    await expect(page.getByTestId('initials-place')).toHaveText('第 1 名');
    await expectInZone(page, 'initials-entry');
    expect(await outsideZone(page, ALLOW), 'initials entry').toEqual([]);
    for (const id of ['initials-up-0', 'initials-ok']) {
      const b = await box(page, id);
      expect(Math.min(b.width, b.height), `${id} touch size`).toBeGreaterThanOrEqual(44);
    }
    // Z (A, one step back), then B; the third letter stays A.
    await click(page, 'initials-down-0');
    await click(page, 'initials-up-1');
    await expect(page.getByTestId('initials-slot-0')).toHaveText('Z');
    await expect(page.getByTestId('initials-slot-1')).toHaveText('B');
    await click(page, 'initials-ok');
    await expect(entry).toHaveCount(0);

    // The ranking keeps the entry; the session card shows the place, in the band.
    const ranking = await plush(page, (p) => p.rankings('rush'));
    expect(ranking).toHaveLength(1);
    expect(ranking[0]).toMatchObject({ initials: 'ZBA' });
    expect(ranking[0].score).toBeGreaterThan(0);
    const card = page.getByTestId('session-card');
    await expect(card).toBeVisible();
    await settle(page);
    await expect(card).toContainText('时间到！');
    await expect(card.locator('[data-row="rank"]')).toContainText('ZBA');
    await expectInZone(page, 'session-card');
    expect(await outsideZone(page, ALLOW), 'session card').toEqual([]);
    // The lobby's rush card shows the new top score.
    await click(page, 'session-lobby');
    await expect(page.getByTestId('lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-card-rush').locator('[data-stat="top"]')).toContainText('ZBA');
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('Tippy Bridge with two-step controls: buttons 1 and 2 steer, Call staff resets the box', async ({ page }) => {
    test.setTimeout(600_000);
    const w = watch(page);
    await boot(page, { display: 'desktop', settings: { system: { attractDemo: false }, machines: { bridge: { controls: 'twoStep' } } } });
    expect(await plush(page, (p) => p.selectMachine('bridge'))).toBe(true);
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);
    // The two big buttons replace the joystick in its well; the deck has Call staff; the HUD the progress.
    await expect(page.getByTestId('two-step')).toBeVisible();
    await expect(page.getByTestId('stick')).toHaveCount(0);
    await expect(page.getByTestId('menu-staff')).toBeVisible();
    await expect(page.getByTestId('session-hud')).toHaveAttribute('data-genre', 'bridge');
    await expect(page.getByTestId('bridge-progress')).toBeVisible();
    await expect(page.getByTestId('machine-plate')).toHaveText('TRY 1');
    // Call staff at a round boundary (READY): the box back on its start pose, with a toast.
    expect((await state(page)).phase).toBe('READY');
    await expect(page.getByTestId('menu-staff')).toBeEnabled();
    await click(page, 'menu-staff');
    await expect(page.getByTestId('toast')).toContainText('Staff put the box back');
    // Hold 1: the claw moves right; let go: it stops. Then hold 2: it moves back.
    const one = await box(page, 'step-1');
    await page.mouse.move(one.x + one.width / 2, one.y + one.height / 2);
    await page.mouse.down();
    await expect.poll(() => input(page)).toEqual({ x: 1, z: 0 });
    await page.mouse.up();
    await expect.poll(() => input(page)).toEqual({ x: 0, z: 0 });
    const two = await box(page, 'step-2');
    await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2);
    await page.mouse.down();
    await expect.poll(() => input(page)).toEqual({ x: 0, z: -1 });
    await page.mouse.up();
    await expect.poll(() => input(page)).toEqual({ x: 0, z: 0 });
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('phone held sideways: a Tippy Bridge win card is never covered by the session HUD', async ({ page }) => {
    test.setTimeout(600_000);
    const w = watch(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await boot(page, { display: 'mobile', quality: 'safe', settings: { system: { attractDemo: false } } });
    expect(await plush(page, (p) => p.selectMachine('bridge'))).toBe(true);
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);
    await expect(page.getByTestId('session-hud')).toHaveAttribute('data-hidden', 'false');
    // The session panel stays off the claw: on a sideways phone the band under the score is where it
    // hangs while aiming and carries at full lift, so the panel sits in the column above the joystick.
    const panel = await box(page, 'session-hud');
    const stick = await box(page, 'stick');
    const score = await box(page, 'score-hud');
    const hub = await clawOnScreen(page);
    console.log(`phone session panel ${JSON.stringify(panel)}, claw hub ${JSON.stringify(hub)}`);
    await expect(page.getByTestId('session-hud')).toHaveAttribute('data-place', 'side');
    expect(hub.x < panel.x || hub.x > panel.x + panel.width || hub.y < panel.y || hub.y > panel.y + panel.height, 'the claw is not under the session panel').toBe(true);
    expect(panel.y + panel.height, 'above the joystick').toBeLessThanOrEqual(stick.y);
    expect(panel.x + panel.width <= score.x || panel.y >= score.y + score.height, 'clear of the score').toBe(true);
    // docs/machines/bridge.md, "Debug impulses": walk the box off the bars, then the grab pays it.
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
    const n = (await results(page)).length;
    await click(page, 'grab');
    expect(await finishRound(page, n)).toMatchObject({ outcome: 'won' });
    await expect(page.getByTestId('result-win')).toBeVisible({ timeout: 60_000 });
    await settle(page);
    // On 390 px of height the card reaches the session panel: the card wins (as for the score).
    const card = await box(page, 'result-win');
    const hud = await box(page, 'session-hud');
    const overlap = card.x < hud.x + hud.width && hud.x < card.x + card.width && card.y < hud.y + hud.height && hud.y < card.y + card.height;
    console.log(`phone bridge win: card ${JSON.stringify(card)}, session HUD ${JSON.stringify(hud)}, overlap ${overlap}`);
    if (overlap) await expect(page.getByTestId('session-hud')).toHaveAttribute('data-hidden', 'true');
    // PLAY AGAIN: the next box, the panel back.
    await click(page, 'result-again');
    expect(await ffUntil(page, ['READY', 'AIMING'], 10)).toMatch(/READY|AIMING/);
    await expect(page.getByTestId('session-hud')).toHaveAttribute('data-hidden', 'false');

    // A Sparkle Rush run to time up: its card (or the initials entry) may cover the title row on a
    // sideways phone, so the score gives way to it, and comes back with the next run.
    expect(await plush(page, (p) => p.selectMachine('rush'))).toBe(true);
    expect(await ffUntil(page, ['READY', 'AIMING'], 5)).toMatch(/READY|AIMING/);
    await expect(page.getByTestId('score-hud')).toHaveAttribute('data-hidden', 'false');
    // The run's clock panel, too, leaves the claw at its home in the middle in view.
    const clock = await box(page, 'session-hud');
    const home = await clawOnScreen(page);
    expect(home.x < clock.x || home.x > clock.x + clock.width || home.y < clock.y || home.y > clock.y + clock.height, 'the claw is not under the clock panel').toBe(true);
    const clockBox = await box(page, 'session-clock');
    expect(clockBox.x + clockBox.width, 'the clock fits its panel').toBeLessThanOrEqual(clock.x + clock.width + 0.5);
    await oneTry(page);
    await plush(page, (p) => p.machineDebug.setSessionSeconds(0.3));
    await ff(page, 3);
    await expect(page.locator('[data-testid="initials-entry"], [data-testid="session-card"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('score-hud')).toHaveAttribute('data-hidden', 'true');
    if (await page.getByTestId('initials-entry').count()) await plush(page, (p) => p.game.submitInitials('ABC'));
    await expect(page.getByTestId('session-card')).toBeVisible({ timeout: 60_000 });
    await click(page, 'session-again');
    await expect(page.getByTestId('session-card')).toHaveCount(0);
    await expect(page.getByTestId('score-hud')).toHaveAttribute('data-hidden', 'false');
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  test('phone held sideways: the lobby’s targets are thumb-sized and on screen', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await boot(page, { display: 'mobile', quality: 'safe', settings: { system: { attractDemo: false } } });
    await expect(page.getByTestId('menu-machines')).toBeVisible({ timeout: 60_000 });
    const deck = await box(page, 'menu-machines');
    expect(Math.min(deck.width, deck.height)).toBeGreaterThanOrEqual(43.5);
    await click(page, 'menu-machines');
    await expect(page.getByTestId('lobby')).toBeVisible();
    await settle(page);
    for (const id of ['lobby-prev', 'lobby-next', 'modal-close', 'lobby-play-classic']) {
      const b = await box(page, id);
      expect(Math.min(b.width, b.height), `${id} touch size`).toBeGreaterThanOrEqual(43.5);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(844.5);
      expect(b.y + b.height).toBeLessThanOrEqual(390.5);
    }
    await click(page, 'modal-close');
    await expect(page.getByTestId('lobby')).toHaveCount(0);
    // Held upright the menu row is full: MACHINES moves to the top bar; nothing leaves the screen or overlaps.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => plush(page, (p) => p.game.hud.orientation), { timeout: 60_000 }).toBe('portrait');
    await frames(page, 2);
    const ids = ['menu-machines', 'menu-settings', 'menu-collection', 'menu-themes', 'menu-help', 'info-button', 'start'];
    const boxes = [];
    for (const id of ids) {
      const b = await box(page, id);
      boxes.push(b);
      expect(Math.min(b.width, b.height), `${id} touch size`).toBeGreaterThanOrEqual(43.5);
      expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(390.5);
      expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(844.5);
    }
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(overlap(boxes[i]!, boxes[j]!), `${ids[i]} / ${ids[j]}`).toBe(false);
  });
});
