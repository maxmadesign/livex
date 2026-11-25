import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RankEntryUi } from '../../app/gameStore';
import type { HudLayout } from '../../layout/solve';
import { cardBounds } from '../../rewards/cardLayout';
import { useApp, useLang, useT } from '../context';
import { IconArrow } from '../Icons';
import { formatPoints } from '../ScoreHud';
import { cycleLetter, normaliseInitials, secondsUntil } from './view';
import './machines.css';

/**
 * Three initials for a top-10 run (docs/design/machines.md, section 3.3): three big letter tiles
 * with ▲ / ▼ under touch-sized buttons, OK, and a countdown (after it the director saves "???").
 * Keyboard and arcade joystick (wired as arrow keys): ▲ ▼ change the letter, ◀ ▶ move between
 * tiles, letters type directly, Enter confirms. The blocklist is the director's: a refused set of
 * letters keeps the entry open.
 */
export function InitialsEntry({ layout, entry }: { layout: HudLayout; entry: RankEntryUi }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const [letters, setLetters] = useState<string[]>(['A', 'A', 'A']);
  const [slot, setSlot] = useState(0);
  const [refused, setRefused] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const state = useRef({ letters, slot });
  state.current = { letters, slot };
  const submit = () => {
    const initials = normaliseInitials(state.current.letters);
    if (app.game.submitInitials(initials)) app.audio.playSfx('collect_unlock');
    else {
      app.audio.playSfx('ui_error');
      setRefused((n) => n + 1);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const change = (i: number, steps: number) => {
    setLetters((ls) => ls.map((l, j) => (j === i ? cycleLetter(l, steps) : l)));
    setSlot(i);
    app.audio.playSfx('dir_tick', { volume: 0.6 });
  };
  const changeRef = useRef(change);
  changeRef.current = change;
  // Keys win over the game's own (Enter would otherwise press PLAY AGAIN under the card).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const { slot: s } = state.current;
      let handled = true;
      if (e.code === 'ArrowUp' || (e.code === 'KeyW' && !e.shiftKey)) changeRef.current(s, 1);
      else if (e.code === 'ArrowDown' || (e.code === 'KeyS' && !e.shiftKey)) changeRef.current(s, -1);
      else if (e.code === 'ArrowLeft' || (e.code === 'KeyA' && !e.shiftKey) || e.code === 'Backspace') setSlot(Math.max(0, s - 1));
      else if (e.code === 'ArrowRight' || (e.code === 'KeyD' && !e.shiftKey)) setSlot(Math.min(2, s + 1));
      else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('button')) handled = false;
        else if (!e.repeat) submitRef.current();
      } else if (/^Key[A-Z]$/.test(e.code) && (e.shiftKey || !/^Key[WASD]$/.test(e.code))) {
        // A letter types itself (W A S D steer like the arrows, as on the cabinet; Shift types them).
        const ch = e.code.slice(3);
        setLetters((ls) => ls.map((l, j) => (j === s ? ch : l)));
        setSlot(Math.min(2, s + 1));
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const swallow = (e: KeyboardEvent) => {
      if (/^(Arrow|Key[WASD]$)/.test(e.code)) e.stopImmediatePropagation();
    };
    window.addEventListener('keyup', swallow, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
    };
  }, []);
  const u = layout.unit;
  const bounds = cardBounds(layout);
  const phone = layout.controls !== null;
  const btn = Math.max(layout.touchMin, Math.min(layout.touch * 0.72, 112 * u));
  const w = Math.min(bounds.w, Math.max(btn * 3 + 2 * 14 * u + btn * 2.4 + 80 * u, phone ? 0 : 640 * u));
  // Centred in the area the win card may use (the safe zone minus the controls).
  const wrap = { left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h } as CSSProperties;
  const style = { width: w, maxHeight: bounds.h, '--btn': `${btn}px` } as CSSProperties;
  const seconds = secondsUntil(entry.deadline, now);
  return (
    <div className="pp-initials-wrap" style={wrap}>
    <div className="pp-initials" style={style} role="dialog" aria-label={t('machines.rank.title')} data-testid="initials-entry" data-position={entry.position}>
      <header>
        <h2>{t('machines.rank.title')}</h2>
        <p className="place">
          <b data-testid="initials-place">{t('machines.rank.place', { n: entry.position })}</b>
          <span>{formatPoints(entry.score, lang)}</span>
        </p>
        <p className="prompt">{t('machines.rank.enter')}</p>
      </header>
      <div className="row">
        <div className="slots" key={refused} data-refused={refused > 0}>
          {letters.map((l, i) => (
            <div key={i} className="slot" data-active={i === slot}>
              <button type="button" className="pp-btn small soft" onClick={() => change(i, 1)} aria-label={`${t('machines.rank.slot', { n: i + 1 })}: ${t('machines.rank.up')}`} data-testid={`initials-up-${i}`}>
                <IconArrow dir="up" />
              </button>
              <button type="button" className="tile" onClick={() => setSlot(i)} aria-label={t('machines.rank.slot', { n: i + 1 })} data-testid={`initials-slot-${i}`}>
                {l}
              </button>
              <button type="button" className="pp-btn small soft" onClick={() => change(i, -1)} aria-label={`${t('machines.rank.slot', { n: i + 1 })}: ${t('machines.rank.down')}`} data-testid={`initials-down-${i}`}>
                <IconArrow dir="down" />
              </button>
            </div>
          ))}
        </div>
        <div className="side">
          <button type="button" className="pp-btn accent ok" onClick={() => submit()} data-testid="initials-ok">
            {t('machines.rank.ok')}
          </button>
          <span className="secs" data-testid="initials-seconds">
            {t('machines.rank.seconds', { s: seconds })}
          </span>
        </div>
      </div>
      {phone ? null : <p className="keys">{t('machines.rank.keys')}</p>}
    </div>
    </div>
  );
}
