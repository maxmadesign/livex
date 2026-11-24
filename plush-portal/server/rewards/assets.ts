/**
 * Brand files of the claim and staff pages, found on disk the way the browser's resolveLogo finds
 * them: the official file from the kit's logo slot when the owner dropped it into
 * public/assets/brand/<kit>/ (or the build copied it to dist/), else the original placeholder.
 * Files are served exactly as supplied; nothing here edits, tints or re-encodes them.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import type { BrandKit, LogoSlot } from '../../src/brand/kits';
import { resolveInside } from '../static';

export interface BrandFile {
  /** Absolute path on disk. */
  file: string;
  contentType: string;
  size: number;
  /** False for the shipped placeholder. */
  official: boolean;
  /** Site-root relative path of the slot entry that matched. */
  sitePath: string;
}

export interface BrandAssets {
  logo(): BrandFile | null;
  hostLogo(): BrandFile | null;
  /** Brand font files that exist, by weight. Empty = use the fallback stack. */
  fonts(): { weight: number; file: BrandFile }[];
}

const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const FONT_TYPES: Record<string, string> = { '.woff2': 'font/woff2', '.woff': 'font/woff' };

/** Files are looked up again at most this often, so artwork dropped in while the server runs shows up. */
const RECHECK_MS = 5_000;

export function createBrandAssets(kit: BrandKit, dirs: readonly string[], now: () => number = () => Date.now()): BrandAssets {
  const roots = dirs.map((dir) => path.resolve(dir));

  const find = (sitePath: string, types: Record<string, string>): { file: string; contentType: string; size: number } | null => {
    const contentType = types[path.extname(sitePath).toLowerCase()];
    if (!contentType) return null;
    for (const root of roots) {
      const file = resolveInside(root, sitePath);
      if (!file) continue;
      try {
        const info = statSync(file);
        if (info.isFile() && info.size > 0) return { file, contentType, size: info.size };
      } catch {
        /* not in this folder */
      }
    }
    return null;
  };

  const resolveSlot = (slot: LogoSlot | null): BrandFile | null => {
    if (!slot) return null;
    for (const sitePath of slot.official) {
      const hit = find(sitePath, IMAGE_TYPES);
      if (hit) return { ...hit, official: sitePath !== slot.placeholder, sitePath };
    }
    if (slot.placeholder) {
      const hit = find(slot.placeholder, IMAGE_TYPES);
      if (hit) return { ...hit, official: false, sitePath: slot.placeholder };
    }
    return null;
  };

  const cached = <T>(compute: () => T): (() => T) => {
    let at = -Infinity;
    let value: T;
    return () => {
      const t = now();
      if (t - at >= RECHECK_MS) {
        value = compute();
        at = t;
      }
      return value;
    };
  };

  return {
    logo: cached(() => resolveSlot(kit.logo)),
    // A host logo has no placeholder on purpose: without the official file it is simply not drawn.
    hostLogo: cached(() => {
      const file = resolveSlot(kit.hostLogo);
      return file && file.official ? file : null;
    }),
    fonts: cached(() => {
      const out: { weight: number; file: BrandFile }[] = [];
      for (const entry of kit.font.files) {
        const hit = find(entry.url, FONT_TYPES);
        if (hit) out.push({ weight: entry.weight, file: { ...hit, official: true, sitePath: entry.url } });
      }
      return out;
    }),
  };
}
