import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createApp, type App as AppInstance } from '../app/bootstrap';
import { brandForTheme } from '../brand';
import { loadBrandFont } from '../brand/fonts';
import { logError } from '../diagnostics/log';
import { registerAllStrings } from '../i18n/all';
import type { FrameBox } from '../layout/frame';
import { THEMES } from '../themes/themes';
import { AttractOverlay } from './AttractOverlay';
import { BootScreen } from './BootScreen';
import { CalibrationOverlay } from './CalibrationOverlay';
import { AppContext, useApp, useSettings, useUi } from './context';
import { CollectionDialog, DeviceChooser, ThemePicker, TutorialDialog } from './Dialogs';
import { Hud } from './Hud';
import { ScoreHud } from './ScoreHud';
import { LobbyDialog } from './machines/LobbyDialog';
import { MachineLayer } from './machines/MachineLayer';
import { useModals } from './modals';
import { useHudLayout, useReducedMotion } from './useHudLayout';

const SettingsDialog = lazy(() => import('./settings/SettingsDialog'));

registerAllStrings();

/** Keyboard: arrows / WASD move, Space / Enter act. Typing in a field never triggers game keys. */
function useKeyboard(): void {
  const app = useApp();
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'back' | 'front'> = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'back',
      KeyW: 'back',
      ArrowDown: 'front',
      KeyS: 'front',
    };
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (app.ui.getState().modal !== null) return;
      const dir = map[e.code];
      if (dir) {
        e.preventDefault();
        if (!e.repeat) app.game.setDirection(dir, true);
        return;
      }
      if (e.code === 'KeyF' && !e.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        // Let Enter / Space activate a focused control (button, link, field) instead of also grabbing
        // or pressing PLAY AGAIN: a focused claim link on the win card must open, not drop the code.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('button, a[href], [role="button"], [role="link"], input, select, textarea, summary, [contenteditable="true"]')) return;
        e.preventDefault();
        if (e.repeat) return;
        const phase = app.ui.getState().phase;
        if (phase === 'ATTRACT' || app.ui.getState().demo) app.game.pressStart();
        else if (phase === 'RESULT') app.game.playAgain();
        else app.game.grab();
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = map[e.code];
      if (dir) app.game.setDirection(dir, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [app]);
}

/** What the shell reports to the page: the box the game is laid out in and the theme glow for the surround. */
interface FrameReport {
  box: FrameBox;
  glow: string;
}

function Shell({ onFrame }: { onFrame: (report: FrameReport) => void }) {
  const app = useApp();
  const layout = useHudLayout();
  const reduced = useReducedMotion();
  const lang = useSettings((s) => s.system.language);
  const themeId = useUi((s) => s.themeId);
  const modal = useUi((s) => s.modal);
  const bootStage = useUi((s) => s.boot.stage);
  const profileChosen = useUi((s) => s.profileChosen);
  const { close } = useModals();
  useKeyboard();

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
  }, [lang]);

  // First run: ask which kind of screen this is, in a dialog that is reachable on every preset.
  useEffect(() => {
    if (bootStage === 'ready' && !profileChosen && app.ui.getState().modal === null) {
      app.ui.setState({ modal: 'device' });
      app.game.setModalOpen(true);
    }
  }, [app, bootStage, profileChosen]);

  // The how-to-play card is shown once, the first time a player leaves attract mode.
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  useEffect(() => {
    if (phase !== 'READY' || demo || app.ui.getState().modal !== null) return;
    if (!app.settings.getState().settings.gameplay.tips) return;
    let seen = true;
    try {
      seen = localStorage.getItem('plush-portal/tutorial-seen') === '1';
      localStorage.setItem('plush-portal/tutorial-seen', '1');
    } catch {
      /* storage unavailable: do not nag */
    }
    if (seen) return;
    app.ui.setState({ modal: 'tutorial' });
    app.game.setModalOpen(true);
  }, [app, phase, demo]);

  // The brand typeface is fetched only once a theme dressed by the kit is shown (other themes never
  // ask for its files); the fallback stack is in place before the first paint (src/brand/fonts.ts).
  const kit = brandForTheme(themeId);
  useLayoutEffect(() => {
    if (kit) void loadBrandFont(kit);
    // From here on the stylesheet colours the page for the theme (index.html marked it before load).
    delete document.documentElement.dataset.bootTheme;
    // Phone browsers paint their toolbar in the theme colour: black for the kit's theme, else the page default.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    meta.dataset.initial ??= meta.content;
    meta.content = kit ? kit.palette.black : meta.dataset.initial;
  }, [kit]);

  const ui = THEMES[themeId].ui;
  // The page positions the canvas and this HUD in the box (before paint, so nothing flashes).
  const frame = layout.frame;
  useLayoutEffect(() => {
    onFrame({ box: frame, glow: ui.glow });
  }, [onFrame, frame, ui.glow]);

  const style = {
    '--u': `${layout.unit}px`,
    '--fs': layout.fontScale,
    '--touch': `${layout.touch}px`,
    '--c-primary': ui.primary,
    '--c-primary-deep': ui.primaryDeep,
    '--c-accent': ui.accent,
    '--c-accent2': ui.accent2,
    '--c-ink': ui.ink,
    '--c-paper': ui.paper,
    '--c-panel': ui.panel,
    '--c-glow': ui.glow,
  } as CSSProperties;

  return (
    <div className="pp-hud-root" style={{ ...style, position: 'absolute', inset: 0, pointerEvents: 'none' }} data-reduced={reduced}>
      <div className="pp-root" data-lang={lang} data-theme={themeId} data-brand={kit?.id} data-profile={layout.profile} data-reduced={reduced} style={{ ...style, background: 'none', pointerEvents: 'none' }}>
        {/* Stacking follows document order: HUD, score, attract call to action, calibration countdown, then dialogs. */}
        {bootStage === 'ready' ? <Hud layout={layout} /> : null}
        {bootStage === 'ready' ? <ScoreHud layout={layout} /> : null}
        {bootStage === 'ready' ? <MachineLayer layout={layout} /> : null}
        {bootStage === 'ready' ? <AttractOverlay layout={layout} /> : null}
        {bootStage === 'ready' ? <CalibrationOverlay layout={layout} /> : null}
        {modal === 'device' ? <DeviceChooser layout={layout} /> : null}
        {modal === 'tutorial' ? <TutorialDialog layout={layout} /> : null}
        {modal === 'themes' ? <ThemePicker layout={layout} /> : null}
        {modal === 'collection' ? <CollectionDialog layout={layout} /> : null}
        {modal === 'lobby' ? <LobbyDialog layout={layout} /> : null}
        {modal === 'settings' ? (
          <Suspense fallback={null}>
            <SettingsDialog layout={layout} onClose={close} />
          </Suspense>
        ) : null}
        <BootScreen />
      </div>
    </div>
  );
}

/** Keeps the 3D game alive if the HUD throws: the error is logged and the HUD is re-mounted. */
class HudBoundary extends Component<{ children: ReactNode }, { failed: number }> {
  override state = { failed: 0 };
  override componentDidCatch(error: unknown): void {
    logError('ui', error);
    this.setState((s) => ({ failed: s.failed + 1 }));
  }
  override render(): ReactNode {
    if (this.state.failed > 3) return null;
    return <div key={this.state.failed}>{this.props.children}</div>;
  }
}

const sameBox = (a: FrameBox, b: FrameBox) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.simulated === b.simulated && a.letterboxed === b.letterboxed;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<AppInstance | null>(null);
  // The box the game is laid out in (src/layout/frame.ts), reported by the shell once it is mounted.
  const [frame, setFrame] = useState<FrameReport | null>(null);
  const onFrame = useCallback((next: FrameReport) => {
    setFrame((prev) => (prev && sameBox(prev.box, next.box) && prev.glow === next.glow ? prev : next));
  }, []);
  const box = frame?.box ?? null;
  const simulated = box?.simulated ?? false;
  const letterboxed = simulated && (box?.letterboxed ?? false);

  // The game computes a simulated box itself, but measures the canvas element otherwise. When the
  // box changes to or from a simulated screen (the toggle, another preset), let it measure the
  // committed size once more through its ordinary resize path.
  const previous = useRef<FrameBox | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = box;
    if (!box || !before || sameBox(before, box)) return;
    if (before.simulated || box.simulated) window.dispatchEvent(new Event('resize'));
  }, [box]);

  useEffect(() => {
    let disposed = false;
    let instance: AppInstance | null = null;
    void createApp(canvasRef.current!).then((created) => {
      if (disposed) {
        created.dispose();
        return;
      }
      instance = created;
      setApp(created);
      void created.game.init().then(() => {
        (window as unknown as { __bootDone?: boolean }).__bootDone = true;
      });
    });
    return () => {
      disposed = true;
      instance?.dispose();
    };
  }, []);
  const glow = { '--c-glow': frame?.glow ?? '#ffc6d9' } as CSSProperties;
  // A letterboxed simulated screen: the canvas, HUD, overlays and dialogs all live in the box
  // (frame.css makes it the containing block of the HUD's fixed layers).
  const rootStyle = letterboxed && box ? ({ ...glow, left: box.x, top: box.y, width: box.w, height: box.h, right: 'auto', bottom: 'auto' } as CSSProperties) : undefined;
  return (
    <>
      <div className="pp-surround" data-frame={letterboxed ? 'simulate916' : 'fill'} style={glow} aria-hidden="true" data-testid="frame-surround" />
      <div className="pp-root" data-testid="root" data-frame={simulated ? 'simulate916' : 'fill'} data-letterbox={letterboxed} style={rootStyle}>
        <canvas ref={canvasRef} className="pp-canvas" data-testid="game-canvas" tabIndex={-1} />
        {app ? (
          <AppContext.Provider value={app}>
            <HudBoundary>
              <Shell onFrame={onFrame} />
            </HudBoundary>
          </AppContext.Provider>
        ) : null}
      </div>
    </>
  );
}
