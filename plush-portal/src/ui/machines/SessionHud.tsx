import type { CSSProperties } from 'react';
import type { HudLayout } from '../../layout/solve';
import { useLang, useSettings, useT, useUi } from '../context';
import { formatPoints, scoreHudRect } from '../ScoreHud';
import { TIME_LOW_SECONDS, formatClock, progressSegments, sessionHudRect, showSessionHud } from './view';
import './machines.css';

/**
 * The session panel of a machine other than classic (docs/design/machines.md, section 4.1), under
 * the score (beside the control panel on 86"):
 *   - Tippy Bridge: the try on this box, a five-segment progress meter, "Stuck? Call staff";
 *   - Tumble Shelf: tries left, boxes so far with a meter up to the prize, the session points;
 *   - Sparkle Rush: a large m:ss timer that turns urgent in the last ten seconds, the run score and
 *     the gems, and before the first move "the clock starts on your first move";
 *   - today's bonus (×1.5) whenever this machine is today's pick.
 * Information only: nothing here is a button (the deck has Call staff).
 */
export function SessionHud({ layout }: { layout: HudLayout }) {
  const t = useT();
  const lang = useLang();
  const machine = useUi((s) => s.machine);
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const sessionCard = useUi((s) => s.sessionResult !== null || s.rankEntry !== null);
  const rewardItems = useSettings((s) => s.machines.shelf.rewardItems);
  const runSeconds = useSettings((s) => s.machines.rush.seconds);
  // The session card (or the initials entry) takes over at the end of a session.
  if (!showSessionHud(machine, phase, demo) || sessionCard) return null;
  const r = sessionHudRect(layout, scoreHudRect(layout));
  const s = machine.session;
  const genre = machine.genre;
  const low = s.kind === 'timed' && s.state === 'running' && s.secondsLeft !== null && s.secondsLeft <= TIME_LOW_SECONDS;
  const style = { left: r.x, top: r.y, width: r.w, minHeight: r.h } as CSSProperties;
  const bonus =
    machine.bonus > 1 ? (
      <span className="bonus" data-testid="session-bonus">
        {t('machines.hud.bonus', { mult: machine.bonus })}
      </span>
    ) : null;
  let body = null;
  if (genre === 'bridge') {
    const n = Number(machine.plate.params?.n ?? s.tries + 1);
    body = (
      <>
        <div className="cell head">
          <b className="big">{t('machines.hud.try', { n })}</b>
          {bonus}
        </div>
        <div className="cell grow">
          <small>{t('machines.hud.progress')}</small>
          <span className="meter" data-testid="bridge-progress" data-progress={(machine.progress ?? 0).toFixed(2)}>
            {progressSegments(machine.progress).map((f, i) => (
              <i key={i} style={{ '--f': f } as CSSProperties} />
            ))}
          </span>
        </div>
        {machine.staff.highlighted ? (
          <div className="cell stuck" data-testid="session-stuck">
            {t('machines.hud.stuck')}
          </div>
        ) : null}
      </>
    );
  } else if (genre === 'shelf') {
    const total = s.triesTotal ?? 0;
    const left = Math.max(0, total - s.tries);
    const earned = s.items >= rewardItems;
    body = (
      <>
        <div className="cell head">
          <b className="big" data-testid="session-tries">
            {t('machines.hud.tries', { left, total })}
          </b>
          {bonus}
        </div>
        <div className="cell grow">
          <small>
            {t('machines.hud.boxes')} <b data-testid="session-items">{s.items}</b>
          </small>
          <span className="dots" data-earned={earned}>
            {Array.from({ length: Math.min(rewardItems, 12) }, (_, i) => (
              <i key={i} data-on={i < s.items} />
            ))}
          </span>
          <small className="goal">{earned ? t('machines.hud.prizeWon') : t('machines.hud.prizeAt', { n: rewardItems })}</small>
        </div>
        <div className="cell">
          <small>{t('machines.hud.points')}</small>
          <b className="num">{formatPoints(s.points, lang)}</b>
        </div>
      </>
    );
  } else if (genre === 'rush') {
    const seconds = s.secondsLeft ?? runSeconds;
    const waiting = s.state !== 'over' && seconds >= runSeconds && s.tries === 0;
    body = (
      <>
        <div className="cell head">
          <b className="clock" data-low={low} data-testid="session-clock" aria-label={`${t('machines.hud.time')} ${formatClock(seconds)}`}>
            {formatClock(seconds)}
          </b>
          {bonus}
        </div>
        <div className="cell">
          <small>{t('machines.hud.points')}</small>
          <b className="num">{formatPoints(s.points, lang)}</b>
        </div>
        <div className="cell">
          <small>{t('machines.hud.gems')}</small>
          <b className="num" data-testid="session-items">
            {s.items}
          </b>
        </div>
        {waiting ? <div className="cell hint">{t('machines.hud.clock')}</div> : null}
      </>
    );
  }
  return (
    <div
      className="pp-session"
      data-genre={genre}
      data-place={r.place}
      data-low={low}
      data-over={s.state === 'over'}
      data-tries={s.tries}
      data-items={s.items}
      data-points={s.points}
      data-seconds={s.secondsLeft ?? ''}
      style={style}
      data-testid="session-hud"
      aria-live="off"
    >
      {body}
    </div>
  );
}
