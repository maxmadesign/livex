import type { StringTable } from '../index';

/** Strings owned by the simulated 9:16 screen of the portrait presets (src/layout/frame.ts). */
export const frameStrings: StringTable = {
  en: {
    'frame.toggle': 'Simulate 9:16 screen',
    'frame.hint': 'In a window of another shape, the game is shown in a centred 9:16 box, laid out like the real screen.',
    'frame.readout': 'Simulated screen: {w} × {h} px in a {ww} × {wh} px window. Window Perspective treats it as the whole {pw} × {ph} m screen of this preset (the Game window option does not apply).',
    'frame.fills': 'This window already has the 9:16 shape: the game fills it and treats it as the whole {pw} × {ph} m screen of this preset.',
  },
  zh: {
    'frame.toggle': '模拟 9:16 竖屏',
    'frame.hint': '窗口比例不同时，游戏显示在居中的 9:16 区域内，布局与真实屏幕一致。',
    'frame.readout': '模拟屏幕：{w} × {h} px，位于 {ww} × {wh} px 的窗口中。窗口透视把它当作本预设 {pw} × {ph} 米的整块屏幕（“游戏窗口”选项此时不起作用）。',
    'frame.fills': '当前窗口本身就是 9:16：游戏占满窗口，并把它当作本预设 {pw} × {ph} 米的整块屏幕。',
  },
  ja: {
    'frame.toggle': '9:16 縦画面をシミュレート',
    'frame.hint': 'ウィンドウの縦横比が異なるとき、中央の 9:16 の枠に実際の画面と同じレイアウトで表示します。',
    'frame.readout': 'シミュレート画面：{ww} × {wh} px のウィンドウ内に {w} × {h} px。ウィンドウ遠近はこれをこのプリセットの {pw} × {ph} m の画面全体として扱います（「ゲームウィンドウ」設定は使われません）。',
    'frame.fills': 'このウィンドウはすでに 9:16 です。ゲームはウィンドウ全体に表示され、このプリセットの {pw} × {ph} m の画面全体として扱われます。',
  },
};
