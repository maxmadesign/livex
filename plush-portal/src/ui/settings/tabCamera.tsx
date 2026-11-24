import { useEffect, useRef, useState } from 'react';
import type { Vec3 } from '../../core/types';
import { getValueAt } from '../../settings/spec';
import { useApp, useSettings, useT, useUi } from '../context';
import { Field, Row, Section, useSetter } from './Field';

/* ----------------------------------------------------- Camera & Parallax */

export function CameraTab() {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const profile = useUi((s) => s.profile);
  const status = useUi((s) => s.tracker);
  const enabled = useSettings((s) => s.camera.enabled);
  const deviceId = useSettings((s) => s.camera.deviceId);
  const calibrated = useSettings((s) => s.profiles[profile].view.calibrated);
  const previewRef = useRef<HTMLDivElement>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [test, setTest] = useState<Vec3>([0, 0, 0]);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [calText, setCalText] = useState<string | null>(null);
  const view = `profiles.${profile}.view`;
  const running = !['off', 'idle', 'denied', 'no_device', 'in_use', 'insecure', 'model_error'].includes(status.state);

  useEffect(() => {
    let alive = true;
    void app.tracker.listCameras().then((list) => alive && setCameras(list));
    return () => {
      alive = false;
    };
  }, [app, status.state]);
  // The preview exists only while this tab is visible.
  useEffect(() => {
    app.tracker.attachPreview(previewRef.current);
    return () => {
      app.tracker.attachPreview(null);
      app.tracker.setTestViewpoint(null);
    };
  }, [app]);

  const applyTest = (next: Vec3 | null) => {
    setTesting(next !== null);
    setTest(next ?? [0, 0, 0]);
    app.tracker.setTestViewpoint(next);
  };
  const calibrate = async () => {
    setBusy(true);
    setCalText(t('tracking.cal.running'));
    const result = await app.tracker.calibrate();
    setBusy(false);
    const key = `tracking.calResult.${result.ok ? 'ok' : result.detail}`;
    const text = t(key);
    setCalText(text === key ? result.detail : text);
    app.game.toast(result.ok ? 'toast.calibrated' : 'toast.calibrationFailed');
  };
  const shown = enabled ? status.state : 'off';
  return (
    <>
      <Section title={t('sec.camera.main')} />
      <Field path="camera.enabled" />
      <p className="pp-note">{t('camera.privacy')}</p>
      <Section title={t('sec.camera.status')} />
      <dl className="pp-kv" data-testid="camera-status" data-state={shown}>
        <dt>{t('sec.camera.status')}</dt>
        <dd>
          <b>{t(`tracking.state.${shown}`)}</b> — {t(`tracking.stateHint.${shown}`)}
        </dd>
        <dt>{t('tracking.status.viewSource')}</dt>
        <dd data-testid="view-source">{t(`tracking.source.${status.viewSource}`)}</dd>
        <dt>{t('tracking.status.camera')}</dt>
        <dd>{status.cameraLabel ?? '—'}{status.videoWidth > 0 ? ` · ${status.videoWidth}×${status.videoHeight}` : ''}</dd>
        <dt>{t('tracking.status.backend')}</dt>
        <dd>{status.backend ?? t('tracking.backend.none')}</dd>
        <dt>{t('tracking.status.rate')}</dt>
        <dd>{status.inferenceFps > 0 ? `${status.inferenceFps.toFixed(1)} Hz · ${status.inferenceMs.toFixed(1)} ms` : '—'}</dd>
        <dt>{t('tracking.status.faces')}</dt>
        <dd>{status.facesSeen}</dd>
        <dt>{t('set.view.calibrated')}</dt>
        <dd>{calibrated ? t('tracking.status.calibrated') : t('tracking.status.notCalibrated')}</dd>
        {status.detail ? (
          <>
            <dt>{t('ai.status.detail')}</dt>
            <dd>{status.detail}</dd>
          </>
        ) : null}
      </dl>
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => void app.tracker.start()} disabled={!enabled || running} data-testid="btn-camera-start">
          {t('camera.start')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => app.tracker.stop()} disabled={!running} data-testid="btn-camera-stop">
          {t('camera.stop')}
        </button>
      </div>
      <Row label={t('set.camera.deviceId')}>
        <select className="pp-select" value={deviceId} onChange={(e) => set('camera.deviceId', e.target.value)} data-testid="field-camera.deviceId">
          <option value="">{t('tracking.status.defaultCamera')}</option>
          {cameras.map((c, i) => (
            <option key={c.id || i} value={c.id}>
              {c.label || `${t('set.camera.deviceId')} ${i + 1}`}
            </option>
          ))}
        </select>
      </Row>
      <div className="pp-preview" ref={previewRef} data-testid="camera-preview">
        {running ? null : t('tracking.preview.off')}
      </div>
      <p className="pp-note">{t('camera.preview')}</p>

      <Section title={t('sec.camera.calibrate')} />
      <ol className="pp-steps" style={{ fontSize: '0.9em' }}>
        <li>{t('tracking.cal.step1')}</li>
        <li>{t('tracking.cal.step2')}</li>
        <li>{t('tracking.cal.step3')}</li>
      </ol>
      <Field path={`${view}.refDistance`} />
      <Field path="camera.autoCalibrate" />
      <Field path="camera.calibrationSeconds" />
      <div className="pp-actions">
        <button type="button" className="pp-btn small accent" onClick={() => void calibrate()} disabled={busy || status.state !== 'tracking'} data-testid="btn-calibrate">
          {t('camera.calibrate')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => (app.tracker.recenter(), app.game.toast('toast.recentred'))} disabled={status.state !== 'tracking'} data-testid="btn-recenter">
          {t('camera.recenter')}
        </button>
        <button
          type="button"
          className="pp-btn small soft"
          onClick={() => {
            set(`${view}.calibrated`, false);
            set(`${view}.calDepthK`, 0);
          }}
          data-testid="btn-cal-reset"
        >
          {t('tracking.cal.reset')}
        </button>
      </div>
      {calText ? <p className="pp-note" data-testid="calibration-result">{calText}</p> : null}

      <Section title={t('sec.camera.test')} />
      <p className="pp-note warn">{t('camera.testNote')}</p>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <Row key={axis} label={`${axis.toUpperCase()} ${t('sec.camera.test')}`}>
          <input
            className="pp-range"
            type="range"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={test[i]}
            onChange={(e) => {
              const next: Vec3 = [...test] as Vec3;
              next[i] = Number(e.target.value);
              applyTest(next);
            }}
            data-testid={`test-view-${axis}`}
          />
          <output>{test[i]!.toFixed(2)} m</output>
        </Row>
      ))}
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => applyTest(null)} disabled={!testing} data-testid="btn-test-reset">
          {t('camera.testReset')}
        </button>
      </div>

      <Section title={t('sec.camera.screen')} />
      <p className="pp-note">{t('camera.physNote')}</p>
      <Field path={`${view}.windowMode`} />
      <Field path={`${view}.screenW`} />
      <Field path={`${view}.screenH`} />
      <Field path={`${view}.bottomElevation`} />
      <Field path={`${view}.eye`} />
      <EyeHeightHelper profilePath={view} />
      <Section title={t('sec.camera.mount')} />
      <Field path={`${view}.camPos`} />
      <Field path={`${view}.camPitch`} />
      <Field path={`${view}.camYaw`} />
      <Field path={`${view}.camRoll`} />
      <Field path={`${view}.camRotation`} />
      <Field path={`${view}.hfov`} />
      <Field path={`${view}.mirror`} />
      <Section title={t('sec.camera.mapping')} />
      <Field path={`${view}.mode`} />
      <Field path={`${view}.gainX`} />
      <Field path={`${view}.gainY`} />
      <Field path={`${view}.gainZ`} />
      <Field path={`${view}.maxOffset`} />
      <Field path={`${view}.minDistance`} />
      <Field path={`${view}.calDepthK`} />
      <Field path={`${view}.calNeutral`} />
      <Section title={t('sec.camera.filter')} />
      <Field path="camera.smoothMs" />
      <Field path="camera.filterMinCutoff" />
      <Field path="camera.filterBeta" />
      <Field path="camera.deadzoneMm" />
      <Field path="camera.outlierM" />
      <Field path="camera.lostHoldMs" />
      <Field path="camera.returnMs" />
      <Field path="camera.reacquireMs" />
      <Section title={t('sec.camera.inference')} />
      <Field path="camera.resolution" />
      <Field path="camera.inferenceHz" />
      <Field path="camera.numFaces" />
      <Field path="camera.delegate" />
    </>
  );
}

/** Turns the installation height into a reference eye height for a standing adult or a child. */
function EyeHeightHelper({ profilePath }: { profilePath: string }) {
  const t = useT();
  const set = useSetter();
  const bottom = useSettings((s) => getValueAt(s, `${profilePath}.bottomElevation`) as number);
  const height = useSettings((s) => getValueAt(s, `${profilePath}.screenH`) as number);
  const eye = useSettings((s) => getValueAt(s, `${profilePath}.eye`) as Vec3);
  const centre = bottom + height / 2;
  const apply = (eyeHeight: number) => set(`${profilePath}.eye`, [eye[0], Number((eyeHeight - centre).toFixed(2)), eye[2]]);
  return (
    <Row label={t('camera.eyeHelper')} hint={t('camera.eyeHelper.hint', { centre: centre.toFixed(2) })} stack>
      <div className="pp-seg" data-testid="eye-helper">
        {[1.15, 1.4, 1.6, 1.75].map((h) => (
          <button key={h} type="button" onClick={() => apply(h)} data-value={h}>
            {h.toFixed(2)} m
          </button>
        ))}
      </div>
    </Row>
  );
}
