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
import type { ThemeId } from '../core/types';
import type { ThemeDef } from '../themes/themes';
import { textureBytes } from './texgen';
import {
  detailSize,
  drawChipEmblem,
  drawTexture,
  loadImageTexture,
  makeBadgeTexture,
  makeBraidNormal,
  makeBrushedMaps,
  makeDecalAtlas,
  makeFlakeNormal,
  makeMatNormal,
  makeMatTexture,
  makePatternTexture,
  makeQuiltNormal,
  makeScratchTexture,
  makeSignTexture,
  makeStippleNormal,
  textureSize,
  type TextureTier,
} from './textures';

export type GlassQuality = 'low' | 'medium' | 'high';

/** 0 = Safe (phones) … 3 = Ultra. Drives texture sizes, material features and cabinet / claw tessellation. */
export type DetailLevel = 0 | 1 | 2 | 3;
export function detailLevel(tier: TextureTier): DetailLevel {
  return tier === '512' ? 0 : tier === '1k' ? 1 : tier === '2k' ? 2 : 3;
}

/**
 * Theme emblems that are loaded from a file at run time (one replaceable file per theme).
 * Replace the file to change the emblem; nothing else needs to change. Paths are relative to
 * the site root (Vite's `public/`).
 */
export const THEME_EMBLEMS: Partial<Record<ThemeId, string>> = {
  gpu: 'assets/themes/gpu/logo.svg',
};

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
          gl_FragColor = vec4( gBody + totalSpecular, gA );
        #else
          #include <opaque_fragment>
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'glassy';
  setPremultiplied(m, true);
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
  /** Theme emblem (logo slot), or null when the theme has none. */
  readonly emblem: MeshStandardMaterial | null;
  /** Emissive strip materials, one per LED colour of the theme. */
  readonly leds: MeshBasicMaterial[];
  /** The braid normal map of the cable (null below High). */
  readonly cableNormal: Texture | null;
  private readonly ledBase: Color[];
  private readonly textures: Texture[] = [];
  private readonly all: Material[] = [];
  private readonly animators = new Set<Animator>();
  private disposed = false;

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
      return track(m);
    };
    this.brushed = brushedMetal(cab.metalTint, 0.36, 0.7);
    this.anodised = brushedMetal(new Color(cab.frameAccent).lerp(new Color(cab.metalTint), 0.25), 0.3, 0.45);
    const stipple = d >= 1 ? tex(makeStippleNormal(256)) : null;
    this.rubber = track(new MeshStandardMaterial({ color: '#3a3540', roughness: 0.88, metalness: 0, normalMap: stipple, normalScale: new Vector2(0.6, 0.6) }));
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
    makeGlassy(this.glass, new Color('#cfeee6'), 0.3);
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
        color: new Color(cab.velvet).lerp(new Color('#ffffff'), 0.35),
        roughness: 0.95,
        normalMap: quilt,
        normalScale: new Vector2(1.2, 1.2),
        sheen: 1,
        sheenColor: new Color('#ffffff'),
        sheenRoughness: 0.5,
      }),
    );
    this.dark = track(new MeshStandardMaterial({ color: '#2c2633', roughness: 0.7, metalness: 0.1 }));
    this.chip = track(new MeshStandardMaterial({ color: '#15181b', roughness: 0.42, metalness: 0.05, normalMap: stipple, normalScale: new Vector2(0.15, 0.15) }));
    this.diffuser = track(new MeshBasicMaterial({ color: new Color('#fff8ee').multiplyScalar(1.55) }));
    const plaque = (color: string) =>
      d === 0 ? track(new MeshStandardMaterial({ color, roughness: 0.45 })) : track(new MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.15 }));
    this.plaqueA = plaque(theme.ui.primary);
    this.plaqueB = plaque(theme.ui.accent);
    this.plaqueC = plaque(theme.ui.accent2);
    // Badge, decals and emblem are small (≤ 0.22 m): 1K up to High, 2K on Ultra.
    const printSize = d === 0 ? 512 : d === 3 ? 2048 : 1024;
    this.badge = track(new MeshStandardMaterial({ map: tex(makeBadgeTexture(theme, printSize, font)), roughness: 0.4, transparent: true }));
    this.sign = track(new MeshBasicMaterial({ map: tex(makeSignTexture(theme, 'PRIZE', font, Math.min(2, printSize / 512))), transparent: true }));
    const decalProps = { map: tex(makeDecalAtlas(theme, printSize, font)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.35, metalness: 0 };
    this.decal = d === 0 ? track(new MeshStandardMaterial(decalProps)) : track(new MeshPhysicalMaterial({ ...decalProps, clearcoat: 0.6, clearcoatRoughness: 0.2 }));

    /* Theme emblem (logo slot): procedural stand-in now, the image file as soon as it has loaded. */
    const emblemPath = THEME_EMBLEMS[theme.id];
    if (emblemPath) {
      const fallback = tex(drawTexture(printSize, (g, s) => drawChipEmblem(g, s, theme.ui.primary, font)));
      const emblem = d === 0 ? new MeshStandardMaterial({ map: fallback, transparent: true, roughness: 0.4 }) : new MeshPhysicalMaterial({ map: fallback, transparent: true, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 });
      this.emblem = track(emblem);
      const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      void loadImageTexture(`${base}${emblemPath}`, printSize).then((loaded) => {
        if (!loaded) return;
        if (this.disposed) {
          loaded.dispose();
          return;
        }
        this.textures.push(loaded);
        emblem.map = loaded;
        emblem.needsUpdate = true;
        // The stand-in is no longer needed.
        this.textures.splice(this.textures.indexOf(fallback), 1);
        fallback.dispose();
      });
    } else this.emblem = null;

    this.ledBase = cab.led.map((hex) => new Color(hex));
    this.leds = this.ledBase.map((c) => track(new MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) })));
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

  /** Animates the LED strips. `energy` (0..1) is raised briefly for celebrations. */
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
    for (const fn of this.animators) fn(time, reducedMotion);
  }

  /** Approximate GPU memory of this theme's textures (bytes, RGBA8 with mip chains). */
  textureBytes(): number {
    let total = 0;
    for (const t of this.textures) {
      const img = t.image as { width?: number; height?: number } | null;
      if (img && img.width && img.height) total += textureBytes(img.width, img.height, t.generateMipmaps);
    }
    return total;
  }

  dispose(): void {
    this.disposed = true;
    this.animators.clear();
    for (const m of this.all) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
