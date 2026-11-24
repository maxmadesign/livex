import { useEffect, useState } from 'react';
import { THEME_IDS, type ThemeId } from '../../core/types';
import { useApp, useSettings, useT, useUi } from '../context';
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
