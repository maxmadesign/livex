import {
  AdditiveBlending,
  BackSide,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { makeRng } from '../core/math';
import type { ThemeDef } from '../themes/themes';
import type { TextureTier } from './textures';

/**
 * Face size of the prefiltered studio environment per texture tier. three.js r187 never
 * prefilters below 256, so Safe and Medium share the smallest size.
 */
export function environmentSize(tier: TextureTier): number {
  return tier === '4k' ? 1024 : tier === '2k' ? 512 : 256;
}

/**
 * Face size of a capture of the real cabinet interior ('refresh' / 'live' reflections).
 * 'live' re-renders the whole scene six times every 0.75 s, so it stays at the minimum below
 * Ultra; on Ultra (4K textures, high-end GPUs) it matches High's 512 — the six re-renders cost
 * vertex work that does not depend on the face size, the extra fragments are small.
 */
export function captureSize(tier: TextureTier, mode: 'refresh' | 'live'): number {
  if (mode === 'live') return tier === '4k' ? 512 : 256;
  return Math.min(512, environmentSize(tier));
}

/**
 * Face size the studio is prefiltered at. With 'static' reflections it is the environment
 * itself (the tier's size). With 'refresh' / 'live' the capture replaces it everywhere and the
 * studio only lights the captures, so it takes the capture's size: the lit materials then need a
 * single shader variant (three.js compiles the environment size into each program, a different
 * studio size would compile every lit material twice) and no unused 1024 cube stays in memory.
 */
export function studioEnvironmentSize(tier: TextureTier, reflections: 'static' | 'refresh' | 'live'): number {
  return reflections === 'static' ? environmentSize(tier) : captureSize(tier, reflections);
}

/** Blur (radians) applied before prefiltering: small faces get a little more to hide aliasing. */
export function environmentBlur(size: number): number {
  return size <= 256 ? 0.02 : size <= 512 ? 0.012 : 0.006;
}

const SOFTBOX_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;

/** A diffuser panel: bright, slightly hotter in the middle, with soft rounded edges. */
const SOFTBOX_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uSoft;
  uniform vec2 uAspect;
  void main() {
    vec2 p = ( vUv - 0.5 ) * 2.0 * uAspect;
    vec2 q = abs( p ) - ( uAspect - vec2( 0.18 ) );
    float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - 0.18;
    float edge = 1.0 - smoothstep( -uSoft, 0.0, d );
    float hot = 0.82 + 0.18 * ( 1.0 - clamp( length( p / uAspect ), 0.0, 1.0 ) );
    gl_FragColor = vec4( uColor * edge * hot, 1.0 );
  }
`;

/** The surrounding room: ceiling → wall → floor gradient with a faint horizon glow. */
const DOME_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = normalize( position ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const DOME_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uWall;
  uniform vec3 uFloor;
  uniform vec3 uGlow;
  void main() {
    float y = vDir.y;
    vec3 c = mix( uWall, uTop, smoothstep( 0.05, 0.85, y ) );
    c = mix( c, uFloor, smoothstep( 0.0, -0.45, y ) );
    // Wall panels: gentle vertical banding so reflections are not perfectly flat.
    float a = atan( vDir.x, vDir.z );
    c *= 0.93 + 0.07 * smoothstep( 0.2, 0.8, abs( sin( a * 6.0 ) ) );
    c += uGlow * exp( -abs( y + 0.04 ) * 18.0 );
    gl_FragColor = vec4( c, 1.0 );
  }
`;

function lin(hex: string, gain = 1): Color {
  return new Color(hex).multiplyScalar(gain);
}

/**
 * Builds the procedural studio the cabinet is lit and reflected by, tinted by the theme: a
 * graded room, a long ceiling light strip directly above (it matches the cabinet's own ceiling
 * diffuser), two tall side softboxes in the theme's LED colours, a rim panel behind, a large dim
 * front fill (the room behind the player), a floor bounce and a ring of small arcade lights that
 * give chrome and glass their glints. Unlit materials only; HDR values above 1 are intended.
 */
export function buildStudioScene(theme: ThemeDef): { scene: Scene; dispose: () => void } {
  const scene = new Scene();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const own = <G extends BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };
  const mat = <M extends Material>(m: M): M => {
    materials.push(m);
    return m;
  };
  const [top, wall, floor] = theme.lights.env;
  const leds = theme.cabinet.led;
  const white = new Color('#ffffff');
  const dark = theme.cabinet.pattern === 'cosmos' || theme.cabinet.pattern === 'circuit';

  const dome = new Mesh(
    own(new SphereGeometry(12, 48, 24)),
    mat(
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: lin(top, dark ? 0.7 : 1.05) },
          uWall: { value: lin(wall, dark ? 0.45 : 0.8) },
          uFloor: { value: lin(floor, 0.5) },
          uGlow: { value: lin(leds[0]!, dark ? 0.22 : 0.18) },
        },
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
      }),
    ),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  const softbox = (w: number, h: number, color: Color, x: number, y: number, z: number, lookAt: [number, number, number], soft = 0.35) => {
    const m = new Mesh(
      own(new PlaneGeometry(w, h)),
      mat(
        new ShaderMaterial({
          side: DoubleSide,
          uniforms: { uColor: { value: color }, uSoft: { value: soft }, uAspect: { value: [w / Math.max(w, h), h / Math.max(w, h)] } },
          vertexShader: SOFTBOX_VERTEX,
          fragmentShader: SOFTBOX_FRAGMENT,
        }),
      ),
    );
    m.position.set(x, y, z);
    m.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    scene.add(m);
    return m;
  };

  // Ceiling light strip right above the play field, and a thinner one above the player.
  softbox(3.4, 1.1, lin(top, 7.5), 0, 3.2, -0.4, [0, 0, -0.4], 0.25);
  softbox(2.8, 0.32, lin(top, 3.4), 0, 2.7, 2.6, [0, 0.2, -0.3], 0.3);
  // Tall side softboxes, tinted towards the theme's first two LED colours (only lightly on dark
  // themes, whose saturated LEDs would otherwise colour every reflection).
  const tint = dark ? 0.8 : 0.55;
  const sideA = lin(leds[0]!).lerp(white, tint).multiplyScalar(2.6);
  const sideB = lin(leds[1 % leds.length]!).lerp(white, tint).multiplyScalar(2.6);
  softbox(1.3, 3.4, sideA, -4.4, 0.9, 0.6, [0, 0.4, -0.2]);
  softbox(1.3, 3.4, sideB, 4.4, 0.9, 0.6, [0, 0.4, -0.2]);
  // Rim panel behind the cabinet.
  softbox(4.2, 1.3, lin(theme.lights.rim).lerp(white, dark ? 0.6 : 0.3).multiplyScalar(2), 0, 1.6, -5.2, [0, 0.4, 0]);
  // Front fill: the room behind the player, large and dim.
  softbox(7, 3.2, lin(top).lerp(white, 0.5).multiplyScalar(0.9), 0, 1.0, 6.2, [0, 0.4, 0], 0.8);
  // Floor bounce.
  const bounce = new Mesh(own(new CircleGeometry(4, 48)), mat(new MeshBasicMaterial({ color: lin(floor).lerp(lin(theme.cabinet.mat), 0.5).multiplyScalar(0.75) })));
  bounce.rotation.x = -Math.PI / 2;
  bounce.position.y = -2.4;
  scene.add(bounce);

  // Arcade practicals: small bright dots around the horizon for glints in chrome and glass.
  const dots = new Group();
  const rng = makeRng(71 + theme.id.length * 7);
  const dotGeometry = own(new SphereGeometry(0.07, 10, 6));
  const dotMats = leds.map((hex) => mat(new MeshBasicMaterial({ color: lin(hex).lerp(white, 0.25).multiplyScalar(9), blending: AdditiveBlending })));
  for (let i = 0; i < 28; i++) {
    const a = rng() * Math.PI * 2;
    // Keep the area straight above the field and behind the player free of dots.
    if (Math.abs(Math.cos(a)) > 0.92) continue;
    const r = 7 + rng() * 2;
    const dot = new Mesh(dotGeometry, dotMats[i % dotMats.length]!);
    dot.position.set(Math.sin(a) * r, -0.6 + rng() * 2.2, Math.cos(a) * r);
    dots.add(dot);
  }
  scene.add(dots);

  return {
    scene,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
