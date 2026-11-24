import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Scene, ShaderMaterial, type Material, type Object3D, type WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { FIELD } from '../../../src/physics/fieldSpec';
import { ContactShadows, createContactMaterial } from '../../../src/scene/contactShadows';

/** Records what a warm-up compiles (and against which render target) without a WebGL context. */
function fakeRenderer() {
  let target: WebGLRenderTarget | null = null;
  const compiled: { materials: Material[]; target: WebGLRenderTarget | null; instanced: boolean[] }[] = [];
  return {
    compiled,
    getRenderTarget: () => target,
    setRenderTarget: (t: WebGLRenderTarget | null) => {
      target = t;
    },
    compileAsync: (root: Object3D) => {
      const materials: Material[] = [];
      const instanced: boolean[] = [];
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        materials.push(mesh.material as Material);
        instanced.push((mesh as InstancedMesh).isInstancedMesh === true);
      });
      compiled.push({ materials, target, instanced });
      return Promise.resolve();
    },
  };
}

describe('contact shadows warm-up', () => {
  it('compiles the height materials of the casters against the contact target, once per material, and restores the target', async () => {
    const contact = new ContactShadows({ minX: -FIELD.halfWidth, maxX: FIELD.halfWidth, minZ: -FIELD.depth, maxZ: 0, floorY: 0 }, { minX: -0.5, maxX: -0.2, minZ: -0.3, maxZ: 0 }, 256);
    const box = new BoxGeometry(0.1, 0.1, 0.1);
    // Claw: two plain casters (share the plain height material) and a non-caster.
    const claw = new Group();
    claw.name = 'claw';
    const finger = new Mesh(box, new MeshBasicMaterial());
    finger.castShadow = true;
    const finger2 = new Mesh(box, new MeshBasicMaterial());
    finger2.castShadow = true;
    const cable = new Mesh(box, new MeshBasicMaterial());
    claw.add(finger, finger2, cable);
    // Toys: a caster with its own deformed height material, and fur shells left out of the pass.
    const toys = new Group();
    toys.name = 'toys';
    const toyContact = createContactMaterial({ pars: '', main: 'vec3 plushPos = position;', uniforms: {} });
    const toy = new Mesh(box, new MeshBasicMaterial());
    toy.castShadow = true;
    toy.userData.contactMaterial = toyContact;
    const shell = new InstancedMesh(box, new MeshBasicMaterial(), 4);
    shell.castShadow = true;
    shell.userData.shadowSkip = true;
    toys.add(toy, shell);
    const scene = new Scene();
    scene.add(claw, toys);

    const renderer = fakeRenderer();
    const previous = { isWebGLRenderTarget: true } as unknown as WebGLRenderTarget;
    renderer.setRenderTarget(previous);
    await contact.compile(renderer as never, scene, [toys, claw]);

    expect(renderer.compiled).toHaveLength(1);
    const call = renderer.compiled[0]!;
    // Bound to the contact map's own target while compiling, the caller's target restored after.
    expect(call.target).not.toBe(previous);
    expect(call.target).not.toBeNull();
    expect(renderer.getRenderTarget()).toBe(previous);
    // The toy's deformed material and one plain height material for both fingers; no shell, no cable.
    expect(call.materials).toHaveLength(2);
    expect(call.materials).toContain(toyContact);
    const plain = call.materials.find((m) => m !== toyContact) as ShaderMaterial;
    expect(plain.name).toBe('contact-height');
    expect(call.instanced.every((i) => !i)).toBe(true);
    // The scene's own meshes keep their materials.
    expect(finger.material).toBeInstanceOf(MeshBasicMaterial);
    expect(toy.material).toBeInstanceOf(MeshBasicMaterial);
    contact.dispose();
  });
});
