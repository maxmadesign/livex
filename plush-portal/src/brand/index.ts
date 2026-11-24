/**
 * Browser side of the brand kits (see ./kits.ts): which kit this build uses and where its logo
 * files really are.
 *
 * The kit is chosen at build time with `VITE_BRAND` ('gtc' by default; 'neutral' for public demo
 * copies that must not carry a real event's marks). It dresses only `kit.theme`.
 */
import type { ThemeId } from '../core/types';
import { BRAND_KITS, parseBrandId, type BrandKit, type LogoSlot } from './kits';

export * from './kits';

export const ACTIVE_BRAND: BrandKit = BRAND_KITS[parseBrandId(import.meta.env.VITE_BRAND as string | undefined)];

/** The kit that dresses `theme`, or null when the theme has none. */
export function brandForTheme(theme: ThemeId): BrandKit | null {
  return ACTIVE_BRAND.theme === theme ? ACTIVE_BRAND : null;
}

/** Facts the guide may use ({event}, {host}); null when names are not allowed for this theme. */
export function brandFacts(theme: ThemeId): { event: string; host: string } | null {
  const kit = brandForTheme(theme);
  return kit && kit.namesAllowed ? { event: kit.eventName, host: kit.hostName } : null;
}

export interface ResolvedLogo {
  /** URL to load (already prefixed with the site base), or null when nothing should be drawn. */
  url: string | null;
  /** True when an official file was found; false = the original placeholder (or nothing). */
  official: boolean;
  /** Site-root relative path that was chosen, for status displays. */
  path: string | null;
}

const resolved = new Map<string, Promise<ResolvedLogo>>();

function siteBase(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** True when `path` answers with an image (a dev server's HTML fallback does not count). */
async function isImage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-cache' });
    if (!response.ok) return false;
    const type = response.headers.get('content-type') ?? '';
    // Drain the body so the connection is released; the browser cache keeps it for the <img>/texture.
    await response.arrayBuffer().catch(() => undefined);
    return type.startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * Finds the first official file of `slot` that exists, else the placeholder. Cached per slot, so
 * the 3D scene, the DOM and status displays agree and the files are probed once.
 */
export function resolveLogo(slot: LogoSlot): Promise<ResolvedLogo> {
  const key = `${slot.official.join('|')}#${slot.placeholder ?? ''}`;
  let pending = resolved.get(key);
  if (!pending) {
    pending = (async (): Promise<ResolvedLogo> => {
      const base = siteBase();
      for (const path of slot.official) {
        if (await isImage(`${base}${path}`)) return { url: `${base}${path}`, official: path !== slot.placeholder, path };
      }
      if (slot.placeholder) return { url: `${base}${slot.placeholder}`, official: false, path: slot.placeholder };
      return { url: null, official: false, path: null };
    })();
    resolved.set(key, pending);
  }
  return pending;
}

/** Test hook: forget probed logo files. */
export function resetBrandCache(): void {
  resolved.clear();
}
