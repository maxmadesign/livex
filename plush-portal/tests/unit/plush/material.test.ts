import { ShaderLib, Texture, Vector2, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { PlushDepthMaterial, PlushMaterial, createPlushUniforms, fabricMicroTexture, type PlushTextureSet } from '../../../src/plush/PlushMaterial';

function compile(material: PlushMaterial | PlushDepthMaterial, lib: 'physical' | 'depth' = 'physical'): WebGLProgramParametersWithUniforms {
  const shader = { vertexShader: ShaderLib[lib].vertexShader, fragmentShader: ShaderLib[lib].fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
  (material.onBeforeCompile as (shader: WebGLProgramParametersWithUniforms) => void).call(material, shader);
  return shader;
}

const set = (): PlushTextureSet => ({ map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture(), normalScale: new Vector2(1, -1) });

describe('textured plush material', () => {
  it('keeps the procedural path unchanged without textures', () => {
    const m = new PlushMaterial(createPlushUniforms());
    expect(m.textured).toBe(false);
    expect(m.vertexColors).toBe(true);
    const shader = compile(m);
    expect(shader.vertexShader).toContain('attribute vec4 _mask;');
    expect(shader.fragmentShader).toContain('float roughnessFactor = vSurf.x;');
    expect(m.customProgramCacheKey()).toBe('plush-v1');
  });

  it('uses the maps, forces metalness to 0 and keeps deformation, fur and AO', () => {
    const uniforms = createPlushUniforms();
    const textures = set();
    const m = new PlushMaterial(uniforms, { textures, shell: true });
    expect(m.textured).toBe(true);
    expect(m.vertexColors).toBe(false);
    expect(m.map).toBe(textures.map);
    expect(m.normalMap).toBe(textures.normalMap);
    expect(m.roughnessMap).toBe(textures.roughnessMap);
    expect(m.metalnessMap).toBeNull();
    expect(m.normalScale.y).toBe(-1);
    expect(m.defines).toMatchObject({ PLUSH_TEXTURED: '', PLUSH_SHELL: '', PLUSH_DEFORM_NORMALS: '' });
    expect(uniforms.uMicroTex.value).toBe(fabricMicroTexture());
    const shader = compile(m);
    // The same soft-body deformation and shell offset (fur length from _aux.y).
    expect(shader.vertexShader).toContain('vec3 plushDeform(');
    expect(shader.vertexShader).toContain('float plushFur = _aux.y;');
    expect(shader.vertexShader).toContain('vec3 transformed = plushPos;');
    expect(shader.fragmentShader).toContain('float metalnessFactor = 0.0;');
    expect(shader.fragmentShader).toContain('plushTexRough = texture2D( roughnessMap, vRoughnessMapUv ).g;');
    expect(shader.fragmentShader).toContain('texture2D( uMicroTex, mp.zy )');
    expect(shader.fragmentShader).toContain('material.sheenColor');
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= plushAO;');
    expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
    // The map itself is still applied by three's own chunk.
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    expect(m.customProgramCacheKey()).toBe('plush-textured-v1');
  });

  it('swaps textures of another resolution without a recompile', () => {
    const m = new PlushMaterial(createPlushUniforms(), { textures: set() });
    const version = m.version;
    const next = set();
    m.setTextures(next);
    expect(m.map).toBe(next.map);
    expect(m.version).toBe(version);
    // A procedural material ignores texture sets.
    const p = new PlushMaterial(createPlushUniforms());
    p.setTextures(next);
    expect(p.map).toBeNull();
  });

  it('casts shadows with the same deformation and without plush-only attributes', () => {
    const depth = new PlushDepthMaterial(createPlushUniforms(), { textured: true });
    const shader = compile(depth, 'depth');
    expect(shader.vertexShader).toContain('vec3 transformed = plushPos;');
    // The plush-only attributes are compiled out by the define.
    expect(shader.vertexShader).toMatch(/#ifndef PLUSH_TEXTURED\s+attribute vec4 _mask;/);
    expect(depth.defines).toMatchObject({ PLUSH_TEXTURED: '' });
    expect(depth.customProgramCacheKey()).toBe('plush-depth-textured-v1');
    expect(new PlushDepthMaterial(createPlushUniforms()).customProgramCacheKey()).toBe('plush-depth-v1');
  });

  it('generates a tileable fabric micro texture once', () => {
    const t = fabricMicroTexture();
    expect(fabricMicroTexture()).toBe(t);
    const { data, width, height } = t.image as { data: Uint8Array; width: number; height: number };
    expect(width).toBe(256);
    expect(height).toBe(256);
    // Tileable: the last column continues into the first one (no seam).
    let jump = 0, inner = 0;
    for (let y = 0; y < height; y++) {
      jump += Math.abs(data[(y * width + width - 1) * 4]! - data[y * width * 4]!);
      inner += Math.abs(data[(y * width + 100) * 4]! - data[(y * width + 101) * 4]!);
    }
    expect(jump).toBeLessThan(inner * 3 + height * 2);
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]!);
      max = Math.max(max, data[i]!);
    }
    expect(max - min).toBeGreaterThan(60);
  });
});
