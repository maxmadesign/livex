/**
 * Asset manifest types shared by the bake tool (Node), the physics layer and
 * the renderer. The manifest is the contract for replacing any character:
 * every path is project-local and every field is produced by `npm run assets:plush`.
 */
import type { Lang, Quat, ThemeId, Vec3 } from '../core/types';

export const MANIFEST_VERSION = 3;

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
  };
  paint: PaintRegion[];
  /** Distance in metres that maps to ±1 in the `_MASK` attribute. */
  maskRange: number;
  proxies: ProxyShape[];
  deform: DeformInfo;
  source: {
    status: AssetStatus;
    /** How the asset was made. */
    method: 'procedural-sdf' | 'external';
    generator: string;
    license: string;
    note: string;
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
