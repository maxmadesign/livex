import { BufferGeometry, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ThemeId } from '../core/types';
import { MANIFEST_VERSION, type PlushAsset, type PlushManifest } from './manifest';

export interface LoadedPlush {
  asset: PlushAsset;
  /** Geometry per LOD, most detailed first. Always at least one entry. */
  lods: BufferGeometry[];
  /** True when the model file could not be loaded and a stand-in shape is used. */
  fallback: boolean;
}

const REQUIRED_ATTRIBUTES = ['position', 'normal', 'color', '_mask', '_surf', '_aux'];

/**
 * Loads the asset manifest and the character models. Models are cached per
 * asset id and released per theme, so switching themes does not grow memory.
 */
export class PlushLibrary {
  manifest: PlushManifest | null = null;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedPlush>>();
  private readonly loaded = new Map<string, LoadedPlush>();
  /** Problems found while loading (shown in diagnostics, never fatal). */
  readonly warnings: string[] = [];

  constructor(private readonly baseUrl = import.meta.env?.BASE_URL ?? '/') {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  async loadManifest(): Promise<PlushManifest> {
    if (this.manifest) return this.manifest;
    const response = await fetch(this.url('assets/plush/manifest.json'), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Asset manifest failed to load (HTTP ${response.status})`);
    const manifest = (await response.json()) as PlushManifest;
    if (!manifest || !Array.isArray(manifest.assets)) throw new Error('Asset manifest is malformed');
    if (manifest.version !== MANIFEST_VERSION) {
      this.warnings.push(`Manifest version ${manifest.version} differs from the expected ${MANIFEST_VERSION}; run "npm run assets:plush".`);
    }
    this.manifest = manifest;
    return manifest;
  }

  assets(theme?: ThemeId): PlushAsset[] {
    const all = this.manifest?.assets ?? [];
    return theme ? all.filter((a) => a.theme === theme) : all;
  }

  get(id: string): LoadedPlush | undefined {
    return this.loaded.get(id);
  }

  /** Loads one character (cached). Never rejects: a missing model becomes a clearly flagged stand-in. */
  load(asset: PlushAsset): Promise<LoadedPlush> {
    let pending = this.cache.get(asset.id);
    if (!pending) {
      pending = this.loadModel(asset).then((entry) => {
        this.loaded.set(asset.id, entry);
        return entry;
      });
      this.cache.set(asset.id, pending);
    }
    return pending;
  }

  async loadTheme(theme: ThemeId, onProgress?: (done: number, total: number) => void): Promise<LoadedPlush[]> {
    const list = this.assets(theme);
    let done = 0;
    return Promise.all(
      list.map((asset) =>
        this.load(asset).then((entry) => {
          onProgress?.(++done, list.length);
          return entry;
        }),
      ),
    );
  }

  private async loadModel(asset: PlushAsset): Promise<LoadedPlush> {
    try {
      const gltf = await this.loader.loadAsync(this.url(asset.model.path));
      const byName = new Map<string, BufferGeometry>();
      gltf.scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        const name = mesh.name || mesh.parent?.name || '';
        byName.set(name, mesh.geometry);
      });
      const lods: BufferGeometry[] = [];
      for (const lod of asset.model.lods) {
        const geometry = byName.get(lod.mesh);
        if (!geometry) continue;
        for (const name of REQUIRED_ATTRIBUTES) {
          if (!geometry.getAttribute(name)) throw new Error(`"${lod.mesh}" is missing the ${name} attribute`);
        }
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        lods.push(geometry);
      }
      if (lods.length === 0) throw new Error('no LOD meshes found');
      return { asset, lods, fallback: false };
    } catch (error) {
      const message = `Model for ${asset.id} could not be loaded (${error instanceof Error ? error.message : String(error)}); using a stand-in.`;
      this.warnings.push(message);
      console.warn(`[plush] ${message}`);
      const { createFallbackGeometry } = await import('./fallbackGeometry');
      return { asset, lods: [createFallbackGeometry(asset)], fallback: true };
    }
  }

  /** Frees GPU resources of every character that does not belong to `keep`. */
  releaseExcept(keep: ThemeId): void {
    for (const [id, entry] of this.loaded) {
      if (entry.asset.theme === keep) continue;
      for (const geometry of entry.lods) geometry.dispose();
      this.loaded.delete(id);
      this.cache.delete(id);
    }
  }

  dispose(): void {
    for (const entry of this.loaded.values()) for (const geometry of entry.lods) geometry.dispose();
    this.loaded.clear();
    this.cache.clear();
  }
}
