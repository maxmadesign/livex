import type { StringTable } from '../index';

/** Strings owned by the effects system (rarity tiers, combo and win banners, diagnostics). */
export const fxStrings: StringTable = {
  en: {
    'fx.tier.common': 'Common',
    'fx.tier.rare': 'Rare',
    'fx.tier.epic': 'Epic',
    'fx.tier.legendary': 'Legendary',
    'fx.combo': 'Combo ×{count}',
    'fx.bigWin': 'BIG WIN!',
    'fx.jackpot': 'JACKPOT!',
    'fx.stats': 'Effects: {live} particles · {calls} draw calls',
  },
  zh: {
    'fx.tier.common': '普通',
    'fx.tier.rare': '稀有',
    'fx.tier.epic': '史诗',
    'fx.tier.legendary': '传说',
    'fx.combo': '连击 ×{count}',
    'fx.bigWin': '大胜利！',
    'fx.jackpot': '超级大奖！',
    'fx.stats': '特效：{live} 个粒子 · {calls} 次绘制调用',
  },
  ja: {
    'fx.tier.common': 'コモン',
    'fx.tier.rare': 'レア',
    'fx.tier.epic': 'エピック',
    'fx.tier.legendary': 'レジェンド',
    'fx.combo': 'コンボ ×{count}',
    'fx.bigWin': 'ビッグウィン！',
    'fx.jackpot': 'ジャックポット！',
    'fx.stats': 'エフェクト：パーティクル {live} 個・描画 {calls} 回',
  },
};
