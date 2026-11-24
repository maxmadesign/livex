import { useId } from 'react';
import { DISPLAY_PROFILE_IDS, type DisplayProfileId } from '../../core/types';
import { frameSupported, type FramedLayout } from '../../layout/frame';
import { DESIGN, type HudLayout } from '../../layout/solve';
import { estimateHandheldScreen, isNominalPhoneScreen, orientScreen } from '../../perspective/windowGeometry';
import { useApp, useSettings, useT, useUi } from '../context';
import { useHudLayout } from '../useHudLayout';
import { Field, Section, useSetter } from './Field';

/* ---------------------------------------------------------------- Layout */

/** Phone preset: what the solver kept clear, how big the buttons came out, the screen-size estimate. */
function PhoneNotes({ layout }: { layout: HudLayout }) {
  const t = useT();
  const view = useSettings((s) => s.profiles.mobile.view);
  const r = (n: number) => Math.round(n);
  let estimate: string | null = null;
  if (view.windowMode === 'window' && isNominalPhoneScreen(view)) {
    const s = orientScreen(layout.vw, layout.vh, window.screen?.width ?? layout.vw, window.screen?.height ?? layout.vh);
    const e = estimateHandheldScreen(s.screenW, s.screenH, window.devicePixelRatio || 1);
    estimate = t('mobile.layout.estimate', { w: r(e.widthM * 1000), h: r(e.heightM * 1000) });
  }
  return (
    <>
      <p className="pp-note" data-testid="layout-phone">
        {t('mobile.layout.phone', { top: r(layout.insets.top), right: r(layout.insets.right), bottom: r(layout.insets.bottom), left: r(layout.insets.left) })}{' '}
        {t('mobile.layout.touch', { main: r(layout.touch), min: r(Math.min(layout.touchMin, layout.controls?.menuButton ?? layout.touchMin)) })}
      </p>
      {estimate ? <p className="pp-note">{estimate}</p> : null}
    </>
  );
}

/**
 * Portrait presets: "Simulate 9:16 screen" (stored as `profiles.<id>.layout.frame`), shown as a switch,
 * and what the game currently uses as the screen. Changing it re-lays-out at once (it is a live value).
 */
function FrameToggle({ profile, layout }: { profile: DisplayProfileId; layout: FramedLayout }) {
  const t = useT();
  const id = useId();
  const set = useSetter();
  const path = `profiles.${profile}.layout.frame`;
  const on = useSettings((s) => s.profiles[profile].layout.frame) !== 'fill';
  const view = useSettings((s) => s.profiles[profile].view);
  const frame = layout.frame;
  // The simulated box is the preset's whole physical screen: width as entered, height from the 9:16 shape.
  const pw = Math.min(view.screenW, view.screenH);
  const ph = pw * (frame.h / Math.max(1, frame.w));
  const m = (v: number) => v.toFixed(3);
  let note: string | null = null;
  if (frame.simulated && frame.letterboxed) {
    note = t('frame.readout', { w: Math.round(frame.w), h: Math.round(frame.h), ww: Math.round(frame.windowW), wh: Math.round(frame.windowH), pw: m(pw), ph: m(ph) });
  } else if (frame.simulated) {
    note = t('frame.fills', { pw: m(pw), ph: m(ph) });
  }
  return (
    <>
      <div className="pp-field" data-path={path}>
        <label htmlFor={id}>{t('frame.toggle')}</label>
        <div className="pp-control" style={{ justifyContent: 'flex-end' }}>
          <button
            id={id}
            type="button"
            role="switch"
            className="pp-toggle"
            aria-checked={on}
            onClick={() => set(path, on ? 'fill' : 'simulate916')}
            data-testid={`field-${path}`}
          />
        </div>
        <div className="hint">{t('frame.hint')}</div>
      </div>
      {note ? (
        <p className="pp-note" data-testid="frame-readout">
          {note}
        </p>
      ) : null}
    </>
  );
}

export function LayoutTab() {
  const app = useApp();
  const t = useT();
  const profile = useUi((s) => s.profile);
  const layout = useHudLayout();
  const base = `profiles.${profile}.layout`;
  // The phone's design size turns with the phone.
  const design = profile === 'mobile' && layout.orientation === 'portrait' ? { w: DESIGN.mobile.h, h: DESIGN.mobile.w } : DESIGN[profile];
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
      {frameSupported(profile) ? <FrameToggle profile={profile} layout={layout} /> : null}
      {profile === 'mobile' ? <PhoneNotes layout={layout} /> : null}
      <div style={{ display: 'flex', gap: 16 * layout.unit, alignItems: 'flex-start', margin: `${12 * layout.unit}px 0` }}>
        <div className="pp-layout-map" style={{ height: Math.min(mapH, 320 * layout.unit) }} aria-hidden="true">
          <i className="zone" style={{ top: `${(layout.safeTop / layout.vh) * 100}%`, height: `${((layout.safeBottom - layout.safeTop) / layout.vh) * 100}%` }} />
          {(layout.controls && layout.panelStyle === 'split' ? [layout.controls.dpad, layout.controls.action, layout.controls.menu] : [layout.panel]).map((r, i) => (
            <i
              key={i}
              className="pane"
              style={{
                top: `${(r.y / layout.vh) * 100}%`,
                height: `${(r.h / layout.vh) * 100}%`,
                left: `${(r.x / layout.vw) * 100}%`,
                right: `${(1 - (r.x + r.w) / layout.vw) * 100}%`,
              }}
            />
          ))}
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
