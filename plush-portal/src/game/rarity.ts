/**
 * Rarity of the characters for the points system. Presentation only: rarity
 * never influences physics, grip rules, the toy field or the outcome of a round
 * (the field mix is the same for every character, see ToyField).
 *
 * Asset ids are "<theme>.<slug>" manifest ids. Anything not listed here (a
 * future character, a test stand-in) counts as common.
 */

export const RARITY_TIERS = ['common', 'rare', 'epic', 'legendary'] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];

/** Base points of a catch, by tier. */
export const TIER_POINTS: Readonly<Record<RarityTier, number>> = Object.freeze({
  common: 100,
  rare: 250,
  epic: 500,
  legendary: 1000,
});

/** Rarity of every shipped character (five themes, the GPU Party line-up included). */
export const RARITY_TABLE: Readonly<Record<string, RarityTier>> = Object.freeze({
  // Sakura Kawaii
  'sakura.bunny': 'common',
  'sakura.capybara': 'common',
  'sakura.sakuracat': 'rare',
  'sakura.tanuki': 'rare',
  'sakura.monster': 'epic',
  'sakura.biribi': 'legendary',
  // Storybook Friends
  'storybook.scarfpuppy': 'common',
  'storybook.cowpony': 'common',
  'storybook.dino': 'rare',
  'storybook.robot': 'rare',
  'storybook.hornmonster': 'epic',
  'storybook.astronaut': 'legendary',
  // Ocean Dream
  'ocean.seal': 'common',
  'ocean.turtle': 'common',
  'ocean.octopus': 'rare',
  'ocean.axolotl': 'rare',
  'ocean.jellyfish': 'epic',
  'ocean.whale': 'legendary',
  // Cosmic Arcade
  'cosmic.spacebunny': 'common',
  'cosmic.alien': 'common',
  'cosmic.starbear': 'rare',
  'cosmic.astrocat': 'rare',
  'cosmic.spacerobot': 'epic',
  'cosmic.planetmonster': 'legendary',
  // GPU Party
  'gpu.fan': 'common',
  'gpu.pixel': 'common',
  'gpu.chip': 'rare',
  'gpu.bot': 'rare',
  'gpu.rack': 'epic',
  'gpu.card': 'epic',
  'gpu.chief': 'legendary',
});

/** Rarity tier of a character; unknown or missing ids are common. */
export function rarityOf(typeId: string | null | undefined): RarityTier {
  if (!typeId) return 'common';
  return Object.prototype.hasOwnProperty.call(RARITY_TABLE, typeId) ? RARITY_TABLE[typeId]! : 'common';
}

/** Base points of a character (before difficulty, bonuses and combo). */
export function basePointsOf(typeId: string | null | undefined): number {
  return TIER_POINTS[rarityOf(typeId)];
}

/** 0 (common) … 3 (legendary). */
export function tierRank(tier: RarityTier): number {
  return RARITY_TIERS.indexOf(tier);
}
