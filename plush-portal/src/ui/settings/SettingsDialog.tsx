import { useEffect, useState, type ReactElement } from 'react';
import type { HudLayout } from '../../layout/solve';
import type { Settings } from '../../settings/spec';
import { useApp, useSettings, useSettingsState, useT, useUi } from '../context';
import { IconBrain, IconCamera, IconClose, IconGame, IconGear, IconGraphics, IconLayout, IconSpeaker, IconToy } from '../Icons';
import { useModals } from '../modals';
import { Field, Section } from './Field';
import { AiTab } from './tabAi';
import { AudioTab } from './tabAudio';
import { CameraTab } from './tabCamera';
import { GameplayTab } from './tabGameplay';
import { GraphicsTab } from './tabGraphics';
import { LayoutTab } from './tabLayout';
import { SystemTab } from './tabSystem';
import { ThemesTab } from './tabThemes';

type TabId = 'gameplay' | 'themes' | 'layout' | 'graphics' | 'audio' | 'ai' | 'camera' | 'system';

const TABS: { id: TabId; icon: () => ReactElement; panel: () => ReactElement; section: keyof Settings | null }[] = [
  { id: 'gameplay', icon: () => <IconGame />, panel: () => <GameplayTab />, section: 'gameplay' },
  { id: 'themes', icon: () => <IconToy />, panel: () => <ThemesTab />, section: 'themes' },
  { id: 'layout', icon: () => <IconLayout />, panel: () => <LayoutTab />, section: null },
  { id: 'graphics', icon: () => <IconGraphics />, panel: () => <GraphicsTab />, section: 'graphics' },
  { id: 'audio', icon: () => <IconSpeaker />, panel: () => <AudioTab />, section: 'audio' },
  { id: 'ai', icon: () => <IconBrain />, panel: () => <AiTab />, section: 'ai' },
  { id: 'camera', icon: () => <IconCamera />, panel: () => <CameraTab />, section: 'camera' },
  { id: 'system', icon: () => <IconGear />, panel: () => <SystemTab />, section: 'system' },
];

let lastTab: TabId = 'gameplay';
/** The PIN unlock lasts until the page is reloaded. */
let unlockedThisSession = false;

/** Reduced panel for public displays: nothing here can break the installation. */
function QuickOptions({ onUnlock }: { onUnlock: () => void }) {
  const app = useApp();
  const t = useT();
  const { open } = useModals();
  const [pin, setPin] = useState('');
  const tryUnlock = () => {
    if (pin === app.settings.getState().settings.system.lockPin) {
      unlockedThisSession = true;
      onUnlock();
    } else {
      setPin('');
      app.game.toast('toast.wrongPin');
    }
  };
  return (
    <div className="pp-tabpanel" style={{ padding: '0 6%' }} data-testid="quick-options">
      <Section title={t('settings.quick.title')} />
      <Field path="system.language" />
      <Field path="audio.muted" />
      <Field path="audio.master" percent />
      <Field path="camera.enabled" />
      <Field path="ai.enabled" />
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => open('tutorial')}>
          {t('tutorial.show')}
        </button>
      </div>
      <Section title={t('settings.locked.title')} />
      <p className="pp-note">{t('settings.locked.hint')}</p>
      <div className="pp-actions">
        <input
          className="pp-input"
          style={{ maxWidth: '10em' }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={8}
          placeholder={t('settings.locked.pin')}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
          data-testid="pin-input"
        />
        <button type="button" className="pp-btn small soft" onClick={tryUnlock} data-testid="pin-unlock">
          {t('settings.locked.unlock')}
        </button>
      </div>
    </div>
  );
}

/**
 * The settings dialog: tabs on the left, the selected tab's settings on the
 * right, actions at the bottom. Everything is previewed live from a draft;
 * Cancel restores the applied values, Apply persists them. Values that change
 * the game itself are marked and take effect after the current round.
 */
export default function SettingsDialog({ layout, onClose }: { layout: HudLayout; onClose: (apply?: boolean) => void }) {
  const app = useApp();
  const t = useT();
  const [tab, setTab] = useState<TabId>(lastTab);
  const [unlocked, setUnlocked] = useState(unlockedThisSession);
  // Subscribing to the draft keeps the "unsaved changes" note current.
  useSettingsState((s) => s.draft);
  const dirty = app.settings.getState().isDirty();
  const locked = useSettings((s) => s.system.lockSettings && s.system.lockPin.length > 0) && !unlocked;
  const pending = useUi((s) => s.pendingChange);
  useEffect(() => {
    lastTab = tab;
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const m = layout.modal;
  const narrow = m.w < 620 * Math.max(1, layout.unit) || m.w < 560;
  const active = TABS.find((x) => x.id === tab)!;
  const resetTab = () => {
    const store = app.settings.getState();
    if (tab === 'layout') store.resetProfile(app.ui.getState().profile, 'layout');
    else if (tab === 'camera') {
      // Camera settings plus this preset's viewing geometry and calibration; its layout is kept.
      store.resetSection('camera');
      store.resetProfile(app.ui.getState().profile, 'view');
    } else if (active.section) store.resetSection(active.section);
  };

  return (
    <>
      <div className="pp-backdrop" onPointerDown={() => onClose(false)} />
      <div className="pp-modal" role="dialog" aria-modal="true" aria-label={t('settings.title')} style={{ left: m.x, top: m.y, width: m.w, height: m.h }} data-testid="settings">
        <header>
          <h1>{t('settings.title')}</h1>
          <button type="button" className="pp-btn round small soft" onClick={() => onClose(false)} aria-label={t('common.close')} data-testid="settings-close">
            <IconClose />
          </button>
        </header>
        {locked ? (
          <QuickOptions onUnlock={() => setUnlocked(true)} />
        ) : (
          <div className="pp-settings" data-narrow={narrow}>
            <nav className="pp-tabs" role="tablist" aria-orientation="vertical" data-testid="settings-tabs">
              {TABS.map((x) => (
                <button key={x.id} type="button" role="tab" className="pp-tab" aria-selected={x.id === tab} onClick={() => (setTab(x.id), app.audio.playSfx('ui_toggle'))} title={t(`settings.tab.${x.id}`)} data-testid={`tab-${x.id}`}>
                  {x.icon()}
                  <span>{t(`settings.tab.${x.id}`)}</span>
                </button>
              ))}
            </nav>
            <section className="pp-tabpanel" role="tabpanel" data-testid={`panel-${tab}`} key={tab}>
              {active.panel()}
            </section>
          </div>
        )}
        <footer>
          <span className="note" data-testid="settings-note">
            {dirty ? t('settings.dirty') : t('settings.paused')}
            {pending ? ` · ${t('hud.pending')}` : ''}
          </span>
          {locked ? null : (
            <button type="button" className="pp-btn small soft" onClick={resetTab} data-testid="settings-reset-tab">
              {t('settings.resetTab')}
            </button>
          )}
          <button type="button" className="pp-btn small soft" onClick={() => onClose(false)} data-testid="settings-cancel">
            {t('common.cancel')}
          </button>
          <button type="button" className="pp-btn small accent" onClick={() => onClose(true)} data-testid="settings-apply">
            {t('common.apply')}
          </button>
        </footer>
      </div>
    </>
  );
}
