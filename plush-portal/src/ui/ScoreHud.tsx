import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ScorePopup } from '../app/gameStore';
import type { Lang } from '../core/types';
import type { ScoreAward } from '../game/scoring';
import type { HudLayout, Rect } from '../layout/solve';
import { overlaps } from '../rewards/cardLayout';
import { useApp, useLang, useT, useUi } from './context';
import { useWinCard } from './RewardCard';
import { useReducedMotion } from './useHudLayout';

/** Size of a win popup in design units (.pp-score-pop in game.css) and how far it rises. */
const POPUP = { w: 280, h: 150, rise: 170 } as const;

/**
 * Score display of the points system: the session score with a rolling counter, the combo
 * badge, the best session score and the floating "+250" popups at the prize's position.
 * Shown only when Settings → Gameplay → Points (gameplay.scoring) is on. In attract mode it
 * shows the demo's show score, clearly labelled; nothing of it is counted.
 * Styles: src/ui/game.css. Strings: src/i18n/strings/score.ts.
 */

export interface ScoreHudRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** top: centred in the top bar row; belowTop: centred under it; side: beside the control panel; abovePanel: on top of it. */
  place: 'top' | 'belowTop' | 'side' | 'abovePanel';
}

/**
 * Where the score sits on each preset. Where the top bar is inside the safe zone (desktop,
 * phone, 32") it sits with the top bar, otherwise (86") next to the control panel inside the
 * central band. Never over the middle of the play field.
 */
export function scoreHudRect(layout: HudLayout): ScoreHudRect {
  const u = layout.unit;
  const b = layout.topBar;
  const topOk = b.y >= layout.safeTop - 1 && b.y + b.h <= layout.safeBottom + 1;
  if (topOk) {
    const w = 360 * u;
    const h = 92 * u;
    // Wide screens have room between the logo (about 340 units) and the chips and the "i" button
    // (about 360 units); narrow ones put it just below the bar.
    const free = b.w - 700 * u;
    if (free >= w + 30 * u) return { x: (layout.vw - w) / 2, y: b.y + (b.h - h) / 2, w, h, place: 'top' };
    return { x: (layout.vw - w) / 2, y: b.y + b.h + 8 * u, w, h, place: 'belowTop' };
  }
  const p = layout.panel;
  const gap = 12 * u;
  const room = (layout.vw - p.w) / 2 - layout.marginX - gap;
  if (room >= 190 * u) {
    const w = Math.min(room, 300 * u);
    const h = Math.min(p.h, 250 * u);
    const x = layout.handed === 'left' ? p.x - gap - w : p.x + p.w + gap;
    return { x, y: p.y + (p.h - h) / 2, w, h, place: 'side' };
  }
  const w = Math.min(p.w * 0.7, 360 * u);
  const h = 92 * u;
  return { x: (layout.vw - w) / 2, y: Math.max(layout.safeTop + 4, p.y - h - gap), w, h, place: 'abovePanel' };
}

export function formatPoints(value: number, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : 'en-US').format(Math.round(value));
  } catch {
    return String(Math.round(value));
  }
}

/** Counts up (or down) to `target` over a short ease-out; jumps straight there with reduced motion. */
function useRollingNumber(target: number, reduced: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const shownRef = useRef(target);
  useEffect(() => {
    // Counting up is the show; a reset to a lower value (new session) is immediate.
    if (reduced || target <= shownRef.current) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    from.current = shownRef.current;
    const start = performance.now();
    const span = Math.min(1400, 450 + Math.abs(target - from.current) * 0.6);
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / span);
      const eased = 1 - Math.pow(1 - k, 3);
      const value = Math.round(from.current + (target - from.current) * eased);
      shownRef.current = value;
      setShown(value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return shown;
}

/** Points breakdown on the win card (src/ui/Hud.tsx): base, first catch, clean grab, combo, total. */
export function ScoreBreakdown({ award }: { award: ScoreAward }) {
  const t = useT();
  const lang = useLang();
  const tier = award.tier ?? 'common';
  const rows: { key: string; label: string; note?: string; points: number }[] = [
    {
      key: 'base',
      label: t('score.row.base', { tier: t(`score.tier.${tier}`) }),
      note: award.difficultyMultiplier !== 1 ? t('score.row.difficulty', { mult: award.difficultyMultiplier }) : undefined,
      points: award.basePoints,
    },
  ];
  if (award.firstCatch > 0) rows.push({ key: 'first', label: t('score.row.firstCatch'), points: award.firstCatch });
  if (award.cleanGrab > 0) rows.push({ key: 'clean', label: t('score.row.cleanGrab'), points: award.cleanGrab });
  if (award.comboMultiplier > 1) rows.push({ key: 'combo', label: t('score.row.combo', { mult: award.comboMultiplier }), points: award.comboBonus });
  return (
    <div className="pp-breakdown" data-tier={tier} data-testid="score-breakdown">
      <span className="pp-tier" data-tier={tier}>
        {t(`score.tier.${tier}`)}
      </span>
      <dl>
        {rows.map((r) => (
          <div key={r.key} data-row={r.key}>
            <dt>
              {r.label}
              {r.note ? <small> · {r.note}</small> : null}
            </dt>
            <dd>+{formatPoints(r.points, lang)}</dd>
          </div>
        ))}
        <div data-row="total" className="total">
          <dt>{t('score.row.total')}</dt>
          <dd data-testid="score-total">+{formatPoints(award.total, lang)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** One-line points summary for the phone's win card next to a claim code: tier and total. */
export function ScoreLine({ award }: { award: ScoreAward }) {
  const t = useT();
  const lang = useLang();
  const tier = award.tier ?? 'common';
  return (
    <p className="pp-points-line" data-tier={tier} data-testid="score-line">
      <span className="pp-tier" data-tier={tier}>
        {t(`score.tier.${tier}`)}
      </span>
      <b data-testid="score-total">+{formatPoints(award.total, lang)}</b>
    </p>
  );
}

/** Popup box around its anchor (bottom centre), the rise included, in CSS px. */
export function popupBox(x: number, y: number, unit: number): Rect {
  const w = POPUP.w * unit;
  const h = (POPUP.h + POPUP.rise) * unit;
  return { x: x - w / 2, y: y - h, w, h };
}

/**
 * Where a win popup goes so it never covers the win card that appears a moment later: unchanged
 * when it is clear of the card, else beside the card (the side nearer to the prize exit), else
 * just above it; null when there is no room at all (it is then not shown while the card is up).
 */
export function placePopup(at: { x: number; y: number }, card: Rect | null, layout: Pick<HudLayout, 'vw' | 'vh' | 'unit' | 'marginX' | 'safeTop'>): { x: number; y: number } | null {
  const u = layout.unit;
  if (!card) return { x: at.x, y: at.y };
  const pad = 10;
  const grown = { x: card.x - pad, y: card.y - pad, w: card.w + 2 * pad, h: card.h + 2 * pad };
  if (!overlaps(popupBox(at.x, at.y, u), grown)) return { x: at.x, y: at.y };
  const halfW = (POPUP.w * u) / 2;
  const fullH = (POPUP.h + POPUP.rise) * u;
  const y = Math.min(Math.max(at.y, layout.safeTop + fullH), layout.vh);
  const leftX = card.x - pad - halfW;
  const rightX = card.x + card.w + pad + halfW;
  const leftOk = leftX - halfW >= layout.marginX;
  const rightOk = rightX + halfW <= layout.vw - layout.marginX;
  const preferLeft = at.x < card.x + card.w / 2;
  if (leftOk && (preferLeft || !rightOk)) return { x: leftX, y };
  if (rightOk) return { x: rightX, y };
  // No room beside it: just above the card, rising away from it.
  const aboveY = card.y - pad;
  if (aboveY - fullH >= Math.max(0, layout.safeTop - 4)) return { x: Math.min(Math.max(at.x, layout.marginX + halfW), layout.vw - layout.marginX - halfW), y: aboveY };
  return null;
}

function Popup({ popup, unit, at }: { popup: ScorePopup; unit: number; at: { x: number; y: number } | null }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    // Removed on a timer (not on animationend) so it also goes away with reduced motion.
    const timer = setTimeout(() => app.game.dismissPopup(popup.id), 2100);
    return () => clearTimeout(timer);
  }, [app, popup.id]);
  // No room clear of the win card: the popup is skipped (the card shows the same points).
  const style = { left: at?.x ?? popup.x, top: at?.y ?? popup.y, '--u': `${unit}px`, ...(at ? {} : { visibility: 'hidden' }) } as CSSProperties;
  const moved = at !== null && (Math.abs(at.x - popup.x) > 0.5 || Math.abs(at.y - popup.y) > 0.5);
  return (
    <div className="pp-score-pop" data-kind={popup.kind} data-tier={popup.tier ?? 'none'} data-demo={popup.demo} data-moved={moved} data-skipped={at === null} style={style} data-testid="score-popup" aria-hidden="true">
      {popup.demo ? <span className="tag">{t('score.demo')}</span> : null}
      <b>+{formatPoints(popup.points, lang)}</b>
      {popup.kind === 'win' && popup.tier ? <span className="tier">{t(`score.tier.${popup.tier}`)}</span> : <span className="tier">{t('score.popup.slip')}</span>}
      {popup.multiplier > 1 ? <span className="combo">×{popup.multiplier}</span> : null}
    </div>
  );
}

/** A popup at its place clear of the win card, fixed when it appears (it never jumps mid-rise). */
function PlacedPopup({ popup, layout, card }: { popup: ScorePopup; layout: HudLayout; card: Rect | null }) {
  const [at] = useState(() => placePopup(popup, card, layout));
  return <Popup popup={popup} unit={layout.unit} at={at} />;
}

export function ScoreHud({ layout }: { layout: HudLayout }) {
  const t = useT();
  const lang = useLang();
  const reduced = useReducedMotion();
  const score = useUi((s) => s.score);
  const popups = useUi((s) => s.scorePopups);
  const shown = useRollingNumber(score.session, reduced);
  // The win card on screen, or the one about to appear (a win popup starts at the prize exit,
  // a moment before the card): popups and the score keep clear of it.
  const coming = useWinCard(layout, true);
  const showing = useWinCard(layout);
  const [bump, setBump] = useState(0);
  const lastSession = useRef(score.session);
  useEffect(() => {
    if (score.session > lastSession.current) setBump((n) => n + 1);
    lastSession.current = score.session;
  }, [score.session]);
  if (!score.enabled) return null;
  const r = scoreHudRect(layout);
  const multiplier = score.streak >= 2 ? (score.streak >= 4 ? 3 : score.streak === 3 ? 2 : 1.5) : 1;
  const stacked = r.place === 'side';
  // On short screens the win card can reach up to the score: the card (which shows the points) wins.
  const hidden = showing ? overlaps(showing.geometry, { x: r.x, y: r.y, w: r.w, h: r.h }) : false;
  return (
    <>
      <div
        className="pp-score"
        data-place={r.place}
        data-demo={score.demo}
        data-hidden={hidden}
        data-stacked={stacked}
        data-testid="score-hud"
        style={{ left: r.x, top: r.y, width: r.w, minHeight: r.h }}
        aria-live="polite"
      >
        <div className="main">
          <span className="label">
            {t('score.label')}
            {score.demo ? <span className="tag" data-testid="score-demo">{t('score.demo')}</span> : null}
          </span>
          {/* The rolling number is for the eyes; the live region announces only the final score. */}
          <b className="value" key={bump} data-testid="score-value" data-value={score.session} aria-hidden="true">
            {formatPoints(shown, lang)}
          </b>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{formatPoints(score.session, lang)}</span>
        </div>
        {multiplier > 1 ? (
          <span className="pp-combo" data-level={multiplier >= 3 ? 3 : multiplier >= 2 ? 2 : 1} data-testid="score-combo" title={t('score.combo')}>
            <i className="flame" aria-hidden="true" />
            <span>×{multiplier}</span>
          </span>
        ) : null}
        {!score.demo ? (
          <span className="best" data-testid="score-best">
            {t('score.best')} {formatPoints(score.best, lang)}
          </span>
        ) : null}
      </div>
      {popups.map((p) => (
        <PlacedPopup key={p.id} popup={p} layout={layout} card={p.kind === 'win' && !p.demo && coming ? coming.geometry : null} />
      ))}
    </>
  );
}
