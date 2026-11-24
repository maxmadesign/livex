import { useEffect, useRef, useState } from 'react';
import type { ThemeId } from '../../core/types';
import type { CustomModelEntry } from '../../settings/spec';
import { useApp, useSettings, useT, useUi } from '../context';
import { ThemeCards } from '../Dialogs';
import { Field, Section, useSetter } from './Field';

/* --------------------------------------------------------- Themes & Toys */

function ToyList({ theme }: { theme: ThemeId }) {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const lang = useSettings((s) => s.system.language);
  const disabled = useSettings((s) => s.themes.disabledToys);
  const custom = useSettings((s) => s.themes.customModels);
  const thumbs = useUi((s) => s.thumbnails);
  const fileInput = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const assets = app.game.library.assets(theme);
  useEffect(() => {
    void app.game.ensureThumbnails(theme);
  }, [app, theme]);

  const toggle = (id: string) => {
    const off = new Set(disabled);
    if (off.has(id)) off.delete(id);
    else {
      // At least one character of the theme must stay in the machine.
      if (assets.filter((a) => !off.has(a.id)).length <= 1) {
        app.game.toast('themes.atLeastOne');
        return;
      }
      off.add(id);
    }
    set('themes.disabledToys', [...off]);
  };

  const onFile = async (file: File | undefined) => {
    const target = slot;
    setSlot(null);
    if (!file || !target) return;
    try {
      const { inspectGlb, saveModelFile, customModelKey } = await import('../../plush/customModels');
      const data = await file.arrayBuffer();
      const problem = inspectGlb(data);
      if (problem) {
        app.game.toast('toast.modelRejected', { reason: problem });
        return;
      }
      const fileKey = customModelKey(target);
      await saveModelFile(fileKey, data);
      const entry: CustomModelEntry = { slotId: target, fileKey, fileName: file.name, displayName: file.name.replace(/\.glb$/i, ''), scale: 1, yawDeg: 0, bytes: data.byteLength };
      set('themes.customModels', [...custom.filter((c) => c.slotId !== target), entry]);
      app.game.toast('toast.modelImported');
    } catch (error) {
      app.game.toast('toast.modelRejected', { reason: error instanceof Error ? error.message : 'error' });
    }
  };

  return (
    <>
      <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} data-testid="model-file" />
      <div className="pp-toys" data-testid="toy-list">
        {assets.map((a) => {
          const on = !disabled.includes(a.id);
          const entry = custom.find((c) => c.slotId === a.id);
          return (
            <div key={a.id} className="pp-toy" data-testid={`toy-${a.id}`} style={{ opacity: on ? 1 : 0.55 }}>
              {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" /> : <span className="ph" />}
              <b>{a.name[lang]}</b>
              <small>{a.kind[lang]}</small>
              <small>{t('themes.size', { h: (a.size[1] * 100).toFixed(0), g: Math.round(a.mass * 1000) })}</small>
              <small>{t(`themes.status.${entry ? 'user-import' : a.source.status}`)}</small>
              <div className="pp-control" style={{ justifyContent: 'center', marginTop: 4 }}>
                <button type="button" role="switch" className="pp-toggle" aria-checked={on} aria-label={t('themes.enabled')} onClick={() => toggle(a.id)} data-testid={`toy-toggle-${a.id}`} />
              </div>
              <div className="pp-seg" style={{ justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSlot(a.id);
                    fileInput.current?.click();
                  }}
                >
                  {t('themes.replace')}
                </button>
                {entry ? (
                  <button
                    type="button"
                    onClick={() => {
                      set('themes.customModels', custom.filter((c) => c.slotId !== a.id));
                      void import('../../plush/customModels').then((m) => m.deleteModelFile(entry.fileKey)).catch(() => undefined);
                    }}
                  >
                    {t('themes.restore')}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ThemesTab() {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const current = useSettings((s) => s.themes.current);
  return (
    <>
      <Section title={t('sec.themes.theme')} />
      <ThemeCards value={current} onPick={(id) => set('themes.current', id)} />
      <Section title={t('sec.themes.toys')} />
      <ToyList theme={current} />
      <Section title={t('sec.themes.field')} />
      <Field path="gameplay.toyCount" />
      <Field path="themes.toyScale" />
      <Field path="themes.stackDensity" />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => app.game.rebuildToys()} data-testid="btn-rebuild">
          {t('btn.rebuildLayout')}
        </button>
      </div>
      <Section title={t('sec.themes.models')} />
      <p className="pp-note">{t('themes.formats')}</p>
      <p className="pp-note">{t('themes.manifestNote')}</p>
    </>
  );
}
