import {
  Color,
  CustomBlending,
  DoubleSide,
  MaxEquation,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

/** Height above the floor (m) over which an object still darkens the floor beneath it. */
export const CONTACT_RANGE = 0.2;

/** Blur spreads (texels) of the two separable blur passes: wide, then narrow. */
const BLUR_SPREADS = [2.2, 1] as const;

/** Darkness a surface at `height` metres above the floor writes into the contact map (0..1). */
export function contactDarkness(height: number, range = CONTACT_RANGE): number {
  if (height < -0.01 || height > range) return 0;
  const t = 1 - Math.max(0, height) / range;
  return t * t;
}

/**
 * Contact shadows / ambient occlusion on the play floor: everything that casts shadows in the
 * groups passed to update() (the toys and the claw) is rendered from below into a small
 * height-coded map, blurred, and laid over the mat as a soft darkening. Lower surfaces darken
 * more, so a toy sitting on the mat gets a tight dark rim and a hovering claw a faint, wide one.
 * One extra render of those groups at 256² or 512² plus four tiny blur passes.
 */
export class ContactShadows {
  readonly mesh: Mesh;
  private readonly camera: OrthographicCamera;
  private target: WebGLRenderTarget;
  private blurTarget: WebGLRenderTarget;
  private readonly heightMaterial: ShaderMaterial;
  private readonly displayMaterial: ShaderMaterial;
  private readonly blurH = new ShaderMaterial(HorizontalBlurShader);
  private readonly blurV = new ShaderMaterial(VerticalBlurShader);
  private readonly quad = new FullScreenQuad();
  private resolution = 0;
  private readonly hidden: Object3D[] = [];
  /** Scratch state reused every update (no per-frame allocations). */
  private readonly prevClearColor = new Color();
  private readonly hideNonCasters = (o: Object3D): void => {
    if ((o as Mesh).isMesh && o.visible && !o.castShadow) {
      o.visible = false;
      this.hidden.push(o);
    }
  };

  /**
   * @param minX,maxX,minZ,maxZ  floor rectangle covered (world metres)
   * @param floorY               height of the floor surface
   * @param hole                 rectangle without floor (the prize chute): never darkened
   */
  constructor(
    private readonly rect: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number },
    hole: { minX: number; maxX: number; minZ: number; maxZ: number },
    resolution: number,
  ) {
    const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
    // Looking straight up from the floor: camera x = world x, camera up = world +z.
    this.camera = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, CONTACT_RANGE);
    this.camera.position.set((rect.minX + rect.maxX) / 2, rect.floorY - 0.004, (rect.minZ + rect.maxZ) / 2);
    this.camera.rotation.set(Math.PI / 2, 0, 0);
    this.camera.updateMatrixWorld();

    this.heightMaterial = new ShaderMaterial({
      side: DoubleSide,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendEquationAlpha: MaxEquation,
      depthTest: false,
      depthWrite: false,
      uniforms: { uFloor: { value: rect.floorY }, uRange: { value: CONTACT_RANGE } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <batching_pars_vertex>
        #include <morphtarget_pars_vertex>
        #include <skinning_pars_vertex>
        varying float vHeight;
        uniform float uFloor;
        void main() {
          #include <batching_vertex>
          #include <skinbase_vertex>
          #include <morphinstance_vertex>
          #include <begin_vertex>
          #include <morphtarget_vertex>
          #include <skinning_vertex>
          #include <project_vertex>
          vec4 wp = vec4( transformed, 1.0 );
          #ifdef USE_BATCHING
            wp = batchingMatrix * wp;
          #endif
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vHeight = ( modelMatrix * wp ).y - uFloor;
        }`,
      fragmentShader: /* glsl */ `
        varying float vHeight;
        uniform float uRange;
        void main() {
          if ( vHeight < -0.01 || vHeight > uRange ) discard;
          float t = 1.0 - max( vHeight, 0.0 ) / uRange;
          gl_FragColor = vec4( t * t, 0.0, 0.0, 1.0 );
        }`,
    });

    this.displayMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uMap: { value: null },
        uColor: { value: new Color(0x000000) },
        uOpacity: { value: 0.6 },
        uRect: { value: [rect.minX, rect.minZ, w, d] },
        uHole: { value: [hole.minX, hole.minZ, hole.maxX, hole.maxZ] },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform vec4 uRect;
        uniform vec4 uHole;
        void main() {
          vec2 uv = ( vWorld.xz - uRect.xy ) / uRect.zw;
          float a = texture2D( uMap, uv ).r;
          // Fade out towards the field edges so the effect never shows a seam.
          vec2 e = min( uv, 1.0 - uv );
          a *= smoothstep( 0.0, 0.02, min( e.x, e.y ) );
          if ( vWorld.x > uHole.x && vWorld.x < uHole.z && vWorld.z > uHole.y && vWorld.z < uHole.w ) a = 0.0;
          gl_FragColor = vec4( uColor, a * uOpacity );
        }`,
    });

    const plane = new PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(plane, this.displayMaterial);
    this.mesh.position.set((rect.minX + rect.maxX) / 2, rect.floorY + 0.0012, (rect.minZ + rect.maxZ) / 2);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'contactShadows';
    this.mesh.userData.skipAO = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    this.target = new WebGLRenderTarget(1, 1);
    this.blurTarget = new WebGLRenderTarget(1, 1);
    this.setResolution(resolution);
  }

  setResolution(resolution: number): void {
    if (resolution === this.resolution) return;
    this.resolution = resolution;
    // Keep the texel aspect square-ish over the field.
    const w = this.rect.maxX - this.rect.minX, d = this.rect.maxZ - this.rect.minZ;
    const rw = resolution, rh = Math.max(16, Math.round((resolution * d) / w));
    this.target.setSize(rw, rh);
    this.blurTarget.setSize(rw, rh);
    this.displayMaterial.uniforms.uMap!.value = this.target.texture;
  }

  setStyle(color: Color, opacity: number): void {
    (this.displayMaterial.uniforms.uColor!.value as Color).copy(color);
    this.displayMaterial.uniforms.uOpacity!.value = opacity;
  }

  /**
   * Re-renders the map. Only shadow-casting meshes inside `include` are drawn; every other
   * top-level child of the scene that is not a light is hidden for the pass.
   */
  update(renderer: WebGLRenderer, scene: Scene, include: Object3D[]): void {
    const hidden = this.hidden;
    for (const child of scene.children) {
      if (!child.visible || (child as { isLight?: boolean }).isLight || include.includes(child)) continue;
      child.visible = false;
      hidden.push(child);
    }
    for (const root of include) root.traverse(this.hideNonCasters);
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoShadow = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearAlpha();
    const prevClearColor = renderer.getClearColor(this.prevClearColor);
    const prevBackground = scene.background;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.heightMaterial;
    scene.background = null;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    for (const o of hidden) o.visible = true;
    hidden.length = 0;

    // Two separable blur passes: wide, then narrow.
    const texel = 1 / this.resolution;
    for (const spread of BLUR_SPREADS) {
      this.blurH.uniforms.tDiffuse!.value = this.target.texture;
      this.blurH.uniforms.h!.value = texel * spread;
      this.quad.material = this.blurH;
      renderer.setRenderTarget(this.blurTarget);
      this.quad.render(renderer);
      this.blurV.uniforms.tDiffuse!.value = this.blurTarget.texture;
      // Texels are square in world units (see setResolution), so the same spread in texels.
      this.blurV.uniforms.v!.value = spread / this.target.height;
      this.quad.material = this.blurV;
      renderer.setRenderTarget(this.target);
      this.quad.render(renderer);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClear);
    renderer.shadowMap.autoUpdate = prevAutoShadow;
  }

  dispose(): void {
    this.target.dispose();
    this.blurTarget.dispose();
    this.heightMaterial.dispose();
    this.displayMaterial.dispose();
    this.blurH.dispose();
    this.blurV.dispose();
    this.quad.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
