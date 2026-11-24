import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { RewardUiState } from '../app/gameStore';
import { brandForTheme } from '../brand';
import type { HudLayout } from '../layout/solve';
import { portraitUnits, screenWidthMetres, subtitleLines, winCardGeometry, type RewardCardKind, type WinCardGeometry } from '../rewards/cardLayout';
import { formatCode, type RewardOptions } from '../rewards/protocol';
import { qrMatrix, qrPath } from '../rewards/qr';
import { useSettings, useT, useUi } from './context';
import './reward.css';

/**
 * The prize-claim part of the win card (src/ui/Hud.tsx ResultLayer): QR tile, instruction, the code
 * as XXXX-XXXX and a countdown ring; on phones a claim link instead of the QR; an honest note when
 * no code could be issued. Also the Settings → Rewards preview. Styles: src/ui/reward.css.
 */

/** What the reward block shows (the store's slice, or the settings preview). */
export interface RewardView {
  state: 'issuing' | 'ready' | 'demoBuild' | 'unavailable' | 'preview';
  /** What the QR encodes / the phone link opens; null = placeholder. */
  url: string | null;
  code: string | null;
  options: RewardOptions;
  /** Wall-clock ms when the QR hides (0 = no countdown). */
  visibleUntil: number;
  /** Full countdown length (ms) for the ring. */
  totalMs: number;
  reason: RewardUiState['reason'];
  /** Owner wording for the swag offer ('' = generic). */
  discountText: string;
}

/** The reward slice as a view for the card of `roundId`, or null when it belongs to no card. */
export function rewardViewFor(reward: RewardUiState, roundId: number, qrSeconds: number, discountText: string): RewardView | null {
  if (reward.state === 'idle' || reward.roundId !== roundId || roundId <= 0) return null;
  return {
    state: reward.state,
    url: reward.url,
    code: reward.code,
    options: reward.options,
    visibleUntil: reward.visibleUntil,
    totalMs: Math.max(1, qrSeconds) * 1000,
    reason: reward.reason,
    discountText,
  };
}

/** Card kind for a view: a QR tile (or its placeholder), the unavailable note, or nothing. */
export function cardKindFor(view: RewardView | null): RewardCardKind {
  if (!view) return 'none';
  return view.state === 'unavailable' ? 'note' : 'qr';
}

/** Inputs the win card geometry needs from the stores (shared by the card, the score and the preview). */
export function useCardEnvironment(layout: HudLayout): { screenWidthM: number | null } {
  const view = useSettings((s) => s.profiles[layout.profile].view);
  return useMemo(() => {
    const screenCss = typeof screen !== 'undefined' ? { w: screen.width, h: screen.height } : null;
    return { screenWidthM: screenWidthMetres(layout.profile, view, { vw: layout.vw, vh: layout.vh }, !!layout.frame?.simulated, screenCss) };
  }, [layout.profile, layout.vw, layout.vh, layout.frame?.simulated, view]);
}

export interface WinCardState {
  geometry: WinCardGeometry;
  view: RewardView | null;
}

/**
 * Geometry of the win card that is (or is about to be) on screen: the result card of a real win,
 * with the reward block of its round. `expected` also answers before the result exists (the score
 * popups step aside as soon as the prize passes the exit). Null when no card is shown.
 */
export function useWinCard(layout: HudLayout, expected = false): WinCardState | null {
  const phase = useUi((s) => s.phase);
  const result = useUi((s) => s.result);
  const reward = useUi((s) => s.reward);
  const scoreEnabled = useUi((s) => s.score.enabled);
  const last = useUi((s) => s.score.last);
  const prize = useUi((s) => s.prize);
  const qrSeconds = useSettings((s) => s.rewards.qrSeconds);
  const discountText = useSettings((s) => s.rewards.discountText);
  const env = useCardEnvironment(layout);
  const showing = phase === 'RESULT' && !!result && result.outcome === 'won' && !result.demo;
  return useMemo(() => {
    if (!showing && !expected) return null;
    const roundId = showing ? result!.roundId : reward.roundId;
    const award = scoreEnabled && last && last.roundId === roundId && !last.demo ? last : null;
    const view = rewardViewFor(reward, roundId, qrSeconds, discountText);
    const kind = cardKindFor(view);
    const rows = award ? 2 + (award.firstCatch > 0 ? 1 : 0) + (award.cleanGrab > 0 ? 1 : 0) + (award.comboMultiplier > 1 ? 1 : 0) : 4;
    const geometry = winCardGeometry(layout, {
      withPoints: showing ? !!award : scoreEnabled,
      pointRows: rows,
      countLine: showing && !!prize && prize.count > 1,
      kind,
      label: view?.state === 'demoBuild' || view?.state === 'preview',
      ribbon: !!award?.newBest,
      screenWidthM: env.screenWidthM,
    });
    return { geometry, view };
  }, [showing, expected, result, reward, scoreEnabled, last, prize, qrSeconds, discountText, env.screenWidthM, layout]);
}

/** Inline SVG QR code: dark modules on a white tile (quiet zone included), crisp at any size. */
export function QrCode({ text, size }: { text: string; size: number }) {
  const matrix = qrMatrix(text);
  const path = useMemo(() => qrPath(matrix), [matrix]);
  return (
    <svg
      className="pp-qr"
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      data-testid="reward-qr"
      data-modules={matrix.size}
      data-url={text}
    >
      <rect width={matrix.size} height={matrix.size} fill="#FFFFFF" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/** Seconds left until `until` (wall clock), re-rendered once a second. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until > 0 ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Countdown ring: how long the QR stays on screen. */
function CountdownRing({ until, totalMs }: { until: number; totalMs: number }) {
  const t = useT();
  const left = useSecondsLeft(until);
  const total = Math.max(1, Math.round(totalMs / 1000));
  // Before the card has its time (issuing in the settings preview), the ring is full.
  const shown = until > 0 ? left : total;
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, shown / total));
  return (
    <span className="pp-ring" role="timer" aria-label={t('reward.ring', { seconds: shown })} data-testid="reward-ring" data-seconds={shown}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r={r} />
        <circle className="left" cx="18" cy="18" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 18 18)" />
      </svg>
      <b aria-hidden="true">{shown}</b>
    </span>
  );
}

/** The instruction for the offers this code unlocks. */
export function instructionKey(options: RewardOptions, discountText: string, phone: boolean): { key: string; params?: Record<string, string> } {
  const discount = discountText.trim();
  const base = phone ? 'reward.instr.phone' : 'reward.instr';
  if (options === 'prize') return { key: `${base}.prize` };
  if (discount) return { key: `${base}.${options}.custom`, params: { discount } };
  return { key: `${base}.${options}` };
}

/** DEMO / PREVIEW label (nothing for a real code). */
export function RewardLabel({ state }: { state: RewardView['state'] }) {
  const t = useT();
  if (state !== 'demoBuild' && state !== 'preview') return null;
  return (
    <span className="pp-reward-label" data-testid={state === 'demoBuild' ? 'reward-demo-label' : 'reward-preview-label'}>
      {t(state === 'demoBuild' ? 'reward.demoLabel' : 'reward.previewLabel')}
    </span>
  );
}

function CodeRow({ view }: { view: RewardView }) {
  const t = useT();
  const code = view.code ? formatCode(view.code) : view.state === 'preview' ? 'XXXX-XXXX' : '····-····';
  return (
    <div className="pp-reward-code">
      <span className="code" data-testid="reward-code" aria-label={t('reward.codeLabel')} data-pending={!view.code}>
        {code}
      </span>
      <CountdownRing until={view.visibleUntil} totalMs={view.totalMs} />
    </div>
  );
}

/** The QR tile, or its placeholder (code on its way / nothing to encode in the preview). */
function Tile({ view, size }: { view: RewardView; size: number }) {
  const t = useT();
  if (view.url && view.state !== 'issuing') {
    return (
      <div className="pp-reward-tile" style={{ width: size, height: size }}>
        <QrCode text={view.url} size={size} />
      </div>
    );
  }
  return (
    <div className="pp-reward-tile placeholder" style={{ width: size, height: size }} data-testid="reward-qr-pending" role="status" aria-label={t(view.state === 'issuing' ? 'reward.issuing' : 'reward.previewNoQr')}>
      {view.state === 'issuing' ? <i className="pp-spinner" aria-hidden="true" /> : <span>{t('reward.previewNoQr')}</span>}
    </div>
  );
}

/** Text instruction under the name (all arrangements except the phone). */
export function RewardInstruction({ view }: { view: RewardView }) {
  const t = useT();
  if (view.state === 'unavailable') return null;
  const { key, params } = view.state === 'issuing' ? { key: 'reward.issuing', params: undefined } : instructionKey(view.options, view.discountText, false);
  return (
    <p className="pp-reward-instr" data-testid="reward-instruction">
      {t(key, params)}
    </p>
  );
}

/**
 * The reward block. `part`: 'all' = label, tile, instruction and code (column arrangement);
 * 'tile' = tile and code (the side column; label and instruction sit in the left column);
 * 'link' = the phone's code and claim link; 'note' = unavailable.
 */
export function RewardBlock({ view, geometry, part }: { view: RewardView; geometry: WinCardGeometry; part: 'all' | 'tile' | 'link' | 'note' }): ReactElement | null {
  const t = useT();
  if (part === 'note' || view.state === 'unavailable') {
    return (
      <p className="pp-reward-note" data-testid="reward-unavailable" data-reason={view.reason ?? ''} role="status">
        {t('reward.unavailable')}
      </p>
    );
  }
  if (part === 'link') {
    const ready = !!view.url && view.state !== 'issuing';
    const instr = instructionKey(view.options, view.discountText, true);
    return (
      <div className="pp-reward" data-part="link" data-state={view.state} data-testid="reward-block">
        <RewardLabel state={view.state} />
        <CodeRow view={view} />
        {ready ? (
          <a className="pp-btn small accent pp-reward-link" href={view.url!} target="_blank" rel="noopener noreferrer" data-testid="reward-link" title={t(instr.key, instr.params)}>
            {t('reward.openClaim')}
          </a>
        ) : (
          <span className="pp-btn small soft pp-reward-link" aria-disabled="true" data-testid="reward-link-pending">
            <i className="pp-spinner" aria-hidden="true" />
            {t('reward.issuingShort')}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="pp-reward" data-part={part} data-state={view.state} data-testid="reward-block">
      {part === 'all' ? <RewardLabel state={view.state} /> : null}
      <Tile view={view} size={geometry.qrPx} />
      {part === 'all' ? <RewardInstruction view={view} /> : null}
      <CodeRow view={view} />
    </div>
  );
}

/** Card colours of a theme dressed by a brand kit: its own palette (logos are never recoloured). */
export function brandCardStyle(themeId: Parameters<typeof brandForTheme>[0]): CSSProperties {
  const kit = brandForTheme(themeId);
  if (!kit) return {};
  const p = kit.palette;
  return { '--rw-accent': p.green, '--rw-accent-deep': p.greenDeep, '--rw-ink': p.white, '--rw-muted': p.gray300, '--rw-chip': p.gray900 } as CSSProperties;
}

export interface WinCardProps {
  layout: HudLayout;
  geometry: WinCardGeometry;
  view: RewardView | null;
  themeId: Parameters<typeof brandForTheme>[0];
  title: string;
  subtitle: string;
  /** Portrait image (data URL), if rendered yet. */
  thumb: string | null;
  thumbAlt: string;
  /** "NEW!" badge text for a first catch, or null. */
  newLabel: string | null;
  /** "You now have N" line, or null. */
  countLine: string | null;
  /** Points breakdown (or its compact line on phones), or null. */
  points: ReactNode;
  ribbon: ReactNode;
  /** The PLAY AGAIN / collection buttons (null in the preview). */
  actions: ReactNode;
  /** Points of the award, for tests. */
  dataPoints?: number;
  testId?: string;
}

/**
 * The whole win card in one of three arrangements (src/rewards/cardLayout.ts): column (everything
 * stacked), side (QR column beside the usual card) and phone (picture beside the text, claim link).
 * Box size and placement come from the geometry; reward.css lays out the inside to the same model.
 */
export function WinCard(p: WinCardProps) {
  const g = p.geometry;
  const k = p.layout.unit * g.scale;
  const withPoints = p.points !== null && p.points !== undefined && p.points !== false;
  const portrait = portraitUnits(g.arrangement, withPoints, g.kind) * k;
  const view = p.view;
  const part: 'all' | 'tile' | 'link' | 'note' = g.kind === 'note' ? 'note' : g.kind === 'link' ? 'link' : g.arrangement === 'side' ? 'tile' : 'all';
  const reward = view ? <RewardBlock view={view} geometry={g} part={part} /> : null;
  const portraitEl = (
    <div className="portrait" style={{ width: portrait, height: portrait }}>
      {p.thumb ? <img src={p.thumb} alt={p.thumbAlt} /> : null}
      {p.newLabel ? <span className="pp-badge-new">{p.newLabel}</span> : null}
    </div>
  );
  const text = (
    <>
      {g.arrangement === 'side' && view ? <RewardLabel state={view.state} /> : null}
      <h2>{p.title}</h2>
      {g.arrangement === 'phone' ? null : portraitEl}
      {p.points}
      <p className="pp-subtitle" data-lines={subtitleLines(g.arrangement)}>
        {p.subtitle}
      </p>
      {p.countLine ? <p className="pp-count">{p.countLine}</p> : null}
      {g.arrangement === 'side' && view ? <RewardInstruction view={view} /> : null}
      {g.arrangement !== 'side' && reward && g.kind !== 'note' ? reward : null}
      {g.kind === 'note' && reward ? reward : null}
      {p.actions}
    </>
  );
  const style = {
    left: g.x,
    top: g.y,
    width: g.w,
    height: g.h,
    boxSizing: 'border-box',
    '--u': `${k}px`,
    ...brandCardStyle(p.themeId),
  } as CSSProperties;
  return (
    <div
      className="pp-result"
      data-testid={p.testId ?? 'result-win'}
      data-points={p.dataPoints}
      data-arrangement={g.arrangement}
      data-kind={g.kind}
      data-reward={view?.state ?? 'none'}
      data-qr-px={g.qrPx || undefined}
      data-brand={brandForTheme(p.themeId)?.id}
      role="status"
      style={style}
    >
      {p.ribbon}
      {g.arrangement === 'side' ? (
        <>
          <div className="pp-result-main">{text}</div>
          {reward}
        </>
      ) : g.arrangement === 'phone' ? (
        <>
          {portraitEl}
          <div className="pp-result-main">{text}</div>
        </>
      ) : (
        text
      )}
    </div>
  );
}
