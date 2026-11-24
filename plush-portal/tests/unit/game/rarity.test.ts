import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../../src/core/types';
import { RARITY_TABLE, RARITY_TIERS, TIER_POINTS, basePointsOf, rarityOf, tierRank } from '../../../src/game/rarity';
import { loadManifest } from './harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** "<theme>.<slug>" of every character design in tools/plush/designs (read as text: no DSL import). */
function designIds(): string[] {
  const dir = join(root, 'tools', 'plush', 'designs');
  const ids: string[] = [];
  for (const file of readdirSync(dir)) {
    const theme = file.replace(/\.ts$/, '');
    if (!(THEME_IDS as readonly string[]).includes(theme)) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/\bslug:\s*'([a-z0-9]+)'/g)) ids.push(`${theme}.${m[1]}`);
  }
  return ids;
}

describe('rarity table', () => {
  it('uses the four tiers with 100 / 250 / 500 / 1000 base points', () => {
    expect(RARITY_TIERS).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(TIER_POINTS).toEqual({ common: 100, rare: 250, epic: 500, legendary: 1000 });
    expect(RARITY_TIERS.map(tierRank)).toEqual([0, 1, 2, 3]);
  });

  it('covers every character in the manifest and in the designs', () => {
    const manifest = loadManifest().assets.map((a) => a.id);
    const designs = designIds();
    expect(manifest.length).toBeGreaterThanOrEqual(24);
    expect(designs.length).toBeGreaterThanOrEqual(24);
    const missing = [...new Set([...manifest, ...designs])].filter((id) => !(id in RARITY_TABLE));
    expect(missing).toEqual([]);
  });

  it('gives every theme one legendary and at least one epic, rare and common', () => {
    for (const theme of THEME_IDS) {
      const tiers = Object.entries(RARITY_TABLE).filter(([id]) => id.startsWith(`${theme}.`)).map(([, t]) => t);
      expect(tiers.filter((t) => t === 'legendary'), theme).toHaveLength(1);
      for (const tier of ['common', 'rare', 'epic'] as const) expect(tiers.filter((t) => t === tier).length, `${theme} ${tier}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('matches the specified tiers', () => {
    const want: Record<string, string> = {
      'sakura.bunny': 'common', 'sakura.capybara': 'common', 'sakura.sakuracat': 'rare', 'sakura.tanuki': 'rare', 'sakura.monster': 'epic', 'sakura.biribi': 'legendary',
      'storybook.scarfpuppy': 'common', 'storybook.cowpony': 'common', 'storybook.dino': 'rare', 'storybook.robot': 'rare', 'storybook.hornmonster': 'epic', 'storybook.astronaut': 'legendary',
      'ocean.seal': 'common', 'ocean.turtle': 'common', 'ocean.octopus': 'rare', 'ocean.axolotl': 'rare', 'ocean.jellyfish': 'epic', 'ocean.whale': 'legendary',
      'cosmic.spacebunny': 'common', 'cosmic.alien': 'common', 'cosmic.starbear': 'rare', 'cosmic.astrocat': 'rare', 'cosmic.spacerobot': 'epic', 'cosmic.planetmonster': 'legendary',
      'gpu.fan': 'common', 'gpu.pixel': 'common', 'gpu.chip': 'rare', 'gpu.bot': 'rare', 'gpu.rack': 'epic', 'gpu.card': 'epic', 'gpu.chief': 'legendary',
    };
    expect(RARITY_TABLE).toEqual(want);
  });

  it('treats unknown, empty and prototype-looking ids as common', () => {
    for (const id of ['test.bunny', '', null, undefined, 'constructor', '__proto__', 'sakura']) {
      expect(rarityOf(id as string | null | undefined)).toBe('common');
      expect(basePointsOf(id as string | null | undefined)).toBe(100);
    }
    expect(basePointsOf('ocean.whale')).toBe(1000);
    expect(basePointsOf('gpu.card')).toBe(500);
  });
});
