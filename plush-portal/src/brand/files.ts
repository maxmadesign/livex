/**
 * Which brand-kit files really exist (`assets/brand/files.json`, written by server/brandFiles.ts for
 * the dev server, the build and the API server's static handler). The logo and font loaders read
 * it first, so a missing official file is never requested: every such request would show up as a
 * 404 in the browser console of a kiosk. Hosts without the listing fall back to probing.
 */

export const BRAND_FILES_URL = 'assets/brand/files.json';
const BRAND_DIR = 'assets/brand/';

export function siteBase(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

let listing: Promise<ReadonlySet<string> | null> | null = null;

/** The listed files (site-root relative), or null when the host has no listing. Fetched once. */
export function brandFiles(): Promise<ReadonlySet<string> | null> {
  listing ??= (async () => {
    try {
      const response = await fetch(`${siteBase()}${BRAND_FILES_URL}`, { cache: 'no-cache' });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
      const body = (await response.json()) as { files?: unknown };
      if (!Array.isArray(body.files)) return null;
      return new Set(body.files.filter((f): f is string => typeof f === 'string'));
    } catch {
      return null;
    }
  })();
  return listing;
}

/**
 * False only when the listing exists and does not contain `path` (a file under assets/brand/).
 * Paths outside assets/brand/ and hosts without a listing answer true: probe them as before.
 */
export async function mayExist(path: string): Promise<boolean> {
  if (!path.startsWith(BRAND_DIR)) return true;
  const files = await brandFiles();
  return files === null || files.has(path);
}

/** Test hook: forget the listing. */
export function resetBrandFiles(): void {
  listing = null;
}
