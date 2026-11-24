import { useEffect, useRef, useState } from 'react';
import { applyDifficultyPreset, applyGraphicsPreset } from '../../app/presets';
import { DISPLAY_PROFILE_IDS, type DisplayProfileId, type ThemeId } from '../../core/types';
import { DESIGN } from '../../layout/solve';
import type { CustomModelEntry } from '../../settings/spec';
import { useApp, useSettings, useT, useUi } from '../context';
import { ThemeCards } from '../Dialogs';
import { useHudLayout } from '../useHudLayout';
import { Field, Row, Section, useSetter } from './Field';

/* ------------------------------------------------------------------ Game */

export function GameplayTab() {
  const app = useApp();
  const t = useT();
  const difficulty = useSettings((s) => s.gameplay.difficulty);
  const set = app.settings.getState().set;
  return (
    <>
      <Section title={t('sec.gameplay.difficulty')} />
      <Row label={t('set.gameplay.difficulty')} hint={t('set.gameplay.difficulty.hint')}>
        <div className="pp-seg" data-testid="field-gameplay.difficulty">
          {(['easy', 'arcade', 'skill'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => applyDifficultyPreset(set, d)} data-value={d}>
              {t(`set.gameplay.difficulty.o.${d}`)}
            </button>
          ))}
          <button type="button" aria-pressed={difficulty === 'custom'} disabled data-value="custom">
            {t('set.gameplay.difficulty.o.custom')}
          </button>
        </div>
      </Row>
      <Section title={t('sec.gameplay.motion')} />
      <Field path="gameplay.moveSpeed" />
      <Field path="gameplay.moveAccel" />
      <Field path="gameplay.descendSpeed" />
      <Field path="gameplay.liftSpeed" />
      <Field path="gameplay.ropeSwing" />
      <Section title={t('sec.gameplay.grip')} />
      <Field path="gameplay.clawForce" />
      <Field path="gameplay.closeSpeed" />
      <Field path="gameplay.gripAssist" />
      <Field path="gameplay.toyFriction" />
      <Field path="gameplay.toyMass" />
      <Section title={t('sec.gameplay.round')} />
      <Field path="gameplay.aimTimeLimit" />
      <Field path="gameplay.restock" />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => app.game.restartRound()} data-testid="btn-restart-round">
          {t('btn.restartRound')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => app.game.restockNow()} data-testid="btn-restock">
          {t('btn.restockNow')}
        </button>
      </div>
      <Section title={t('sec.gameplay.help')} />
      <Field path="gameplay.aimReticle" />
      <Field path="gameplay.aimBeam" />
      <Field path="gameplay.tips" />
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
            <button type="button" className="pp-btn small soft" onClick={() => app.settings.getState().resetProfile(profile)} data-testid="btn-reset-preset">
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

/* -------------------------------------------------------------- Graphics */

export function GraphicsTab() {
  const app = useApp();
  const t = useT();
  const preset = useSettings((s) => s.graphics.preset);
  const eff = useUi((s) => s.effective);
  const reductions = useUi((s) => s.autoReductions);
  const set = app.settings.getState().set;
  return (
    <>
      <Section title={t('sec.graphics.preset')} />
      <Row label={t('set.graphics.preset')}>
        <div className="pp-seg" data-testid="field-graphics.preset">
          {(['safe', 'medium', 'high', 'ultra'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => applyGraphicsPreset(set, p)} data-value={p}>
              {t(`set.graphics.preset.o.${p}`)}
            </button>
          ))}
          <button type="button" aria-pressed={preset === 'custom'} disabled data-value="custom">
            {t('set.graphics.preset.o.custom')}
          </button>
        </div>
      </Row>
      <p className="pp-note" data-testid="graphics-effective">
        {t('graphics.effective', { preset: t(`set.graphics.preset.o.${preset}`), w: eff.width, h: eff.height, mp: eff.megapixels.toFixed(2), ratio: eff.pixelRatio.toFixed(2) })}
        <br />
        {reductions.length > 0 ? t('graphics.reductions', { list: reductions.join(', ') }) : t('graphics.noReductions')}
      </p>
      <Field path="graphics.autoOptimize" />
      <Field path="graphics.targetFps" />
      <Section title={t('sec.graphics.resolution')} />
      <Field path="graphics.renderScale" percent />
      <Field path="graphics.maxPixels" />
      <Field path="graphics.aa" />
      <Section title={t('sec.graphics.detail')} />
      <Field path="graphics.lod" />
      <Field path="graphics.textures" />
      <Field path="graphics.shadows" />
      <Field path="graphics.ao" />
      <Field path="graphics.glass" />
      <Field path="graphics.reflections" />
      <Field path="graphics.fur" />
      <Field path="graphics.deform" />
      <Field path="graphics.particles" />
      <Section title={t('sec.graphics.post')} />
      <Field path="graphics.bloom" percent />
      <Field path="graphics.exposure" />
      <Field path="graphics.toneMapping" />
      <Field path="graphics.dof" />
      <Field path="graphics.motionBlur" />
      <Field path="graphics.perfPanel" />
      <p className="pp-note">{t('graphics.budgetNote')}</p>
      <p className="pp-note">{t('graphics.physicsNote')}</p>
    </>
  );
}
