import {
  AgXToneMapping,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PlushLibrary } from './PlushLibrary';
import { PlushMaterial, applyPaint, createPlushUniforms } from './PlushMaterial';
import type { PlushAsset } from './manifest';

/**
 * Renders small transparent portraits of characters for the HUD (collection,
 * prize card, settings previews). Uses its own tiny WebGL context that is
 * released as soon as the batch is done, so it never disturbs the game's
 * renderer state.
 */
export async function renderThumbnails(library: PlushLibrary, assets: readonly PlushAsset[], size = 256): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (assets.length === 0) return out;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.6;
    const key = new DirectionalLight(0xfff6ea, 2.7);
    key.position.set(-0.5, 1.4, 1.2);
    const rim = new DirectionalLight(0xcfe0ff, 1.1);
    rim.position.set(0.9, 0.8, -1.1);
    scene.add(key, rim, new HemisphereLight(0xffffff, 0xd8ccd0, 0.55));
    const camera = new PerspectiveCamera(24, 1, 0.05, 10);
    const target = new Vector3();

    for (const asset of assets) {
      const loaded = await library.load(asset);
      const uniforms = createPlushUniforms();
      applyPaint(uniforms, asset);
      const material = new PlushMaterial(uniforms, { dents: 1, deformNormals: false });
      const mesh = loaded.custom ? loaded.custom.clone(true) : new Mesh(loaded.lods[0]!, material);
      mesh.rotation.y = -0.38;
      scene.add(mesh);
      const extent = Math.max(asset.size[0], asset.size[1], asset.size[2]);
      target.set(0, asset.size[1] * 0.5, 0);
      const dist = (extent * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(0, asset.size[1] * 0.58, dist);
      camera.lookAt(target);
      renderer.render(scene, camera);
      out[asset.id] = canvas.toDataURL('image/png');
      scene.remove(mesh);
      material.dispose();
      // Yield so a batch of portraits never blocks a frame of the game for long.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    env.dispose();
    pmrem.dispose();
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
