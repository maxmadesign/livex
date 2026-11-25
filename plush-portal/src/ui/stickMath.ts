/**
 * Maths of the on-screen arcade joystick (src/ui/Joystick.tsx). Pure functions, no DOM.
 *
 * Screen coordinates: x to the right, y down (pointer offsets from the centre of the stick's base).
 * Game coordinates: x to the right, z toward the player. Pushing the stick "up" on the screen (away
 * from the player on a real cabinet deck) moves the claw to the back of the machine (z −1), as the
 * old ▲ button did.
 *
 * Like a real arcade lever the stick has an 8-way gate: inside the dead zone nothing moves, outside
 * it the push snaps to one of eight directions (four straight, four diagonal). A little hysteresis
 * keeps a thumb resting on a sector border from flickering between two gates.
 */

/** The eight gates: the left / right part first, then back (away from the player) / front. */
export type StickGate = 'right' | 'right_back' | 'back' | 'left_back' | 'left' | 'left_front' | 'front' | 'right_front';

/** Gates counter-clockwise from "right", 45° apart (screen up = back). Index × 45° = the gate's angle. */
export const GATES: readonly StickGate[] = ['right', 'right_back', 'back', 'left_back', 'left', 'left_front', 'front', 'right_front'];

export const STICK = {
  /** A push engages a gate beyond this fraction of the radius (about a quarter, like a real lever's play). */
  deadZone: 0.25,
  /** Once engaged, the gate holds until the push falls under this fraction (hysteresis, no chatter). */
  releaseZone: 0.2,
  /** The current gate holds until the push is this many degrees past its sector edge. */
  sectorHold: 6,
  /** Largest lever tilt drawn on screen, in degrees. */
  maxTilt: 26,
} as const;

export interface StickOptions {
  deadZone: number;
  releaseZone: number;
  sectorHold: number;
}

/** Game input of a gate: x right +1 / left −1, z front (toward the player) +1 / back −1; null = centred. */
export function gateVector(gate: StickGate | null): { x: number; z: number } {
  if (!gate) return { x: 0, z: 0 };
  const x = gate.startsWith('right') ? 1 : gate.startsWith('left') ? -1 : 0;
  const z = gate.endsWith('front') ? 1 : gate.endsWith('back') ? -1 : 0;
  return { x, z };
}

/** The gate of a game input vector (signs only; opposite inputs cancel to 0). Null when centred. */
export function gateFromVector(x: number, z: number): StickGate | null {
  const sx = Math.sign(x);
  const sz = Math.sign(z);
  if (sx === 0 && sz === 0) return null;
  const h = sx > 0 ? 'right' : sx < 0 ? 'left' : '';
  const v = sz > 0 ? 'front' : sz < 0 ? 'back' : '';
  return (h && v ? `${h}_${v}` : h || v) as StickGate;
}

/** Angle of a gate in degrees, counter-clockwise from "right" with screen up = +90°. */
export function gateAngle(gate: StickGate): number {
  return GATES.indexOf(gate) * 45;
}

/**
 * Limits a pointer offset (CSS px from the base's centre, y down) to the stick's travel `radius`.
 * Returns the knob offset in px and the normalised push (nx, ny in −1..1, `push` = length 0..1).
 */
export function clampToRadius(dx: number, dy: number, radius: number): { x: number; y: number; nx: number; ny: number; push: number } {
  const r = Math.max(1e-6, radius);
  const len = Math.hypot(dx, dy);
  const k = len > r ? r / len : 1;
  const x = dx * k;
  const y = dy * k;
  return { x, y, nx: x / r, ny: y / r, push: Math.min(1, len / r) };
}

/** Smallest absolute difference between two angles in degrees (0..180). */
function angleGap(a: number, b: number): number {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

/**
 * The gate for a normalised push (nx, ny: screen axes, y down, length ≤ 1), or null inside the dead
 * zone. `previous` is the gate engaged so far: it keeps holding through the release zone and a few
 * degrees past its sector edges, so small wobbles of a thumb never chatter between gates.
 */
export function gateOf(nx: number, ny: number, previous: StickGate | null = null, options: StickOptions = STICK): StickGate | null {
  const push = Math.hypot(nx, ny);
  if (!Number.isFinite(push)) return null;
  if (previous ? push < options.releaseZone : push < options.deadZone) return null;
  // Math angle with screen up positive (y points down on screen).
  const angle = (Math.atan2(-ny, nx) * 180) / Math.PI;
  if (previous && angleGap(angle, gateAngle(previous)) <= 22.5 + options.sectorHold) return previous;
  const index = ((Math.round(angle / 45) % 8) + 8) % 8;
  return GATES[index]!;
}

/**
 * Lever tilt for a normalised push: rotations about the screen axes in degrees, for CSS
 * `rotateX(tiltX) rotateY(tiltY)`. Pushing right tips the ball right (positive rotateY), pushing up
 * tips it away from the viewer and up the screen (positive rotateX).
 */
export function leverTilt(nx: number, ny: number, maxTilt: number = STICK.maxTilt): { tiltX: number; tiltY: number } {
  const len = Math.hypot(nx, ny);
  const k = len > 1 ? 1 / len : 1;
  return { tiltX: -ny * k * maxTilt, tiltY: nx * k * maxTilt };
}
