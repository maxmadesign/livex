import type { BrandFontStatus } from '../../brand/fonts';
import type { BrandKit, LogoSlot, ResolvedLogo } from '../../brand';

/** One line of the brand status block (Settings → Themes & Toys): a string key and its parameters. */
export interface StatusLine {
  key: string;
  params?: Record<string, string>;
  /** For tests and styling: found / placeholder / missing / none / checking / loaded / fallback / original. */
  state: string;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** What a logo slot shows right now and where the official file would go. */
export function logoStatus(slot: LogoSlot | null, resolved: ResolvedLogo | null): StatusLine {
  if (!slot) return { key: 'brand.status.logo.none', state: 'none' };
  if (!resolved) return { key: 'brand.status.checking', state: 'checking' };
  const wanted = slot.official[0] ?? '';
  if (resolved.official && resolved.path) return { key: 'brand.status.logo.official', params: { path: resolved.path }, state: 'found' };
  // A kit whose own original artwork is its only file (the neutral kit): nothing to replace.
  if (resolved.url && resolved.path && slot.official.includes(resolved.path)) return { key: 'brand.status.logo.original', params: { path: resolved.path }, state: 'original' };
  if (resolved.url) return { key: 'brand.status.logo.placeholder', params: { path: wanted }, state: 'placeholder' };
  return { key: 'brand.status.logo.missing', params: { path: wanted }, state: 'missing' };
}

/** Whether the brand typeface is drawn, or which fallback is, and where its files would go. */
export function fontStatus(kit: Pick<BrandKit, 'font'>, status: BrandFontStatus): StatusLine {
  // The family actually drawn: the first fallback the browser has (the open fallback ships with the app).
  const fallback = status.fallback.split(',')[0]?.trim() || 'sans-serif';
  if (status.state === 'none') return { key: 'brand.status.font.none', params: { fallback }, state: 'none' };
  if (status.state === 'pending') return { key: 'brand.status.checking', state: 'checking' };
  if (status.state === 'loaded') return { key: 'brand.status.font.loaded', params: { family: status.family }, state: 'loaded' };
  return { key: 'brand.status.font.fallback', params: { family: status.family, fallback, path: dirOf(kit.font.files[0]?.url ?? '') }, state: 'fallback' };
}

/** The folder the kit's official files go into (for the note under the block). */
export function brandFolder(kit: Pick<BrandKit, 'logo'>): string {
  return dirOf(kit.logo.official[0] ?? '');
}
