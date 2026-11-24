/**
 * Bakes every plush design to `public/assets/plush/<theme>/<slug>.glb` and
 * writes `public/assets/plush/manifest.json`.
 *
 *   npm run assets:plush              # everything
 *   npm run assets:plush -- sakura    # one theme
 *   npm run assets:plush -- bunny     # one character (the manifest keeps the others)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_VERSION, PLUSH_ATTRIBUTES, type PlushAsset, type PlushManifest } from '../../src/plush/manifest';
import { buildAsset } from './build';
import { ALL_DESIGNS } from './designs/index';
import { writeGlb } from './glb';
import { PROJECT_ROOT, carryGenerated, plushOutDir, readManifest, updateManifest } from './manifestFile';

const root = PROJECT_ROOT;
const outDir = plushOutDir();
const manifestPath = join(outDir, 'manifest.json');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const GENERATOR = 'tools/plush (procedural SDF modelling, v1)';

const previous: PlushManifest | null = readManifest(manifestPath);
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

// Several bakes may run at once (one per theme while designing), and `npm run assets:import` adds
// textured models to entries: merge into the manifest under a lock, keeping what an import added.
const mine = new Set(selected.map((d) => `${d.theme}.${d.slug}`));
const order = new Map(ALL_DESIGNS.map((d, i) => [`${d.theme}.${d.slug}`, i]));
let kept = 0;
const manifest = await updateManifest(manifestPath, (latest) => {
  const latestById = new Map((latest?.assets ?? []).map((a) => [a.id, a]));
  if (filters.length > 0) for (const a of latest?.assets ?? []) if (!mine.has(a.id)) assets.set(a.id, a);
  for (const id of mine) {
    const before = latestById.get(id);
    const baked = assets.get(id);
    if (baked && before?.model.textured) {
      assets.set(id, carryGenerated(before, baked));
      kept++;
    }
  }
  return {
    version: MANIFEST_VERSION,
    generator: GENERATOR,
    assets: [...assets.values()].filter((a) => order.has(a.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!),
  };
});
console.log(`\n${selected.length} asset(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MB of GLB; manifest lists ${manifest.assets.length} asset(s).`);
if (kept > 0) {
  console.log(`${kept} baked character(s) keep their imported textured model; re-run "npm run assets:import" if the design's shape changed.`);
}
