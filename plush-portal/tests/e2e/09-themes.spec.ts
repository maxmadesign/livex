import { expect, test } from '@playwright/test';
import { aim, boot, click, closeSettings, collection, ff, ffUntil, fieldToys, finishRound, lowContrast, openSettings, plush, results, settle, start, state, switchTheme, type Theme } from './helpers';

const THEMES: Theme[] = ['sakura', 'storybook', 'ocean', 'cosmic'];

const look = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.pp-root[data-theme]')!;
    const cs = getComputedStyle(root);
    const p = (window as any).__plush;
    return {
      attr: root.getAttribute('data-theme'),
      primary: cs.getPropertyValue('--c-primary').trim(),
      accent: cs.getPropertyValue('--c-accent').trim(),
      panel: cs.getPropertyValue('--c-panel').trim(),
      chip: document.querySelector('[data-testid="theme-chip"]')?.textContent ?? '',
      theme: p.state().theme,
      types: [...new Set(p.state().toys.map((t: any) => t.type))].sort() as string[],
      toys: p.state().toys.length,
      music: p.audio().musicTheme,
      audio: p.audio().state,
      setting: p.settings().themes.current,
    };
  });

test.describe('9. themes', () => {
  test('all four themes swap the cabinet, the characters, the UI colours and the music', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    await expect.poll(() => plush(page, (p) => p.audio().state), { timeout: 60_000 }).toBe('running');
    const seen: Record<string, Awaited<ReturnType<typeof look>>> = {};
    for (const id of ['storybook', 'ocean', 'cosmic', 'sakura'] as Theme[]) {
      await switchTheme(page, id);
      await expect.poll(() => plush(page, (p) => p.audio().musicTheme), { timeout: 60_000 }).toBe(id);
      const l = await look(page);
      seen[id] = l;
      console.log(`${id}: primary ${l.primary}, accent ${l.accent}, ${l.toys} toys of ${l.types.length} characters, music ${l.music}, chip "${l.chip.trim()}"`);
      expect(l.theme).toBe(id);
      expect(l.attr).toBe(id);
      expect(l.setting).toBe(id);
      expect(l.toys).toBe(18);
      expect(l.types.length, `${id} has at least 6 characters on the field`).toBeGreaterThanOrEqual(6);
      for (const type of l.types) expect(type.startsWith(`${id}.`), `${type} belongs to ${id}`).toBe(true);
      expect(l.music).toBe(id);
      expect((await state(page)).phase).toMatch(/READY|AIMING|ATTRACT/);
    }
    // Every theme has its own palette and its own cast.
    expect(new Set(THEMES.map((t) => seen[t]!.primary)).size).toBe(4);
    expect(new Set(THEMES.map((t) => seen[t]!.accent)).size).toBe(4);
    expect(new Set(THEMES.flatMap((t) => seen[t]!.types)).size).toBe(THEMES.reduce((n, t) => n + seen[t]!.types.length, 0));
    expect(new Set(THEMES.map((t) => seen[t]!.chip)).size).toBe(4);
    // The collection dialog lists all 24 characters.
    await click(page, 'menu-collection');
    await expect(page.getByTestId('collection')).toBeVisible();
    const cards = await page.locator('[data-testid^="collection-"]').count();
    console.log(`collection dialog lists ${cards} characters`);
    expect(cards).toBeGreaterThanOrEqual(24);
    await click(page, 'modal-close');
  });

  test('dialogs stay readable in every theme (text contrast on settings, theme picker and collection)', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    for (const id of ['cosmic', 'ocean', 'storybook', 'sakura'] as Theme[]) {
      if ((await state(page)).theme !== id) await switchTheme(page, id);
      const found: { text: string; where: string; ratio: number }[] = [];
      await openSettings(page, 'menu-settings');
      for (const tab of ['gameplay', 'themes', 'layout', 'graphics', 'audio', 'ai', 'camera', 'system']) {
        await click(page, `tab-${tab}`);
        await settle(page);
        found.push(...(await lowContrast(page, 3)).map((f) => ({ ...f, where: `${tab}: ${f.where}` })));
      }
      await closeSettings(page, 'cancel');
      await click(page, 'menu-themes');
      await settle(page);
      found.push(...(await lowContrast(page, 3)).map((f) => ({ ...f, where: `theme picker: ${f.where}` })));
      await click(page, 'modal-close');
      await click(page, 'menu-collection');
      await settle(page);
      found.push(...(await lowContrast(page, 3)).map((f) => ({ ...f, where: `collection: ${f.where}` })));
      await click(page, 'modal-close');
      const unique = [...new Map(found.map((f) => [`${f.where}|${f.text}`, f])).values()].sort((a, b) => a.ratio - b.ratio);
      // WCAG asks at least 3:1 for large / bold text; white-on-white style mistakes are near 1:1.
      console.log(`${id}: ${unique.length} text(s) below 3:1${unique.length ? `: ${unique.slice(0, 12).map((f) => `${f.ratio}:1 "${f.text}" (${f.where})`).join('; ')}` : ''}`);
      expect(unique, `low-contrast text in the ${id} theme`).toEqual([]);
    }
  });

  test('a theme picked in the middle of a round waits for the round to end', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    const toys = await fieldToys(page);
    await aim(page, toys[0]!.x, toys[0]!.z);
    const before = (await results(page)).length;
    await click(page, 'grab');
    expect(await ffUntil(page, ['LIFTING'], 15)).toBe('LIFTING');
    const mid = await state(page);

    await switchTheme(page, 'cosmic', false);
    const queued = await plush(page, (p) => ({ theme: p.state().theme, pending: p.ui().pendingChange, setting: p.settings().themes.current, phase: p.state().phase, round: p.state().roundId, toys: p.state().toys.length }));
    console.log(`picked cosmic during ${mid.phase}: ${JSON.stringify(queued)}`);
    expect(queued.theme).toBe('sakura');
    expect(queued.pending).toBe(true);
    expect(queued.setting).toBe('cosmic');
    expect(queued.round).toBe(mid.roundId);
    expect(queued.toys).toBe(mid.toys.length);
    await expect(page.getByTestId('status')).toBeVisible();
    for (const t of (await state(page)).toys) expect(t.type.startsWith('sakura.')).toBe(true);

    // The round finishes normally with the old theme's toys ...
    const result = await finishRound(page, before);
    expect(result.themeId).toBe('sakura');
    expect(result.roundId).toBe(mid.roundId);
    // ... and only then the cabinet changes (a won prize first has to be acknowledged).
    if (result.outcome === 'won') {
      expect((await collection(page)).counts[result.targetTypeId]).toBe(1);
      await click(page, 'result-again');
    } else await ff(page, 2);
    await expect.poll(() => plush(page, (p) => `${p.state().theme}/${p.ui().themeBusy}/${p.ui().pendingChange}`), { timeout: 240_000 }).toBe('cosmic/false/false');
    const after = await state(page);
    expect(after.toys.length).toBe(18);
    for (const t of after.toys) expect(t.type.startsWith('cosmic.')).toBe(true);
    expect(after.phase).toMatch(/READY|AIMING/);
  });
});
