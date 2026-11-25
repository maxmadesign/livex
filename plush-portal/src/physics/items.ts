/**
 * Machine items (docs/design/machines.md, sections 2.2 and 3): printed boxes and snacks, gems and
 * coins. An item is an ordinary ToyBody with `item` set, so the grip monitor, impacts, the prize
 * sensor, interpolation and the debug API work on it unchanged. Its collision proxies use the
 * plush manifest's proxy type, so PhysicsWorld builds them with the same code as a plush toy.
 */
import type { ThemeId, Vec3 } from '../core/types';
import type { PlushAsset, ProxyShape } from '../plush/manifest';

export type ItemKind = 'box' | 'snack' | 'gem' | 'coin';
export type ItemLook = 'bridgeBox' | 'snackS' | 'snackM' | 'snackL' | 'gemEmerald' | 'gemSapphire' | 'gemRuby' | 'gemDiamond' | 'coin';

export interface ItemSpec {
  kind: ItemKind;
  /** Visual recipe for src/scene/ItemVisuals (physics never reads it). */
  look: ItemLook;
  size: Vec3;
  mass: number;
  comHeight: number;
  footprint: number;
  /** Same proxy type as the plush manifest, so PhysicsWorld.colliderDesc (PhysicsWorld.ts:279-303) builds it. */
  proxies: readonly ProxyShape[];
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  /** Manifest id of the character printed on a box or snack: what the collection / claim code names. null for gems and coins. */
  print: string | null;
  /** Points of a gem or coin (raw, physics-free); 0 for printed items (they score by the print's rarity). */
  value: number;
}

/** The PlushAsset a ToyBody needs. Its id is `item.<look>` (never a manifest id: ToyVisuals, voices and rarity ignore it). */
export function itemAsset(spec: ItemSpec, themeId: ThemeId): PlushAsset {
  const label = { en: spec.look, zh: spec.look, ja: spec.look };
  return {
    id: `item.${spec.look}`,
    theme: themeId,
    slug: spec.look,
    name: label,
    kind: { en: spec.kind, zh: spec.kind, ja: spec.kind },
    size: [...spec.size],
    mass: spec.mass,
    footprint: spec.footprint,
    comHeight: spec.comHeight,
    palette: [],
    materials: [],
    // No model: ToyVisuals finds nothing to draw for it, ItemVisuals draws items.
    model: { path: '', bytes: 0, lods: [], attributes: [] },
    paint: [],
    maskRange: 0,
    proxies: spec.proxies.map((p) => ({ ...p, pos: [...p.pos], rot: [...p.rot] })),
    deform: { softAttribute: '_AUX.x', dentRadius: 0, sag: 0, squash: 0, sway: 0, softParts: [] },
    source: { status: 'original', method: 'procedural-sdf', generator: 'machine-item', license: 'project', note: 'machine item (src/physics/items.ts)' },
  };
}

/**
 * A printed box (the bridge prize) or snack box. The body's origin is the middle of the bottom
 * face, like a plush toy's base, so fields place it at the height of the surface it stands on.
 */
export function boxItem(o: { look: ItemLook; size: Vec3; mass: number; round: number; friction: number; print: string | null }): ItemSpec {
  const [x, y, z] = o.size;
  const round = Math.max(0, Math.min(o.round, x / 2 - 1e-3, y / 2 - 1e-3, z / 2 - 1e-3));
  const bridge = o.look === 'bridgeBox';
  return {
    kind: bridge ? 'box' : 'snack',
    look: o.look,
    size: [x, y, z],
    mass: o.mass,
    comHeight: y / 2,
    footprint: Math.max(x, z) / 2,
    proxies: [{ part: 'box', role: 'core', geometry: { type: 'cuboid', hx: x / 2, hy: y / 2, hz: z / 2, round }, pos: [0, y / 2, 0], rot: [0, 0, 0, 1], massFraction: 1 }],
    friction: o.friction,
    // The bridge box is heavier and should not bounce off the bars; snacks tumble a little more.
    restitution: bridge ? 0.03 : 0.05,
    linearDamping: bridge ? 0.35 : 0.3,
    angularDamping: bridge ? 2.2 : 1.5,
    print: o.print,
    value: 0,
  };
}

/**
 * 17-point brilliant hull (flat table, culet): an octagonal girdle of `radius`, an octagonal table
 * on the crown and one culet point at the bottom of the pavilion. Origin at the girdle centre.
 */
export function gemItem(o: { look: ItemLook; radius: number; mass: number; value: number }): ItemSpec {
  const r = o.radius;
  const crown = 0.32 * r;
  const pavilion = 0.86 * r;
  const table = 0.56 * r;
  const points: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    points.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    points.push(Math.cos(a) * table, crown, Math.sin(a) * table);
  }
  points.push(0, -pavilion, 0);
  return {
    kind: 'gem',
    look: o.look,
    size: [2 * r, crown + pavilion, 2 * r],
    mass: o.mass,
    // Resting on a facet: the girdle centre is about one crown height above the floor.
    comHeight: crown,
    footprint: r,
    proxies: [{ part: 'gem', role: 'core', geometry: { type: 'hull', points }, pos: [0, 0, 0], rot: [0, 0, 0, 1], massFraction: 1 }],
    friction: 0.7,
    restitution: 0.1,
    linearDamping: 0.3,
    angularDamping: 1.5,
    print: null,
    value: o.value,
  };
}

/** 12-gon prism hull, lying flat. Origin at the coin's centre. */
export function coinItem(o: { radius: number; thickness: number; mass: number; value: number }): ItemSpec {
  const r = o.radius;
  const h = o.thickness / 2;
  const points: number[] = [];
  for (const y of [-h, h]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      points.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  return {
    kind: 'coin',
    look: 'coin',
    size: [2 * r, o.thickness, 2 * r],
    mass: o.mass,
    comHeight: h,
    footprint: r,
    proxies: [{ part: 'coin', role: 'core', geometry: { type: 'hull', points }, pos: [0, 0, 0], rot: [0, 0, 0, 1], massFraction: 1 }],
    friction: 0.7,
    restitution: 0.1,
    linearDamping: 0.3,
    angularDamping: 1.5,
    print: null,
    value: o.value,
  };
}
