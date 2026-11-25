import { ACTIVE_BRAND, type BrandId } from '../../brand';
import type { StringTable } from '../index';

/** Strings of the GPU theme that are the same whichever brand kit dresses it. */
const SHARED: StringTable = {
  en: {
    'gpu.track': 'Overclock Party',
    'gpu.char.chief': 'Keynote Chief',
    'gpu.char.card': 'Twin-Fan',
    'gpu.char.chip': 'Chippy',
    'gpu.char.fan': 'Breezy',
    'gpu.char.rack': 'Rack Buddy',
    'gpu.char.bot': 'Tensor Bot',
    'gpu.char.pixel': 'Pixel',
  },
  zh: {
    'gpu.track': '超频派对',
    'gpu.char.chief': '主讲人',
    'gpu.char.card': '双风扇',
    'gpu.char.chip': '小芯片',
    'gpu.char.fan': '小风扇',
    'gpu.char.rack': '机柜宝宝',
    'gpu.char.bot': '张量机器人',
    'gpu.char.pixel': '像素方块',
  },
  ja: {
    'gpu.track': 'オーバークロック・パーティー',
    'gpu.char.chief': 'キーノートチーフ',
    'gpu.char.card': 'ツインファン',
    'gpu.char.chip': 'チッピー',
    'gpu.char.fan': 'ブリージー',
    'gpu.char.rack': 'ラックバディ',
    'gpu.char.bot': 'テンソルボット',
    'gpu.char.pixel': 'ピクセル',
  },
};

/**
 * Copy that depends on the brand kit of this build (src/brand). The GTC kit describes the booth
 * machine; its event marks are the owner's responsibility (docs), so no note about them is shown.
 * The neutral kit keeps the original GPU Party copy and its "all characters are original" note.
 */
const GTC_STRINGS: StringTable = {
  en: {
    'gpu.welcome': 'Welcome to GTC!',
    'gpu.tagline': 'A GTC booth claw machine full of GPU plush',
    'gpu.description':
      'The claw machine at the GTC booth: grab a soft GPU plush — a twin-fan graphics card, a smiling chip, a cooling fan, a server rack, a robot, a pixel cube or the Keynote Chief himself — in black, white and green.',
  },
  zh: {
    'gpu.welcome': '欢迎来到 GTC！',
    'gpu.tagline': 'GTC 展台的抓娃娃机，满满的 GPU 毛绒玩偶',
    'gpu.description': 'GTC 展台的抓娃娃机：抓一个软软的 GPU 毛绒玩偶——双风扇显卡、笑脸芯片、散热风扇、服务器机柜、机器人、像素方块，还有主讲人本人——黑、白、绿三色。',
  },
  ja: {
    'gpu.welcome': 'GTCへようこそ！',
    'gpu.tagline': 'GPUぬいぐるみがいっぱいのGTCブースのクレーンゲーム',
    'gpu.description':
      'GTCブースのクレーンゲームです。ツインファンのグラボ、にっこりチップ、冷却ファン、サーバーラック、ロボット、ピクセルキューブ、そしてキーノートチーフ本人まで、黒・白・グリーンのやわらかいGPUぬいぐるみをつかまえよう。',
  },
};

const NEUTRAL_STRINGS: StringTable = {
  en: {
    'gpu.welcome': 'Welcome to the GPU Party!',
    'gpu.tagline': 'Cuddly chips, fans and graphics cards in vivid green',
    'gpu.description':
      'A fan-shop claw machine from the world of graphics and AI computing: a twin-fan graphics card, a smiling chip, a cooling fan, a server rack, a robot, a pixel cube and the Keynote Chief himself — all soft plush in black and green.',
    'gpu.originals': 'All GPU Party characters are original designs; no real product, brand logo or person is depicted.',
  },
  zh: {
    'gpu.welcome': '欢迎来到显卡派对！',
    'gpu.tagline': '鲜绿色的毛绒芯片、风扇和显卡',
    'gpu.description': '来自图形与 AI 计算世界的周边抓娃娃机：双风扇显卡、笑脸芯片、散热风扇、服务器机柜、机器人、像素方块，还有主讲人本人——全都是黑色与绿色的软软毛绒玩偶。',
    'gpu.originals': '显卡派对的所有角色均为原创设计，不涉及任何真实产品、品牌标志或真实人物。',
  },
  ja: {
    'gpu.welcome': 'GPUパーティーへようこそ！',
    'gpu.tagline': 'あざやかなグリーンのふわふわチップ、ファン、グラボ',
    'gpu.description':
      'グラフィックスとAIコンピューティングの世界から来たグッズのクレーンゲーム。ツインファンのグラボ、にっこりチップ、冷却ファン、サーバーラック、ロボット、ピクセルキューブ、そしてキーノートチーフ本人まで、黒とグリーンのやわらかいぬいぐるみばかりです。',
    'gpu.originals': 'GPUパーティーのキャラクターはすべてオリジナルデザインです。実在の製品、ブランドロゴ、人物は描かれていません。',
  },
};

export const GPU_KIT_STRINGS: Readonly<Record<BrandId, StringTable>> = { gtc: GTC_STRINGS, neutral: NEUTRAL_STRINGS };

/**
 * The kit copy this build uses. The build flag is compared first and literally: Vite replaces
 * `import.meta.env.VITE_BRAND` with its value, so a `VITE_BRAND=neutral` build decides this while
 * bundling and drops the GTC copy entirely (a public demo copy carries no event name). The
 * ACTIVE_BRAND test keeps any other spelling of the flag (and the tests) correct at run time.
 */
const KIT_STRINGS: StringTable = import.meta.env.VITE_BRAND === 'neutral' || ACTIVE_BRAND.id === 'neutral' ? NEUTRAL_STRINGS : GTC_STRINGS;

/**
 * Strings owned by the GPU theme, for the brand kit of this build. The theme's name and short
 * tagline used by the theme picker live with the other themes in ui.* (`theme.gpu.name` /
 * `theme.gpu.tagline`); character names also travel with the plush manifest (tools/plush/designs/gpu.ts).
 */
export const gpuStrings: StringTable = {
  en: { ...SHARED.en, ...KIT_STRINGS.en },
  zh: { ...SHARED.zh, ...KIT_STRINGS.zh },
  ja: { ...SHARED.ja, ...KIT_STRINGS.ja },
};
