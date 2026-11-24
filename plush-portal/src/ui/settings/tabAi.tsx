import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchKeyStatus, restoreDefaultKey, saveKey, testKey, type KeyCallResult } from '../../ai/keyClient';
import type { CredentialStatus, KeyCheckResult } from '../../ai/protocol';
import { useApp, useSettings, useT, useUi } from '../context';
import { Field, Section, useSetter } from './Field';

type Translate = ReturnType<typeof useT>;

/** The guide created by src/ai offers a re-probe after a key change; other guides (null guide) do not. */
function refreshGuide(guide: unknown): void {
  const g = guide as { refreshServerStatus?: () => Promise<unknown> };
  if (typeof g?.refreshServerStatus === 'function') void g.refreshServerStatus();
}

function checkText(t: Translate, check: { result: KeyCheckResult; latencyMs: number } | null): string {
  if (!check || check.result === 'skipped') return '';
  return t(`ai.key.check.${check.result}`, { ms: Math.round(check.latencyMs) });
}

/**
 * Settings → AI Guide → OpenAI API key. Shows where the server's key comes
 * from and its masked fingerprint; a new key is typed into a password field,
 * sent once to the server (which stores it server-side) and the field is
 * cleared. Nothing about the key is kept in the browser.
 */
function KeyBlock() {
  const app = useApp();
  const t = useT();
  const locked = useSettings((s) => s.system.lockSettings);
  const [credential, setCredential] = useState<CredentialStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [adminToken, setAdminToken] = useState('');
  // Read through a ref: typing the token must not re-query the server on every keystroke
  // (only "Use token" / Enter does), so `reload` stays stable.
  const adminTokenRef = useRef('');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'restore'>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const options = useCallback(() => {
    const token = adminTokenRef.current.trim();
    return token ? { adminToken: token } : {};
  }, []);
  const reload = useCallback(async () => {
    const r = await fetchKeyStatus(options());
    if (!mounted.current) return;
    setCredential(r.credential);
    setLoaded(true);
  }, [options]);
  useEffect(() => {
    if (!locked) void reload();
  }, [locked, reload]);

  if (locked) {
    return (
      <>
        <Section title={t('ai.key.title')} />
        <p className="pp-note" data-testid="ai-key-locked">{t('ai.key.locked')}</p>
      </>
    );
  }

  const failure = (r: KeyCallResult): string => t('ai.key.error', { detail: r.message ?? r.code ?? 'network' });
  const run = async (kind: 'save' | 'test' | 'restore') => {
    setBusy(kind);
    setResult(null);
    let r: KeyCallResult;
    if (kind === 'save') {
      const key = draft;
      // The key leaves the field as soon as it is on its way: it is sent once and never shown again.
      setDraft('');
      r = await saveKey(key, options());
    } else if (kind === 'test') {
      r = await testKey(draft || null, options());
    } else {
      r = await restoreDefaultKey(options());
    }
    if (!mounted.current) return;
    setBusy(null);
    if (r.credential) setCredential(r.credential);
    const fingerprint = r.credential?.fingerprint ?? '…';
    if (kind === 'save') {
      if (r.ok) {
        const result = r.check?.result ?? 'skipped';
        const message = result === 'skipped' ? 'ai.key.savedNoCheck' : result === 'unreachable' ? 'ai.key.savedUnchecked' : 'ai.key.saved';
        const extra = message === 'ai.key.saved' ? checkText(t, r.check) : '';
        setResult({ ok: true, text: `${t(message, { fingerprint })}${extra ? ` ${extra}` : ''}` });
        refreshGuide(app.guide);
      } else {
        setResult({ ok: false, text: r.code === 'key_rejected' ? t('ai.key.check.rejected') : failure(r) });
      }
    } else if (kind === 'test') {
      if (r.code === 'no_key') setResult({ ok: false, text: t('ai.key.check.noKey') });
      else if (r.check) setResult({ ok: r.ok, text: checkText(t, r.check) });
      else setResult({ ok: false, text: failure(r) });
    } else if (r.ok) {
      setResult({ ok: true, text: r.credential?.source === 'none' ? t('ai.key.restoredNone') : t('ai.key.restored', { fingerprint }) });
      refreshGuide(app.guide);
    } else {
      setResult({ ok: false, text: failure(r) });
    }
  };

  const management = credential?.management ?? 'off';
  const canManage = credential?.canManage === true;
  const source = credential?.source ?? null;
  return (
    <>
      <Section title={t('ai.key.title')} />
      {loaded && !credential ? (
        <p className="pp-note warn" data-testid="ai-key-unavailable">{t('ai.key.unavailable')}</p>
      ) : (
        <dl className="pp-kv" data-testid="ai-key-status" data-source={source ?? ''}>
          <dt>{t('ai.key.source')}</dt>
          <dd>{source ? t(`ai.key.source.${source}`) : t('ai.status.none')}</dd>
          <dt>{t('ai.key.fingerprint')}</dt>
          <dd data-testid="ai-key-fingerprint">{credential?.fingerprint ?? t('ai.status.none')}</dd>
        </dl>
      )}
      {credential && management === 'off' ? <p className="pp-note">{t('ai.key.off')}</p> : null}
      {credential && management !== 'off' && !canManage ? (
        <>
          <p className="pp-note" data-testid="ai-key-not-allowed">{t(management === 'token' ? 'ai.key.tokenOnly' : 'ai.key.notAllowed')}</p>
          <div className="pp-actions">
            <input
              className="pp-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={adminToken}
              placeholder={t('ai.key.adminToken')}
              aria-label={t('ai.key.adminToken')}
              onChange={(e) => {
                adminTokenRef.current = e.target.value;
                setAdminToken(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void reload();
              }}
              data-testid="ai-key-admin-token"
            />
            <button type="button" className="pp-btn small soft" onClick={() => void reload()} data-testid="btn-ai-key-unlock">
              {t('ai.key.useToken')}
            </button>
          </div>
        </>
      ) : null}
      {credential && canManage ? (
        <>
          <div className="pp-actions">
            <input
              className="pp-input"
              type="password"
              name="plush-openai-key"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft}
              maxLength={512}
              placeholder={t('ai.key.placeholder')}
              aria-label={t('ai.key.input')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !busy) void run('save');
              }}
              data-testid="ai-key-input"
            />
          </div>
          <div className="pp-actions">
            <button type="button" className="pp-btn small accent" disabled={!draft.trim() || busy !== null} onClick={() => void run('save')} data-testid="btn-ai-key-save">
              {busy === 'save' ? t('ai.key.busy') : t('ai.key.save')}
            </button>
            <button type="button" className="pp-btn small soft" disabled={busy !== null || (!draft.trim() && source === 'none')} onClick={() => void run('test')} data-testid="btn-ai-key-test">
              {busy === 'test' ? t('ai.key.busy') : t('ai.key.test')}
            </button>
            <button type="button" className="pp-btn small soft" disabled={busy !== null || source !== 'settings'} onClick={() => void run('restore')} data-testid="btn-ai-key-restore">
              {busy === 'restore' ? t('ai.key.busy') : t('ai.key.restore')}
            </button>
          </div>
        </>
      ) : null}
      {result ? (
        <p className={`pp-note${result.ok ? '' : ' warn'}`} data-testid="ai-key-result" data-ok={result.ok}>
          {result.text}
        </p>
      ) : null}
      <p className="pp-note">{t('ai.key.note')}</p>
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
      <p className="pp-note">{t('ai.dataNote')}</p>
      <KeyBlock />
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
