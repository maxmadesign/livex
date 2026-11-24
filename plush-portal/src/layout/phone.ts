import { GRAPHICS_PRESETS, applyGraphicsPreset } from '../app/presets';
import { readJson, writeJson } from '../persistence/storage';

/**
 * Phone behaviour that is not geometry: first-run graphics defaults, full screen + landscape lock,
 * and the browser gestures that must not fire during play (zoom, long-press menus, selection).
 */

/**
 * Largest internal 3D resolution on a phone, as a multiple of CSS pixels (≈ 0.11 mm per rendered
 * pixel). The Safe preset already stays under it (pixel density cap 1.25 × render scale 1, at most
 * 0.7 MP); the check below only matters if that preset is ever raised.
 */
export const PHONE_MAX_RENDER_RATIO = 1.5;
/** Stored once the phone defaults were applied on this device (they are never re-applied). */
export const PHONE_SETUP_KEY = 'phone-setup';

type SafeValues = { renderScale: number; maxDpr?: number };

/**
 * Pixel-density cap for a phone: the Safe preset's own cap, lowered (on its 0.25 grid, never under
 * the setting's minimum of 0.75) when cap × render scale would exceed PHONE_MAX_RENDER_RATIO.
 */
export function phoneDprCap(safe: SafeValues = GRAPHICS_PRESETS.safe as SafeValues): number {
  const own = typeof safe.maxDpr === 'number' ? safe.maxDpr : 4;
  const scale = safe.renderScale > 0 ? safe.renderScale : 1;
  const limit = Math.floor((PHONE_MAX_RENDER_RATIO / scale) * 4 + 1e-9) / 4;
  return Math.max(0.75, Math.min(own, limit));
}

/** Device pixels per CSS pixel the 3D view is rendered at on a phone with these values (before the pixel budget). */
export function phoneRenderRatio(dpr: number, g: SafeValues): number {
  const cap = typeof g.maxDpr === 'number' ? g.maxDpr : Infinity;
  return Math.min(dpr, cap) * g.renderScale;
}

/**
 * Applies the phone defaults: the Safe graphics preset (30 fps target, 512 textures, no fur shells,
 * pixel density and pixel budget capped), plus the phone cap if Safe would exceed it — then the
 * preset is shown as "Custom", because its values no longer match Safe. Returns the cap in use.
 */
export function applyPhoneGraphics(set: (path: string, value: unknown) => void): number {
  applyGraphicsPreset(set, 'safe');
  const safe = GRAPHICS_PRESETS.safe as SafeValues;
  const cap = phoneDprCap(safe);
  if (typeof safe.maxDpr !== 'number' || cap < safe.maxDpr - 1e-9) {
    set('graphics.maxDpr', cap);
    set('graphics.preset', 'custom');
  }
  return cap;
}

export function phoneSetupDone(): boolean {
  const v = readJson(PHONE_SETUP_KEY) as { v?: unknown } | null;
  return !!v && v.v === 1;
}

export function markPhoneSetupDone(maxDpr: number | null): void {
  writeJson(PHONE_SETUP_KEY, { v: 1, maxDpr });
}

/** What the first phone run should do, decided from plain facts (unit-tested). */
export function phoneFirstRunAction(facts: { profile: string; coarse: boolean; done: boolean; launchQuality: string | null; editing: boolean }): 'apply' | 'skip' | 'mark' | 'wait' {
  if (facts.profile !== 'mobile' || !facts.coarse || facts.done) return 'skip';
  // An explicit ?quality= wins; remember that the phone was set up so it is not overridden later.
  if (facts.launchQuality) return 'mark';
  // Never write into the settings draft behind the player's back; do it once the dialog is closed.
  if (facts.editing) return 'wait';
  return 'apply';
}

let immersiveTried = false;

/** Test hook: allow another attempt. */
export function resetImmersiveAttempt(): void {
  immersiveTried = false;
}

/**
 * Best effort, once per page load, from inside a tap: full screen, then lock to landscape (Chrome on
 * Android only allows the lock in full screen). Safari on iPhone supports neither for a page; every
 * rejection is ignored. Returns false when nothing was attempted.
 */
export function requestImmersive(doc: Document = document): boolean {
  if (immersiveTried) return false;
  immersiveTried = true;
  const lock = () => {
    try {
      const orientation = (globalThis.screen as (Screen & { orientation?: { lock?: (o: string) => Promise<void> } }) | undefined)?.orientation;
      const p = orientation?.lock?.('landscape');
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* not supported */
    }
  };
  try {
    const el = doc.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (doc.fullscreenElement) {
      lock();
      return true;
    }
    if (typeof el.requestFullscreen === 'function') {
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && typeof p.then === 'function') p.then(lock, () => undefined);
      else lock();
      return true;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
      lock();
      return true;
    }
    lock();
  } catch {
    /* ignore: full screen is optional */
  }
  return true;
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

function inEditable(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el && typeof el.closest === 'function' && el.closest(EDITABLE) !== null;
}

/**
 * Document-level guards for touch play: no pinch / double-tap zoom (iOS ignores user-scalable=no),
 * no long-press callout or context menu and no text selection outside form fields. Scrolling inside
 * dialogs keeps working (CSS touch-action allows panning there). Returns the cleanup function.
 */
export function installPhoneGuards(doc: Document = document): () => void {
  const prevent = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 1 && e.cancelable) e.preventDefault();
  };
  const onMenu = (e: Event) => {
    if (!inEditable(e.target) && e.cancelable) e.preventDefault();
  };
  // Double-tap zoom is switched off by CSS (touch-action none / manipulation, hud.css).
  const opts = { passive: false } as AddEventListenerOptions;
  const events: [string, EventListener][] = [
    ['gesturestart', prevent],
    ['gesturechange', prevent],
    ['gestureend', prevent],
    ['touchmove', onTouchMove as EventListener],
    ['contextmenu', onMenu],
    ['selectstart', onMenu],
  ];
  for (const [type, fn] of events) doc.addEventListener(type, fn, opts);
  return () => {
    for (const [type, fn] of events) doc.removeEventListener(type, fn, opts);
  };
}
