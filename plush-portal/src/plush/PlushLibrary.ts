import { BufferGeometry, Mesh, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ThemeId } from '../core/types';
import type { CustomModelEntry } from '../settings/spec';
import { MANIFEST_VERSION, type PlushAsset, type PlushManifest } from './manifest';

export interface LoadedPlush {
  asset: PlushAsset;
  /** Geometry per LOD, most detailed first. Always at least one entry. */
  lods: BufferGeometry[];
  /** True when the model file could not be loaded and a stand-in shape is used. */
  fallback: boolean;
  /** Present when the player replaced this slot with an imported GLB: meshes in slot space. */
  custom?: Group;
}

const REQUIRED_ATTRIBUTES = ['position', 'normal', 'color', '_mask', '_surf', '_aux'];

/**
 * Preferred stand-in for a theme that has no characters in the manifest yet (a new theme
 * before its assets are baked). Without an entry the first theme in the manifest is used.
 */
const STAND_IN_THEME: Partial<Record<ThemeId, ThemeId>> = { gpu: 'cosmic' };

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
  /** Informational notes (not problems). */
  readonly notes: string[] = [];
  private custom = new Map<string, CustomModelEntry>();
  /** Themes for which the "no characters, using a stand-in" warning was already given. */
  private readonly standInWarned = new Set<ThemeId>();

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

  /**
   * Sets the locally imported replacement models. Slots whose entry changed are
   * dropped from the cache so the next load picks the new model up.
   */
  setCustomModels(entries: readonly CustomModelEntry[]): void {
    const next = new Map(entries.map((e) => [e.slotId, e]));
    for (const id of new Set([...this.custom.keys(), ...next.keys()])) {
      const a = this.custom.get(id);
      const b = next.get(id);
      if (a?.fileKey === b?.fileKey && a?.scale === b?.scale && a?.yawDeg === b?.yawDeg) continue;
      const loaded = this.loaded.get(id);
      if (loaded?.custom) disposeGroup(loaded.custom);
      this.loaded.delete(id);
      this.cache.delete(id);
    }
    this.custom = next;
  }

  customEntry(id: string): CustomModelEntry | undefined {
    return this.custom.get(id);
  }

  /**
   * The characters of a theme, or every character without a theme. A theme that has no
   * characters in the manifest yet borrows another theme's (see `assetTheme`) so the
   * machine is never empty.
   */
  assets(theme?: ThemeId): PlushAsset[] {
    const all = this.manifest?.assets ?? [];
    if (!theme) return all;
    const source = this.assetTheme(theme);
    return all.filter((a) => a.theme === source);
  }

  /**
   * Theme whose characters `theme` really uses: itself when the manifest has characters for it,
   * otherwise a stand-in (logged once per theme). Without a manifest the theme itself.
   */
  assetTheme(theme: ThemeId): ThemeId {
    const all = this.manifest?.assets ?? [];
    if (all.length === 0 || all.some((a) => a.theme === theme)) return theme;
    const preferred = STAND_IN_THEME[theme];
    const source = preferred && all.some((a) => a.theme === preferred) ? preferred : all[0]!.theme;
    if (!this.standInWarned.has(theme)) {
      this.standInWarned.add(theme);
      const message = `Theme "${theme}" has no characters in the manifest yet; showing the "${source}" characters instead.`;
      this.warnings.push(message);
      console.warn(`[plush] ${message}`);
    }
    return source;
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
      let plushReady = true;
      for (const lod of asset.model.lods) {
        const geometry = byName.get(lod.mesh);
        if (!geometry) continue;
        if (REQUIRED_ATTRIBUTES.some((name) => !geometry.getAttribute(name))) {
          plushReady = false;
          break;
        }
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        lods.push(geometry);
      }
      const standard = !plushReady || lods.length === 0;
      if (standard && byName.size === 0) throw new Error('the file contains no meshes');
      const { createFallbackGeometry } = standard ? await import('./fallbackGeometry') : { createFallbackGeometry: null };
      // A standard model has no baked LOD meshes: the slot's stand-in geometry only feeds bounds.
      const slotLods = standard && createFallbackGeometry ? [createFallbackGeometry(asset)] : lods;
      const entry = this.custom.get(asset.id);
      if (entry) {
        // A broken import never removes the character: the built-in model stays in use.
        try {
          const { buildCustomTemplate, loadModelFile } = await import('./customModels');
          const data = await loadModelFile(entry.fileKey);
          if (!data) throw new Error('the stored file is missing');
          return { asset, lods: slotLods, fallback: false, custom: await buildCustomTemplate(data, asset, entry) };
        } catch (error) {
          const message = `Imported model for ${asset.id} could not be used (${error instanceof Error ? error.message : String(error)}); showing the built-in model.`;
          this.warnings.push(message);
          console.warn(`[plush] ${message}`);
        }
      }
      if (standard) {
        // An ordinary glTF model referenced from the manifest (for example a licensed character
        // dropped into a slot): it keeps its own materials and textures and still gets the
        // soft-body deformation; the slot's collision proxy, mass and names come from the manifest.
        const { templateFromScene } = await import('./customModels');
        const note = `${asset.id} uses a standard glTF model without plush attributes: rendered with its own materials.`;
        if (!this.notes.includes(note)) this.notes.push(note);
        return { asset, lods: slotLods, fallback: false, custom: templateFromScene(gltf.scene, asset, { scale: 1, yawDeg: 0 }) };
      }
      return { asset, lods, fallback: false };
    } catch (error) {
      const message = `Model for ${asset.id} could not be loaded (${error instanceof Error ? error.message : String(error)}); using a stand-in.`;
      this.warnings.push(message);
      console.warn(`[plush] ${message}`);
      const { createFallbackGeometry } = await import('./fallbackGeometry');
      return { asset, lods: [createFallbackGeometry(asset)], fallback: true };
    }
  }

  /** Frees GPU resources of every character that does not belong to `keep` (or to the theme it borrows characters from). */
  releaseExcept(keep: ThemeId): void {
    const source = this.assetTheme(keep);
    for (const [id, entry] of this.loaded) {
      if (entry.asset.theme === keep || entry.asset.theme === source) continue;
      for (const geometry of entry.lods) geometry.dispose();
      if (entry.custom) disposeGroup(entry.custom);
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

function disposeGroup(group: Group): void {
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value && (value as { isTexture?: boolean }).isTexture) (value as { dispose(): void }).dispose();
      material.dispose();
    }
  });
}
