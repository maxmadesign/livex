import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { brandForTheme, type BrandKit } from '../../brand';
import { brandFontStatus, loadBrandFont, onBrandFontStatus } from '../../brand/fonts';
import type { ThemeId } from '../../core/types';
import type { CustomModelEntry } from '../../settings/spec';
import { BrandLogo, useBrandLogo } from '../BrandLogo';
import { useApp, useSettings, useT, useUi } from '../context';
import { ThemeCards } from '../Dialogs';
import { brandFolder, fontStatus, logoStatus, type StatusLine } from './brandStatus';
import { Field, Section, useSetter } from './Field';

/* --------------------------------------------------------- brand status */

/**
 * For the theme a brand kit dresses (src/brand): which event / host logo files are drawn (official
 * or placeholder, and where to drop the official file), and whether the brand typeface loaded.
 */
function BrandStatus({ kit }: { kit: BrandKit }) {
  const t = useT();
  const lang = useSettings((s) => s.system.language);
  const event = useBrandLogo(kit.logo);
  const host = useBrandLogo(kit.hostLogo);
  const font = useSyncExternalStore(onBrandFontStatus, () => brandFontStatus(kit));
  useEffect(() => {
    void loadBrandFont(kit);
  }, [kit]);
  const line = (id: string, label: string, status: StatusLine) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={`brand-status-${id}`} data-state={status.state}>
        {t(status.key, status.params)}
      </dd>
    </>
  );
  return (
    <>
      <Section title={t('brand.status.title')} />
      <div className="pp-brand-status" data-testid="brand-status">
        {event?.url ? <BrandLogo slot={kit.logo} alt={t('brand.logo.alt', { event: kit.eventName })} testId="brand-status-logo" /> : null}
        <dl className="pp-kv">
          <dt>{t('brand.status.kit')}</dt>
          <dd>{kit.themeName[lang]}</dd>
          {line('event', t('brand.status.event'), logoStatus(kit.logo, event))}
          {line('host', t('brand.status.host'), logoStatus(kit.hostLogo, host))}
          {line('font', t('brand.status.font'), fontStatus(kit, font))}
        </dl>
      </div>
      <p className="pp-note">{t('gpu.description')}</p>
      {/* A real event's marks are the owner's responsibility (docs); a generic kit says its cast is original. */}
      {kit.namesAllowed ? <p className="pp-note">{t('brand.status.note', { dir: brandFolder(kit) })}</p> : <p className="pp-note">{t('gpu.originals')}</p>}
    </>
  );
}

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
              {!entry && a.source.method === 'ai-generated' ? (
                // Provenance of the generated model; the generator and the licence note are on hover.
                <small className="pp-gen" data-testid={`toy-gen-${a.id}`} title={`${a.source.generator}\n${a.source.license}`}>
                  {t('themes.aiGenerated')}
                </small>
              ) : null}
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
      {assets.some((a) => a.source.method === 'ai-generated') ? (
        <p className="pp-note" data-testid="toy-provenance">
          {t('themes.aiGenerated.note')}
        </p>
      ) : null}
    </>
  );
}

export function ThemesTab() {
  const app = useApp();
  const t = useT();
  const set = useSetter();
  const current = useSettings((s) => s.themes.current);
  const kit = brandForTheme(current);
  return (
    <>
      <Section title={t('sec.themes.theme')} />
      <ThemeCards value={current} onPick={(id) => set('themes.current', id)} />
      {kit ? <BrandStatus kit={kit} /> : null}
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
