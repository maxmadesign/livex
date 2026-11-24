import { useEffect, useMemo, useState } from 'react';
import { solveFramed, type FramedLayout } from '../layout/frame';
import { applyPhoneGraphics, installPhoneGuards, markPhoneSetupDone, phoneFirstRunAction, phoneSetupDone } from '../layout/phone';
import { readSafeAreaInsets } from '../layout/safeArea';
import { hasCoarsePointer } from '../layout/solve';
import { useApp, useSettings, useSettingsState, useUi } from './context';

/** Viewport size in CSS pixels, updated on resize / orientation change. */
export function useViewport(): { vw: number; vh: number } {
  const [size, setSize] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const update = () => setSize((prev) => (prev.vw === window.innerWidth && prev.vh === window.innerHeight ? prev : { vw: window.innerWidth, vh: window.innerHeight }));
    // Some phones report the new size only after the rotation animation: measure once more then.
    let timer = 0;
    const rotated = () => {
      update();
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 350);
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', rotated);
    // Entering / leaving full screen also resizes the window; measure again in case no resize follows.
    document.addEventListener('fullscreenchange', rotated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', rotated);
      document.removeEventListener('fullscreenchange', rotated);
    };
  }, []);
  return size;
}

/**
 * The HUD geometry for the active display preset (same solver the 3D scene uses). It is solved for
 * the preset's box (`frame`): the simulated 9:16 screen of a portrait preset, otherwise the whole
 * window (src/layout/frame.ts). All coordinates are relative to that box.
 */
export function useHudLayout(): FramedLayout {
  const profile = useUi((s) => s.profile);
  const layout = useSettings((s) => s.profiles[profile].layout);
  const { vw, vh } = useViewport();
  // Safe-area insets change with the orientation, i.e. with the viewport size.
  const insets = useMemo(() => readSafeAreaInsets(), [vw, vh]);
  return useMemo(() => solveFramed(profile, layout, vw, vh, insets), [profile, layout, vw, vh, insets]);
}

export function useReducedMotion(): boolean {
  const pref = useSettings((s) => s.system.reducedMotion);
  const [system, setSystem] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystem(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return pref === 'on' || (pref === 'system' && system);
}

/**
 * First run of the phone preset on a touch device: the Safe graphics preset with its pixel-density
 * cap (src/layout/phone.ts), once per device. An explicit ?quality= wins.
 */
export function usePhoneSetup(): void {
  const app = useApp();
  const profile = useUi((s) => s.profile);
  const editing = useSettingsState((s) => s.draft !== null);
  useEffect(() => {
    const action = phoneFirstRunAction({ profile, coarse: hasCoarsePointer(), done: phoneSetupDone(), launchQuality: app.launch.quality, editing });
    if (action === 'mark') markPhoneSetupDone(null);
    if (action !== 'apply') return;
    const store = app.settings.getState();
    markPhoneSetupDone(applyPhoneGraphics((path, value) => store.set(path, value)));
  }, [app, profile, editing]);
}

/** While the phone preset is active: no pinch zoom, long-press menus or text selection during play. */
export function usePhoneGuards(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return installPhoneGuards(document);
  }, [active]);
}
