import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { App } from '../app/bootstrap';
import { IDLE_CALIBRATION, type CalibrationStatus, type TrackerState } from '../core/contracts';
import type { HudLayout } from '../layout/solve';
import { AutoCalibrationPolicy } from '../tracking/autoCalibration';
import { baselineWrites } from '../tracking/baseline';
import { ROTATED, WAITING_CAMERA } from '../tracking/countdown';
import type { CalibrationEvent, FaceTracker } from '../tracking/FaceTracker';
import { useApp, useSettings, useT, useUi } from './context';

/**
 * Camera calibration countdown: shows the tracker's `status().calibration` (countdown, capture,
 * done / failed) after TrackerPort.startCalibration, a prompt after the camera picture rotated and
 * a notice when the camera cannot be used on an insecure page. Mounted above the HUD and below
 * dialogs (src/ui/App.tsx). Styles: src/ui/calibration.css. Strings: src/i18n/strings/calibration.ts.
 *
 * It also hosts the calibration coordinator (useCalibrationCoordinator): automatic calibration
 * after the camera starts (camera.autoCalibrate, never while a round is in progress), persisting
 * the captured baseline for the active display preset, and telling the tracker which preset is active.
 */
export function CalibrationOverlay({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const policy = useCalibrationCoordinator(app);
  const cal = useUi((s) => s.tracker.calibration) ?? IDLE_CALIBRATION;
  const trackerState = useUi((s) => s.tracker.state);
  const enabled = useSettings((s) => s.camera.enabled);
  const autoCalibrate = useSettings((s) => s.camera.autoCalibrate);
  const seconds = useSettings((s) => s.camera.calibrationSeconds);
  const notice = useInsecureNotice(enabled && !app.launch.noCamera, trackerState);
  const box = calibrationBox(layout);

  const retry = () => app.tracker.startCalibration(seconds);
  const skip = () => {
    policy.skip();
    app.tracker.cancelCalibration();
  };

  const icon = box.ring * (box.layout === 'row' ? 0.8 : 0.5);
  let card: ReactNode = null;
  if (cal.phase === 'countdown' || cal.phase === 'capturing') {
    card = <CountdownCard cal={cal} trackerState={trackerState} box={box} onCancel={skip} />;
  } else if (cal.phase === 'done') {
    card = (
      <Card kind="done" box={box} visual={<TickIcon size={icon} />} role="status">
        <p className="pp-cal-title">{t('calibration.done')}</p>
        <p className="pp-cal-note">{t('calibration.doneHint')}</p>
      </Card>
    );
  } else if (cal.phase === 'failed') {
    const key = `calibration.fail.${cal.detail}`;
    const text = t(key);
    card = (
      <Card kind="failed" box={box} visual={<CrossIcon size={icon} />} role="alert">
        <p className="pp-cal-title">{text === key ? t('calibration.failed') : text}</p>
        <div className="pp-cal-actions">
          {cal.detail === 'not_running' || cal.detail === 'insecure' ? null : (
            <button type="button" className="pp-btn small accent" onClick={retry} data-testid="calib-retry">
              {t('calibration.retry')}
            </button>
          )}
          <button type="button" className="pp-btn small soft" onClick={skip} data-testid="calib-skip">
            {t('calibration.skip')}
          </button>
        </div>
      </Card>
    );
  } else if (cal.phase === 'idle' && cal.detail === ROTATED && enabled && !autoCalibrate) {
    // With automatic calibration on, the countdown itself follows at the next READY / ATTRACT.
    card = (
      <Card kind="rotated" box={box} visual={<RotateIcon size={icon} />} role="status">
        <p className="pp-cal-title">{t('calibration.rotated.title')}</p>
        <p className="pp-cal-note">{t('calibration.rotated.body')}</p>
        <div className="pp-cal-actions">
          <button type="button" className="pp-btn small accent" onClick={retry} data-testid="calib-start">
            {t('calibration.start')}
          </button>
          <button type="button" className="pp-btn small soft" onClick={skip} data-testid="calib-skip">
            {t('calibration.notNow')}
          </button>
        </div>
      </Card>
    );
  }

  // The notice and a card share the region: a card (e.g. the "insecure" failure, same message) wins.
  const showNotice = notice.shown && !card;
  if (!card && !showNotice) return null;
  const style = {
    '--cal-ring': `${box.ring}px`,
    '--cal-font': `${box.font}px`,
  } as CSSProperties;
  return (
    <div className="pp-cal-layer" data-testid="calibration-overlay" data-phase={cal.phase} data-detail={cal.detail} style={style}>
      {card ? (
        <div className="pp-cal-box" data-layout={box.layout} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          {card}
        </div>
      ) : null}
      {showNotice ? (
        <div className="pp-cal-notice" role="alert" data-testid="calib-insecure" style={{ left: box.x, top: box.y, width: box.w, maxHeight: box.h }}>
          <strong>{t('calibration.insecure.title')}</strong>
          <span>{t('calibration.insecure.body', { origin: pageOrigin() })}</span>
          <button type="button" className="pp-btn small soft" onClick={notice.dismiss} data-testid="calib-notice-close">
            {t('calibration.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

/** Card shell: the visual (ring / icon) above (stack) or beside (row) a text column. */
function Card({ kind, box, visual, role, children }: { kind: string; box: CalibrationBox; visual: ReactNode; role?: string; children: ReactNode }) {
  return (
    <div className="pp-cal-card" data-kind={kind} data-layout={box.layout} data-testid={`calib-card-${kind}`} role={role}>
      <div className="pp-cal-visual">{visual}</div>
      <div className="pp-cal-text">{children}</div>
    </div>
  );
}

function CountdownCard({ cal, trackerState, box, onCancel }: { cal: CalibrationStatus; trackerState: TrackerState; box: CalibrationBox; onCancel: () => void }) {
  const t = useT();
  const waiting = cal.phase === 'countdown' && cal.detail === WAITING_CAMERA;
  const capturing = cal.phase === 'capturing';
  const face: 'found' | 'searching' | 'none' = trackerState === 'tracking' ? 'found' : trackerState === 'searching' || trackerState === 'lost' ? 'searching' : 'none';
  const ring = box.ring;
  const r = 44;
  const c = 2 * Math.PI * r;
  const visual = (
    <div className="pp-cal-ring" style={{ width: ring, height: ring }} data-capturing={capturing} data-waiting={waiting}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="track" cx="50" cy="50" r={r} />
        {/* Re-keyed every second so the ring drains once per count. */}
        <circle
          key={capturing ? 'capture' : waiting ? 'wait' : cal.remaining}
          className={capturing ? 'arc capture' : waiting ? 'arc wait' : 'arc'}
          cx="50"
          cy="50"
          r={r}
          style={{ strokeDasharray: c, ['--c' as string]: c } as CSSProperties}
        />
      </svg>
      <span className="pp-cal-number" key={`n${cal.remaining}${capturing}`} data-testid="calib-number">
        {capturing ? <EyeIcon size={ring * 0.34} /> : waiting ? '…' : cal.remaining}
      </span>
    </div>
  );
  return (
    <Card kind="countdown" box={box} visual={visual}>
      <p className="pp-cal-title" role="status" aria-live="polite">
        {waiting ? t('calibration.waitingCamera') : capturing ? t('calibration.capturing') : t('calibration.title')}
      </p>
      <p className="pp-cal-face" data-face={face} data-testid="calib-face">
        <i className="dot" />
        {face === 'found' ? t('calibration.face.found') : face === 'searching' ? t('calibration.face.searching') : t('calibration.face.none')}
      </p>
      <div className="pp-cal-actions">
        <button type="button" className="pp-btn small soft" onClick={onCancel} data-testid="calib-cancel">
          {t('calibration.cancel')}
        </button>
      </div>
    </Card>
  );
}

function TickIcon({ size }: { size: number }) {
  return (
    <svg className="pp-cal-icon tick" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" />
      <path d="M29 52 L44 66 L72 36" />
    </svg>
  );
}

function CrossIcon({ size }: { size: number }) {
  return (
    <svg className="pp-cal-icon cross" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" />
      <path d="M35 35 L65 65 M65 35 L35 65" />
    </svg>
  );
}

function RotateIcon({ size }: { size: number }) {
  return (
    <svg className="pp-cal-icon rotate" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="32" y="18" width="36" height="64" rx="7" />
      <path d="M16 56 A34 34 0 0 1 30 24 M30 24 L22 24 M30 24 L30 32" />
    </svg>
  );
}

function EyeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="pp-cal-eye">
      <path d="M8 50 Q50 10 92 50 Q50 90 8 50 Z" />
      <circle cx="50" cy="50" r="15" />
    </svg>
  );
}

/* ------------------------------------------------------------------ placement */

export interface CalibrationBox {
  /** Region the card is centred in (CSS pixels); always inside the interactive safe zone. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** stack: ring above the text (tall regions); row: ring beside the text (short, wide regions such as a landscape phone). */
  layout: 'stack' | 'row';
  /** Diameter of the countdown ring, px. */
  ring: number;
  /** Base text size, px. */
  font: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shortest region above the control panel that still takes the compact row card, px. */
const MIN_ROW_HEIGHT = 96;

/**
 * Where the calibration card goes: inside the interactive safe zone (86" portrait: the band
 * 25 %–75 % of the screen height), below the title bar when that bar lies in the zone, and above
 * the control panel. A tall region gets the big stacked card (ring above the text); a short one
 * (landscape phone) a compact row card (ring beside the text). Only when even that does not fit
 * above the panel does the card share the zone with it (the panel stays usable: only the card's
 * buttons take pointer input). Ring and text scale with the region.
 */
export function calibrationBox(layout: HudLayout): CalibrationBox {
  const { vw, safeTop, safeBottom, topBar, panel, unit } = layout;
  const zoneH = Math.max(0, safeBottom - safeTop);
  const gap = Math.max(8, 14 * unit);
  const margin = Math.max(layout.marginX, 8);
  let top = safeTop;
  const barBottom = topBar.y + topBar.h;
  if (barBottom > top && topBar.y < safeBottom && safeBottom - barBottom > zoneH * 0.5) top = barBottom;
  let bottom = safeBottom;
  if (panel.y > top && panel.y < bottom) bottom = panel.y;
  top += gap;
  bottom -= gap;
  let h = bottom - top;
  const stackMin = Math.min(zoneH * 0.9, Math.max(180, 300 * unit));
  let mode: CalibrationBox['layout'] = 'stack';
  if (h < stackMin) {
    if (h >= MIN_ROW_HEIGHT) {
      mode = 'row';
    } else {
      // No room above the panel: use the whole interactive zone.
      top = safeTop + Math.min(gap, zoneH * 0.05);
      bottom = safeBottom - Math.min(gap, zoneH * 0.05);
      h = bottom - top;
      mode = h >= stackMin ? 'stack' : 'row';
    }
  }
  h = Math.max(0, h);
  if (mode === 'row') {
    const font = clamp(h * 0.12 * layout.fontScale, 13, 24);
    const ring = clamp(h - 2 * font, 48, 220);
    const w = Math.max(0, Math.min(vw - 2 * margin, ring + font * 24));
    return { x: (vw - w) / 2, y: top, w, h, layout: mode, ring, font };
  }
  const w = Math.max(0, Math.min(vw - 2 * margin, Math.max(280, h * 1.25, 640 * unit)));
  const ring = clamp(Math.min(h / 1.9, w * 0.42), 64, 440);
  const font = clamp(ring * 0.085 * layout.fontScale, 13, 42);
  return { x: (vw - w) / 2, y: top, w, h, layout: mode, ring, font };
}

function pageOrigin(): string {
  try {
    return typeof location !== 'undefined' ? location.origin : '';
  } catch {
    return '';
  }
}

/* --------------------------------------------------------- insecure notice */

const NOTICE_MS = 30000;

/** A clear one-off notice when the camera cannot be used because the page is not HTTPS / localhost. */
function useInsecureNotice(enabled: boolean, state: TrackerState): { shown: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(false);
  const insecure = enabled && state === 'insecure';
  useEffect(() => {
    if (!insecure || dismissed) return;
    const timer = setTimeout(() => setDismissed(true), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [insecure, dismissed]);
  // A new attempt that ends insecure again shows it again.
  useEffect(() => {
    if (!insecure) setDismissed(false);
  }, [insecure]);
  return { shown: insecure && !dismissed, dismiss: () => setDismissed(true) };
}

/* ---------------------------------------------------- calibration coordinator */

type CalibratingTracker = App['tracker'] & Partial<Pick<FaceTracker, 'onCalibration' | 'setActiveProfile'>>;

/**
 * Wires the countdown calibration into the running game (pure policy: tracking/autoCalibration.ts):
 *  - automatic countdown once per camera start when camera.autoCalibrate is on, only while the round
 *    is READY / ATTRACT (or a demo), no dialog is open and the page is visible;
 *  - persists a captured baseline for the active display preset (eye position in
 *    profiles.<id>.view, head direction in camera.headBaseline.<id>);
 *  - tells the tracker which display preset is active (selects its head-direction baseline).
 */
export function useCalibrationCoordinator(app: App): AutoCalibrationPolicy {
  const policyRef = useRef<AutoCalibrationPolicy | null>(null);
  if (!policyRef.current) policyRef.current = new AutoCalibrationPolicy();
  useEffect(() => {
    const policy = policyRef.current!;
    const tracker = app.tracker as CalibratingTracker;
    let disposed = false;

    const evaluate = () => {
      if (disposed) return;
      const ui = app.ui.getState();
      const settings = app.settings.getState().view();
      const status = tracker.status();
      const action = policy.update({
        nowMs: performance.now(),
        enabled: settings.camera.enabled && !app.launch.noCamera,
        autoCalibrate: settings.camera.autoCalibrate,
        trackerState: status.state,
        calibration: status.calibration ?? IDLE_CALIBRATION,
        roundIdle: ui.phase === 'READY' || ui.phase === 'ATTRACT' || ui.demo,
        modalOpen: ui.modal !== null,
        visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
      });
      if (action === 'start') tracker.startCalibration(settings.camera.calibrationSeconds);
      else if (action === 'cancel' || action === 'dismiss') tracker.cancelCalibration();
    };
    // Store / tracker notifications are batched into one evaluation (never re-entrant).
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        evaluate();
      });
    };

    let profile = app.ui.getState().profile;
    tracker.setActiveProfile?.(profile);
    const offUi = app.ui.subscribe((state, prev) => {
      if (state.profile !== profile) {
        profile = state.profile;
        tracker.setActiveProfile?.(profile);
      }
      if (state.phase !== prev.phase || state.modal !== prev.modal || state.demo !== prev.demo) schedule();
    });
    const offTracker = tracker.subscribe(schedule);
    const offSettings = app.settings.subscribe(schedule);
    const offCalibration = tracker.onCalibration?.((event: CalibrationEvent) => {
      // The quick calibration / re-centre values are stored by the application (bootstrap); the
      // countdown baseline adds the head direction, stored here for the same display preset.
      if (event.kind !== 'baseline') return;
      const store = app.settings.getState();
      for (const [path, value] of baselineWrites(app.ui.getState().profile, event.values)) store.set(path, value);
    });
    const timer = setInterval(evaluate, 250);
    const onVisibility = () => schedule();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      disposed = true;
      offUi();
      offTracker();
      offSettings();
      offCalibration?.();
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [app]);
  return policyRef.current;
}
