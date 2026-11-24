import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST_VERSION, normalizeManifest, pickTextureTier, type PlushAsset, type PlushManifest, type TexturedModel } from '../../../src/plush/manifest';
import { carryGenerated } from '../../../tools/plush/manifestFile';
import { fakeAsset } from '../helpers/fakeAssets';

const TEXTURED: TexturedModel = {
  path: 'assets/plush/sakura/bear.gen.glb',
  bytes: 1000,
  lods: [
    { mesh: 'LOD0', triangles: 41000, vertices: 36000 },
    { mesh: 'LOD1', triangles: 12000, vertices: 9000 },
    { mesh: 'LOD2', triangles: 4000, vertices: 3000 },
  ],
  attributes: ['POSITION', 'NORMAL', 'TEXCOORD_0', '_AUX'],
  textures: {
    '512': { size: 512, embedded: true, baseColor: '', normal: '', roughness: '', bytes: 60000 },
    '1k': { size: 1024, embedded: false, baseColor: 'a.webp', normal: 'b.webp', roughness: 'c.webp', bytes: 200000 },
    '2k': { size: 2048, embedded: false, baseColor: 'd.webp', normal: 'e.webp', roughness: 'f.webp', bytes: 900000 },
  },
};

function v3Manifest(): PlushManifest {
  return { version: 3, generator: 'tools/plush (procedural SDF modelling, v1)', assets: [fakeAsset('bear'), fakeAsset('chub')] };
}

describe('manifest versions', () => {
  it('reads a version 3 manifest (no textured models) without warnings and upgrades it to the current version', () => {
    const { manifest, warnings } = normalizeManifest(v3Manifest());
    expect(MANIFEST_VERSION).toBe(4);
    expect(warnings).toEqual([]);
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.assets.map((a) => a.id)).toEqual(['test.bear', 'test.chub']);
    expect(manifest.assets[0]!.model.textured).toBeUndefined();
  });

  it('reads the shipped manifest', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'assets', 'plush', 'manifest.json'), 'utf8')) as PlushManifest;
    const { manifest, warnings } = normalizeManifest(raw);
    expect(warnings).toEqual([]);
    expect(manifest.assets.length).toBe(raw.assets.length);
    for (const asset of manifest.assets) {
      if (!asset.model.textured) continue;
      // Every textured entry keeps the procedural model as its fallback and lists its LODs.
      expect(asset.model.path).toMatch(/\.glb$/);
      expect(asset.model.lods.length).toBeGreaterThan(0);
      expect(asset.model.textured.lods.length).toBeGreaterThan(0);
      expect(asset.source.method).toBe('ai-generated');
      expect(asset.source.design).toMatch(/^tools\/plush\/designs\//);
      expect(asset.source.license).toMatch(/Higgsfield/);
    }
  });

  it('round-trips a version 4 entry with a textured model through JSON', () => {
    const asset: PlushAsset = {
      ...fakeAsset('bear'),
      model: { path: 'assets/plush/sakura/bear.glb', bytes: 1, lods: [{ mesh: 'LOD0', triangles: 1, vertices: 3 }], attributes: ['COLOR_0'], textured: TEXTURED },
      source: { status: 'original', method: 'ai-generated', generator: 'Higgsfield', license: 'check terms', note: '', design: 'tools/plush/designs/sakura.ts#bear', jobs: { concept: 'c1', model: 'm1' } },
    };
    const json = JSON.parse(JSON.stringify({ version: 4, generator: 'x', assets: [asset] }));
    const { manifest, warnings } = normalizeManifest(json);
    expect(warnings).toEqual([]);
    expect(manifest.assets[0]).toEqual(asset);
  });

  it('warns about very old or newer versions but still reads them', () => {
    expect(normalizeManifest({ ...v3Manifest(), version: 2 }).warnings[0]).toMatch(/older/);
    const newer = normalizeManifest({ ...v3Manifest(), version: 99 });
    expect(newer.warnings[0]).toMatch(/newer/);
    expect(newer.manifest.assets.length).toBe(2);
  });

  it('drops an incomplete textured model (the procedural one stays) and skips broken entries', () => {
    const m = v3Manifest();
    (m.assets[0]!.model as { textured?: unknown }).textured = { path: 'x.glb', lods: [] };
    (m.assets as unknown[]).push({ id: 'broken' });
    const { manifest, warnings } = normalizeManifest(m);
    expect(manifest.assets.map((a) => a.id)).toEqual(['test.bear', 'test.chub']);
    expect(manifest.assets[0]!.model.textured).toBeUndefined();
    expect(warnings.some((w) => /Textured model of test\.bear/.test(w))).toBe(true);
    expect(warnings.some((w) => /broken/.test(w))).toBe(true);
  });

  it('rejects data that is not a manifest', () => {
    expect(() => normalizeManifest(null)).toThrow(/malformed/);
    expect(() => normalizeManifest({ version: 3 })).toThrow(/malformed/);
  });

  it('keeps an imported textured model and its provenance when the design is re-baked', () => {
    const before: PlushAsset = { ...fakeAsset('bear'), model: { ...fakeAsset('bear').model, textured: TEXTURED }, source: { status: 'original', method: 'ai-generated', generator: 'Higgsfield', license: 'check terms', note: 'old', design: 'd', jobs: { model: 'm1' }, rawSha256: 'abc' } };
    const baked: PlushAsset = { ...fakeAsset('bear'), source: { status: 'original-replaceable', method: 'procedural-sdf', generator: 'tools/plush/designs/sakura.ts#bear', license: 'Original', note: 'new note' } };
    const merged = carryGenerated(before, baked);
    expect(merged.model.textured).toEqual(TEXTURED);
    // The note stays the import's: it describes the drawn model and carries the importer version.
    expect(merged.source).toMatchObject({ method: 'ai-generated', jobs: { model: 'm1' }, rawSha256: 'abc', status: 'original-replaceable', note: 'old', design: 'tools/plush/designs/sakura.ts#bear' });
    // Nothing to carry: the baked entry is used as is.
    expect(carryGenerated(fakeAsset('bear'), baked)).toBe(baked);
  });
});

describe('texture variant choice', () => {
  const all = ['512', '1k', '2k'] as const;

  it('uses the same size when it exists and 2K for the 4K setting', () => {
    expect(pickTextureTier('512', all)).toBe('512');
    expect(pickTextureTier('1k', all)).toBe('1k');
    expect(pickTextureTier('2k', all)).toBe('2k');
    expect(pickTextureTier('4k', all)).toBe('2k');
  });

  it('otherwise picks the closest size, the smaller one on a tie', () => {
    expect(pickTextureTier('2k', ['512', '1k'])).toBe('1k');
    expect(pickTextureTier('512', ['1k', '2k'])).toBe('1k');
    expect(pickTextureTier('1k', ['512', '2k'])).toBe('512');
    expect(pickTextureTier('4k', ['512'])).toBe('512');
    expect(pickTextureTier('1k', [])).toBeNull();
  });
});
