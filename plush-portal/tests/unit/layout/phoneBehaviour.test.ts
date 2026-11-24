import { afterEach, describe, expect, it, vi } from 'vitest';
import { readInsetsParam, readLaunchParams } from '../../../src/app/launch';
import { GRAPHICS_PRESETS } from '../../../src/app/presets';
import {
  PHONE_MAX_RENDER_RATIO,
  applyPhoneGraphics,
  installPhoneGuards,
  markPhoneSetupDone,
  phoneDprCap,
  phoneFirstRunAction,
  phoneRenderRatio,
  phoneSetupDone,
  requestImmersive,
  resetImmersiveAttempt,
} from '../../../src/layout/phone';
import { NO_INSETS, readSafeAreaInsets, setSafeAreaOverride } from '../../../src/layout/safeArea';
import { solveLayout } from '../../../src/layout/solve';
import { defaultSettings, setValueAt, type Settings } from '../../../src/settings/spec';
import { installMemoryStorage } from '../settings/memoryStorage';

describe('phone graphics on first run', () => {
  it('keeps the 3D view at most 1.5 device pixels per CSS pixel on any phone', () => {
    const safe = GRAPHICS_PRESETS.safe as { renderScale: number; maxDpr?: number };
    for (const dpr of [1, 2, 2.25, 2.625, 2.75, 3, 3.5, 4.5]) {
      expect(phoneRenderRatio(dpr, { ...safe, maxDpr: phoneDprCap(safe) }), `dpr ${dpr}`).toBeLessThanOrEqual(PHONE_MAX_RENDER_RATIO + 1e-9);
    }
    // The cap follows the Safe preset and only tightens it when needed, on the setting's 0.25 grid.
    expect(phoneDprCap({ renderScale: 1, maxDpr: 1.25 })).toBe(1.25);
    expect(phoneDprCap({ renderScale: 1, maxDpr: 3 })).toBe(1.5);
    expect(phoneDprCap({ renderScale: 0.75, maxDpr: 3 })).toBe(2);
    expect(phoneDprCap({ renderScale: 1 })).toBe(1.5);
    expect(phoneDprCap({ renderScale: 4, maxDpr: 3 })).toBe(0.75); // never under the setting's minimum
  });

  it('applies the Safe preset (and only marks it Custom if the phone cap had to change it)', () => {
    let s: Settings = defaultSettings();
    const set = (path: string, value: unknown) => (s = setValueAt(s, path, value));
    const cap = applyPhoneGraphics(set);
    const safe = GRAPHICS_PRESETS.safe as Record<string, unknown>;
    if (typeof safe.maxDpr === 'number' && cap >= (safe.maxDpr as number)) {
      for (const [key, value] of Object.entries(safe)) expect((s.graphics as Record<string, unknown>)[key], key).toEqual(value);
      expect(s.graphics.preset).toBe('safe');
    } else {
      expect((s.graphics as Record<string, unknown>).maxDpr).toBe(cap);
      expect(s.graphics.preset).toBe('custom');
    }
    expect(s.graphics.textures).toBe(GRAPHICS_PRESETS.safe.textures);
    expect(s.graphics.targetFps).toBe('30');
  });

  it('runs once per device, only for the phone preset on a touch screen, never over ?quality= or into an open dialog', () => {
    const f = { profile: 'mobile', coarse: true, done: false, launchQuality: null, editing: false };
    expect(phoneFirstRunAction(f)).toBe('apply');
    expect(phoneFirstRunAction({ ...f, done: true })).toBe('skip');
    expect(phoneFirstRunAction({ ...f, profile: 'desktop' })).toBe('skip');
    expect(phoneFirstRunAction({ ...f, coarse: false })).toBe('skip');
    expect(phoneFirstRunAction({ ...f, launchQuality: 'high' })).toBe('mark');
    expect(phoneFirstRunAction({ ...f, editing: true })).toBe('wait');
  });

  it('remembers that the phone was set up', () => {
    installMemoryStorage();
    expect(phoneSetupDone()).toBe(false);
    markPhoneSetupDone(1.25);
    expect(phoneSetupDone()).toBe(true);
  });
});

describe('immersive mode on the first START tap', () => {
  afterEach(() => resetImmersiveAttempt());

  it('asks for full screen once, then for the landscape lock, and swallows every rejection', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('not allowed')));
    vi.stubGlobal('screen', { orientation: { lock } });
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const doc = { fullscreenElement: null, documentElement: { requestFullscreen } } as unknown as Document;
    expect(requestImmersive(doc)).toBe(true);
    expect(requestImmersive(doc)).toBe(false); // once per page load
    await Promise.resolve();
    await Promise.resolve();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(lock).toHaveBeenCalledWith('landscape');
    vi.unstubAllGlobals();
  });

  it('does not throw where nothing is supported (Safari on iPhone)', () => {
    vi.stubGlobal('screen', {});
    const doc = { fullscreenElement: null, documentElement: {} } as unknown as Document;
    expect(() => requestImmersive(doc)).not.toThrow();
    resetImmersiveAttempt();
    const rejecting = { fullscreenElement: null, documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } } as unknown as Document;
    expect(() => requestImmersive(rejecting)).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('touch guards', () => {
  class FakeEvent {
    defaultPrevented = false;
    cancelable = true;
    constructor(
      readonly type: string,
      readonly target: unknown = null,
      readonly touches: unknown[] = [],
    ) {}
    preventDefault() {
      this.defaultPrevented = true;
    }
  }
  function fakeDoc() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    return {
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(fn),
      removeEventListener: (t: string, fn: (e: unknown) => void) => listeners.get(t)?.delete(fn),
      fire(e: FakeEvent) {
        for (const fn of listeners.get(e.type) ?? []) fn(e);
        return e.defaultPrevented;
      },
      count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    };
  }
  const plain = { closest: () => null };
  const field = { closest: (sel: string) => (sel.includes('input') ? {} : null) };

  it('blocks pinch zoom, long-press menus and selection outside form fields, and cleans up', () => {
    const doc = fakeDoc();
    const off = installPhoneGuards(doc as unknown as Document);
    expect(doc.fire(new FakeEvent('gesturestart'))).toBe(true);
    expect(doc.fire(new FakeEvent('touchmove', plain, [{}, {}]))).toBe(true);
    // One finger moving (dragging the pad, scrolling a dialog) is left alone.
    expect(doc.fire(new FakeEvent('touchmove', plain, [{}]))).toBe(false);
    expect(doc.fire(new FakeEvent('contextmenu', plain))).toBe(true);
    expect(doc.fire(new FakeEvent('selectstart', plain))).toBe(true);
    expect(doc.fire(new FakeEvent('contextmenu', field))).toBe(false);
    expect(doc.fire(new FakeEvent('selectstart', field))).toBe(false);
    off();
    expect(doc.count()).toBe(0);
  });
});

describe('safe-area insets', () => {
  afterEach(() => setSafeAreaOverride(null));

  it('reads ?insets= only together with ?debug=1', () => {
    expect(readInsetsParam('?debug=1&insets=47,0,21,47')).toEqual({ top: 47, right: 0, bottom: 21, left: 47 });
    expect(readInsetsParam('?debug=1&insets=20')).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(readInsetsParam('?insets=47,0,21,47')).toBeNull();
    expect(readInsetsParam('?debug=1&insets=1,2')).toBeNull();
    expect(readInsetsParam('?debug=1&insets=-1,0,0,0')).toBeNull();
    expect(readInsetsParam('?debug=1&insets=a,b,c,d')).toBeNull();
    expect(readInsetsParam('?debug=1')).toBeNull();
    // The launch parameters themselves are unchanged.
    expect(readLaunchParams('?display=mobile&debug=1&insets=10').display).toBe('mobile');
  });

  it('is zero outside a browser, and an override feeds the solver default', () => {
    expect(readSafeAreaInsets()).toEqual(NO_INSETS);
    const d = defaultSettings().profiles.mobile.layout;
    setSafeAreaOverride({ top: 0, right: 0, bottom: 21, left: 47 });
    const l = solveLayout('mobile', d, 852, 393);
    expect(l.insets).toEqual({ top: 0, right: 0, bottom: 21, left: 47 });
    expect(l.controls!.dpad.x).toBeGreaterThanOrEqual(47);
    expect(l.controls!.dpad.y + l.controls!.dpad.h).toBeLessThanOrEqual(393 - 21 + 1e-9);
  });
});
