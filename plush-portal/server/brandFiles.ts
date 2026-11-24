/**
 * The list of brand-kit files that really exist under `<site root>/assets/brand/` (served as
 * `assets/brand/files.json`). The browser reads it before loading a logo or font slot, so a missing
 * official file is never requested: each such request would be a 404 in the console of a kiosk.
 *
 * Used by the Vite dev server (live listing of `public/`), the production build (a listing of
 * `public/` emitted into `dist/`) and the API server's static handler (a live listing of `dist/`,
 * so files dropped into `dist/assets/brand/` at a booth are found without a rebuild).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const BRAND_FILES_PATH = 'assets/brand/files.json';

/** Site-root relative paths (forward slashes) of every file under `<siteRoot>/assets/brand/`. */
export function listBrandFiles(siteRoot: string): string[] {
  const top = path.join(siteRoot, 'assets', 'brand');
  const out: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 4) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const relPath = `${rel}/${name}`;
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full, relPath, depth + 1);
      else if (relPath !== `assets/brand/files.json` && !/\.md$/i.test(name)) out.push(relPath);
    }
  };
  walk(top, 'assets/brand', 0);
  return out;
}

/** The JSON body of `assets/brand/files.json`. */
export function brandFilesJson(siteRoot: string): string {
  return JSON.stringify({ files: listBrandFiles(siteRoot) });
}
