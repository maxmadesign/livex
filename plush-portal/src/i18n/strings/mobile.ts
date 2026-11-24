import type { StringTable } from '../index';

/** Strings owned by the phone layout. */
export const mobileStrings: StringTable = {
  en: {
    'mobile.rotate': 'Turn your phone sideways for the best view',
    'mobile.rotate.dismiss': 'Hide this hint',
    'mobile.layout.phone':
      'Phone preset: held sideways, the pad and the big button sit in the display bays left and right of the machine; upright, they share one panel below it. Screen cut-outs are kept clear (top {top}, right {right}, bottom {bottom}, left {left} px).',
    'mobile.layout.touch': 'Main buttons {main} px, smallest touch target {min} px.',
    'mobile.layout.estimate': 'Window Perspective assumes a screen of about {w} × {h} mm, estimated from this phone’s CSS pixels. Enter the real size under Camera & Parallax for an exact result.',
  },
  zh: {
    'mobile.rotate': '把手机横过来，视野更好',
    'mobile.rotate.dismiss': '隐藏提示',
    'mobile.layout.phone': '手机预设：横握时，方向键和大按钮位于机台左右两侧的展示区；竖握时，它们合并为机台下方的一块面板。屏幕的刘海与圆角区域会自动避开（上 {top}、右 {right}、下 {bottom}、左 {left} px）。',
    'mobile.layout.touch': '主要按钮 {main} px，最小触控目标 {min} px。',
    'mobile.layout.estimate': '窗口透视按约 {w} × {h} 毫米的屏幕计算（根据本机的 CSS 像素估算）。如需精确效果，请在“摄像头与视差”中填写屏幕的实际尺寸。',
  },
  ja: {
    'mobile.rotate': 'スマホを横向きにすると見やすくなります',
    'mobile.rotate.dismiss': 'ヒントを閉じる',
    'mobile.layout.phone':
      'スマートフォン設定：横向きでは方向パッドと大きなボタンが筐体の左右の展示スペースに、縦向きでは筐体の下の一枚のパネルにまとまります。画面の切り欠きは避けて配置します（上 {top}・右 {right}・下 {bottom}・左 {left} px）。',
    'mobile.layout.touch': 'メインボタン {main} px、最小タッチ領域 {min} px。',
    'mobile.layout.estimate': 'ウィンドウ遠近は約 {w} × {h} mm の画面として計算しています（この端末の CSS ピクセルからの推定）。正確にするには「カメラと視差」で実寸を入力してください。',
  },
};
