import {
  BufferAttribute,
  BufferGeometry,
  ImageBitmapLoader,
  Matrix4,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  type Group,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ThemeId } from '../core/types';
import type { CustomModelEntry } from '../settings/spec';
import { normalizeManifest, pickTextureTier, TEXTURE_TIERS, type PlushAsset, type PlushManifest, type TextureSetting, type TextureTier } from './manifest';
import type { PlushTextureSet } from './PlushMaterial';

/** The textures a textured slot currently draws with. */
export interface TexturedState {
  tier: TextureTier;
  textures: PlushTextureSet;
}

export interface LoadedPlush {
  asset: PlushAsset;
  /** Geometry per LOD, most detailed first. Always at least one entry. */
  lods: BufferGeometry[];
  /** True when the model file could not be loaded and a stand-in shape is used. */
  fallback: boolean;
  /** Present when the player replaced this slot with an imported GLB: meshes in slot space. */
  custom?: Group;
  /**
   * Present when the slot draws its textured (e.g. AI-generated) model: `lods` are then that
   * model's meshes (POSITION, NORMAL, uv, `_aux`) and these are its textures.
   */
  textured?: TexturedState;
}

export interface PlushLibraryOptions {
  /** Loads a glTF file (tests inject a fake). */
  loadGltf?: (url: string) => Promise<{ scene: Object3D }>;
  /** Loads one image as a texture (tests inject a fake). `srgb` marks colour data. */
  loadTexture?: (url: string, srgb: boolean) => Promise<Texture>;
  /**
   * Draw the procedural models even where a textured one exists (comparison / debugging).
   * Defaults to the URL parameter `models=procedural`.
   */
  preferProcedural?: boolean;
}

const REQUIRED_ATTRIBUTES = ['position', 'normal', 'color', '_mask', '_surf', '_aux'];
const TEXTURED_REQUIRED_ATTRIBUTES = ['position', 'normal', 'uv', '_aux'];

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
  /**
   * Texture resolution wanted for textured models (the *Graphics → Textures* setting; the closest
   * available variant is used). Set by the renderer before loading; see `useTextures` to switch.
   */
  textureTier: TextureSetting = '1k';
  readonly preferProcedural: boolean;
  private readonly loader = new GLTFLoader();
  private readonly loadGltfFn: (url: string) => Promise<{ scene: Object3D }>;
  private readonly loadTextureFn: (url: string, srgb: boolean) => Promise<Texture>;
  /** Texture sets per asset id and tier (the embedded one included). */
  private readonly textureSets = new Map<string, Map<TextureTier, Promise<PlushTextureSet>>>();
  /** Tier of the latest `useTextures` request per slot (an older request that finishes later must not win). */
  private readonly wantedTier = new Map<string, TextureTier>();
  private readonly cache = new Map<string, Promise<LoadedPlush>>();
  private readonly loaded = new Map<string, LoadedPlush>();
  /** Problems found while loading (shown in diagnostics, never fatal). */
  readonly warnings: string[] = [];
  /** Informational notes (not problems). */
  readonly notes: string[] = [];
  private custom = new Map<string, CustomModelEntry>();
  /** Themes for which the "no characters, using a stand-in" warning was already given. */
  private readonly standInWarned = new Set<ThemeId>();

  constructor(
    private readonly baseUrl = import.meta.env?.BASE_URL ?? '/',
    options: PlushLibraryOptions = {},
  ) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.loadGltfFn = options.loadGltf ?? ((url) => this.loader.loadAsync(url));
    this.loadTextureFn = options.loadTexture ?? loadImageTexture;
    this.preferProcedural = options.preferProcedural ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).get('models') === 'procedural');
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  async loadManifest(): Promise<PlushManifest> {
    if (this.manifest) return this.manifest;
    const response = await fetch(this.url('assets/plush/manifest.json'), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Asset manifest failed to load (HTTP ${response.status})`);
    return this.setManifest(await response.json());
  }

  /** Uses an already parsed manifest (validated and upgraded from older versions). */
  setManifest(raw: unknown): PlushManifest {
    const { manifest, warnings } = normalizeManifest(raw);
    for (const warning of warnings) if (!this.warnings.includes(warning)) this.warnings.push(warning);
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
    if (asset.model.textured && !this.preferProcedural && !this.custom.has(asset.id)) {
      try {
        return await this.loadTextured(asset);
      } catch (error) {
        // Never an empty slot: the procedural model of the same character takes over.
        const message = `Generated model for ${asset.id} could not be loaded (${error instanceof Error ? error.message : String(error)}); showing the procedural model.`;
        this.warnings.push(message);
        console.warn(`[plush] ${message}`);
        this.textureSets.delete(asset.id);
      }
    }
    try {
      const gltf = await this.loadGltfFn(this.url(asset.model.path));
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
          // The built-in model is the textured one where the slot has it.
          if (asset.model.textured && !this.preferProcedural) {
            try {
              return await this.loadTextured(asset);
            } catch (texturedError) {
              const note = `Generated model for ${asset.id} could not be loaded (${texturedError instanceof Error ? texturedError.message : String(texturedError)}); showing the procedural model.`;
              this.warnings.push(note);
              console.warn(`[plush] ${note}`);
              this.textureSets.delete(asset.id);
            }
          }
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

  /* ------------------------------------------------------- textured models */

  /** Loads a slot's textured model: its LOD meshes, the embedded textures and the wanted texture tier. */
  private async loadTextured(asset: PlushAsset): Promise<LoadedPlush> {
    const info = asset.model.textured!;
    const gltf = await this.loadGltfFn(this.url(info.path));
    gltf.scene.updateMatrixWorld(true);
    const byName = new Map<string, Mesh>();
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) byName.set(mesh.name || mesh.parent?.name || '', mesh);
    });
    const lods: BufferGeometry[] = [];
    let material: MeshStandardMaterial | null = null;
    for (const lod of info.lods) {
      const mesh = byName.get(lod.mesh);
      if (!mesh) continue;
      const geometry = mesh.geometry;
      const missing = TEXTURED_REQUIRED_ATTRIBUTES.filter((name) => !geometry.getAttribute(name));
      if (missing.length > 0) throw new Error(`mesh ${lod.mesh} has no ${missing.join(', ')}`);
      if (!mesh.matrixWorld.equals(IDENTITY)) bakeTransform(geometry, mesh);
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      lods.push(geometry);
      material ??= (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
    }
    if (lods.length === 0) throw new Error('the file contains none of the LOD meshes listed in the manifest');
    if (!material?.map) throw new Error('the model has no base colour texture');
    let embedded: PlushTextureSet = {
      map: material.map,
      normalMap: material.normalMap ?? null,
      roughnessMap: material.roughnessMap ?? null,
      normalScale: material.normalScale?.clone() ?? new Vector2(1, -1),
    };
    material.dispose(); // the textures live on in `embedded`
    const embeddedTier = (TEXTURE_TIERS.find((t) => info.textures[t]?.embedded) ?? '512') as TextureTier;
    // Texture sets of an earlier load of this slot (one that an in-app import replaced; it may still
    // be drawn until the scene is rebuilt) are reused instead of loaded twice: disposing them here
    // would only make three.js upload them again, and that copy would never be freed. The fresh
    // embedded copies were never uploaded, so dropping them costs nothing.
    const sets = this.textureSets.get(asset.id) ?? new Map<TextureTier, Promise<PlushTextureSet>>();
    const earlier = sets.get(embeddedTier);
    if (earlier) embedded = await earlier;
    else sets.set(embeddedTier, Promise.resolve(embedded));
    this.textureSets.set(asset.id, sets);
    this.wantedTier.delete(asset.id);
    const entry: LoadedPlush = { asset, lods, fallback: false, textured: { tier: embeddedTier, textures: embedded } };
    const want = this.tierFor(asset, this.textureTier);
    if (want && want !== embeddedTier) {
      try {
        entry.textured = { tier: want, textures: await this.textureSet(asset, want) };
      } catch (error) {
        const message = `${want.toUpperCase()} textures for ${asset.id} could not be loaded (${error instanceof Error ? error.message : String(error)}); using the ${embeddedTier} ones.`;
        this.warnings.push(message);
        console.warn(`[plush] ${message}`);
      }
    }
    return entry;
  }

  /** The texture variant a setting maps to for one asset (null for assets without a textured model). */
  tierFor(asset: PlushAsset, setting: TextureSetting): TextureTier | null {
    const textures = asset.model.textured?.textures;
    if (!textures) return null;
    return pickTextureTier(setting, TEXTURE_TIERS.filter((t) => !!textures[t]));
  }

  /** Loads (once) the textures of one tier. */
  private textureSet(asset: PlushAsset, tier: TextureTier): Promise<PlushTextureSet> {
    let sets = this.textureSets.get(asset.id);
    if (!sets) this.textureSets.set(asset.id, (sets = new Map()));
    const cached = sets.get(tier);
    if (cached) return cached;
    const variant = asset.model.textured?.textures[tier];
    const pending: Promise<PlushTextureSet> = variant && !variant.embedded
      ? Promise.all([
          this.loadTextureFn(this.url(variant.baseColor), true),
          variant.normal ? this.loadTextureFn(this.url(variant.normal), false) : Promise.resolve(null),
          variant.roughness ? this.loadTextureFn(this.url(variant.roughness), false) : Promise.resolve(null),
        ]).then(([map, normalMap, roughnessMap]) => {
          const base = this.loaded.get(asset.id)?.textured?.textures;
          return { map, normalMap, roughnessMap, normalScale: base?.normalScale.clone() ?? new Vector2(1, -1) };
        })
      : Promise.reject(new Error(`no ${tier} textures listed`));
    // A failed tier may be retried later (e.g. after a network hiccup).
    pending.catch(() => {
      if (sets.get(tier) === pending) sets.delete(tier);
    });
    sets.set(tier, pending);
    return pending;
  }

  /**
   * Switches a loaded textured slot to the variant closest to `setting`. Resolves with the new
   * state (or the unchanged one when it already matches or the tier fails to load), or null for a
   * slot without a textured model. Other non-embedded tiers of the slot are released.
   */
  async useTextures(id: string, setting: TextureSetting): Promise<TexturedState | null> {
    const entry = this.loaded.get(id);
    if (!entry?.textured) return null;
    const tier = this.tierFor(entry.asset, setting);
    if (!tier) return entry.textured;
    // The latest request for a slot wins, whichever load finishes first.
    this.wantedTier.set(id, tier);
    if (tier === entry.textured.tier) return entry.textured;
    try {
      const pending = this.textureSet(entry.asset, tier);
      const textures = await pending;
      if (this.loaded.get(id) !== entry || !entry.textured) return null; // released meanwhile
      // Superseded by a newer request (another setting), or released by it while loading: keep
      // the current state; the newer request (or the next release) frees this set.
      if (this.wantedTier.get(id) !== tier || this.textureSets.get(id)?.get(tier) !== pending) return entry.textured;
      entry.textured = { tier, textures };
      this.releaseTextureTiers(id, tier);
      return entry.textured;
    } catch (error) {
      const message = `${tier.toUpperCase()} textures for ${id} could not be loaded (${error instanceof Error ? error.message : String(error)}); keeping the ${entry.textured.tier} ones.`;
      if (!this.warnings.includes(message)) this.warnings.push(message);
      console.warn(`[plush] ${message}`);
      return entry.textured;
    }
  }

  /** Frees the textures of every non-embedded tier of a slot except `keep`. */
  private releaseTextureTiers(id: string, keep: TextureTier | null): void {
    const sets = this.textureSets.get(id);
    const info = this.loaded.get(id)?.asset.model.textured;
    if (!sets) return;
    for (const [tier, pending] of sets) {
      if (tier === keep) continue;
      // The embedded set stays available as the fallback; only its GPU copy is freed (re-uploaded if used again).
      if (!(info?.textures[tier]?.embedded && keep !== null)) sets.delete(tier);
      void pending.then(disposeTextureSet, () => undefined);
    }
  }

  /** Frees GPU resources of every character that does not belong to `keep` (or to the theme it borrows characters from). */
  releaseExcept(keep: ThemeId): void {
    const source = this.assetTheme(keep);
    for (const [id, entry] of this.loaded) {
      if (entry.asset.theme === keep || entry.asset.theme === source) continue;
      this.release(id, entry);
    }
  }

  private release(id: string, entry: LoadedPlush): void {
    for (const geometry of entry.lods) geometry.dispose();
    if (entry.custom) disposeGroup(entry.custom);
    this.releaseTextureTiers(id, null);
    this.textureSets.delete(id);
    this.wantedTier.delete(id);
    this.loaded.delete(id);
    this.cache.delete(id);
  }

  dispose(): void {
    for (const [id, entry] of [...this.loaded]) this.release(id, entry);
    this.loaded.clear();
    this.cache.clear();
  }
}

const IDENTITY = new Matrix4();

/** Bakes a mesh's world transform into its geometry (quantised attributes become float). */
function bakeTransform(geometry: BufferGeometry, mesh: Mesh): void {
  for (const name of ['position', 'normal']) {
    const attr = geometry.getAttribute(name);
    if (!attr) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
  }
  geometry.applyMatrix4(mesh.matrixWorld);
}

function disposeTextureSet(set: PlushTextureSet): void {
  set.map.dispose();
  set.normalMap?.dispose();
  set.roughnessMap?.dispose();
}

/** Loads an image as a glTF-convention texture (no flip; colour data in sRGB). */
async function loadImageTexture(url: string, srgb: boolean): Promise<Texture> {
  let texture: Texture;
  if (typeof createImageBitmap !== 'undefined') {
    // Decoded off the main thread, like GLTFLoader does.
    const bitmap = await new ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none' }).loadAsync(url);
    texture = new Texture(bitmap);
  } else {
    texture = await new TextureLoader().loadAsync(url);
  }
  texture.flipY = false;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.name = url.slice(url.lastIndexOf('/') + 1);
  texture.needsUpdate = true;
  return texture;
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
