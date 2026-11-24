import { expect, test } from '@playwright/test';
import { BRAND_KITS, parseBrandId } from '../../src/brand/kits';
import { THEMES, aim, boot, box, buttonContrast, click, closeSettings, collection, expectInZone, ff, ffUntil, fieldToys, finishRound, lowContrast, openSettings, outsideZone, plush, results, settle, start, state, switchTheme, winARound, type Theme } from './helpers';

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
  test('all five themes swap the cabinet, the characters, the UI colours and the music', async ({ page }) => {
    test.setTimeout(1_500_000);
    await boot(page, { display: 'desktop' });
    await start(page);
    await expect.poll(() => plush(page, (p) => p.audio().state), { timeout: 60_000 }).toBe('running');
    const seen: Record<string, Awaited<ReturnType<typeof look>>> = {};
    for (const id of ['storybook', 'ocean', 'cosmic', 'gpu', 'sakura'] as Theme[]) {
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
    expect(new Set(THEMES.map((t) => seen[t]!.primary)).size).toBe(5);
    expect(new Set(THEMES.map((t) => seen[t]!.accent)).size).toBe(5);
    expect(new Set(THEMES.flatMap((t) => seen[t]!.types)).size).toBe(THEMES.reduce((n, t) => n + seen[t]!.types.length, 0));
    expect(new Set(THEMES.map((t) => seen[t]!.chip)).size).toBe(5);
    // The collection dialog lists all 31 characters.
    await click(page, 'menu-collection');
    await expect(page.getByTestId('collection')).toBeVisible();
    const cards = await page.locator('[data-testid^="collection-"]').count();
    console.log(`collection dialog lists ${cards} characters`);
    expect(cards).toBeGreaterThanOrEqual(31);
    await click(page, 'modal-close');
  });

  test('dialogs stay readable in every theme (text contrast on settings, theme picker and collection)', async ({ page }) => {
    test.setTimeout(1_500_000);
    await boot(page, { display: 'desktop' });
    for (const id of ['gpu', 'cosmic', 'ocean', 'storybook', 'sakura'] as Theme[]) {
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

  test('GPU theme (brand kit): green buttons with black lettering, readable HUD and dialogs, kit logo and font', async ({ page }) => {
    test.setTimeout(900_000);
    // The brand kit of this build (VITE_BRAND, src/brand): names and logo files come from it.
    const kit = BRAND_KITS[parseBrandId(process.env.VITE_BRAND)];
    await boot(page, { display: 'desktop', theme: 'gpu' });
    expect((await state(page)).theme).toBe('gpu');
    const seen = new Map<string, number>();
    const scan = async (where: string, expectIds: string[]) => {
      await settle(page);
      const found = await buttonContrast(page);
      console.log(`gpu ${where}: ${found.map((b) => `${b.id} "${b.text}" ${b.ratio}:1 (${b.color} on ${b.faces.join(' / ')})`).join('; ')}`);
      for (const id of expectIds) expect(found.some((b) => b.id === id || b.id.startsWith(id)), `${id} scanned in ${where}`).toBe(true);
      for (const b of found) {
        seen.set(b.id, b.ratio);
        // Brand green faces carry black lettering at 7:1 or more (white on green was 2.4:1).
        expect(b.ratio, `${b.id} "${b.text}" in ${where}`).toBeGreaterThanOrEqual(7);
      }
      // Secondary buttons: white lettering on black inside a white outline.
      for (const b of await buttonContrast(page, '.pp-btn.soft')) expect(b.ratio, `${b.id} "${b.text}" (secondary) in ${where}`).toBeGreaterThanOrEqual(4.5);
      // Every other HUD text on a solid backing (status, chips, toasts, guide bubble, score, badges).
      const hud = [...(await lowContrast(page, 4.5, '.pp-hud')), ...(await lowContrast(page, 4.5, '.pp-score'))];
      expect(hud, `low-contrast HUD text in ${where}`).toEqual([]);
    };

    // Loading screen in the kit style (hidden after boot, still in the page).
    await expect(page.getByTestId('boot')).toHaveAttribute('data-brand', kit.id);
    expect(await page.getByTestId('boot-logo').locator('img').count()).toBe(1);
    // Brand font stack in place (the official family only once its files load; the open fallback ships).
    const fontStack = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-brand'));
    console.log(`--font-brand: ${fontStack}`);
    expect(fontStack).toContain('Inter Variable');

    // Attract: event logo above the call to action, drawn as supplied, and the welcome headline.
    await expect(page.getByTestId('attract-brand')).toBeVisible();
    await expect(page.getByTestId('attract-brand')).toContainText(kit.eventName);
    const logo = await page.getByTestId('attract-logo').locator('img').evaluate(async (img: HTMLImageElement) => {
      await img.decode().catch(() => undefined);
      const cs = getComputedStyle(img);
      const r = img.getBoundingClientRect();
      return { src: img.getAttribute('src'), natural: img.naturalWidth / Math.max(1, img.naturalHeight), box: r.width / Math.max(1, r.height), fit: cs.objectFit, filter: cs.filter, animation: cs.animationName, transform: cs.transform };
    });
    console.log(`attract logo: ${JSON.stringify(logo)}`);
    expect(logo.src).toMatch(/assets\/brand\/|assets\/themes\/gpu\//);
    expect(logo.fit).toBe('contain');
    expect(logo.filter).toBe('none');
    expect(logo.animation).toBe('none');
    expect(logo.transform).toBe('none');
    // The box has the slot's aspect; object-fit keeps the artwork's own proportions inside it.
    expect(Math.abs(logo.box - kit.logo.aspect) / kit.logo.aspect).toBeLessThan(0.03);
    const brandBox = await box(page, 'attract-brand');
    const ctaBox = await box(page, 'attract-cta');
    expect(brandBox.y + brandBox.height, 'the logo block sits above the call to action').toBeLessThanOrEqual(ctaBox.y + 1);
    await scan('attract', ['attract-cta', 'start']);

    // Dialogs at 4.5:1 (the all-theme scan above uses 3:1), with the brand status in Themes & Toys.
    await openSettings(page, 'menu-settings');
    const dialogs: { text: string; where: string; ratio: number }[] = [];
    for (const tab of ['gameplay', 'themes', 'layout', 'graphics', 'audio', 'ai', 'camera', 'system']) {
      await click(page, `tab-${tab}`);
      await settle(page);
      dialogs.push(...(await lowContrast(page, 4.5)).map((f) => ({ ...f, where: `${tab}: ${f.where}` })));
      if (tab === 'themes') {
        await expect(page.getByTestId('brand-status')).toBeVisible();
        await expect.poll(() => page.getByTestId('brand-status-font').getAttribute('data-state'), { timeout: 30_000 }).not.toBe('checking');
        const status = Object.fromEntries(
          await Promise.all(['event', 'host', 'font'].map(async (id) => [id, await page.getByTestId(`brand-status-${id}`).getAttribute('data-state')] as const)),
        );
        console.log(`brand status: ${JSON.stringify(status)}`);
        expect(['found', 'placeholder', 'original']).toContain(status.event);
        expect(kit.hostLogo ? ['found', 'missing'] : ['none']).toContain(status.host);
        expect(kit.font.files.length ? ['loaded', 'fallback'] : ['none']).toContain(status.font);
      }
    }
    await closeSettings(page, 'cancel');
    for (const modal of ['menu-themes', 'menu-collection', 'menu-help']) {
      await click(page, modal);
      await settle(page);
      dialogs.push(...(await lowContrast(page, 4.5)).map((f) => ({ ...f, where: `${modal}: ${f.where}` })));
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }
    expect(dialogs, 'dialog text below 4.5:1 in the GPU theme').toEqual([]);

    await start(page);
    await scan('aiming', ['grab']);
    // PLAY AGAIN (and the win card's button) only appear after a win.
    await winARound(page, 10);
    await expect.poll(async () => (await state(page)).phase, { timeout: 60_000 }).toBe('RESULT');
    await expect(page.getByTestId('result-win')).toBeVisible();
    await scan('result', ['again', 'result-again']);
    console.log(`gpu filled buttons: ${JSON.stringify(Object.fromEntries(seen))}`);
  });

  test('GPU theme on the 86" kiosk: the call to action stays in the reach band under the event logo', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1080, height: 1920 });
    await boot(page, { display: 'portrait86', theme: 'gpu' });
    await settle(page);
    const cta = await expectInZone(page, 'attract-cta');
    await expect(page.getByTestId('attract-logo')).toBeVisible();
    const brandBox = await box(page, 'attract-brand');
    const ctaBox = await box(page, 'attract-cta');
    console.log(`portrait86 gpu: call to action y ${cta.top.toFixed(3)}–${cta.bottom.toFixed(3)}, logo block y ${(brandBox.y / 1920).toFixed(3)}–${((brandBox.y + brandBox.height) / 1920).toFixed(3)}`);
    expect(brandBox.y + brandBox.height).toBeLessThanOrEqual(ctaBox.y + 1);
    expect(brandBox.y).toBeGreaterThanOrEqual(0);
    // The logo block is not interactive: nothing reachable leaves the band.
    expect(await outsideZone(page, ['info-button'])).toEqual([]);
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
