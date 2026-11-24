import { useEffect, useMemo, useState } from 'react';
import { solveLayout, type HudLayout } from '../layout/solve';
import { useSettings, useUi } from './context';

/** Viewport size in CSS pixels, updated on resize / orientation change. */
export function useViewport(): { vw: number; vh: number } {
  const [size, setSize] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const update = () => setSize({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return size;
}

/** The HUD geometry for the active display preset (same solver the 3D scene uses). */
export function useHudLayout(): HudLayout {
  const profile = useUi((s) => s.profile);
  const layout = useSettings((s) => s.profiles[profile].layout);
  const { vw, vh } = useViewport();
  return useMemo(() => solveLayout(profile, layout, vw, vh), [profile, layout, vw, vh]);
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
