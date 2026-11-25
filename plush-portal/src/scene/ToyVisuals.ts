import { BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type Camera, type Object3D, type ShaderMaterial } from 'three';
import { damp } from '../core/math';
import type { ClawContact } from '../physics/GripMonitor';
import type { ImpactEvent, ToyBody } from '../physics/PhysicsWorld';
import type { LoadedPlush, PlushLibrary, TexturedState } from '../plush/PlushLibrary';
import { PlushDeformer, type DeformFrame } from '../plush/PlushDeformer';
import { MAX_DENTS, PLUSH_DEFORM_GLSL, PlushDepthMaterial, PlushMaterial, applyPaint, applyPlushDeformation, createPlushUniforms, type PlushUniforms } from '../plush/PlushMaterial';
import type { PlushAsset, TextureSetting } from '../plush/manifest';
import type { DisplaySlot } from './Cabinet';
import { createContactMaterial } from './contactShadows';

export interface ToyQuality {
  lod: 'low' | 'medium' | 'high';
  fur: 'flat' | 'sheen' | 'shell' | 'shellHigh';
  deform: 'basic' | 'fine' | 'ultra';
  /**
   * *Graphics → Textures* (textured models pick the closest variant; 4K uses 2K). Without it the
   * resolution follows the model detail: low → 512, medium → 1K, high → 2K (as in the presets).
   */
  textures?: TextureSetting;
}

/** Texture setting used when the quality object does not carry one. */
export function textureSettingFor(quality: ToyQuality): TextureSetting {
  return quality.textures ?? (quality.lod === 'low' ? '512' : quality.lod === 'medium' ? '1k' : '2k');
}

/**
 * LOD drawn into the key-light shadow map and the contact-shadow map (soft, blurred passes in
 * which the coarsest mesh's silhouette is indistinguishable): the coarsest on Low / Medium, LOD1 on
 * High (and with *Softness detail* ultra), never finer than LOD1. Clamped to the LODs a model has.
 */
export function shadowLodFor(quality: ToyQuality): number {
  return quality.lod === 'high' || quality.deform === 'ultra' ? 1 : 2;
}

/**
 * Medium model detail: a toy that is not the centre of attention and covers fewer than this many
 * pixels of height on screen is drawn with LOD2 instead of LOD1 (its triangles would be smaller
 * than about 3 px there; see docs/PERFORMANCE.md). Focused / held toys and High are unaffected.
 */
export const LOD2_BELOW_PX = 150;

/** Height in pixels a toy of `height` metres covers at view depth `depth` (perspective camera). */
export function projectedHeight(height: number, depth: number, projectionYScale: number, viewportHeight: number): number {
  return (height * projectionYScale * viewportHeight) / (2 * Math.max(0.05, depth));
}

/** Strength of the fabric micro relief of textured models per fur quality. */
const MICRO_BY_FUR: Record<ToyQuality['fur'], number> = { flat: 0, sheen: 0.65, shell: 1, shellHigh: 1 };

/** Creates the plush material for a loaded slot: textured models get the textured variant. */
export function plushMaterialFor(loaded: LoadedPlush | undefined, uniforms: PlushUniforms, options: { dents?: number; deformNormals?: boolean; shell?: boolean } = {}): PlushMaterial {
  return new PlushMaterial(uniforms, { ...options, textures: loaded?.textured?.textures ?? null });
}

interface ToyVisual {
  toy: ToyBody;
  root: Group;
  mesh: Mesh;
  shell: InstancedMesh | null;
  shellKey: string;
  uniforms: PlushUniforms;
  material: PlushMaterial;
  shellMaterial: PlushMaterial | null;
  depth: PlushDepthMaterial;
  /** Height material for the contact-shadow pass, with the same deformation. */
  contact: ShaderMaterial;
  deformer: PlushDeformer;
  lod: number;
  /** Projected height on screen in pixels in the last rendered view (Infinity until known). */
  screen: number;
  /** Pose the contact map last saw (x, y, z, qx, qy, qz, qw) and whether the deformation moved since. */
  seen: Float64Array;
  /** Smoothed world-space velocity / acceleration for the drag effect. */
  vel: Vector3;
  accel: Vector3;
  held: number;
  awake: boolean;
  /** The deformation was still animating after the last update (dents, sag, squash, sway). */
  deforming: boolean;
  /** Scale-in animation for restocked toys (0..1). */
  appear: number;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _inv = new Matrix4();
const _v = new Vector3();
const _n = new Vector3();
const _g = new Vector3();
const _frame: DeformFrame = { gravity: new Vector3(0, -1, 0), accel: new Vector3(), held: 0, grip: new Vector3() };

/**
 * Renders every toy: follows the interpolated physics pose, picks LODs,
 * manages optional shell fur and feeds the soft-body deformation from real
 * contacts and impacts.
 */
export class ToyVisuals {
  readonly group = new Group();
  private readonly visuals = new Map<string, ToyVisual>();
  private readonly shellGeometries = new Map<string, BufferGeometry>();
  private readonly display: Mesh[] = [];
  private readonly displayMaterials: PlushMaterial[] = [];
  /** Display-bay materials of textured assets, by asset id (their textures follow the tier). */
  private readonly displayByAsset = new Map<string, PlushMaterial>();
  private quality: ToyQuality;
  /** Bumped on every texture-setting change so late texture loads of an older setting are ignored. */
  private textureEpoch = 0;
  /** Slots already asked (in this texture epoch) to move to the current tier (see `followTier`). */
  private readonly tierRequested = new Set<string>();
  /** Toy that is the centre of attention (gets the best LOD / fur). */
  focus: ToyBody | null = null;
  /** Assist anchor of the held toy in its local space (set by the game while a toy is carried). */
  readonly gripLocal = new Vector3();
  heldToy: ToyBody | null = null;
  reducedMotion = false;
  /** Number of triangles submitted for toys in the main pass of the last frame (diagnostics). */
  triangles = 0;
  /** Medium: non-focused toys smaller than this on screen use LOD2 (see LOD2_BELOW_PX; 0 disables). */
  lod2BelowPx = LOD2_BELOW_PX;
  /**
   * Bumped whenever something drawn into the contact-shadow map changes (a toy moved, deformed,
   * appeared, left or changed its shadow mesh); mirrored in `group.userData.contactVersion`, where
   * the stage reads it to skip re-rendering an unchanged map.
   */
  private contactVersion = 0;

  constructor(
    private readonly library: PlushLibrary,
    quality: ToyQuality,
  ) {
    this.group.name = 'toys';
    this.quality = { ...quality };
    // Models loaded from now on start with the right texture resolution.
    this.library.textureTier = textureSettingFor(this.quality);
    // The stage calls this with the real camera right before rendering (view-dependent LOD), and
    // the other one while warming up shaders.
    this.group.userData.onView = (camera: Camera, viewportHeight: number) => this.updateView(camera, viewportHeight);
    this.group.userData.warmUpObjects = () => this.warmUpObjects();
    this.group.userData.contactVersion = 0;
  }

  private touchContact(): void {
    this.group.userData.contactVersion = ++this.contactVersion;
  }

  setQuality(quality: ToyQuality): void {
    const changed = quality.deform !== this.quality.deform;
    const textures = textureSettingFor(quality);
    const texturesChanged = textures !== textureSettingFor(this.quality);
    this.quality = { ...quality };
    for (const v of this.visuals.values()) {
      this.applyFurUniforms(v.uniforms);
      if (changed) this.applyDeformDefines(v);
    }
    for (const m of this.displayMaterials) this.applyFurUniforms(m.plush);
    if (texturesChanged) this.switchTextures(textures);
    for (const v of this.visuals.values()) this.applyShadowLod(v);
  }

  /** Points the toy's shadow / contact geometry at the LOD the quality asks for. */
  private applyShadowLod(v: ToyVisual): void {
    const lods = this.library.get(v.toy.asset.id)?.lods;
    if (!lods || lods.length === 0) return;
    const geometry = lods[Math.min(lods.length - 1, shadowLodFor(this.quality))]!;
    if (v.mesh.userData.shadowGeometry === geometry) return;
    v.mesh.userData.shadowGeometry = geometry;
    this.touchContact();
  }

  private applyFurUniforms(uniforms: PlushUniforms): void {
    const fur = this.quality.fur;
    uniforms.uSheen.value = fur === 'flat' ? 0.35 : 1;
    uniforms.uFiber.value = fur === 'flat' ? 0 : 1;
    uniforms.uMicro.value = MICRO_BY_FUR[fur];
  }

  /** Moves every textured toy in use to the texture variant closest to `setting`. */
  private switchTextures(setting: TextureSetting): void {
    this.library.textureTier = setting;
    const epoch = ++this.textureEpoch;
    this.tierRequested.clear();
    const ids = new Set<string>();
    for (const v of this.visuals.values()) if (v.material.textured) ids.add(v.toy.asset.id);
    for (const id of this.displayByAsset.keys()) ids.add(id);
    for (const id of ids) {
      this.tierRequested.add(id);
      void this.library.useTextures(id, setting).then((state) => {
        if (state && epoch === this.textureEpoch) this.applyTextures(id, state);
      });
    }
  }

  /**
   * A slot whose model finished loading while the setting changed carries the previous tier (the
   * switch above only reaches toys that already exist): ask once per setting for the right one.
   */
  private followTier(asset: PlushAsset): void {
    const setting = textureSettingFor(this.quality);
    const current = this.library.get(asset.id)?.textured?.tier;
    const tier = this.library.tierFor(asset, setting);
    if (!current || !tier || current === tier || this.tierRequested.has(asset.id)) return;
    this.tierRequested.add(asset.id);
    const epoch = this.textureEpoch;
    void this.library.useTextures(asset.id, setting).then((state) => {
      if (state && epoch === this.textureEpoch) this.applyTextures(asset.id, state);
    });
  }

  private applyTextures(id: string, state: TexturedState): void {
    for (const v of this.visuals.values()) {
      if (v.toy.asset.id !== id) continue;
      v.material.setTextures(state.textures);
      v.shellMaterial?.setTextures(state.textures);
    }
    this.displayByAsset.get(id)?.setTextures(state.textures);
  }

  private applyDeformDefines(v: ToyVisual): void {
    // Basic: four dent slots. Fine / ultra: all slots (and denser meshes, see wantedLod).
    const dents = this.quality.deform === 'basic' ? 4 : MAX_DENTS;
    for (const m of [v.material, v.shellMaterial, v.contact]) {
      if (!m) continue;
      m.defines ??= {};
      if (m.defines.PLUSH_DENTS === dents) continue;
      m.defines.PLUSH_DENTS = dents;
      m.needsUpdate = true;
    }
    v.deformer.maxDents = dents;
  }

  /** Creates visuals for new toys and removes those of toys that no longer exist. */
  sync(toys: Iterable<ToyBody>, animateNew = false): void {
    const alive = new Set<string>();
    for (const toy of toys) {
      alive.add(toy.id);
      if (!this.visuals.has(toy.id)) this.create(toy, animateNew);
    }
    for (const [id, v] of this.visuals) {
      if (alive.has(id)) continue;
      this.destroy(v);
      this.visuals.delete(id);
      this.touchContact();
    }
  }

  private create(toy: ToyBody, animate: boolean): void {
    const loaded = this.library.get(toy.asset.id);
    if (!loaded) return;
    const uniforms = createPlushUniforms();
    applyPaint(uniforms, toy.asset);
    this.applyFurUniforms(uniforms);
    const material = plushMaterialFor(loaded, uniforms);
    if (material.textured) this.followTier(toy.asset);
    const depth = new PlushDepthMaterial(uniforms, { textured: material.textured });
    const contact = createContactMaterial({
      ...PLUSH_DEFORM_GLSL,
      uniforms,
      defines: { PLUSH_DENTS: MAX_DENTS, ...(material.textured ? { PLUSH_TEXTURED: '' } : {}) },
    });
    const lod = Math.min(loaded.lods.length - 1, 1);
    const mesh = new Mesh(loaded.lods[lod]!, material);
    mesh.customDepthMaterial = depth;
    mesh.userData.contactMaterial = contact;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Deformation can move vertices outside the rest bounds.
    mesh.frustumCulled = false;
    const root = new Group();
    root.scale.setScalar(toy.scale);
    if (loaded.custom) {
      // Imported model: its own materials, plus the shared soft-body deformation.
      const copy = loaded.custom.clone(true);
      copy.traverse((object) => {
        const part = object as Mesh;
        if (!part.isMesh) return;
        part.material = Array.isArray(part.material)
          ? part.material.map((m) => applyPlushDeformation(m.clone(), uniforms))
          : applyPlushDeformation(part.material.clone(), uniforms);
        part.customDepthMaterial = depth;
        part.castShadow = true;
        part.receiveShadow = true;
        part.frustumCulled = false;
      });
      root.add(copy);
      mesh.visible = false;
    }
    root.add(mesh);
    this.group.add(root);
    const v: ToyVisual = {
      toy,
      root,
      mesh,
      shell: null,
      shellKey: '',
      uniforms,
      material,
      shellMaterial: null,
      depth,
      contact,
      deformer: new PlushDeformer(uniforms, toy.asset),
      lod,
      screen: Infinity,
      seen: new Float64Array(7).fill(Number.NaN),
      vel: new Vector3(),
      accel: new Vector3(),
      held: 0,
      awake: true,
      deforming: false,
      appear: animate ? 0 : 1,
    };
    this.applyDeformDefines(v);
    this.visuals.set(toy.id, v);
    this.applyShadowLod(v);
    this.touchContact();
  }

  private destroy(v: ToyVisual): void {
    v.root.removeFromParent();
    v.root.traverse((object) => {
      const part = object as Mesh;
      if (!part.isMesh || part === v.mesh || part === v.shell) return;
      // Per-toy clones of an imported model's materials (textures stay with the template).
      for (const m of Array.isArray(part.material) ? part.material : [part.material]) m.dispose();
    });
    v.material.dispose();
    v.depth.dispose();
    v.contact.dispose();
    v.shellMaterial?.dispose();
    if (v.shell) v.shell.dispose();
  }

  private shellGeometry(asset: PlushAsset, lod: number, layers: number): BufferGeometry | null {
    const key = `${asset.id}:${lod}:${layers}`;
    let g = this.shellGeometries.get(key);
    if (g) return g;
    const loaded = this.library.get(asset.id);
    const base = loaded?.lods[Math.min(lod, loaded.lods.length - 1)];
    if (!base) return null;
    // Shares the vertex buffers of the base LOD; only the per-layer attribute is new.
    g = new BufferGeometry();
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    g.setIndex(base.getIndex());
    const t = new Float32Array(layers);
    for (let i = 0; i < layers; i++) t[i] = (i + 1) / layers;
    g.setAttribute('aShell', new InstancedBufferAttribute(t, 1));
    g.boundingSphere = base.boundingSphere;
    this.shellGeometries.set(key, g);
    return g;
  }

  private wantedLod(v: ToyVisual, focus: boolean): number {
    const max = (this.library.get(v.toy.asset.id)?.lods.length ?? 1) - 1;
    const q = this.quality;
    let lod: number;
    if (q.lod === 'high') lod = 0;
    else if (q.lod === 'medium') lod = focus ? 0 : v.screen < this.lod2BelowPx ? 2 : 1;
    else lod = focus ? 1 : 2;
    // Finer deformation needs denser meshes: the focused toy (and, on ultra, every toy) uses LOD 0.
    if (q.deform !== 'basic' && focus) lod = 0;
    if (q.deform === 'ultra') lod = 0;
    return Math.min(max, lod);
  }

  private updateShell(v: ToyVisual, focus: boolean): void {
    const fur = this.quality.fur;
    let layers = 0;
    let lod = v.lod;
    // Textured models are about 2.5× denser per LOD than the procedural ones: their shells use the
    // next coarser LOD so the fur costs about the same (the shell sits a few millimetres out, so
    // the coarser surface under it does not show).
    const shellLod = v.material.textured ? 1 : 0;
    if (fur === 'shell' && focus) {
      layers = 10;
      lod = Math.max(v.lod, shellLod);
    } else if (fur === 'shellHigh') {
      layers = focus ? 16 : 8;
      lod = focus ? Math.max(v.lod, shellLod) : Math.max(v.lod, 1 + shellLod);
    }
    const loaded = this.library.get(v.toy.asset.id);
    lod = Math.min(lod, (loaded?.lods.length ?? 1) - 1);
    const key = layers > 0 ? `${lod}:${layers}` : '';
    if (key === v.shellKey) return;
    if (v.shell) {
      v.root.remove(v.shell);
      v.shell.dispose();
      v.shell = null;
    }
    v.shellKey = key;
    if (layers === 0) return;
    const geometry = this.shellGeometry(v.toy.asset, lod, layers);
    if (!geometry) return;
    if (!v.shellMaterial) {
      v.shellMaterial = plushMaterialFor(this.library.get(v.toy.asset.id), v.uniforms, { shell: true });
      this.applyDeformDefines(v);
    }
    v.uniforms.uShellLength.value = 0.0042;
    const shell = new InstancedMesh(geometry, v.shellMaterial, layers);
    shell.frustumCulled = false;
    // Receives the key light's shadow in the main view, but is left out of the shadow passes:
    // three.js draws every receiver into a variance shadow map (High / Ultra), and the layers sit
    // within a few millimetres of the base mesh, which is already there.
    shell.receiveShadow = true;
    shell.castShadow = false;
    shell.userData.shadowSkip = true;
    v.shell = shell;
    v.root.add(shell);
  }

  /**
   * Per rendered frame: pose interpolation, LOD / fur selection and deformation.
   * `contacts` and `impacts` come straight from the physics step(s) of this frame.
   */
  update(alpha: number, dt: number, contacts: readonly ClawContact[], impacts: readonly ImpactEvent[], fixedDt: number): void {
    let triangles = 0;
    let contactChanged = false;
    const safeDt = Math.min(Math.max(dt, 1e-4), 0.05);
    for (const v of this.visuals.values()) {
      const pose = v.toy.pose;
      const p = pose.prevPos, c = pose.pos;
      const x = p[0]! + (c[0]! - p[0]!) * alpha, y = p[1]! + (c[1]! - p[1]!) * alpha, z = p[2]! + (c[2]! - p[2]!) * alpha;
      v.root.position.set(x, y, z);
      _q.set(pose.prevRot[0]!, pose.prevRot[1]!, pose.prevRot[2]!, pose.prevRot[3]!);
      _q2.set(pose.rot[0]!, pose.rot[1]!, pose.rot[2]!, pose.rot[3]!);
      v.root.quaternion.copy(_q).slerp(_q2, alpha);
      if (v.appear < 1) {
        v.appear = Math.min(1, v.appear + safeDt / 0.22);
        const s = v.toy.scale * (0.55 + 0.45 * (1 - (1 - v.appear) ** 3));
        v.root.scale.setScalar(s);
      }

      this.selectLod(v);
      triangles += visualTriangles(v);

      // Velocity / acceleration from the fixed-step poses (world space), smoothed.
      const vx = (c[0]! - p[0]!) / fixedDt, vy = (c[1]! - p[1]!) / fixedDt, vz = (c[2]! - p[2]!) / fixedDt;
      const ax = (vx - v.vel.x) / safeDt, ay = (vy - v.vel.y) / safeDt, az = (vz - v.vel.z) / safeDt;
      v.vel.set(vx, vy, vz);
      const k = 1 - Math.exp(-safeDt / 0.05);
      v.accel.x += (ax - v.accel.x) * k;
      v.accel.y += (ay - v.accel.y) * k;
      v.accel.z += (az - v.accel.z) * k;
      const sleeping = v.toy.body.isSleeping();
      // The contact map only needs re-rendering when a toy really moved or deformed.
      if (v.awake || !sleeping) {
        const seen = v.seen, rq = v.root.quaternion, rs = v.root.scale.x;
        if (seen[0] !== x || seen[1] !== y || seen[2] !== z || seen[3] !== rq.x || seen[4] !== rq.y || seen[5] !== rq.z || seen[6] !== rq.w * rs || v.deforming) {
          seen[0] = x;
          seen[1] = y;
          seen[2] = z;
          seen[3] = rq.x;
          seen[4] = rq.y;
          seen[5] = rq.z;
          seen[6] = rq.w * rs;
          contactChanged = true;
        }
      }
      if (sleeping && !v.awake) continue;

      _q2.copy(v.root.quaternion).invert();
      _frame.gravity.set(0, -1, 0).applyQuaternion(_q2);
      _frame.accel.copy(v.accel).applyQuaternion(_q2).divideScalar(v.toy.scale);
      const heldTarget = v.toy === this.heldToy ? 1 : 0;
      v.held = damp(v.held, heldTarget, 0.1, safeDt);
      _frame.held = v.held < 0.003 ? 0 : v.held;
      _frame.grip.copy(this.gripLocal);
      v.deformer.intensity = this.reducedMotion ? 0.6 : 1;
      v.deforming = v.deformer.update(safeDt, _frame);
      v.awake = v.deforming || !sleeping;
    }

    // Finger / palm contacts → dents, in the toy's own space.
    for (const contact of contacts) {
      const v = this.visuals.get(contact.toy.id);
      if (!v) continue;
      v.root.updateMatrixWorld();
      _inv.copy(v.root.matrixWorld).invert();
      _v.set(contact.px, contact.py, contact.pz).applyMatrix4(_inv);
      _n.set(contact.nx, contact.ny, contact.nz).transformDirection(_inv);
      // Impulse per step → rough pressure 0..1 (a firm finger squeeze is ≈ 2–3 N).
      const pressure = Math.min(1, contact.impulse / fixedDt / 3.2);
      v.deformer.contact(contact.part, _v.x, _v.y, _v.z, _n.x, _n.y, _n.z, pressure);
      v.awake = true;
    }

    // Impacts → squash about the side that hit.
    for (const impact of impacts) {
      const v = this.visuals.get(impact.toy.id);
      if (!v) continue;
      _q2.copy(v.root.quaternion).invert();
      _n.set(impact.dirX, impact.dirY, impact.dirZ).applyQuaternion(_q2);
      // Pivot: the point of the toy farthest against the push direction (where it touched).
      const size = v.toy.asset.size;
      _g.set(0, size[1] * 0.5, 0);
      const reach = Math.abs(_n.x) * size[0] * 0.5 + Math.abs(_n.y) * size[1] * 0.5 + Math.abs(_n.z) * size[2] * 0.5;
      _v.copy(_g).addScaledVector(_n, -reach);
      v.deformer.impact(_n.x, _n.y, _n.z, _v.x, _v.y, _v.z, impact.strength);
      v.awake = true;
    }
    this.triangles = triangles;
    if (contactChanged || contacts.length > 0 || impacts.length > 0) this.touchContact();
  }

  /** Applies the wanted LOD and shell fur of one toy (geometry swap only when it changes). */
  private selectLod(v: ToyVisual): void {
    if (!v.mesh.visible) return;
    const focus = v.toy === this.focus || v.toy === this.heldToy;
    const lod = this.wantedLod(v, focus);
    if (lod !== v.lod) {
      const loaded = this.library.get(v.toy.asset.id);
      if (loaded) {
        v.mesh.geometry = loaded.lods[lod]!;
        v.lod = lod;
      }
    }
    this.updateShell(v, focus);
  }

  /**
   * Called by the stage with the camera that is about to render: measures how large each toy is on
   * screen and re-selects LODs with it (Medium draws small, distant toys with LOD2), in the same
   * frame. Also recounts the main-pass triangles.
   */
  updateView(camera: Camera, viewportHeight: number): void {
    const yScale = camera.projectionMatrix.elements[5]!;
    let triangles = 0;
    for (const v of this.visuals.values()) {
      _v.copy(v.root.position).applyMatrix4(camera.matrixWorldInverse);
      v.screen = projectedHeight(v.toy.asset.size[1] * v.root.scale.y, -_v.z, yScale, viewportHeight);
      this.selectLod(v);
      triangles += visualTriangles(v);
    }
    this.triangles = triangles;
  }

  /**
   * Objects whose shaders should be compiled ahead of use: shell fur only appears once a toy is
   * focused, so its program would otherwise be built on the first aim. One shell mesh per material
   * variant (textured / procedural) is enough: later shell materials of the same variant reuse the
   * compiled program. The returned meshes are temporary; their materials are the toys' own.
   */
  warmUpObjects(): Object3D[] {
    const fur = this.quality.fur;
    if (fur !== 'shell' && fur !== 'shellHigh') return [];
    const out: Object3D[] = [];
    const seen = new Set<boolean>();
    for (const v of this.visuals.values()) {
      if (!v.mesh.visible || seen.has(v.material.textured)) continue;
      const loaded = this.library.get(v.toy.asset.id);
      if (!loaded) continue;
      seen.add(v.material.textured);
      const layers = fur === 'shell' ? 10 : 16;
      const lod = Math.min(loaded.lods.length - 1, v.material.textured ? 1 : 0);
      const geometry = this.shellGeometry(v.toy.asset, lod, layers);
      if (!geometry) continue;
      if (!v.shellMaterial) {
        v.shellMaterial = plushMaterialFor(loaded, v.uniforms, { shell: true });
        this.applyDeformDefines(v);
      }
      const mesh = new InstancedMesh(geometry, v.shellMaterial, layers);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    return out;
  }

  /** Projected heights in pixels of the toys in the last view, with their LODs (diagnostics). */
  viewStats(): { id: string; px: number; lod: number; shell: string }[] {
    return [...this.visuals.values()].map((v) => ({ id: v.toy.asset.id, px: Math.round(v.screen), lod: v.lod, shell: v.shellKey }));
  }

  /** World position of a toy's visual (for effects). */
  positionOf(toy: ToyBody, out: Vector3): Vector3 | null {
    const v = this.visuals.get(toy.id);
    return v ? out.copy(v.root.position) : null;
  }

  /** Static display toys: the plush piles of the neighbouring machines (src/scene/arcadeRow.ts). */
  setDisplay(slots: readonly DisplaySlot[], assets: readonly PlushAsset[]): void {
    for (const m of this.display) m.removeFromParent();
    this.display.length = 0;
    for (const m of this.displayMaterials) m.dispose();
    this.displayMaterials.length = 0;
    this.displayByAsset.clear();
    if (assets.length === 0) return;
    const perAsset = new Map<string, PlushMaterial>();
    slots.forEach((slot, i) => {
      const asset = assets[(slot.pick ?? i) % assets.length]!;
      const loaded = this.library.get(asset.id);
      if (!loaded) return;
      let material = perAsset.get(asset.id);
      if (!material) {
        const uniforms = createPlushUniforms();
        applyPaint(uniforms, asset);
        this.applyFurUniforms(uniforms);
        material = plushMaterialFor(loaded, uniforms, { dents: 1, deformNormals: false });
        perAsset.set(asset.id, material);
        this.displayMaterials.push(material);
        if (material.textured) {
          this.displayByAsset.set(asset.id, material);
          this.followTier(asset);
        }
      }
      const mesh = new Mesh(loaded.lods[displayLod(loaded)]!, material);
      mesh.position.set(slot.x, slot.y, slot.z);
      mesh.rotation.set(slot.pitch ?? 0, slot.yaw, slot.roll ?? 0, 'YXZ');
      mesh.scale.setScalar(slot.scale ?? 1);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.display.push(mesh);
    });
  }

  /** Number of toys currently drawn with a textured (generated) model (diagnostics). */
  texturedCount(): number {
    let n = 0;
    for (const v of this.visuals.values()) if (v.material.textured && v.mesh.visible) n++;
    return n;
  }

  clear(): void {
    for (const v of this.visuals.values()) this.destroy(v);
    this.visuals.clear();
    this.setDisplay([], []);
    for (const g of this.shellGeometries.values()) {
      // The vertex buffers belong to the library's geometries: detach them so that disposing the
      // wrapper frees only its own per-layer attribute.
      for (const name of Object.keys(g.attributes)) if (name !== 'aShell') g.deleteAttribute(name);
      g.setIndex(null);
      g.dispose();
    }
    this.shellGeometries.clear();
    this.tierRequested.clear();
    this.focus = null;
    this.heldToy = null;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

/** Triangles a toy submits in the main pass (base mesh plus shell layers). */
function visualTriangles(v: ToyVisual): number {
  if (!v.mesh.visible) return 0;
  const index = v.mesh.geometry.getIndex();
  const shellIndex = v.shell?.geometry.getIndex();
  return (index ? index.count / 3 : 0) + (v.shell && shellIndex ? (shellIndex.count / 3) * v.shell.count : 0);
}

/** Display toys are small and static: the LOD closest to ~5k triangles (LOD1 of a procedural model). */
function displayLod(loaded: LoadedPlush): number {
  const lods = loaded.lods;
  let best = Math.min(1, lods.length - 1);
  let bestDiff = Infinity;
  lods.forEach((g, i) => {
    const tris = (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
    const diff = Math.abs(Math.log(tris / 5200));
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}
