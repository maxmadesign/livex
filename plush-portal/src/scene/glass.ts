import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Texture } from 'three';
import type { WindowLayout } from '../perspective/windowGeometry';
import type { GraphicsSettings } from '../settings/spec';
import type { ThemeDef } from '../themes/themes';
import { makeDustTexture, makeScratchTexture, type TextureTier } from './textures';

/** Strength of the front glass per glass quality; 'low' (the Safe preset) draws nothing. */
export const FRONT_GLASS_STRENGTH: Record<GraphicsSettings['glass'], number> = { low: 0, medium: 0.045, high: 0.07 };

/**
 * The cabinet's front glass, lying exactly in the screen plane. Everything it draws — two soft
 * reflection streaks, dust specks, a wiped fingerprint or two, micro-scratches and a thin glint
 * along the edge where the pane meets the frame — is fixed to the pane, so it stays put on the
 * screen while the cabinet behind it shifts with the eye. That fixed layer is what makes the screen
 * read as glass with depth behind it.
 *
 * It covers only the play window (above the floor line: the lower cabinet is solid) and stays
 * clear of the middle of the view; it is added on top of the scene, so it never darkens anything,
 * and the DOM HUD is always drawn over it. Off on the Safe preset (glass quality 'low').
 */
export class FrontGlass {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private scratches: Texture | null = null;
  private dust: Texture | null = null;

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uStrength: { value: FRONT_GLASS_STRENGTH.medium },
        uTint: { value: new Color(0xffffff) },
        uAspect: { value: 1 },
        uScale: { value: new Vector2(1, 1) },
        uScratch: { value: null as Texture | null },
        uScratchGain: { value: 0 },
        uDust: { value: null as Texture | null },
        uDustGain: { value: 0 },
        uFloorV: { value: 0.3 },
        uFrame: { value: new Vector2(0.02, 0.03) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uStrength;
        uniform vec3 uTint;
        uniform float uAspect;
        uniform vec2 uScale;
        uniform sampler2D uScratch;
        uniform float uScratchGain;
        uniform sampler2D uDust;
        uniform float uDustGain;
        uniform float uFloorV;
        uniform vec2 uFrame;
        void main() {
          vec2 p = vUv - 0.5;
          // The pane: inside the frame and above the floor line (below it the cabinet is solid).
          vec2 lo = smoothstep( uFrame, uFrame + 0.004, vUv );
          vec2 hi = smoothstep( uFrame, uFrame + 0.004, 1.0 - vUv );
          float pane = lo.x * hi.x * hi.y * smoothstep( uFloorV, uFloorV + 0.03, vUv.y );
          if ( pane <= 0.0 ) discard;
          // Two soft diagonal streaks (a ceiling light reflected in the pane), fixed to the glass.
          float d = p.x * uAspect + p.y * 0.62;
          float streak = smoothstep( 0.2, 0.0, abs( d - 0.33 ) ) * 0.7 + smoothstep( 0.07, 0.0, abs( d - 0.52 ) );
          // Keep the middle of the window clear: reflections live near the edges.
          float edge = smoothstep( 0.18, 0.5, max( abs( p.x ), abs( p.y ) ) );
          float fresnel = pow( edge, 2.0 ) * 0.5;
          // Light from above grazes the upper part of the pane a little more.
          float top = smoothstep( uFloorV, 1.0, vUv.y );
          // Scratches, dust and smudges only show where light catches them.
          float catchLight = streak * 0.8 + edge * 0.35 + top * 0.2;
          float scratch = texture2D( uScratch, vUv * uScale ).r * uScratchGain * catchLight;
          float dust = texture2D( uDust, vUv * uScale * 1.7 ).r * uDustGain * ( 0.18 + catchLight );
          // A thin glint along the sides and top where the pane meets the frame.
          vec2 e = min( vUv - uFrame, 1.0 - uFrame - vUv );
          float glint = smoothstep( 0.0035, 0.0, min( e.x, e.y ) ) * ( 0.35 + top * 0.65 );
          float a = ( streak * edge + fresnel + scratch + dust + glint * 0.6 ) * uStrength * pane;
          gl_FragColor = vec4( uTint * a, 1.0 );
        }`,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'front-glass';
    this.mesh.renderOrder = 50;
    this.mesh.frustumCulled = false;
    this.mesh.userData.skipAO = true;
  }

  /** Glass quality and texture tier: strength, and whether the scratch / dust maps are used (not on the 512 tier). */
  setQuality(glass: GraphicsSettings['glass'], textures: TextureTier): void {
    const u = this.material.uniforms;
    u.uStrength!.value = FRONT_GLASS_STRENGTH[glass];
    this.mesh.visible = FRONT_GLASS_STRENGTH[glass] > 0;
    const detail = textures !== '512';
    if (detail && !this.scratches) {
      this.scratches = makeScratchTexture(1024, 41);
      this.dust = makeDustTexture(512, 23);
      u.uScratch!.value = this.scratches;
      u.uDust!.value = this.dust;
    }
    u.uScratchGain!.value = detail ? 0.55 : 0;
    u.uDustGain!.value = detail ? 0.75 : 0;
  }

  setTheme(theme: ThemeDef): void {
    (this.material.uniforms.uTint!.value as Color).set(theme.backdrop.bokeh[0]!).lerp(new Color(0xffffff), 0.6);
  }

  /** Lays the pane over the whole virtual window (the screen plane, z = 0). */
  setLayout(layout: WindowLayout): void {
    this.mesh.position.set(0, layout.centerY, -0.0006);
    this.mesh.scale.set(layout.width, layout.height, 1);
    const u = this.material.uniforms;
    u.uAspect!.value = layout.aspect;
    // Scratch and dust maps at a constant physical size (one tile ≈ 0.45 m).
    (u.uScale!.value as Vector2).set(layout.width / 0.45, layout.height / 0.45);
    // The floor's front edge (world y = 0) is where the pane ends.
    u.uFloorV!.value = (0 - layout.bottom) / layout.height;
    (u.uFrame!.value as Vector2).set(layout.frame / layout.width, layout.frame / layout.height);
  }

  dispose(): void {
    this.scratches?.dispose();
    this.dust?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
