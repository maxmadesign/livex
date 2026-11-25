import { useEffect, useState } from 'react';
import type { HudLayout } from '../../layout/solve';
import { useUi } from '../context';
import { InitialsEntry } from './InitialsEntry';
import { SessionHud } from './SessionHud';
import { SessionResultCard } from './SessionResultCard';
import { TryToast } from './TryToast';
import { useMachineDeck } from './useMachineDeck';
import './machines.css';

/**
 * Everything the machines add over the 3D view (src/ui/App.tsx mounts it after the score): the
 * session HUD, the try toast, and at the end of a session either the initials entry (a top-10 run)
 * or the session card. It lives in its own `.pp-hud` layer so the win card styles apply to the
 * session card too.
 */
export function MachineLayer({ layout }: { layout: HudLayout }) {
  const machine = useUi((s) => s.machine);
  const card = useUi((s) => s.sessionResult);
  const entry = useUi((s) => s.rankEntry);
  const modal = useUi((s) => s.modal);
  const themeBusy = useUi((s) => s.themeBusy);
  const deck = useMachineDeck();
  const newBest = useSessionNewBest();
  if (machine.id === 'classic' && !card && !entry) return null;
  const covered = modal !== null || themeBusy;
  return (
    <div className="pp-hud pp-machines-layer" data-testid="machines-layer">
      <SessionHud layout={layout} />
      <TryToast layout={layout} />
      {entry && !covered ? <InitialsEntry key={`${entry.machineId}-${entry.deadline}`} layout={layout} entry={entry} /> : null}
      {card && !entry && !covered ? <SessionResultCard layout={layout} card={card} newBest={newBest} lobby={deck.lobby} /> : null}
    </div>
  );
}

/**
 * True once a try of the running session lifted the best session score on this machine (the
 * session card's NEW BEST ribbon). Starts over with every session and every machine.
 */
function useSessionNewBest(): boolean {
  const last = useUi((s) => s.score.last);
  const machineId = useUi((s) => s.machine.id);
  const tries = useUi((s) => s.machine.session.tries);
  const sessionState = useUi((s) => s.machine.session.state);
  const [best, setBest] = useState(false);
  useEffect(() => {
    if (tries === 0 && sessionState !== 'over') setBest(false);
  }, [tries, sessionState, machineId]);
  useEffect(() => setBest(false), [machineId]);
  useEffect(() => {
    if (last && !last.demo && last.newBest && last.total > 0) setBest(true);
  }, [last]);
  return best;
}
