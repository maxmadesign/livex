import type { StringTable } from '../index';

/** Strings owned by the effects system (rarity tiers, combo banners). */
export const fxStrings: StringTable = {
  en: {
    'fx.tier.common': 'Common',
    'fx.tier.rare': 'Rare',
    'fx.tier.epic': 'Epic',
    'fx.tier.legendary': 'Legendary',
    'fx.combo': 'Combo ×{count}',
  },
  zh: {
    'fx.tier.common': '普通',
    'fx.tier.rare': '稀有',
    'fx.tier.epic': '史诗',
    'fx.tier.legendary': '传说',
    'fx.combo': '连击 ×{count}',
  },
  ja: {
    'fx.tier.common': 'コモン',
    'fx.tier.rare': 'レア',
    'fx.tier.epic': 'エピック',
    'fx.tier.legendary': 'レジェンド',
    'fx.combo': 'コンボ ×{count}',
  },
};
