import { Color, NeutralToneMapping, NoToneMapping, ShaderMaterial, Vector2, Vector4, type Mesh, type Texture, type WebGLRenderer } from 'three';
import { resolveLogo, type BrandKit, type LogoSlot } from '../brand';
import { BLOOM_SAFE_LUMINANCE, LED_WALL, placeHostLogo, placeLogo, type LogoPlacement } from './brandScene';
import { loadLogoTexture } from './textures';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * The LED wall behind the logo: a fine matrix of round emitters showing slow green light sweeps,
 * scanlines, data packets running along a few rows and a soft halo around the logo pad; win
 * energy adds pulses that ripple outwards from the pad. Inside the pads (logo + clear space) the
 * wall is plain black: nothing is ever drawn on or over a logo.
 */
const LED_FRAGMENT = /* glsl */ `
uniform float uPhase;
uniform float uScan;
uniform float uLive;
uniform float uBurst;
uniform float uRing;
uniform float uRingAmp;
uniform float uLevel;
uniform float uPadOn;
uniform vec2 uSize;
uniform vec4 uPad;
uniform vec4 uPad2;
uniform vec3 uGreen;
uniform vec3 uGreenLight;
uniform vec3 uWhite;
uniform vec3 uBase;
varying vec2 vUv;

float hash1( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }

float boxSdf( vec2 p, vec2 c, vec2 h, float r ) {
  vec2 q = abs( p - c ) - h + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}

void main() {
  vec2 p = vUv * uSize;
  float dPad = boxSdf( p, uPad.xy, uPad.zw, 0.004 );
  float dHost = uPad2.z > 0.0 ? boxSdf( p, uPad2.xy, uPad2.zw, 0.003 ) : 1e3;

  // Round emitters on a 5 mm pitch; where one screen pixel covers several of them the grid fades
  // to its average brightness instead of shimmering.
  vec2 g = p / 0.005;
  float led = 1.0 - smoothstep( 0.3, 0.46, length( fract( g ) - 0.5 ) );
  float fw = max( fwidth( g.x ), fwidth( g.y ) );
  led = mix( led, 0.5, smoothstep( 0.3, 0.85, fw ) );

  // Slow diagonal sweeps.
  float s1 = sin( ( p.x * 0.55 + p.y * 1.25 ) * 5.2 - uPhase * 0.55 );
  float s2 = sin( ( -p.x * 1.1 + p.y * 0.6 ) * 3.6 - uPhase * 0.33 + 1.7 );
  float sweep = pow( max( 0.0, s1 ), 9.0 ) + 0.65 * pow( max( 0.0, s2 ), 13.0 );
  // Fine scanlines and one brighter bar drifting down the wall.
  float scan = 0.5 + 0.5 * sin( p.y * 523.6 );
  float barY = uSize.y * ( 1.0 - uScan );
  float bar = exp( -( p.y - barY ) * ( p.y - barY ) * 260.0 );
  // Data packets: a few LED rows carry short streaks with a bright head.
  float rowIndex = floor( p.y / 0.02 );
  float onRow = 1.0 - smoothstep( 0.08, 0.2, abs( fract( p.y / 0.02 ) - 0.5 ) );
  float lane = step( 0.62, hash1( rowIndex + 3.1 ) );
  float dir = hash1( rowIndex + 9.7 ) < 0.5 ? -1.0 : 1.0;
  float speed = mix( 0.05, 0.12, hash1( rowIndex + 5.3 ) );
  float span = uSize.x + 0.4;
  float headX = fract( uPhase * speed + hash1( rowIndex + 1.9 ) ) * span - 0.2;
  float along = dir > 0.0 ? headX - p.x : p.x - ( uSize.x - headX );
  float packet = along >= 0.0 ? exp( -along * 22.0 ) : 0.0;
  float headGlow = along >= 0.0 ? exp( -along * 260.0 ) : 0.0;
  float data = lane * onRow * packet;
  // Halo around the logo pad: light passes around the logo.
  float halo = exp( -max( dPad, 0.0 ) * 11.0 ) * uPadOn;
  // Win pulses: two crisp outlines of the pad rippling outwards, half a cycle apart.
  float ring = 0.0;
  if ( uRingAmp > 0.0 && uPadOn > 0.5 ) {
    for ( int k = 0; k < 2; k++ ) {
      float f = fract( uRing + 0.5 * float( k ) );
      float dr = dPad - f * 0.7;
      ring += exp( -dr * dr * 3000.0 ) * ( 1.0 - f ) * ( 1.0 - f );
    }
  }
  // Darker towards the bezel.
  vec2 e = min( p, uSize - p );
  float vignette = smoothstep( 0.0, 0.06, min( e.x, e.y ) );

  float lit = sweep * ( 0.42 + 0.5 * uLive ) + scan * 0.035 + bar * ( 0.12 + 0.18 * uLive ) + data * 0.75 + halo * ( 0.26 + 0.24 * uLive );
  lit *= 1.0 + 0.4 * uBurst;
  lit += ring * 3.2 * uRingAmp;
  vec3 tint = mix( uGreen, uGreenLight, clamp( sweep * 0.35 + ring * 0.6 + bar * 0.3, 0.0, 1.0 ) );
  vec3 col = uBase + ( tint * lit + uWhite * headGlow * lane * onRow * 0.9 ) * uLevel * led * vignette;
  // Plain black inside the pads (logo plus clear space). While the event logo is lent to a screen
  // over the field (uPadOn = 0, see lendWallLogo) its pad is lit like the rest of the wall.
  col *= smoothstep( 0.0, 0.0015, min( mix( 1.0, dPad, uPadOn ), dHost ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;

/**
 * An official (or placeholder) logo, drawn exactly as supplied over its black pad. The scene goes
 * through the composer's output pass (exposure + tone mapping, see Stage), so the shader applies
 * the inverse of that transform and keeps its luminance under the bloom threshold: the printed
 * colours come out unchanged and the logo never glows. Unlit, no fog, no tone mapping of its own.
 */
const LOGO_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uExposure;
uniform float uNeutral;
uniform float uMaxLum;
varying vec2 vUv;

vec3 inverseNeutral( vec3 y ) {
  const float S = 0.8 - 0.04;
  const float D = 0.15;
  float P = min( 0.999, max( y.r, max( y.g, y.b ) ) );
  vec3 c = y;
  if ( P >= S ) {
    float d = 1.0 - S;
    float peak = d * d / ( 1.0 - P ) - d + S;
    float k = 1.0 - 1.0 / ( D * ( peak - P ) + 1.0 );
    c = ( y - k * P ) * ( peak / P / ( 1.0 - k ) );
  }
  float m = max( 0.0, min( c.r, min( c.g, c.b ) ) );
  float offset = m < 0.04 ? sqrt( m ) / 2.5 - m : 0.04;
  return c + offset;
}

void main() {
  vec4 t = texture2D( map, vUv );
  vec3 c = t.rgb * t.a;
  if ( uNeutral > 0.5 ) c = inverseNeutral( c );
  c /= uExposure;
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c *= min( 1.0, uMaxLum / max( lum, 1e-5 ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}
`;

function makeLogoMaterial(name: string): ShaderMaterial {
  return new ShaderMaterial({
    name,
    uniforms: { map: { value: null }, uExposure: { value: 1 }, uNeutral: { value: 0 }, uMaxLum: { value: BLOOM_SAFE_LUMINANCE } },
    vertexShader: VERTEX,
    fragmentShader: LOGO_FRAGMENT,
    toneMapped: false,
    fog: false,
    lights: false,
  });
}

/** What the scene shows in a logo slot (diagnostics, tests). */
export interface LogoStatus {
  /** URL that was loaded, or null (nothing drawn). */
  url: string | null;
  /** True when an official file was found, false = the original placeholder (or nothing). */
  official: boolean;
  /** The image is decoded and on the wall. */
  loaded: boolean;
  /** Natural width / height of the artwork (the slot's declared aspect until loaded). */
  aspect: number;
}

interface LogoState {
  slot: LogoSlot;
  material: ShaderMaterial;
  status: LogoStatus;
  texture: Texture | null;
}

const _pad = new Vector4();

/**
 * Screens that draw the event logo themselves in the middle of the play field (the attract call to
 * action with its logo plate, src/ui/AttractOverlay.tsx) borrow the logo from the wall meanwhile:
 * the wall's logo sits right behind them, and a second copy peeking out between the headline and
 * the button (under its glow) is a logo covered by text and light. While at least one loan is open
 * every BrandWall leaves its event logo out and lights its pad like the rest of the wall; the host
 * mark in its corner stays. Returns the function that ends the loan.
 */
const logoLoans = new Set<symbol>();
export function lendWallLogo(): () => void {
  const loan = Symbol('wall-logo-loan');
  logoLoans.add(loan);
  return () => {
    logoLoans.delete(loan);
  };
}

/** True while a screen has borrowed the event logo from the wall. */
export function wallLogoLent(): boolean {
  return logoLoans.size > 0;
}

/**
 * The brand kit's dress for the cabinet's back wall: the animated LED wall material, the event
 * logo and (only when its official file exists) the host logo. Created with the theme's
 * materials; the cabinet builds the meshes and follows `onChange` to resize them once a logo's
 * natural aspect is known.
 */
export class BrandWall {
  readonly ledWall: ShaderMaterial;
  readonly logo: ShaderMaterial;
  readonly hostLogo: ShaderMaterial | null;
  private readonly event: LogoState;
  private readonly host: LogoState | null;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private lastTime = Number.NaN;
  private phase = 0;
  private scan = 0.3;
  private ring = 0;
  private live = 0;
  private burst = 0;
  private level = 1;
  private show = true;

  constructor(
    readonly kit: BrandKit,
    /** Texels across a logo texture. */
    private readonly logoTexels: number,
  ) {
    const p = kit.palette;
    const width = LED_WALL.xMax - LED_WALL.xMin;
    const height = LED_WALL.yMax - LED_WALL.yMin;
    this.ledWall = new ShaderMaterial({
      name: 'led-wall',
      uniforms: {
        uPhase: { value: 0 },
        uScan: { value: 0.3 },
        uLive: { value: 0 },
        uBurst: { value: 0 },
        uRing: { value: 0 },
        uRingAmp: { value: 0 },
        uLevel: { value: 1 },
        uPadOn: { value: 1 },
        uSize: { value: new Vector2(width, height) },
        uPad: { value: new Vector4() },
        uPad2: { value: new Vector4() },
        uGreen: { value: new Color(p.green) },
        uGreenLight: { value: new Color(p.greenLight) },
        uWhite: { value: new Color(p.white) },
        // The panel's black level: a hint of the dark grey matrix, never pure black.
        uBase: { value: new Color(p.gray950).multiplyScalar(0.6) },
      },
      vertexShader: VERTEX,
      fragmentShader: LED_FRAGMENT,
      fog: false,
      lights: false,
    });
    this.logo = makeLogoMaterial('brand-logo');
    this.event = { slot: kit.logo, material: this.logo, status: { url: null, official: false, loaded: false, aspect: kit.logo.aspect }, texture: null };
    this.hostLogo = kit.hostLogo ? makeLogoMaterial('brand-host-logo') : null;
    this.host = kit.hostLogo && this.hostLogo ? { slot: kit.hostLogo, material: this.hostLogo, status: { url: null, official: false, loaded: false, aspect: kit.hostLogo.aspect }, texture: null } : null;
    this.updatePads();
    void this.load(this.event, false);
    if (this.host) void this.load(this.host, true);
  }

  /** Where the event logo goes for its current aspect. */
  logoPlacement(): LogoPlacement {
    return placeLogo(this.event.status.aspect, this.kit.logo.clearSpace);
  }

  /** Where the host logo goes, or null while it is not drawn (no official file). */
  hostPlacement(): LogoPlacement | null {
    if (!this.host || !this.host.status.loaded) return null;
    return placeHostLogo(this.host.slot, this.host.status.aspect);
  }

  logoStatus(): { logo: LogoStatus; host: LogoStatus | null } {
    return { logo: { ...this.event.status }, host: this.host ? { ...this.host.status } : null };
  }

  /** Calls `fn` whenever a logo finished loading (sizes may have changed); returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Makes a logo mesh compensate for the output pass it is drawn through (see LOGO_FRAGMENT). */
  bindLogoMesh(mesh: Mesh): void {
    mesh.onBeforeRender = (renderer: WebGLRenderer, _scene, _camera, _geometry, material) => {
      const u = (material as ShaderMaterial).uniforms;
      if (!u?.uExposure) return;
      const target = renderer.getRenderTarget() as { isWebGLCubeRenderTarget?: boolean } | null;
      // Drawn into the composer's linear target: exposure and tone mapping follow in the output pass.
      // Straight to the canvas or into a reflection capture: neither applies to an untone-mapped material.
      const throughOutput = target !== null && target.isWebGLCubeRenderTarget !== true && renderer.toneMapping !== NoToneMapping;
      u.uExposure!.value = throughOutput ? Math.max(1e-3, renderer.toneMappingExposure) : 1;
      u.uNeutral!.value = throughOutput && renderer.toneMapping === NeutralToneMapping ? 1 : 0;
    };
  }

  /** Effects intensity (graphics.fxIntensity) and whether the light show is on (graphics.lightShow). */
  setFx(intensity: number, lightShow: boolean): void {
    this.level = Number.isFinite(intensity) ? Math.max(0, Math.min(1.25, intensity)) : 1;
    this.show = lightShow;
  }

  /**
   * Per frame, from CabinetMaterials.updateLeds: `energy` is the cabinet's LED energy (win
   * celebration by rarity plus the running light show). Nothing is allocated.
   */
  update(time: number, energy: number, reducedMotion: boolean): void {
    const dt = Number.isFinite(this.lastTime) ? Math.max(0, Math.min(0.25, time - this.lastTime)) : 0;
    this.lastTime = time;
    const e = Number.isFinite(energy) ? Math.max(0, energy) : 0;
    // Attract mode (≈ 0.5) livens the wall up; a win (≥ 0.75) adds pulses from the logo pad.
    const live = Math.min(1, e);
    const burst = this.show ? Math.min(1.6, Math.max(0, e - 0.6)) : Math.min(0.35, Math.max(0, e - 0.6) * 0.3);
    const k = Math.min(1, dt * 4);
    this.live += (live - this.live) * k;
    this.burst += (burst - this.burst) * k;
    const motion = reducedMotion ? 0 : 1;
    this.phase = (this.phase + dt * motion * (1 + 1.4 * this.live + 1.2 * this.burst)) % 4096;
    this.scan = (this.scan + dt * motion * 0.045) % 1;
    // Pulses only while there is something to celebrate, and never with reduced motion (the wall
    // then only brightens a little).
    const pulsing = this.burst > 0.02 && motion > 0;
    if (pulsing) this.ring += dt * 0.8;
    else this.ring = 0;
    const u = this.ledWall.uniforms;
    u.uPhase!.value = this.phase;
    u.uScan!.value = this.scan;
    u.uLive!.value = this.live;
    u.uBurst!.value = motion > 0 ? this.burst : Math.min(0.25, this.burst);
    u.uRing!.value = this.ring;
    u.uRingAmp!.value = pulsing ? Math.min(1, this.burst) : 0;
    u.uLevel!.value = this.level;
    // A screen over the field shows the event logo itself (lendWallLogo): no second copy behind it.
    const lent = wallLogoLent();
    u.uPadOn!.value = lent ? 0 : 1;
    this.logo.visible = !lent;
  }

  private updatePads(): void {
    const ox = LED_WALL.xMin, oy = LED_WALL.yMin;
    const a = this.logoPlacement();
    (this.ledWall.uniforms.uPad!.value as Vector4).copy(_pad.set(a.cx - ox, a.cy - oy, a.padW / 2, a.padH / 2));
    const h = this.hostPlacement();
    (this.ledWall.uniforms.uPad2!.value as Vector4).copy(h ? _pad.set(h.cx - ox, h.cy - oy, h.padW / 2, h.padH / 2) : _pad.set(0, 0, 0, 0));
  }

  private async load(state: LogoState, officialOnly: boolean): Promise<void> {
    const resolved = await resolveLogo(state.slot);
    if (this.disposed) return;
    // A secondary mark is drawn only from an official file: no placeholder stands in for it.
    if (!resolved.url || (officialOnly && !resolved.official)) return;
    const loaded = await loadLogoTexture(resolved.url, this.logoTexels);
    if (!loaded) return;
    if (this.disposed) {
      loaded.texture.dispose();
      return;
    }
    state.texture = loaded.texture;
    state.material.uniforms.map!.value = loaded.texture;
    state.status = { url: resolved.url, official: resolved.official, loaded: true, aspect: loaded.aspect };
    this.updatePads();
    for (const fn of this.listeners) fn();
  }

  /** Bytes of the logo textures (RGBA8 with mips), for CabinetMaterials.textureBytes. */
  textures(): Texture[] {
    const out: Texture[] = [];
    if (this.event.texture) out.push(this.event.texture);
    if (this.host?.texture) out.push(this.host.texture);
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.event.texture?.dispose();
    this.host?.texture?.dispose();
    this.ledWall.dispose();
    this.logo.dispose();
    this.hostLogo?.dispose();
  }
}
