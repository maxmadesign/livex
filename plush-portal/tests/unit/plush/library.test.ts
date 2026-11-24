import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector2, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PlushAsset, PlushManifest, TexturedModel } from '../../../src/plush/manifest';
import { PlushLibrary } from '../../../src/plush/PlushLibrary';
import { fakeAsset } from '../helpers/fakeAssets';

const TEXTURED: TexturedModel = {
  path: 'assets/plush/sakura/bear.gen.glb',
  bytes: 1,
  lods: [
    { mesh: 'LOD0', triangles: 1, vertices: 3 },
    { mesh: 'LOD1', triangles: 1, vertices: 3 },
  ],
  attributes: ['POSITION', 'NORMAL', 'TEXCOORD_0', '_AUX'],
  textures: {
    '512': { size: 512, embedded: true, baseColor: '', normal: '', roughness: '', bytes: 1 },
    '1k': { size: 1024, embedded: false, baseColor: 'assets/plush/sakura/bear.gen-1k.color.webp', normal: 'assets/plush/sakura/bear.gen-1k.normal.webp', roughness: 'assets/plush/sakura/bear.gen-1k.rough.webp', bytes: 1 },
    '2k': { size: 2048, embedded: false, baseColor: 'assets/plush/sakura/bear.gen-2k.color.webp', normal: 'assets/plush/sakura/bear.gen-2k.normal.webp', roughness: 'assets/plush/sakura/bear.gen-2k.rough.webp', bytes: 1 },
  },
};

function asset(textured = true): PlushAsset {
  const a = fakeAsset('bear');
  return { ...a, model: { path: 'assets/plush/sakura/bear.glb', bytes: 1, lods: [{ mesh: 'LOD0', triangles: 1, vertices: 3 }], attributes: ['COLOR_0', '_MASK', '_SURF', '_AUX'], ...(textured ? { textured: TEXTURED } : {}) } };
}

function geometry(attrs: string[]): BufferGeometry {
  const g = new BufferGeometry();
  const sizes: Record<string, number> = { position: 3, normal: 3, uv: 2, color: 4, _mask: 4, _surf: 4, _aux: 4 };
  for (const name of attrs) g.setAttribute(name, new BufferAttribute(new Float32Array(3 * sizes[name]!), sizes[name]!));
  g.setIndex([0, 1, 2]);
  return g;
}

/** A procedural plush scene (meshes with every plush attribute). */
function proceduralScene(): Object3D {
  const scene = new Group();
  const mesh = new Mesh(geometry(['position', 'normal', 'color', '_mask', '_surf', '_aux']), new MeshStandardMaterial());
  mesh.name = 'LOD0';
  scene.add(mesh);
  return scene;
}

/** A textured scene as GLTFLoader returns it for an imported model. */
function texturedScene(opts: { map?: boolean } = {}): Object3D {
  const scene = new Group();
  const material = new MeshStandardMaterial({ map: opts.map === false ? null : new Texture(), normalMap: new Texture(), roughnessMap: new Texture() });
  material.normalScale = new Vector2(1, -1);
  for (const name of ['LOD0', 'LOD1']) {
    const mesh = new Mesh(geometry(['position', 'normal', 'uv', '_aux']), material);
    mesh.name = name;
    scene.add(mesh);
  }
  return scene;
}

type Files = Record<string, () => Object3D>;

function library(files: Files, textures: (url: string, srgb: boolean) => Promise<Texture> = async () => new Texture(), preferProcedural = false) {
  const loadGltf = vi.fn(async (url: string) => {
    const make = files[url];
    if (!make) throw new Error(`404 ${url}`);
    return { scene: make() };
  });
  const loadTexture = vi.fn(textures);
  const lib = new PlushLibrary('/', { loadGltf, loadTexture, preferProcedural });
  return { lib, loadGltf, loadTexture };
}

function manifest(a: PlushAsset): PlushManifest {
  return { version: 4, generator: 'test', assets: [a] };
}

describe('PlushLibrary with textured models', () => {
  it('loads the textured model with the texture tier closest to the setting', async () => {
    const { lib, loadTexture } = library({ '/assets/plush/sakura/bear.gen.glb': () => texturedScene(), '/assets/plush/sakura/bear.glb': proceduralScene });
    lib.setManifest(manifest(asset()));
    lib.textureTier = '4k';
    const loaded = await lib.load(asset());
    expect(loaded.fallback).toBe(false);
    expect(loaded.lods).toHaveLength(2);
    expect(loaded.textured?.tier).toBe('2k');
    expect(loadTexture.mock.calls.map((c) => c[0])).toEqual([
      '/assets/plush/sakura/bear.gen-2k.color.webp',
      '/assets/plush/sakura/bear.gen-2k.normal.webp',
      '/assets/plush/sakura/bear.gen-2k.rough.webp',
    ]);
    expect(loadTexture.mock.calls.map((c) => c[1])).toEqual([true, false, false]);
    expect(lib.warnings).toEqual([]);
  });

  it('uses the embedded textures for the 512 setting without loading any image', async () => {
    const { lib, loadTexture } = library({ '/assets/plush/sakura/bear.gen.glb': () => texturedScene() });
    lib.textureTier = '512';
    const loaded = await lib.load(asset());
    expect(loaded.textured?.tier).toBe('512');
    expect(loaded.textured?.textures.normalScale.y).toBe(-1);
    expect(loadTexture).not.toHaveBeenCalled();
  });

  it('keeps the embedded textures with a warning when a larger tier fails, and switches tiers later', async () => {
    let fail = true;
    const { lib } = library({ '/assets/plush/sakura/bear.gen.glb': () => texturedScene() }, async (url) => {
      if (fail) throw new Error(`404 ${url}`);
      return new Texture();
    });
    lib.textureTier = '1k';
    const loaded = await lib.load(asset());
    expect(loaded.textured?.tier).toBe('512');
    expect(lib.warnings.some((w) => /1K textures for test\.bear could not be loaded/.test(w))).toBe(true);
    fail = false;
    const state = await lib.useTextures('test.bear', '2k');
    expect(state?.tier).toBe('2k');
    expect(lib.get('test.bear')?.textured?.tier).toBe('2k');
    // A slot without a textured model has nothing to switch.
    expect(await lib.useTextures('nope', '2k')).toBeNull();
  });

  it('lets the latest texture switch win when an older one finishes later, and frees the loser', async () => {
    const waiting = new Map<string, (t: Texture) => void>();
    const made: Texture[] = [];
    const { lib } = library({ '/assets/plush/sakura/bear.gen.glb': () => texturedScene() }, (url) => new Promise<Texture>((resolve) => waiting.set(url, resolve)));
    lib.textureTier = '512';
    await lib.load(asset());
    const finish = (tier: string) => {
      for (const [url, resolve] of waiting) {
        if (!url.includes(`-${tier}.`)) continue;
        const t = new Texture();
        t.dispose = vi.fn();
        made.push(t);
        resolve(t);
        waiting.delete(url);
      }
    };
    // 2K requested, then 1K; the 1K load finishes first, the 2K one last.
    const older = lib.useTextures('test.bear', '2k');
    const newer = lib.useTextures('test.bear', '1k');
    finish('1k');
    expect((await newer)?.tier).toBe('1k');
    const twoK = made.length;
    finish('2k');
    expect((await older)?.tier).toBe('1k');
    expect(lib.get('test.bear')?.textured?.tier).toBe('1k');
    await Promise.resolve();
    // The 2K set that lost is freed; the 1K set in use is not.
    expect(made.slice(twoK).every((t) => (t.dispose as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(made.slice(0, twoK).every((t) => (t.dispose as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
    // Back to the embedded set while a 2K load is still pending: the embedded set stays.
    const pending2k = lib.useTextures('test.bear', '2k');
    expect((await lib.useTextures('test.bear', '512'))?.tier).toBe('512');
    finish('2k');
    expect((await pending2k)?.tier).toBe('512');
    expect(lib.get('test.bear')?.textured?.tier).toBe('512');
  });

  it('falls back to the procedural model with a warning when the generated file is missing or broken', async () => {
    const cases: Files[] = [
      { '/assets/plush/sakura/bear.glb': proceduralScene },
      { '/assets/plush/sakura/bear.glb': proceduralScene, '/assets/plush/sakura/bear.gen.glb': () => texturedScene({ map: false }) },
      { '/assets/plush/sakura/bear.glb': proceduralScene, '/assets/plush/sakura/bear.gen.glb': proceduralScene },
    ];
    for (const files of cases) {
      const { lib } = library(files);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loaded = await lib.load(asset());
      warn.mockRestore();
      expect(loaded.fallback).toBe(false);
      expect(loaded.textured).toBeUndefined();
      expect(loaded.lods[0]!.getAttribute('_mask')).toBeDefined();
      expect(lib.warnings).toHaveLength(1);
      expect(lib.warnings[0]).toMatch(/Generated model for test\.bear could not be loaded .*showing the procedural model/);
    }
  });

  it('never leaves the slot empty: a stand-in when neither model loads', async () => {
    const { lib } = library({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loaded = await lib.load(asset());
    warn.mockRestore();
    expect(loaded.fallback).toBe(true);
    expect(loaded.lods).toHaveLength(1);
    expect(loaded.lods[0]!.getAttribute('_aux')).toBeDefined();
    expect(lib.warnings).toHaveLength(2);
  });

  it('draws the procedural model when asked to (comparison) or for entries without a textured model', async () => {
    const files = { '/assets/plush/sakura/bear.glb': proceduralScene, '/assets/plush/sakura/bear.gen.glb': () => texturedScene() };
    const preferred = library(files, undefined, true);
    expect((await preferred.lib.load(asset())).textured).toBeUndefined();
    expect(preferred.loadGltf).toHaveBeenCalledTimes(1);
    const plain = library(files);
    expect((await plain.lib.load(asset(false))).textured).toBeUndefined();
  });

  it('keeps the textured model when an in-app import of the slot cannot be used', async () => {
    const files = { '/assets/plush/sakura/bear.glb': proceduralScene, '/assets/plush/sakura/bear.gen.glb': () => texturedScene() };
    const { lib } = library(files);
    lib.textureTier = '512';
    // No IndexedDB in the test environment: the stored file cannot be read (a broken import).
    lib.setCustomModels([{ slotId: 'test.bear', fileKey: 'k', fileName: 'x.glb', displayName: 'x', scale: 1, yawDeg: 0, bytes: 1 }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loaded = await lib.load(asset());
    warn.mockRestore();
    expect(loaded.custom).toBeUndefined();
    expect(loaded.textured?.tier).toBe('512');
    expect(lib.warnings).toHaveLength(1);
    expect(lib.warnings[0]).toMatch(/Imported model for test\.bear could not be used/);
  });

  it('reuses the texture sets of an earlier load of the slot (they may still be drawn) instead of loading them again', async () => {
    const files = { '/assets/plush/sakura/bear.glb': proceduralScene, '/assets/plush/sakura/bear.gen.glb': () => texturedScene() };
    const { lib, loadTexture } = library(files);
    lib.textureTier = '1k';
    const first = await lib.load(asset());
    expect(loadTexture).toHaveBeenCalledTimes(3);
    const map = first.textured!.textures.map;
    map.dispose = vi.fn();
    // An in-app import replaces the slot (here: one that cannot be read), then it is removed again.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    lib.setCustomModels([{ slotId: 'test.bear', fileKey: 'k', fileName: 'x.glb', displayName: 'x', scale: 1, yawDeg: 0, bytes: 1 }]);
    const second = await lib.load(asset());
    lib.setCustomModels([]);
    const third = await lib.load(asset());
    warn.mockRestore();
    expect(second.textured?.textures.map).toBe(map);
    expect(third.textured?.textures.map).toBe(map);
    expect(third.textured?.tier).toBe('1k');
    expect(loadTexture).toHaveBeenCalledTimes(3);
    expect(map.dispose).not.toHaveBeenCalled();
  });

  it('upgrades an older manifest on load', () => {
    const { lib } = library({});
    const m = lib.setManifest({ version: 3, generator: 'old', assets: [asset(false)] });
    expect(m.version).toBe(4);
    expect(lib.warnings).toEqual([]);
  });
});
