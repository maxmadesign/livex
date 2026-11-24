import { useEffect, useRef, useState } from 'react';
import { FIXED_DT } from '../../physics/fieldSpec';
import { THEME_IDS, type ThemeId, type Vec3 } from '../../core/types';
import { clearLog, formatLog } from '../../diagnostics/log';
import { getValueAt } from '../../settings/spec';
import { useApp, useLogEntries, useSettings, useT, useUi } from '../context';
import { Field, Row, Section, useSetter } from './Field';

/* ----------------------------------------------------------------- Audio */

export function AudioTab() {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const status = useUi((s) => s.audio);
  const device = useSettings((s) => s.audio.outputDevice);
  const [preview, setPreview] = useState<ThemeId | null>(null);
  const [devices, setDevices] = useState<{ supported: boolean; reason?: string; devices: { id: string; label: string }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void app.audio.listOutputDevices().then((list) => alive && setDevices(list));
    return () => {
      alive = false;
      app.audio.previewTrack(null);
    };
  }, [app]);
  const togglePreview = (id: ThemeId) => {
    void app.audio.unlock();
    const next = preview === id ? null : id;
    setPreview(next);
    app.audio.previewTrack(next);
  };
  return (
    <>
      <p className={`pp-note${status.state === 'failed' ? ' warn' : ''}`} data-testid="audio-status" data-state={status.state}>
        {t(`audio.state.${status.state}`)}
        {status.usingFallbackSynth ? ` · ${t('audio.fallbackSynth')}` : ''}
      </p>
      <Section title={t('sec.audio.volume')} />
      <Field path="audio.muted" />
      <Field path="audio.master" percent />
      <Field path="audio.music" percent />
      <Field path="audio.sfx" percent />
      <Field path="audio.voice" percent />
      <Field path="audio.ducking" percent />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => (void app.audio.unlock(), app.audio.playSfx('win'))} data-testid="btn-test-sfx">
          {t('common.test')} · {t('set.audio.sfx')}
        </button>
      </div>
      <Section title={t('sec.audio.music')} />
      <Field path="audio.track" />
      <Row label={t('audio.preview')} stack>
        <div className="pp-seg" data-testid="track-previews">
          {THEME_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={preview === id} onClick={() => togglePreview(id)} data-value={id}>
              {preview === id ? `■ ${t('audio.previewStop')}` : `▶ ${t(`theme.${id}.name`)}`}
            </button>
          ))}
        </div>
      </Row>
      <p className="pp-note">{t('audio.credits')}</p>
      <Section title={t('sec.audio.output')} />
      {devices && devices.supported && devices.devices.length > 0 ? (
        <Row label={t('set.audio.outputDevice')}>
          <select className="pp-select" value={device} onChange={(e) => set('audio.outputDevice', e.target.value)} data-testid="field-audio.outputDevice">
            <option value="">{t('audio.output.default')}</option>
            {devices.devices.map((d, i) => (
              <option key={d.id} value={d.id}>
                {d.label || `${t('set.audio.outputDevice')} ${i + 1}`}
              </option>
            ))}
          </select>
        </Row>
      ) : (
        <p className="pp-note warn" data-testid="audio-output-unsupported">
          {devices === null ? '…' : devices.supported ? t('audio.output.none') : t('audio.output.unsupported')}
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------- AI Guide */

export function AiTab() {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const status = useUi((s) => s.guideStatus);
  const enabled = useSettings((s) => s.ai.enabled);
  const provider = useSettings((s) => s.ai.provider);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'done'; ok?: boolean; text?: string }>({ state: 'idle' });
  const [voiceTest, setVoiceTest] = useState<{ state: 'idle' | 'running' | 'done'; ok?: boolean; text?: string }>({ state: 'idle' });
  const [promptText, setPromptText] = useState<string | null>(null);
  useEffect(() => {
    void import('../../ai').then((m) => setPromptText(m.DEFAULT_SYSTEM_PROMPT)).catch(() => setPromptText(''));
  }, []);
  const connection = enabled ? status.connection : 'off';
  const runTest = async () => {
    setTest({ state: 'running' });
    const r = await app.guide.testConnection();
    setTest({ state: 'done', ok: r.ok, text: r.ok ? `${t('ai.test.ok', { detail: r.detail })}${r.sample ? ` · ${t('ai.test.sample', { text: r.sample })}` : ''}` : t('ai.test.fail', { detail: r.detail }) });
  };
  const runVoice = async () => {
    void app.audio.unlock();
    setVoiceTest({ state: 'running' });
    const r = await app.guide.previewVoice();
    setVoiceTest({ state: 'done', ok: r.ok, text: r.ok ? t('ai.preview.ok', { voice: r.detail }) : t('ai.preview.fail', { detail: r.detail }) });
  };
  const cloudOff = provider === 'local' ? t('ai.connection.hint.local') : null;
  return (
    <>
      <Section title={t('sec.ai.main')} />
      <Field path="ai.enabled" />
      <Field path="ai.subtitles" />
      <Field path="ai.voice" />
      <Field path="ai.frequency" />
      <Field path="ai.length" />
      <Field path="ai.language" />
      <Section title={t('sec.ai.connection')} />
      <Field path="ai.provider" />
      <dl className="pp-kv" data-testid="ai-status" data-connection={connection}>
        <dt>{t('sec.ai.connection')}</dt>
        <dd>
          <b>{t(`ai.connection.${connection}`)}</b> — {t(`ai.connection.hint.${connection}`)}
        </dd>
        <dt>{t('ai.status.model')}</dt>
        <dd>{status.textModel ?? t('ai.status.none')}</dd>
        <dt>{t('ai.status.speechModel')}</dt>
        <dd>{status.speechModel ?? t('ai.status.none')}</dd>
        <dt>{t('ai.status.voicePath')}</dt>
        <dd>{t(`ai.voice.${status.voice}`)}</dd>
        <dt>{t('ai.status.latency')}</dt>
        <dd>{status.lastLatencyMs === null ? t('ai.status.none') : t('ai.status.latencyValue', { ms: Math.round(status.lastLatencyMs) })}</dd>
        {status.detail ? (
          <>
            <dt>{t('ai.status.detail')}</dt>
            <dd>{status.detail}</dd>
          </>
        ) : null}
      </dl>
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => void runTest()} disabled={test.state === 'running'} data-testid="btn-ai-test">
          {test.state === 'running' ? t('ai.test.running') : t('ai.testConnection')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => void runVoice()} disabled={voiceTest.state === 'running'} data-testid="btn-ai-voice">
          {voiceTest.state === 'running' ? t('ai.preview.running') : t('ai.previewVoice')}
        </button>
      </div>
      {test.state === 'done' ? <p className={`pp-note${test.ok ? '' : ' warn'}`} data-testid="ai-test-result" data-ok={test.ok}>{test.text}</p> : null}
      {voiceTest.state === 'done' ? <p className={`pp-note${voiceTest.ok ? '' : ' warn'}`} data-testid="ai-voice-result">{voiceTest.text}</p> : null}
      <Field path="ai.model" disabledReason={cloudOff} placeholder={status.textModel ?? ''} />
      <Field path="ai.timeoutMs" disabledReason={cloudOff} />
      <Field path="ai.temperature" disabledReason={cloudOff} />
      <Field path="ai.cache" />
      <p className="pp-note">
        <b>{t('ai.config.title')}</b>
        <br />
        {t('ai.config.step1')}
        <br />
        {t('ai.config.step2')}
        <br />
        {t('ai.config.step3')}
      </p>
      <p className="pp-note">{t('ai.keyNote')}</p>
      <p className="pp-note">{t('ai.dataNote')}</p>
      <Section title={t('sec.ai.voice')} />
      <Field path="ai.localVoice" />
      <Field path="ai.speechModel" disabledReason={cloudOff} placeholder={status.speechModel ?? ''} />
      <Field path="ai.voiceName" disabledReason={cloudOff} />
      <Field path="ai.voiceSpeed" />
      <Section title={t('sec.ai.personality')} />
      <Field path="ai.personality" rows={3} />
      <Field path="ai.systemPrompt" rows={7} placeholder={promptText ?? ''} />
      <div className="pp-actions">
        <button
          type="button"
          className="pp-btn small soft"
          onClick={() => {
            if (promptText) set('ai.systemPrompt', promptText);
          }}
          data-testid="btn-ai-copy-prompt"
        >
          {t('ai.copyDefault')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => (set('ai.systemPrompt', ''), set('ai.personality', ''))} data-testid="btn-ai-restore-prompt">
          {t('ai.restorePrompt')}
        </button>
      </div>
    </>
  );
}

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

/* ---------------------------------------------------------------- System */

function ConfirmButton({ label, confirm, onConfirm, testId }: { label: string; confirm: string; onConfirm: () => void; testId: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`pp-btn small ${armed ? '' : 'soft'}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      data-testid={testId}
      data-armed={armed}
    >
      {armed ? confirm : label}
    </button>
  );
}

export function SystemTab() {
  const app = useApp();
  const t = useT();
  const warnings = useUi((s) => s.warnings);
  const log = useLogEntries();
  const fileInput = useRef<HTMLInputElement>(null);
  const exportConfig = () => {
    const blob = new Blob([app.settings.getState().exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plush-portal-config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    app.game.toast('toast.exported');
  };
  const importConfig = async (file: File | undefined) => {
    if (!file) return;
    const result = app.settings.getState().importJson(await file.text());
    if (result.ok) app.game.toast('toast.imported', { changed: result.changed });
    else app.game.toast(`toast.import.${result.message}`);
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => app.game.toast('common.unsupported'));
  };
  return (
    <>
      <Section title={t('sec.system.general')} />
      <Field path="system.language" />
      <Field path="system.attractDemo" />
      <Field path="system.attractIdleSec" />
      <Field path="system.reducedMotion" />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={fullscreen} disabled={!document.fullscreenEnabled} data-testid="btn-fullscreen">
          {t('system.fullscreen')}
        </button>
      </div>
      <Section title={t('sec.system.config')} />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={exportConfig} data-testid="btn-export">
          {t('system.export')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => fileInput.current?.click()} data-testid="btn-import">
          {t('system.import')}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importConfig(e.target.files?.[0]).finally(() => (e.target.value = ''))} data-testid="import-file" />
      </div>
      <p className="pp-note">{t('system.exportNote')}</p>
      <Section title={t('sec.system.reset')} />
      <div className="pp-actions">
        <ConfirmButton label={t('system.resetAll')} confirm={t('system.confirm')} onConfirm={() => app.settings.getState().resetAll()} testId="btn-reset-all" />
        <ConfirmButton
          label={t('system.clearCollection')}
          confirm={t('system.confirm')}
          onConfirm={() => {
            app.collection.getState().clear();
            app.game.toast('toast.collectionCleared');
          }}
          testId="btn-clear-collection"
        />
      </div>
      <p className="pp-note">
        {t('system.resetAll.confirm')}
        <br />
        {t('system.clearCollection.confirm')}
      </p>
      <Section title={t('sec.system.lock')} />
      <Field path="system.lockSettings" />
      <Field path="system.lockPin" />
      <Section title={t('sec.system.diagnostics')} />
      <p className="pp-note" data-testid="version">
        {t('system.version', { version: __APP_VERSION__, hz: Math.round(1 / FIXED_DT) })}
      </p>
      <Field path="system.verboseLog" />
      <Row label={t('system.warnings')} stack>
        <div className="pp-log" data-testid="warnings">
          {warnings.length === 0 ? t('system.noWarnings') : warnings.join('\n')}
        </div>
      </Row>
      <Row label={t('system.log')} stack>
        <div className="pp-log" data-testid="log">
          {log.length === 0 ? '—' : log.slice(-40).map((e) => `${new Date(e.time).toLocaleTimeString()} [${e.level}] ${e.scope}: ${e.message}`).join('\n')}
        </div>
      </Row>
      <div className="pp-actions">
        <button
          type="button"
          className="pp-btn small soft"
          onClick={() => {
            const text = `${formatLog()}\n${warnings.join('\n')}`;
            void navigator.clipboard?.writeText(text).then(() => app.game.toast('toast.copied')).catch(() => undefined);
          }}
          data-testid="btn-copy-log"
        >
          {t('system.copyLog')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => clearLog()}>
          {t('system.clearLog')}
        </button>
      </div>
    </>
  );
}
