import { expect, test, type Page } from '@playwright/test';
import { aim, boot, click, ff, ffUntil, fieldToys, finishRound, frames, grabAndWait, plush, readyForNext, results, setHidden, start, state, switchTheme, type Theme } from './helpers';

const counts = (page: Page) =>
  plush(page, (p) => {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
    return { ...p.memory(), ...p.bodies(), onField: p.state().toys.filter((t: any) => !t.inBin).length, heapMb: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null } as Record<string, number | null>;
  });

const inCabinet = (toys: { id: string; pos: number[] }[]) => {
  for (const t of toys) {
    for (const v of t.pos) expect(Number.isFinite(v), `${t.id} pose is finite`).toBe(true);
    expect(Math.abs(t.pos[0]!), `${t.id} x`).toBeLessThan(0.6);
    expect(t.pos[2]!, `${t.id} z`).toBeGreaterThan(-0.9);
    expect(t.pos[2]!, `${t.id} z`).toBeLessThan(0.12);
    expect(t.pos[1]!, `${t.id} y`).toBeGreaterThan(-0.6);
    expect(t.pos[1]!, `${t.id} y`).toBeLessThan(1.6);
  }
};

test.describe('19. stability', () => {
  test('ten rounds with theme switches: GPU resources and physics objects return to the same level', async ({ page }) => {
    test.setTimeout(1_500_000);
    await boot(page, { display: 'desktop' });
    await start(page);
    const table: string[] = [];
    const checkpoints: Record<string, Record<string, number | null>[]> = {};
    const mark = async (label: string, theme: string) => {
      await readyForNext(page);
      await ff(page, 4); // let the restock finish and everything settle
      await frames(page, 2);
      const c = await counts(page);
      (checkpoints[theme] ??= []).push(c);
      table.push(`${label.padEnd(28)} geometries ${c.geometries} textures ${c.textures} programs ${c.programs} | bodies ${c.bodies} colliders ${c.colliders} joints ${c.joints} toys ${c.toys} (on field ${c.onField}) | heap ${c.heapMb} MB`);
      inCabinet((await state(page)).toys);
    };
    const playRound = async (i: number) => {
      await readyForNext(page);
      const toys = await fieldToys(page);
      const toy = toys[i % toys.length]!;
      // Alternate centred and off-centre grabs so that wins, slips and misses all occur.
      const off = i % 3 === 0 ? 0 : i % 3 === 1 ? 0.05 : 0.11;
      await aim(page, toy.x + off, toy.z);
      const r = await grabAndWait(page);
      return r.outcome as string;
    };
    const plan: { rounds: number; then?: Theme }[] = [{ rounds: 1 }, { rounds: 2, then: 'ocean' }, { rounds: 3, then: 'cosmic' }, { rounds: 2, then: 'storybook' }, { rounds: 1, then: 'sakura' }, { rounds: 1 }];
    let theme: Theme = 'sakura';
    let n = 0;
    const outcomes: string[] = [];
    for (const step of plan) {
      for (let k = 0; k < step.rounds; k++) outcomes.push(await playRound(n++));
      await mark(`after round ${n} (${theme})`, theme);
      if (step.then) {
        await switchTheme(page, step.then);
        theme = step.then;
        await mark(`switched to ${theme}`, theme);
      }
    }
    console.log(`outcomes of ${n} rounds: ${outcomes.join(', ')}\n  ${table.join('\n  ')}`);
    expect(n).toBe(10);
    // Same theme, same toy count → the same number of physics objects and GPU resources as at the start.
    const first = checkpoints.sakura![0]!;
    const last = checkpoints.sakura![checkpoints.sakura!.length - 1]!;
    expect(last.toys).toBe(first.toys);
    expect(last.bodies).toBe(first.bodies);
    expect(last.colliders).toBe(first.colliders);
    expect(last.joints).toBe(first.joints);
    expect(Math.abs((last.geometries as number) - (first.geometries as number)), 'geometries back to the starting level').toBeLessThanOrEqual(6);
    expect(Math.abs((last.textures as number) - (first.textures as number)), 'textures back to the starting level').toBeLessThanOrEqual(6);
    // No theme leaves its resources behind: no checkpoint is far above the first one.
    const all = Object.values(checkpoints).flat();
    const maxGeo = Math.max(...all.map((c) => c.geometries as number));
    const maxTex = Math.max(...all.map((c) => c.textures as number));
    console.log(`geometries ${first.geometries} → ${last.geometries} (max ${maxGeo}); textures ${first.textures} → ${last.textures} (max ${maxTex})`);
    expect(maxGeo).toBeLessThan((first.geometries as number) * 1.6 + 20);
    expect(maxTex).toBeLessThan((first.textures as number) * 1.6 + 20);
  });

  test('hiding the tab in the middle of a round: paused, no catch-up jump, poses stay sane, the round still ends', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    const toys = await fieldToys(page);
    await aim(page, toys[0]!.x, toys[0]!.z);
    const before = (await results(page)).length;
    await click(page, 'grab');
    expect(await ffUntil(page, ['LIFTING'], 15)).toBe('LIFTING');
    const a = await state(page);
    const audioBefore = await plush(page, (p) => p.audio().state);

    await setHidden(page, true);
    const hidden0 = await state(page);
    expect(hidden0.paused).toBe(true);
    await page.waitForTimeout(6000);
    const hidden1 = await state(page);
    expect(hidden1.steps, 'nothing is simulated while hidden').toBe(hidden0.steps);
    expect(hidden1.phase).toBe(hidden0.phase);
    if (audioBefore === 'running') await expect.poll(() => plush(page, (p) => p.audio().state)).toBe('suspended');

    await setHidden(page, false);
    await frames(page, 3);
    const b = await state(page);
    const dt = b.time - hidden0.time;
    console.log(`hidden for 6 s of wall time during ${a.phase}: game time advanced ${dt.toFixed(3)} s (${b.steps - hidden0.steps} steps) in the first 3 frames after returning; audio ${audioBefore} → ${await plush(page, (p) => p.audio().state)}`);
    expect(b.paused).toBe(false);
    expect(dt, 'the 6 hidden seconds are not simulated afterwards').toBeLessThan(0.5);
    expect(b.roundId).toBe(a.roundId);
    inCabinet(b.toys);
    let moved = 0;
    for (let i = 0; i < a.toys.length; i++) {
      const p0 = hidden0.toys[i]!.pos;
      const p1 = b.toys.find((t) => t.id === hidden0.toys[i]!.id)!.pos;
      moved = Math.max(moved, Math.hypot(p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!));
    }
    console.log(`largest toy displacement across the hidden period: ${(moved * 100).toFixed(2)} cm`);
    expect(moved).toBeLessThan(0.25);
    if (audioBefore === 'running') await expect.poll(() => plush(page, (p) => p.audio().state)).toBe('running');

    // Hide / show several times quickly, then the round still finishes with exactly one result.
    for (let i = 0; i < 4; i++) {
      await setHidden(page, true);
      await setHidden(page, false);
    }
    const result = await finishRound(page, before);
    expect(result, 'the round finished').toBeTruthy();
    expect(result.roundId).toBe(a.roundId);
    expect((await results(page)).length).toBe(before + 1);
    inCabinet((await state(page)).toys);
  });
});
