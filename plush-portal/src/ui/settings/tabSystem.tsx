import { useEffect, useRef, useState } from 'react';
import { clearLog, formatLog } from '../../diagnostics/log';
import { FIXED_DT } from '../../physics/fieldSpec';
import { useApp, useLogEntries, useT, useUi } from '../context';
import { Field, Row, Section } from './Field';

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
      <Field path="system.idleSeconds" />
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
