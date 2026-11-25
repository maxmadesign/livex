/**
 * Small static models of the machines (docs/design/machines.md, sections 4.11 and 5): for the lobby
 * cards (pictures) and for neighbouring cabinets beyond the side glass (render-only models). Built
 * from the same FieldGeometry as the machine itself, with a fixed handful of items, in the theme's
 * colours (palette colours only on the gpu theme), under 3 k triangles each.
 *
 *   buildMachinePreview(genre, theme)        → a Group to place in any scene (dispose() when done)
 *   renderMachinePreviews(theme, genres)     → data-URL pictures for the lobby cards (its own small
 *                                              WebGL context, released when done, like the plush
 *                                              thumbnails)
 *
 * Presentation only: nothing here touches the simulation.
 */
import {
  AgXToneMapping,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GENRES, isPendingGenre } from '../../game/machines/registry';
import type { GenreId } from '../../game/machines/ids';
import { CLASSIC_FIELD, floorWithHole, type FieldGeometry, type Fixture } from '../../physics/fieldGeometry';
import { CHUTE, FIELD } from '../../physics/fieldSpec';
import type { ThemeDef } from '../../themes/themes';
import { sceneInk, sceneKit } from '../brandScene';
import { gemGeometry } from '../ItemVisuals';
import { capsuleGeometry } from './fixtures';
import { GEM_LOOKS, itemColors } from './itemLooks';

/** Triangle ceiling of one preview (design 4.11). */
export const PREVIEW_TRIANGLE_LIMIT = 3000;

/** The machine's layout at its genre's defaults (classic for a genre whose module has not landed). */
export function previewField(genre: GenreId): FieldGeometry {
  const module = GENRES[genre];
  if (!module || isPendingGenre(module)) return CLASSIC_FIELD;
  try {
    return module.geometry(module.defaults as never);
  } catch {
    return CLASSIC_FIELD;
  }
}

/** Deterministic 0..1 sequence (no Math.random: previews look the same every time). */
function seq(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Part {
  geometry: BufferGeometry;
  color: string;
  metal?: boolean;
  glow?: boolean;
  /** Clear acrylic (fences, the chute guard): see-through. */
  clear?: boolean;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

function fixtureParts(f: Fixture, colors: { metal: string; acrylic: string; deck: string; ramp: string }): Part[] {
  if (f.look === 'hidden') return [];
  if (f.shape.type === 'capsule') {
    const g = mergeGeometries(capsuleGeometry(f.shape.radius, f.shape.halfLength, 8).map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
    if (f.shape.axis === 'z') g.rotateX(Math.PI / 2);
    else if (f.shape.axis === 'x') g.rotateZ(Math.PI / 2);
    g.translate(f.center[0], f.center[1], f.center[2]);
    return [{ geometry: g, color: colors.metal, metal: true }];
  }
  const [hx, hy, hz] = f.shape.half;
  const g = new BoxGeometry(2 * hx, 2 * hy, 2 * hz);
  if (f.rot) g.applyQuaternion(new Quaternion(f.rot[0], f.rot[1], f.rot[2], f.rot[3]));
  g.translate(f.center[0], f.center[1], f.center[2]);
  const color = f.look === 'acrylic' ? colors.acrylic : f.look === 'deck' ? colors.deck : f.look === 'ramp' ? colors.ramp : colors.metal;
  return [{ geometry: g, color, metal: f.look === 'chrome', clear: f.look === 'acrylic' }];
}

/** The items a card shows: the box on the bars, a few snack stacks, a scatter of gems, a plush pile. */
function itemParts(genre: GenreId, theme: ThemeDef, field: FieldGeometry): Part[] {
  const ink = sceneInk(theme);
  const colors = itemColors(theme);
  const rnd = seq(genre.length * 97 + 13);
  const out: Part[] = [];
  if (genre === 'bridge') {
    const bars = field.fixtures.filter((f) => f.kind === 'bar');
    const top = bars.length ? Math.max(...bars.map((b) => b.center[1] + (b.shape.type === 'capsule' ? b.shape.radius : 0))) : 0.11;
    const cx = bars.length ? bars.reduce((a, b) => a + b.center[0], 0) / bars.length : -0.2;
    const cz = bars.length ? bars[0]!.center[2] : -0.22;
    out.push({ geometry: box(0.24, 0.1, 0.1, cx + 0.02, top + 0.05, cz).rotateY(0), color: colors.card.border });
    out.push({ geometry: box(0.2, 0.06, 0.002, cx + 0.02, top + 0.055, cz + 0.051), color: colors.card.paper });
  } else if (genre === 'shelf') {
    const deck = field.fixtures.find((f) => f.look === 'deck');
    const y0 = deck && deck.shape.type === 'box' ? deck.center[1] + deck.shape.half[1] : 0.16;
    const tones = [ink.primary, ink.accent, ink.accent2, colors.card.border];
    let i = 0;
    for (const z of [-0.39, -0.53])
      for (const x of [-0.3, -0.1, 0.1, 0.3]) {
        const n = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) out.push({ geometry: box(0.06, 0.055, 0.055, x, y0 + 0.0275 + k * 0.056, z), color: tones[i++ % tones.length]! });
      }
  } else if (genre === 'rush') {
    const gem = gemGeometry();
    for (let i = 0; i < 20; i++) {
      const look = GEM_LOOKS[i % 4 === 3 && rnd() < 0.5 ? 3 : Math.floor(rnd() * 3)]!;
      const g = gem.clone().scale(0.036, 0.036, 0.036).rotateZ((rnd() - 0.5) * 1.2).translate(-0.3 + rnd() * 0.65, 0.016, -0.7 + rnd() * 0.5);
      out.push({ geometry: g, color: colors.gems[look].color, glow: true });
    }
    for (let i = 0; i < 6; i++) out.push({ geometry: new CylinderGeometry(0.026, 0.026, 0.01, 10).translate(-0.3 + rnd() * 0.65, 0.005, -0.7 + rnd() * 0.5), color: colors.coin.color, metal: true });
    gem.dispose();
  } else {
    // Classic: a pile of round plush shapes in the theme's colours.
    const tones = [ink.primary, ink.accent, ink.accent2, ink.glow];
    for (let i = 0; i < 12; i++) {
      const r = 0.05 + rnd() * 0.025;
      out.push({ geometry: new SphereGeometry(r, 10, 7).translate(-0.15 + rnd() * 0.55, r * 0.9, -0.7 + rnd() * 0.5), color: tones[i % tones.length]! });
    }
  }
  return out;
}

export interface MachinePreview {
  group: Group;
  triangles: number;
  dispose(): void;
}

/**
 * A static model of a machine's play field (floor with its opening, fixtures, items, back wall and
 * the corner posts of the glass), one merged mesh per colour, in the cabinet's own frame (front
 * glass at z = 0, floor top at y = 0).
 */
export function buildMachinePreview(genre: GenreId, theme: ThemeDef): MachinePreview {
  const field = previewField(genre);
  const cab = theme.cabinet;
  const kit = sceneKit(theme);
  const ink = sceneInk(theme);
  const colors = { metal: cab.metalTint, acrylic: cab.acrylicEdge, deck: cab.frame, ramp: kit ? kit.palette.gray800 : cab.frameAccent };
  const parts: Part[] = [];
  const T = FIELD.floorThickness;
  const hole = field.floor.kind === 'hole' ? field.floor.hole : { xMin: CHUTE.xMin, xMax: CHUTE.xMax, zMin: CHUTE.zMin, zMax: CHUTE.zMax };
  for (const p of floorWithHole(hole)) parts.push({ geometry: box(2 * p.half[0], 2 * p.half[1], 2 * p.half[2], p.center[0], p.center[1], p.center[2]), color: cab.mat });
  // The opening, dark, a little below the floor.
  parts.push({ geometry: box(hole.xMax - hole.xMin, 0.004, hole.zMax - hole.zMin, (hole.xMin + hole.xMax) / 2, -T, (hole.zMin + hole.zMax) / 2), color: kit ? kit.palette.gray950 : '#2a2230' });
  if (field.chuteGuard) {
    parts.push({ geometry: box(0.012, CHUTE.wallHeight, CHUTE.zMax - CHUTE.zMin, CHUTE.xMax + 0.006, CHUTE.wallHeight / 2, (CHUTE.zMin + CHUTE.zMax) / 2), color: cab.acrylicEdge, clear: true });
    parts.push({ geometry: box(CHUTE.xMax - CHUTE.xMin, CHUTE.wallHeight, 0.012, (CHUTE.xMin + CHUTE.xMax) / 2, CHUTE.wallHeight / 2, CHUTE.zMin - 0.006), color: cab.acrylicEdge, clear: true });
  }
  for (const f of field.fixtures) parts.push(...fixtureParts(f, colors));
  parts.push(...itemParts(genre, theme, field));
  // Back wall, side posts and the gantry: just enough of the cabinet to read as a machine.
  parts.push({ geometry: box(2 * FIELD.halfWidth, FIELD.ceilingY, 0.02, 0, FIELD.ceilingY / 2, -FIELD.depth - 0.01), color: cab.backboard });
  for (const sx of [-1, 1]) {
    parts.push({ geometry: box(0.03, FIELD.ceilingY, 0.03, sx * (FIELD.halfWidth + 0.015), FIELD.ceilingY / 2, -FIELD.depth + 0.015), color: cab.frame });
    parts.push({ geometry: box(0.03, FIELD.ceilingY, 0.03, sx * (FIELD.halfWidth + 0.015), FIELD.ceilingY / 2, -0.015), color: cab.frame });
  }
  parts.push({ geometry: box(2 * FIELD.halfWidth + 0.06, 0.04, FIELD.depth, 0, FIELD.ceilingY + 0.02, -FIELD.depth / 2), color: cab.frame });
  // A claw hanging at home.
  const home = field.home;
  parts.push({ geometry: new CylinderGeometry(0.002, 0.002, 0.3, 4).translate(home.x, FIELD.ceilingY - 0.15, home.z), color: cab.metalTint, metal: true });
  parts.push({ geometry: new CylinderGeometry(0.03, 0.035, 0.05, 10).translate(home.x, FIELD.ceilingY - 0.32, home.z), color: cab.clawCap });
  void ink;

  // One mesh per colour and finish.
  const byKey = new Map<string, { list: BufferGeometry[]; part: Part }>();
  for (const p of parts) {
    const key = `${p.color}|${p.metal ? 1 : 0}|${p.glow ? 1 : 0}|${p.clear ? 1 : 0}`;
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    if (g !== p.geometry) p.geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const entry = byKey.get(key) ?? { list: [], part: p };
    entry.list.push(g);
    byKey.set(key, entry);
  }
  const group = new Group();
  group.name = `machine-preview-${genre}`;
  const materials: Material[] = [];
  let triangles = 0;
  for (const { list, part } of byKey.values()) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const color = new Color(part.color);
    const material = new MeshStandardMaterial({ color, roughness: part.metal ? 0.3 : 0.7, metalness: part.metal ? 0.8 : 0, emissive: part.glow ? color.clone().multiplyScalar(0.25) : new Color(0x000000) });
    if (part.clear) {
      material.transparent = true;
      material.opacity = 0.35;
      material.depthWrite = false;
    }
    materials.push(material);
    const mesh = new Mesh(merged, material);
    if (part.clear) mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    triangles += merged.getAttribute('position').count / 3;
  }
  return {
    group,
    triangles,
    dispose: () => {
      group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * Pictures of the machines for the lobby cards (data URLs, `size` px square, transparent
 * background), in the theme's colours. Uses its own small WebGL context, released when done, so it
 * never disturbs the game's renderer. Resolves to {} when WebGL is not available.
 */
export async function renderMachinePreviews(theme: ThemeDef, genres: readonly GenreId[], size = 256): Promise<Partial<Record<GenreId, string>>> {
  const out: Partial<Record<GenreId, string>> = {};
  if (genres.length === 0 || typeof document === 'undefined') return out;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  } catch {
    return out;
  }
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new Scene();
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(-0.6, 2, 1.4);
    scene.add(key, new HemisphereLight(0xffffff, 0x888888, 1.1));
    const camera = new PerspectiveCamera(34, 1, 0.05, 10);
    camera.position.set(0.3, 1.0, 1.55);
    camera.lookAt(0, 0.2, -0.42);
    for (const genre of genres) {
      const preview = buildMachinePreview(genre, theme);
      scene.add(preview.group);
      renderer.render(scene, camera);
      out[genre] = canvas.toDataURL('image/png');
      preview.dispose();
      // Let the page breathe between pictures.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
