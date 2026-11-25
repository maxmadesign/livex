import {
  Color,
  CustomBlending,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector2,
  type Material,
  type Texture,
} from 'three';
import type { ThemeDef } from '../themes/themes';
import { sceneInk, sceneKit, sceneParts } from './brandScene';
import { finiteStatement } from './finiteGuard';
import { BrandWall } from './ledWall';
import { textureBytes } from './texgen';
import {
  detailSize,
  makeBadgeTexture,
  makeBraidNormal,
  makeBrushedMaps,
  makeDecalAtlas,
  makeFlakeNormal,
  makeMatNormal,
  makeMatTexture,
  makePatternTexture,
  makeQuiltNormal,
  makeRowSignTexture,
  makeScratchTexture,
  makeShadeTexture,
  makeSignTexture,
  makeStippleNormal,
  makeVeilTexture,
  textureSize,
  type TextureTier,
} from './textures';

export type GlassQuality = 'low' | 'medium' | 'high';

/** 0 = Safe (phones) … 3 = Ultra. Drives texture sizes, material features and cabinet / claw tessellation. */
export type DetailLevel = 0 | 1 | 2 | 3;
export function detailLevel(tier: TextureTier): DetailLevel {
  return tier === '512' ? 0 : tier === '1k' ? 1 : tier === '2k' ? 2 : 3;
}

/** Texels per metre of world-projected UVs (box / axis mapping, see Cabinet.ts). */
export const UV_DENSITY = { lacquer: 6, metal: 3, scratch: 2.2 } as const;

/**
 * Glass and acrylic: specular reflections are added at full strength while only the body
 * colour is attenuated by the opacity (premultiplied blending), the pane turns more opaque and
 * takes the edge tint at grazing angles (Fresnel), and micro-scratches (R channel of the
 * roughness map) catch a little light. Without this, three.js scales reflections by the opacity
 * too, which makes thin panes look matte.
 */
function makeGlassy(m: MeshPhysicalMaterial, edgeTint: Color, edgeAmount: number): void {
  const uniforms = { uEdgeTint: { value: edgeTint }, uEdgeAmount: { value: edgeAmount } };
  m.userData.glass = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEdgeTint;\nuniform float uEdgeAmount;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        #ifdef GLASS_PREMUL
          float gNV = saturate( dot( geometryNormal, geometryViewDir ) );
          float gF = pow( 1.0 - gNV, 4.0 );
          float gScratch = 0.0;
          #ifdef USE_ROUGHNESSMAP
            gScratch = texture2D( roughnessMap, vRoughnessMapUv ).r;
          #endif
          // Coverage grows towards grazing angles (less light passes, the reflection takes over);
          // the faint body haze does not, so a pane seen edge-on stays clear rather than milky.
          float gA = clamp( diffuseColor.a + gF * uEdgeAmount + gScratch * 0.035, 0.0, 1.0 );
          vec3 gBody = ( totalDiffuse + totalEmissiveRadiance ) * diffuseColor.a + uEdgeTint * gF * uEdgeAmount * 0.12;
          vec3 gOut = gBody + totalSpecular;
          ${finiteStatement('gOut')}
          gl_FragColor = vec4( gOut, gA );
        #else
          #include <opaque_fragment>
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'glassy';
  setPremultiplied(m, true);
}

/**
 * Anisotropic metals (brushed steel, anodised aluminium) without a tangent attribute: three.js builds
 * the tangent frame from screen-space UV derivatives, scales T and B by one common factor and returns
 * zero vectors where the UVs do not change across a pixel. With such a frame the anisotropic GGX
 * distribution is unbounded at grazing angles (D grows like 1 / dotNH^4): on the phone view a few
 * pixels of the claw's anodised knuckles, lit by the viewer light, reached about 1e5, overflowed the
 * half-float scene target to Inf / NaN, and the bloom spread that over the whole frame (one colour
 * channel lost). This rebuilds an orthonormal frame around the shading normal that keeps the brush
 * direction, so the highlight stays bounded (D ≤ 1 / (π αT αB)) and looks the same elsewhere.
 */
export const ANISOTROPY_FRAME_GLSL = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_ANISOTROPY
  {
    vec3 aT = material.anisotropyT - normal * dot( normal, material.anisotropyT );
    float aLen = length( aT );
    vec3 aSide = abs( normal.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
    aT = aLen > 1e-5 ? aT / aLen : normalize( cross( normal, aSide ) );
    material.anisotropyT = aT;
    material.anisotropyB = cross( normal, aT );
  }
#endif
`;

export function boundAnisotropy<T extends MeshPhysicalMaterial>(m: T): T {
  const previous = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    previous.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', ANISOTROPY_FRAME_GLSL);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|aniso-frame`;
  return m;
}

function setPremultiplied(m: MeshPhysicalMaterial, on: boolean): void {
  m.defines = m.defines ?? {};
  if (on) {
    m.defines.GLASS_PREMUL = '';
    m.blending = CustomBlending;
    m.blendSrc = OneFactor;
    m.blendDst = OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = OneFactor;
    m.blendDstAlpha = OneMinusSrcAlphaFactor;
  } else {
    delete m.defines.GLASS_PREMUL;
    m.blending = NormalBlending;
  }
}

/** Callback run every frame by updateLeds (cabinet animations such as spinning fans). */
export type Animator = (time: number, reducedMotion: boolean) => void;

/** Shared materials of the cabinet for one theme. Created once per theme and disposed on theme change. */
export class CabinetMaterials {
  readonly detail: DetailLevel;
  readonly enamel: MeshStandardMaterial;
  readonly accent: MeshStandardMaterial;
  readonly chrome: MeshStandardMaterial;
  readonly brushed: MeshStandardMaterial;
  /** Coloured anodised aluminium (gantry carriages, claw knuckles, fan frames). */
  readonly anodised: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly plastic: MeshStandardMaterial;
  readonly clawCap: MeshStandardMaterial;
  /** Soft-touch rubber finger tips in the theme colour. */
  readonly clawTip: MeshStandardMaterial;
  /** Braided steel cable; ClawVisual updates the normal map repeat to the cable length. */
  readonly cable: MeshStandardMaterial;
  readonly glass: MeshPhysicalMaterial;
  readonly acrylic: MeshPhysicalMaterial;
  readonly acrylicEdge: MeshStandardMaterial;
  readonly mat: MeshStandardMaterial;
  readonly bayMat: MeshStandardMaterial;
  readonly backboard: MeshStandardMaterial;
  readonly fascia: MeshStandardMaterial;
  readonly velvet: MeshPhysicalMaterial;
  readonly cushion: MeshPhysicalMaterial;
  readonly dark: MeshStandardMaterial;
  /** Black epoxy of chip packages (GPU decor). */
  readonly chip: MeshStandardMaterial;
  readonly diffuser: MeshBasicMaterial;
  readonly plaqueA: MeshStandardMaterial;
  readonly plaqueB: MeshStandardMaterial;
  readonly plaqueC: MeshStandardMaterial;
  readonly badge: MeshStandardMaterial;
  readonly sign: MeshBasicMaterial;
  /** Printed stickers (atlas, see textures.decalUv). */
  readonly decal: MeshStandardMaterial;
  /**
   * The brand kit's back-wall dress (LED wall, event logo, host logo) when a kit dresses this
   * theme (src/brand: brandForTheme), else null. Logos come from the kit's slots, never from code.
   */
  readonly brand: BrandWall | null;
  /** Emissive strip materials, one per LED colour of the theme. */
  readonly leds: MeshBasicMaterial[];
  /** Fluorescent light tubes under the ceilings (unlit, bright enough to bloom a little). */
  readonly tube: MeshBasicMaterial;
  /**
   * Haze behind a neighbouring machine's front glass (src/scene/arcadeRow.ts): a tinted, partly
   * transparent pane that makes the machines beside ours read as further away and less lit.
   */
  readonly veil: MeshBasicMaterial;
  /** Baked corner occlusion strips (darken inside corners where Medium has no ambient occlusion). */
  readonly shade: MeshBasicMaterial;
  /** Lit header signs of the neighbouring machines (two cells of one texture). */
  readonly rowSign: MeshBasicMaterial;
  /** The braid normal map of the cable (null below High). */
  readonly cableNormal: Texture | null;
  private readonly ledBase: Color[];
  private readonly textures: Texture[] = [];
  private readonly all: Material[] = [];
  private readonly animators = new Set<Animator>();

  constructor(
    readonly theme: ThemeDef,
    textureTier: TextureTier,
    font: string,
  ) {
    const cab = theme.cabinet;
    const d = (this.detail = detailLevel(textureTier));
    // Large printed surfaces follow the tier (Ultra: 4K back wall); tiled detail maps stay ≤ 1K.
    const size = textureSize(textureTier);
    const tile = detailSize(textureTier);
    const track = <T extends Material>(m: T): T => {
      this.all.push(m);
      return m;
    };
    const tex = <T extends Texture>(t: T): T => {
      this.textures.push(t);
      return t;
    };
    const dark = cab.pattern === 'cosmos' || cab.pattern === 'circuit';
    const ink = sceneInk(theme);
    const parts = sceneParts(theme);

    /* Lacquer: clearcoat from Medium, metallic flake under the coat from High. */
    const flake = d >= 2 ? tex(makeFlakeNormal(512)) : null;
    const lacquer = (color: string, roughness: number): MeshStandardMaterial => {
      if (d === 0) return track(new MeshStandardMaterial({ color, roughness: roughness + 0.08, metalness: 0 }));
      const m = new MeshPhysicalMaterial({ color, roughness, metalness: flake ? 0.12 : 0, clearcoat: 1, clearcoatRoughness: d >= 2 ? 0.05 : 0.09 });
      if (flake) {
        m.normalMap = flake;
        m.normalScale = new Vector2(0.22, 0.22);
      }
      return track(m);
    };
    this.enamel = lacquer(cab.frame, 0.34);
    this.accent = lacquer(cab.frameAccent, 0.3);

    /* Metals. */
    const brushedMaps = d >= 1 ? makeBrushedMaps(tile) : null;
    if (brushedMaps) {
      tex(brushedMaps.normal);
      tex(brushedMaps.roughness);
    }
    const scratches = d >= 1 ? tex(makeScratchTexture(Math.min(1024, size), 3)) : null;
    this.chrome = track(new MeshStandardMaterial({ color: cab.metalTint, roughness: 0.12, metalness: 1, roughnessMap: d >= 2 ? scratches : null }));
    const brushedMetal = (color: Color | string, roughness: number, anisotropy: number): MeshStandardMaterial => {
      if (!brushedMaps) return track(new MeshStandardMaterial({ color, roughness: roughness + 0.06, metalness: 1 }));
      const m = new MeshPhysicalMaterial({
        color,
        metalness: 1,
        roughness,
        roughnessMap: brushedMaps.roughness,
        normalMap: brushedMaps.normal,
        normalScale: new Vector2(0.35, 0.35),
        // Grooves run along +u (see axis UVs in Cabinet.ts): the highlight stretches across them.
        anisotropy: d >= 2 ? anisotropy : anisotropy * 0.6,
        anisotropyRotation: Math.PI / 2,
      });
      return track(boundAnisotropy(m));
    };
    this.brushed = brushedMetal(cab.metalTint, 0.36, 0.7);
    // A brand kit asks for black anodising; other themes tint the aluminium with their accent.
    this.anodised = brushedMetal(parts.anodised ? new Color(parts.anodised) : new Color(cab.frameAccent).lerp(new Color(cab.metalTint), 0.25), 0.3, 0.45);
    const stipple = d >= 1 ? tex(makeStippleNormal(256)) : null;
    this.rubber = track(new MeshStandardMaterial({ color: parts.rubber, roughness: 0.88, metalness: 0, normalMap: stipple, normalScale: new Vector2(0.6, 0.6) }));
    this.plastic =
      d === 0
        ? track(new MeshStandardMaterial({ color: cab.frame, roughness: 0.52, metalness: 0 }))
        : track(new MeshPhysicalMaterial({ color: cab.frame, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
    this.clawCap = lacquer(cab.clawCap, 0.3);
    this.clawTip =
      d === 0
        ? track(new MeshStandardMaterial({ color: new Color(cab.clawCap).multiplyScalar(0.85), roughness: 0.7, metalness: 0 }))
        : track(
            new MeshPhysicalMaterial({
              color: new Color(cab.clawCap).multiplyScalar(0.85),
              roughness: 0.62,
              metalness: 0,
              sheen: 0.4,
              sheenColor: new Color('#ffffff').multiplyScalar(0.5),
              sheenRoughness: 0.6,
              normalMap: stipple,
              normalScale: new Vector2(0.5, 0.5),
            }),
          );
    this.cableNormal = d >= 2 ? tex(makeBraidNormal()) : null;
    this.cable = track(new MeshStandardMaterial({ color: cab.metalTint, roughness: 0.32, metalness: 1, normalMap: this.cableNormal, normalScale: new Vector2(1, 1) }));

    /* Glass and acrylic. */
    this.glass = track(
      new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide, envMapIntensity: 1.3, ior: 1.5, roughnessMap: scratches }),
    );
    makeGlassy(this.glass, new Color(parts.glassEdge), 0.3);
    this.acrylic = track(
      new MeshPhysicalMaterial({ color: cab.acrylicEdge, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide, envMapIntensity: 1.2, ior: 1.49, roughnessMap: scratches }),
    );
    makeGlassy(this.acrylic, new Color(cab.acrylicEdge), 0.4);
    this.acrylicEdge = track(new MeshStandardMaterial({ color: cab.acrylicEdge, roughness: 0.25, emissive: new Color(cab.acrylicEdge), emissiveIntensity: 0.35 }));

    /* Fabrics: quilted mat with a woven surface, velvet, cushion. */
    const quilt = tex(makeQuiltNormal(tile));
    const matNormal = d >= 1 ? tex(makeMatNormal(tile, d >= 2 ? 128 : 96)) : quilt;
    // The mat repeats every 0.38 m: 1K already gives ~2700 texels per metre; 2K only on Ultra.
    const matTex = tex(makeMatTexture(theme, d >= 3 ? 2048 : Math.max(512, Math.min(1024, size))));
    const fabric = (color: string | Color, map: Texture | null, normalScale: number): MeshStandardMaterial =>
      d === 0
        ? track(new MeshStandardMaterial({ color, map, normalMap: quilt, normalScale: new Vector2(normalScale, normalScale), roughness: 0.96, metalness: 0 }))
        : track(
            new MeshPhysicalMaterial({
              color,
              map,
              normalMap: matNormal,
              normalScale: new Vector2(normalScale, normalScale),
              roughness: 0.94,
              metalness: 0,
              sheen: dark ? 0.35 : 0.45,
              sheenColor: new Color(color).lerp(new Color('#ffffff'), dark ? 0.25 : 0.5),
              sheenRoughness: 0.55,
            }),
          );
    this.mat = fabric('#ffffff', matTex, 0.6);
    this.bayMat = fabric(new Color(cab.mat).multiplyScalar(0.92), null, 0.55);
    const pattern = tex(makePatternTexture(theme, size, 'board'));
    this.backboard = track(new MeshStandardMaterial({ color: '#ffffff', map: pattern, roughness: 0.82, metalness: 0 }));
    const fasciaTex = tex(makePatternTexture(theme, Math.min(2048, Math.max(512, size / 2)), 'fascia'));
    this.fascia = track(new MeshStandardMaterial({ color: '#ffffff', map: fasciaTex, roughness: 0.6, metalness: 0 }));
    this.velvet = track(new MeshPhysicalMaterial({ color: cab.velvet, roughness: 0.95, metalness: 0, sheen: 1, sheenColor: new Color(cab.velvet).lerp(new Color('#ffffff'), 0.4), sheenRoughness: 0.5 }));
    this.cushion = track(
      new MeshPhysicalMaterial({
        color: new Color(cab.velvet).lerp(new Color('#ffffff'), parts.cushionLift),
        roughness: 0.95,
        normalMap: quilt,
        normalScale: new Vector2(1.2, 1.2),
        sheen: 1,
        sheenColor: new Color('#ffffff').multiplyScalar(parts.cushionSheen),
        sheenRoughness: 0.5,
      }),
    );
    this.dark = track(new MeshStandardMaterial({ color: parts.dark, roughness: 0.7, metalness: 0.1 }));
    this.chip = track(new MeshStandardMaterial({ color: parts.chip, roughness: 0.42, metalness: 0.05, normalMap: stipple, normalScale: new Vector2(0.15, 0.15) }));
    this.diffuser = track(new MeshBasicMaterial({ color: new Color(parts.diffuser).multiplyScalar(1.55) }));
    const plaque = (color: string) =>
      d === 0 ? track(new MeshStandardMaterial({ color, roughness: 0.45 })) : track(new MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.15 }));
    this.plaqueA = plaque(ink.primary);
    this.plaqueB = plaque(ink.accent);
    this.plaqueC = plaque(ink.accent2);
    // Badge, decals and logos are small (≤ 0.4 m): 1K up to High, 2K on Ultra.
    const printSize = d === 0 ? 512 : d === 3 ? 2048 : 1024;
    this.badge = track(new MeshStandardMaterial({ map: tex(makeBadgeTexture(theme, printSize, font)), roughness: 0.4, transparent: true }));
    this.sign = track(new MeshBasicMaterial({ map: tex(makeSignTexture(theme, 'PRIZE', font, Math.min(2, printSize / 512))), transparent: true }));
    const decalProps = { map: tex(makeDecalAtlas(theme, printSize, font)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.35, metalness: 0 };
    this.decal = d === 0 ? track(new MeshStandardMaterial(decalProps)) : track(new MeshPhysicalMaterial({ ...decalProps, clearcoat: 0.6, clearcoatRoughness: 0.2 }));

    /* Brand kit: the LED wall and the logos from the kit's slots (official file, else placeholder). */
    const kit = sceneKit(theme);
    this.brand = kit ? new BrandWall(kit, printSize) : null;

    this.ledBase = cab.led.map((hex) => new Color(hex));
    this.leds = this.ledBase.map((c) => track(new MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) })));

    /* Arcade row and depth cues (src/scene/arcadeRow.ts): light tubes, neighbour haze, corner shading, signs. */
    this.tube = track(new MeshBasicMaterial({ color: new Color(parts.diffuser).multiplyScalar(2.1) }));
    // Light themes fade the neighbours towards a dusky version of their backdrop; dark themes (and the
    // brand kit, whose backdrop is black) towards their own darkest colour.
    const veilTint = dark ? new Color(theme.backdrop.bottom).multiplyScalar(0.7) : new Color(theme.backdrop.bottom).lerp(new Color('#3a3346'), 0.6);
    this.veil = track(new MeshBasicMaterial({ color: veilTint, map: tex(makeVeilTexture()), transparent: true, opacity: dark ? 0.5 : 0.42, depthWrite: false }));
    this.shade = track(new MeshBasicMaterial({ color: '#000000', map: tex(makeShadeTexture()), transparent: true, opacity: dark ? 0.55 : 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.rowSign = track(new MeshBasicMaterial({ map: tex(makeRowSignTexture(theme, ['LUCKY', 'PLUSH'], font, printSize)), color: new Color('#ffffff').multiplyScalar(dark ? 1.35 : 1.25) }));
  }

  setGlassQuality(quality: GlassQuality): void {
    const g = this.glass;
    if (quality === 'high') {
      // Real transmission through the side glass (extra scene pass).
      setPremultiplied(g, false);
      g.transparent = false;
      g.opacity = 1;
      g.transmission = 1;
      g.thickness = 0.008;
      g.roughness = 0.03;
      g.depthWrite = true;
      g.envMapIntensity = 1.2;
    } else {
      setPremultiplied(g, true);
      g.transmission = 0;
      g.transparent = true;
      g.depthWrite = false;
      g.opacity = quality === 'low' ? 0.05 : 0.08;
      g.roughness = quality === 'low' ? 0.2 : 0.05;
      g.envMapIntensity = quality === 'low' ? 0.5 : 1.3;
    }
    g.needsUpdate = true;
  }

  /** Registers a per-frame cabinet animation; returns the function that removes it again. */
  addAnimator(fn: Animator): () => void {
    this.animators.add(fn);
    return () => this.animators.delete(fn);
  }

  /**
   * Effects intensity (graphics.fxIntensity) and light show (graphics.lightShow) for the cabinet's
   * own light effects (the brand LED wall). The game calls it with the effective graphics settings.
   */
  setFxLevel(intensity: number, lightShow: boolean): void {
    this.brand?.setFx(intensity, lightShow);
  }

  /** Animates the LED strips (and the brand LED wall). `energy` (0..1) is raised briefly for celebrations. */
  updateLeds(time: number, energy: number, reducedMotion: boolean): void {
    const mode = this.theme.cabinet.ledMode;
    const n = this.leds.length;
    for (let i = 0; i < n; i++) {
      let level: number;
      if (reducedMotion) level = 1.25;
      else if (mode === 'breathe') level = 1.2 + 0.35 * Math.sin(time * 1.1 + i * 2.1);
      else if (mode === 'chase') level = 0.95 + 0.75 * Math.max(0, Math.sin(time * 2.2 - (i / n) * Math.PI * 2));
      else if (mode === 'wave') level = 1.15 + 0.4 * Math.sin(time * 0.8 + i * 1.4) * Math.sin(time * 0.37 + i);
      else level = 1.05 + 0.6 * Math.pow(Math.max(0, Math.sin(time * (2.3 + i * 0.7) + i * 4.1)), 3);
      level += energy * (reducedMotion ? 0.3 : 0.9 * (0.6 + 0.4 * Math.sin(time * 14 + i * 2)));
      this.leds[i]!.color.copy(this.ledBase[i]!).multiplyScalar(level);
    }
    this.brand?.update(time, energy, reducedMotion);
    for (const fn of this.animators) fn(time, reducedMotion);
  }

  /** Approximate GPU memory of this theme's textures (bytes, RGBA8 with mip chains). */
  textureBytes(): number {
    let total = 0;
    for (const t of [...this.textures, ...(this.brand?.textures() ?? [])]) {
      const img = t.image as { width?: number; height?: number } | null;
      if (img && img.width && img.height) total += textureBytes(img.width, img.height, t.generateMipmaps);
    }
    return total;
  }

  dispose(): void {
    this.animators.clear();
    this.brand?.dispose();
    for (const m of this.all) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
