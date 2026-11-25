import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SVGProps } from 'react';
import { useT } from '../context';
import type { MachineDeck } from './useMachineDeck';
import './machines.css';

/**
 * The machine buttons of the control deck (src/ui/Hud.tsx mounts them): MACHINES, Call staff, the
 * bridge's two-step buttons and the coin plate. Their state comes from useMachineDeck.
 */

type IconProps = SVGProps<SVGSVGElement>;
const svg = (p: IconProps, children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

/** Four little cabinets: the machine lobby. */
export const IconMachines = (p: IconProps) =>
  svg(
    p,
    <>
      <rect x="3" y="4" width="7.5" height="7" rx="1.6" />
      <rect x="13.5" y="4" width="7.5" height="7" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7" rx="1.6" fill="currentColor" stroke="none" />
    </>,
  );

/** A service bell: call staff. */
export const IconBell = (p: IconProps) =>
  svg(
    p,
    <>
      <path d="M4 17.5h16" />
      <path d="M5.5 17.5a6.5 6.5 0 0 1 13 0" fill="currentColor" stroke="none" />
      <path d="M12 7.2v-2M10 5.2h4" />
    </>,
  );

export const IconLock = (p: IconProps) =>
  svg(
    p,
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" stroke="none" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>,
  );

/** Square size in CSS px (top bar buttons), else the menu's own size. */
const sized = (size?: number) => (size ? { minWidth: size, minHeight: size, padding: 0 } : undefined);

/** MACHINES on the deck (`compact`: icon only, as the other compact menu buttons). */
export function LobbyDeckButton({ deck, compact, size }: { deck: MachineDeck; compact: boolean; size?: number }) {
  const t = useT();
  if (!deck.lobby.visible) return null;
  const label = t('machines.deck.machines');
  return (
    <button type="button" className="pp-btn small soft pp-deck-machines" style={sized(size)} onClick={deck.lobby.onPress} disabled={!deck.lobby.enabled} aria-label={label} title={label} data-testid="menu-machines">
      <IconMachines />
      {compact ? null : <span>{label}</span>}
    </button>
  );
}

/** "Call staff" on the bridge: it glows while the box is stuck. */
export function StaffDeckButton({ deck, compact, size }: { deck: MachineDeck; compact: boolean; size?: number }) {
  const t = useT();
  if (!deck.staff.visible) return null;
  const label = t('machines.deck.staff');
  return (
    <button
      type="button"
      className="pp-btn small soft pp-deck-staff"
      style={sized(size)}
      onClick={deck.staff.onPress}
      disabled={!deck.staff.enabled}
      data-highlighted={deck.staff.highlighted}
      aria-label={label}
      title={label}
      data-testid="menu-staff"
    >
      <IconBell />
      {compact ? null : <span>{label}</span>}
    </button>
  );
}

/** The coin plate beside the status line: FREE PLAY / TRY 3 / TRIES 2/5 / TIME 0:42. */
export function PlateChip({ deck }: { deck: MachineDeck }) {
  if (!deck.plate) return null;
  return (
    <span className="pp-plate" data-low={deck.plate.low} data-testid="machine-plate">
      {deck.plate.text}
    </span>
  );
}

/**
 * The bridge's two-step controls in the joystick's well: hold 1 to move right, then hold 2 to move
 * back, like the classic two-button crane. A button is released on pointer up / cancel, a lost
 * capture, a window blur and when the buttons are disabled or go away: the claw never keeps moving.
 */
export function TwoStepButtons({ deck, disabled }: { deck: MachineDeck; disabled: boolean }) {
  const t = useT();
  const [held, setHeld] = useState<1 | 2 | null>(null);
  const heldRef = useRef<1 | 2 | null>(null);
  const onStep = deck.onStep;
  const release = () => {
    const step = heldRef.current;
    if (step === null) return;
    heldRef.current = null;
    setHeld(null);
    onStep(step, false);
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    if (disabled) releaseRef.current();
  }, [disabled]);
  useEffect(() => {
    const blur = () => releaseRef.current();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      releaseRef.current();
    };
  }, []);
  const down = (step: 1 | 2) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (heldRef.current !== null && heldRef.current !== step) onStep(heldRef.current, false);
    heldRef.current = step;
    setHeld(step);
    onStep(step, true);
  };
  const button = (step: 1 | 2) => {
    const live = deck.axisStage === null || (step === 1 ? deck.axisStage === 'x' : deck.axisStage === 'z');
    return (
      <button
        type="button"
        className="pp-step"
        data-step={step}
        data-live={live}
        data-pressed={held === step}
        disabled={disabled}
        aria-label={t(step === 1 ? 'machines.deck.step1' : 'machines.deck.step2')}
        onPointerDown={down(step)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && heldRef.current === null && !disabled) {
            e.preventDefault();
            e.stopPropagation();
            heldRef.current = step;
            setHeld(step);
            onStep(step, true);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            release();
          }
        }}
        data-testid={`step-${step}`}
      >
        <b>{step}</b>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5 19.5 13h-4.6v6.5H9.1V13H4.5z" fill="currentColor" transform={step === 1 ? 'rotate(90 12 12)' : undefined} />
        </svg>
      </button>
    );
  };
  return (
    <div className="pp-steps2" data-testid="two-step" data-stage={deck.axisStage ?? 'both'}>
      {button(1)}
      {button(2)}
    </div>
  );
}
