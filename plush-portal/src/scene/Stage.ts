import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AgXToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  BackSide,
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
import { FIELD } from '../physics/fieldSpec';
import type { GraphicsSettings } from '../settings/spec';
import type { ThemeDef } from '../themes/themes';

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

const SHADOW_SIZE: Record<GraphicsSettings['shadows'], number> = { off: 0, low: 1024, medium: 2048, high: 4096 };

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
  private readonly pmrem: PMREMGenerator;
  private envTarget: WebGLRenderTarget | null = null;
  private readonly frontGlass: Mesh;
  private readonly frontGlassMaterial: ShaderMaterial;
  private graphics: GraphicsSettings;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private autoScale = 1;
  private msaa = 0;
  private theme: ThemeDef | null = null;
  private envTimer = 0;
  private envDirty = false;
  private composerDirty = true;
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
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;
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
    this.frontGlassMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uEye: { value: new Vector2(0, 0) }, uStrength: { value: 0.05 }, uTint: { value: new Color(0xffffff) }, uAspect: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec2 uEye;
        uniform float uStrength;
        uniform vec3 uTint;
        uniform float uAspect;
        void main() {
          vec2 p = vUv - 0.5;
          // Two soft diagonal streaks whose position follows the eye (reflections move with the viewer).
          float d = ( p.x * uAspect + p.y * 0.62 ) - uEye.x * 0.35 + uEye.y * 0.12;
          float streak = smoothstep( 0.2, 0.0, abs( d - 0.33 ) ) * 0.7 + smoothstep( 0.07, 0.0, abs( d - 0.52 ) );
          // Keep the middle of the window clear: reflections live near the edges.
          float edge = smoothstep( 0.18, 0.5, max( abs( p.x ), abs( p.y ) ) );
          float fresnel = pow( edge, 2.0 ) * 0.5;
          float a = ( streak * edge + fresnel ) * uStrength;
          gl_FragColor = vec4( uTint * a, 1.0 );
        }`,
    });
    this.frontGlass = new Mesh(new PlaneGeometry(1, 1), this.frontGlassMaterial);
    this.frontGlass.renderOrder = 50;
    this.frontGlass.frustumCulled = false;
    this.scene.add(this.frontGlass);

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
    if (shadowSize > 0 && this.key.shadow.mapSize.x !== shadowSize) {
      this.key.shadow.mapSize.set(shadowSize, shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.key.shadow.radius = graphics.shadows === 'high' ? 4 : graphics.shadows === 'medium' ? 3 : 2;

    if (needsComposer) this.buildComposer();
    else if (this.bloomPass) this.bloomPass.strength = 0.015 + graphics.bloom * 0.2;
    this.frontGlassMaterial.uniforms.uStrength!.value = graphics.glass === 'low' ? 0 : graphics.glass === 'medium' ? 0.045 : 0.07;
    this.frontGlass.visible = graphics.glass !== 'low';
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
    this.buildStudioEnvironment();
  }

  /** Small procedural "light box" room in the theme's colours, prefiltered for image based lighting. */
  private buildStudioEnvironment(): void {
    const theme = this.theme;
    if (!theme) return;
    const env = new Scene();
    const [top, wall, floor] = theme.lights.env;
    const room = new Mesh(new BoxGeometry(6, 4, 6), new MeshBasicMaterial({ color: wall, side: BackSide }));
    env.add(room);
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, gain: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(gain) }));
      m.position.set(x, y, z);
      env.add(m);
    };
    add(3.2, 0.05, 2.4, 0, 1.95, 0, top, 5.5); // ceiling soft box
    add(6, 0.05, 6, 0, -1.98, 0, floor, 0.9);
    add(0.05, 1.6, 2.2, -2.9, 0.3, 0.4, top, 2.2); // side strip
    add(0.05, 1.2, 1.4, 2.9, 0.1, -0.6, theme.cabinet.led[0]!, 2.6);
    add(1.6, 1.0, 0.05, 0.6, 0.4, 2.9, theme.cabinet.led[1 % theme.cabinet.led.length]!, 1.8);
    add(1.2, 0.5, 0.05, -1.2, 1.0, -2.9, theme.cabinet.led[2 % theme.cabinet.led.length]!, 2.2);
    const target = this.pmrem.fromScene(env, 0.035);
    this.setEnvironment(target);
    env.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
    });
  }

  private setEnvironment(target: WebGLRenderTarget): void {
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture as Texture;
  }

  /** Re-captures the reflections from the real cabinet interior ("refresh" / "live" reflection quality). */
  refreshEnvironmentFromScene(): void {
    if (this.graphics.reflections === 'static' || this.contextLost) return;
    const glassVisible = this.frontGlass.visible;
    this.frontGlass.visible = false;
    // Capture from the middle of the play volume; keep the studio map as the lighting while capturing.
    const target = this.pmrem.fromScene(this.scene, 0.02, 0.05, 20, { size: 128, position: this.captureOrigin });
    this.frontGlass.visible = glassVisible;
    this.setEnvironment(target);
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

  private applySize(): void {
    const g = this.graphics;
    let ratio = this.dpr * g.renderScale * this.autoScale;
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
  }

  /* --------------------------------------------------------------- render */

  render(dt: number): void {
    if (this.contextLost) return;
    if (this.composerDirty) this.buildComposer();
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
      this.buildStudioEnvironment();
    }
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /** Compiles every shader used by the scene now, so the first grab does not hitch. */
  async warmUp(): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  get msaaSamples(): number {
    return this.msaa;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    this.composer.dispose();
    this.aoPass?.dispose();
    this.bloomPass?.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.frontGlass.geometry.dispose();
    this.frontGlassMaterial.dispose();
    this.renderer.dispose();
  }
}
