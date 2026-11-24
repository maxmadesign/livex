/**
 * Imports generated textured models (e.g. Higgsfield image-to-3D output) into existing
 * character slots.
 *
 *   npm run assets:import -- --raw <dir>                  # every <id>.glb in <dir> with a manifest entry
 *   npm run assets:import -- --raw <dir> sakura.bunny     # one character (ids, slugs or themes)
 *   npm run assets:import -- --raw <dir> --dry-run        # measure and report only, write nothing
 *
 * Options: --meta <file> (generation batch manifest with job ids / QA verdicts; defaults to
 * <dir>/../manifest.json, then <dir>/../state.json), --force (re-encode even when the raw file is
 * unchanged), --report <file.json>, --yaw <id>=<deg>, --scale <id>=<factor>. The raw directory
 * can also come from PLUSH_RAW_DIR. Raw files are only read; they never enter the repository.
 *
 * Per character: normalise (yaw, uniform scale to the procedural design, base on y = 0, centred
 * on the footprint), weld/clean, softness and fur from the design, LOD0 (≤ 45k triangles), LOD1
 * (~12k), LOD2 (~4k), WebP textures 512 (embedded) / 1K / 2K, meshopt geometry; writes
 * public/assets/plush/<theme>/<slug>.gen.glb (+ .gen-1k.*.webp, .gen-2k.*.webp) and sets
 * `model.textured` and the provenance in the manifest. Collision proxies, mass and footprint stay
 * those of the procedural design; the report says how well the new mesh matches them.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TEXTURE_TIER_SIZE, type FitReport, type PlushAsset, type TextureTier, type TextureVariant } from '../../src/plush/manifest';
import {
  bounds,
  buildLods,
  cleanMesh,
  decodeImage,
  fitToReference,
  measureOutside,
  proxyGaps,
  readRawModel,
  readReference,
  textureVariants,
  transferAttributes,
  transformMesh,
  writeTexturedGlb,
} from './generated';
import { PROJECT_ROOT, plushOutDir, readManifest, updateManifest } from './manifestFile';

/** Bump when the output of the import changes, so unchanged raw files are re-imported once. */
export const IMPORTER_VERSION = 4;
export const GENERATOR = 'Higgsfield: gpt_image_2_6 concept + meshy_v7_image_to_3d';
export const LICENCE_NOTE =
  'AI-generated with Higgsfield from an original PLUSH PORTAL design. Check Higgsfield’s current terms of service (ownership and commercial use depend on the account plan) before distributing.';

/** Per-character corrections that the automatic fit cannot know (keep them small and documented). */
const OVERRIDES: Record<string, { yawDeg?: number; scale?: number }> = {};

interface Args {
  raw: string;
  meta: string | null;
  filters: string[];
  force: boolean;
  dryRun: boolean;
  report: string | null;
  yaw: Map<string, number>;
  scale: Map<string, number>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { raw: process.env.PLUSH_RAW_DIR ?? '', meta: null, filters: [], force: false, dryRun: false, report: null, yaw: new Map(), scale: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--raw') args.raw = value();
    else if (a === '--meta') args.meta = value();
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--report') args.report = value();
    else if (a === '--yaw' || a === '--scale') {
      const [id, num] = value().split('=');
      if (!id || num === undefined || !Number.isFinite(Number(num))) throw new Error(`${a} expects <id>=<number>`);
      (a === '--yaw' ? args.yaw : args.scale).set(id, Number(num));
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else args.filters.push(...a.split(',').filter(Boolean));
  }
  return args;
}

interface JobMeta {
  concept?: string;
  model?: string;
  qa?: string;
}

/** Reads job ids / QA verdicts from the generation batch's manifest or state file (format-tolerant). */
export function readJobMeta(json: unknown): Map<string, JobMeta> {
  const out = new Map<string, JobMeta>();
  const get = (id: string) => {
    let m = out.get(id);
    if (!m) out.set(id, (m = {}));
    return m;
  };
  if (!json || typeof json !== 'object') return out;
  const root = json as Record<string, unknown>;
  const idLike = /^[a-z0-9]+\.[a-z0-9]+$/i;
  // Job ids are single tokens (UUIDs and the like): this keeps prompts, image paths and notes out.
  const jobId = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(v) ? v : null);
  const fromRecord = (id: string, rec: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(rec)) {
      const text = jobId(value) ?? (value && typeof value === 'object' ? jobId((value as { id?: unknown }).id) : null);
      if (/qa|verdict/i.test(key)) {
        const v = typeof value === 'string' ? value : value && typeof value === 'object' ? String((value as { verdict?: unknown; status?: unknown }).verdict ?? (value as { status?: unknown }).status ?? '') : '';
        if (v) get(id).qa = v;
      } else if (text && /concept/i.test(key)) get(id).concept = text;
      else if (text && /model|meshy|3d|mesh/i.test(key) && !/bbox|size|file|path|url/i.test(key)) get(id).model = text;
    }
  };
  for (const [key, value] of Object.entries(root)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      if (idLike.test(key)) fromRecord(key, rec);
      else if (/concept/i.test(key) || /model/i.test(key)) {
        // { concept_jobs: { id: job } } / { model_jobs: { id: job } }
        for (const [id, job] of Object.entries(rec)) if (idLike.test(id) && jobId(job)) get(id)[/concept/i.test(key) ? 'concept' : 'model'] = job as string;
      } else if (/assets|items|models|results/i.test(key)) {
        for (const [id, inner] of Object.entries(rec)) if (idLike.test(id) && inner && typeof inner === 'object') fromRecord(id, inner as Record<string, unknown>);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') fromRecord((item as { id: string }).id, item as Record<string, unknown>);
      }
    }
  }
  return out;
}

/** Judges how far the generated mesh sticks out of the collision proxies, relative to the procedural model. */
export function verdictFor(gen: { share: number; p95: number }, base: { share: number; p95: number }, gapP95: number): FitReport['verdict'] {
  const excessP95 = gen.p95 - base.p95;
  const excessShare = gen.share - base.share;
  if (excessP95 > 0.02 || excessShare > 0.3 || gapP95 > 0.02) return 'mismatch';
  if (excessP95 > 0.008 || excessShare > 0.12 || gapP95 > 0.01) return 'check';
  return 'ok';
}

const round = (v: number, digits = 4) => Number(v.toFixed(digits));
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

interface Row {
  id: string;
  status: 'imported' | 'up-to-date' | 'skipped' | 'failed';
  message?: string;
  triangles?: number[];
  glbBytes?: number;
  textureBytes?: Partial<Record<TextureTier, number>>;
  fit?: FitReport & { yawScores: Record<string, number>; sizeRatio: number[]; lodSeams: string[] };
}

async function importOne(asset: PlushAsset, rawPath: string, meta: JobMeta | undefined, args: Args): Promise<{ row: Row; entry?: PlushAsset }> {
  const data = new Uint8Array(readFileSync(rawPath));
  const sha = createHash('sha256').update(data).digest('hex');
  const base = `${asset.theme}/${asset.slug}.gen`;
  const glbRel = `assets/plush/${base}.glb`;
  const textured = asset.model.textured;
  const upToDate =
    !args.force &&
    textured !== undefined &&
    asset.source.rawSha256 === sha &&
    textured.path === glbRel &&
    asset.source.note.includes(`importer v${IMPORTER_VERSION}`) &&
    existsSync(join(PROJECT_ROOT, 'public', glbRel)) &&
    Object.values(textured.textures).every((t) => t && (t.embedded || existsSync(join(PROJECT_ROOT, 'public', t.baseColor))));
  if (upToDate) {
    // Nothing to re-encode; the provenance may still have changed (e.g. the batch manifest arrived).
    const jobs = { ...asset.source.jobs, ...(meta?.concept ? { concept: meta.concept } : {}), ...(meta?.model ? { model: meta.model } : {}) };
    const qa = meta?.qa ?? asset.source.qa;
    const changed = JSON.stringify(jobs) !== JSON.stringify(asset.source.jobs ?? {}) || qa !== asset.source.qa;
    const row: Row = { id: asset.id, status: 'up-to-date', glbBytes: textured.bytes, triangles: textured.lods.map((l) => l.triangles), ...(changed ? { message: 'provenance updated' } : {}) };
    return changed ? { row, entry: { ...asset, source: { ...asset.source, jobs, ...(qa ? { qa } : {}) } } } : { row };
  }

  const raw = await readRawModel(data);
  const { mesh: clean, removedTriangles, mergedVertices } = cleanMesh(raw.mesh);
  const procPath = join(PROJECT_ROOT, 'public', asset.model.path);
  if (!existsSync(procPath)) throw new Error(`procedural model ${asset.model.path} is missing (run "npm run assets:plush" first)`);
  const reference = await readReference(new Uint8Array(readFileSync(procPath)));
  const override = OVERRIDES[asset.id] ?? {};
  const fit = fitToReference(clean, reference, { yawDeg: args.yaw.get(asset.id) ?? override.yawDeg, scaleBias: args.scale.get(asset.id) ?? override.scale });
  const fitted = transformMesh(clean, fit);
  const roughness = raw.textures.metallicRoughness ? await decodeImage(raw.textures.metallicRoughness) : null;
  transferAttributes(fitted, reference, { roughness, proxies: asset.proxies });

  const gen = measureOutside(fitted.position, fitted.indices, asset.proxies);
  const baseline = measureOutside(reference.position, reference.indices, asset.proxies);
  const gaps = proxyGaps(fitted.position, fitted.indices, asset.proxies);
  const verdict = verdictFor(gen, baseline, gaps.p95);
  const b = bounds(fitted.position);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const fitReport: FitReport = {
    yawDeg: fit.yawDeg,
    scale: round(fit.scale, 6),
    bounds: { min: b.min.map((v) => round(v)) as FitReport['bounds']['min'], max: b.max.map((v) => round(v)) as FitReport['bounds']['max'] },
    shapeMean: round(fit.shapeMean),
    shapeP95: round(fit.shapeP95),
    outsideShare: round(gen.share, 3),
    outsideP95: round(gen.p95),
    outsideMax: round(gen.max),
    baselineOutsideShare: round(baseline.share, 3),
    baselineOutsideP95: round(baseline.p95),
    proxyGapP95: round(gaps.p95),
    proxyGapMax: round(gaps.max),
    verdict,
  };

  const { lods, seams } = await buildLods(fitted);
  const tiers = (['512', '1k', '2k'] as const).map((tier) => ({ tier, size: TEXTURE_TIER_SIZE[tier] }));
  const variants = await textureVariants(raw.textures, tiers, { uv: clean.uv, indices: clean.indices });
  const embedded = variants.get('512')!;
  const extras = {
    id: asset.id,
    generator: GENERATOR,
    importer: `tools/plush/import-generated.ts v${IMPORTER_VERSION}`,
    rawSha256: sha,
  };
  const glb = await writeTexturedGlb(lods, embedded, extras);
  const textures: Partial<Record<TextureTier, TextureVariant>> = {};
  const files: [string, Buffer | Uint8Array][] = [[glbRel, glb]];
  const textureBytes: Partial<Record<TextureTier, number>> = {};
  for (const [tier, v] of variants) {
    const bytes = v.baseColor.length + v.normal.length + v.roughness.length;
    textureBytes[tier] = bytes;
    if (tier === '512') {
      textures[tier] = { size: v.size, embedded: true, baseColor: '', normal: '', roughness: '', bytes };
      continue;
    }
    const rel = (kind: string) => `assets/plush/${base}-${tier}.${kind}.webp`;
    textures[tier] = { size: v.size, embedded: false, baseColor: rel('color'), normal: rel('normal'), roughness: rel('rough'), bytes };
    files.push([rel('color'), v.baseColor], [rel('normal'), v.normal], [rel('rough'), v.roughness]);
  }
  if (!args.dryRun) {
    for (const [rel, buf] of files) {
      const path = join(PROJECT_ROOT, 'public', rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
    }
  }
  const design = asset.source.design ?? asset.source.generator;
  const entry: PlushAsset = {
    ...asset,
    model: {
      ...asset.model,
      textured: {
        path: glbRel,
        bytes: glb.byteLength,
        lods: lods.map((m, i) => ({ mesh: `LOD${i}`, triangles: m.indices.length / 3, vertices: m.count })),
        attributes: ['POSITION', 'NORMAL', 'TEXCOORD_0', '_AUX'],
        textures,
        fit: fitReport,
      },
    },
    source: {
      ...asset.source,
      method: 'ai-generated',
      generator: GENERATOR,
      license: LICENCE_NOTE,
      note: `Model generated from the original design ${design} (concept photo, then image-to-3D); collision proxies, mass and footprint come from that design. Imported by tools/plush/import-generated.ts importer v${IMPORTER_VERSION}.`,
      design,
      jobs: { ...(meta?.concept ? { concept: meta.concept } : {}), ...(meta?.model ? { model: meta.model } : {}) },
      rawSha256: sha,
      ...(meta?.qa ? { qa: meta.qa } : {}),
    },
  };
  const sizeRatio = [0, 1, 2].map((i) => round(size[i]! / asset.size[i]!, 3));
  return {
    entry,
    row: {
      id: asset.id,
      status: 'imported',
      message: `cleaned: -${removedTriangles} tris, ${mergedVertices} duplicate vertices merged`,
      triangles: lods.map((m) => m.indices.length / 3),
      glbBytes: glb.byteLength,
      textureBytes,
      fit: { ...fitReport, yawScores: Object.fromEntries(Object.entries(fit.yawScores).map(([k, v]) => [k, round(v)])), sizeRatio, lodSeams: seams },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.raw) {
    console.error('Usage: npm run assets:import -- --raw <directory with <id>.glb files> [ids…] [--dry-run] [--force]\n(or set PLUSH_RAW_DIR)');
    process.exit(2);
  }
  const rawDir = resolve(args.raw);
  if (!existsSync(rawDir)) throw new Error(`raw directory ${rawDir} does not exist`);
  const outDir = plushOutDir();
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = readManifest(manifestPath);
  if (!manifest) throw new Error('public/assets/plush/manifest.json is missing; run "npm run assets:plush" first');

  const metaPath = args.meta ?? [join(rawDir, '..', 'manifest.json'), join(rawDir, '..', 'state.json')].find((p) => existsSync(p)) ?? null;
  const meta = metaPath && existsSync(metaPath) ? readJobMeta(JSON.parse(readFileSync(metaPath, 'utf8'))) : new Map<string, JobMeta>();

  const rawIds = new Set(readdirSync(rawDir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)));
  const wanted = (a: PlushAsset) => args.filters.length === 0 || args.filters.includes(a.id) || args.filters.includes(a.theme) || args.filters.includes(a.slug);
  const rows: Row[] = [];
  const updates = new Map<string, PlushAsset>();
  for (const asset of manifest.assets) {
    if (!wanted(asset)) continue;
    if (!rawIds.has(asset.id)) {
      rows.push({ id: asset.id, status: 'skipped', message: 'no raw file' });
      continue;
    }
    const t0 = performance.now();
    try {
      const { row, entry } = await importOne(asset, join(rawDir, `${asset.id}.glb`), meta.get(asset.id), args);
      rows.push(row);
      if (entry) updates.set(asset.id, entry);
      const f = row.fit;
      console.log(
        `${asset.id.padEnd(22)} ${row.status.padEnd(10)} tris ${(row.triangles ?? []).join('/').padEnd(18)} glb ${kb(row.glbBytes ?? 0).padStart(7)}` +
          (row.textureBytes ? `  tex 512 ${kb(row.textureBytes['512'] ?? 0)} / 1k ${kb(row.textureBytes['1k'] ?? 0)} / 2k ${kb(row.textureBytes['2k'] ?? 0)}` : '') +
          (f
            ? `\n${' '.repeat(23)}yaw ${f.yawDeg}° (scores ${Object.entries(f.yawScores).map(([k, v]) => `${k}:${(v * 100).toFixed(2)}`).join(' ')} cm)  size/design ${f.sizeRatio.join(' × ')}  shape mean ${(f.shapeMean * 100).toFixed(2)} cm p95 ${(f.shapeP95 * 100).toFixed(2)} cm` +
              `\n${' '.repeat(23)}outside proxies: ${(f.outsideShare * 100).toFixed(1)} % >1 cm, p95 ${(f.outsideP95 * 100).toFixed(2)} cm, max ${(f.outsideMax * 100).toFixed(2)} cm (procedural ${(f.baselineOutsideShare * 100).toFixed(1)} %, p95 ${(f.baselineOutsideP95 * 100).toFixed(2)} cm); proxy points outside the mesh p95 ${(f.proxyGapP95 * 100).toFixed(2)} cm, max ${(f.proxyGapMax * 100).toFixed(2)} cm  → ${f.verdict.toUpperCase()}\n${' '.repeat(23)}LOD seams: ${f.lodSeams.join('/')}`
            : '') +
          `  ${((performance.now() - t0) / 1000).toFixed(1)} s`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({ id: asset.id, status: 'failed', message });
      console.error(`${asset.id.padEnd(22)} FAILED: ${message}`);
    }
  }
  const known = new Set(manifest.assets.map((a) => a.id));
  const orphans = [...rawIds].filter((id) => !known.has(id) && (args.filters.length === 0 || args.filters.includes(id)));
  for (const id of orphans) rows.push({ id, status: 'skipped', message: 'no manifest entry for this id' });
  if (orphans.length > 0) console.log(`\nNo manifest entry (bake the design first): ${orphans.join(', ')}`);

  if (!args.dryRun && updates.size > 0) {
    await updateManifest(manifestPath, (latest) => {
      const base = latest ?? manifest;
      // Only the fields the import owns change: a design re-baked meanwhile keeps its new proxies,
      // mass, footprint and procedural model.
      return {
        ...base,
        assets: base.assets.map((a) => {
          const u = updates.get(a.id);
          return u ? { ...a, model: { ...a.model, textured: u.model.textured }, source: { ...u.source, status: a.source.status } } : a;
        }),
      };
    });
  }
  if (args.report) writeFileSync(resolve(args.report), `${JSON.stringify(rows, null, 2)}\n`);
  const count = (s: Row['status']) => rows.filter((r) => r.status === s).length;
  const flagged = rows.filter((r) => r.fit && r.fit.verdict !== 'ok').map((r) => `${r.id} (${r.fit!.verdict})`);
  console.log(
    `\nimported ${count('imported')}, up to date ${count('up-to-date')}, skipped ${count('skipped')}, failed ${count('failed')}${args.dryRun ? ' (dry run: nothing written)' : ''}` +
      (flagged.length > 0 ? `\nCheck against the collision proxies: ${flagged.join(', ')}` : ''),
  );
  if (count('failed') > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
