import { expect, test } from '@playwright/test';
import { LOW_GRAPHICS, awards, boot, box, click, closeSettings, ff, frames, input, moveStick, openSettings, plush, pushStick, results, setHidden, start, state, stickPoint, waitBoot, type Gate } from './helpers';

test.describe('5. input', () => {
  test('joystick: dead zone, 8-way gate, drag past the rim, release, lost capture, window blur, hidden tab and an opening dialog all stop the claw', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    const stick = page.getByTestId('stick');
    await expect(stick).toHaveAttribute('role', 'application');
    await expect(stick).toHaveAttribute('aria-label', /joystick/i);
    await expect(stick).toHaveAttribute('data-gate', 'none');

    // Pressing the centre holds the stick but stays in the dead zone; a small wobble does nothing.
    const c = await stickPoint(page, 'right');
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    await expect(stick).toHaveAttribute('data-held', 'true');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await page.mouse.move(c.cx + c.travel * 0.15, c.cy - c.travel * 0.1);
    expect(await input(page), 'inside the dead zone').toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('data-gate', 'none');

    // Push right: moves while held, the ball leans right; release stops and centres the stick.
    const x0 = (await state(page)).claw.x;
    await page.mouse.move(c.x, c.y, { steps: 2 });
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await expect(stick).toHaveAttribute('data-gate', 'right');
    const rest = await box(page, 'stick-knob');
    await ff(page, 0.3);
    const x1 = (await state(page)).claw.x;
    expect(x1).toBeGreaterThan(x0 + 0.03);
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('data-gate', 'none');
    await expect(stick).toHaveAttribute('data-held', 'false');
    await ff(page, 0.6);
    const x2 = (await state(page)).claw.x;
    await ff(page, 0.5);
    expect((await state(page)).claw.x, 'claw is at rest after release').toBeCloseTo(x2, 5);
    // The ball springs back to the middle of the base (after its short overshoot).
    await expect.poll(async () => {
      const k = await box(page, 'stick-knob');
      return Math.abs(k.x + k.width / 2 - c.cx);
    }, { timeout: 30_000 }).toBeLessThan(2);
    expect(rest.x + rest.width / 2, 'the ball had followed the push to the right').toBeGreaterThan(c.cx + 8);

    // All eight gates, the diagonals on both axes (the controller normalises their speed).
    const gates: [Gate, { x: number; z: number }][] = [
      ['right', { x: 1, z: 0 }],
      ['right_back', { x: 1, z: -1 }],
      ['back', { x: 0, z: -1 }],
      ['left_back', { x: -1, z: -1 }],
      ['left', { x: -1, z: 0 }],
      ['left_front', { x: -1, z: 1 }],
      ['front', { x: 0, z: 1 }],
      ['right_front', { x: 1, z: 1 }],
    ];
    await pushStick(page, 'right');
    for (const [gate, want] of gates) {
      await moveStick(page, gate);
      expect(await input(page), gate).toEqual(want);
      await expect(stick).toHaveAttribute('data-gate', gate);
    }
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });

    // Dragging far past the rim keeps the hold (pointer capture) and the direction; releasing anywhere stops.
    await pushStick(page, 'right');
    await page.mouse.move(c.cx + 400, c.cy, { steps: 3 });
    expect(await input(page), 'still held after dragging off the stick').toEqual({ x: 1, z: 0 });
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });

    // Lost pointer capture while the button is still physically down.
    await page.evaluate(() => window.addEventListener('pointerdown', (e) => ((window as unknown as { __pid: number }).__pid = e.pointerId), true));
    await pushStick(page, 'left');
    // (The browser establishes the capture with the next pointer event.)
    const l = await stickPoint(page, 'left');
    await page.mouse.move(l.x - 1, l.y);
    expect(await input(page)).toEqual({ x: -1, z: 0 });
    const had = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stick"]')!;
      const id = (window as unknown as { __pid: number }).__pid;
      const has = el.hasPointerCapture(id);
      el.releasePointerCapture(id);
      return has;
    });
    expect(had, 'the stick captured the pointer').toBe(true);
    await page.mouse.move(l.x - 2, l.y + 2);
    await expect.poll(() => input(page)).toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('data-held', 'false');
    await page.mouse.up();

    // Window blur while holding (blur event dispatched by the test).
    await pushStick(page, 'back');
    expect(await input(page)).toEqual({ x: 0, z: -1 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('data-held', 'false');
    await page.mouse.up();
    expect(await input(page)).toEqual({ x: 0, z: 0 });

    // Tab hidden while the stick is pushed: paused and released; nothing resumes on return.
    await pushStick(page, 'right_front');
    expect(await input(page)).toEqual({ x: 1, z: 1 });
    await setHidden(page, true);
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    expect((await state(page)).paused).toBe(true);
    await setHidden(page, false);
    expect((await state(page)).paused).toBe(false);
    await moveStick(page, 'right');
    expect(await input(page), 'the hidden page dropped the hold: moving on does not resume').toEqual({ x: 0, z: 0 });
    await page.mouse.up();

    // A dialog opening while the stick is pushed: movement stops and stays stopped.
    await pushStick(page, 'left');
    expect(await input(page)).toEqual({ x: -1, z: 0 });
    await plush(page, (p) => p.game.setModalOpen(true));
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('aria-disabled', 'true');
    await expect(stick).toHaveAttribute('data-held', 'false');
    await expect(stick).toHaveAttribute('data-gate', 'none');
    await moveStick(page, 'back');
    expect(await input(page), 'no steering while a dialog is open').toEqual({ x: 0, z: 0 });
    await plush(page, (p) => p.game.setModalOpen(false));
    await moveStick(page, 'left');
    expect(await input(page), 'the push from before the dialog does not resume').toEqual({ x: 0, z: 0 });
    await page.mouse.up();
    expect((await state(page)).phase).toMatch(/READY|AIMING/);

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

    // GRAB (Space) while the stick is pushed: the claw drops and the stick lets go at once.
    await page.mouse.click(640, 120);
    await pushStick(page, 'left');
    expect(await input(page)).toEqual({ x: -1, z: 0 });
    await page.keyboard.press('Space');
    await expect(stick).toHaveAttribute('aria-disabled', 'true');
    await expect(stick).toHaveAttribute('data-held', 'false');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await moveStick(page, 'right');
    expect(await input(page), 'a disabled stick does not steer').toEqual({ x: 0, z: 0 });
    await page.mouse.up();
    expect((await state(page)).phase).not.toMatch(/READY|AIMING/);
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

    // The joystick leans with the keys while nobody holds it, and wins while it is pushed.
    const stick = page.getByTestId('stick');
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    expect(await input(page)).toEqual({ x: -1, z: -1 });
    await expect(stick).toHaveAttribute('data-gate', 'left_back');
    await expect(stick).toHaveAttribute('data-source', 'keys');
    await pushStick(page, 'right');
    expect(await input(page), 'the pushed stick wins over the keys').toEqual({ x: 1, z: 0 });
    await page.mouse.up();
    expect(await input(page), 'back to the keys that are still down').toEqual({ x: -1, z: -1 });
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await expect(stick).toHaveAttribute('data-gate', 'none');

    // Keyboard users can focus the stick (visible focus ring); arrows steer while it has focus and
    // Space still grabs from there (checked below with the page focused).
    await page.getByTestId('info-button').focus();
    for (let i = 0; i < 8 && !(await stick.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(stick).toBeFocused();
    expect(await stick.evaluate((el) => getComputedStyle(el).outlineStyle), 'visible focus ring').not.toBe('none');
    await page.keyboard.down('ArrowRight');
    expect(await input(page)).toEqual({ x: 1, z: 0 });
    await page.keyboard.up('ArrowRight');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await stick.blur();

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
  test('one finger: the dead zone, a diagonal at straight-line speed, a second finger ignored, touchcancel releases', async ({ browser, baseURL }) => {
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
    await expect(page.getByTestId('stick')).toHaveAttribute('aria-disabled', 'false');
    await ff(page, 1.2);
    await plush(page, (p) => p.placeClaw(-0.3, -0.6));
    await ff(page, 0.3);

    const cdp = await context.newCDPSession(page);
    const c = await stickPoint(page, 'right_front');
    const round = (p: { x: number; y: number }, id: number) => ({ x: Math.round(p.x), y: Math.round(p.y), id });
    const centre = round({ x: c.cx, y: c.cy }, 1);
    const diagonal = round(c, 1);
    // Finger down on the middle: held, but inside the dead zone.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [centre] });
    await expect(page.getByTestId('stick')).toHaveAttribute('data-held', 'true');
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    // Slide toward the player and to the right: the diagonal gate. (Touch moves are delivered with the
    // next frame, which software GL makes slow: poll.)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [diagonal] });
    await expect.poll(() => input(page)).toEqual({ x: 1, z: 1 });
    await expect(page.getByTestId('stick')).toHaveAttribute('data-gate', 'right_front');
    await ff(page, 0.35);
    const a = await state(page);
    await ff(page, 0.3);
    const b = await state(page);
    const dt = b.time - a.time;
    const v = Math.hypot(b.claw.x - a.claw.x, b.claw.z - a.claw.z) / dt;
    const moveSpeed = await plush(page, (p) => p.settings().gameplay.moveSpeed);
    console.log(`one-finger diagonal speed ${v.toFixed(3)} m/s (trolley speed setting ${moveSpeed})`);
    expect(v).toBeGreaterThan(moveSpeed * 0.9);
    expect(v).toBeLessThan(moveSpeed * 1.05);
    // A second finger landing on the stick is ignored, and lifting it changes nothing.
    const other = round(await stickPoint(page, 'left'), 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [diagonal, other] });
    expect(await input(page)).toEqual({ x: 1, z: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [other] });
    expect(await input(page)).toEqual({ x: 1, z: 1 });
    // The first finger slides on to straight toward the player.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [round(await stickPoint(page, 'front'), 1)] });
    await expect.poll(() => input(page)).toEqual({ x: 0, z: 1 });
    // The system cancels the touch (palm rejection, gesture takeover, ...).
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await input(page)).toEqual({ x: 0, z: 0 });
    await expect(page.getByTestId('stick')).toHaveAttribute('data-held', 'false');
    await ff(page, 0.6);
    const rest = (await state(page)).claw;
    await ff(page, 0.4);
    expect((await state(page)).claw.x).toBeCloseTo(rest.x, 5);
    await context.close();
  });
});
