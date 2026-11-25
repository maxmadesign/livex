import { GLSL3, ShaderChunk, type RawShaderMaterial, type ShaderMaterial } from 'three';

/**
 * Safety net against non-finite colours (NaN, ±Inf, and values beyond the half-float range that the
 * HDR scene target would store as Inf). One bad pixel is harmless on its own, but the bloom blurs it
 * over its whole mip chain and adds the result to every pixel: a single NaN then turns a colour
 * channel off across the frame. Three cheap guards, a few ALU operations each:
 *
 *  1. every built-in material (MeshStandard / Physical / Basic …, plush included) clamps its final
 *     colour to [0, 65000] and writes black instead of NaN, right before it goes into the scene target
 *     (`opaque_fragment`, the last step of those shaders);
 *  2. the bloom's bright pass ignores whatever non-finite value still reached the target (custom
 *     shaders, blending), so nothing non-finite can enter the bloom chain;
 *  3. the output pass (tone mapping) does the same, so nothing non-finite reaches the screen.
 *
 * Finite colours inside the half-float range pass unchanged, so the picture is identical wherever
 * nothing was broken.
 */
export const HALF_FLOAT_SAFE_MAX = 65000;

/** GLSL (ES 3.00) statement that makes the vec3 lvalue `v` finite, non-negative and within the half-float range. */
export function finiteStatement(v: string): string {
  return `${v} = ( any( isnan( ${v} ) ) || any( isinf( ${v} ) ) ) ? vec3( 0.0 ) : clamp( ${v}, 0.0, ${HALF_FLOAT_SAFE_MAX.toFixed(1)} );`;
}

const MARK = '/* plush finite guard */';

/** Guard 1: patches the shared shader chunk once (before any program is compiled). Idempotent. */
export function installFiniteGuard(): void {
  if (ShaderChunk.opaque_fragment.includes(MARK)) return;
  ShaderChunk.opaque_fragment = `${MARK}\n${finiteStatement('outgoingLight')}\n${ShaderChunk.opaque_fragment}`;
}

/** Guard 2: the bloom's luminosity high pass reads the scene target through this. */
export function guardBloomInput(material: ShaderMaterial): void {
  if (material.fragmentShader.includes(MARK)) return;
  const read = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!material.fragmentShader.includes(read)) return;
  material.fragmentShader = material.fragmentShader.replace(read, `${read}\n${MARK}\n${finiteStatement('texel.rgb')}`);
  material.needsUpdate = true;
}

/**
 * Guard 3: the output pass is a raw GLSL ES 1.00 shader (no isnan there): it is compiled as GLSL ES
 * 3.00 instead, with the usual three.js aliases, and checks its input before tone mapping.
 */
export function guardOutput(material: RawShaderMaterial): void {
  if (material.fragmentShader.includes(MARK)) return;
  const read = 'gl_FragColor = texture2D( tDiffuse, vUv );';
  if (!material.fragmentShader.includes(read)) return;
  material.glslVersion = GLSL3;
  material.vertexShader = `#define attribute in\n#define varying out\n${material.vertexShader}`;
  material.fragmentShader =
    `#define varying in\nlayout( location = 0 ) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n` +
    material.fragmentShader.replace(read, `${read}\n${MARK}\n${finiteStatement('gl_FragColor.rgb')}`);
  material.needsUpdate = true;
}
