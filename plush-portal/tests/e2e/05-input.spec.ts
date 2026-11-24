import { expect, test } from '@playwright/test';
import { LOW_GRAPHICS, awards, boot, box, click, closeSettings, ff, frames, input, openSettings, plush, results, setHidden, start, state, waitBoot } from './helpers';

test.describe('5. input', () => {
  test('mouse hold / release, lost capture, window blur, hidden tab and an opening dialog all stop the claw', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);

    // Hold moves, release stops.
    const right = await box(page, 'dir-right');
    const x0 = (await state(page)).claw.x;
    await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
    await page.mouse.down();
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await expect(page.getByTestId('dir-right')).toHaveAttribute('data-pressed', 'true');
    await ff(page, 0.3);
    const x1 = (await state(page)).claw.x;
    expect(x1).toBeGreaterThan(x0 + 0.03);
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await ff(page, 0.6);
    const x2 = (await state(page)).claw.x;
    await ff(page, 0.5);
    expect((await state(page)).claw.x, 'claw is at rest after release').toBeCloseTo(x2, 5);

    // Moving the pointer off the button while holding keeps the capture; releasing anywhere stops.
    await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
    await page.mouse.down();
    await page.mouse.move(20, 20);
    expect((await input(page)).x, 'still held after dragging off the button').toBe(1);
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });

    // Lost pointer capture while the button is still physically down.
    await page.evaluate(() => window.addEventListener('pointerdown', (e) => ((window as unknown as { __pid: number }).__pid = e.pointerId), true));
    const left = await box(page, 'dir-left');
    await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
    await page.mouse.down();
    // (The browser establishes the capture with the next pointer event.)
    await page.mouse.move(left.x + left.width / 2 + 1, left.y + left.height / 2);
    expect(await input(page)).toEqual({ x: -1, z: 0 });
    const had = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dir-left"]')!;
      const id = (window as unknown as { __pid: number }).__pid;
      const has = el.hasPointerCapture(id);
      el.releasePointerCapture(id);
      return has;
    });
    expect(had, 'the button captured the pointer').toBe(true);
    await page.mouse.move(left.x + left.width / 2 + 2, left.y + left.height / 2 + 2);
    await expect.poll(() => input(page)).toEqual({ x: 0, z: 0 });
    await page.mouse.up();

    // Window blur while holding (blur event dispatched by the test).
    const back = await box(page, 'dir-back');
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2);
    await page.mouse.down();
    expect(await input(page)).toEqual({ x: 0, z: -1 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });

    // Tab hidden while a key is held: paused and released; nothing resumes on return.
    await page.mouse.click(640, 120);
    await page.keyboard.down('ArrowRight');
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await setHidden(page, true);
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    expect((await state(page)).paused).toBe(true);
    await setHidden(page, false);
    expect((await state(page)).paused).toBe(false);
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await page.keyboard.up('ArrowRight');

    // Opening a dialog while a key is held: movement stops and stays stopped.
    await page.keyboard.down('KeyD');
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await click(page, 'menu-settings');
    await expect(page.getByTestId('settings')).toBeVisible();
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    expect((await state(page)).paused).toBe(true);
    const frozen = await state(page);
    await frames(page, 3);
    const still = await state(page);
    expect(still.claw.x).toBe(frozen.claw.x);
    expect(still.steps, 'no physics steps while a dialog is open').toBe(frozen.steps);
    // Keys pressed while the dialog is open are ignored.
    await page.keyboard.down('ArrowLeft');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await page.keyboard.up('ArrowLeft');
    await closeSettings(page, 'cancel');
    expect(await input(page), 'the key that was down before the dialog does not resume').toEqual({ x: 0, z: 0 });
    await page.keyboard.up('KeyD');
    expect((await state(page)).paused).toBe(false);
    expect((await state(page)).phase).toMatch(/READY|AIMING/);
  });

  test('typing in a settings field never moves the claw or grabs', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    const before = await state(page);
    await openSettings(page, 'menu-settings', 'ai');
    const field = page.getByTestId('field-ai.personality');
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await page.keyboard.type('wasd WASD ok');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    expect(await field.inputValue()).toContain('wasd WASD ok');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await closeSettings(page, 'cancel');
    const after = await state(page);
    expect(after.phase).toBe(before.phase);
    expect(after.roundId).toBe(before.roundId);
    expect(after.claw.x).toBeCloseTo(before.claw.x, 6);
    expect(after.claw.z).toBeCloseTo(before.claw.z, 6);
    expect(await results(page)).toEqual([]);
  });

  test('keyboard: arrows and WASD steer, diagonals are not faster, Space / Enter drive the round', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    // Space starts from attract mode (focus on the page, not on a button).
    await page.mouse.click(640, 120);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    await ff(page, 1.2);

    const expectKey = async (key: string, want: { x: number; z: number }) => {
      await page.keyboard.down(key);
      expect(await input(page), key).toEqual(want);
      await page.keyboard.up(key);
      expect(await input(page), `${key} released`).toEqual({ x: 0, z: 0 });
    };
    await expectKey('ArrowLeft', { x: -1, z: 0 });
    await expectKey('ArrowRight', { x: 1, z: 0 });
    await expectKey('ArrowUp', { x: 0, z: -1 });
    await expectKey('ArrowDown', { x: 0, z: 1 });
    await expectKey('KeyA', { x: -1, z: 0 });
    await expectKey('KeyD', { x: 1, z: 0 });
    await expectKey('KeyW', { x: 0, z: -1 });
    await expectKey('KeyS', { x: 0, z: 1 });
    // Opposite keys cancel.
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyD');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyD');

    // Straight vs diagonal speed, measured in game time at steady state.
    const speed = async (keys: string[]) => {
      await ff(page, 0.6);
      await plush(page, (p) => p.placeClaw(-0.3, -0.6));
      await ff(page, 0.3);
      for (const k of keys) await page.keyboard.down(k);
      await ff(page, 0.35);
      const a = await state(page);
      await ff(page, 0.3);
      const b = await state(page);
      for (const k of keys) await page.keyboard.up(k);
      const dt = b.time - a.time;
      return { vx: (b.claw.x - a.claw.x) / dt, vz: (b.claw.z - a.claw.z) / dt, v: Math.hypot(b.claw.x - a.claw.x, b.claw.z - a.claw.z) / dt };
    };
    const straight = await speed(['ArrowRight']);
    const diagonal = await speed(['ArrowRight', 'ArrowDown']);
    console.log(`straight ${straight.v.toFixed(3)} m/s, diagonal ${diagonal.v.toFixed(3)} m/s (vx ${diagonal.vx.toFixed(3)}, vz ${diagonal.vz.toFixed(3)})`);
    expect(straight.v).toBeGreaterThan(0.3);
    expect(diagonal.v / straight.v, 'diagonal speed equals straight speed').toBeGreaterThan(0.95);
    expect(diagonal.v / straight.v).toBeLessThan(1.05);
    expect(Math.abs(diagonal.vx - diagonal.vz)).toBeLessThan(0.03);

    // Space grabs; a second Space during the round is ignored; Enter leaves the result.
    await ff(page, 0.6);
    const round = (await state(page)).roundId;
    await page.keyboard.press('Space');
    await ff(page, 0.3);
    expect((await state(page)).phase).toBe('DESCENDING');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    let result: { outcome: string } | undefined;
    for (let i = 0; i < 60 && !result; i++) {
      await ff(page, 0.5);
      result = (await results(page))[0];
    }
    expect(result, 'the round finished').toBeTruthy();
    expect((await results(page)).length).toBe(1);
    expect((await state(page)).roundId).toBe(round);
    if (result!.outcome === 'won') {
      expect((await awards(page)).length).toBe(1);
      await page.mouse.click(640, 120);
      await page.keyboard.press('Enter');
    } else await ff(page, 2);
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    expect((await state(page)).roundId).toBe(round + 1);
  });
});

test.describe('5. input (touch)', () => {
  test('two fingers give a normalised diagonal; touchcancel releases', async ({ browser, baseURL }) => {
    // baseURL comes from playwright.config.ts, which follows PLUSH_E2E_PORT.
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1080, height: 1920 }, baseURL });
    const page = await context.newPage();
    await page.addInitScript((g) => {
      if (sessionStorage.getItem('__e2e_seeded')) return;
      sessionStorage.setItem('__e2e_seeded', '1');
      localStorage.setItem('plush-portal/settings', JSON.stringify({ version: 1, settings: { graphics: g } }));
      localStorage.setItem('plush-portal/tutorial-seen', '1');
    }, LOW_GRAPHICS);
    await page.goto('/?debug=1&seed=7&camera=off&display=portrait32');
    await waitBoot(page);
    // START with a real tap.
    const startBox = await box(page, 'start');
    await page.touchscreen.tap(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    await expect(page.getByTestId('dir-right')).toHaveAttribute('aria-disabled', 'false');
    await ff(page, 1.2);
    await plush(page, (p) => p.placeClaw(-0.3, -0.6));
    await ff(page, 0.3);

    const cdp = await context.newCDPSession(page);
    const r = await box(page, 'dir-right');
    const f = await box(page, 'dir-front');
    const pr = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), id: 1 };
    const pf = { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2), id: 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pr] });
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pr, pf] });
    expect(await input(page)).toEqual({ x: 1, z: 1 });
    await ff(page, 0.35);
    const a = await state(page);
    await ff(page, 0.3);
    const b = await state(page);
    const dt = b.time - a.time;
    const v = Math.hypot(b.claw.x - a.claw.x, b.claw.z - a.claw.z) / dt;
    const moveSpeed = await plush(page, (p) => p.settings().gameplay.moveSpeed);
    console.log(`two-finger diagonal speed ${v.toFixed(3)} m/s (trolley speed setting ${moveSpeed})`);
    expect(v).toBeGreaterThan(moveSpeed * 0.9);
    expect(v).toBeLessThan(moveSpeed * 1.05);
    // One finger lifts (the "right" one): only the other direction remains.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pr] });
    expect(await input(page)).toEqual({ x: 0, z: 1 });
    // The system cancels the remaining touch (palm rejection, gesture takeover, ...).
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await ff(page, 0.6);
    const rest = (await state(page)).claw;
    await ff(page, 0.4);
    expect((await state(page)).claw.x).toBeCloseTo(rest.x, 5);
    await context.close();
  });
});
