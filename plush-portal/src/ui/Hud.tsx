import { useEffect, useState, type ReactElement } from 'react';
import type { TrackerState } from '../core/contracts';
import type { RoundPhase } from '../core/types';
import type { HudLayout } from '../layout/solve';
import { useApp, useCollection, useSettings, useT, useUi } from './context';
import { IconAgain, IconCamera, IconClaw, IconHeart, IconHelp, IconInfo, IconPalette, IconPlay, IconSparkle, LogoMark, Momo } from './Icons';
import { useModals } from './modals';
import { ScoreBreakdown, ScoreLine, scoreHudRect } from './ScoreHud';
import { WinCard, useWinCard } from './RewardCard';
import { compactPoints } from '../rewards/cardLayout';
// Control panel (phone layout, immersive mode, release fallback).
import type { CSSProperties } from 'react';
import { labelEm } from '../layout/labelFit';
import { requestImmersive } from '../layout/phone';
import { hasCoarsePointer, type Rect } from '../layout/solve';
import { usePhoneGuards, usePhoneSetup } from './useHudLayout';
import { Joystick } from './Joystick';
import { reductionLabelKey, visibleReductions } from '../app/AdaptiveQuality';
// Machines other than classic (src/ui/machines): deck buttons, two-step controls, coin plate.
import { LobbyDeckButton, PlateChip, StaffDeckButton, TwoStepButtons } from './machines/DeckButtons';
import { useMachineDeck, type MachineDeck } from './machines/useMachineDeck';

/**
 * The joystick in its well on the deck. The well keeps the old direction pad's test id ("dpad") and
 * its slot size (three touch sizes plus two gaps, src/layout/solve.ts), so layouts are unchanged.
 */
function StickWell({ disabled, deck }: { disabled: boolean; deck: MachineDeck }) {
  return (
    <div className="pp-dpad" data-testid="dpad">
      {deck.controls === 'twoStep' ? <TwoStepButtons deck={deck} disabled={disabled} /> : <Joystick disabled={disabled} />}
    </div>
  );
}

const BUSY: ReadonlySet<RoundPhase> = new Set(['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);

/**
 * The big context button: START in attract mode, GRAB while aiming, PLAY AGAIN after a win. Drawn as
 * an arcade push button (hud.css): the button is the fixed bezel ring, its `.cap` the plunger that
 * sinks into it when pressed.
 */
function ActionButton() {
  const app = useApp();
  const t = useT();
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const paused = useUi((s) => s.paused);
  const result = useUi((s) => s.result);
  const profile = useUi((s) => s.profile);
  const start = () => {
    // Phones: the first START tap also asks for full screen and a landscape lock (best effort).
    if (profile === 'mobile' && hasCoarsePointer()) requestImmersive();
    app.game.pressStart();
  };
  // The label shrinks (hud.css) rather than splitting a word at large font scales / long words.
  const fit = (text: string) => ({ '--label-em': labelEm(text) }) as CSSProperties;
  if (phase === 'ATTRACT' || demo) {
    const label = t('hud.start');
    return (
      <button type="button" className="pp-btn pp-grab start" data-testid="start" onClick={start} disabled={paused} onContextMenu={(e) => e.preventDefault()} style={fit(label)}>
        <span className="cap">
          <IconPlay />
          <span>{label}</span>
        </span>
      </button>
    );
  }
  if (phase === 'RESULT' && result?.outcome === 'won') {
    const label = t('hud.again');
    return (
      <button type="button" className="pp-btn pp-grab accent again" data-testid="again" onClick={() => app.game.playAgain()} disabled={paused} onContextMenu={(e) => e.preventDefault()} style={fit(label)}>
        <span className="cap">
          <IconAgain />
          <span>{label}</span>
        </span>
      </button>
    );
  }
  const busy = BUSY.has(phase) || phase === 'RESULT';
  const label = t('hud.grab');
  return (
    <button type="button" className="pp-btn pp-grab" data-testid="grab" data-busy={busy} onClick={() => app.game.grab()} disabled={paused || busy} onContextMenu={(e) => e.preventDefault()} style={fit(label)}>
      <span className="cap">
        <IconClaw />
        <span>{label}</span>
      </span>
    </button>
  );
}

function StatusLine({ deck }: { deck: MachineDeck }) {
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
      <PlateChip deck={deck} />
      {aim >= 0 && phase === 'AIMING' ? <span className="timer">{t('hud.timer', { seconds: aim })}</span> : null}
      {pending ? <span className="timer">{t('hud.pending')}</span> : null}
    </div>
  );
}

/** True when the top bar lies inside the interactive safe zone (not on 86" portrait, where it is above it). */
function topBarReachable(layout: HudLayout): boolean {
  const b = layout.topBar;
  return b.y >= layout.safeTop - 1 && b.y + b.h <= layout.safeBottom + 1;
}

/** Starts the countdown calibration with the configured length (camera chip and panel menu). */
function useRecalibrate(): { show: boolean; busy: boolean; run: () => void } {
  const app = useApp();
  const enabled = useSettings((s) => s.camera.enabled);
  const state = useUi((s) => s.tracker.state);
  const busy = useUi((s) => s.tracker.calibration.phase === 'countdown' || s.tracker.calibration.phase === 'capturing');
  return {
    show: enabled && !app.launch.noCamera && CAMERA_RUNNING.has(state),
    busy,
    run: () => app.tracker.startCalibration(app.settings.getState().settings.camera.calibrationSeconds),
  };
}

/**
 * Compact menu inside the reachable zone: settings (same dialog as the corner "i"), collection, theme,
 * help, and "Recalibrate view" where the camera chip in the top bar cannot be reached (86" portrait).
 */
function PanelMenu({ compact, layout, deck }: { compact: boolean; layout: HudLayout; deck: MachineDeck }) {
  const t = useT();
  const { open } = useModals();
  const owned = useCollection((s) => Object.keys(s.counts).length);
  const recal = useRecalibrate();
  const recalHere = recal.show && !topBarReachable(layout);
  // An upright phone's menu row has room for four buttons: the machine buttons go to the top bar.
  const machinesHere = !machineButtonsInTopBar(layout);
  return (
    <div className="pp-menu" data-testid="panel-menu">
      {machinesHere ? <LobbyDeckButton deck={deck} compact={compact} /> : null}
      {machinesHere ? <StaffDeckButton deck={deck} compact={compact} /> : null}
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
      {recalHere ? (
        <button
          type="button"
          className="pp-btn small soft"
          onClick={recal.run}
          disabled={recal.busy}
          data-busy={recal.busy}
          title={t('calibration.recalibrate')}
          aria-label={t('calibration.recalibrate')}
          data-testid="menu-recalibrate"
        >
          <IconCamera />
          {compact ? null : <span>{t('calibration.recalibrate')}</span>}
        </button>
      ) : null}
    </div>
  );
}

/** True on an upright phone, whose menu row is full: MACHINES and Call staff sit in the top bar there. */
function machineButtonsInTopBar(layout: HudLayout): boolean {
  return layout.controls !== null && layout.orientation === 'portrait';
}

/** The machine buttons in the top bar (upright phone only). */
function TopBarMachineButtons({ layout }: { layout: HudLayout }) {
  const deck = useMachineDeck();
  const size = layout.touchMin;
  return (
    <>
      <LobbyDeckButton deck={deck} compact size={size} />
      <StaffDeckButton deck={deck} compact size={size} />
    </>
  );
}

/** Upright phone: a one-time hint that sideways is the intended way (the upright layout stays playable). */
let rotateHintShown = false;

function RotateHint({ layout }: { layout: HudLayout }) {
  const t = useT();
  const [show, setShow] = useState(!rotateHintShown);
  useEffect(() => {
    if (!show) return;
    rotateHintShown = true;
    const timer = setTimeout(() => setShow(false), 7000);
    return () => clearTimeout(timer);
  }, [show]);
  if (!show) return null;
  return (
    <button type="button" className="pp-rotate" style={{ top: layout.topBar.y + layout.topBar.h + 8 }} onClick={() => setShow(false)} data-testid="rotate-hint" aria-label={t('mobile.rotate.dismiss')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="17" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 15.5a9 9 0 0 0 6.5 6.2M21 8.5a9 9 0 0 0-6.5-6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8.6 22.6l1-1.3-1.6-.7M15.4 1.4l-1 1.3 1.6.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{t('mobile.rotate')}</span>
    </button>
  );
}

/** Phone panel: every part at the rectangle the solver computed (relative to the panel's corner). */
function PhonePanel({ layout, padDisabled, deck }: { layout: HudLayout; padDisabled: boolean; deck: MachineDeck }) {
  const p = layout.panel;
  const c = layout.controls!;
  const rel = (r: Rect): CSSProperties => ({ left: r.x - p.x, top: r.y - p.y, width: r.w, height: r.h });
  return (
    <>
      <div
        className={`pp-panel phone ${layout.panelStyle}`}
        data-orient={layout.orientation}
        data-handed={layout.handed}
        // How much of Momo's block fits (hud.css limits the bubble / hides the block from these).
        data-guide-lines={layout.guide.lines}
        data-guide-hidden={layout.guide.hidden ? 'true' : undefined}
        data-testid="panel"
        style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="pp-slot pad" style={rel(c.dpad)} data-testid="slot-dpad">
          <StickWell disabled={padDisabled} deck={deck} />
        </div>
        <div className="pp-slot status" style={rel(c.status)}>
          <StatusLine deck={deck} />
        </div>
        <div className="pp-slot menu" style={rel(c.menu)}>
          <PanelMenu compact layout={layout} deck={deck} />
        </div>
        <div className="pp-slot action" style={rel(c.action)} data-testid="slot-action">
          <ActionButton />
        </div>
      </div>
      {layout.orientation === 'portrait' ? <RotateHint layout={layout} /> : null}
    </>
  );
}

function ControlPanel({ layout }: { layout: HudLayout }) {
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const paused = useUi((s) => s.paused);
  const padDisabled = paused || demo || !(phase === 'READY' || phase === 'AIMING');
  const deck = useMachineDeck();
  const p = layout.panel;
  usePhoneSetup();
  usePhoneGuards(layout.profile === 'mobile');
  if (layout.controls) return <PhonePanel layout={layout} padDisabled={padDisabled} deck={deck} />;
  if (layout.panelStyle === 'split') {
    return (
      <div className="pp-panel split" data-handed={layout.handed} data-testid="panel" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
        <div className="pp-cluster deck stick">
          <StickWell disabled={padDisabled} deck={deck} />
        </div>
        <div className="pp-cluster info">
          <StatusLine deck={deck} />
          <PanelMenu compact={false} layout={layout} deck={deck} />
        </div>
        <div className="pp-cluster deck action">
          <ActionButton />
        </div>
      </div>
    );
  }
  return (
    <div className="pp-panel bar" data-handed={layout.handed} data-testid="panel" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
      <StatusLine deck={deck} />
      <div className="row main">
        <StickWell disabled={padDisabled} deck={deck} />
        <ActionButton />
      </div>
      <PanelMenu compact layout={layout} deck={deck} />
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

/** Tracker states in which the camera is running (a calibration can be taken). */
const CAMERA_RUNNING: ReadonlySet<TrackerState> = new Set(['searching', 'tracking', 'lost']);

function CameraChip({ withText, reachable }: { withText: boolean; reachable: boolean }) {
  const t = useT();
  const enabled = useSettings((s) => s.camera.enabled);
  const state = useUi((s) => s.tracker.state);
  const recal = useRecalibrate();
  const shown: TrackerState = enabled ? state : 'off';
  const chip = (
    <span className="pp-chip" data-testid="camera-chip" data-state={shown} title={t(`camera.short.${shown}`)}>
      <i className="dot" data-tone={CAMERA_TONE[shown]} />
      <IconCamera style={{ width: '1.1em', height: '1.1em' }} />
      {withText ? <span>{t(`camera.short.${shown}`)}</span> : null}
    </span>
  );
  // With the camera on, the chip offers a quick recalibration (countdown, then the current head
  // position becomes the neutral view). Only where it can be reached; on 86" portrait the panel
  // menu carries the same action inside the safe zone.
  if (!recal.show || !reachable) return chip;
  return (
    <span className="pp-camgroup">
      {chip}
      <button
        type="button"
        className="pp-chip pp-recal"
        data-testid="camera-recalibrate"
        data-busy={recal.busy}
        disabled={recal.busy}
        title={t('calibration.recalibrate')}
        aria-label={t('calibration.recalibrate')}
        onClick={recal.run}
      >
        <IconAgain style={{ width: '1.05em', height: '1.05em' }} />
        {withText ? <span>{t('calibration.recalibrate')}</span> : null}
      </button>
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
  // Where the top bar lies outside the interactive safe zone (86" portrait) the theme name is
  // only a label; themes are opened from the control panel. The "i" is the one deliberate exception.
  const reachable = topBarReachable(layout);
  return (
    <>
      <div className="pp-topbar" style={{ left: b.x, top: b.y, width: b.w - iSize - 14 * layout.unit, minHeight: b.h }}>
        <div className="pp-logo" data-testid="logo">
          <LogoMark />
          <span>
            <b>PLUSH</b> <i>PORTAL</i>
          </span>
        </div>
        {rich && reachable ? (
          <button type="button" className="pp-chip" onClick={() => open('themes')} data-testid="theme-chip">
            <i className="dot" style={{ background: 'var(--c-primary)' }} />
            {t(`theme.${themeId}.name`)}
          </button>
        ) : rich ? (
          <span className="pp-chip" data-testid="theme-chip">
            <i className="dot" style={{ background: 'var(--c-primary)' }} />
            {t(`theme.${themeId}.name`)}
          </span>
        ) : null}
        <span className="pp-spacer" />
        {machineButtonsInTopBar(layout) ? <TopBarMachineButtons layout={layout} /> : null}
        {layout.density === 'rich' && wins > 0 ? <span className="pp-chip">{t('hud.wins', { count: wins })}</span> : null}
        <CameraChip withText={layout.density === 'rich' && layout.vw > 900} reachable={reachable} />
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
  const themeId = useUi((s) => s.themeId);
  const lang = useSettings((s) => s.system.language);
  const scoreEnabled = useUi((s) => s.score.enabled);
  const last = useUi((s) => s.score.last);
  // Geometry and the claim block of this round (src/ui/RewardCard.tsx, src/rewards/cardLayout.ts).
  const card = useWinCard(layout);
  if (phase !== 'RESULT' || !result) return null;
  // Demo rounds celebrate with effects and DEMO score popups; the middle of the screen belongs to
  // the attract call to action, so no result card is drawn over it (and never a claim code).
  if (result.demo) return null;
  const award = scoreEnabled && last && last.roundId === result.roundId && !last.demo ? last : null;
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
  if (!card) return null;
  const asset = app.game.library.assets().find((a) => a.id === result.targetTypeId);
  const name = asset ? asset.name[lang] : '';
  const g = card.geometry;
  // Phones next to a claim code: one compact points line instead of the breakdown (room for the code).
  const points = award ? compactPoints(layout, g.kind) ? <ScoreLine award={award} /> : <ScoreBreakdown award={award} /> : null;
  return (
    <WinCard
      layout={layout}
      geometry={g}
      view={card.view}
      themeId={themeId}
      title={t('result.won.title')}
      subtitle={t('result.won.subtitle', { name })}
      thumb={asset ? (thumbs[asset.id] ?? null) : null}
      thumbAlt={name}
      newLabel={prize?.isNew ? t('result.won.new') : null}
      countLine={prize && prize.count > 1 ? t('result.won.count', { count: prize.count }) : null}
      points={points}
      dataPoints={award ? award.total : undefined}
      ribbon={
        award?.newBest ? (
          <span className="pp-newbest" data-testid="new-best">
            {t('score.newBest')}
          </span>
        ) : null
      }
      actions={
        <div className="pp-menu pp-result-actions">
          <button type="button" className="pp-btn accent" onClick={() => app.game.playAgain()} data-testid="result-again">
            <IconAgain style={{ width: '1.1em', height: '1.1em' }} />
            {t('hud.again')}
          </button>
          <button type="button" className="pp-btn small soft" onClick={() => open('collection')} aria-label={t('hud.collection')}>
            <IconHeart />
          </button>
        </div>
      }
    />
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
    `${t('perf.res')} ${eff.width}×${eff.height} (${eff.megapixels.toFixed(2)} MP)  ${t('perf.auto')} ${reductions.length ? visibleReductions(reductions).map((step) => t(reductionLabelKey(step))).join(t('graphics.listSep')) : '—'}`,
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
  const scoring = useUi((s) => s.score.enabled);
  // The theme being switched to: the curtain takes its style (src/ui/theme-gpu.css .pp-curtain[data-to]).
  const nextTheme = useSettings((s) => s.themes.current);
  // The DEMO badge sits under the top bar, or under the score when that is there too.
  const score = scoring ? scoreHudRect(layout) : null;
  const badgeTop = score?.place === 'belowTop' ? score.y + score.h + 12 * layout.unit : Math.max(layout.safeTop + 10, layout.topBar.y + layout.topBar.h + 14);
  // Small phones: under the top bar there is room for the score (which carries its own DEMO tag)
  // or the badge, not both above the call to action (src/ui/AttractOverlay.tsx ctaGeometry).
  const badge = demo && phase !== 'ATTRACT' && !(layout.controls && score?.place === 'belowTop');
  return (
    <div className="pp-hud" data-testid="hud">
      {layout.showGuides ? <SafeGuides layout={layout} /> : null}
      <TopBar layout={layout} />
      {badge ? (
        <div className="pp-demo" data-testid="demo-badge" style={{ top: badgeTop }}>
          {t('hud.demo')}
        </div>
      ) : null}
      <GuideBlock layout={layout} />
      <ControlPanel layout={layout} />
      <ResultLayer layout={layout} />
      <Toasts layout={layout} />
      {perfPanel ? <PerfPanel layout={layout} /> : null}
      {themeBusy ? (
        <div className="pp-curtain" data-to={nextTheme} data-testid="theme-curtain">
          {t('theme.switching')}
        </div>
      ) : null}
      {webglLost ? <div className="pp-curtain">{t('hud.webglLost')}</div> : null}
      <IconSparkle style={{ display: 'none' }} />
    </div>
  );
}
