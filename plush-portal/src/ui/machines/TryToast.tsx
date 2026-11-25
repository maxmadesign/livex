import { useEffect, useState } from 'react';
import type { MachineUiState } from '../../app/gameStore';
import type { HudLayout } from '../../layout/solve';
import { useLang, useT, useUi } from '../context';
import { formatPoints } from '../ScoreHud';
import { tryToastMs, tryToastView } from './view';
import './machines.css';

/**
 * The short card after each try on an items machine (shelf, rush): what dropped, the points and the
 * multi-drop / handful / today's-pick rows. It sits where the classic miss toast sits (the director
 * keeps `ui.result` null for these tries, so Hud's result card stays hidden) and goes away by itself.
 */
export function TryToast({ layout }: { layout: HudLayout }) {
  const t = useT();
  const lang = useLang();
  const machine = useUi((s) => s.machine);
  const last = useUi((s) => s.score.last);
  const scoring = useUi((s) => s.score.enabled);
  const demo = useUi((s) => s.demo);
  const sessionCard = useUi((s) => s.sessionResult !== null || s.rankEntry !== null);
  const phase = useUi((s) => s.phase);
  const roundId = useUi((s) => s.roundId);
  const [shown, setShown] = useState<NonNullable<MachineUiState['lastTry']> | null>(null);
  const [expired, setExpired] = useState(false);
  const lastTry = machine.presentation === 'items' ? machine.lastTry : null;
  useEffect(() => {
    setExpired(false);
    if (!lastTry) {
      setShown(null);
      return;
    }
    setShown(lastTry);
    const timer = setTimeout(() => setExpired(true), tryToastMs(machine.genre, lastTry.items > 0));
    return () => clearTimeout(timer);
    // A new try (round id) shows a new toast; the same try never re-opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTry?.roundId]);
  // It stays at least its time on screen, and as long as its try's result is up (a slow frame rate
  // or a long result hold never hides it early); then the next try has the stage.
  const holding = phase === 'RESULT' && roundId === shown?.roundId;
  if (!shown || (expired && !holding) || demo || sessionCard || machine.presentation !== 'items') return null;
  const view = tryToastView(machine.genre, shown, last);
  const zoneMid = (layout.safeTop + layout.safeBottom) / 2;
  const top = layout.panelStyle === 'bar' ? Math.max(layout.safeTop + 8, layout.panel.y - 110 * layout.unit) : zoneMid - 40 * layout.unit;
  return (
    <div className="pp-toast miss pp-try" key={shown.roundId} style={{ top }} role="status" data-scored={view.scored} data-items={shown.items} data-points={shown.points} data-testid="try-toast">
      <b className="head">{t(view.headline.key, view.headline.params)}</b>
      {view.scored && scoring ? <span className="pts">{t('machines.try.points', { points: formatPoints(view.points, lang) })}</span> : null}
      {view.extras.length > 0 && scoring ? (
        <small className="extras">
          {view.extras.map((x) => (
            <span key={x.key}>{t(x.key, x.params)}</span>
          ))}
        </small>
      ) : null}
    </div>
  );
}
