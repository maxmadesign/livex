import { readInsetsParam } from '../app/launch';

/** Screen cut-outs (notch, punch hole, rounded corners, home indicator) in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

let probe: HTMLElement | null = null;
let cacheKey = '';
let cached: Insets = { ...NO_INSETS };
let override: Insets | null | undefined;

function debugOverride(): Insets | null {
  if (override === undefined) override = readInsetsParam(globalThis.location?.search ?? '');
  return override;
}

/** Tests / tools: force the insets (null = measure again). */
export function setSafeAreaOverride(insets: Insets | null): void {
  override = insets;
  cacheKey = '';
}

/**
 * The browser's current `env(safe-area-inset-*)` values. They are only non-zero on devices with
 * cut-outs and only because index.html asks for `viewport-fit=cover`. Measured with a hidden probe
 * element and cached per viewport size (they change with the orientation). Zero outside a browser.
 * `?debug=1&insets=t,r,b,l` replaces them, so a desktop browser can preview a notched phone.
 */
export function readSafeAreaInsets(): Insets {
  const forced = debugOverride();
  if (forced) return forced;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.body) return { ...NO_INSETS };
  const key = `${globalThis.innerWidth}x${globalThis.innerHeight}`;
  if (key === cacheKey) return cached;
  try {
    if (!probe || !probe.isConnected) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    const px = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    cached = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    cacheKey = key;
  } catch {
    cached = { ...NO_INSETS };
  }
  return cached;
}
