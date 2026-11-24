import { BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { damp } from '../core/math';
import type { ClawContact } from '../physics/GripMonitor';
import type { ImpactEvent, ToyBody } from '../physics/PhysicsWorld';
import type { PlushLibrary } from '../plush/PlushLibrary';
import { PlushDeformer, type DeformFrame } from '../plush/PlushDeformer';
import { MAX_DENTS, PlushDepthMaterial, PlushMaterial, applyPaint, applyPlushDeformation, createPlushUniforms, type PlushUniforms } from '../plush/PlushMaterial';
import type { PlushAsset } from '../plush/manifest';
import type { DisplaySlot } from './Cabinet';

export interface ToyQuality {
  lod: 'low' | 'medium' | 'high';
  fur: 'flat' | 'sheen' | 'shell' | 'shellHigh';
  deform: 'basic' | 'fine' | 'ultra';
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
  deformer: PlushDeformer;
  lod: number;
  /** Smoothed world-space velocity / acceleration for the drag effect. */
  vel: Vector3;
  accel: Vector3;
  held: number;
  awake: boolean;
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
  private quality: ToyQuality;
  /** Toy that is the centre of attention (gets the best LOD / fur). */
  focus: ToyBody | null = null;
  /** Assist anchor of the held toy in its local space (set by the game while a toy is carried). */
  readonly gripLocal = new Vector3();
  heldToy: ToyBody | null = null;
  reducedMotion = false;
  /** Number of triangles submitted for toys in the last update (diagnostics). */
  triangles = 0;

  constructor(
    private readonly library: PlushLibrary,
    quality: ToyQuality,
  ) {
    this.group.name = 'toys';
    this.quality = { ...quality };
  }

  setQuality(quality: ToyQuality): void {
    const changed = quality.deform !== this.quality.deform;
    this.quality = { ...quality };
    for (const v of this.visuals.values()) {
      v.uniforms.uSheen.value = quality.fur === 'flat' ? 0.35 : 1;
      v.uniforms.uFiber.value = quality.fur === 'flat' ? 0 : 1;
      if (changed) this.applyDeformDefines(v);
    }
    for (const m of this.displayMaterials) {
      m.plush.uSheen.value = quality.fur === 'flat' ? 0.35 : 1;
      m.plush.uFiber.value = quality.fur === 'flat' ? 0 : 1;
    }
  }

  private applyDeformDefines(v: ToyVisual): void {
    // Basic: four dent slots. Fine / ultra: all slots (and denser meshes, see wantedLod).
    const dents = this.quality.deform === 'basic' ? 4 : MAX_DENTS;
    for (const m of [v.material, v.shellMaterial]) {
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
    }
  }

  private create(toy: ToyBody, animate: boolean): void {
    const loaded = this.library.get(toy.asset.id);
    if (!loaded) return;
    const uniforms = createPlushUniforms();
    applyPaint(uniforms, toy.asset);
    uniforms.uSheen.value = this.quality.fur === 'flat' ? 0.35 : 1;
    uniforms.uFiber.value = this.quality.fur === 'flat' ? 0 : 1;
    const material = new PlushMaterial(uniforms);
    const depth = new PlushDepthMaterial(uniforms);
    const lod = Math.min(loaded.lods.length - 1, 1);
    const mesh = new Mesh(loaded.lods[lod]!, material);
    mesh.customDepthMaterial = depth;
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
      deformer: new PlushDeformer(uniforms, toy.asset),
      lod,
      vel: new Vector3(),
      accel: new Vector3(),
      held: 0,
      awake: true,
      appear: animate ? 0 : 1,
    };
    this.applyDeformDefines(v);
    this.visuals.set(toy.id, v);
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
    else if (q.lod === 'medium') lod = focus ? 0 : 1;
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
    if (fur === 'shell' && focus) layers = 10;
    else if (fur === 'shellHigh') {
      layers = focus ? 16 : 8;
      lod = focus ? v.lod : Math.max(v.lod, 1);
    }
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
      v.shellMaterial = new PlushMaterial(v.uniforms, { shell: true });
      this.applyDeformDefines(v);
    }
    v.uniforms.uShellLength.value = 0.0042;
    const shell = new InstancedMesh(geometry, v.shellMaterial, layers);
    shell.frustumCulled = false;
    shell.receiveShadow = true;
    shell.castShadow = false;
    v.shell = shell;
    v.root.add(shell);
  }

  /**
   * Per rendered frame: pose interpolation, LOD / fur selection and deformation.
   * `contacts` and `impacts` come straight from the physics step(s) of this frame.
   */
  update(alpha: number, dt: number, contacts: readonly ClawContact[], impacts: readonly ImpactEvent[], fixedDt: number): void {
    let triangles = 0;
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

      const focus = v.toy === this.focus || v.toy === this.heldToy;
      const lod = v.mesh.visible ? this.wantedLod(v, focus) : v.lod;
      if (lod !== v.lod) {
        const loaded = this.library.get(v.toy.asset.id);
        if (loaded) {
          v.mesh.geometry = loaded.lods[lod]!;
          v.lod = lod;
        }
      }
      if (v.mesh.visible) this.updateShell(v, focus);
      const index = v.mesh.geometry.getIndex();
      triangles += (index ? index.count / 3 : 0) * (1 + (v.shell ? v.shell.count : 0));

      // Velocity / acceleration from the fixed-step poses (world space), smoothed.
      const vx = (c[0]! - p[0]!) / fixedDt, vy = (c[1]! - p[1]!) / fixedDt, vz = (c[2]! - p[2]!) / fixedDt;
      const ax = (vx - v.vel.x) / safeDt, ay = (vy - v.vel.y) / safeDt, az = (vz - v.vel.z) / safeDt;
      v.vel.set(vx, vy, vz);
      const k = 1 - Math.exp(-safeDt / 0.05);
      v.accel.x += (ax - v.accel.x) * k;
      v.accel.y += (ay - v.accel.y) * k;
      v.accel.z += (az - v.accel.z) * k;
      const sleeping = v.toy.body.isSleeping();
      if (sleeping && !v.awake) continue;

      _q2.copy(v.root.quaternion).invert();
      _frame.gravity.set(0, -1, 0).applyQuaternion(_q2);
      _frame.accel.copy(v.accel).applyQuaternion(_q2).divideScalar(v.toy.scale);
      const heldTarget = v.toy === this.heldToy ? 1 : 0;
      v.held = damp(v.held, heldTarget, 0.1, safeDt);
      _frame.held = v.held < 0.003 ? 0 : v.held;
      _frame.grip.copy(this.gripLocal);
      v.deformer.intensity = this.reducedMotion ? 0.6 : 1;
      v.awake = v.deformer.update(safeDt, _frame) || !sleeping;
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
  }

  /** World position of a toy's visual (for effects). */
  positionOf(toy: ToyBody, out: Vector3): Vector3 | null {
    const v = this.visuals.get(toy.id);
    return v ? out.copy(v.root.position) : null;
  }

  /** Static display toys in the side bays (landscape). */
  setDisplay(slots: readonly DisplaySlot[], assets: readonly PlushAsset[]): void {
    for (const m of this.display) m.removeFromParent();
    this.display.length = 0;
    for (const m of this.displayMaterials) m.dispose();
    this.displayMaterials.length = 0;
    if (assets.length === 0) return;
    const perAsset = new Map<string, PlushMaterial>();
    slots.forEach((slot, i) => {
      const asset = assets[i % assets.length]!;
      const loaded = this.library.get(asset.id);
      if (!loaded) return;
      let material = perAsset.get(asset.id);
      if (!material) {
        const uniforms = createPlushUniforms();
        applyPaint(uniforms, asset);
        uniforms.uSheen.value = this.quality.fur === 'flat' ? 0.35 : 1;
        material = new PlushMaterial(uniforms, { dents: 1, deformNormals: false });
        perAsset.set(asset.id, material);
        this.displayMaterials.push(material);
      }
      const mesh = new Mesh(loaded.lods[Math.min(1, loaded.lods.length - 1)]!, material);
      mesh.position.set(slot.x, slot.y, slot.z);
      mesh.rotation.y = slot.yaw;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.display.push(mesh);
    });
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
    this.focus = null;
    this.heldToy = null;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
