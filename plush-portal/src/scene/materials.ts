import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  type Texture,
} from 'three';
import type { ThemeDef } from '../themes/themes';
import { makeBadgeTexture, makeMatTexture, makePatternTexture, makeQuiltBump, makeSignTexture, textureSize } from './textures';

export type GlassQuality = 'low' | 'medium' | 'high';

/** Shared materials of the cabinet for one theme. Created once per theme and disposed on theme change. */
export class CabinetMaterials {
  readonly enamel: MeshPhysicalMaterial;
  readonly accent: MeshPhysicalMaterial;
  readonly chrome: MeshStandardMaterial;
  readonly brushed: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly plastic: MeshPhysicalMaterial;
  readonly clawCap: MeshPhysicalMaterial;
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
  readonly diffuser: MeshBasicMaterial;
  readonly plaqueA: MeshPhysicalMaterial;
  readonly plaqueB: MeshPhysicalMaterial;
  readonly plaqueC: MeshPhysicalMaterial;
  readonly badge: MeshStandardMaterial;
  readonly sign: MeshBasicMaterial;
  /** Emissive strip materials, one per LED colour of the theme. */
  readonly leds: MeshBasicMaterial[];
  private readonly ledBase: Color[];
  private readonly textures: Texture[] = [];
  private readonly all: Material[] = [];

  constructor(
    readonly theme: ThemeDef,
    textureTier: '512' | '1k' | '2k' | '4k',
    font: string,
  ) {
    const cab = theme.cabinet;
    // Decorative surfaces never need more than 2K; 4K is reserved for close hero assets.
    const size = Math.min(2048, textureSize(textureTier));
    const track = <T extends Material>(m: T): T => {
      this.all.push(m);
      return m;
    };
    const tex = <T extends Texture>(t: T): T => {
      this.textures.push(t);
      return t;
    };

    this.enamel = track(new MeshPhysicalMaterial({ color: cab.frame, roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18 }));
    this.accent = track(new MeshPhysicalMaterial({ color: cab.frameAccent, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.14 }));
    this.chrome = track(new MeshStandardMaterial({ color: cab.metalTint, roughness: 0.16, metalness: 1 }));
    this.brushed = track(new MeshStandardMaterial({ color: cab.metalTint, roughness: 0.44, metalness: 1 }));
    this.rubber = track(new MeshStandardMaterial({ color: '#3a3540', roughness: 0.88, metalness: 0 }));
    this.plastic = track(new MeshPhysicalMaterial({ color: cab.frame, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
    this.clawCap = track(new MeshPhysicalMaterial({ color: cab.clawCap, roughness: 0.3, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.1 }));
    this.glass = track(
      new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide, envMapIntensity: 1.3 }),
    );
    this.acrylic = track(
      new MeshPhysicalMaterial({ color: cab.acrylicEdge, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide, envMapIntensity: 1.2 }),
    );
    this.acrylicEdge = track(new MeshStandardMaterial({ color: cab.acrylicEdge, roughness: 0.25, emissive: new Color(cab.acrylicEdge), emissiveIntensity: 0.35 }));

    const quilt = tex(makeQuiltBump(512));
    const matTex = tex(makeMatTexture(theme, size / 2));
    this.mat = track(new MeshStandardMaterial({ color: '#ffffff', map: matTex, bumpMap: quilt, bumpScale: 1.6, roughness: 0.96, metalness: 0 }));
    this.bayMat = track(new MeshStandardMaterial({ color: new Color(cab.mat).multiplyScalar(0.92), bumpMap: quilt, bumpScale: 1.4, roughness: 0.96 }));
    const pattern = tex(makePatternTexture(theme, size, 'board'));
    this.backboard = track(new MeshStandardMaterial({ color: '#ffffff', map: pattern, roughness: 0.82, metalness: 0 }));
    const fasciaTex = tex(makePatternTexture(theme, size / 2, 'fascia'));
    this.fascia = track(new MeshStandardMaterial({ color: '#ffffff', map: fasciaTex, roughness: 0.6, metalness: 0 }));
    this.velvet = track(new MeshPhysicalMaterial({ color: cab.velvet, roughness: 0.95, metalness: 0, sheen: 1, sheenColor: new Color(cab.velvet).lerp(new Color('#ffffff'), 0.4), sheenRoughness: 0.5 }));
    this.cushion = track(
      new MeshPhysicalMaterial({ color: new Color(cab.velvet).lerp(new Color('#ffffff'), 0.35), roughness: 0.95, bumpMap: quilt, bumpScale: 2.2, sheen: 1, sheenColor: new Color('#ffffff'), sheenRoughness: 0.5 }),
    );
    this.dark = track(new MeshStandardMaterial({ color: '#2c2633', roughness: 0.7, metalness: 0.1 }));
    this.diffuser = track(new MeshBasicMaterial({ color: new Color('#fff8ee').multiplyScalar(1.55) }));
    this.plaqueA = track(new MeshPhysicalMaterial({ color: theme.ui.primary, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    this.plaqueB = track(new MeshPhysicalMaterial({ color: theme.ui.accent, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    this.plaqueC = track(new MeshPhysicalMaterial({ color: theme.ui.accent2, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    this.badge = track(new MeshStandardMaterial({ map: tex(makeBadgeTexture(theme, 512, font)), roughness: 0.4, transparent: true }));
    this.sign = track(new MeshBasicMaterial({ map: tex(makeSignTexture(theme, 'PRIZE', font)), transparent: true }));

    this.ledBase = cab.led.map((hex) => new Color(hex));
    this.leds = this.ledBase.map((c) => track(new MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) })));
  }

  setGlassQuality(quality: GlassQuality): void {
    const g = this.glass;
    if (quality === 'high') {
      // Real transmission through the side glass (extra scene pass).
      g.transparent = false;
      g.opacity = 1;
      g.transmission = 1;
      g.thickness = 0.008;
      g.ior = 1.5;
      g.roughness = 0.03;
      g.depthWrite = true;
      g.envMapIntensity = 1.2;
    } else {
      g.transmission = 0;
      g.transparent = true;
      g.depthWrite = false;
      g.opacity = quality === 'low' ? 0.05 : 0.1;
      g.roughness = quality === 'low' ? 0.2 : 0.05;
      g.envMapIntensity = quality === 'low' ? 0.5 : 1.3;
    }
    g.needsUpdate = true;
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
  }

  dispose(): void {
    for (const m of this.all) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
