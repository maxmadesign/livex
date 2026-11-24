import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import type { TrackerState } from '../core/contracts';
import type { RoundPhase } from '../core/types';
import type { HudLayout } from '../layout/solve';
import { useApp, useCollection, useSettings, useT, useUi } from './context';
import { IconAgain, IconArrow, IconCamera, IconClaw, IconHeart, IconHelp, IconInfo, IconPalette, IconPlay, IconSparkle, LogoMark, Momo } from './Icons';
import { useModals } from './modals';

type Direction = 'left' | 'right' | 'back' | 'front';

/** Press-and-hold direction button: moves while held, stops on release, cancel or lost capture. */
function DirButton({ dir, arrow, cls, disabled }: { dir: Direction; arrow: 'up' | 'down' | 'left' | 'right'; cls: string; disabled: boolean }) {
  const app = useApp();
  const t = useT();
  const [pressed, setPressed] = useState(false);
  const pointer = useRef<number | null>(null);
  const release = () => {
    pointer.current = null;
    setPressed(false);
    app.game.setDirection(dir, false);
  };
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || pointer.current !== null) return;
    e.preventDefault();
    pointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    setPressed(true);
    app.game.setDirection(dir, true);
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointer.current === e.pointerId) release();
  };
  // Releasing must also happen when the button becomes disabled or disappears mid-press.
  useEffect(() => {
    if (disabled && pointer.current !== null) release();
    return () => {
      if (pointer.current !== null) app.game.setDirection(dir, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  return (
    <button
      type="button"
      className={`pp-btn round ${cls}`}
      aria-label={t(`hud.dir.${dir}`)}
      data-testid={`dir-${dir}`}
      data-pressed={pressed}
      aria-disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <IconArrow dir={arrow} />
    </button>
  );
}

function DPad({ disabled }: { disabled: boolean }) {
  return (
    <div className="pp-dpad" data-testid="dpad">
      <DirButton dir="back" arrow="up" cls="up" disabled={disabled} />
      <DirButton dir="left" arrow="left" cls="left" disabled={disabled} />
      <span className="hub" />
      <DirButton dir="right" arrow="right" cls="right" disabled={disabled} />
      <DirButton dir="front" arrow="down" cls="down" disabled={disabled} />
    </div>
  );
}

const BUSY: ReadonlySet<RoundPhase> = new Set(['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);

/** The big context button: START in attract mode, GRAB while aiming, PLAY AGAIN after a win. */
function ActionButton() {
  const app = useApp();
  const t = useT();
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const paused = useUi((s) => s.paused);
  const result = useUi((s) => s.result);
  if (phase === 'ATTRACT' || demo) {
    return (
      <button type="button" className="pp-btn pp-grab start" data-testid="start" onClick={() => app.game.pressStart()} disabled={paused}>
        <IconPlay />
        <span>{t('hud.start')}</span>
      </button>
    );
  }
  if (phase === 'RESULT' && result?.outcome === 'won') {
    return (
      <button type="button" className="pp-btn pp-grab accent" data-testid="again" onClick={() => app.game.playAgain()} disabled={paused} style={{ fontSize: 'calc(var(--u) * 30 * var(--fs))' }}>
        <IconAgain />
        <span>{t('hud.again')}</span>
      </button>
    );
  }
  const busy = BUSY.has(phase) || phase === 'RESULT';
  return (
    <button type="button" className="pp-btn pp-grab" data-testid="grab" data-busy={busy} onClick={() => app.game.grab()} disabled={paused || busy}>
      <IconClaw />
      <span>{t('hud.grab')}</span>
    </button>
  );
}

function StatusLine() {
  const t = useT();
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const aim = useUi((s) => s.aimSecondsLeft);
  const pending = useUi((s) => s.pendingChange);
  const restocking = useUi((s) => s.restocking);
  let text = t(`hud.status.${phase}`);
  if (demo) text = t('hud.demoHint');
  else if (phase === 'ATTRACT') text = t('hud.tapToStart');
  else if (restocking && (phase === 'READY' || phase === 'AIMING')) text = t('hud.restocking');
  return (
    <div className="pp-status" data-testid="status" data-phase={phase}>
      <span>{text}</span>
      {aim >= 0 && phase === 'AIMING' ? <span className="timer">{t('hud.timer', { seconds: aim })}</span> : null}
      {pending ? <span className="timer">{t('hud.pending')}</span> : null}
    </div>
  );
}

/** Compact menu inside the reachable zone: settings (same dialog as the corner "i"), collection, theme, help. */
function PanelMenu({ compact }: { compact: boolean }) {
  const t = useT();
  const { open } = useModals();
  const owned = useCollection((s) => Object.keys(s.counts).length);
  return (
    <div className="pp-menu" data-testid="panel-menu">
      <button type="button" className="pp-btn small soft" onClick={() => open('settings')} aria-label={t('hud.settings')} data-testid="menu-settings">
        <IconInfo />
        {compact ? null : <span>{t('hud.settings')}</span>}
      </button>
      <button type="button" className="pp-btn small soft" onClick={() => open('collection')} aria-label={t('hud.collection')} data-testid="menu-collection">
        <IconHeart />
        <span>{owned}</span>
      </button>
      <button type="button" className="pp-btn small soft" onClick={() => open('themes')} aria-label={t('hud.theme')} data-testid="menu-themes">
        <IconPalette />
        {compact ? null : <span>{t('hud.theme')}</span>}
      </button>
      <button type="button" className="pp-btn small soft" onClick={() => open('tutorial')} aria-label={t('tutorial.show')} data-testid="menu-help">
        <IconHelp />
      </button>
    </div>
  );
}

function ControlPanel({ layout }: { layout: HudLayout }) {
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const paused = useUi((s) => s.paused);
  const padDisabled = paused || demo || !(phase === 'READY' || phase === 'AIMING');
  const p = layout.panel;
  if (layout.panelStyle === 'split') {
    return (
      <div className="pp-panel split" data-handed={layout.handed} data-testid="panel" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
        <div className="pp-cluster">
          <DPad disabled={padDisabled} />
        </div>
        <div className="pp-cluster" style={{ alignSelf: 'flex-end', background: 'none', boxShadow: 'none', backdropFilter: 'none', padding: 0, maxWidth: '44%' }}>
          <StatusLine />
          <PanelMenu compact={false} />
        </div>
        <div className="pp-cluster">
          <ActionButton />
        </div>
      </div>
    );
  }
  return (
    <div className="pp-panel bar" data-handed={layout.handed} data-testid="panel" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
      <StatusLine />
      <div className="row main">
        <DPad disabled={padDisabled} />
        <ActionButton />
      </div>
      <PanelMenu compact />
    </div>
  );
}

const CAMERA_TONE: Record<TrackerState, 'live' | 'warn' | 'off' | 'idle'> = {
  off: 'off',
  idle: 'idle',
  requesting: 'idle',
  denied: 'warn',
  no_device: 'warn',
  in_use: 'warn',
  insecure: 'warn',
  loading: 'idle',
  model_error: 'warn',
  searching: 'idle',
  tracking: 'live',
  lost: 'idle',
};

function CameraChip({ withText }: { withText: boolean }) {
  const t = useT();
  const enabled = useSettings((s) => s.camera.enabled);
  const state = useUi((s) => s.tracker.state);
  const shown: TrackerState = enabled ? state : 'off';
  return (
    <span className="pp-chip" data-testid="camera-chip" data-state={shown} title={t(`camera.short.${shown}`)}>
      <i className="dot" data-tone={CAMERA_TONE[shown]} />
      <IconCamera style={{ width: '1.1em', height: '1.1em' }} />
      {withText ? <span>{t(`camera.short.${shown}`)}</span> : null}
    </span>
  );
}

function TopBar({ layout }: { layout: HudLayout }) {
  const t = useT();
  const { open } = useModals();
  const themeId = useUi((s) => s.themeId);
  const wins = useCollection((s) => s.wins);
  const rich = layout.density !== 'minimal';
  const b = layout.topBar;
  const iSize = Math.max(layout.touch * 0.7, 44);
  return (
    <>
      <div className="pp-topbar" style={{ left: b.x, top: b.y, width: b.w - iSize - 14 * layout.unit, minHeight: b.h }}>
        <div className="pp-logo" data-testid="logo">
          <LogoMark />
          <span>
            <b>PLUSH</b> <i>PORTAL</i>
          </span>
        </div>
        {rich ? (
          <button type="button" className="pp-chip" onClick={() => open('themes')} data-testid="theme-chip">
            <i className="dot" style={{ background: 'var(--c-primary)' }} />
            {t(`theme.${themeId}.name`)}
          </button>
        ) : null}
        <span className="pp-spacer" />
        {layout.density === 'rich' && wins > 0 ? <span className="pp-chip">{t('hud.wins', { count: wins })}</span> : null}
        <CameraChip withText={layout.density === 'rich' && layout.vw > 900} />
      </div>
      {/* The round "i" in the top-right corner always opens the full settings dialog. */}
      <button
        type="button"
        className="pp-btn round soft pp-info"
        style={{ right: layout.marginX, top: b.y + (b.h - iSize) / 2, width: iSize, height: iSize, minWidth: 0, minHeight: 0 }}
        onClick={() => open('settings')}
        aria-label={t('hud.settings')}
        data-testid="info-button"
      >
        <IconInfo />
      </button>
    </>
  );
}

function GuideBlock({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const enabled = useSettings((s) => s.ai.enabled);
  const subtitles = useSettings((s) => s.ai.subtitles);
  const line = useUi((s) => s.guideLine);
  const paused = useUi((s) => s.paused);
  if (!enabled) return null;
  const g = layout.guide;
  return (
    <div className="pp-guide" data-align={g.align} data-testid="guide" style={{ left: g.x, top: g.y, width: g.w, minHeight: g.h }}>
      <button type="button" className="pp-momo" onClick={() => app.game.requestTip()} aria-label={t('hud.tip')} data-testid="momo" disabled={paused}>
        <Momo emotion={line?.emotion ?? 'calm'} speaking={line?.speaking ?? false} />
      </button>
      {line && subtitles ? (
        <div className="pp-bubble" key={line.id} data-testid="guide-line" data-source={line.source} aria-live="polite">
          {line.text}
          <small>
            {t('guide.name')} · {line.source === 'gpt' ? t('guide.source.gpt') : t('guide.source.local')}
            {line.voice === 'ai' ? ` · ${t('guide.voice.ai')}` : ''}
          </small>
        </div>
      ) : null}
    </div>
  );
}

function ResultLayer({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const { open } = useModals();
  const phase = useUi((s) => s.phase);
  const result = useUi((s) => s.result);
  const prize = useUi((s) => s.prize);
  const thumbs = useUi((s) => s.thumbnails);
  const lang = useSettings((s) => s.system.language);
  if (phase !== 'RESULT' || !result) return null;
  const zoneMid = (layout.safeTop + layout.safeBottom) / 2;
  if (result.outcome !== 'won') {
    const main = result.outcome === 'slipped' ? t('result.slipped') : t(result.contact === 'none' ? 'result.empty.none' : 'result.empty.touched');
    const top = layout.panelStyle === 'bar' ? Math.max(layout.safeTop + 8, layout.panel.y - 96 * layout.unit) : zoneMid - 40 * layout.unit;
    return (
      <div className="pp-toast miss" style={{ top }} data-testid="result-miss" data-outcome={result.outcome} role="status">
        {main}
        {result.outcome === 'slipped' && result.slipReason ? <small>{t(`result.slip.${result.slipReason}`)}</small> : null}
      </div>
    );
  }
  const asset = app.game.library.assets().find((a) => a.id === result.targetTypeId);
  const name = asset ? asset.name[lang] : '';
  const width = Math.min(layout.vw - 2 * layout.marginX - 20, 560 * layout.unit);
  // Centre of the card: middle of the safe zone, kept clear of the control panel when possible.
  const estimated = 600 * layout.unit;
  let top = zoneMid - estimated / 2;
  if (layout.panelStyle === 'bar') top = Math.max(layout.safeTop + 6, Math.min(top, layout.panel.y - estimated - 10));
  top = Math.max(layout.safeTop + 6, top);
  return (
    <div className="pp-result" data-testid="result-win" role="status" style={{ left: (layout.vw - width) / 2, width, top, boxSizing: 'border-box' }}>
      <h2>{result.demo ? t('result.demo.title') : t('result.won.title')}</h2>
      <div className="portrait">
        {asset && thumbs[asset.id] ? <img src={thumbs[asset.id]} alt={name} /> : null}
        {prize?.isNew && !result.demo ? <span className="pp-badge-new">{t('result.won.new')}</span> : null}
      </div>
      <p>{result.demo ? t('result.demo.subtitle') : t('result.won.subtitle', { name })}</p>
      {!result.demo && prize && prize.count > 1 ? <p style={{ opacity: 0.7, fontSize: '0.82em' }}>{t('result.won.count', { count: prize.count })}</p> : null}
      {!result.demo ? (
        <div className="pp-menu">
          <button type="button" className="pp-btn accent" onClick={() => app.game.playAgain()} data-testid="result-again">
            <IconAgain style={{ width: '1.1em', height: '1.1em' }} />
            {t('hud.again')}
          </button>
          <button type="button" className="pp-btn small soft" onClick={() => open('collection')} aria-label={t('hud.collection')}>
            <IconHeart />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toasts({ layout }: { layout: HudLayout }) {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const [visible, setVisible] = useState<typeof toast>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast);
    const timer = setTimeout(() => setVisible(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!visible) return null;
  const top = Math.min(layout.safeBottom - 90 * layout.unit, Math.max(layout.safeTop + 12, layout.panel.y + layout.panel.h + 14 * layout.unit));
  return (
    <div className="pp-toast" key={visible.id} style={{ top: layout.panelStyle === 'bar' ? top : layout.vh * 0.14, zIndex: 9 }} role="status" data-testid="toast">
      {t(visible.key, visible.params)}
    </div>
  );
}

function PerfPanel({ layout }: { layout: HudLayout }) {
  const t = useT();
  const perf = useUi((s) => s.perf);
  const eff = useUi((s) => s.effective);
  const reductions = useUi((s) => s.autoReductions);
  const na = t('perf.na');
  const lines = [
    `${t('perf.fps')} ${perf.fps.toFixed(1)}  ${t('perf.frame')} ${perf.frameMs.toFixed(1)} ms  ${t('perf.p95')} ${perf.frameP95.toFixed(1)} ms`,
    `${t('perf.physics')} ${perf.physicsMs.toFixed(2)} ms (${perf.stepsPerFrame.toFixed(1)}/f)  ${t('perf.tracking')} ${perf.trackingFps > 0 ? `${perf.trackingMs.toFixed(1)} ms @ ${perf.trackingFps.toFixed(0)} Hz` : '—'}`,
    `${t('perf.calls')} ${perf.calls}  ${t('perf.tris')} ${(perf.triangles / 1000).toFixed(0)}k`,
    `${t('perf.res')} ${eff.width}×${eff.height} (${eff.megapixels.toFixed(2)} MP)  ${t('perf.auto')} ${reductions.length ? reductions.join(',') : '—'}`,
    `${t('perf.gpu')} ${perf.gpuMs === null ? na : `${perf.gpuMs.toFixed(1)} ms`}  ${t('perf.heap')} ${perf.heapMb === null ? na : `${perf.heapMb.toFixed(0)} MB`}`,
  ];
  return (
    <div className="pp-perf" data-testid="perf" style={{ left: layout.marginX, top: layout.topBar.y + layout.topBar.h + 8 }}>
      {lines.join('\n')}
    </div>
  );
}

function SafeGuides({ layout }: { layout: HudLayout }) {
  const anchor = layout.panel.y + layout.panel.h / 2;
  const row = (y: number, cls: string, label: string): ReactElement => (
    <i className={cls} style={{ top: y }}>
      <span>{label}</span>
    </i>
  );
  return (
    <div className="pp-guides" data-testid="safe-guides">
      {row(layout.safeTop, '', `safe top ${(layout.safeTop / layout.vh).toFixed(2)}`)}
      {row(layout.safeBottom, '', `safe bottom ${(layout.safeBottom / layout.vh).toFixed(2)}`)}
      {row(anchor, 'anchor', `panel anchor ${(anchor / layout.vh).toFixed(2)}`)}
      {row(layout.floorY * layout.vh, 'floor', `play floor ${layout.floorY.toFixed(2)}`)}
    </div>
  );
}

/** Everything drawn over the 3D view. Stays fixed in screen space regardless of the viewpoint. */
export function Hud({ layout }: { layout: HudLayout }) {
  const t = useT();
  const demo = useUi((s) => s.demo);
  const phase = useUi((s) => s.phase);
  const themeBusy = useUi((s) => s.themeBusy);
  const webglLost = useUi((s) => s.webglLost);
  const perfPanel = useSettings((s) => s.graphics.perfPanel);
  return (
    <div className="pp-hud" data-testid="hud">
      {layout.showGuides ? <SafeGuides layout={layout} /> : null}
      <TopBar layout={layout} />
      {demo && phase !== 'ATTRACT' ? (
        <div className="pp-demo" data-testid="demo-badge" style={{ top: Math.max(layout.safeTop + 10, layout.topBar.y + layout.topBar.h + 14) }}>
          {t('hud.demo')}
        </div>
      ) : null}
      <GuideBlock layout={layout} />
      <ControlPanel layout={layout} />
      <ResultLayer layout={layout} />
      <Toasts layout={layout} />
      {perfPanel ? <PerfPanel layout={layout} /> : null}
      {themeBusy ? <div className="pp-curtain">{t('theme.switching')}</div> : null}
      {webglLost ? <div className="pp-curtain">{t('hud.webglLost')}</div> : null}
      <IconSparkle style={{ display: 'none' }} />
    </div>
  );
}
