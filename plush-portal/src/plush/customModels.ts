import { Box3, BufferAttribute, Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CustomModelEntry } from '../settings/spec';
import type { PlushAsset } from './manifest';

/**
 * Locally imported replacement models.
 *
 * Supported: binary glTF 2.0 (.glb), up to 20 MB, static meshes with embedded
 * textures; EXT_meshopt_compression and KHR_mesh_quantization are understood,
 * Draco is not. The file is stored in IndexedDB on this device only. The slot
 * keeps the collision proxy, mass and name from the manifest; the model is
 * scaled to the slot's height and gets a generated softness attribute so the
 * soft-body deformation still works with its own materials.
 */
export const MAX_MODEL_BYTES = 20 * 1024 * 1024;
const DB_NAME = 'plush-portal-models';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export const saveModelFile = (key: string, data: ArrayBuffer) => tx('readwrite', (s) => s.put(data, key)).then(() => undefined);
export const loadModelFile = (key: string) => tx<ArrayBuffer | undefined>('readonly', (s) => s.get(key) as IDBRequest<ArrayBuffer | undefined>).then((v) => v ?? null);
export const deleteModelFile = (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined);

export type ModelRejection = 'too_large' | 'not_glb' | 'unsupported_version' | 'draco' | 'no_mesh' | 'parse_error';

/** Cheap structural checks before anything is stored. */
export function inspectGlb(data: ArrayBuffer): ModelRejection | null {
  if (data.byteLength > MAX_MODEL_BYTES) return 'too_large';
  if (data.byteLength < 20) return 'not_glb';
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67) return 'not_glb'; // "glTF"
  if (view.getUint32(4, true) !== 2) return 'unsupported_version';
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > data.byteLength) return 'not_glb';
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength))) as { extensionsRequired?: string[]; meshes?: unknown[] };
    if (json.extensionsRequired?.includes('KHR_draco_mesh_compression')) return 'draco';
    if (!json.meshes || json.meshes.length === 0) return 'no_mesh';
  } catch {
    return 'parse_error';
  }
  return null;
}

function toFloat(geometry: BufferGeometry, name: string): void {
  const attr = geometry.getAttribute(name);
  if (!attr) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
}

/**
 * Parses an imported GLB and returns a flat group of meshes in the slot's
 * local space: base on y = 0, centred, scaled to the slot's height.
 */
export async function buildCustomTemplate(data: ArrayBuffer, asset: PlushAsset, entry: CustomModelEntry): Promise<Group> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(data.slice(0), '');
  return templateFromScene(gltf.scene, asset, entry);
}

/**
 * Turns any glTF scene into a slot-space template (also used when a manifest
 * entry points at an ordinary GLB without the plush vertex attributes).
 */
export function templateFromScene(source: Object3D, asset: PlushAsset, entry: Pick<CustomModelEntry, 'scale' | 'yawDeg'>): Group {
  source.updateMatrixWorld(true);
  const box = new Box3().setFromObject(source);
  const size = box.getSize(new Vector3());
  if (!(size.y > 1e-6)) throw new Error('model has no height');
  const centre = box.getCenter(new Vector3());
  const k = (asset.size[1] / size.y) * entry.scale;
  const fit = new Matrix4()
    .makeRotationY((entry.yawDeg * Math.PI) / 180)
    .multiply(new Matrix4().makeScale(k, k, k))
    .multiply(new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));

  const group = new Group();
  const halfWidth = Math.max(1e-4, (Math.max(size.x, size.z) * k) / 2);
  const meshes: Mesh[] = [];
  source.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  if (meshes.length === 0) throw new Error('model contains no meshes');
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    toFloat(geometry, 'position');
    toFloat(geometry, 'normal');
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(fit, mesh.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    // Generated softness: firm near the vertical axis and the base, softer towards the outside.
    const position = geometry.getAttribute('position');
    const aux = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i)) / halfWidth;
      aux[i * 4] = Math.min(0.55, Math.max(0, r - 0.55) * 0.9);
      aux[i * 4 + 1] = 1;
    }
    geometry.setAttribute('_aux', new BufferAttribute(aux, 4));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const material = Array.isArray(mesh.material) ? mesh.material.map((m: Material) => m.clone()) : mesh.material.clone();
    const flat = new Mesh(geometry, material);
    flat.name = mesh.name;
    group.add(flat);
  }
  return group;
}

export function customModelKey(slotId: string): string {
  return `model:${slotId}:${Date.now().toString(36)}`;
}
