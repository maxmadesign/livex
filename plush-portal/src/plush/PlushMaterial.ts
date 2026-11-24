import { Color, MeshDepthMaterial, MeshPhysicalMaterial, RGBADepthPacking, Vector3, Vector4, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';
import type { PlushAsset } from './manifest';

/** Maximum number of simultaneous finger dents evaluated by the vertex shader. */
export const MAX_DENTS = 6;

export interface PlushUniforms {
  [uniform: string]: IUniform;
  uPaintColor: IUniform<Color[]>;
  uPaintOn: IUniform<Vector4>;
  uStitchColor: IUniform<Color[]>;
  /** Per region: number of stitches around the border (0 = no stitching). */
  uStitchCount: IUniform<Vector4>;
  uPaintCenter: IUniform<Vector3[]>;
  uPaintU: IUniform<Vector3[]>;
  uPaintV: IUniform<Vector3[]>;
  /** Metres that correspond to ±1 in the mask attribute. */
  uMaskRange: IUniform<number>;
  /** xyz = dent centre (object space), w = radius. */
  uDent: IUniform<Vector4[]>;
  /** xyz = push direction (object space, into the toy), w = depth in metres. */
  uDentDir: IUniform<Vector4[]>;
  uSquashAxis: IUniform<Vector3>;
  uSquashPivot: IUniform<Vector3>;
  /** > 0 squashes along the axis, < 0 stretches. */
  uSquash: IUniform<number>;
  /** xyz = grip point (object space), w = body length used to normalise the sag. */
  uGrip: IUniform<Vector4>;
  /** Unit gravity direction in object space. */
  uGravity: IUniform<Vector3>;
  uSag: IUniform<number>;
  /** How far floppy parts hang towards gravity (metres at softness 1). */
  uDroop: IUniform<number>;
  /** Lag of floppy parts behind the body's motion (object space, metres at softness 1). */
  uSway: IUniform<Vector3>;
  /** Overall inflate / deflate in metres (release overshoot). */
  uPuff: IUniform<number>;
  /** Shell fur: strand length in metres and noise density per metre. */
  uShellLength: IUniform<number>;
  uShellDensity: IUniform<number>;
  /** 0 = no fibre detail, 1 = full. */
  uFiber: IUniform<number>;
  uSheen: IUniform<number>;
}

export function createPlushUniforms(): PlushUniforms {
  return {
    uPaintColor: { value: [new Color(), new Color(), new Color(), new Color()] },
    uPaintOn: { value: new Vector4(0, 0, 0, 0) },
    uStitchColor: { value: [new Color(), new Color(), new Color(), new Color()] },
    uStitchCount: { value: new Vector4(0, 0, 0, 0) },
    uPaintCenter: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
    uPaintU: { value: [new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0)] },
    uPaintV: { value: [new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0)] },
    uMaskRange: { value: 0.02 },
    uDent: { value: Array.from({ length: MAX_DENTS }, () => new Vector4(0, 0, 0, 0.03)) },
    uDentDir: { value: Array.from({ length: MAX_DENTS }, () => new Vector4(0, -1, 0, 0)) },
    uSquashAxis: { value: new Vector3(0, 1, 0) },
    uSquashPivot: { value: new Vector3(0, 0, 0) },
    uSquash: { value: 0 },
    uGrip: { value: new Vector4(0, 0.15, 0, 0.2) },
    uGravity: { value: new Vector3(0, -1, 0) },
    uSag: { value: 0 },
    uDroop: { value: 0 },
    uSway: { value: new Vector3(0, 0, 0) },
    uPuff: { value: 0 },
    uShellLength: { value: 0.004 },
    uShellDensity: { value: 1500 },
    uFiber: { value: 1 },
    uSheen: { value: 1 },
  };
}

/** Copies the asset's paint regions into a uniform set. */
export function applyPaint(uniforms: PlushUniforms, asset: PlushAsset, scale = 1): void {
  uniforms.uPaintOn.value.set(0, 0, 0, 0);
  uniforms.uStitchCount.value.set(0, 0, 0, 0);
  uniforms.uMaskRange.value = asset.maskRange;
  for (const region of asset.paint) {
    const i = region.channel;
    uniforms.uPaintColor.value[i]!.set(region.color);
    uniforms.uPaintOn.value.setComponent(i, 1);
    uniforms.uStitchColor.value[i]!.set(region.stitchColor ?? region.color);
    uniforms.uStitchCount.value.setComponent(i, region.stitch ? Math.max(8, region.stitches ?? 40) : 0);
    uniforms.uPaintCenter.value[i]!.fromArray(region.center);
    uniforms.uPaintU.value[i]!.fromArray(region.axisU);
    uniforms.uPaintV.value[i]!.fromArray(region.axisV);
  }
  void scale;
}

/* ------------------------------------------------------------------- GLSL */

const DEFORM_PARS = /* glsl */ `
attribute vec4 _mask;
attribute vec4 _surf;
attribute vec4 _aux;
#ifdef PLUSH_SHELL
  attribute float aShell;
  uniform float uShellLength;
  varying float vShell;
#endif
uniform vec4 uDent[ PLUSH_DENTS ];
uniform vec4 uDentDir[ PLUSH_DENTS ];
uniform vec3 uSquashAxis;
uniform vec3 uSquashPivot;
uniform float uSquash;
uniform vec4 uGrip;
uniform vec3 uGravity;
uniform float uSag;
uniform float uDroop;
uniform vec3 uSway;
uniform float uPuff;
varying vec3 vRest;
varying vec4 vMask;
varying vec4 vSurf;
varying vec4 vAux;

// Soft-body look for a rigidly simulated toy. Everything is a function of the rest position, so
// the body, its embroidery and its shell fur deform together.
vec3 plushDeform( vec3 p, vec3 n, float soft ) {
  vec3 q = p + n * uPuff;
  // Landing squash (and rebound stretch) about the contact point.
  vec3 rel = q - uSquashPivot;
  float along = dot( rel, uSquashAxis );
  vec3 side = rel - uSquashAxis * along;
  q = uSquashPivot + uSquashAxis * along * ( 1.0 - uSquash ) + side * ( 1.0 + uSquash * 0.55 );
  // Hanging: everything below the grip stretches towards gravity and gets a little slimmer.
  vec3 fromGrip = q - uGrip.xyz;
  float below = max( dot( fromGrip, uGravity ), 0.0 );
  float t = below / max( uGrip.w, 1e-4 );
  vec3 lateral = fromGrip - uGravity * dot( fromGrip, uGravity );
  q += uGravity * ( uSag * below * ( 0.35 + 0.65 * t ) ) - lateral * ( uSag * 0.28 * smoothstep( 0.0, 1.0, t ) );
  // Floppy parts: hang towards gravity and lag behind motion.
  float s2 = soft * soft;
  q += uGravity * ( uDroop * s2 ) + uSway * s2;
  // Finger dents: pushed in at the contact, gently bulging around it.
  for ( int i = 0; i < PLUSH_DENTS; i ++ ) {
    float depth = uDentDir[ i ].w;
    if ( depth == 0.0 ) continue;
    vec3 d = q - uDent[ i ].xyz;
    float r2 = dot( d, d ) / ( uDent[ i ].w * uDent[ i ].w );
    float w = exp( - r2 * 1.4 );
    q += uDentDir[ i ].xyz * ( depth * w ) + n * ( depth * 0.42 * r2 * exp( - r2 * 0.75 ) );
  }
  return q;
}
`;

const DEFORM_MAIN = /* glsl */ `
  vRest = position;
  vMask = _mask;
  vSurf = _surf;
  vAux = _aux;
  float plushSoft = _aux.x;
  vec3 plushPos = plushDeform( position, objectNormal, plushSoft );
  #ifdef PLUSH_DEFORM_NORMALS
  {
    // Re-derive the normal from the deformed neighbourhood so dents catch the light.
    vec3 axis = abs( objectNormal.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
    vec3 t1 = normalize( cross( axis, objectNormal ) );
    vec3 t2 = cross( objectNormal, t1 );
    const float e = 0.0025;
    vec3 p1 = plushDeform( position + t1 * e, objectNormal, plushSoft );
    vec3 p2 = plushDeform( position + t2 * e, objectNormal, plushSoft );
    vec3 dn = cross( p1 - plushPos, p2 - plushPos );
    if ( dot( dn, dn ) > 1e-16 ) objectNormal = normalize( dn );
  }
  #endif
  #ifdef PLUSH_SHELL
    vShell = aShell;
    // Strands lean a little with gravity and motion towards their tips.
    plushPos += ( objectNormal + ( uGravity * 0.25 + uSway * 6.0 ) * aShell ) * ( uShellLength * aShell * _surf.w );
  #endif
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uPaintColor[ 4 ];
uniform vec4 uPaintOn;
uniform vec3 uStitchColor[ 4 ];
uniform vec4 uStitchCount;
uniform vec3 uPaintCenter[ 4 ];
uniform vec3 uPaintU[ 4 ];
uniform vec3 uPaintV[ 4 ];
uniform float uMaskRange;
uniform float uFiber;
uniform float uSheen;
uniform float uShellDensity;
varying vec3 vRest;
varying vec4 vMask;
varying vec4 vSurf;
varying vec4 vAux;
#ifdef PLUSH_SHELL
  varying float vShell;
#endif

float plushHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float plushNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( plushHash( i ), plushHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( plushHash( i + vec3( 0, 1, 0 ) ), plushHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( plushHash( i + vec3( 0, 0, 1 ) ), plushHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( plushHash( i + vec3( 0, 1, 1 ) ), plushHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// Height-field bump without tangents (derivative based).
vec3 plushBump( vec3 viewPos, vec3 nrm, float h, float strength ) {
  vec3 dpdx = dFdx( viewPos );
  vec3 dpdy = dFdy( viewPos );
  float dhdx = dFdx( h );
  float dhdy = dFdy( h );
  vec3 r1 = cross( dpdy, nrm );
  vec3 r2 = cross( nrm, dpdx );
  float det = dot( dpdx, r1 );
  vec3 grad = sign( det ) * ( dhdx * r1 + dhdy * r2 );
  return normalize( abs( det ) * nrm - strength * grad );
}
float plushAO = 1.0;
float plushHeight = 0.0;
float plushBumpAmount = 0.0;
`;

const FRAGMENT_COLOR = /* glsl */ `
  vec3 plushBase = vColor.rgb;
  plushAO = vColor.a;
  float furAmount = vSurf.w;
  // How many metres one pixel covers on the surface: fine detail fades out before it can alias.
  float pixel = max( length( fwidth( vRest ) ), 1e-6 );

  #ifdef PLUSH_SHELL
    // Shell fur: the same noise for every layer gives continuous strands that taper to their tips.
    float strand = plushNoise( vRest * uShellDensity );
    if ( furAmount < 0.03 || strand < mix( 0.28, 0.9, vShell ) ) discard;
  #endif

  // Appliqué colours with crisp, anti-aliased borders and embroidered stitches.
  float stitchMask = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    if ( uPaintOn[ i ] < 0.5 ) continue;
    float m = vMask[ i ] * uMaskRange;
    float w = max( fwidth( m ) * 0.75, 1e-5 );
    float inside = 1.0 - smoothstep( - w, w, m );
    plushBase = mix( plushBase, uPaintColor[ i ], inside );
    if ( uStitchCount[ i ] > 0.5 ) {
      float lineDist = abs( m + 0.0022 );
      float line = 1.0 - smoothstep( 0.00055, 0.00055 + w, lineDist );
      vec3 rel = vRest - uPaintCenter[ i ];
      float ang = atan( dot( rel, uPaintV[ i ] ), dot( rel, uPaintU[ i ] ) );
      float dash = smoothstep( 0.16, 0.24, abs( fract( ang * uStitchCount[ i ] * 0.15915494 ) - 0.5 ) );
      float fade = 1.0 - smoothstep( 0.0005, 0.0016, pixel );
      float s = line * dash * fade;
      plushBase = mix( plushBase, uStitchColor[ i ], s * 0.9 );
      stitchMask = max( stitchMask, s );
    }
  }

  // Seams where sewn pieces meet: a soft, slightly darker groove.
  float seam = 1.0 - smoothstep( 0.0, 0.11, vAux.y );
  seam *= 1.0 - smoothstep( 0.0012, 0.004, pixel ) * 0.6;
  plushBase *= 1.0 - 0.2 * seam;
  plushAO *= 1.0 - 0.3 * seam;

  // Pile: tufts a few millimetres wide plus fine fibres up close.
  float tuft = plushNoise( vRest * 420.0 ) * 0.6 + plushNoise( vRest * 190.0 + 3.7 ) * 0.4;
  float fibre = plushNoise( vRest * vec3( 1100.0, 1700.0, 1100.0 ) );
  float tuftFade = ( 1.0 - smoothstep( 0.0012, 0.0035, pixel ) ) * uFiber;
  float fibreFade = ( 1.0 - smoothstep( 0.0004, 0.0011, pixel ) ) * uFiber;
  float nap = plushNoise( vRest * 38.0 );
  plushBase *= 1.0 + furAmount * ( ( tuft - 0.5 ) * 0.09 * tuftFade + ( fibre - 0.5 ) * 0.1 * fibreFade + ( nap - 0.5 ) * 0.06 );
  // Embroidery thread: tight parallel rows.
  float rows = sin( vRest.y * 6283.0 / 0.9 + vRest.x * 900.0 );
  float threadFade = ( 1.0 - smoothstep( 0.0003, 0.0009, pixel ) ) * uFiber * vAux.w;
  plushBase *= 1.0 + rows * 0.07 * threadFade;
  plushHeight = furAmount * ( tuft * tuftFade * 0.00042 + fibre * fibreFade * 0.00022 ) + rows * threadFade * 0.00012 + stitchMask * 0.0004 - seam * 0.0006;
  plushBumpAmount = 1.0;

  #ifdef PLUSH_SHELL
    // Roots sit in the shadow of the strands above them.
    plushBase *= mix( 0.62, 1.06, vShell );
    plushAO *= mix( 0.75, 1.0, vShell );
  #endif
  diffuseColor.rgb *= plushBase;
`;

const FRAGMENT_NORMAL = /* glsl */ `
  if ( plushBumpAmount > 0.0 ) normal = plushBump( - vViewPosition, normal, plushHeight, 1.0 );
`;

const FRAGMENT_MATERIAL = /* glsl */ `
  #ifdef USE_SHEEN
    // Velvet-like back scattering of the pile, tinted by the fabric colour.
    material.sheenColor = mix( diffuseColor.rgb, vec3( 1.0 ), 0.35 ) * ( vSurf.y * uSheen );
    material.sheenRoughness = 0.5;
  #endif
  #ifdef USE_CLEARCOAT
    material.clearcoat = vSurf.z;
    material.clearcoatRoughness = 0.06;
  #endif
`;

const FRAGMENT_AO = /* glsl */ `
  reflectedLight.indirectDiffuse *= plushAO;
  reflectedLight.indirectSpecular *= mix( 1.0, plushAO, 0.7 );
  reflectedLight.directDiffuse *= mix( 1.0, plushAO, 0.4 );
`;

function patchVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${DEFORM_PARS}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${DEFORM_MAIN}`)
    .replace('#include <begin_vertex>', 'vec3 transformed = plushPos;');
}

export interface PlushMaterialOptions {
  /** Number of dent slots compiled into the shader (0..MAX_DENTS). */
  dents?: number;
  /** Recompute normals from the deformation (needed for dents to shade correctly). */
  deformNormals?: boolean;
  /** Compile the shell-fur variant (used with an instanced mesh and the `aShell` attribute). */
  shell?: boolean;
}

/**
 * Physically based plush: vertex-colour fabric with per-pixel appliqué masks,
 * embroidered stitches, seams, pile detail, sheen, glossy bead eyes and the
 * soft-body vertex deformation. One instance per toy (uniforms are per toy,
 * the compiled program is shared).
 */
export class PlushMaterial extends MeshPhysicalMaterial {
  readonly plush: PlushUniforms;
  readonly isPlushMaterial = true;

  constructor(uniforms: PlushUniforms = createPlushUniforms(), options: PlushMaterialOptions = {}) {
    super({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      sheen: 1,
      sheenRoughness: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1,
    });
    this.plush = uniforms;
    this.defines = {
      ...this.defines,
      PLUSH_DENTS: Math.max(1, Math.min(MAX_DENTS, options.dents ?? MAX_DENTS)),
    };
    if (options.deformNormals ?? true) this.defines.PLUSH_DEFORM_NORMALS = '';
    if (options.shell) this.defines.PLUSH_SHELL = '';
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.plush);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vAux.z;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FRAGMENT_MATERIAL}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAGMENT_AO}`);
  }

  override customProgramCacheKey(): string {
    return 'plush-v1';
  }
}

/** Depth material that applies the same deformation, so shadows follow dents, sag and squash. */
export class PlushDepthMaterial extends MeshDepthMaterial {
  constructor(readonly plush: PlushUniforms) {
    super({ depthPacking: RGBADepthPacking });
    this.defines = { ...this.defines, PLUSH_DENTS: MAX_DENTS };
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.plush);
    // The depth shader has no normal: declare one for the shared deformation code.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DEFORM_PARS}`)
      .replace('#include <begin_vertex>', `vec3 objectNormal = vec3( normal );\n${DEFORM_MAIN}\nvec3 transformed = plushPos;`);
  }

  override customProgramCacheKey(): string {
    return 'plush-depth-v1';
  }
}
