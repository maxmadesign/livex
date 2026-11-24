import type { StringTable } from '../index';

/**
 * Strings owned by the graphics workstream: readable labels of the automatic optimiser's
 * reduction steps (keys from src/app/AdaptiveQuality.ts `reductionLabelKey`), the list
 * separator used to join them, and the label of the pixel-ratio cap setting.
 */
export const graphicsStrings: StringTable = {
  en: {
    'graphics.step.particles': 'fewer decor particles',
    'graphics.step.bloom': 'bloom off',
    'graphics.step.ao': 'ambient occlusion off',
    'graphics.step.reflections': 'studio reflections',
    'graphics.step.glass': 'reflective glass',
    'graphics.step.scale90': '3D resolution 90 %',
    'graphics.step.scale80': '3D resolution 80 %',
    'graphics.step.scale70': '3D resolution 70 %',
    'graphics.step.shadows': 'shadows one level lower',
    'graphics.step.scale60': '3D resolution 60 %',
    'graphics.step.scale50': '3D resolution 50 %',
    'graphics.listSep': ', ',
    'set.graphics.maxDpr': 'Pixel density cap',
    'set.graphics.maxDpr.hint': 'Highest device pixel ratio the 3D view renders at. Phones report 3 or more; Safe caps it at 1.25 to save power.',
  },
  zh: {
    'graphics.step.particles': '减少装饰粒子',
    'graphics.step.bloom': '关闭泛光',
    'graphics.step.ao': '关闭环境光遮蔽',
    'graphics.step.reflections': '改用影棚反射',
    'graphics.step.glass': '改用反射玻璃',
    'graphics.step.scale90': '3D 分辨率 90%',
    'graphics.step.scale80': '3D 分辨率 80%',
    'graphics.step.scale70': '3D 分辨率 70%',
    'graphics.step.shadows': '阴影降低一级',
    'graphics.step.scale60': '3D 分辨率 60%',
    'graphics.step.scale50': '3D 分辨率 50%',
    'graphics.listSep': '、',
    'set.graphics.maxDpr': '像素密度上限',
    'set.graphics.maxDpr.hint': '3D 画面使用的最高设备像素比。手机通常为 3 或更高；“性能保底”档限制为 1.25 以节省电量。',
  },
  ja: {
    'graphics.step.particles': '装飾パーティクルを削減',
    'graphics.step.bloom': 'ブルームをオフ',
    'graphics.step.ao': 'アンビエントオクルージョンをオフ',
    'graphics.step.reflections': 'スタジオ反射に切替',
    'graphics.step.glass': '反射ガラスに切替',
    'graphics.step.scale90': '3D解像度 90%',
    'graphics.step.scale80': '3D解像度 80%',
    'graphics.step.scale70': '3D解像度 70%',
    'graphics.step.shadows': '影を1段階下げる',
    'graphics.step.scale60': '3D解像度 60%',
    'graphics.step.scale50': '3D解像度 50%',
    'graphics.listSep': '、',
    'set.graphics.maxDpr': 'ピクセル密度の上限',
    'set.graphics.maxDpr.hint': '3D映像に使う最大のデバイスピクセル比です。スマートフォンは3以上になることが多く、「セーフ」では省電力のため1.25に制限します。',
  },
};
