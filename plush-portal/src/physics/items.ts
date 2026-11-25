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
  void spec;
  void themeId;
  throw new Error('WS-A: itemAsset');
}
export function boxItem(o: { look: ItemLook; size: Vec3; mass: number; round: number; friction: number; print: string | null }): ItemSpec {
  void o;
  throw new Error('WS-A: boxItem');
}
/** 17-point brilliant hull (flat table, culet). */
export function gemItem(o: { look: ItemLook; radius: number; mass: number; value: number }): ItemSpec {
  void o;
  throw new Error('WS-A: gemItem');
}
/** 12-gon prism hull. */
export function coinItem(o: { radius: number; thickness: number; mass: number; value: number }): ItemSpec {
  void o;
  throw new Error('WS-A: coinItem');
}
