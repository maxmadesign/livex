/**
 * Development-only asset viewer (not part of the game bundle).
 *   /viewer.html?theme=sakura            all characters of a theme
 *   /viewer.html?ids=sakura.bunny&lod=1  specific characters / LOD
 *   &yaw=30&pitch=12&dist=1.0&shell=8&cols=3&bg=f3e9e4&dent=1&sag=0.4
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BufferAttribute,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PlushLibrary } from '../plush/PlushLibrary';
import { PlushDepthMaterial, PlushMaterial, applyPaint, createPlushUniforms } from '../plush/PlushMaterial';
import type { ThemeId } from '../core/types';

declare global {
  interface Window {
    __viewerReady?: boolean;
    __viewerError?: string;
  }
}

const q = new URLSearchParams(location.search);
const num = (key: string, def: number) => (q.has(key) ? Number(q.get(key)) : def);

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(num('dpr', 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = q.get('tone') === 'aces' ? ACESFilmicToneMapping : AgXToneMapping;
  renderer.toneMappingExposure = num('exposure', 1.05);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const bg = new Color(`#${q.get('bg') ?? 'f3e9e4'}`);
  scene.background = bg;
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environmentIntensity = num('env', 0.55);

  const key = new DirectionalLight(0xfff4e6, num('key', 2.6));
  key.position.set(-0.6, 1.5, 1.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1;
  key.shadow.camera.right = 1;
  key.shadow.camera.top = 1;
  key.shadow.camera.bottom = -1;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new DirectionalLight(0xbfd8ff, num('rim', 1.1));
  rim.position.set(0.9, 0.9, -1.2);
  scene.add(rim);
  scene.add(new HemisphereLight(0xffffff, 0xd8c8c0, num('hemi', 0.5)));

  const ground = new Mesh(new CircleGeometry(4, 64), new MeshStandardMaterial({ color: bg.clone().multiplyScalar(0.97), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const library = new PlushLibrary();
  const manifest = await library.loadManifest();
  const theme = q.get('theme') as ThemeId | null;
  const ids = q.get('ids')?.split(',');
  const assets = manifest.assets.filter((a) => (ids ? ids.includes(a.id) || ids.includes(a.slug) : theme ? a.theme === theme : true));
  const lod = num('lod', 0);
  const shells = num('shell', 0);
  const cols = num('cols', Math.min(assets.length, 3));
  const spacing = num('spacing', 0.3);
  const yaw = (num('yaw', 0) * Math.PI) / 180;

  let i = 0;
  let maxHeight = 0.2;
  for (const asset of assets) {
    const loaded = await library.load(asset);
    const geometry = loaded.lods[Math.min(lod, loaded.lods.length - 1)]!;
    const uniforms = createPlushUniforms();
    applyPaint(uniforms, asset);
    if (q.has('dent')) {
      uniforms.uDent.value[0]!.set(asset.size[0] * 0.42, asset.size[1] * 0.3, 0.02, asset.deform.dentRadius);
      uniforms.uDentDir.value[0]!.set(-1, 0, 0, 0.018);
      uniforms.uDent.value[1]!.set(-asset.size[0] * 0.42, asset.size[1] * 0.3, 0.02, asset.deform.dentRadius);
      uniforms.uDentDir.value[1]!.set(1, 0, 0, 0.018);
    }
    uniforms.uSag.value = num('sag', 0);
    uniforms.uGrip.value.set(0, asset.size[1] * 0.75, 0, asset.size[1]);
    uniforms.uSquash.value = num('squash', 0);
    uniforms.uDroop.value = num('droop', 0);
    uniforms.uSway.value.set(num('sway', 0), 0, 0);
    const material = new PlushMaterial(uniforms);
    const mesh = new Mesh(geometry, material);
    mesh.customDepthMaterial = new PlushDepthMaterial(uniforms);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rows = Math.ceil(assets.length / cols);
    mesh.position.set((col - (cols - 1) / 2) * spacing, 0, (row - (rows - 1) / 2) * spacing);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    if (shells > 0) {
      const shellMaterial = new PlushMaterial(uniforms, { shell: true });
      const shellGeometry = geometry.clone();
      const layers = new Float32Array(shells);
      for (let s = 0; s < shells; s++) layers[s] = (s + 1) / shells;
      shellGeometry.setAttribute('aShell', new InstancedBufferAttribute(layers, 1));
      const shellMesh = new InstancedMesh(shellGeometry, shellMaterial, shells);
      shellMesh.position.copy(mesh.position);
      shellMesh.rotation.copy(mesh.rotation);
      shellMesh.frustumCulled = false;
      shellMesh.receiveShadow = true;
      scene.add(shellMesh);
      uniforms.uShellLength.value = num('shellLen', 0.0045);
    }
    maxHeight = Math.max(maxHeight, asset.size[1]);
    i++;
    void BufferAttribute;
  }

  const rows = Math.ceil(assets.length / cols);
  const span = Math.max(cols * spacing, rows * spacing * 0.8, maxHeight * 1.6);
  const camera = new PerspectiveCamera(num('fov', 26), window.innerWidth / window.innerHeight, 0.05, 50);
  const dist = num('dist', span * 2.3 + 0.25);
  const pitch = (num('pitch', 14) * Math.PI) / 180;
  const orbit = (num('orbit', 0) * Math.PI) / 180;
  const target = new Vector3(0, maxHeight * num('ty', 0.47), 0);
  camera.position.set(target.x + Math.sin(orbit) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(orbit) * Math.cos(pitch) * dist);
  camera.lookAt(target);

  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__viewerReady = true;
  console.log('viewer: rendered', assets.map((a) => a.id).join(', '), JSON.stringify(renderer.info.render));
}

main().catch((error) => {
  console.error(error);
  window.__viewerError = String(error instanceof Error ? error.stack : error);
});
