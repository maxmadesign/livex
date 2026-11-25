/**
 * Colours of the machine items per theme (docs/design/machines.md, section 5.2). Printed boxes take
 * the theme's scene ink (src/scene/brandScene.ts); gems, coins and the rarity stripes are fixed per
 * look. The gpu theme (a brand kit) draws palette colours only: its gems run from grey through the
 * greens to white (rarer = brighter), its coins are silver, its stripes are the kit's tier colours.
 */
import type { RarityTier } from '../../game/rarity';
import type { ItemLook } from '../../physics/items';
import type { ThemeDef } from '../../themes/themes';
import { sceneInk, sceneKit } from '../brandScene';

export type GemLook = Extract<ItemLook, 'gemEmerald' | 'gemSapphire' | 'gemRuby' | 'gemDiamond'>;
export const GEM_LOOKS: readonly GemLook[] = ['gemEmerald', 'gemSapphire', 'gemRuby', 'gemDiamond'];

export interface GemColors {
  /** Body colour (diffuse). */
  color: string;
  /** Tint of the reflections. */
  specular: string;
  /** Faint inner glow (scaled by the effects intensity). */
  glow: string;
}

export interface ItemColors {
  gems: Record<GemLook, GemColors>;
  coin: { color: string; rim: string };
  /** Printed cardboard: background, border, text, and the plain inside of the bridge box. */
  card: { paper: string; border: string; ink: string; inside: string; accent: string };
  /** Stripe of a print's rarity. */
  rarity: Record<RarityTier, string>;
  /** Rainbow interference on the diamond (off for a brand kit: it would draw other hues). */
  iridescence: boolean;
  /** Cards take a pastel of the character's colour (off for a brand kit: palette colours only). */
  tintCards: boolean;
}

export function itemColors(theme: ThemeDef): ItemColors {
  const ink = sceneInk(theme);
  const kit = sceneKit(theme);
  if (kit) {
    const p = kit.palette;
    return {
      gems: {
        gemEmerald: { color: p.gray400, specular: p.white, glow: p.gray300 },
        gemSapphire: { color: p.greenLight, specular: p.white, glow: p.greenLight },
        gemRuby: { color: p.green, specular: p.greenLight, glow: p.green },
        gemDiamond: { color: p.white, specular: p.white, glow: p.white },
      },
      coin: { color: p.gray200, rim: p.gray400 },
      card: { paper: p.black, border: p.green, ink: p.white, inside: p.gray800, accent: p.green },
      rarity: { common: p.white, rare: p.greenLight, epic: p.green, legendary: p.green },
      iridescence: false,
      tintCards: false,
    };
  }
  return {
    gems: {
      gemEmerald: { color: '#14b866', specular: '#b8ffd8', glow: '#2dff8f' },
      gemSapphire: { color: '#2257ff', specular: '#c4d4ff', glow: '#4d7bff' },
      gemRuby: { color: '#e0123f', specular: '#ffc4d0', glow: '#ff3b65' },
      gemDiamond: { color: '#f2f8ff', specular: '#ffffff', glow: '#e8f4ff' },
    },
    coin: { color: '#ffc83d', rim: '#d99a1c' },
    card: { paper: '#fffaf2', border: ink.primary, ink: ink.ink, inside: ink.primaryDeep, accent: ink.accent },
    rarity: { common: '#c9ced6', rare: '#3d9bff', epic: '#a24dff', legendary: '#ffc21a' },
    iridescence: true,
    tintCards: true,
  };
}
