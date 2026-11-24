import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the acceptance specs.
 *
 * Headless Chromium renders the game with software WebGL, where one frame can
 * take seconds. The specs therefore (a) start the game with very cheap graphics
 * settings seeded through the game's own persisted settings and (b) advance
 * game time with the debug API instead of waiting on the wall clock.
 */

export type Display = 'desktop' | 'portrait32' | 'portrait86';
export type Theme = 'sakura' | 'storybook' | 'ocean' | 'cosmic';

/** Cheapest valid graphics settings (all are ordinary user settings). */
export const LOW_GRAPHICS = {
  preset: 'custom',
  autoOptimize: false,
  renderScale: 0.35,
  maxPixels: 0.4,
  targetFps: '30',
  lod: 'low',
  textures: '512',
  shadows: 'off',
  ao: 'off',
  glass: 'low',
  reflections: 'static',
  fur: 'flat',
  deform: 'basic',
  aa: 'off',
  bloom: 0,
  particles: 0,
};

export interface BootOptions {
  display?: Display | null;
  theme?: Theme;
  lang?: 'en' | 'zh' | 'ja';
  /** 'off' adds ?camera=off (the game never asks for the camera). */
  camera?: 'off' | 'on';
  /** 'low' seeds LOW_GRAPHICS; otherwise a ?quality= preset is used. */
  quality?: 'low' | 'safe' | 'medium' | 'high' | 'ultra';
  seed?: number;
  /** Extra settings merged into the seeded settings (deep partial). */
  settings?: Record<string, unknown>;
  /** Do not seed anything (first-run behaviour). */
  pristine?: boolean;
}

export interface Watch {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
}

/** Records console errors, uncaught exceptions, failed requests and HTTP errors. */
export function watch(page: Page): Watch {
  const w: Watch = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('requestfailed', (r) => w.failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) w.badResponses.push(`${r.status()} ${r.url()}`);
  });
  return w;
}

export function url(o: BootOptions = {}): string {
  const q = new URLSearchParams();
  q.set('debug', '1');
  q.set('seed', String(o.seed ?? 7));
  if (o.display !== null) q.set('display', o.display ?? 'desktop');
  if (o.theme) q.set('theme', o.theme);
  if (o.lang) q.set('lang', o.lang);
  if ((o.camera ?? 'off') === 'off') q.set('camera', 'off');
  if (o.quality && o.quality !== 'low') q.set('quality', o.quality);
  return `/?${q.toString()}`;
}

/**
 * Opens the game and waits until it has booted. Settings are seeded once per
 * tab (a reload keeps whatever the game persisted, so persistence can be tested).
 */
export async function boot(page: Page, o: BootOptions = {}): Promise<void> {
  if (!o.pristine) {
    const settings: Record<string, unknown> = { ...(o.settings ?? {}) };
    if ((o.quality ?? 'low') === 'low') settings.graphics = { ...LOW_GRAPHICS, ...((o.settings?.graphics as object) ?? {}) };
    await page.addInitScript((seed) => {
      try {
        if (sessionStorage.getItem('__e2e_seeded')) return;
        sessionStorage.setItem('__e2e_seeded', '1');
        localStorage.setItem('plush-portal/settings', JSON.stringify({ version: 1, settings: seed }));
      } catch {
        /* storage unavailable */
      }
    }, settings);
  }
  await page.goto(url(o), { waitUntil: 'load' });
  await waitBoot(page);
}

export async function waitBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __bootDone?: boolean }).__bootDone === true, null, { timeout: 240_000 });
  const ok = await page.evaluate(() => !!(window as unknown as { __plush?: unknown }).__plush);
  if (!ok) {
    const text = await page.evaluate(() => document.querySelector('[data-testid="boot"]')?.textContent ?? '(no boot screen)');
    throw new Error(`the game did not boot: ${text} @ ${page.url()}`);
  }
  // Collect every round result / award from the start (results are cleared from the UI quickly after a miss).
  await page.evaluate(() => {
    const w = window as unknown as { __plush: { core(): { machine: { events: { on(e: string, f: (p: unknown) => void): void } } } }; __results: unknown[]; __awards: unknown[]; __phases: string[] };
    w.__results = [];
    w.__awards = [];
    w.__phases = [];
    const events = w.__plush.core().machine.events;
    events.on('result', (r) => w.__results.push(JSON.parse(JSON.stringify(r))));
    events.on('award', (a) => w.__awards.push(JSON.parse(JSON.stringify(a))));
    events.on('phase', (p) => w.__phases.push((p as { phase: string }).phase));
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const plush = <T>(page: Page, fn: (p: any, arg: any) => T | Promise<T>, arg?: unknown): Promise<T> =>
  page.evaluate(([f, a]) => (0, eval)(`(${f})`)((window as any).__plush, a), [fn.toString(), arg] as const) as Promise<T>;

export interface GameState {
  phase: string;
  roundId: number;
  demo: boolean;
  paused: boolean;
  claw: { x: number; z: number; rope: number; hub: number[] };
  toys: { id: string; type: string; inBin: boolean; pos: number[] }[];
  steps: number;
  time: number;
  eye: number[];
  theme: string;
  profile: string;
  hud: { vw: number; vh: number; safeTop: number; safeBottom: number; panel: { x: number; y: number; w: number; h: number }; floorY: number; unit: number };
  effective: { width: number; height: number; megapixels: number; autoScale: number };
}

export const state = (page: Page): Promise<GameState> => plush(page, (p) => p.state());

/** Advances the simulation without rendering. */
export const ff = (page: Page, seconds: number): Promise<void> => plush(page, (p, s) => p.fastForward(s), seconds);

export const results = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__results);
export const awards = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).__awards);
export const collection = (page: Page): Promise<{ counts: Record<string, number>; attempts: number; wins: number; prizeIds: string[] }> => plush(page, (p) => p.collection());

export async function click(page: Page, testId: string): Promise<void> {
  // Animated buttons never become "stable" for Playwright; the click itself is still a real pointer click.
  await page.getByTestId(testId).first().click({ force: true });
}

/** Leaves attract mode through the real START button (and closes the first-run tutorial like a player would). */
export async function start(page: Page): Promise<void> {
  await click(page, 'start');
  await expect.poll(async () => (await state(page)).phase, { timeout: 60_000 }).toMatch(/READY|AIMING/);
  if ((await plush(page, (p) => p.ui().modal)) === 'tutorial') {
    await click(page, 'tutorial-ok');
    await expect.poll(() => plush(page, (p) => p.ui().modal)).toBeNull();
  }
  await expect(page.getByTestId('dir-right')).toHaveAttribute('aria-disabled', 'false');
  // Let the claw travel to its home position.
  await ff(page, 1.2);
}

export interface ToyInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  upright: number;
}

/** Toys on the play field with their centre of mass, best aim candidates first. */
export const fieldToys = (page: Page): Promise<ToyInfo[]> =>
  plush(page, (p) => {
    const core = p.core();
    const out: ToyInfo[] = [];
    for (const t of core.phys.toys.values()) {
      if (t.inBin) continue;
      const c = t.body.worldCom();
      const r = t.pose.rot;
      out.push({ id: t.id, type: t.asset.id, x: c.x, y: c.y, z: c.z, upright: 1 - 2 * (r[0] * r[0] + r[2] * r[2]) });
    }
    const C = p.claw;
    return out
      .filter((t) => t.x > C.minX + 0.02 && t.x < C.maxX - 0.02 && t.z > C.minZ + 0.02 && t.z < C.maxZ - 0.02 && !(t.x < -0.06 && t.z > -0.44))
      .sort((a, b) => b.upright - a.upright || Math.hypot(a.x - 0.08, a.z + 0.4) - Math.hypot(b.x - 0.08, b.z + 0.4));
  });

/** Puts the claw above (x, z); only possible between rounds. */
export async function aim(page: Page, x: number, z: number): Promise<void> {
  await plush(page, (p, a) => p.placeClaw(a.x, a.z), { x, z });
  await ff(page, 0.25);
}

/**
 * Plays one round through the real GRAB button and returns the round result
 * reported by the game. Game time is advanced in small steps until the result
 * event fires.
 */
export async function grabAndWait(page: Page, maxSeconds = 30): Promise<any> {
  const before = (await results(page)).length;
  await click(page, 'grab');
  for (let t = 0; t < maxSeconds; t += 0.5) {
    await ff(page, 0.5);
    const all = await results(page);
    if (all.length > before) return all[all.length - 1];
  }
  throw new Error(`round did not finish within ${maxSeconds}s of game time (phase ${(await state(page)).phase})`);
}

/** Makes sure the game is ready for the next aim (after a win the card must be dismissed). */
export async function readyForNext(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const s = await state(page);
    if (s.phase === 'READY' || s.phase === 'AIMING') return;
    if (s.phase === 'RESULT') {
      const again = page.getByTestId('result-again');
      if (await again.count()) await again.click({ force: true });
      else await ff(page, 1.5);
    } else if (s.phase === 'ATTRACT') await click(page, 'start');
    else await ff(page, 1);
  }
  throw new Error('game did not return to READY');
}

/** Plays rounds aimed at toy centres until one is won (physics tuning may still change the odds). */
export async function winARound(page: Page, maxTries = 8): Promise<{ result: any; tries: number; all: any[] }> {
  const all: any[] = [];
  for (let i = 0; i < maxTries; i++) {
    await readyForNext(page);
    const toys = await fieldToys(page);
    const toy = toys[i % toys.length]!;
    await aim(page, toy.x, toy.z);
    const result = await grabAndWait(page);
    all.push(result);
    if (result.outcome === 'won') return { result, tries: i + 1, all };
  }
  throw new Error(`no win in ${maxTries} centred grabs: ${all.map((r) => `${r.outcome}/${r.slipReason ?? r.contact}`).join(', ')}`);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(page: Page, testId: string): Promise<Box> {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`no bounding box for ${testId}`);
  return b;
}

/** Asserts that an element lies inside normalised screen Y [top, bottom]. */
export async function expectInZone(page: Page, testId: string, top = 0.25, bottom = 0.75): Promise<{ top: number; bottom: number }> {
  const vh = page.viewportSize()!.height;
  const b = await box(page, testId);
  const t = b.y / vh;
  const bt = (b.y + b.height) / vh;
  expect(t, `${testId} top ${t.toFixed(3)}`).toBeGreaterThanOrEqual(top - 0.002);
  expect(bt, `${testId} bottom ${bt.toFixed(3)}`).toBeLessThanOrEqual(bottom + 0.002);
  return { top: t, bottom: bt };
}

export async function openSettings(page: Page, via: 'menu-settings' | 'info-button' = 'menu-settings', tab?: string): Promise<void> {
  await click(page, via);
  await expect(page.getByTestId('settings')).toBeVisible();
  if (tab) {
    await click(page, `tab-${tab}`);
    await expect(page.getByTestId(`panel-${tab}`)).toBeVisible();
  }
}

export async function closeSettings(page: Page, how: 'apply' | 'cancel' | 'close' = 'apply'): Promise<void> {
  await click(page, `settings-${how}`);
  await expect(page.getByTestId('settings')).toHaveCount(0);
}

/** Sets a slider / select / text input rendered by the settings Field component. */
export async function setField(page: Page, path: string, value: string | number | boolean): Promise<void> {
  const el = page.getByTestId(`field-${path}`).first();
  await el.scrollIntoViewIfNeeded();
  const tag = await el.evaluate((e) => `${e.tagName}:${(e as HTMLInputElement).type ?? ''}:${e.getAttribute('role') ?? ''}`);
  if (tag.startsWith('INPUT:range')) {
    await el.evaluate((e, v) => {
      const input = e as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  } else if (tag.includes(':switch')) {
    const on = (await el.getAttribute('aria-checked')) === 'true';
    if (on !== value) await el.click({ force: true });
  } else if (tag.startsWith('SELECT')) {
    await el.selectOption(String(value));
  } else if (tag.startsWith('DIV')) {
    await el.locator(`[data-value="${value}"]`).click({ force: true });
  } else {
    await el.fill(String(value));
  }
}

export const settingsValue = <T = unknown>(page: Page, path: string): Promise<T> =>
  plush(
    page,
    (p, path) => {
      let node: any = p.game.deps.settings.getState().view();
      for (const part of String(path).split('.')) node = node?.[part];
      return node;
    },
    path,
  );

export const appliedValue = <T = unknown>(page: Page, path: string): Promise<T> =>
  plush(
    page,
    (p, path) => {
      let node: any = p.settings();
      for (const part of String(path).split('.')) node = node?.[part];
      return node;
    },
    path,
  );

export type Dir = 'left' | 'right' | 'back' | 'front';

/** Presses and holds a direction button with the mouse while `seconds` of game time pass. */
export async function hold(page: Page, dir: Dir, seconds: number): Promise<void> {
  const b = await box(page, `dir-${dir}`);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await ff(page, seconds);
  await page.mouse.up();
}

/**
 * Steers the claw above (x, z) using only the on-screen direction buttons:
 * a long hold for the approach, then short taps until it is within `tol`.
 * The mouse button is really held down; game time is advanced while it is held.
 */
export async function steerTo(page: Page, x: number, z: number, tol = 0.007): Promise<{ x: number; z: number; presses: number }> {
  let presses = 0;
  for (const axis of ['x', 'z'] as const) {
    const target = axis === 'x' ? x : z;
    for (let i = 0; i < 30; i++) {
      const s = await state(page);
      const err = target - s.claw[axis];
      if (Math.abs(err) < tol) break;
      const dir: Dir = axis === 'x' ? (err > 0 ? 'right' : 'left') : err > 0 ? 'front' : 'back';
      const b = await box(page, `dir-${dir}`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      presses++;
      await plush(
        page,
        (p, a) => {
          if (Math.abs(a.err) > 0.07) {
            // Approach: keep holding until the braking distance is reached.
            for (let k = 0; k < 400; k++) {
              p.fastForward(0.02);
              if (Math.abs(a.target - p.state().claw[a.axis]) < 0.045) break;
            }
          } else p.fastForward(Math.min(0.12, Math.max(0.03, Math.abs(a.err) / 0.3)));
        },
        { err, target, axis },
      );
      await page.mouse.up();
      await ff(page, 0.4);
    }
  }
  const end = await state(page);
  return { x: end.claw.x, z: end.claw.z, presses };
}
