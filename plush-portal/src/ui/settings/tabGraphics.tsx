import { applyGraphicsPreset } from '../../app/presets';
import { useApp, useSettings, useT, useUi } from '../context';
import { Field, Row, Section } from './Field';

/* -------------------------------------------------------------- Graphics */

export function GraphicsTab() {
  const app = useApp();
  const t = useT();
  const preset = useSettings((s) => s.graphics.preset);
  const eff = useUi((s) => s.effective);
  const reductions = useUi((s) => s.autoReductions);
  const set = app.settings.getState().set;
  return (
    <>
      <Section title={t('sec.graphics.preset')} />
      <Row label={t('set.graphics.preset')}>
        <div className="pp-seg" data-testid="field-graphics.preset">
          {(['safe', 'medium', 'high', 'ultra'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => applyGraphicsPreset(set, p)} data-value={p}>
              {t(`set.graphics.preset.o.${p}`)}
            </button>
          ))}
          <button type="button" aria-pressed={preset === 'custom'} disabled data-value="custom">
            {t('set.graphics.preset.o.custom')}
          </button>
        </div>
      </Row>
      <p className="pp-note" data-testid="graphics-effective">
        {t('graphics.effective', { preset: t(`set.graphics.preset.o.${preset}`), w: eff.width, h: eff.height, mp: eff.megapixels.toFixed(2), ratio: eff.pixelRatio.toFixed(2) })}
        <br />
        {reductions.length > 0 ? t('graphics.reductions', { list: reductions.join(', ') }) : t('graphics.noReductions')}
      </p>
      <Field path="graphics.autoOptimize" />
      <Field path="graphics.targetFps" />
      <Section title={t('sec.graphics.resolution')} />
      <Field path="graphics.renderScale" percent />
      <Field path="graphics.maxPixels" />
      <Field path="graphics.aa" />
      <Section title={t('sec.graphics.detail')} />
      <Field path="graphics.lod" />
      <Field path="graphics.textures" />
      <Field path="graphics.shadows" />
      <Field path="graphics.ao" />
      <Field path="graphics.glass" />
      <Field path="graphics.reflections" />
      <Field path="graphics.fur" />
      <Field path="graphics.deform" />
      <Field path="graphics.particles" />
      <Section title={t('sec.graphics.fx')} />
      <Field path="graphics.fxIntensity" percent />
      <Field path="graphics.lightShow" />
      <Section title={t('sec.graphics.post')} />
      <Field path="graphics.bloom" percent />
      <Field path="graphics.exposure" />
      <Field path="graphics.toneMapping" />
      <Field path="graphics.dof" />
      <Field path="graphics.motionBlur" />
      <Field path="graphics.perfPanel" />
      <p className="pp-note">{t('graphics.budgetNote')}</p>
      <p className="pp-note">{t('graphics.physicsNote')}</p>
    </>
  );
}
