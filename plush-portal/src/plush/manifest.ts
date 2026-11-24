/**
 * Asset manifest types shared by the bake tool (Node), the physics layer and
 * the renderer. The manifest is the contract for replacing any character:
 * every path is project-local and every field is produced by `npm run assets:plush`.
 */
import type { Lang, Quat, ThemeId, Vec3 } from '../core/types';

/**
 * 4: optional `model.textured` (AI-generated textured model with LODs and texture variants) and
 *    `source.method: 'ai-generated'` with job ids. Version 3 files are read unchanged.
 */
export const MANIFEST_VERSION = 4;
/** Oldest manifest version the loader still understands (see `normalizeManifest`). */
export const MIN_MANIFEST_VERSION = 3;

export type ProxyGeometry =
  | { type: 'ball'; r: number }
  | { type: 'capsule'; halfHeight: number; r: number }
  | { type: 'cuboid'; hx: number; hy: number; hz: number; round: number }
  /** Convex hull, flat xyz list in the part's local frame. */
  | { type: 'hull'; points: number[] };

/** One rigid collision primitive. The compound of all proxies is the authoritative shape of a toy. */
export interface ProxyShape {
  /** Body part this proxy stands for, e.g. "body", "head", "earL". */
  part: string;
  /** Core parts carry weight when gripped; appendages (ears, tails, limbs) are weak handles. */
  role: 'core' | 'appendage';
  geometry: ProxyGeometry;
  pos: Vec3;
  rot: Quat;
  /** Share of the toy's mass (sums to 1 over all proxies). */
  massFraction: number;
}

/** A coloured applique / marking that is evaluated per pixel from a signed distance stored per vertex. */
export interface PaintRegion {
  name: string;
  /** Which component of the `_MASK` attribute holds this region's signed distance. */
  channel: 0 | 1 | 2 | 3;
  color: string;
  /** Embroidered stitch line along the border. */
  stitch: boolean;
  stitchColor?: string;
  /** Number of stitches around the border (derived from its perimeter). */
  stitches?: number;
  /** Local frame used to parameterise the stitches (centre + two tangent axes). */
  center: Vec3;
  axisU: Vec3;
  axisV: Vec3;
}

export interface LodInfo {
  /** Mesh name inside the GLB. */
  mesh: string;
  triangles: number;
  vertices: number;
}

export interface DeformInfo {
  /** Where the 0..1 softness lives (0 = firm core, 1 = floppy tip): first component of `_AUX`. */
  softAttribute: '_AUX.x';
  /** Typical radius of a finger dent at scale 1, metres. */
  dentRadius: number;
  /** How much the toy stretches when it hangs, 0..1. */
  sag: number;
  /** How strongly it squashes on impact, 0..1. */
  squash: number;
  /** How far soft appendages lag behind motion, 0..1. */
  sway: number;
  /** Named floppy parts (for documentation / tuning). */
  softParts: string[];
}

/** Texture resolutions an imported textured model can ship with. */
export const TEXTURE_TIERS = ['512', '1k', '2k'] as const;
export type TextureTier = (typeof TEXTURE_TIERS)[number];
/** Values of the *Graphics → Textures* setting. */
export type TextureSetting = TextureTier | '4k';
export const TEXTURE_TIER_SIZE: Record<TextureTier, number> = { '512': 512, '1k': 1024, '2k': 2048 };

/** One resolution of the three PBR textures of a textured model. */
export interface TextureVariant {
  /** Edge length in pixels (square textures). */
  size: number;
  /**
   * True when these textures are embedded in the model file itself (EXT_texture_webp); the
   * other variants are separate WebP files next to it.
   */
  embedded: boolean;
  /** sRGB base colour (WebP). Empty when embedded. */
  baseColor: string;
  /** Tangent-space normal map, OpenGL convention (WebP). Empty when embedded. */
  normal: string;
  /** glTF metallic-roughness layout: G = roughness, B = metalness (WebP; at most 1024², roughness varies slowly). Empty when embedded. */
  roughness: string;
  /** Bytes of the three images together. */
  bytes: number;
}

/** How a generated model was fitted to the character and how well it matches the collision proxies. */
export interface FitReport {
  /** Rotation about +Y applied to the raw model, degrees. */
  yawDeg: number;
  /** Uniform scale applied to the raw model (raw units → metres). */
  scale: number;
  /** Visual bounding box after fitting, metres. */
  bounds: { min: Vec3; max: Vec3 };
  /** Mean / 95th percentile distance between the generated and the procedural surface, metres. */
  shapeMean: number;
  shapeP95: number;
  /** Share of the surface that lies more than 1 cm outside the collision proxies (0..1). */
  outsideShare: number;
  /** 95th percentile / maximum distance outside the proxies, metres. */
  outsideP95: number;
  outsideMax: number;
  /** The same numbers for the procedural model, as a baseline (proxies always sit a little inside the fur). */
  baselineOutsideShare: number;
  baselineOutsideP95: number;
  /** 95th percentile / maximum distance of proxy points lying outside the visual surface (collisions with nothing visible), metres. */
  proxyGapP95: number;
  proxyGapMax: number;
  /**
   * `ok`; `check` (noticeably beyond the procedural model's fit); `mismatch` (the mesh sticks far
   * out of the proxies, or the proxies reach far beyond the mesh). Never corrected automatically.
   */
  verdict: 'ok' | 'check' | 'mismatch';
  /**
   * SHA-256 of the procedural model file the generated mesh was fitted to (its shape, softness
   * transfer and the proxies the verdict was measured against). When the design is re-baked with
   * a different shape this no longer matches and the import refits the model.
   */
  reference?: string;
}

/** A textured model (e.g. AI-generated) drawn instead of the procedural mesh; physics still uses the proxies. */
export interface TexturedModel {
  /** GLB with the LOD meshes and the smallest texture variant embedded. */
  path: string;
  bytes: number;
  /** Mesh names inside the GLB, most detailed first. */
  lods: LodInfo[];
  /** Vertex attributes present: POSITION, NORMAL, TEXCOORD_0 and `_AUX` (see docs/ASSETS.md). */
  attributes: string[];
  /** Available texture resolutions. */
  textures: Partial<Record<TextureTier, TextureVariant>>;
  fit?: FitReport;
}

export type AssetStatus =
  /** Original character designed for this project. */
  | 'original'
  /** Original character occupying a slot that is meant to be replaceable by a licensed model. */
  | 'original-replaceable'
  /** Third-party model the operator holds a licence for (the licence goes in `source.license`). */
  | 'licensed'
  /** Supplied by the user at runtime (never part of the shipped manifest). */
  | 'user-import';

export interface PlushAsset {
  /** Stable id: "<theme>.<slug>". */
  id: string;
  theme: ThemeId;
  slug: string;
  name: Record<Lang, string>;
  /** Short public description of the creature, used by UI and by the AI guide. */
  kind: Record<Lang, string>;
  /** Overall bounding size at scale 1, metres (width X, height Y, depth Z). */
  size: Vec3;
  /** Mass at scale 1 in kg. */
  mass: number;
  /** Radius of the footprint when sitting upright, metres. */
  footprint: number;
  /** Height of the centre of mass above the base, metres. */
  comHeight: number;
  /** Main colours (hex), most dominant first. */
  palette: string[];
  /** Surface types present on the model. */
  materials: string[];
  model: {
    /** Path relative to the site root, e.g. "assets/plush/sakura/bunny.glb". */
    path: string;
    bytes: number;
    lods: LodInfo[];
    /** Custom vertex attributes written by the bake tool. */
    attributes: string[];
    /**
     * Optional textured model shown instead of the procedural one above; the procedural model
     * stays as the fallback when this file cannot be used. Written by `npm run assets:import`.
     */
    textured?: TexturedModel;
  };
  paint: PaintRegion[];
  /** Distance in metres that maps to ±1 in the `_MASK` attribute. */
  maskRange: number;
  proxies: ProxyShape[];
  deform: DeformInfo;
  source: {
    status: AssetStatus;
    /** How the visible model was made. */
    method: 'procedural-sdf' | 'external' | 'ai-generated';
    generator: string;
    license: string;
    note: string;
    /** Procedural design that defines the collision proxies, mass and the fallback model. */
    design?: string;
    /** Generation job ids (AI-generated models). */
    jobs?: { concept?: string; model?: string };
    /** SHA-256 of the raw generated file the model was imported from. */
    rawSha256?: string;
    /** Quality check verdict recorded by the generation batch, if any. */
    qa?: string;
  };
}

export interface PlushManifest {
  version: number;
  generator: string;
  assets: PlushAsset[];
}

/**
 * Custom vertex attributes written by the bake tool (glTF names; Three.js lower-cases them):
 *   COLOR_0  linear RGB base colour, A = baked ambient occlusion
 *   _MASK    signed distance to paint regions 0..3, normalised to ±1 over `maskRange`
 *   _SURF    roughness, sheen, gloss (clear coat), fur length
 *   _AUX     softness, signed seam distance (0.5 = on a seam), metalness, thread amount
 */
export const PLUSH_ATTRIBUTES = ['COLOR_0', '_MASK', '_SURF', '_AUX'] as const;

export function assetsForTheme(manifest: PlushManifest, theme: ThemeId): PlushAsset[] {
  return manifest.assets.filter((asset) => asset.theme === theme);
}

/**
 * Vertex attributes of a textured model (glTF names; Three.js lower-cases the custom one):
 *   POSITION, NORMAL, TEXCOORD_0
 *   _AUX    softness (0 firm … 1 floppy), fur length, sheen, baked ambient occlusion
 */
export const TEXTURED_ATTRIBUTES = ['POSITION', 'NORMAL', 'TEXCOORD_0', '_AUX'] as const;

/**
 * Validates a parsed manifest and upgrades older versions in place of the caller. Version 3
 * (no textured models) is read as is; a newer version than this build knows is read too, with a
 * warning, as long as the fields it needs are there. Throws only for data that cannot be used.
 */
export function normalizeManifest(raw: unknown): { manifest: PlushManifest; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as PlushManifest).assets)) throw new Error('Asset manifest is malformed');
  const input = raw as PlushManifest;
  const version = typeof input.version === 'number' ? input.version : 0;
  if (version < MIN_MANIFEST_VERSION) {
    warnings.push(`Manifest version ${version} is older than ${MIN_MANIFEST_VERSION}; run "npm run assets:plush".`);
  } else if (version > MANIFEST_VERSION) {
    warnings.push(`Manifest version ${version} is newer than this build understands (${MANIFEST_VERSION}); unknown fields are ignored.`);
  }
  const assets: PlushAsset[] = [];
  for (const entry of input.assets) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.model || typeof entry.model.path !== 'string') {
      warnings.push(`Manifest entry ${String((entry as PlushAsset | null)?.id ?? '?')} is incomplete and was skipped.`);
      continue;
    }
    const model = { ...entry.model, lods: Array.isArray(entry.model.lods) ? entry.model.lods : [], attributes: Array.isArray(entry.model.attributes) ? entry.model.attributes : [] };
    const textured = model.textured;
    if (textured !== undefined) {
      const usable = textured && typeof textured.path === 'string' && Array.isArray(textured.lods) && textured.lods.length > 0 && textured.textures && typeof textured.textures === 'object';
      if (!usable) {
        warnings.push(`Textured model of ${entry.id} is incomplete in the manifest; using the procedural model.`);
        delete model.textured;
      }
    }
    assets.push({ ...entry, model, paint: Array.isArray(entry.paint) ? entry.paint : [], proxies: Array.isArray(entry.proxies) ? entry.proxies : [] });
  }
  return { manifest: { version: Math.max(version, MANIFEST_VERSION), generator: String(input.generator ?? ''), assets }, warnings };
}

/**
 * The texture variant to use for a *Textures* setting: the same size if it exists, otherwise the
 * closest one (a smaller one when two are equally close). 4K uses the largest available (2K).
 */
export function pickTextureTier(setting: TextureSetting, available: readonly TextureTier[]): TextureTier | null {
  if (available.length === 0) return null;
  const want = setting === '4k' ? 4096 : TEXTURE_TIER_SIZE[setting];
  let best: TextureTier | null = null;
  let bestScore = Infinity;
  for (const tier of TEXTURE_TIERS) {
    if (!available.includes(tier)) continue;
    // Distance in octaves; ties go to the smaller texture (iteration order is ascending).
    const score = Math.abs(Math.log2(TEXTURE_TIER_SIZE[tier] / want));
    if (score < bestScore - 1e-9) {
      best = tier;
      bestScore = score;
    }
  }
  return best;
}
