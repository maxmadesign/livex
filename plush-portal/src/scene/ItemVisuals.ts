/**
 * Draws the machine items (docs/design/machines.md, section 5.2): printed boxes, snack boxes, gems
 * and coins. Items are ordinary physics bodies (`ToyBody.item`); this follows their interpolated
 * poses exactly as ToyVisuals does for plush (prevPos / pos lerp, prevRot / rot slerp).
 *
 *  - The bridge box is one mesh with its own print (BoxPrint). On Medium and better it is a window
 *    box: a clear front panel with the printed character inside (its coarsest LOD, render-only);
 *    Safe shows the print only.
 *  - Snack boxes are one InstancedMesh per look; a per-instance `aCell` attribute picks the
 *    character's cell in the theme's print atlas.
 *  - Gems are one InstancedMesh per look: a faceted brilliant (the same 17 points as the physics
 *    hull), flat shaded, clearcoated, with tinted reflections and a faint inner glow; no
 *    transmission (it would cost a scene pass).
 *  - Coins are one InstancedMesh of 12-sided discs.
 *
 * Every item casts shadows and joins the contact-shadow pass (the contact height material already
 * handles instancing). ToyVisuals hosts this inside its own group, so the stage treats items like
 * toys: contact shadows, viewer-light casters, warm-up. Presentation only.
 */
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemLook, ItemSpec } from './../physics/items';
import type { ToyBody } from '../physics/PhysicsWorld';
import type { PlushLibrary } from '../plush/PlushLibrary';
import { PlushMaterial, applyPaint, createPlushUniforms } from '../plush/PlushMaterial';
import type { PlushAsset, TextureSetting } from '../plush/manifest';
import { THEMES } from '../themes/themes';
import type { ThemeDef } from '../themes/themes';
import { itemColors, type GemLook, type ItemColors } from './machines/itemLooks';
import { atlasPrint, atlasSize, BOX_LAYOUT, BoxPrint, PrintAtlas, type BoxFace, type CanvasFactory, type ImageLoader } from './machines/printAtlas';

export interface ItemQuality {
  /** Graphics → Textures: atlas size; '512' (Safe) also drops the bridge box's window. */
  textures?: TextureSetting;
  /** Model detail (bevels of the bridge box). */
  lod?: 'low' | 'medium' | 'high';
}

/** Default display font for printed names (the game's display stack). */
export const ITEM_FONT = '"Fredoka Variable", "ZCOOL KuaiLe", "M PLUS Rounded 1c", system-ui, sans-serif';

/** Triangles of one gem (table 6 + crown 16 + pavilion 8). */
export const GEM_TRIANGLES = 30;
/** Segments of a coin. */
export const COIN_SEGMENTS = 12;

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Faceted brilliant of unit girdle radius, origin at the girdle centre, matching the physics hull
 * (src/physics/items.ts gemItem): table octagon at 0.32 (radius 0.56, turned half a step), girdle
 * octagon at 0, culet at −0.86. Non-indexed with face normals (flat shading).
 */
export function gemGeometry(): BufferGeometry {
  const crown = 0.32, pavilion = 0.86, table = 0.56;
  const girdle: [number, number, number][] = [];
  const top: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    girdle.push([Math.cos(a), 0, Math.sin(a)]);
    const b = ((i + 0.5) / 8) * Math.PI * 2;
    top.push([Math.cos(b) * table, crown, Math.sin(b) * table]);
  }
  const culet: [number, number, number] = [0, -pavilion, 0];
  const tris: [number, number, number][][] = [];
  // Table: a fan over the octagon (counter-clockwise seen from above).
  for (let i = 1; i < 7; i++) tris.push([top[0]!, top[i + 1]!, top[i]!]);
  // Crown: a kite between each girdle edge and the table, split into two triangles.
  for (let i = 0; i < 8; i++) {
    const g0 = girdle[i]!, g1 = girdle[(i + 1) % 8]!, t0 = top[i]!, tPrev = top[(i + 7) % 8]!;
    tris.push([g0, t0, g1]);
    tris.push([g0, tPrev, t0]);
  }
  // Pavilion: down to the culet.
  for (let i = 0; i < 8; i++) tris.push([girdle[i]!, girdle[(i + 1) % 8]!, culet]);
  const pos: number[] = [];
  for (const t of tris) for (const v of t) pos.push(v[0], v[1], v[2]);
  // Every triangle above is wound counter-clockwise seen from outside (tests/unit/scene/itemVisuals.test.ts).
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A coin of radius r and thickness h, centred on its origin, lying flat. */
export function coinGeometry(r: number, h: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, COIN_SEGMENTS, 1, false);
  g.computeBoundingSphere();
  return g;
}

/** A snack box of the given size, origin at the middle of its bottom face. */
export function snackGeometry(size: readonly [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2]);
  g.translate(0, size[1] / 2, 0);
  return g;
}

/**
 * The bridge box: a rounded box (origin at the middle of its bottom face) whose UVs map each face
 * into its cell of the box print (BOX_LAYOUT). Faces read correctly from outside: the front (+z) and
 * the top from the player's side, the back from behind, the sides from their own side.
 */
export function boxGeometry(size: readonly [number, number, number], segments: number, radius: number): BufferGeometry {
  const [L, H, W] = size;
  const r = Math.max(0, Math.min(radius, L / 2 - 1e-4, H / 2 - 1e-4, W / 2 - 1e-4));
  const g = r > 1e-4 ? new RoundedBoxGeometry(L, H, W, segments, r) : new BoxGeometry(L, H, W);
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let face: BoxFace, s: number, t: number;
    if (az >= ax && az >= ay) {
      face = nz > 0 ? 'front' : 'back';
      s = nz > 0 ? (x + L / 2) / L : (L / 2 - x) / L;
      t = (y + H / 2) / H;
    } else if (ax >= ay) {
      face = nx > 0 ? 'right' : 'left';
      s = nx > 0 ? (W / 2 - z) / W : (z + W / 2) / W;
      t = (y + H / 2) / H;
    } else {
      face = ny > 0 ? 'top' : 'bottom';
      s = (x + L / 2) / L;
      t = ny > 0 ? (W / 2 - z) / W : (z + W / 2) / W;
    }
    const [cx, cy, cw, ch] = BOX_LAYOUT[face];
    const cs = Math.min(1, Math.max(0, s)), ct = Math.min(1, Math.max(0, t));
    // Canvas rows grow downwards, v upwards.
    uv.setXY(i, cx + cs * cw, 1 - (cy + (1 - ct) * ch));
  }
  g.translate(0, H / 2, 0);
  return g;
}

type Family = 'box' | 'snack' | 'gem' | 'coin';

function familyOf(spec: ItemSpec): Family {
  return spec.kind === 'box' ? 'box' : spec.kind;
}

/** One item drawn as an instance (snack, gem, coin) or as its own mesh (the bridge box). */
interface ItemEntry {
  toy: ToyBody;
  spec: ItemSpec;
  family: Family;
  /** Instanced: which batch and slot. */
  batch: Batch | null;
  slot: number;
  /** The bridge box: its own meshes. */
  box: BoxVisual | null;
  /** Interpolated world position (positionOf). */
  pos: Vector3;
  /** Scale-in animation of refills (0..1). */
  appear: number;
  /** Pose the contact map last saw. */
  seen: Float64Array;
}

interface Batch {
  key: string;
  mesh: InstancedMesh;
  entries: ItemEntry[];
  /** Uniform scale per instance (gems: the girdle radius; others 1). */
  scale: number;
  cell: InstancedBufferAttribute | null;
}

interface BoxVisual {
  root: Group;
  outer: Mesh;
  inner: Mesh | null;
  film: Mesh | null;
  plush: Mesh | null;
  print: BoxPrint;
  materials: Material[];
}

/**
 * The gems' "fire": each flat facet gets a view-dependent glint (a hash of its normal sets its phase),
 * so facets light up and go dark in turn as the eye or the gem moves (head tracking, peeking, a gem
 * rolling), coloured by the gem; the brightest are white and reach the bloom. A few ALU operations
 * per pixel instead of a transmission pass.
 */
export const GEM_FIRE_GLSL = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 gemView = normalize( vViewPosition );
  float gemFacet = fract( sin( dot( floor( normal * 9.0 + 0.5 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  float gemFire = pow( 0.5 + 0.5 * sin( dot( normal, gemView ) * 16.0 + gemFacet * 6.2831 ), 8.0 );
  totalEmissiveRadiance += uGemFire * gemFire * ( diffuseColor.rgb * 0.8 + step( 0.82, gemFacet ) * vec3( 1.6 ) );
}
`;

function gemMaterial(m: MeshPhysicalMaterial, fire: number): void {
  const uniforms = { uGemFire: { value: fire } };
  m.userData.gemFire = uniforms.uGemFire;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGemFire;')
      .replace('#include <emissivemap_fragment>', GEM_FIRE_GLSL);
  };
  m.customProgramCacheKey = () => 'item-gem';
}

/** Shader patch: the per-instance atlas cell offsets the map UVs of the snack boxes. */
function cellMaterial(m: MeshPhysicalMaterial | MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = aCell.xy + vMapUv * aCell.zw;\n#endif');
  };
  m.customProgramCacheKey = () => 'item-cell';
}

export class ItemVisuals {
  readonly group = new Group();
  /** Main-pass triangles of the items in the last frame (diagnostics). */
  triangles = 0;
  /** Bumped whenever an item moved, came or went (the contact map and viewer light redraw then). */
  changed = 0;
  private readonly entries = new Map<string, ItemEntry>();
  private readonly batches = new Map<string, Batch>();
  private quality: ItemQuality;
  private theme: ThemeDef | null = null;
  private colors: ItemColors | null = null;
  private atlas: PrintAtlas | null = null;
  private thumbnails: Readonly<Record<string, string>> = {};
  private snackMaterial: MeshPhysicalMaterial | null = null;
  private readonly gemMaterials = new Map<GemLook, MeshPhysicalMaterial>();
  private coinMaterial: MeshStandardMaterial | null = null;
  private filmMaterial: MeshPhysicalMaterial | null = null;
  private gemBase: BufferGeometry | null = null;

  constructor(
    private readonly library: PlushLibrary,
    quality: ItemQuality = {},
    private readonly font = ITEM_FONT,
    private readonly io: { loadImage?: ImageLoader; makeCanvas?: CanvasFactory } = {},
  ) {
    this.group.name = 'items';
    this.quality = { ...quality };
  }

  /* ------------------------------------------------------------ theme and materials */

  /** The theme comes with the items (an item asset carries its theme); a new theme rebuilds the looks. */
  useTheme(theme: ThemeDef): void {
    if (this.theme === theme) return;
    this.clear();
    this.disposeLooks();
    this.theme = theme;
    this.colors = itemColors(theme);
  }

  private get windowBox(): boolean {
    return this.quality.textures !== '512';
  }

  private ensureAtlas(): PrintAtlas {
    if (this.atlas) return this.atlas;
    const theme = this.theme!;
    const prints = this.library.assets(theme.id).map((a) => atlasPrint(a));
    this.atlas = new PrintAtlas(theme, prints, atlasSize(this.quality.textures), this.font, this.io.loadImage, this.io.makeCanvas);
    void this.atlas.setThumbnails(this.thumbnails);
    return this.atlas;
  }

  private snackMat(): MeshPhysicalMaterial {
    if (this.snackMaterial) return this.snackMaterial;
    const m = new MeshPhysicalMaterial({ map: this.ensureAtlas().texture, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 0.7 });
    cellMaterial(m);
    this.snackMaterial = m;
    return m;
  }

  private gemMat(look: GemLook): MeshPhysicalMaterial {
    let m = this.gemMaterials.get(look);
    if (m) return m;
    const c = this.colors!.gems[look];
    const diamond = look === 'gemDiamond';
    m = new MeshPhysicalMaterial({
      // A darker body than the colour itself: the facets' glints and reflections carry the brightness.
      color: new Color(c.color).multiplyScalar(diamond ? 0.85 : 0.7),
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      ior: diamond ? 2.4 : 1.77,
      specularIntensity: 1,
      specularColor: new Color(c.specular),
      envMapIntensity: diamond ? 3 : 2.6,
      emissive: new Color(c.glow),
      emissiveIntensity: diamond ? 0.05 : 0.12,
      flatShading: true,
      iridescence: diamond && this.colors!.iridescence ? 0.55 : 0,
      iridescenceIOR: 1.6,
    });
    gemMaterial(m, diamond ? 0.9 : 0.75);
    this.gemMaterials.set(look, m);
    return m;
  }

  private coinMat(): MeshStandardMaterial {
    if (this.coinMaterial) return this.coinMaterial;
    this.coinMaterial = new MeshStandardMaterial({ color: this.colors!.coin.color, roughness: 0.28, metalness: 1, envMapIntensity: 1.4 });
    return this.coinMaterial;
  }

  private filmMat(): MeshPhysicalMaterial {
    if (this.filmMaterial) return this.filmMaterial;
    this.filmMaterial = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.05 });
    return this.filmMaterial;
  }

  /* ------------------------------------------------------------ sync */

  /**
   * Creates visuals for new items and removes those of items that no longer exist (toys without
   * `item` are ignored). `animateNew`: new items grow in instead of popping (refills during play).
   */
  sync(toys: Iterable<ToyBody>, animateNew = false): void {
    const items: ToyBody[] = [];
    for (const toy of toys) if (toy.item) items.push(toy);
    // Items carry their theme (itemAsset): a new theme rebuilds the looks.
    const theme = items[0] ? THEMES[items[0].asset.theme as keyof typeof THEMES] : undefined;
    if (theme && theme !== this.theme) this.useTheme(theme);
    const alive = new Set<string>();
    const fresh: ToyBody[] = [];
    for (const toy of items) {
      alive.add(toy.id);
      if (!this.entries.has(toy.id)) fresh.push(toy);
    }
    let rebuild = false;
    for (const [id, e] of this.entries) {
      if (alive.has(id)) continue;
      this.entries.delete(id);
      if (e.box) this.destroyBox(e.box);
      else rebuild = true;
      this.changed++;
    }
    for (const toy of fresh) {
      const spec = toy.item!;
      const family = familyOf(spec);
      const e: ItemEntry = { toy, spec, family, batch: null, slot: -1, box: null, pos: new Vector3(toy.pose.pos[0], toy.pose.pos[1], toy.pose.pos[2]), appear: animateNew ? 0 : 1, seen: new Float64Array(7).fill(Number.NaN) };
      if (family === 'box') {
        e.box = this.createBox(spec);
        this.place(e, 1);
      } else rebuild = true;
      this.entries.set(toy.id, e);
      this.changed++;
    }
    if (rebuild) this.rebuildBatches();
  }

  /** Instanced batches are rebuilt with exact counts whenever the set of instanced items changed (boundaries only). */
  private rebuildBatches(): void {
    for (const b of this.batches.values()) this.disposeBatch(b);
    this.batches.clear();
    const groups = new Map<string, ItemEntry[]>();
    for (const e of this.entries.values()) {
      if (e.family === 'box') continue;
      const key = batchKey(e.spec);
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      const spec = list[0]!.spec;
      let geometry: BufferGeometry;
      let material: Material;
      let scale = 1;
      let cell: InstancedBufferAttribute | null = null;
      if (spec.kind === 'snack') {
        geometry = snackGeometry(spec.size);
        material = this.snackMat();
        cell = new InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
        const atlas = this.ensureAtlas();
        list.forEach((e, i) => {
          const [u, v, du, dv] = atlas.uv(e.spec.print);
          cell!.setXYZW(i, u, v, du, dv);
        });
        geometry.setAttribute('aCell', cell);
      } else if (spec.kind === 'gem') {
        geometry = (this.gemBase ??= gemGeometry()).clone();
        material = this.gemMat(spec.look as GemLook);
        scale = spec.size[0] / 2;
      } else {
        geometry = coinGeometry(spec.size[0] / 2, spec.size[1]);
        material = this.coinMat();
      }
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.name = `items-${spec.look}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Instances move anywhere in the cabinet: the batch's bounds would need refitting every frame.
      mesh.frustumCulled = false;
      const batch: Batch = { key, mesh, entries: list, scale, cell };
      list.forEach((e, i) => {
        e.batch = batch;
        e.slot = i;
        e.seen.fill(Number.NaN);
        // Every instance at its body's pose right away: a frame drawn before the next update must
        // not show the identity matrices (a gem a metre wide at the origin).
        this.place(e, 1);
      });
      this.batches.set(key, batch);
      this.group.add(mesh);
    }
  }

  private createBox(spec: ItemSpec): BoxVisual {
    const colors = this.colors!;
    const asset = spec.print ? this.findAsset(spec.print) : null;
    const print = asset ? atlasPrint(asset) : { id: spec.print ?? 'box', name: spec.print ?? '', initial: '?', color: colors.card.border, tier: 'common' as const };
    const window = this.windowBox;
    const size = atlasSize(this.quality.textures);
    const boxPrint = new BoxPrint(print, colors, size, this.font, window, this.io.loadImage, this.io.makeCanvas);
    if (spec.print) void boxPrint.setThumbnail(this.thumbnails[spec.print]);
    const materials: Material[] = [];
    const detail = this.quality.lod === 'high' ? 4 : this.quality.textures === '512' ? 2 : 3;
    const outerMat = new MeshPhysicalMaterial({ map: boxPrint.texture, roughness: 0.48, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.25, alphaTest: window ? 0.5 : 0 });
    materials.push(outerMat);
    const root = new Group();
    root.name = 'item-box';
    const outer = new Mesh(boxGeometry(spec.size, detail, 0.004), outerMat);
    outer.castShadow = true;
    outer.receiveShadow = true;
    root.add(outer);
    let inner: Mesh | null = null, film: Mesh | null = null, plush: Mesh | null = null;
    if (window) {
      const [L, H, W] = spec.size;
      // The inside of the box (seen through the window), the clear film over it, the character inside.
      const insideMat = new MeshStandardMaterial({ color: colors.card.inside, roughness: 0.9, side: BackSide });
      materials.push(insideMat);
      inner = new Mesh(new BoxGeometry(L - 0.004, H - 0.004, W - 0.004).translate(0, H / 2, 0), insideMat);
      inner.receiveShadow = true;
      root.add(inner);
      // Over the window drawCard leaves clear: 92 % of the width, from 25 % to 90 % of the height.
      film = new Mesh(new PlaneGeometry(L * 0.92, H * 0.65), this.filmMat());
      film.position.set(0, H * 0.575, W / 2 - 0.0015);
      film.renderOrder = 11;
      film.userData.skipAO = true;
      root.add(film);
      if (asset) plush = this.createPlush(asset, spec.size, materials);
      if (plush) root.add(plush);
    }
    this.group.add(root);
    return { root, outer, inner, film, plush, print: boxPrint, materials };
  }

  /** The printed character inside the window box: its coarsest LOD, fitted and standing upright. */
  private createPlush(asset: PlushAsset, size: readonly [number, number, number], materials: Material[]): Mesh | null {
    const loaded = this.library.get(asset.id);
    if (!loaded || loaded.lods.length === 0) return null;
    const uniforms = createPlushUniforms();
    applyPaint(uniforms, asset);
    uniforms.uSheen.value = 0.35;
    const material = new PlushMaterial(uniforms, { dents: 1, deformNormals: false, textures: loaded.textured?.textures ?? null });
    materials.push(material);
    const mesh = new Mesh(loaded.lods[Math.min(2, loaded.lods.length - 1)]!, material);
    const [L, H, W] = size;
    const s = Math.min((L - 0.03) / asset.size[0], (H - 0.016) / asset.size[1], (W - 0.022) / asset.size[2]);
    mesh.scale.setScalar(s);
    mesh.position.set(0, 0.004, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'item-box-plush';
    return mesh;
  }

  private findAsset(id: string): PlushAsset | null {
    const theme = this.theme;
    return (theme ? this.library.assets(theme.id) : this.library.assets()).find((a) => a.id === id) ?? this.library.assets().find((a) => a.id === id) ?? null;
  }

  /* ------------------------------------------------------------ per frame */

  /** Pose interpolation (as ToyVisuals), the refill scale-in, and the change counter. */
  update(alpha: number, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 1e-4), 0.05);
    let moved = false;
    for (const e of this.entries.values()) {
      if (e.appear < 1) e.appear = Math.min(1, e.appear + safeDt / 0.22);
      if (this.place(e, alpha)) moved = true;
    }
    if (moved) this.changed++;
    this.triangles = this.countTriangles();
  }

  /** Writes an item's interpolated pose into its mesh or instance; false when nothing changed. */
  private place(e: ItemEntry, alpha: number): boolean {
    const pose = e.toy.pose;
    const p = pose.prevPos, c = pose.pos;
    const x = p[0]! + (c[0]! - p[0]!) * alpha, y = p[1]! + (c[1]! - p[1]!) * alpha, z = p[2]! + (c[2]! - p[2]!) * alpha;
    _q.set(pose.prevRot[0]!, pose.prevRot[1]!, pose.prevRot[2]!, pose.prevRot[3]!);
    _q2.set(pose.rot[0]!, pose.rot[1]!, pose.rot[2]!, pose.rot[3]!);
    _q.slerp(_q2, alpha);
    const grow = e.appear < 1 ? 0.55 + 0.45 * (1 - (1 - e.appear) ** 3) : 1;
    e.pos.set(x, y, z);
    const seen = e.seen;
    const k = grow * (e.batch?.scale ?? 1);
    if (seen[0] === x && seen[1] === y && seen[2] === z && seen[3] === _q.x && seen[4] === _q.y && seen[5] === _q.z && seen[6] === _q.w * k) return false;
    seen[0] = x;
    seen[1] = y;
    seen[2] = z;
    seen[3] = _q.x;
    seen[4] = _q.y;
    seen[5] = _q.z;
    seen[6] = _q.w * k;
    if (e.box) {
      e.box.root.position.set(x, y, z);
      e.box.root.quaternion.copy(_q);
      e.box.root.scale.setScalar(grow);
    } else if (e.batch) {
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(k));
      e.batch.mesh.setMatrixAt(e.slot, _m);
      e.batch.mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  private countTriangles(): number {
    let n = 0;
    const tri = (g: BufferGeometry) => (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
    for (const b of this.batches.values()) n += tri(b.mesh.geometry) * b.mesh.count;
    for (const e of this.entries.values()) {
      if (!e.box) continue;
      for (const m of [e.box.outer, e.box.inner, e.box.film, e.box.plush]) if (m) n += tri(m.geometry);
    }
    return n;
  }

  /** World position of an item's visual (for effects): written into `out`; false for an unknown toy. */
  positionOf(toy: ToyBody, out: Vector3): boolean {
    const e = this.entries.get(toy.id);
    if (!e) return false;
    out.copy(e.pos);
    return true;
  }

  /** Items placed during play (refills) grow in instead of popping. */
  animateIn(ids: Iterable<string>): void {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e) e.appear = 0;
    }
  }

  /* ------------------------------------------------------------ settings and artwork */

  /** The UI's character portraits (id → data URL): the atlas and the boxes redraw when theirs arrive. */
  setThumbnails(thumbnails: Readonly<Record<string, string>>): void {
    if (thumbnails === this.thumbnails) return;
    this.thumbnails = thumbnails;
    if (this.atlas) void this.atlas.setThumbnails(thumbnails);
    for (const e of this.entries.values()) if (e.box && e.spec.print) void e.box.print.setThumbnail(thumbnails[e.spec.print]);
  }

  /** A different texture tier rebuilds the atlas and the boxes (sizes, window); other changes are free. */
  setQuality(quality: ItemQuality): void {
    const before = { ...this.quality };
    this.quality = { ...quality };
    if (before.textures === quality.textures && before.lod === quality.lod) return;
    const toys = [...this.entries.values()].map((e) => e.toy);
    const theme = this.theme;
    this.clear();
    this.disposeLooks();
    this.theme = null;
    if (theme) this.useTheme(theme);
    this.sync(toys);
  }

  /**
   * Objects whose programs should be compiled ahead of use: the stage compiles everything in the
   * scene behind the machine-switch curtain, but the ambient-occlusion pass (High, Ultra) draws
   * instanced meshes with its own instanced variant. One temporary stand-in per batch, with the real
   * geometry and material; the caller disposes them.
   */
  warmUpObjects(): Object3D[] {
    const out: Object3D[] = [];
    for (const b of this.batches.values()) {
      const mesh = new InstancedMesh(b.mesh.geometry, b.mesh.material, 1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }

  /** Per item: id, look, how it is drawn (diagnostics, tests). */
  viewStats(): { id: string; look: ItemLook; drawn: 'instance' | 'mesh'; batch: string | null }[] {
    return [...this.entries.values()].map((e) => ({ id: e.toy.id, look: e.spec.look, drawn: e.box ? 'mesh' : 'instance', batch: e.batch?.key ?? null }));
  }

  /** Draw calls of the items in the main pass (one per batch, the box's meshes). */
  drawCalls(): number {
    let n = this.batches.size;
    for (const e of this.entries.values()) if (e.box) n += [e.box.outer, e.box.inner, e.box.film, e.box.plush].filter(Boolean).length;
    return n;
  }

  get count(): number {
    return this.entries.size;
  }

  /* ------------------------------------------------------------ teardown */

  private disposeBatch(b: Batch): void {
    b.mesh.removeFromParent();
    b.mesh.geometry.dispose();
    b.mesh.dispose();
  }

  private destroyBox(v: BoxVisual): void {
    v.root.removeFromParent();
    v.outer.geometry.dispose();
    v.inner?.geometry.dispose();
    v.film?.geometry.dispose();
    for (const m of v.materials) m.dispose();
    v.print.dispose();
  }

  /** Removes every item visual (the looks of the theme stay for the next sync). */
  clear(): void {
    for (const e of this.entries.values()) if (e.box) this.destroyBox(e.box);
    this.entries.clear();
    for (const b of this.batches.values()) this.disposeBatch(b);
    this.batches.clear();
    this.changed++;
    this.triangles = 0;
  }

  private disposeLooks(): void {
    this.atlas?.dispose();
    this.atlas = null;
    this.snackMaterial?.dispose();
    this.snackMaterial = null;
    for (const m of this.gemMaterials.values()) m.dispose();
    this.gemMaterials.clear();
    this.coinMaterial?.dispose();
    this.coinMaterial = null;
    this.filmMaterial?.dispose();
    this.filmMaterial = null;
    this.gemBase?.dispose();
    this.gemBase = null;
  }

  dispose(): void {
    this.clear();
    this.disposeLooks();
    this.theme = null;
    this.group.removeFromParent();
  }
}

/** Items that share a batch: same look and size. */
function batchKey(spec: ItemSpec): string {
  return `${spec.look}:${spec.size.map((v) => v.toFixed(4)).join('x')}`;
}
