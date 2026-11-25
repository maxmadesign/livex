import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { SteerInput } from '../app/Game';
import { useApp, useT } from './context';
import { GATES, clampToRadius, gateFromVector, gateOf, gateVector, type StickGate } from './stickMath';
import './joystick.css';

/**
 * Pointer travel for a full push, as a fraction of the stick's width. Pressing anywhere on the base
 * counts: a press near the rim is a full push at once, a press on the ball starts centred.
 */
const TRAVEL = 0.26;
/** How far the ball leans when the keyboard steers (the stick mirrors the keys while nobody holds it). */
const KEY_PUSH = 0.82;

/** Discs stacked along the lever (a cylinder in CSS 3D) and the rings of the rubber dust boot. */
const SHAFT = [0, 1, 2, 3, 4, 5];
const BOOT = [0, 1, 2, 3];

/**
 * Lamps in the metal ring, in plate coordinates (viewBox 0 0 100 100), outside the ball's reach: the
 * four arrows light for the straight part of the gate, a dot between two arrows for a diagonal.
 */
const ARROWS: { g: StickGate; d: string }[] = [
  { g: 'back', d: 'M50 4.2 l4.2 4.6 h-8.4 z' },
  { g: 'right', d: 'M95.8 50 l-4.6 4.2 v-8.4 z' },
  { g: 'front', d: 'M50 95.8 l4.2 -4.6 h-8.4 z' },
  { g: 'left', d: 'M4.2 50 l4.6 4.2 v-8.4 z' },
];
const DIAGONALS = GATES.filter((g) => g.includes('_')).map((g) => {
  const a = (GATES.indexOf(g) * Math.PI) / 4;
  return { g, x: 50 + Math.cos(a) * 44.6, y: 50 - Math.sin(a) * 44.6 };
});

/** Octagonal restrictor under the lever: its eight corners are the eight gates. */
const OCTAGON = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return `${(50 + Math.cos(a) * 28).toFixed(2)},${(50 - Math.sin(a) * 28).toFixed(2)}`;
}).join(' ');

/**
 * Arcade joystick (ball-top lever) that replaces the four direction buttons. Press anywhere on its
 * base and drag: the ball follows the finger up to the travel radius and the lever tilts toward the
 * push in 3D (joystick.css); on release it springs back with a short overshoot. The push is read
 * through an 8-way gate with a dead zone (src/ui/stickMath.ts) and steers the claw through
 * Game.setStick. Every new gate clicks (the dir_press sound, played by the game) and, on a touch
 * screen, gives a short vibration.
 *
 * Release is robust, as it was for the old buttons: pointer up / cancel, lost capture, the last
 * finger leaving the screen, a window blur, the page being hidden, the stick becoming disabled or
 * disappearing, and the game clearing its input (a dialog opening) all centre the stick. The claw
 * never keeps moving on its own.
 *
 * Test hooks: data-testid="stick" (the base, drag target), "stick-knob" (the ball), data-gate =
 * the gate shown ("none" | "right" | "left_back" | ...), data-held while a pointer holds it.
 */
export function Joystick({ disabled }: { disabled: boolean }) {
  const app = useApp();
  const t = useT();
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const gateRef = useRef<StickGate | null>(null);
  const [held, setHeld] = useState(false);
  const [gate, setGate] = useState<StickGate | null>(null);
  const [source, setSource] = useState<'hand' | 'keys' | 'rest'>('rest');

  /** Moves the drawn lever (normalised push, screen axes). No React render per pointer move. */
  const draw = (nx: number, ny: number) => {
    const el = base.current;
    if (!el) return;
    el.style.setProperty('--nx', nx.toFixed(4));
    el.style.setProperty('--ny', ny.toFixed(4));
    el.style.setProperty('--p', Math.min(1, Math.hypot(nx, ny)).toFixed(4));
  };

  const engage = (next: StickGate | null, touch: boolean) => {
    if (next === gateRef.current) return;
    gateRef.current = next;
    setGate(next);
    const v = gateVector(next);
    app.game.setStick(v.x, v.z);
    // A short tick on each new gate, like a lever's microswitch (touch screens only).
    if (next && touch) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* vibration is best effort */
      }
    }
  };

  const release = () => {
    const id = pointer.current;
    pointer.current = null;
    setHeld(false);
    setSource('rest');
    draw(0, 0);
    engage(null, false);
    if (id !== null) {
      try {
        if (base.current?.hasPointerCapture(id)) base.current.releasePointerCapture(id);
      } catch {
        /* the pointer may already be gone */
      }
    }
  };

  const follow = (clientX: number, clientY: number, touch: boolean) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = clampToRadius(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), Math.max(8, r.width * TRAVEL));
    draw(k.nx, k.ny);
    engage(gateOf(k.nx, k.ny, gateRef.current), touch);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || pointer.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    setHeld(true);
    setSource('hand');
    follow(e.clientX, e.clientY, e.pointerType === 'touch');
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current !== e.pointerId) return;
    follow(e.clientX, e.clientY, e.pointerType === 'touch');
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current === e.pointerId) release();
  };

  // Releasing must also happen when the stick becomes disabled or disappears mid-push. (The cleanup
  // only stops the claw; when the stick stays mounted the effect body then releases the hold.)
  useEffect(() => {
    if (disabled && pointer.current !== null) release();
    return () => {
      if (pointer.current !== null) app.game.setStick(0, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Fallback while held: pointer capture can be refused or lost (finger slides off, system gesture,
  // app switch), so a release of this pointer anywhere, the last finger leaving the screen, a window
  // blur or the page being hidden also centres the stick.
  useEffect(() => {
    if (!held) return;
    const onPointerEnd = (e: PointerEvent) => {
      if (pointer.current === null || e.pointerId === pointer.current) release();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) release();
    };
    const onBlur = () => release();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', onTouchEnd, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchEnd, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  // The game's view of the input: the stick leans with the arrow keys while nobody holds it, and a
  // cleared input (a dialog opened, the window lost focus) drops a hold; it does not resume.
  useEffect(
    () =>
      app.game.onInput((input: SteerInput) => {
        if (input.cleared && pointer.current !== null) {
          release();
          return;
        }
        if (pointer.current !== null) return;
        const keys = input.source === 'keys' ? gateFromVector(input.x, input.z) : null;
        const v = gateVector(keys);
        const len = Math.hypot(v.x, v.z) || 1;
        draw((v.x / len) * KEY_PUSH, (v.z / len) * KEY_PUSH);
        gateRef.current = null;
        setGate(keys);
        setSource(keys ? 'keys' : 'rest');
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app],
  );

  return (
    <div
      ref={base}
      className="pp-stick"
      data-testid="stick"
      data-gate={gate ?? 'none'}
      data-held={held}
      data-source={source}
      role="application"
      aria-roledescription={t('hud.stick.role')}
      aria-label={t('hud.stick.label')}
      aria-disabled={disabled}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <i className="bezel" />
      <i className="face" />
      <svg className="plate" viewBox="0 0 100 100" aria-hidden="true">
        <polygon className="gate" points={OCTAGON} />
        <g className="lamps">
          {ARROWS.map((a) => (
            <path key={a.g} data-g={a.g} d={a.d} />
          ))}
          {DIAGONALS.map((l) => (
            <circle key={l.g} data-g={l.g} cx={l.x.toFixed(2)} cy={l.y.toFixed(2)} r="1.7" />
          ))}
        </g>
      </svg>
      <i className="shadow" />
      <span className="boot">
        {BOOT.map((i) => (
          <i key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
      <span className="lever">
        {SHAFT.map((i) => (
          <i key={i} className="shaft" style={{ '--i': i } as CSSProperties} />
        ))}
        <i className="collar" />
        <span className="ball" data-testid="stick-knob">
          <i className="gloss" />
        </span>
      </span>
    </div>
  );
}
