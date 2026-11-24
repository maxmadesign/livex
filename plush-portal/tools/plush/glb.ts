/** Writes built meshes as a binary glTF with quantised attributes and meshopt compression. */
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import type { Mesh } from './build';

const u8 = (src: Float32Array) => {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(src[i]! * 255)));
  return out;
};
const i8 = (src: Float32Array, components: number, padTo: number) => {
  const count = src.length / components;
  const out = new Int8Array(count * padTo);
  for (let v = 0; v < count; v++) {
    for (let c = 0; c < components; c++) out[v * padTo + c] = Math.max(-127, Math.min(127, Math.round(src[v * components + c]! * 127)));
  }
  return out;
};

export interface GlbOptions {
  name: string;
  /** Extra data stored on the scene (asset id, generator version…). */
  extras: Record<string, unknown>;
  compress: boolean;
}

export async function writeGlb(lods: Mesh[], options: GlbOptions): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'plush-portal tools/plush';
  const buffer = doc.createBuffer();
  const scene = doc.createScene(options.name);
  scene.setExtras(options.extras);
  // A plain PBR material so the file also looks reasonable in any glTF viewer;
  // the game replaces it with its plush shader.
  const material = doc.createMaterial('Plush').setRoughnessFactor(0.92).setMetallicFactor(0).setBaseColorFactor([1, 1, 1, 1]);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  if (options.compress) {
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }

  lods.forEach((mesh, lod) => {
    const prim = doc.createPrimitive().setMaterial(material);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.position)).setBuffer(buffer));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(i8(mesh.normal, 3, 3)).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(u8(mesh.color)).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('_MASK', doc.createAccessor().setType('VEC4').setArray(i8(mesh.mask, 4, 4)).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('_SURF', doc.createAccessor().setType('VEC4').setArray(u8(mesh.surf)).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('_AUX', doc.createAccessor().setType('VEC4').setArray(u8(mesh.aux)).setNormalized(true).setBuffer(buffer));
    const indices = mesh.count > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
    const gltfMesh = doc.createMesh(`LOD${lod}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`LOD${lod}`).setMesh(gltfMesh));
  });

  const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}
