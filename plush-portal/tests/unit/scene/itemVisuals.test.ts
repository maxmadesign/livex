/**
 * ItemVisuals (docs/design/machines.md, sections 5.2 and 8.1 WS-E): instance counts per machine with
 * the real genre fields, pose interpolation, the gem and box geometry, ToyVisuals handing items over,
 * the contact / viewer-light change counter, warm-up stand-ins, disposal, and the machine previews.
 */
import { BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameCore } from '../../../src/game/GameCore';
import { gemItem } from '../../../src/physics/items';
import type { ToyBody } from '../../../src/physics/PhysicsWorld';
import type { PlushLibrary } from '../../../src/plush/PlushLibrary';
import type { PlushAsset } from '../../../src/plush/manifest';
import { boxGeometry, COIN_SEGMENTS, gemGeometry, GEM_TRIANGLES, ItemVisuals } from '../../../src/scene/ItemVisuals';
import { BOX_LAYOUT } from '../../../src/scene/machines/printAtlas';
import { buildMachinePreview, PREVIEW_TRIANGLE_LIMIT } from '../../../src/scene/machines/preview';
import { ToyVisuals } from '../../../src/scene/ToyVisuals';
import { THEMES } from '../../../src/themes/themes';
import { makeCore, themeAssets } from '../game/harness';
import { installFakeCanvas } from './cabinetHarness';

installFakeCanvas();

/** A library that knows the theme's characters but has no models loaded (no plush in the window box). */
function library(theme: 'sakura' | 'gpu' = 'sakura'): PlushLibrary {
  const assets = themeAssets(theme);
  return { textureTier: '1k', assets: (t?: string) => (t ? assets.filter((a) => a.theme === t) : assets), get: () => undefined, tierFor: () => null, useTextures: async () => null } as unknown as PlushLibrary;
}

const noImages = { loadImage: async () => ({}) as CanvasImageSource };

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});
async function core(machine: 'bridge' | 'shelf' | 'rush', theme: 'sakura' | 'gpu' = 'sakura'): Promise<GameCore> {
  const c = await makeCore({ theme, machine });
  cores.push(c);
  return c;
}

function instanced(v: ItemVisuals): InstancedMesh[] {
  return v.group.children.filter((c) => (c as InstancedMesh).isInstancedMesh) as InstancedMesh[];
}

describe('item visuals per machine (real genre fields)', () => {
  it('rush: one instanced batch per piece look, one instance per piece, every piece casts shadows', async () => {
    const c = await core('rush');
    const v = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    v.sync(c.phys.toys.values());
    const items = [...c.phys.toys.values()].filter((t) => t.item);
    expect(v.count).toBe(items.length);
    const batches = instanced(v);
    expect(new Set(batches.map((b) => b.name)).size).toBe(batches.length);
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(items.length);
    const looks = new Set(items.map((t) => t.item!.look));
    expect(batches.length).toBe(looks.size);
    for (const b of batches) {
      expect(b.castShadow).toBe(true);
      expect(b.frustumCulled).toBe(false);
    }
    expect(v.drawCalls()).toBe(looks.size);
    v.update(1, 1 / 60);
    // 44 pieces: gems are 30 triangles, coins 12-sided discs.
    const gems = items.filter((t) => t.item!.kind === 'gem').length, coins = items.length - gems;
    expect(v.triangles).toBe(gems * GEM_TRIANGLES + coins * COIN_SEGMENTS * 4);
    v.dispose();
  });

  it('shelf: snack boxes in one batch per size, each instance pointing at its print\'s atlas cell', async () => {
    const c = await core('shelf');
    const v = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    v.sync(c.phys.toys.values());
    const items = [...c.phys.toys.values()].filter((t) => t.item);
    const batches = instanced(v);
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(items.length);
    for (const b of batches) {
      const cell = b.geometry.getAttribute('aCell');
      expect(cell.count).toBe(b.count);
      for (let i = 0; i < cell.count; i++) {
        expect(cell.getZ(i)).toBeGreaterThan(0);
        expect(cell.getX(i) + cell.getZ(i)).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    v.dispose();
  });

  it('bridge: the printed box is its own mesh (window box on Medium, print only on Safe)', async () => {
    const c = await core('bridge');
    const medium = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    medium.sync(c.phys.toys.values());
    expect(medium.viewStats()).toEqual([expect.objectContaining({ look: 'bridgeBox', drawn: 'mesh' })]);
    // Outer box, its inside and the window film (no model loaded here: no plush inside).
    expect(medium.drawCalls()).toBe(3);
    const safe = new ItemVisuals(library(), { textures: '512' }, 'sans-serif', noImages);
    safe.sync(c.phys.toys.values());
    expect(safe.drawCalls()).toBe(1);
    medium.dispose();
    safe.dispose();
  });

  it('follows the interpolated pose and counts every visible change', () => {
    const v = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    const spec = gemItem({ look: 'gemRuby', radius: 0.038, mass: 0.034, value: 50 });
    const toy = {
      id: 'item-1',
      asset: { ...themeAssets('sakura')[0]!, id: 'item.gemRuby', theme: 'sakura' } as PlushAsset,
      item: spec,
      pose: { prevPos: new Float32Array([0, 0.02, -0.4]), pos: new Float32Array([0.1, 0.02, -0.4]), prevRot: new Float32Array([0, 0, 0, 1]), rot: new Float32Array([0, 0, 0, 1]) },
    } as unknown as ToyBody;
    v.sync([toy]);
    const before = v.changed;
    v.update(0.5, 1 / 60);
    const m = new Matrix4();
    instanced(v)[0]!.getMatrixAt(0, m);
    const p = new Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(0.05, 6);
    expect(new Vector3().setFromMatrixScale(m).x).toBeCloseTo(0.038, 6);
    const at = new Vector3();
    expect(v.positionOf(toy, at)).toBe(true);
    expect(at.x).toBeCloseTo(0.05, 6);
    expect(v.changed).toBeGreaterThan(before);
    // Nothing moved: no change, so the contact map and the viewer light stay as they are.
    const still = v.changed;
    v.update(0.5, 1 / 60);
    expect(v.changed).toBe(still);
    v.dispose();
  });

  it('frees its geometries on clear and dispose', async () => {
    const c = await core('rush');
    const v = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    v.sync(c.phys.toys.values());
    let disposed = 0;
    for (const b of instanced(v)) b.geometry.addEventListener('dispose', () => disposed++);
    const n = instanced(v).length;
    v.dispose();
    expect(disposed).toBe(n);
    expect(v.count).toBe(0);
    expect(v.group.children).toHaveLength(0);
  });

  it('offers one warm-up stand-in per batch with the real materials', async () => {
    const c = await core('rush');
    const v = new ItemVisuals(library(), { textures: '1k' }, 'sans-serif', noImages);
    v.sync(c.phys.toys.values());
    const stand = v.warmUpObjects() as InstancedMesh[];
    expect(stand.map((s) => s.material)).toEqual(instanced(v).map((b) => b.material));
    v.dispose();
  });
});

describe('ToyVisuals hands machine items over', () => {
  it('skips items (no plush visual) and draws them with ItemVisuals inside its group', async () => {
    const c = await core('rush');
    const lib = library();
    const visuals = new ToyVisuals(lib, { lod: 'medium', fur: 'flat', deform: 'basic', textures: '1k' });
    visuals.sync(c.phys.toys.values());
    expect(visuals.viewStats()).toHaveLength(0);
    expect(visuals.items.count).toBe([...c.phys.toys.values()].filter((t) => t.item).length);
    expect(visuals.items.group.parent).toBe(visuals.group);
    // The stage's contact map follows the items through ToyVisuals' change counter.
    const version = visuals.group.userData.contactVersion as number;
    visuals.update(1, 1 / 60, [], [], 1 / 120);
    expect(visuals.group.userData.contactVersion).toBeGreaterThan(version);
    const toy = [...c.phys.toys.values()].find((t) => t.item)!;
    expect(visuals.positionOf(toy, new Vector3())).not.toBeNull();
    visuals.dispose();
  });
});

describe('item geometry', () => {
  it('the brilliant matches the physics hull and faces outwards', () => {
    const g = gemGeometry();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    expect(p.count / 3).toBe(GEM_TRIANGLES);
    const hull = gemItem({ look: 'gemEmerald', radius: 1, mass: 1, value: 1 }).proxies[0]!.geometry as { points: number[] };
    const pts: [number, number, number][] = [];
    for (let i = 0; i < hull.points.length; i += 3) pts.push([hull.points[i]!, hull.points[i + 1]!, hull.points[i + 2]!]);
    for (let i = 0; i < p.count; i++) {
      // Every vertex is one of the 17 hull points.
      expect(pts.some(([x, y, z]) => Math.hypot(x - p.getX(i), y - p.getY(i), z - p.getZ(i)) < 1e-6)).toBe(true);
    }
    for (let f = 0; f < p.count; f += 3) {
      const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3, cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
      // From a point inside the gem (on the axis, a little below the girdle) every face points away.
      expect(n.getX(f) * cx + n.getY(f) * (cy + 0.2) + n.getZ(f) * cz).toBeGreaterThan(0);
    }
  });

  it('the bridge box maps each face into its cell of the box print', () => {
    const size: [number, number, number] = [0.24, 0.1, 0.1];
    const g = boxGeometry(size, 3, 0.004) as BufferGeometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const [fx, fy, fw, fh] = BOX_LAYOUT.front;
    let front = 0;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
      if (n.getZ(i) > 0.99) {
        front++;
        expect(uv.getX(i)).toBeGreaterThanOrEqual(fx - 1e-6);
        expect(uv.getX(i)).toBeLessThanOrEqual(fx + fw + 1e-6);
        expect(1 - uv.getY(i)).toBeGreaterThanOrEqual(fy - 1e-6);
        expect(1 - uv.getY(i)).toBeLessThanOrEqual(fy + fh + 1e-6);
      }
    }
    expect(front).toBeGreaterThan(0);
    // Origin at the middle of the bottom face, like the physics body.
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(0.1, 6);
    expect(p.count).toBeGreaterThan(24);
  });
});

describe('machine previews (lobby cards, neighbouring cabinets)', () => {
  it('build for every genre and theme under the triangle limit, and dispose cleanly', () => {
    for (const theme of [THEMES.sakura, THEMES.gpu]) {
      for (const genre of ['classic', 'bridge', 'shelf', 'rush'] as const) {
        const preview = buildMachinePreview(genre, theme);
        expect(preview.triangles, `${theme.id} ${genre}`).toBeGreaterThan(100);
        expect(preview.triangles, `${theme.id} ${genre}`).toBeLessThan(PREVIEW_TRIANGLE_LIMIT);
        expect(preview.group).toBeInstanceOf(Group);
        preview.group.traverse((o) => {
          if (!(o as Mesh).isMesh) return;
          const pos = (o as Mesh).geometry.getAttribute('position');
          for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]!), `${theme.id} ${genre}`).toBe(true);
        });
        let disposed = 0;
        preview.group.traverse((o) => {
          if ((o as Mesh).isMesh) (o as Mesh).geometry.addEventListener('dispose', () => disposed++);
        });
        const meshes = preview.group.children.length;
        preview.dispose();
        expect(disposed).toBe(meshes);
      }
    }
  });
});
