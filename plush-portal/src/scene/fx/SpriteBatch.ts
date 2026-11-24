import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
} from 'three';
import { FX_FRAGMENT, FX_VERTEX } from './shaders';

interface Range {
  start: number;
  count: number;
}

/**
 * A fixed-capacity batch of instanced sprite quads: one mesh, one draw call.
 * Instances are written front to back every frame (`begin` → `push` … → `end`);
 * only the used part of each attribute is uploaded.
 */
export class SpriteBatch {
  readonly mesh: Mesh;
  readonly capacity: number;
  readonly material: ShaderMaterial;
  readonly kind: 'light' | 'paper';
  /** Instances written since `begin`. */
  n = 0;
  /** Pushes refused because the batch was full (since construction). */
  overflow = 0;
  /** Instances drawn by the main view (set by `end`). */
  private drawn = 0;
  private readonly geometry: InstancedBufferGeometry;
  private readonly pos: Float32Array;
  private readonly axis: Float32Array;
  private readonly color: Float32Array;
  private readonly meta: Float32Array;
  private readonly attrs: InstancedBufferAttribute[];
  /** One reusable update range per attribute (no allocation per frame). */
  private readonly ranges: Range[];

  /** `light` batches cover the background by at most their per-instance cover; `paper` sprites are opaque. */
  constructor(capacity: number, kind: 'light' | 'paper', renderOrder: number, name: string) {
    this.capacity = capacity;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(capacity * 4);
    this.axis = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    this.meta = new Float32Array(capacity * 3);
    const make = (array: Float32Array, size: number) => {
      const attr = new InstancedBufferAttribute(array, size);
      attr.setUsage(DynamicDrawUsage);
      return attr;
    };
    this.attrs = [make(this.pos, 4), make(this.axis, 4), make(this.color, 4), make(this.meta, 3)];
    geometry.setAttribute('iPos', this.attrs[0]!);
    geometry.setAttribute('iAxis', this.attrs[1]!);
    geometry.setAttribute('iColor', this.attrs[2]!);
    geometry.setAttribute('iMeta', this.attrs[3]!);
    geometry.instanceCount = 0;
    this.ranges = this.attrs.map(() => ({ start: 0, count: 0 }));
    this.geometry = geometry;

    this.material = new ShaderMaterial({
      name: `fx-${name}`,
      uniforms: { uTime: { value: 0 }, uCoverGain: { value: 1 } },
      vertexShader: FX_VERTEX,
      fragmentShader: FX_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Flat quads seen from above and half of the axial quads face away from the camera.
      side: DoubleSide,
      // One pass with culling off. Without this three draws transparent double-sided meshes twice
      // (back faces, then front faces) and flags the material for a program check each time.
      forceSinglePass: true,
      // Premultiplied: colour is added, the background is hidden by alpha × cover (see shaders.ts).
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      toneMapped: true,
    });
    this.kind = kind;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = `fx-${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    // Transparent helpers must not take part in ambient occlusion or reflection captures.
    this.mesh.userData.skipAO = true;
    this.mesh.userData.skipEnv = true;
    // Effects belong to the main view only. Override-material passes (depth of field depth, AO
    // normals) would draw the bare unit quads as 2 m squares over the window, and reflection
    // captures (cube render targets) would freeze sparkles and light beams into the reflections.
    this.mesh.onBeforeRender = (renderer, _scene, _camera, _geometry, material) => {
      const target = renderer.getRenderTarget() as { isWebGLCubeRenderTarget?: boolean } | null;
      if (material !== this.material || target?.isWebGLCubeRenderTarget === true) geometry.instanceCount = 0;
    };
    this.mesh.onAfterRender = () => {
      geometry.instanceCount = this.drawn;
    };
  }

  begin(): void {
    this.n = 0;
  }

  get full(): boolean {
    return this.n >= this.capacity;
  }

  /**
   * Adds one instance. Billboard / flat: (e0, e1, e2) = (extra0, extra1, unused), `rot` = rotation.
   * Axial: (e0, e1, e2) = axis, `rot` = phase, `size` = start half-width, `aux` = end half-width.
   * `cover` 0 = pure additive light … 1 = opaque (paper).
   */
  push(
    x: number, y: number, z: number,
    e0: number, e1: number, e2: number,
    r: number, g: number, b: number, a: number,
    size: number, rot: number, code: number, aux: number, cover: number,
  ): boolean {
    if (this.n >= this.capacity) {
      this.overflow++;
      return false;
    }
    const i = this.n++;
    const o4 = i * 4;
    const p = this.pos;
    p[o4] = x;
    p[o4 + 1] = y;
    p[o4 + 2] = z;
    p[o4 + 3] = size;
    const ax = this.axis;
    ax[o4] = e0;
    ax[o4 + 1] = e1;
    ax[o4 + 2] = e2;
    ax[o4 + 3] = rot;
    const c = this.color;
    c[o4] = r;
    c[o4 + 1] = g;
    c[o4 + 2] = b;
    c[o4 + 3] = a;
    const m = this.meta;
    m[i * 3] = code;
    m[i * 3 + 1] = aux;
    m[i * 3 + 2] = cover;
    return true;
  }

  /** Scales the cover of light sprites (bright cabinets need more, dark ones less). */
  setCoverGain(gain: number): void {
    this.material.uniforms.uCoverGain!.value = gain;
  }

  end(time: number): void {
    const n = this.n;
    this.drawn = n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.material.uniforms.uTime!.value = time;
    if (n === 0) return;
    for (let k = 0; k < this.attrs.length; k++) {
      const attr = this.attrs[k]!;
      const range = this.ranges[k]!;
      range.start = 0;
      range.count = n * attr.itemSize;
      attr.updateRanges.length = 0;
      attr.updateRanges.push(range);
      attr.needsUpdate = true;
    }
  }

  /** Typed arrays behind the attributes (tests check that nothing is reallocated). */
  buffers(): readonly Float32Array[] {
    return [this.pos, this.axis, this.color, this.meta];
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
