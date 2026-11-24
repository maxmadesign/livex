/**
 * Reading and updating `public/assets/plush/manifest.json` from the asset tools. Several tools may
 * run at once (a bake per theme, an import): every update re-reads the file under a lock
 * directory and changes only the entries it owns.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_VERSION, normalizeManifest, type PlushAsset, type PlushManifest } from '../../src/plush/manifest';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function plushOutDir(root = PROJECT_ROOT): string {
  return join(root, 'public', 'assets', 'plush');
}

export function readManifest(path: string): PlushManifest | null {
  if (!existsSync(path)) return null;
  return normalizeManifest(JSON.parse(readFileSync(path, 'utf8'))).manifest;
}

/** Runs `update` on the latest manifest while holding the lock and writes the result. */
export async function updateManifest(path: string, update: (latest: PlushManifest | null) => PlushManifest): Promise<PlushManifest> {
  const lockDir = `${path.replace(/manifest\.json$/, '')}.manifest.lock`;
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (attempt > 200) {
        rmSync(lockDir, { recursive: true, force: true }); // stale lock
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    const next = update(readManifest(path));
    writeFileSync(path, `${JSON.stringify({ ...next, version: MANIFEST_VERSION })}\n`);
    return next;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * Fields an import adds to an entry that a re-bake of the procedural design must keep: the
 * textured model and the provenance of the generated model.
 */
export function carryGenerated(previous: PlushAsset | undefined, next: PlushAsset): PlushAsset {
  if (!previous?.model.textured) return next;
  return {
    ...next,
    model: { ...next.model, textured: previous.model.textured },
    source: {
      ...previous.source,
      status: next.source.status,
      note: next.source.note,
      design: next.source.generator,
    },
  };
}
