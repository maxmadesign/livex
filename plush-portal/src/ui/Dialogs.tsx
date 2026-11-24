import { useEffect } from 'react';
import { DISPLAY_PROFILE_IDS, THEME_IDS, type DisplayProfileId, type ThemeId } from '../core/types';
import { guessProfile, type HudLayout } from '../layout/solve';
import { THEMES } from '../themes/themes';
import { useApp, useCollection, useSettings, useT, useUi } from './context';
import { Modal } from './Modal';
import { useModals } from './modals';

/** First-run chooser (and Settings → Layout shortcut): the browser cannot know the physical screen. */
export function DeviceChooser({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const { close } = useModals();
  const current = useUi((s) => s.profile);
  const chosen = useUi((s) => s.profileChosen);
  const suggested = guessProfile(layout.vw, layout.vh);
  const pick = (id: DisplayProfileId) => {
    app.game.chooseProfile(id);
    app.ui.setState({ profile: id, profileChosen: true });
    close();
  };
  return (
    <Modal layout={layout} title={t('device.title')} onClose={() => pick(chosen ? current : suggested)} closeLabel={t('common.close')} compact size={0.92} testId="device-chooser">
      <p style={{ margin: '0 0 0.8em', fontWeight: 500 }}>{t('device.subtitle')}</p>
      <div className="pp-cards">
        {DISPLAY_PROFILE_IDS.map((id) => (
          <button key={id} type="button" className="pp-card" data-selected={chosen ? id === current : id === suggested} onClick={() => pick(id)} data-testid={`device-${id}`}>
            {id === suggested ? <i className="tag">{t('device.suggested')}</i> : null}
            <strong>{t(`device.${id}.name`)}</strong>
            <span>{t(`device.${id}.desc`)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function TutorialDialog({ layout }: { layout: HudLayout }) {
  const t = useT();
  const { close } = useModals();
  return (
    <Modal
      layout={layout}
      title={t('tutorial.title')}
      onClose={() => close()}
      closeLabel={t('common.close')}
      compact
      size={0.8}
      testId="tutorial"
      footer={
        <>
          <span className="note">{t('hud.keys')}</span>
          <button type="button" className="pp-btn accent small" onClick={() => close()} data-testid="tutorial-ok">
            {t('tutorial.ok')}
          </button>
        </>
      }
    >
      <ol className="pp-steps">
        {[1, 2, 3, 4].map((n) => (
          <li key={n}>{t(`tutorial.step${n}`)}</li>
        ))}
      </ol>
      <p className="pp-note">{t('tutorial.tip')}</p>
      <p className="pp-note">{t('tutorial.parallax')}</p>
    </Modal>
  );
}

function Swatches({ id }: { id: ThemeId }) {
  const ui = THEMES[id].ui;
  return (
    <div className="pp-swatches">
      {[ui.primary, ui.accent, ui.accent2, THEMES[id].cabinet.frame, THEMES[id].cabinet.velvet].map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </div>
  );
}

/** Four theme cards. Used by the quick picker and inside Settings → Themes & Toys. */
export function ThemeCards({ value, onPick }: { value: ThemeId; onPick: (id: ThemeId) => void }) {
  const t = useT();
  return (
    <div className="pp-cards" data-testid="theme-cards">
      {THEME_IDS.map((id) => (
        <button key={id} type="button" className="pp-card" data-selected={id === value} aria-pressed={id === value} onClick={() => onPick(id)} data-testid={`theme-${id}`}>
          <Swatches id={id} />
          <strong>{t(`theme.${id}.name`)}</strong>
          <span>{t(`theme.${id}.tagline`)}</span>
        </button>
      ))}
    </div>
  );
}

export function ThemePicker({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const { close } = useModals();
  const current = useSettings((s) => s.themes.current);
  return (
    <Modal layout={layout} title={t('hud.theme')} onClose={() => close()} closeLabel={t('common.close')} compact size={0.92} testId="theme-picker">
      <ThemeCards
        value={current}
        onPick={(id) => {
          app.settings.getState().set('themes.current', id);
          close();
          if (app.ui.getState().pendingChange) app.game.toast('hud.pending');
        }}
      />
    </Modal>
  );
}

export function CollectionDialog({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const { close } = useModals();
  const counts = useCollection((s) => s.counts);
  const thumbs = useUi((s) => s.thumbnails);
  const lang = useSettings((s) => s.system.language);
  const assets = app.game.library.assets();
  useEffect(() => {
    // Portraits of other themes are rendered on demand.
    void (async () => {
      for (const id of THEME_IDS) await app.game.ensureThumbnails(id);
    })();
  }, [app]);
  const owned = assets.filter((a) => (counts[a.id] ?? 0) > 0).length;
  const prizes = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Modal
      layout={layout}
      title={t('collection.title')}
      onClose={() => close()}
      closeLabel={t('common.close')}
      testId="collection"
      footer={<span className="note">{t('collection.total', { owned, total: assets.length, prizes })}</span>}
    >
      {prizes === 0 ? <p className="pp-note">{t('collection.empty')}</p> : null}
      {/* A theme without characters of its own yet (e.g. a new theme before its assets are baked) gets no empty section. */}
      {THEME_IDS.filter((theme) => assets.some((a) => a.theme === theme)).map((theme) => (
        <section key={theme}>
          <h3 className="pp-sec">{t(`theme.${theme}.name`)}</h3>
          <div className="pp-toys">
            {assets
              .filter((a) => a.theme === theme)
              .map((a) => {
                const n = counts[a.id] ?? 0;
                return (
                  <div key={a.id} className="pp-toy" data-locked={n === 0} data-testid={`collection-${a.id}`}>
                    {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" /> : <span className="ph" />}
                    <b>{n > 0 ? a.name[lang] : '？？？'}</b>
                    <small>{n > 0 ? a.kind[lang] : t('collection.locked')}</small>
                    {n > 0 ? <span className="count">{t('collection.count', { count: n })}</span> : null}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </Modal>
  );
}

export function BootScreen() {
  const t = useT();
  const boot = useUi((s) => s.boot);
  return (
    <div className="pp-boot" data-done={boot.stage === 'ready'} data-testid="boot" aria-hidden={boot.stage === 'ready'}>
      <div>
        <h1>
          PLUSH <i>PORTAL</i>
        </h1>
        {boot.stage === 'error' ? (
          <div className="error">
            <p>{t('boot.error.title')}</p>
            <p style={{ fontWeight: 500, opacity: 0.8, margin: '0.5em 0 1em' }}>{boot.error}</p>
            <p style={{ fontWeight: 500 }}>{t('boot.error.hint')}</p>
            <p style={{ marginTop: '1em' }}>
              <button type="button" className="pp-btn" style={{ ['--u' as string]: '1px', ['--touch' as string]: '56px' }} onClick={() => location.reload()}>
                {t('boot.retry')}
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="bar">
              <i style={{ width: `${Math.round(boot.progress * 100)}%` }} />
            </div>
            <p>{t(`boot.${boot.label}`)}</p>
          </>
        )}
      </div>
    </div>
  );
}
