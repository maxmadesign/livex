import { DISPLAY_PROFILE_IDS, type DisplayProfileId } from '../../core/types';
import { DESIGN } from '../../layout/solve';
import { useApp, useT, useUi } from '../context';
import { useHudLayout } from '../useHudLayout';
import { Field, Section } from './Field';

/* ---------------------------------------------------------------- Layout */

export function LayoutTab() {
  const app = useApp();
  const t = useT();
  const profile = useUi((s) => s.profile);
  const layout = useHudLayout();
  const base = `profiles.${profile}.layout`;
  const design = DESIGN[profile];
  const mapH = 150 * layout.unit * (layout.vh / layout.vw);
  return (
    <>
      <Section title={t('sec.layout.preset')} />
      <div className="pp-cards">
        {DISPLAY_PROFILE_IDS.map((id: DisplayProfileId) => (
          <button key={id} type="button" className="pp-card" data-selected={id === profile} onClick={() => app.game.chooseProfile(id)} data-testid={`preset-${id}`}>
            <strong>{t(`device.${id}.name`)}</strong>
            <span>{t(`device.${id}.desc`)}</span>
          </button>
        ))}
      </div>
      <p className="pp-note">{t('layout.independent')}</p>
      <div style={{ display: 'flex', gap: 16 * layout.unit, alignItems: 'flex-start', margin: `${12 * layout.unit}px 0` }}>
        <div className="pp-layout-map" style={{ height: Math.min(mapH, 320 * layout.unit) }} aria-hidden="true">
          <i className="zone" style={{ top: `${(layout.safeTop / layout.vh) * 100}%`, height: `${((layout.safeBottom - layout.safeTop) / layout.vh) * 100}%` }} />
          <i
            className="pane"
            style={{
              top: `${(layout.panel.y / layout.vh) * 100}%`,
              height: `${(layout.panel.h / layout.vh) * 100}%`,
              left: `${(layout.panel.x / layout.vw) * 100}%`,
              right: `${(1 - (layout.panel.x + layout.panel.w) / layout.vw) * 100}%`,
            }}
          />
          <i className="floor" style={{ top: `${layout.floorY * 100}%` }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="pp-note" data-testid="layout-readout" style={{ marginTop: 0 }}>
            {t('layout.viewport', {
              vw: Math.round(layout.vw),
              vh: Math.round(layout.vh),
              dpr: (window.devicePixelRatio || 1).toFixed(2),
              dw: design.w,
              dh: design.h,
              unit: layout.unit.toFixed(3),
            })}
          </p>
          {layout.adjusted ? <p className="pp-note warn">{t('layout.adjusted')}</p> : null}
          <div className="pp-actions">
            <button type="button" className="pp-btn small soft" onClick={() => app.settings.getState().resetProfile(profile, 'layout')} data-testid="btn-reset-preset">
              {t('layout.resetPreset')}
            </button>
          </div>
        </div>
      </div>
      <Section title={t('sec.layout.zone')} />
      <Field path={`${base}.autoFit`} />
      <Field path={`${base}.safeTop`} percent />
      <Field path={`${base}.safeBottom`} percent />
      <Field path={`${base}.anchorY`} percent />
      <Field path={`${base}.panelWidth`} percent />
      <Field path={`${base}.handedness`} />
      <Field path={`${base}.showGuides`} />
      <Section title={t('sec.layout.size')} />
      <Field path={`${base}.uiScale`} percent />
      <Field path={`${base}.fontScale`} percent />
      <Field path={`${base}.touchSize`} />
      <Field path={`${base}.marginX`} percent />
      <Field path={`${base}.marginY`} percent />
      <Field path={`${base}.hudDensity`} />
      <Section title={t('sec.layout.scene')} />
      <Field path={`${base}.floorY`} percent />
    </>
  );
}
