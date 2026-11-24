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
  /** Keep the first-run "how to play" card (by default it is marked as already seen). */
  tutorial?: boolean;
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
    await page.addInitScript(
      ({ seed, tutorial }) => {
        try {
          if (sessionStorage.getItem('__e2e_seeded')) return;
          sessionStorage.setItem('__e2e_seeded', '1');
          localStorage.setItem('plush-portal/settings', JSON.stringify({ version: 1, settings: seed }));
          if (!tutorial) localStorage.setItem('plush-portal/tutorial-seen', '1');
        } catch {
          /* storage unavailable */
        }
      },
      { seed: settings, tutorial: !!o.tutorial },
    );
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
export async function grabAndWait(page: Page, maxSeconds = 40): Promise<any> {
  const before = (await results(page)).length;
  await click(page, 'grab');
  const result = await finishRound(page, before, maxSeconds);
  if (!result) throw new Error(`round did not finish within ${maxSeconds}s of game time (phase ${(await state(page)).phase})`);
  return result;
}

/** Advances game time until a new round result exists (one round trip; the page is busy meanwhile). */
export const finishRound = (page: Page, before: number, maxSeconds = 40): Promise<any> =>
  plush(
    page,
    (p, a) => {
      const w = window as any;
      for (let t = 0; t < a.max; t += 0.25) {
        p.fastForward(0.25);
        if (w.__results.length > a.before) return w.__results[w.__results.length - 1];
      }
      return null;
    },
    { before, max: maxSeconds },
  );

/** Advances game time until the round reaches one of `phases` (or `maxSeconds` pass). Returns the phase. */
export const ffUntil = (page: Page, phases: string[], maxSeconds = 30): Promise<string> =>
  plush(
    page,
    (p, a) => {
      for (let t = 0; t < a.max; t += 0.05) {
        if (a.phases.includes(p.state().phase)) break;
        p.fastForward(0.05);
      }
      return p.state().phase;
    },
    { phases, max: maxSeconds },
  );

/** Picks a theme in the theme picker and waits until the cabinet has been rebuilt. */
export async function switchTheme(page: Page, id: Theme, wait = true): Promise<void> {
  await click(page, 'menu-themes');
  await expect(page.getByTestId('theme-picker')).toBeVisible();
  await click(page, `theme-${id}`);
  await expect(page.getByTestId('theme-picker')).toHaveCount(0);
  if (wait) await expect.poll(() => plush(page, (p) => `${p.state().theme}/${p.ui().themeBusy}`), { timeout: 240_000 }).toBe(`${id}/false`);
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

/** Waits until every finite CSS animation (dialog pop-in, toasts, ...) has finished. */
export const settle = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const end = a.effect?.getComputedTiming().endTime;
      return typeof end === 'number' && Number.isFinite(end);
    });
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });

export async function openSettings(page: Page, via: 'menu-settings' | 'info-button' = 'menu-settings', tab?: string): Promise<void> {
  await click(page, via);
  await expect(page.getByTestId('settings')).toBeVisible();
  await settle(page);
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

/** Waits (in real time) until the trolley has stopped, returns its position. */
async function settled(page: Page): Promise<{ x: number; z: number }> {
  let last = (await state(page)).claw;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(120);
    const now = (await state(page)).claw;
    if (Math.abs(now.x - last.x) < 1e-4 && Math.abs(now.z - last.z) < 1e-4) return now;
    last = now;
  }
  return last;
}

/**
 * Steers the claw above (x, z) the way a player does: only the on-screen direction
 * buttons, real pointer press-and-hold in real time, watching the claw and letting go
 * shortly before the target, then short corrective taps until it is within `tol`.
 */
export async function steerTo(page: Page, x: number, z: number, tol = 0.012): Promise<{ x: number; z: number; presses: number }> {
  let presses = 0;
  for (const axis of ['x', 'z'] as const) {
    const target = axis === 'x' ? x : z;
    for (let i = 0; i < 24; i++) {
      const pos = await settled(page);
      const err = target - pos[axis];
      if (Math.abs(err) < tol) break;
      const dir: Dir = axis === 'x' ? (err > 0 ? 'right' : 'left') : err > 0 ? 'front' : 'back';
      const b = await box(page, `dir-${dir}`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      presses++;
      if (Math.abs(err) > 0.07) {
        // Long hold: release a braking distance (plus reaction time) before the target.
        await page.waitForFunction(
          (a) => Math.abs(a.target - (window as any).__plush.state().claw[a.axis]) < 0.075 || !/READY|AIMING/.test((window as any).__plush.state().phase),
          { target, axis },
          { polling: 8, timeout: 180_000 },
        );
      } else await page.waitForTimeout(Math.abs(err) > 0.03 ? 70 : 25);
      await page.mouse.up();
    }
  }
  const end = await settled(page);
  return { x: end.x, z: end.z, presses };
}

/** Waits for `n` rendered frames (slow under software GL). */
export const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const tick = () => (++i >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

export interface Offender {
  id: string;
  top: number;
  bottom: number;
}

/**
 * Every visible interactive element (buttons, inputs, selects, tabs, switches)
 * whose visible rectangle leaves normalised screen Y [top, bottom]. Elements
 * scrolled out of a scroll container are not visible and are ignored.
 */
export const outsideZone = (page: Page, allow: string[] = [], top = 0.25, bottom = 0.75): Promise<Offender[]> =>
  page.evaluate(
    ({ allow, top, bottom }) => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const out: { id: string; top: number; bottom: number }[] = [];
      const nodes = document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [role="switch"], [role="tab"], [role="slider"]');
      for (const el of nodes) {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue;
        if ((el as HTMLInputElement).type === 'file' || (el as HTMLInputElement).type === 'hidden') continue;
        const r = el.getBoundingClientRect();
        let x0 = r.left, x1 = r.right, y0 = r.top, y1 = r.bottom;
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        // Clip against scroll containers: what is scrolled away cannot be touched.
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden') { x1 = x0; break; }
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowY + cs.overflowX)) {
            const c = a.getBoundingClientRect();
            x0 = Math.max(x0, c.left); x1 = Math.min(x1, c.right); y0 = Math.max(y0, c.top); y1 = Math.min(y1, c.bottom);
          }
        }
        x0 = Math.max(x0, 0); x1 = Math.min(x1, vw); y0 = Math.max(y0, 0); y1 = Math.min(y1, vh);
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        const id = el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? `${el.tagName}.${el.className}`;
        if (allow.includes(id)) continue;
        if (y0 / vh < top - 0.002 || y1 / vh > bottom + 0.002) out.push({ id, top: +(y0 / vh).toFixed(4), bottom: +(y1 / vh).toFixed(4) });
      }
      return out;
    },
    { allow, top, bottom },
  );

/** Simulates the tab being hidden / shown again (headless Chromium cannot really background a tab). */
export const setHidden = (page: Page, hidden: boolean): Promise<void> =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

export const input = (page: Page): Promise<{ x: number; z: number }> => plush(page, (p) => ({ x: p.core().controller.inputX, z: p.core().controller.inputZ }));

export interface LowContrast {
  text: string;
  where: string;
  ratio: number;
}

/**
 * Text inside open dialogs whose WCAG contrast ratio against its (solid) background is below `min`.
 * Element opacity is taken into account; text on gradients or images and disabled controls are skipped.
 */
export const lowContrast = (page: Page, min = 3, scope = '[role="dialog"]'): Promise<LowContrast[]> =>
  page.evaluate(
    ({ min, scope }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const cache = new Map<string, number[]>();
      const rgba = (css: string): number[] => {
        let v = cache.get(css);
        if (!v) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000';
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          v = d[3] === 0 ? [0, 0, 0, 0] : [(d[0]! * 255) / d[3]!, (d[1]! * 255) / d[3]!, (d[2]! * 255) / d[3]!, d[3]! / 255];
          cache.set(css, v);
        }
        return v;
      };
      const lum = (c: number[]) => {
        const f = (x: number) => {
          const s = x / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
      };
      const out: { text: string; where: string; ratio: number }[] = [];
      for (const root of document.querySelectorAll<HTMLElement>(scope)) {
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim().length > 1).map((n) => n.textContent!.trim()).join(' ');
          if (!own) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (el.closest(':disabled, [aria-disabled="true"], [hidden], option')) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          // Nearest solid background, collecting opacity on the way.
          let opacity = 1;
          let bg: number[] | null = null;
          for (let a: HTMLElement | null = el; a; a = a.parentElement) {
            const s = getComputedStyle(a);
            const c = rgba(s.backgroundColor);
            if (c[3]! > 0.85) {
              bg = c;
              break;
            }
            if (s.backgroundImage !== 'none' || c[3]! > 0.05) break; // gradient / translucent layer: not decidable here
            opacity *= Number(s.opacity);
          }
          if (!bg) continue;
          const fg = rgba(cs.color);
          const alpha = fg[3]! * opacity;
          const mixed = [0, 1, 2].map((i) => fg[i]! * alpha + bg![i]! * (1 - alpha));
          const [hi, lo] = [lum(mixed), lum(bg)].sort((x, y) => y - x) as [number, number];
          const ratio = (hi + 0.05) / (lo + 0.05);
          if (ratio < min) out.push({ text: own.slice(0, 40), where: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}${el.closest('[data-testid]') ? ` in ${el.closest('[data-testid]')!.getAttribute('data-testid')}` : ''}`, ratio: +ratio.toFixed(2) });
        }
      }
      return out;
    },
    { min, scope },
  );
