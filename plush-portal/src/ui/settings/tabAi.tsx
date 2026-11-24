import { useEffect, useState } from 'react';
import { useApp, useSettings, useT, useUi } from '../context';
import { Field, Section, useSetter } from './Field';

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
      <Field path="ai.voiceLanguage" />
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
