import { expect, test, type Page } from '@playwright/test';
import { boot, click, closeSettings, collection, ff, openSettings, plush, start, state, watch, winARound } from './helpers';

const guide = (page: Page) =>
  plush(page, (p) => {
    const g = p.guide();
    return { connection: g.status.connection as string, detail: g.status.detail as string, model: g.status.textModel as string | null, voice: g.status.voice as string, line: g.line ? { text: g.line.text as string, source: g.line.source as string, event: g.line.eventType as string, voice: g.line.voice as string } : null };
  });

/** Collects every guide line that is shown (subscribing to the same store the HUD renders from). */
const recordLines = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__lines = [];
    w.__connections = new Set<string>();
    const sample = () => {
      const g = w.__plush.guide();
      w.__connections.add(g.status.connection);
      if (g.line && !w.__lines.some((l: any) => l.id === g.line.id)) w.__lines.push({ id: g.line.id, text: g.line.text, source: g.line.source, event: g.line.eventType });
    };
    sample();
    w.__lineTimer = setInterval(sample, 50);
  });
const lines = (page: Page): Promise<{ id: string; text: string; source: string; event: string }[]> => page.evaluate(() => (window as any).__lines);
const connections = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as any).__connections]);

async function playAndCheckLocal(page: Page, label: string): Promise<void> {
  await recordLines(page);
  await start(page);
  // The greeting for the first play appears as a subtitle from the built-in lines.
  await expect.poll(async () => (await lines(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('guide-line')).toBeVisible();
  await expect(page.getByTestId('guide-line')).toHaveAttribute('data-source', 'local');
  await expect(page.getByTestId('guide-line')).toContainText('Local lines');
  await expect(page.getByTestId('guide-line')).not.toContainText('GPT');
  // The game is fully playable and Momo reacts to the result.
  const { result } = await winARound(page, 8);
  expect(result.outcome).toBe('won');
  expect((await collection(page)).wins).toBe(1);
  await expect.poll(async () => (await lines(page)).some((l) => /win|prize|new_character|result/i.test(l.event)), { timeout: 60_000 }).toBe(true);
  // Momo's tip button works too.
  await click(page, 'result-again');
  await click(page, 'momo');
  await ff(page, 0.5);
  const all = await lines(page);
  console.log(`${label}: ${all.length} subtitle lines, sources ${[...new Set(all.map((l) => l.source))].join('/')}, events ${[...new Set(all.map((l) => l.event))].join(', ')}; e.g. "${all[0]!.text}"`);
  for (const l of all) {
    expect(l.source, `"${l.text}"`).toBe('local');
    expect(l.text.trim().length).toBeGreaterThan(0);
  }
  const seen = await connections(page);
  console.log(`${label}: connection states seen: ${seen.join(', ')}`);
  expect(seen).not.toContain('gpt');
}

test.describe('12. AI guide without GPT', () => {
  test('server without an OpenAI key: local subtitles, honest status, playable', async ({ page }) => {
    const w = watch(page);
    const ai: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && ai.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await boot(page, { display: 'desktop' });
    const status = await page.evaluate(() => fetch('/api/ai/status').then((r) => r.json()));
    expect(status.configured).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/sk-|key"\s*:/i);
    await expect.poll(async () => (await guide(page)).connection).toBe('local');
    await playAndCheckLocal(page, 'no key');
    console.log(`no key: API calls made by the page: ${[...new Set(ai)].join(', ')}`);
    expect(ai.filter((a) => a.includes('/api/ai/line') || a.includes('/api/ai/speech')), 'no GPT calls are attempted without a key').toEqual([]);

    // Settings → AI says so, and the connection test reports the missing key instead of pretending.
    await openSettings(page, 'menu-settings', 'ai');
    await expect(page.getByTestId('ai-status')).toHaveAttribute('data-connection', 'local');
    const text = await page.getByTestId('ai-status').innerText();
    expect(text).toContain('Local lines');
    expect(text).not.toContain('GPT connected');
    await click(page, 'btn-ai-test');
    await expect(page.getByTestId('ai-test-result')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('ai-test-result')).toHaveAttribute('data-ok', 'false');
    console.log(`no key: connection test says "${(await page.getByTestId('ai-test-result').innerText()).trim()}"`);
    await closeSettings(page, 'cancel');
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    // No key material anywhere in the browser.
    const leak = await page.evaluate(() => JSON.stringify({ ...localStorage }) + document.documentElement.outerHTML.slice(0, 200_000));
    expect(leak).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
  });

  test('API unreachable (every /api request aborted): still playable with local subtitles', async ({ page }) => {
    const w = watch(page);
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await boot(page, { display: 'desktop' });
    expect((await state(page)).phase).toBe('ATTRACT');
    await expect.poll(async () => (await guide(page)).connection, { timeout: 30_000 }).toMatch(/local|error/);
    await playAndCheckLocal(page, 'API aborted');
    await openSettings(page, 'menu-settings', 'ai');
    const connection = await page.getByTestId('ai-status').getAttribute('data-connection');
    expect(connection).toMatch(/local|error/);
    expect(await page.getByTestId('ai-status').innerText()).not.toContain('GPT connected');
    await click(page, 'btn-ai-test');
    await expect(page.getByTestId('ai-test-result')).toHaveAttribute('data-ok', 'false', { timeout: 60_000 });
    await closeSettings(page, 'cancel');
    expect(w.pageErrors).toEqual([]);
  });

  test('slow server that claims a key: the round never waits, a local line is shown, no late GPT line appears', async ({ page }) => {
    const w = watch(page);
    let lineRequests = 0;
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({
        json: { configured: true, provider: 'openai', textModel: 'e2e-fake-model', speechModel: 'e2e-fake-tts', speechApi: 'speech', voice: 'none', allowClientPrompt: false, adminProtected: false, speechConfigError: '', warnings: [], limits: { ratePerMin: 600, maxSpeechChars: 300, maxRecentLines: 6, textTimeoutMs: 8000, speechTimeoutMs: 8000 }, version: 'e2e' },
      }),
    );
    await page.route('**/api/ai/line', async (route) => {
      lineRequests++;
      await new Promise((r) => setTimeout(r, 9000));
      await route.fulfill({ json: { text: 'LATE FAKE GPT LINE', emotion: 'happy', shouldSpeak: false, model: 'e2e-fake-model', latencyMs: 9000 } }).catch(() => undefined);
    });
    await page.route('**/api/ai/speech', (route) => route.abort());
    await boot(page, { display: 'desktop' });
    // Software rendering can block the page for longer than the guide's 4 s status timeout while it
    // boots; the game then asks again a minute later. Ask again right away instead of waiting.
    if ((await guide(page)).detail.includes('not reachable')) await plush(page, (p) => p.game.deps.guide.probe(true));
    await expect.poll(async () => (await guide(page)).connection, { timeout: 30_000 }).toBe('checking');
    await recordLines(page);
    const t0 = Date.now();
    await start(page);
    const { result, tries } = await winARound(page, 8);
    console.log(`slow server: won after ${tries} tries in ${((Date.now() - t0) / 1000).toFixed(1)} s wall time while ${lineRequests} line request(s) were hanging`);
    expect(result.outcome).toBe('won');
    // The fallback line arrives after the client-side timeout (2.5 s by default), not after the server's 9 s.
    await expect.poll(async () => (await lines(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(10_000);
    const all = await lines(page);
    const seen = await connections(page);
    console.log(`slow server: ${lineRequests} line requests, subtitles: ${all.map((l) => `[${l.source}] ${l.text}`).join(' | ')}; connection states ${seen.join(', ')}`);
    expect(lineRequests, 'the client did try the (fake) proxy').toBeGreaterThan(0);
    for (const l of all) {
      expect(l.source).toBe('local');
      expect(l.text).not.toContain('LATE FAKE GPT LINE');
    }
    expect(seen, 'never reports a working GPT connection').not.toContain('gpt');
    expect((await guide(page)).connection).toMatch(/error|checking|local/);
    for (const text of await page.getByTestId('guide-line').allInnerTexts()) expect(text).not.toContain('GPT');
    expect(w.pageErrors).toEqual([]);
  });

  test('guide switched off: no subtitles at all', async ({ page }) => {
    await boot(page, { display: 'desktop', settings: { ai: { enabled: false } } });
    await recordLines(page);
    await start(page);
    await winARound(page, 8);
    await page.waitForTimeout(1500);
    expect(await lines(page)).toEqual([]);
    expect((await guide(page)).connection).toBe('off');
    await expect(page.getByTestId('guide-line')).toHaveCount(0);
  });
});
