import { BufferAttribute, BufferGeometry, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ToyBody } from '../../../src/physics/PhysicsWorld';
import type { LoadedPlush, PlushLibrary } from '../../../src/plush/PlushLibrary';
import { PLUSH_DEFORM_GLSL } from '../../../src/plush/PlushMaterial';
import { createContactMaterial } from '../../../src/scene/contactShadows';
import { LOD2_BELOW_PX, projectedHeight, shadowLodFor, ToyVisuals, type ToyQuality } from '../../../src/scene/ToyVisuals';
import { fakeAsset } from '../helpers/fakeAssets';

/** A geometry with `triangles` triangles and the attributes the plush material reads. */
function lodGeometry(triangles: number): BufferGeometry {
  const g = new BufferGeometry();
  const n = 3;
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('_aux', new BufferAttribute(new Float32Array(n * 4), 4));
  g.setIndex(Array.from({ length: triangles * 3 }, (_, i) => i % 3));
  g.computeBoundingSphere();
  return g;
}

function setup(quality: ToyQuality = { lod: 'medium', fur: 'shell', deform: 'basic' }) {
  const asset = fakeAsset('bear');
  const lods = [lodGeometry(400), lodGeometry(120), lodGeometry(40)];
  const loaded: LoadedPlush = { asset, lods, fallback: false };
  const library = { textureTier: '1k', get: (id: string) => (id === asset.id ? loaded : undefined), tierFor: () => null, useTextures: async () => null } as unknown as PlushLibrary;
  const visuals = new ToyVisuals(library, quality);
  let sleeping = true;
  const toy = {
    id: 'toy-1',
    asset,
    scale: 1,
    inBin: false,
    pose: { pos: new Float32Array([0, 0, -0.4]), prevPos: new Float32Array([0, 0, -0.4]), rot: new Float32Array([0, 0, 0, 1]), prevRot: new Float32Array([0, 0, 0, 1]) },
    body: { isSleeping: () => sleeping },
  } as unknown as ToyBody;
  visuals.sync([toy]);
  const mesh = visuals.group.children[0]!.children.find((c) => (c as { isMesh?: boolean }).isMesh)! as unknown as { geometry: BufferGeometry; userData: Record<string, unknown> };
  return { visuals, toy, lods, mesh, wake: (v: boolean) => (sleeping = !v) };
}

/** A camera at `distance` metres in front of the toy, looking at it. */
function cameraAt(distance: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.05, 10);
  camera.position.set(0, 0.1, -0.4 + distance);
  camera.lookAt(new Vector3(0, 0.1, -0.4));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

describe('toy shadow LOD', () => {
  it('draws shadows with the coarsest LOD on Low / Medium and LOD1 on High and ultra softness', () => {
    expect(shadowLodFor({ lod: 'low', fur: 'flat', deform: 'basic' })).toBe(2);
    expect(shadowLodFor({ lod: 'medium', fur: 'shell', deform: 'basic' })).toBe(2);
    expect(shadowLodFor({ lod: 'high', fur: 'shell', deform: 'fine' })).toBe(1);
    expect(shadowLodFor({ lod: 'medium', fur: 'shell', deform: 'ultra' })).toBe(1);
  });

  it('gives every toy mesh its shadow geometry and a deforming contact material, and follows the quality', () => {
    const { visuals, lods, mesh } = setup();
    expect(mesh.userData.shadowGeometry).toBe(lods[2]);
    const contact = mesh.userData.contactMaterial as ShaderMaterial;
    expect(contact).toBeInstanceOf(ShaderMaterial);
    expect(contact.vertexShader).toContain('vec3 plushDeform(');
    expect(contact.defines.PLUSH_DENTS).toBe(4); // basic softness: four dent slots
    visuals.setQuality({ lod: 'high', fur: 'shell', deform: 'basic' });
    expect(mesh.userData.shadowGeometry).toBe(lods[1]);
  });
});

describe('view-dependent LOD (Medium)', () => {
  it('measures the projected height', () => {
    // 0.2 m at 1 m with a 90° vertical field of view (y scale 1) over 720 px: 72 px.
    expect(projectedHeight(0.2, 1, 1, 720)).toBeCloseTo(72);
    expect(projectedHeight(0.2, 0.5, 1, 720)).toBeCloseTo(144);
  });

  it('uses LOD2 for small non-focused toys, LOD1 for larger ones and LOD0 + shells for the focused toy', () => {
    const { visuals, toy, lods, mesh } = setup();
    visuals.updateView(cameraAt(2.5), 720);
    expect(visuals.viewStats()[0]!.px).toBeLessThan(LOD2_BELOW_PX);
    expect(mesh.geometry).toBe(lods[2]);
    visuals.updateView(cameraAt(0.35), 720);
    expect(visuals.viewStats()[0]!.px).toBeGreaterThan(LOD2_BELOW_PX);
    expect(mesh.geometry).toBe(lods[1]);
    expect(visuals.triangles).toBe(120);
    visuals.focus = toy;
    visuals.updateView(cameraAt(2.5), 720);
    expect(mesh.geometry).toBe(lods[0]);
    // Ten shell layers (on LOD0 for a procedural model), kept out of the shadow passes.
    const shell = visuals.group.children[0]!.children.find((c) => (c as { isInstancedMesh?: boolean }).isInstancedMesh)!;
    expect(shell.userData.shadowSkip).toBe(true);
    expect(shell.receiveShadow).toBe(true);
    expect(visuals.triangles).toBe(400 + 10 * 400);
    // The threshold can be switched off (always LOD1 for the others).
    visuals.focus = null;
    visuals.lod2BelowPx = 0;
    visuals.updateView(cameraAt(2.5), 720);
    expect(mesh.geometry).toBe(lods[1]);
  });

  it('is registered on the group for the stage to call', () => {
    const { visuals } = setup();
    expect(typeof visuals.group.userData.onView).toBe('function');
    expect(typeof visuals.group.userData.warmUpObjects).toBe('function');
  });

  it('offers one shell mesh per material variant for shader warm-up (only with shell fur)', () => {
    const { visuals } = setup();
    const objects = visuals.warmUpObjects();
    expect(objects).toHaveLength(1);
    const shell = objects[0] as unknown as { isInstancedMesh: boolean; count: number; material: { defines: Record<string, unknown> } };
    expect(shell.isInstancedMesh).toBe(true);
    expect(shell.count).toBe(10);
    expect(shell.material.defines).toMatchObject({ PLUSH_SHELL: '', PLUSH_DENTS: 4 });
    visuals.setQuality({ lod: 'medium', fur: 'sheen', deform: 'basic' });
    expect(visuals.warmUpObjects()).toHaveLength(0);
  });
});

describe('contact-shadow change counter', () => {
  it('changes when a toy moves and stays put while nothing moves', () => {
    const { visuals, toy, wake } = setup();
    const version = () => visuals.group.userData.contactVersion as number;
    const created = version();
    expect(created).toBeGreaterThan(0);
    wake(true);
    visuals.update(1, 1 / 60, [], [], 1 / 120);
    const first = version();
    expect(first).toBeGreaterThan(created); // first pose seen
    visuals.update(1, 1 / 60, [], [], 1 / 120);
    expect(version()).toBe(first); // awake but not moving
    toy.pose.pos[0] = 0.02;
    visuals.update(1, 1 / 60, [], [], 1 / 120);
    expect(version()).toBeGreaterThan(first);
    const moved = version();
    // Asleep again: the drag / sway deformation of the move settles, then nothing changes any more.
    wake(false);
    for (let i = 0; i < 600; i++) visuals.update(1, 1 / 60, [], [], 1 / 120);
    const settled = version();
    expect(settled).toBeGreaterThanOrEqual(moved);
    for (let i = 0; i < 10; i++) visuals.update(1, 1 / 60, [], [], 1 / 120);
    expect(version()).toBe(settled);
    visuals.sync([]);
    expect(version()).toBeGreaterThan(settled); // toy removed
  });
});

describe('contact height material', () => {
  it('applies the shared deformation and shares the toy uniforms by reference', () => {
    const uniforms = { uSquash: { value: 0 } };
    const m = createContactMaterial({ ...PLUSH_DEFORM_GLSL, uniforms, defines: { PLUSH_DENTS: 6, PLUSH_TEXTURED: '' } });
    expect(m.vertexShader).toContain('vec3 transformed = plushPos;');
    expect(m.vertexShader).not.toContain('#include <begin_vertex>');
    expect(m.uniforms.uSquash).toBe(uniforms.uSquash);
    expect(m.defines).toMatchObject({ PLUSH_DENTS: 6, PLUSH_TEXTURED: '' });
    const plain = createContactMaterial();
    expect(plain.vertexShader).toContain('#include <begin_vertex>');
    // Floor and range are shared by every height material.
    expect(plain.uniforms.uFloor).toBe(m.uniforms.uFloor);
  });
});
