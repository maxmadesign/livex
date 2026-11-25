import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MachineCardInfo } from '../../app/gameStore';
import type { HudLayout } from '../../layout/solve';
import { IconArrow } from '../Icons';
import { Modal } from '../Modal';
import { useApp, useCollection, useSettings, useT, useUi } from '../context';
import { useModals } from '../modals';
import { useReducedMotion } from '../useHudLayout';
import { MachineCard } from './MachineCard';
import { ensureMachinePreviews } from './previews';
import { cardsAcross, initialCardIndex, lobbyFlow, wrapIndex } from './view';
import './machines.css';

/**
 * The machine lobby ("Which machine today?", docs/design/machines.md, section 4.1): a carousel of
 * machine cards inside the dialog frame of every layout (the 86" band, the 32" zone, the simulated
 * 9:16 screen, the phone's safe area). Wide screens scroll sideways with snap points (three cards on
 * a desktop, about two on a phone); tall screens list the cards. ◀ ▶ (and the arrow keys) move the
 * focus, Enter or PLAY picks the focused machine (Game.selectMachine), Esc or ✕ closes.
 */
export function LobbyDialog({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const { close } = useModals();
  const reduced = useReducedMotion();
  const machine = useUi((s) => s.machine);
  const themeId = useUi((s) => s.themeId);
  const wins = useCollection((s) => s.wins);
  const machines = useSettings((s) => s.machines);
  const cards: MachineCardInfo[] = useMemo(() => app.game.machineCards(), [app, machine, wins, machines]);
  // Rendered pictures of the machines in this theme (made once per theme; the SVG art until then).
  useEffect(() => {
    ensureMachinePreviews(themeId, [...new Set(cards.map((c) => c.genre))]);
  }, [themeId, cards]);
  const flow = lobbyFlow(layout);
  const [focus, setFocus] = useState(() => initialCardIndex(cards));
  const track = useRef<HTMLDivElement>(null);
  const n = cards.length;
  const index = Math.min(focus, Math.max(0, n - 1));
  // The row's own scroll (to the focused card) is not a swipe: until it reaches its target (or the
  // player touches the row) its scroll events must not move the focus. They did: the first frames of
  // the smooth scroll towards a card at either end of the row (which can never sit in the middle)
  // handed the focus to its neighbour, so ◀ ▶ could not reach Plush Classic or Sparkle Rush, the lobby
  // opened on the wrong card, and Enter played the neighbour.
  const ownTarget = useRef<number | null>(null);
  // A focus change that came from a swipe: the finger moves the row, the dialog does not scroll it.
  const fromSwipe = useRef(false);
  // Scroll the track itself (never the page) so the focused card is in view, centred on the row.
  const scrollTo = useCallback(
    (i: number, smooth: boolean) => {
      const el = track.current;
      const card = el?.children[i] as HTMLElement | undefined;
      if (!el || !card) return;
      const behavior: ScrollBehavior = smooth && !reduced ? 'smooth' : 'auto';
      if (flow === 'row') {
        const left = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
        const target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, left));
        ownTarget.current = Math.abs(el.scrollLeft - target) > 1 ? target : null;
        el.scrollTo({ left, behavior });
      } else el.scrollTo({ top: card.offsetTop - (el.clientHeight - card.offsetHeight) / 2, behavior });
    },
    [flow, reduced],
  );
  const first = useRef(true);
  useEffect(() => {
    if (fromSwipe.current) fromSwipe.current = false;
    else scrollTo(index, !first.current);
    first.current = false;
  }, [index, scrollTo]);
  const move = useCallback((step: number) => setFocus((i) => wrapIndex(i + step, n)), [n]);
  const pick = useCallback(
    (card: MachineCardInfo | undefined) => {
      if (!card || card.locked) {
        app.audio.playSfx('ui_error');
        return;
      }
      app.audio.playSfx('ui_click');
      // The director closes the dialog and switches behind the curtain (or right away to READY).
      if (!app.game.selectMachine(card.id)) app.audio.playSfx('ui_error');
    },
    [app],
  );
  // Keys while the lobby is open (the game's own keys are off while a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const prev = e.code === 'ArrowLeft' || e.code === 'KeyA' || (flow === 'column' && (e.code === 'ArrowUp' || e.code === 'KeyW'));
      const next = e.code === 'ArrowRight' || e.code === 'KeyD' || (flow === 'column' && (e.code === 'ArrowDown' || e.code === 'KeyS'));
      if (prev || next) {
        e.preventDefault();
        move(prev ? -1 : 1);
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        // A focused button (PLAY, ◀ ▶, ✕) answers Enter / Space itself.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('button, a[href], input, select, textarea')) return;
        e.preventDefault();
        if (!e.repeat) pick(cards[index]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, move, pick, cards, index]);
  // A swipe moves the row: the card nearest the middle becomes the focused one.
  const frame = useRef(0);
  const onScroll = () => {
    const target = ownTarget.current;
    if (target !== null) {
      // The row's own scroll, however slow its frames: done once it is there.
      if (track.current && Math.abs(track.current.scrollLeft - target) <= 2) ownTarget.current = null;
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current;
      if (!el || flow !== 'row') return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = index;
      let bestD = Infinity;
      Array.from(el.children).forEach((c, i) => {
        const card = c as HTMLElement;
        const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best !== index) {
        fromSwipe.current = true;
        setFocus(best);
      }
    });
  };
  // The player takes the row over (a swipe, the wheel): its scroll events are theirs again.
  const takeOver = () => {
    ownTarget.current = null;
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const across = cardsAcross(layout, n);
  const style = { '--across': across } as CSSProperties;
  const navSize = Math.max(layout.touchMin, layout.touch * 0.62);
  return (
    <Modal
      layout={layout}
      title={t('machines.lobby.title')}
      onClose={() => close()}
      closeLabel={t('common.close')}
      size={flow === 'row' ? 1 : 0.96}
      testId="lobby"
      footer={
        <div className="pp-lobby-nav" data-testid="lobby-nav">
          <button type="button" className="pp-btn round small soft" style={{ width: navSize, height: navSize }} onClick={() => move(-1)} aria-label={t('machines.lobby.prev')} data-testid="lobby-prev">
            <IconArrow dir={flow === 'row' ? 'left' : 'up'} />
          </button>
          <span className="dots" aria-live="polite" data-testid="lobby-position">
            {cards.map((c, i) => (
              <i key={c.id} data-on={i === index} data-pick={c.dailyPick} />
            ))}
            <span className="sr">{t('machines.lobby.position', { i: index + 1, n })}</span>
          </span>
          <button type="button" className="pp-btn round small soft" style={{ width: navSize, height: navSize }} onClick={() => move(1)} aria-label={t('machines.lobby.next')} data-testid="lobby-next">
            <IconArrow dir={flow === 'row' ? 'right' : 'down'} />
          </button>
          {layout.controls ? null : <span className="note keys">{t('machines.lobby.keys')}</span>}
        </div>
      }
    >
      <div className="pp-lobby" data-flow={flow} style={style}>
        <p className="pp-lobby-sub">{t('machines.lobby.subtitle')}</p>
        <div className="pp-lobby-track" ref={track} onScroll={onScroll} onPointerDown={takeOver} onWheel={takeOver} data-testid="lobby-track">
          {cards.map((card, i) => (
            <MachineCard key={card.id} card={card} themeId={themeId} machines={machines} focused={i === index} flow={flow} onFocus={() => setFocus(i)} onPlay={() => pick(card)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
