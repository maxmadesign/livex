import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProxyShape } from '../../../src/plush/manifest';
import {
  bounds,
  buildLods,
  chartCoverage,
  cleanMesh,
  fitToReference,
  measureOutside,
  paddingSource,
  positionRemap,
  readRawModel,
  textureVariants,
  transferAttributes,
  transformMesh,
  writeTexturedGlb,
  type ReferenceMesh,
} from '../../../tools/plush/generated';
import { readJobMeta, verdictFor } from '../../../tools/plush/import-generated';

/**
 * A synthetic "generated" plush: a body sphere and a smaller head sphere offset towards +Z (so the
 * front is recognisable), UV-mapped with a seam (duplicated vertices along one meridian), in raw
 * generator units (about ±0.9), with a node transform that has to be applied on import.
 */
function blob(segments = 40, rings = 24) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const sphere = (cx: number, cy: number, cz: number, r: number, u0: number) => {
    const base = pos.length / 3;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings, phi = v * Math.PI;
      for (let i = 0; i <= segments; i++) {
        // i = segments repeats i = 0: the UV seam (same position, different UV).
        const u = i / segments, theta = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(theta);
        pos.push(cx + nx * r, cy + ny * r, cz + nz * r);
        nrm.push(nx, ny, nz);
        uv.push(u0 + u * 0.5, v);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * (segments + 1) + i, b = a + segments + 1;
        if (j !== 0) idx.push(a, b, a + 1);
        if (j !== rings - 1) idx.push(a + 1, b, b + 1);
      }
    }
  };
  sphere(0, -0.3, 0, 0.6, 0);
  sphere(0, 0.45, 0.25, 0.42, 0.5);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

async function syntheticGlb(): Promise<Uint8Array> {
  const { pos, nrm, uv, idx } = blob();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const png = async (rgb: [number, number, number]) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer());
  const material = doc
    .createMaterial('m')
    .setBaseColorTexture(doc.createTexture('c').setImage(await png([240, 200, 210])).setMimeType('image/png'))
    .setNormalTexture(doc.createTexture('n').setImage(await png([128, 128, 255])).setMimeType('image/png'))
    .setMetallicRoughnessTexture(doc.createTexture('mr').setImage(await png([255, 150, 40])).setMimeType('image/png'))
    .setMetallicFactor(1);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  // Raw units ×2 plus an offset: the importer must apply node transforms before fitting.
  const node = doc.createNode('raw').setMesh(doc.createMesh('raw').addPrimitive(prim)).setScale([2, 2, 2]).setTranslation([0.3, 1, -0.2]);
  doc.createScene().addChild(node);
  return new NodeIO().writeBinary(doc);
}

/** The procedural reference: the same shape in metres (height 0.20 m), standing on y = 0, footprint centred at (0, 0.01). */
function reference(): ReferenceMesh {
  const { pos, idx } = blob(24, 14);
  const b = bounds(pos);
  const k = 0.2 / (b.max[1] - b.min[1]);
  const position = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    position[i] = pos[i]! * k;
    position[i + 1] = (pos[i + 1]! - b.min[1]) * k;
    position[i + 2] = pos[i + 2]! * k + 0.01;
  }
  const n = position.length / 3;
  // The head (upper part) is soft in the design, the body firm; satin (no fur) below 2 cm.
  const softness = new Float32Array(n), fur = new Float32Array(n), sheen = new Float32Array(n).fill(1), ao = new Float32Array(n).fill(1);
  for (let v = 0; v < n; v++) {
    softness[v] = position[v * 3 + 1]! > 0.13 ? 0.8 : 0.1;
    fur[v] = position[v * 3 + 1]! < 0.02 ? 0 : 1;
  }
  return { position, indices: idx, softness, fur, sheen, ao };
}

const BALL = (r: number, y: number): ProxyShape => ({ part: 'body', role: 'core', geometry: { type: 'ball', r }, pos: [0, y, 0.01], rot: [0, 0, 0, 1], massFraction: 1 });

beforeAll(async () => {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
});

describe('generated model import', () => {
  it('reads, welds and fits a raw model to the character: upright, base on y = 0, height and footprint of the design', async () => {
    const raw = await readRawModel(await syntheticGlb());
    expect(raw.info.primitives).toBe(1);
    // Node scale applied: about 2 × the authored height.
    const rb = bounds(raw.mesh.position);
    expect(rb.max[1] - rb.min[1]).toBeCloseTo(2 * (0.45 + 0.42 + 0.3 + 0.6), 1);

    const { mesh } = cleanMesh(raw.mesh);
    // Seam wedges keep their own UVs but share a bitwise identical position.
    const remap = positionRemap(mesh.position);
    let seamWedges = 0;
    for (let v = 0; v < mesh.count; v++) if (remap[v] !== v) seamWedges++;
    expect(seamWedges).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(raw.mesh.count); // pole duplicates welded

    const ref = reference();
    const fit = fitToReference(mesh, ref);
    expect(fit.yawDeg).toBe(0); // head towards +Z in both
    const fitted = transformMesh(mesh, fit);
    const b = bounds(fitted.position);
    expect(b.min[1]).toBeCloseTo(0, 5);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(0.2 * 0.88);
    expect(b.max[1] - b.min[1]).toBeLessThan(0.2 * 1.12);
    const rb2 = bounds(ref.position);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo((rb2.min[0] + rb2.max[0]) / 2, 2);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo((rb2.min[2] + rb2.max[2]) / 2, 2);
    expect(fit.shapeMean).toBeLessThan(0.004);
  });

  it('finds the facing when the raw model is turned, and honours a forced yaw', async () => {
    const raw = await readRawModel(await syntheticGlb());
    const { mesh } = cleanMesh(raw.mesh);
    const turned = transformMesh(mesh, { yawDeg: 90, scale: 1, offset: [0, 0, 0], rawCentre: [0, 0, 0] });
    const fit = fitToReference(turned, reference());
    expect(fit.yawDeg).toBe(270);
    expect(fitToReference(turned, reference(), { yawDeg: 0 }).yawDeg).toBe(0);
  });

  it('transfers softness and fur from the design and builds seam-preserving LODs', async () => {
    const raw = await readRawModel(await syntheticGlb());
    const { mesh } = cleanMesh(raw.mesh);
    const ref = reference();
    const fitted = transformMesh(mesh, fitToReference(mesh, ref));
    transferAttributes(fitted, ref, { proxies: [BALL(0.09, 0.07)] });
    let headSoft = 0, bodySoft = 0, nh = 0, nb = 0;
    for (let v = 0; v < fitted.count; v++) {
      const y = fitted.position[v * 3 + 1]!;
      if (y > 0.16) {
        headSoft += fitted.aux[v * 4]!;
        nh++;
      } else if (y < 0.08 && y > 0.03) {
        bodySoft += fitted.aux[v * 4]!;
        nb++;
      }
    }
    expect(headSoft / nh).toBeGreaterThan(0.6);
    expect(bodySoft / nb).toBeLessThan(0.3);

    const { lods, seams } = await buildLods(fitted, [3000, 900, 300]);
    expect(lods).toHaveLength(3);
    const tris = lods.map((l) => l.indices.length / 3);
    expect(tris[0]).toBe(fitted.indices.length / 3); // under the LOD0 limit: kept as generated
    expect(tris[1]).toBeLessThanOrEqual(900 * 1.2);
    expect(tris[2]).toBeLessThanOrEqual(300 * 1.2);
    expect(tris[1]).toBeLessThan(tris[0]!);
    expect(tris[2]).toBeLessThan(tris[1]!);
    expect(seams[1]).toBe('kept');
    for (const lod of lods) {
      // Every LOD vertex is an original vertex (position + UV pair): no cracks, no invented UVs.
      const original = new Set<string>();
      for (let v = 0; v < fitted.count; v++) original.add(`${fitted.position[v * 3]},${fitted.position[v * 3 + 1]},${fitted.position[v * 3 + 2]},${fitted.uv[v * 2]},${fitted.uv[v * 2 + 1]}`);
      for (let v = 0; v < lod.count; v++) expect(original.has(`${lod.position[v * 3]},${lod.position[v * 3 + 1]},${lod.position[v * 3 + 2]},${lod.uv[v * 2]},${lod.uv[v * 2 + 1]}`)).toBe(true);
    }
  });

  it('measures how far a mesh sticks out of the collision proxies', async () => {
    const ref = reference();
    expect(measureOutside(ref.position, ref.indices, [BALL(0.2, 0.1)]).share).toBe(0);
    const tight = measureOutside(ref.position, ref.indices, [BALL(0.05, 0.07)]);
    expect(tight.share).toBeGreaterThan(0.5);
    expect(tight.p95).toBeGreaterThan(0.02);
    expect(verdictFor({ share: 0.2, p95: 0.015 }, { share: 0.15, p95: 0.014 }, 0.004)).toBe('ok');
    expect(verdictFor({ share: 0.35, p95: 0.025 }, { share: 0.15, p95: 0.014 }, 0.004)).toBe('check');
    expect(verdictFor({ share: 0.2, p95: 0.05 }, { share: 0.15, p95: 0.014 }, 0.004)).toBe('mismatch');
    expect(verdictFor({ share: 0.1, p95: 0.01 }, { share: 0.1, p95: 0.01 }, 0.03)).toBe('mismatch');
  });

  it('encodes WebP texture variants (metalness cleared) and writes a glTF with LODs, _AUX and EXT_texture_webp', async () => {
    const raw = await readRawModel(await syntheticGlb());
    const variants = await textureVariants(raw.textures, [
      { tier: '512', size: 32 },
      { tier: '1k', size: 64 },
      { tier: '2k', size: 128 },
    ]);
    expect([...variants.keys()]).toEqual(['512', '1k', '2k']);
    for (const v of variants.values()) {
      for (const image of [v.baseColor, v.normal, v.roughness]) expect((await sharp(image).metadata()).format).toBe('webp');
    }
    // Never upscaled beyond the source (64²).
    expect(variants.get('2k')!.size).toBe(64);
    expect((await sharp(variants.get('512')!.baseColor).metadata()).width).toBe(32);
    const rough = await sharp(variants.get('1k')!.roughness).raw().toBuffer({ resolveWithObject: true });
    expect(rough.data[2]).toBeLessThan(8); // metalness (B) cleared
    expect(Math.abs(rough.data[1]! - 150)).toBeLessThan(8); // roughness (G) kept

    const { mesh } = cleanMesh(raw.mesh);
    const ref = reference();
    const fitted = transformMesh(mesh, fitToReference(mesh, ref));
    transferAttributes(fitted, ref);
    const { lods } = await buildLods(fitted, [3000, 900, 300]);
    const glb = await writeTexturedGlb(lods, variants.get('512')!, { id: 'test.blob' });
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb);
    const root = doc.getRoot();
    expect(root.listExtensionsUsed().map((e) => e.extensionName).sort()).toEqual(['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization']);
    expect(root.listMeshes().map((m) => m.getName())).toEqual(['LOD0', 'LOD1', 'LOD2']);
    const prim = root.listMeshes()[0]!.listPrimitives()[0]!;
    expect(prim.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0', '_AUX']);
    expect(prim.getIndices()!.getCount() / 3).toBe(lods[0]!.indices.length / 3);
    expect(root.listTextures().every((t) => t.getMimeType() === 'image/webp')).toBe(true);
    const material = prim.getMaterial()!;
    expect(material.getMetallicFactor()).toBe(0);
    expect(material.getDoubleSided()).toBe(false);
    // Positions are int16 over the shared bounding box; the node transform dequantises them to the
    // fitted metres (base on y = 0), identical for every LOD.
    const pb = prim.getAttribute('POSITION')!;
    expect(pb.getComponentType()).toBe(5122);
    expect(pb.getNormalized()).toBe(true);
    const nodes = root.listNodes();
    const m = nodes[0]!.getMatrix();
    for (const n of nodes) expect(n.getMatrix()).toEqual(m);
    const el: number[] = [];
    let minY = Infinity, maxErr = 0;
    for (let i = 0; i < pb.getCount(); i++) {
      pb.getElement(i, el);
      const y = el[1]! * m[5] + m[13];
      minY = Math.min(minY, y);
      maxErr = Math.max(maxErr, Math.abs(el[0]! * m[0] + m[12] - lods[0]!.position[i * 3]!));
    }
    expect(minY).toBeCloseTo(0, 4);
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('pads the gaps between UV charts from each chart’s own edge', async () => {
    // One chart: the left half of a 16² atlas (two triangles).
    const uv = new Float32Array([0, 0, 0.5, 0, 0.5, 1, 0, 1]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const mask = chartCoverage(uv, indices, 16, 0);
    expect(mask[3 * 16 + 2]).toBe(1);
    expect(mask[3 * 16 + 12]).toBe(0);
    const source = paddingSource(mask, 16);
    expect(source[3 * 16 + 2]).toBe(3 * 16 + 2); // inside: itself
    expect(source[3 * 16 + 12]! % 16).toBe(7); // gap: the nearest chart column (x = 7)
    // A texture whose gap is filled with a foreign colour (the baked chart colour reaches one texel
    // past the UV edge, as bakers do): after padding, the downsampled variant is uniform.
    const raw = Buffer.alloc(16 * 16 * 3);
    for (let i = 0; i < 256; i++) raw.set(i % 16 < 9 ? [200, 120, 140] : [255, 255, 255], i * 3);
    const png = new Uint8Array(await sharp(raw, { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer());
    const worstGreen = async (layout?: { uv: Float32Array; indices: Uint32Array }) => {
      const variants = await textureVariants({ baseColor: png, normal: null, metallicRoughness: null }, [{ tier: '512', size: 4 }], layout);
      const px = await sharp(variants.get('512')!.baseColor).raw().toBuffer();
      let worst = 0;
      for (let i = 0; i < px.length; i += 3) worst = Math.max(worst, Math.abs(px[i + 1]! - 120));
      return worst;
    };
    // Lossy WebP and chroma subsampling allow a few levels; the foreign white would be > 100 off.
    expect(await worstGreen({ uv, indices })).toBeLessThan(24);
    expect(await worstGreen()).toBeGreaterThan(60);
  });

  it('reads job ids and QA verdicts from the generation batch files', () => {
    const state = readJobMeta({ concept_jobs: { 'sakura.bunny': 'c-0001' }, model_jobs: { 'sakura.bunny': 'm-0001', 'ocean.jellyfish': 'm-0002' }, denied_gpu_3d: ['gpu.card'] });
    expect(state.get('sakura.bunny')).toEqual({ concept: 'c-0001', model: 'm-0001' });
    expect(state.get('ocean.jellyfish')).toEqual({ model: 'm-0002' });
    const batch = readJobMeta({ 'sakura.bunny': { conceptJob: 'c-0009', modelJob: 'm-0009', qa: 'pass', bbox: [1, 2, 3] } });
    expect(batch.get('sakura.bunny')).toEqual({ concept: 'c-0009', model: 'm-0009', qa: 'pass' });
    // The batch manifest's own format: prompts, image paths and notes are not job ids.
    const real = readJobMeta({
      'sakura.biribi': { concept_job: 'd7a60a0c-fc48-436b-849c-4c9acee6f5bd', model_job: '00713269-2106-4957-afe1-e0ed1e24623f', glb: 'raw/sakura.biribi.glb', bbox: [1.7, 1.9, 1.4], qa: 'ok (minor cosmetic)', concept_prompt: 'Photograph of a real, premium stuffed plush toy', concept_image: 'concept/sakura.biribi.png', note: 'pilot run' },
    });
    expect(real.get('sakura.biribi')).toEqual({ concept: 'd7a60a0c-fc48-436b-849c-4c9acee6f5bd', model: '00713269-2106-4957-afe1-e0ed1e24623f', qa: 'ok (minor cosmetic)' });
    const list = readJobMeta({ items: [{ id: 'ocean.seal', concept_job: 'c-000003', model_job: { id: 'm-000003' }, verdict: 'ok' }] });
    expect(list.get('ocean.seal')).toEqual({ concept: 'c-000003', model: 'm-000003', qa: 'ok' });
  });
});
