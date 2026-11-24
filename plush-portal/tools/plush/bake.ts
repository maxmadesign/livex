/**
 * Bakes every plush design to `public/assets/plush/<theme>/<slug>.glb` and
 * writes `public/assets/plush/manifest.json`.
 *
 *   npm run assets:plush              # everything
 *   npm run assets:plush -- sakura    # one theme
 *   npm run assets:plush -- bunny     # one character (the manifest keeps the others)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_VERSION, PLUSH_ATTRIBUTES, type PlushAsset, type PlushManifest } from '../../src/plush/manifest';
import { buildAsset } from './build';
import { ALL_DESIGNS } from './designs/index';
import { writeGlb } from './glb';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'assets', 'plush');
const manifestPath = join(outDir, 'manifest.json');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const GENERATOR = 'tools/plush (procedural SDF modelling, v1)';

const previous: PlushManifest | null = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as PlushManifest) : null;
const assets = new Map<string, PlushAsset>();
if (previous && filters.length > 0) for (const a of previous.assets) assets.set(a.id, a);

const selected = ALL_DESIGNS.filter((d) => filters.length === 0 || filters.includes(d.theme) || filters.includes(d.slug) || filters.includes(`${d.theme}.${d.slug}`));
if (selected.length === 0) {
  console.error(`No design matches: ${filters.join(', ')}`);
  process.exit(1);
}

let totalBytes = 0;
for (const design of selected) {
  const t0 = performance.now();
  const id = `${design.theme}.${design.slug}`;
  const built = await buildAsset(design);
  const glb = await writeGlb(built.lods, { name: id, extras: { id, manifestVersion: MANIFEST_VERSION, generator: GENERATOR }, compress: true });
  const rel = `assets/plush/${design.theme}/${design.slug}.glb`;
  mkdirSync(join(outDir, design.theme), { recursive: true });
  writeFileSync(join(root, 'public', rel), glb);
  totalBytes += glb.byteLength;
  assets.set(id, {
    id,
    theme: design.theme,
    slug: design.slug,
    name: design.name,
    kind: design.kind,
    size: built.size,
    mass: design.mass,
    footprint: built.footprint,
    comHeight: built.comHeight,
    palette: built.palette,
    materials: built.materials,
    model: {
      path: rel,
      bytes: glb.byteLength,
      lods: built.lods.map((m, i) => ({ mesh: `LOD${i}`, triangles: m.indices.length / 3, vertices: m.count })),
      attributes: [...PLUSH_ATTRIBUTES],
    },
    paint: built.paint,
    maskRange: built.maskRange,
    proxies: built.proxies,
    deform: built.deform,
    source: {
      status: design.status,
      method: 'procedural-sdf',
      generator: `tools/plush/designs/${design.theme}.ts#${design.slug}`,
      license: 'Original work created for PLUSH PORTAL',
      note: design.note,
    },
  });
  const lodText = built.lods.map((m) => `${m.indices.length / 3}`).join('/');
  console.log(
    `${id.padEnd(22)} ${(glb.byteLength / 1024).toFixed(0).padStart(4)} KB  tris ${lodText.padEnd(17)} size ${built.size.map((v) => (v * 100).toFixed(1)).join('×')} cm  proxies ${built.proxies.length}  ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
}

// Several bakes may run at once (one per theme while designing): merge into the manifest under a lock.
const lockDir = join(outDir, '.manifest.lock');
mkdirSync(outDir, { recursive: true });
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
if (existsSync(manifestPath) && filters.length > 0) {
  const latest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PlushManifest;
  const mine = new Set(selected.map((d) => `${d.theme}.${d.slug}`));
  for (const a of latest.assets) if (!mine.has(a.id)) assets.set(a.id, a);
}
const order = new Map(ALL_DESIGNS.map((d, i) => [`${d.theme}.${d.slug}`, i]));
const manifest: PlushManifest = {
  version: MANIFEST_VERSION,
  generator: GENERATOR,
  assets: [...assets.values()].filter((a) => order.has(a.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!),
};
mkdirSync(outDir, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
rmSync(lockDir, { recursive: true, force: true });
console.log(`\n${selected.length} asset(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MB of GLB; manifest lists ${manifest.assets.length} asset(s).`);
