import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AgXToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  VSMShadowMap,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type BufferGeometry,
  type Camera,
  type Object3D,
  type Texture,
} from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OffAxisCamera } from '../perspective/OffAxisCamera';
import type { WindowLayout } from '../perspective/windowGeometry';
import { CHUTE, FIELD } from '../physics/fieldSpec';
import type { GraphicsSettings } from '../settings/spec';
import type { ThemeDef } from '../themes/themes';
import { CONTACT_RANGE, ContactShadows } from './contactShadows';
import { buildStudioScene, captureSize, environmentBlur, studioEnvironmentSize } from './environment';
import { makeScratchTexture, setMaxAnisotropy } from './textures';

/** What is really being rendered right now (may differ from the selected preset). */
export interface EffectiveGraphics {
  /** Drawing buffer size of the 3D view in device pixels. */
  width: number;
  height: number;
  /** Internal pixels per CSS pixel. */
  pixelRatio: number;
  megapixels: number;
  shadows: GraphicsSettings['shadows'];
  ao: GraphicsSettings['ao'];
  aa: GraphicsSettings['aa'];
  bloom: number;
  glass: GraphicsSettings['glass'];
  reflections: GraphicsSettings['reflections'];
  particles: number;
  /** Extra scale applied by the automatic optimiser (1 = none). */
  autoScale: number;
}

/** Shadow map edge length per shadow quality. */
export const SHADOW_SIZE: Record<GraphicsSettings['shadows'], number> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/**
 * How the key light's shadow is filtered per shadow quality. Low / Medium use hardware PCF
 * (five rotated taps); High uses variance shadow maps blurred over a wide radius, which gives the
 * broad, noise-free penumbra of a cabinet lit by a large ceiling diffuser.
 */
export const SHADOW_FILTER: Record<Exclude<GraphicsSettings['shadows'], 'off'>, { type: 'pcf' | 'vsm'; radius: number; blurSamples: number }> = {
  low: { type: 'pcf', radius: 2, blurSamples: 0 },
  medium: { type: 'pcf', radius: 3.5, blurSamples: 0 },
  high: { type: 'vsm', radius: 14, blurSamples: 16 },
};

/** Contact-shadow map size and update interval (frames) per shadow quality; 0 = off. */
export const CONTACT_SHADOWS: Record<GraphicsSettings['shadows'], { size: number; every: number }> = {
  off: { size: 0, every: 0 },
  low: { size: 0, every: 0 },
  medium: { size: 256, every: 2 },
  high: { size: 512, every: 1 },
};

/**
 * Layer of the shadow pre-pass (see `Stage.renderShadows`): only lights are on it, so a render with
 * a camera that sees just this layer draws no object, only the key light's shadow map.
 */
const SHADOW_PASS_LAYER = 31;

/** Scene groups whose shadow-casting meshes are drawn into the contact-shadow map. */
const CONTACT_GROUPS = new Set(['toys', 'claw']);

/** Largest device pixel ratio honoured: the setting when present, otherwise unlimited. */
function dprCap(g: GraphicsSettings): number {
  const value = (g as { maxDpr?: number }).maxDpr;
  return typeof value === 'number' && value > 0 ? value : Infinity;
}

/**
 * Renderer, camera, lights, environment and post-processing. The 3D view is
 * rendered at its own internal resolution; the canvas always fills the screen
 * and the DOM HUD on top of it stays at native resolution.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OffAxisCamera();
  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private aoPass: GTAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private afterimagePass: AfterimagePass | null = null;
  private fxaaPass: FXAAPass | null = null;
  private smaaPass: SMAAPass | null = null;
  private readonly key: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly ledLights: PointLight[];
  private readonly binLight: PointLight;
  private pmrem: PMREMGenerator;
  /** Prefiltered procedural studio (always kept: it also lights the cabinet captures). */
  private studioTarget: WebGLRenderTarget | null = null;
  private studioSize = 0;
  /** Prefiltered capture of the real cabinet interior ('refresh' / 'live'). */
  private captureTarget: WebGLRenderTarget | null = null;
  private readonly frontGlass: Mesh;
  private readonly frontGlassMaterial: ShaderMaterial;
  /** Micro-scratch map of the front glass, created on first use (not on the phone tier). */
  private glassScratches: Texture | null = null;
  private readonly contact: ContactShadows;
  private contactFrame = 0;
  /** Camera of the shadow pre-pass: sees only `SHADOW_PASS_LAYER`. */
  private readonly shadowPassCamera = new PerspectiveCamera();
  /** Meshes drawn with their `userData.shadowGeometry` during the shadow passes, and their own geometry. */
  private readonly shadowSwapped: Mesh[] = [];
  private readonly shadowSwappedGeometry: BufferGeometry[] = [];
  private readonly shadowHidden: Object3D[] = [];
  private readonly clawBox = new Box3();
  /** Diagnostics: whether the contact map was re-rendered in the last frame. */
  contactRendered = false;
  private graphics: GraphicsSettings;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private autoScale = 1;
  private msaa = 0;
  private theme: ThemeDef | null = null;
  private envTimer = 0;
  private envDirty = false;
  private studioDirty = false;
  private composerDirty = true;
  private sizeDirty = true;
  /** Called when the internal render resolution actually changed. */
  onSize: ((width: number, height: number) => void) | null = null;
  readonly effective: EffectiveGraphics;
  contextLost = false;
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    graphics: GraphicsSettings,
  ) {
    this.graphics = { ...graphics };
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Updated explicitly once per frame (renderShadows), never as a side effect of a render: the
    // composer's extra scene passes (ambient occlusion, depth of field) would otherwise redraw it.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('webglcontextrestored', this.handleRestored);

    this.pmrem = new PMREMGenerator(this.renderer);

    // Key light: mostly from above (the ceiling light box), slightly from the front-left so faces are
    // lit and the claw's shadow falls almost straight below it — a natural aiming aid.
    this.key = new DirectionalLight(0xffffff, 2.6);
    this.key.position.set(-0.22, 1.9, 0.12);
    this.key.target.position.set(0, 0, -FIELD.depth / 2);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -0.72;
    sc.right = 0.72;
    sc.top = 0.62;
    sc.bottom = -0.62;
    sc.near = 0.4;
    sc.far = 3.4;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.006;
    this.key.shadow.radius = 3;
    // A lit cabinet never has pitch-black shadows: the diffuser and the walls fill them in.
    this.key.shadow.intensity = 0.88;
    // The shadow map is rendered once per frame by a pre-pass (renderShadows) that sees only the
    // lights; the shadow camera itself keeps drawing every layer-0 object.
    this.key.shadow.camera.layers.enable(SHADOW_PASS_LAYER);
    this.shadowPassCamera.layers.set(SHADOW_PASS_LAYER);
    this.scene.add(this.key, this.key.target);

    this.rim = new DirectionalLight(0xffffff, 1);
    this.rim.position.set(0.55, 0.9, -1.3);
    this.rim.target.position.set(0, 0.1, -0.4);
    this.scene.add(this.rim, this.rim.target);

    this.hemi = new HemisphereLight(0xffffff, 0xcccccc, 0.5);
    this.scene.add(this.hemi);

    this.ledLights = [-1, 1].map((sx) => {
      const light = new PointLight(0xffffff, 0.22, 0.9, 2);
      light.position.set(sx * 0.4, 0.07, -0.05);
      this.scene.add(light);
      return light;
    });
    this.binLight = new PointLight(0xfff0dd, 0.5, 1.2, 2);
    this.scene.add(this.binLight);

    // Front glass: a very subtle reflection that slides with the viewpoint and stays off the centre.
    // Where a reflection streak crosses them, faint micro-scratches and wipe marks catch the light.
    this.frontGlassMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uEye: { value: new Vector2(0, 0) },
        uStrength: { value: 0.05 },
        uTint: { value: new Color(0xffffff) },
        uAspect: { value: 1 },
        uScratch: { value: null as Texture | null },
        uScratchGain: { value: 0 },
        uScale: { value: new Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec2 uEye;
        uniform float uStrength;
        uniform vec3 uTint;
        uniform float uAspect;
        uniform sampler2D uScratch;
        uniform float uScratchGain;
        uniform vec2 uScale;
        void main() {
          vec2 p = vUv - 0.5;
          // Two soft diagonal streaks whose position follows the eye (reflections move with the viewer).
          float d = ( p.x * uAspect + p.y * 0.62 ) - uEye.x * 0.35 + uEye.y * 0.12;
          float streak = smoothstep( 0.2, 0.0, abs( d - 0.33 ) ) * 0.7 + smoothstep( 0.07, 0.0, abs( d - 0.52 ) );
          // Keep the middle of the window clear: reflections live near the edges.
          float edge = smoothstep( 0.18, 0.5, max( abs( p.x ), abs( p.y ) ) );
          float fresnel = pow( edge, 2.0 ) * 0.5;
          // Scratches only show where light grazes them: inside the streaks and towards the frame.
          float scratch = texture2D( uScratch, vUv * uScale ).r * uScratchGain * ( streak * 0.8 + edge * 0.35 );
          float a = ( streak * edge + fresnel + scratch ) * uStrength;
          gl_FragColor = vec4( uTint * a, 1.0 );
        }`,
    });
    this.frontGlass = new Mesh(new PlaneGeometry(1, 1), this.frontGlassMaterial);
    this.frontGlass.renderOrder = 50;
    this.frontGlass.frustumCulled = false;
    this.scene.add(this.frontGlass);

    this.contact = new ContactShadows(
      { minX: -FIELD.halfWidth, maxX: FIELD.halfWidth, minZ: -FIELD.depth, maxZ: 0, floorY: 0 },
      { minX: CHUTE.xMin, maxX: CHUTE.xMax, minZ: CHUTE.zMin, maxZ: CHUTE.zMax },
      256,
    );
    this.scene.add(this.contact.mesh);

    this.effective = {
      width: 1,
      height: 1,
      pixelRatio: 1,
      megapixels: 0,
      shadows: graphics.shadows,
      ao: graphics.ao,
      aa: graphics.aa,
      bloom: graphics.bloom,
      glass: graphics.glass,
      reflections: graphics.reflections,
      particles: graphics.particles,
      autoScale: 1,
    };
    this.buildComposer();
    this.applyGraphics(graphics);
  }

  private handleLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };

  private handleRestored = (): void => {
    this.contextLost = false;
    this.composerDirty = true;
    this.envDirty = true;
    this.studioDirty = true;
    this.contact.invalidate();
    // GPU objects of the old context are gone: start from fresh targets.
    this.pmrem.dispose();
    this.pmrem = new PMREMGenerator(this.renderer);
    this.studioTarget = null;
    this.captureTarget = null;
    this.onContextRestored?.();
  };

  /* ------------------------------------------------------------ composer */

  private buildComposer(): void {
    this.composer?.dispose();
    this.aoPass?.dispose();
    this.bloomPass?.dispose();
    this.smaaPass?.dispose();
    this.afterimagePass?.dispose();
    const g = this.graphics;
    const samples = g.aa === 'msaa4' ? 4 : g.aa === 'msaa2' ? 2 : 0;
    this.msaa = samples;
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: HalfFloatType, samples });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(Math.max(1, size.x), Math.max(1, size.y));
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);

    this.aoPass = null;
    if (g.ao !== 'off') {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: g.ao === 'high' ? 0.11 : 0.08, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: g.ao === 'high' ? 16 : 8, screenSpaceRadius: false });
      ao.blendIntensity = g.ao === 'high' ? 0.9 : 0.75;
      // Transparent panes and additive helpers must not occlude.
      const hidden: Object3D[] = [];
      const anyAo = ao as unknown as { _overrideVisibility: () => void; _restoreVisibility: () => void };
      const baseOverride = anyAo._overrideVisibility.bind(ao);
      const baseRestore = anyAo._restoreVisibility.bind(ao);
      anyAo._overrideVisibility = () => {
        baseOverride();
        this.scene.traverse((o) => {
          if (o.userData.skipAO && o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        });
      };
      anyAo._restoreVisibility = () => {
        baseRestore();
        for (const o of hidden) o.visible = true;
        hidden.length = 0;
      };
      composer.addPass(ao);
      this.aoPass = ao;
    }

    this.bloomPass = null;
    if (g.bloom > 0.01) {
      // Restrained bloom: only the LED strips and bright highlights glow.
      // The threshold sits above diffuse white, so only emissive strips and specular glints bloom.
      const bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.015 + g.bloom * 0.2, 0.35, 1.5);
      composer.addPass(bloom);
      this.bloomPass = bloom;
    }

    this.bokehPass = null;
    if (g.dof) {
      const bokeh = new BokehPass(this.scene, this.camera, { focus: 1.2, aperture: 0.0016, maxblur: 0.006 });
      composer.addPass(bokeh);
      this.bokehPass = bokeh;
    }

    this.afterimagePass = null;
    if (g.motionBlur) {
      const after = new AfterimagePass(0.72);
      composer.addPass(after);
      this.afterimagePass = after;
    }

    composer.addPass(new OutputPass());

    this.fxaaPass = null;
    this.smaaPass = null;
    if (g.aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      composer.addPass(this.fxaaPass);
    } else if (g.aa === 'smaa') {
      this.smaaPass = new SMAAPass();
      composer.addPass(this.smaaPass);
    }
    this.composer = composer;
    this.composerDirty = false;
    this.applySize();
  }

  /* ------------------------------------------------------------- settings */

  applyGraphics(graphics: GraphicsSettings): void {
    const prev = this.graphics;
    this.graphics = { ...graphics };
    const needsComposer =
      this.composerDirty ||
      prev.aa !== graphics.aa ||
      prev.ao !== graphics.ao ||
      prev.dof !== graphics.dof ||
      prev.motionBlur !== graphics.motionBlur ||
      prev.bloom > 0.01 !== graphics.bloom > 0.01;
    this.renderer.toneMapping = graphics.toneMapping === 'aces' ? ACESFilmicToneMapping : graphics.toneMapping === 'neutral' ? NeutralToneMapping : AgXToneMapping;
    this.renderer.toneMappingExposure = graphics.exposure * (this.theme?.lights.exposure ?? 1);

    const shadowSize = SHADOW_SIZE[graphics.shadows];
    this.key.castShadow = shadowSize > 0;
    if (graphics.shadows !== 'off') {
      const filter = SHADOW_FILTER[graphics.shadows];
      const type = filter.type === 'vsm' ? VSMShadowMap : PCFShadowMap;
      if (this.renderer.shadowMap.type !== type) this.renderer.shadowMap.type = type;
      if (this.key.shadow.mapSize.x !== shadowSize) {
        this.key.shadow.mapSize.set(shadowSize, shadowSize);
        this.key.shadow.map?.dispose();
        this.key.shadow.map = null;
      }
      this.key.shadow.radius = filter.radius;
      this.key.shadow.blurSamples = Math.max(1, filter.blurSamples);
      // VSM compares moments, not depths: it needs no depth bias but a little normal offset.
      this.key.shadow.bias = filter.type === 'vsm' ? -0.0002 : -0.0005;
    }
    const contact = CONTACT_SHADOWS[graphics.shadows];
    this.contact.mesh.visible = contact.size > 0;
    if (contact.size > 0) {
      this.contact.setResolution(contact.size);
      // Toys may have moved while contact shadows were off: draw a fresh map.
      this.contact.invalidate();
    }

    // Prefiltered environment resolution follows the texture tier (and the capture size while
    // the cabinet captures replace the studio, see studioEnvironmentSize).
    const envSize = studioEnvironmentSize(graphics.textures, graphics.reflections);
    if (envSize !== this.studioSize && this.theme) this.studioDirty = true;

    if (needsComposer) this.buildComposer();
    else if (this.bloomPass) this.bloomPass.strength = 0.015 + graphics.bloom * 0.2;
    this.frontGlassMaterial.uniforms.uStrength!.value = graphics.glass === 'low' ? 0 : graphics.glass === 'medium' ? 0.045 : 0.07;
    const scratches = graphics.textures !== '512';
    if (scratches && !this.glassScratches) {
      this.glassScratches = makeScratchTexture(1024, 41);
      this.frontGlassMaterial.uniforms.uScratch!.value = this.glassScratches;
    }
    this.frontGlassMaterial.uniforms.uScratchGain!.value = scratches ? 0.55 : 0;
    this.frontGlass.visible = graphics.glass !== 'low';
    if (prev.reflections !== graphics.reflections) this.envDirty = true;
    this.applySize();
    this.effective.shadows = graphics.shadows;
    this.effective.ao = graphics.ao;
    this.effective.aa = graphics.aa;
    this.effective.bloom = graphics.bloom;
    this.effective.glass = graphics.glass;
    this.effective.reflections = graphics.reflections;
    this.effective.particles = graphics.particles;
  }

  setTheme(theme: ThemeDef): void {
    this.theme = theme;
    const L = theme.lights;
    this.key.color.set(L.key);
    this.key.intensity = L.keyIntensity;
    this.rim.color.set(L.rim);
    this.rim.intensity = L.rimIntensity;
    this.hemi.color.set(L.sky);
    this.hemi.groundColor.set(L.ground);
    this.hemi.intensity = L.hemiIntensity;
    this.ledLights.forEach((light, i) => light.color.set(theme.cabinet.led[i % theme.cabinet.led.length]!));
    this.scene.environmentIntensity = L.envIntensity;
    this.renderer.toneMappingExposure = this.graphics.exposure * L.exposure;
    this.frontGlassMaterial.uniforms.uTint!.value.set(theme.backdrop.bokeh[0]!).lerp(new Color(0xffffff), 0.6);
    // Contact shadows take a deep shade of the mat colour rather than pure black.
    const dark = theme.cabinet.pattern === 'cosmos' || theme.cabinet.pattern === 'circuit';
    this.contact.setStyle(new Color(theme.cabinet.mat).multiplyScalar(dark ? 0.08 : 0.22), dark ? 0.78 : 0.62);
    this.buildStudioEnvironment();
  }

  /** The procedural studio for the current theme, prefiltered at the tier's resolution. */
  private buildStudioEnvironment(): void {
    const theme = this.theme;
    if (!theme || this.contextLost) return;
    this.studioDirty = false;
    const size = studioEnvironmentSize(this.graphics.textures, this.graphics.reflections);
    const studio = buildStudioScene(theme);
    const target = this.pmrem.fromScene(studio.scene, environmentBlur(size), 0.1, 40, { size });
    studio.dispose();
    this.studioTarget?.dispose();
    this.studioTarget = target;
    this.studioSize = size;
    // A large source cube is only needed while prefiltering; free it now (Ultra: ~90 MB).
    if (size > 512) {
      this.pmrem.dispose();
      this.pmrem = new PMREMGenerator(this.renderer);
    }
    this.useEnvironment();
  }

  /** Points the scene at the capture when there is one (and reflections want it), else at the studio. */
  private useEnvironment(): void {
    const capture = this.graphics.reflections !== 'static' ? this.captureTarget : null;
    const target = capture ?? this.studioTarget;
    this.scene.environment = target ? (target.texture as Texture) : null;
  }

  /** Re-captures the reflections from the real cabinet interior ("refresh" / "live" reflection quality). */
  refreshEnvironmentFromScene(): void {
    const mode = this.graphics.reflections;
    if (mode === 'static' || this.contextLost || !this.studioTarget) return;
    const glassVisible = this.frontGlass.visible;
    const autoShadow = this.renderer.shadowMap.autoUpdate;
    this.frontGlass.visible = false;
    // Light the capture with the studio (never with the previous capture: no feedback), and reuse
    // this frame's shadow map instead of re-rendering it for each of the six faces.
    this.scene.environment = this.studioTarget.texture as Texture;
    this.renderer.shadowMap.autoUpdate = false;
    const size = captureSize(this.graphics.textures, mode);
    const target = this.pmrem.fromScene(this.scene, 0.02, 0.05, 20, { size, position: this.captureOrigin });
    this.renderer.shadowMap.autoUpdate = autoShadow;
    this.frontGlass.visible = glassVisible;
    this.captureTarget?.dispose();
    this.captureTarget = target;
    this.useEnvironment();
  }
  private readonly captureOrigin = new Vector3(0, 0.42, -FIELD.depth / 2);

  requestEnvironmentRefresh(): void {
    this.envDirty = true;
  }

  setLayout(layout: WindowLayout): void {
    this.camera.setWindow(0, layout.centerY, 0, layout.width, layout.height);
    this.frontGlass.position.set(0, layout.centerY, -0.0006);
    this.frontGlass.scale.set(layout.width, layout.height, 1);
    this.frontGlassMaterial.uniforms.uAspect!.value = layout.aspect;
    // Scratch texture at a constant physical size (one tile ≈ 0.45 m).
    (this.frontGlassMaterial.uniforms.uScale!.value as Vector2).set(layout.width / 0.45, layout.height / 0.45);
    this.binLight.position.set(-0.3, layout.binFloorY + 0.32, -0.14);
    // The shadow camera covers the play field plus the nearer part of the side bays.
    const reach = Math.min(1.25, 0.6 + layout.sideBay);
    this.key.shadow.camera.left = -reach;
    this.key.shadow.camera.right = reach;
    this.key.shadow.camera.updateProjectionMatrix();
  }

  setEyeWorld(x: number, y: number, z: number): void {
    this.camera.setEyeWorld(x, y, z);
    const w = this.camera.getWindow();
    this.frontGlassMaterial.uniforms.uEye!.value.set((x - w.x) / w.width, (y - w.y) / w.height);
    if (this.bokehPass) {
      const u = (this.bokehPass as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
      u.focus!.value = z + FIELD.depth * 0.5;
    }
  }

  /* ----------------------------------------------------------------- size */

  /** CSS size of the canvas and the device pixel ratio (physical output resolution). */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, Math.round(cssW));
    this.cssH = Math.max(1, Math.round(cssH));
    this.dpr = Math.max(0.5, dpr);
    this.applySize();
  }

  /** Extra resolution scale chosen by the automatic optimiser (≤ 1). */
  setAutoScale(scale: number): void {
    if (Math.abs(scale - this.autoScale) < 1e-3) return;
    this.autoScale = scale;
    this.applySize();
  }

  /**
   * Requests a new internal resolution. Resizing a canvas clears it, so the change is applied at
   * the start of the next rendered frame: a resize that arrived after this frame's render (the
   * automatic optimiser, a ResizeObserver callback) would otherwise show one blank frame.
   */
  private applySize(): void {
    this.sizeDirty = true;
  }

  private flushSize(): void {
    this.sizeDirty = false;
    const g = this.graphics;
    // Device pixel ratio cap (phones report 3 and more), then render scale and optimiser scale.
    let ratio = Math.min(this.dpr, dprCap(g)) * g.renderScale * this.autoScale;
    // Pixel budget: clamp the internal resolution without touching the canvas' CSS size.
    const pixels = this.cssW * this.cssH * ratio * ratio;
    const budget = g.maxPixels * 1e6;
    if (pixels > budget) ratio *= Math.sqrt(budget / pixels);
    ratio = Math.max(0.2, ratio);
    const w = Math.max(2, Math.round(this.cssW * ratio));
    const h = Math.max(2, Math.round(this.cssH * ratio));
    if (w === this.effective.width && h === this.effective.height && !this.composerDirty) {
      this.effective.autoScale = this.autoScale;
      return;
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.effective.width = w;
    this.effective.height = h;
    this.effective.pixelRatio = w / this.cssW;
    this.effective.megapixels = (w * h) / 1e6;
    this.effective.autoScale = this.autoScale;
    // Never let the camera fall back to a symmetric frustum after a resize.
    this.camera.updateProjectionMatrix();
    this.onSize?.(w, h);
  }

  /* --------------------------------------------------------------- render */

  private readonly contactRoots: Object3D[] = [];

  render(dt: number): void {
    if (this.contextLost) return;
    if (this.composerDirty) this.buildComposer();
    if (this.sizeDirty) this.flushSize();
    if (this.studioDirty) this.buildStudioEnvironment();
    if (this.graphics.reflections !== 'static') {
      this.envTimer += dt;
      const interval = this.graphics.reflections === 'live' ? 0.75 : Infinity;
      if (this.envDirty || this.envTimer > interval) {
        this.envDirty = false;
        this.envTimer = 0;
        this.refreshEnvironmentFromScene();
      }
    } else if (this.envDirty) {
      this.envDirty = false;
      // Back to the studio: drop the capture.
      this.captureTarget?.dispose();
      this.captureTarget = null;
      this.useEnvironment();
    }
    this.renderer.info.reset();
    this.contactRendered = false;
    this.contactRoots.length = 0;
    for (const child of this.scene.children) if (CONTACT_GROUPS.has(child.name)) this.contactRoots.push(child);
    // View-dependent choices (toy LODs) for the camera that is about to render.
    this.camera.updateMatrixWorld();
    for (const root of this.contactRoots) (root.userData.onView as ((camera: Camera, height: number) => void) | undefined)?.(this.camera, this.effective.height);
    // Shadow map and contact map, drawn with the toys' coarse shadow meshes.
    this.useShadowGeometry(true);
    try {
      this.renderShadows();
      const contact = CONTACT_SHADOWS[this.graphics.shadows];
      if (contact.size > 0 && this.contact.mesh.visible && ++this.contactFrame >= contact.every) {
        this.contactFrame = 0;
        this.contactRendered = this.contact.refresh(this.renderer, this.scene, this.contactRoots, this.contactSignature());
      }
    } finally {
      this.useShadowGeometry(false);
    }
    this.composer.render(dt);
  }

  /**
   * Draws the key light's shadow map, once per frame: a render with a camera that sees only the
   * lights (no object is drawn, nothing is cleared) makes three.js update the shadow map, which the
   * composer's passes then read without redrawing it.
   */
  private renderShadows(): void {
    if (!this.key.castShadow) return;
    const renderer = this.renderer;
    // Every light is visible to the pre-pass too: three.js recompiles nothing when the light set of
    // two consecutive renders is the same, but re-evaluates every lit material when it differs.
    this.scene.traverse(this.lightOnShadowLayer);
    const background = this.scene.background;
    const autoClear = renderer.autoClear;
    this.scene.background = null;
    renderer.autoClear = false;
    renderer.shadowMap.needsUpdate = true;
    try {
      renderer.render(this.scene, this.shadowPassCamera);
    } finally {
      renderer.autoClear = autoClear;
      this.scene.background = background;
    }
  }

  /**
   * Shadow passes (key-light map, contact map) draw meshes that carry `userData.shadowGeometry`
   * (toys: a coarse LOD) with that geometry, and leave out meshes marked `userData.shadowSkip`
   * (fur shells). `on = false` restores everything.
   */
  private useShadowGeometry(on: boolean): void {
    if (!on) {
      for (let i = 0; i < this.shadowSwapped.length; i++) this.shadowSwapped[i]!.geometry = this.shadowSwappedGeometry[i]!;
      for (const o of this.shadowHidden) o.visible = true;
      this.shadowSwapped.length = 0;
      this.shadowSwappedGeometry.length = 0;
      this.shadowHidden.length = 0;
      return;
    }
    for (const root of this.contactRoots) root.traverse(this.swapForShadow);
  }

  private readonly lightOnShadowLayer = (o: Object3D): void => {
    if ((o as { isLight?: boolean }).isLight) o.layers.enable(SHADOW_PASS_LAYER);
  };

  private readonly swapForShadow = (o: Object3D): void => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (mesh.userData.shadowSkip) {
      mesh.visible = false;
      this.shadowHidden.push(mesh);
      return;
    }
    const geometry = mesh.userData.shadowGeometry as BufferGeometry | undefined;
    if (!geometry || geometry === mesh.geometry) return;
    this.shadowSwapped.push(mesh);
    this.shadowSwappedGeometry.push(mesh.geometry);
    mesh.geometry = geometry;
  };

  /**
   * A number that changes whenever the contact map would look different: the toys' change counter
   * (`userData.contactVersion`, bumped by ToyVisuals when a toy moves or deforms) and, while any
   * part of the claw is low enough to darken the floor, the claw's pose.
   */
  private contactSignature(): number {
    let signature = 0;
    for (const root of this.contactRoots) {
      if (root.name === 'toys') {
        const version = root.userData.contactVersion;
        // Without a change counter the map is re-rendered every time.
        signature += typeof version === 'number' ? version * 7919 : Number.NaN;
        continue;
      }
      root.updateMatrixWorld();
      this.clawBox.setFromObject(root);
      if (this.clawBox.isEmpty() || this.clawBox.min.y > CONTACT_RANGE + 0.01) continue; // too high to darken the floor
      let k = 1;
      root.traverse((o) => {
        if (!(o as Mesh).isMesh || !o.visible || !o.castShadow) return;
        const e = o.matrixWorld.elements;
        for (let i = 0; i < 16; i++) signature += e[i]! * (k + i * 0.618);
        k += 1.37;
      });
    }
    return signature;
  }

  /**
   * Compiles every shader used by the scene now, so the first grab does not hitch. Materials are
   * compiled against the composer's half-float scene target, which is where the scene is really
   * drawn: three.js keys programs by output colour space and tone mapping, and a compile against
   * the canvas would build variants that are never used (and the real ones on the first frame).
   */
  async warmUp(): Promise<void> {
    if (this.contextLost) return;
    if (this.composerDirty) this.buildComposer();
    if (this.sizeDirty) this.flushSize();
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const pending: Promise<unknown>[] = [];
    // Objects that appear only later (fur shells of a focused toy), offered by the scene groups.
    const extra: Object3D[] = [];
    for (const child of this.scene.children) {
      const offer = child.userData.warmUpObjects as (() => Object3D[]) | undefined;
      if (offer) extra.push(...offer());
    }
    // compileAsync builds the programs synchronously (with the target set) and then waits for them.
    renderer.setRenderTarget(this.composer.readBuffer);
    try {
      pending.push(renderer.compileAsync(this.scene, this.camera));
      for (const object of extra) pending.push(renderer.compileAsync(object, this.camera, this.scene));
      // Height materials of the contact pass (binds its own target): the claw's is otherwise built
      // the first time the claw comes down to the toys.
      if (CONTACT_SHADOWS[this.graphics.shadows].size > 0 && this.contact.mesh.visible) {
        const roots = this.scene.children.filter((child) => CONTACT_GROUPS.has(child.name));
        pending.push(this.contact.compile(renderer, this.scene, roots));
      }
    } catch {
      renderer.compile(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    await Promise.all(pending);
    for (const object of extra) (object as { dispose?: () => void }).dispose?.();
  }

  get msaaSamples(): number {
    return this.msaa;
  }

  /** Diagnostic snapshot of the lighting configuration (debug API, performance notes). */
  lightingInfo(): { environment: number; capture: number; shadowMap: number; shadowFilter: string; contact: number } {
    const s = this.graphics.shadows;
    return {
      environment: this.studioSize,
      capture: this.captureTarget ? this.captureTarget.width : 0,
      shadowMap: SHADOW_SIZE[s],
      shadowFilter: s === 'off' ? 'off' : SHADOW_FILTER[s].type,
      contact: CONTACT_SHADOWS[s].size,
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    this.composer.dispose();
    this.aoPass?.dispose();
    this.bloomPass?.dispose();
    this.studioTarget?.dispose();
    this.captureTarget?.dispose();
    this.pmrem.dispose();
    this.contact.dispose();
    this.glassScratches?.dispose();
    this.frontGlass.geometry.dispose();
    this.frontGlassMaterial.dispose();
    this.renderer.dispose();
  }
}
