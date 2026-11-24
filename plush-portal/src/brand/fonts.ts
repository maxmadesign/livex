/**
 * Brand typeface of a kit (src/brand/kits.ts FontSlot) for the theme it dresses.
 *
 * The official font files are optional: the owner drops them into `public/` (see the kit README).
 * Each file is fetched once; a file that is missing, or answers with something other than a font
 * (a dev server's HTML fallback), is skipped without an error and the open fallback stack is used.
 * A file that is found is handed to the FontFace API, so no CSS has to name the family.
 *
 * The result is published as the CSS custom property `--font-brand` on the document element: the
 * kit's family first when it loaded, then its fallback families. src/ui/theme-gpu.css appends the
 * existing Chinese / Japanese fonts after it, so CJK text keeps them.
 */
import type { BrandKit } from './kits';

export interface BrandFontStatus {
  /**
   * none     – the kit has no brand typeface (the fallback stack is used)
   * pending  – the files are being fetched
   * loaded   – at least one weight of `family` is installed
   * fallback – no file could be used; the fallback stack is drawn instead
   */
  state: 'none' | 'pending' | 'loaded' | 'fallback';
  family: string;
  /** The fallback families as drawn (no generic family). */
  fallback: string;
  /** Site-root relative files that loaded / were not usable. */
  loaded: string[];
  missing: string[];
}

/** CSS generic families: dropped from the kit stack so per-glyph fallback reaches the CJK fonts after it. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']);

/** Font file types a server may answer with (some servers use the older application/* names). */
const FONT_TYPE = /^(font\/|application\/(font|x-font|vnd\.ms-fontobject|octet-stream))/i;

const unquote = (name: string) => name.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const quote = (name: string) => `"${name.replace(/["\\]/g, '')}"`;

/** The kit's fallback families (unquoted), without generic families. */
export function fallbackFamilies(kit: Pick<BrandKit, 'font'>): string[] {
  return kit.font.fallback
    .split(',')
    .map(unquote)
    .filter((name) => name.length > 0 && !GENERIC.has(name.toLowerCase()));
}

/** Value of `--font-brand`: the brand family (when it loaded) followed by the fallback families. */
export function brandFontStack(kit: Pick<BrandKit, 'font'>, loaded: boolean): string {
  const names = fallbackFamilies(kit);
  if (loaded && kit.font.family) names.unshift(kit.font.family);
  return names.map(quote).join(', ');
}

function siteBase(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function publish(kit: BrandKit, loaded: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--font-brand', brandFontStack(kit, loaded));
}

/** One font file as an ArrayBuffer, or null when it is missing or not a font. */
async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (type && !FONT_TYPE.test(type)) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

const statuses = new Map<string, BrandFontStatus>();
const pending = new Map<string, Promise<BrandFontStatus>>();
const listeners = new Set<() => void>();

function initialStatus(kit: BrandKit): BrandFontStatus {
  const fallback = fallbackFamilies(kit).join(', ');
  const none = !kit.font.family || kit.font.files.length === 0;
  return { state: none ? 'none' : 'pending', family: kit.font.family, fallback, loaded: [], missing: [] };
}

function setStatus(kit: BrandKit, status: BrandFontStatus): void {
  statuses.set(kit.id, status);
  for (const listener of listeners) listener();
}

/**
 * Current status of the kit's typeface (`pending` until loadBrandFont has finished). The same object
 * is returned until the status changes, so it can be read with React's useSyncExternalStore.
 */
export function brandFontStatus(kit: BrandKit): BrandFontStatus {
  let status = statuses.get(kit.id);
  if (!status) {
    status = initialStatus(kit);
    statuses.set(kit.id, status);
  }
  return status;
}

/** Calls `listener` whenever a kit's font status changes; returns the unsubscribe function. */
export function onBrandFontStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Publishes the fallback stack at once, then fetches and installs the kit's font files (once per
 * kit; later calls return the same promise). Never throws.
 */
export function loadBrandFont(kit: BrandKit): Promise<BrandFontStatus> {
  let job = pending.get(kit.id);
  if (job) return job;
  const start = initialStatus(kit);
  publish(kit, false);
  setStatus(kit, start);
  job = (async (): Promise<BrandFontStatus> => {
    if (start.state === 'none' || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
      const done: BrandFontStatus = { ...start, state: start.state === 'none' ? 'none' : 'fallback', missing: kit.font.files.map((f) => f.url) };
      setStatus(kit, done);
      return done;
    }
    const base = siteBase();
    const loaded: string[] = [];
    const missing: string[] = [];
    await Promise.all(
      kit.font.files.map(async (file) => {
        const data = await fetchFont(`${base}${file.url}`);
        if (!data) {
          missing.push(file.url);
          return;
        }
        try {
          const face = new FontFace(kit.font.family, data, { weight: String(file.weight), style: 'normal', display: 'swap' });
          await face.load();
          document.fonts.add(face);
          loaded.push(file.url);
        } catch {
          // Not a usable font file: draw the fallback instead.
          missing.push(file.url);
        }
      }),
    );
    const done: BrandFontStatus = { ...start, state: loaded.length > 0 ? 'loaded' : 'fallback', loaded: loaded.sort(), missing: missing.sort() };
    publish(kit, done.state === 'loaded');
    setStatus(kit, done);
    return done;
  })();
  pending.set(kit.id, job);
  return job;
}

/** Test hook: forget fetched fonts and statuses. */
export function resetBrandFonts(): void {
  statuses.clear();
  pending.clear();
}
