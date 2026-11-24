import { expect, test, type Page } from '@playwright/test';
import { aim, boot, click, closeSettings, ffUntil, fieldToys, finishRound, frames, openSettings, plush, results, start } from './helpers';

const snapshot = (page: Page) =>
  plush(page, (p) => {
    const s = p.state();
    return {
      roundId: s.roundId as number,
      phase: s.phase as string,
      steps: s.steps as number,
      toys: s.toys.map((t: any) => ({ id: t.id, type: t.type, pos: t.pos })) as { id: string; type: string; pos: number[] }[],
      claw: s.claw as { x: number; z: number; rope: number; hub: number[] },
      bodies: p.bodies() as Record<string, number>,
      preset: p.game.deps.settings.getState().view().graphics.preset as string,
      effective: s.effective as { width: number; height: number; megapixels: number },
      shadows: p.game.stage.renderer.shadowMap.enabled as boolean,
    };
  });

test('18. changing the graphics preset in the middle of a round does not disturb the round', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page, { display: 'desktop' });
  await start(page);
  const toys = await fieldToys(page);
  await aim(page, toys[0]!.x, toys[0]!.z);
  const before = (await results(page)).length;
  await click(page, 'grab');
  expect(await ffUntil(page, ['LIFTING'], 15)).toBe('LIFTING');

  // The dialog freezes the round; take the reference snapshot now.
  await openSettings(page, 'menu-settings', 'graphics');
  const a = await snapshot(page);
  expect(a.preset).toBe('custom');
  console.log(`mid-round (${a.phase}, round ${a.roundId}): ${a.toys.length} toys, 3D buffer ${a.effective.width}×${a.effective.height}, shadows ${a.shadows}`);

  // Preview "safe", then "medium" (live preview re-configures the renderer while the round is frozen).
  for (const preset of ['safe', 'medium'] as const) {
    await page.getByTestId('field-graphics.preset').locator(`[data-value="${preset}"]`).click({ force: true });
    await expect.poll(async () => (await snapshot(page)).preset).toBe(preset);
    // Internal resolution changes are applied at the start of the next rendered frame.
    await expect.poll(async () => (await snapshot(page)).effective.megapixels, { timeout: 180_000 }).toBeGreaterThan(a.effective.megapixels);
    await frames(page, 2);
    const b = await snapshot(page);
    console.log(`preview ${preset}: 3D buffer ${b.effective.width}×${b.effective.height} (${b.effective.megapixels.toFixed(2)} MP), shadows ${b.shadows}; round ${b.roundId} ${b.phase}, ${b.toys.length} toys`);
    expect(b.effective.megapixels, 'the renderer really changed').toBeGreaterThan(a.effective.megapixels);
    expect(b.roundId).toBe(a.roundId);
    expect(b.phase).toBe(a.phase);
    expect(b.steps, 'no simulation steps were run').toBe(a.steps);
    expect(b.toys, 'every toy is exactly where it was').toEqual(a.toys);
    expect(b.claw).toEqual(a.claw);
    expect(b.bodies).toEqual(a.bodies);
  }

  // Apply: the round continues from the same state and finishes normally.
  await closeSettings(page, 'apply');
  const c = await snapshot(page);
  expect(c.roundId).toBe(a.roundId);
  expect(c.toys.map((t) => t.id)).toEqual(a.toys.map((t) => t.id));
  expect(c.bodies).toEqual(a.bodies);
  expect(c.steps - a.steps, 'no burst of catch-up steps after the dialog').toBeLessThan(60);
  let moved = 0;
  for (let i = 0; i < a.toys.length; i++) moved = Math.max(moved, Math.hypot(...c.toys[i]!.pos.map((v, k) => v - a.toys[i]!.pos[k]!)));
  console.log(`right after Apply: phase ${c.phase}, ${c.steps - a.steps} steps later, largest toy movement ${(moved * 100).toFixed(2)} cm`);
  expect(moved).toBeLessThan(0.08);
  expect(['LIFTING', 'TRANSPORTING']).toContain(c.phase);
  const result = await finishRound(page, before);
  expect(result, 'the round finished').toBeTruthy();
  expect(result.roundId).toBe(a.roundId);
  expect((await results(page)).length).toBe(before + 1);
  expect(await plush(page, (p) => p.settings().graphics.preset)).toBe('medium');
  const end = await snapshot(page);
  for (const t of end.toys) for (const v of t.pos) expect(Number.isFinite(v)).toBe(true);
});
