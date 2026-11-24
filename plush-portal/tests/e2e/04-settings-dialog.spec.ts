import { expect, test, type Page } from '@playwright/test';
import { boot, box, click, closeSettings, openSettings } from './helpers';

const TABS = ['gameplay', 'themes', 'layout', 'graphics', 'audio', 'ai', 'camera', 'rewards', 'system'];

const tabIds = (page: Page): Promise<string[]> =>
  page.getByTestId('settings-tabs').evaluate((nav) => [...nav.querySelectorAll('[role="tab"]')].map((b) => (b.getAttribute('data-testid') ?? '').replace('tab-', '')));

for (const [name, display, width, height] of [
  ['desktop 1280×720', 'desktop', 1280, 720],
  ['portrait32 1080×1920', 'portrait32', 1080, 1920],
  ['portrait86 1080×1920', 'portrait86', 1080, 1920],
] as const) {
  test(`4. settings dialog on ${name}: two entries, tabs left / content right, scrolling stays inside`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await boot(page, { display });

    // Entry 1: the gear in the control panel.
    await openSettings(page, 'menu-settings');
    const viaMenu = { rect: await box(page, 'settings'), tabs: await tabIds(page) };
    expect(viaMenu.tabs).toEqual(TABS);
    await closeSettings(page, 'close');

    // Entry 2: the "i" in the top-right corner opens the very same dialog.
    await openSettings(page, 'info-button');
    const viaInfo = { rect: await box(page, 'settings'), tabs: await tabIds(page) };
    expect(viaInfo.tabs).toEqual(TABS);
    expect(viaInfo.rect).toEqual(viaMenu.rect);
    expect(await page.getByTestId('settings').count()).toBe(1);

    // Tabs on the left, the selected tab's content on the right, both inside the dialog.
    const dialog = viaInfo.rect;
    const tabs = await box(page, 'settings-tabs');
    for (const tab of TABS) {
      await click(page, `tab-${tab}`);
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
      const panel = await box(page, `panel-${tab}`);
      expect(tabs.x + tabs.width, `${tab}: tab list is left of the content`).toBeLessThanOrEqual(panel.x + 1);
      expect(Math.abs(tabs.y - panel.y), `${tab}: same row`).toBeLessThan(dialog.height * 0.1);
      expect(panel.x + panel.width).toBeLessThanOrEqual(dialog.x + dialog.width + 1);
      expect(panel.y + panel.height).toBeLessThanOrEqual(dialog.y + dialog.height + 1);
      expect(tabs.x).toBeGreaterThanOrEqual(dialog.x - 1);
      expect(await page.locator('[role="tabpanel"]').count(), 'only the selected tab is rendered').toBe(1);
    }
    console.log(`${name}: dialog ${dialog.width.toFixed(0)}×${dialog.height.toFixed(0)} at (${dialog.x.toFixed(0)},${dialog.y.toFixed(0)}), tab list ${tabs.width.toFixed(0)} px wide, content starts at x=${(tabs.x + tabs.width).toFixed(0)}`);

    // Long tabs scroll inside the content area; the dialog, the footer and the page do not move.
    await click(page, 'tab-graphics');
    const before = { dialog: await box(page, 'settings'), apply: await box(page, 'settings-apply'), tabs: await box(page, 'settings-tabs') };
    const scroll = await page.getByTestId('panel-graphics').evaluate((el) => {
      const overflow = getComputedStyle(el).overflowY;
      el.scrollTop = el.scrollHeight;
      return { overflow, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    console.log(`${name}: graphics tab content ${scroll.scrollHeight}px in a ${scroll.clientHeight}px viewport, scrolled to ${scroll.scrollTop}`);
    expect(scroll.overflow).toMatch(/auto|scroll/);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(await box(page, 'settings')).toEqual(before.dialog);
    expect(await box(page, 'settings-apply')).toEqual(before.apply);
    expect(await box(page, 'settings-tabs')).toEqual(before.tabs);
    const pageScroll = await page.evaluate(() => ({ y: window.scrollY, doc: document.scrollingElement!.scrollHeight, inner: window.innerHeight }));
    expect(pageScroll.y).toBe(0);
    expect(pageScroll.doc).toBeLessThanOrEqual(pageScroll.inner);

    // The tab list is its own scroll container.
    const list = await page.getByTestId('settings-tabs').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    console.log(`${name}: tab list ${list.scrollHeight}px in ${list.clientHeight}px (overflow-y ${list.overflow})`);
    expect(list.overflow).toMatch(/auto|scroll/);
    await closeSettings(page, 'cancel');
  });
}

test('4. short window (900×480): the tab list itself scrolls and every tab stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 480 });
  await boot(page, { display: 'desktop' });
  await openSettings(page, 'menu-settings');
  const dialog = await box(page, 'settings');
  expect(dialog.y).toBeGreaterThanOrEqual(0);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(480);
  const list = await page.getByTestId('settings-tabs').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log(`900×480: dialog ${dialog.width.toFixed(0)}×${dialog.height.toFixed(0)}, tab list ${list.scrollHeight}px in ${list.clientHeight}px, scrolled to ${list.scrollTop}`);
  const tabsBox = await box(page, 'settings-tabs');
  for (const tab of TABS) {
    const el = page.getByTestId(`tab-${tab}`);
    await el.scrollIntoViewIfNeeded();
    const b = (await el.boundingBox())!;
    expect(b.y, `${tab} is inside the tab list after scrolling to it`).toBeGreaterThanOrEqual(tabsBox.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(tabsBox.y + tabsBox.height + 1);
    await el.click({ force: true });
    await expect(page.getByTestId(`panel-${tab}`)).toBeVisible();
  }
  if (list.scrollHeight > list.clientHeight) expect(list.scrollTop).toBeGreaterThan(0);
  expect(await box(page, 'settings')).toEqual(dialog);
  // Footer buttons are still on screen.
  const apply = await box(page, 'settings-apply');
  expect(apply.y + apply.height).toBeLessThanOrEqual(480);
  await closeSettings(page, 'cancel');
});
