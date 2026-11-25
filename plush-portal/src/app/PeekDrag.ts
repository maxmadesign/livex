/**
 * Drag-to-peek. While no tracked face drives the view (camera off, denied, no face found, not
 * started yet), dragging on the 3D view moves the virtual eye a little, so the player can look
 * around inside the cabinet; on release the eye springs back to the reference viewpoint.
 *
 *  - Only a press that starts on the canvas itself counts: the HUD sits above the canvas, so a press
 *    on the joystick, a button or a dialog never reaches it, and its drags never peek.
 *  - It changes the viewpoint only (through the tracker's drag source, reported as the 'drag' view
 *    source). The claw, the physics and the round never see it.
 *  - The content behind the glass follows the finger: dragging right moves the eye right (the back
 *    of the machine slides right and the neighbour on the left comes into view), dragging up moves it up.
 *  - Limits: a full drag reaches 85 % of the preset's `view.maxOffset` (the same safe limits as head
 *    tracking), approached softly. Reduced motion: no inertia and a critically damped (no overshoot),
 *    quicker spring.
 *  - `camera.dragPeek` turns it off.
 *  - A one-time hint ("Drag to peek inside") appears near the bottom of the 3D window, just above the
 *    floor line, when a player round starts without a tracked face.
 *
 * The maths (`dragToPeek`, `peekToEye`, `stepSpring`, `PeekMotion`) is pure and unit tested.
 */
import type { TrackerPort } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { translate } from '../i18n';
import type { HudLayout } from '../layout/solve';
import type { SettingsStore } from '../settings/store';
import { THEMES } from '../themes/themes';
import { softClamp } from '../tracking/viewMapping';
import type { GameStore } from './gameStore';

/** A full peek takes a drag of this fraction of the view's shorter side. */
export const PEEK_RANGE = 0.42;
/** Share of the preset's `view.maxOffset` that a full peek reaches. */
export const PEEK_SHARE = 0.85;
/** Pointer travel (CSS px) before a press on the view becomes a drag (a tap never peeks). */
export const DRAG_SLOP = 6;
/** Release velocity kept as inertia, and its limit (normalised units per second). */
export const INERTIA = 0.5;
export const MAX_RELEASE_SPEED = 6;

export interface SpringParams {
  /** Natural angular frequency, rad/s. */
  omega: number;
  /** Damping ratio: < 1 overshoots a little, 1 = critically damped (no overshoot). */
  zeta: number;
}

/** Spring back to neutral: a slight overshoot (≈ 4 %), settled in about half a second. */
export const SPRING: SpringParams = { omega: 10, zeta: 0.7 };
/** Reduced motion: critically damped (never overshoots) and quicker. */
export const SPRING_REDUCED: SpringParams = { omega: 18, zeta: 1 };

/**
 * Pointer travel on the view (CSS px) → normalised peek, −1 … 1 per axis, softly limited (linear up
 * to 75 %, then easing towards the limit). +x = right, +y = up (screen y grows downwards).
 */
export function dragToPeek(dx: number, dy: number, viewW: number, viewH: number, out = { x: 0, y: 0 }): { x: number; y: number } {
  const range = Math.max(40, PEEK_RANGE * Math.min(viewW, viewH));
  // (+ 0 turns a negative zero into zero.)
  out.x = softClamp(dx / range, 1) + 0;
  out.y = softClamp(-dy / range, 1) + 0;
  return out;
}

/** Normalised peek → eye offset in metres (window space) for a preset's `view.maxOffset`. */
export function peekToEye(x: number, y: number, maxOffset: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = x * maxOffset[0] * PEEK_SHARE;
  out[1] = y * maxOffset[1] * PEEK_SHARE;
  out[2] = 0;
  return out;
}

/**
 * Advances a damped spring towards 0 by `dt` seconds with the exact solution of
 * x'' = −ω²x − 2ζωx', so the result does not depend on how the time is split into frames and a long
 * frame can never make it unstable. Returns [position, velocity].
 */
export function stepSpring(x: number, v: number, dt: number, p: SpringParams): [number, number] {
  if (!(dt > 0)) return [x, v];
  const w = Math.max(1e-3, p.omega);
  const z = Math.max(0, p.zeta);
  if (z >= 1) {
    // Critically damped (stronger damping is treated the same: it only gets slower).
    const e = Math.exp(-w * dt);
    const c = v + w * x;
    return [e * (x + c * dt), e * (v - w * c * dt)];
  }
  const a = z * w;
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-a * dt);
  const cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
  const b = (v + a * x) / wd;
  return [e * (x * cos + b * sin), e * (v * cos - ((a * v + w * w * x) / wd) * sin)];
}

/** Below these the peek counts as back at rest. */
const REST_X = 1e-4;
const REST_V = 1e-3;
/** Velocity is estimated over the last this-many seconds of the drag. */
const VELOCITY_WINDOW = 0.08;

/**
 * The normalised peek: follows the finger while held, then springs back (with a little of the
 * finger's speed as inertia unless motion is reduced).
 */
export class PeekMotion {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  private held = false;
  private readonly history: { t: number; x: number; y: number }[] = [];

  get holding(): boolean {
    return this.held;
  }

  /** True while held or not yet back at rest. */
  get active(): boolean {
    return this.held || Math.abs(this.x) > REST_X || Math.abs(this.y) > REST_X || Math.abs(this.vx) > REST_V || Math.abs(this.vy) > REST_V;
  }

  grab(): void {
    this.held = true;
    this.vx = this.vy = 0;
    this.history.length = 0;
  }

  /** Finger position as a normalised peek at time `t` (seconds). */
  drag(x: number, y: number, t: number): void {
    if (!this.held) return;
    this.x = x;
    this.y = y;
    this.history.push({ t, x, y });
    while (this.history.length > 2 && t - this.history[0]!.t > VELOCITY_WINDOW) this.history.shift();
  }

  /** Lets go at time `t` (seconds). */
  release(t: number, reduced: boolean): void {
    if (!this.held) return;
    this.held = false;
    this.vx = this.vy = 0;
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    this.history.length = 0;
    // No inertia with reduced motion, or when the finger rested before letting go.
    if (reduced || !first || !last || last.t - first.t < 0.01 || t - last.t > VELOCITY_WINDOW) return;
    const span = last.t - first.t;
    const clamp = (v: number) => Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, v));
    this.vx = clamp((last.x - first.x) / span) * INERTIA;
    this.vy = clamp((last.y - first.y) / span) * INERTIA;
  }

  /** Back to neutral at once (a tracked face took over the view). */
  cancel(): void {
    this.held = false;
    this.x = this.y = this.vx = this.vy = 0;
    this.history.length = 0;
  }

  step(dt: number, reduced: boolean): void {
    if (this.held || !this.active) return;
    const p = reduced ? SPRING_REDUCED : SPRING;
    [this.x, this.vx] = stepSpring(this.x, this.vx, dt, p);
    [this.y, this.vy] = stepSpring(this.y, this.vy, dt, p);
    if (Math.abs(this.x) < REST_X && Math.abs(this.y) < REST_X && Math.abs(this.vx) < REST_V && Math.abs(this.vy) < REST_V) this.x = this.y = this.vx = this.vy = 0;
  }
}

/* ------------------------------------------------------------------ DOM wiring */

export interface PeekDragDeps {
  /** The 3D view; only presses that start on it can peek. */
  canvas: HTMLCanvasElement;
  /** Needs the FaceTracker's `setDragSource`; with any other tracker drag-to-peek stays off. */
  tracker: TrackerPort;
  settings: SettingsStore;
  ui: GameStore;
  /** HUD geometry of the game's box (floor line, cabinet span), for the hint. */
  hud: () => HudLayout | null | undefined;
  reducedMotion: () => boolean;
}

type DragAware = TrackerPort & { setDragSource?: (source: ((nowMs: number, driven: boolean) => Readonly<Vec3> | null) | null) => void };

/** Where "the hint was shown" is remembered on personal devices (desktop, phone). */
const HINT_KEY = 'plush-portal/peek-hint-seen';
/**
 * The hint waits this long into a player round, then stays this long (ms), and for at least this
 * many rendered frames each (so a slow device still shows it long enough to be read).
 */
const HINT_DELAY_MS = 1200;
const HINT_SHOW_MS = 6500;
const HINT_DELAY_FRAMES = 10;
const HINT_SHOW_FRAMES = 150;
const KIOSK = new Set(['portrait32', 'portrait86']);

function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* storage unavailable: the hint may show again next time */
  }
}

/** A small hand-and-arrows mark for the hint (stroke follows the text colour). */
const HINT_ICON =
  '<svg viewBox="0 0 48 24" width="2.2em" height="1.1em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 6 3 12l6 6M39 6l6 6-6 6"/><circle cx="24" cy="12" r="5.2" fill="currentColor" stroke="none" opacity="0.85"/><path d="M14 12h4M30 12h4" opacity="0.6"/></svg>';

class PeekDrag {
  private readonly motion = new PeekMotion();
  private readonly offset: Vec3 = [0, 0, 0];
  private readonly scratch = { x: 0, y: 0 };
  private pointer: number | null = null;
  private dragging = false;
  /** A face took the view mid-drag: ignore this pointer until it lifts. */
  private suppressed = false;
  private startX = 0;
  private startY = 0;
  private lastNow = NaN;
  private hint: HTMLDivElement | null = null;
  private hintShown = false;
  private hintSince = NaN;
  private hintAt = NaN;
  /** Frames counted since the hint became wanted / since it was shown. */
  private hintFrames = 0;
  private hintSeen = readSeen();
  /** The player has peeked at least once (the hint is then not needed). */
  private peeked = false;
  private hintKey = '';
  private lastPhase = '';

  constructor(private readonly deps: PeekDragDeps) {}

  attach(): () => void {
    const { canvas } = this.deps;
    const tracker = this.deps.tracker as DragAware;
    if (typeof tracker.setDragSource !== 'function') return () => undefined;
    tracker.setDragSource(this.source);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    canvas.addEventListener('lostpointercapture', this.onUp);
    return () => {
      tracker.setDragSource?.(null);
      canvas.removeEventListener('pointerdown', this.onDown);
      window.removeEventListener('pointermove', this.onMove, true);
      window.removeEventListener('pointerup', this.onUp, true);
      window.removeEventListener('pointercancel', this.onUp, true);
      canvas.removeEventListener('lostpointercapture', this.onUp);
      this.hint?.remove();
      this.hint = null;
    };
  }

  private enabled(): boolean {
    return this.deps.settings.getState().view().camera.dragPeek !== false;
  }

  private onDown = (e: PointerEvent): void => {
    // Only the view itself: anything over it (HUD controls, dialogs) is a different element.
    if (e.target !== this.deps.canvas || this.pointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.enabled()) return;
    this.pointer = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.dragging = false;
    this.suppressed = false;
    try {
      this.deps.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture refused: the window listeners still follow this pointer */
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer || this.suppressed) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.dragging) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      this.dragging = true;
      this.peeked = true;
      this.motion.grab();
    }
    const canvas = this.deps.canvas;
    dragToPeek(dx, dy, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, this.scratch);
    this.motion.drag(this.scratch.x, this.scratch.y, e.timeStamp / 1000);
  };

  private onUp = (e: Event): void => {
    const id = (e as PointerEvent).pointerId;
    if (id !== this.pointer) return;
    this.pointer = null;
    if (this.dragging) this.motion.release(e.timeStamp / 1000, this.deps.reducedMotion());
    this.dragging = false;
    this.suppressed = false;
  };

  /** The tracker's drag source: called once per rendered frame. */
  private source = (nowMs: number, driven: boolean): Readonly<Vec3> | null => {
    const dt = Number.isFinite(this.lastNow) ? Math.min(0.25, Math.max(0, (nowMs - this.lastNow) / 1000)) : 0;
    this.lastNow = nowMs;
    this.tickHint(nowMs, driven);
    if (driven) {
      // A face (or the test viewpoint) drives the view: give it back at once.
      if (this.motion.active) this.motion.cancel();
      if (this.pointer !== null) this.suppressed = true;
      this.dragging = false;
      return null;
    }
    if (!this.enabled() && this.motion.holding) {
      this.motion.release(nowMs / 1000, true);
      this.suppressed = true;
    }
    this.motion.step(dt, this.deps.reducedMotion());
    if (!this.motion.active) return null;
    const ui = this.deps.ui.getState();
    const maxOffset = this.deps.settings.getState().view().profiles[ui.profile].view.maxOffset;
    return peekToEye(this.motion.x, this.motion.y, maxOffset, this.offset);
  };

  /* ---------------------------------------------------------------- hint */

  private tickHint(nowMs: number, driven: boolean): void {
    const ui = this.deps.ui.getState();
    // A kiosk greets every visitor: a new visit starts with attract mode.
    if (ui.phase !== this.lastPhase) {
      if (ui.phase === 'ATTRACT' && KIOSK.has(ui.profile) && !this.hintShown) {
        this.hintSeen = false;
        this.peeked = false;
      }
      this.lastPhase = ui.phase;
    }
    const want =
      !this.hintSeen &&
      !this.peeked &&
      !driven &&
      this.enabled() &&
      ui.boot.stage === 'ready' &&
      !ui.demo &&
      (ui.phase === 'READY' || ui.phase === 'AIMING') &&
      ui.modal === null &&
      ui.tracker.calibration.phase === 'idle';
    if (!this.hintShown) {
      if (!want) {
        this.hintSince = NaN;
        return;
      }
      if (!Number.isFinite(this.hintSince)) {
        this.hintSince = nowMs;
        this.hintFrames = 0;
      }
      if (++this.hintFrames >= HINT_DELAY_FRAMES && nowMs - this.hintSince >= HINT_DELAY_MS) this.showHint(nowMs);
      return;
    }
    if (want && (++this.hintFrames < HINT_SHOW_FRAMES || nowMs - this.hintAt < HINT_SHOW_MS)) {
      this.placeHint();
      return;
    }
    this.hideHint();
  }

  private showHint(nowMs: number): void {
    const el = this.ensureHint();
    if (!el) return;
    this.hintShown = true;
    this.hintAt = nowMs;
    this.hintFrames = 0;
    this.placeHint();
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -100%)';
  }

  private hideHint(): void {
    this.hintShown = false;
    this.hintSince = NaN;
    this.hintSeen = true;
    if (!KIOSK.has(this.deps.ui.getState().profile)) writeSeen();
    if (this.hint) {
      this.hint.style.opacity = '0';
      if (!this.deps.reducedMotion()) this.hint.style.transform = 'translate(-50%, calc(-100% + 8px))';
    }
  }

  private ensureHint(): HTMLDivElement | null {
    if (this.hint) return this.hint;
    const canvas = this.deps.canvas;
    if (!canvas.parentElement) return null;
    const el = document.createElement('div');
    el.className = 'pp-peek-hint';
    el.dataset.testid = 'peek-hint';
    el.setAttribute('role', 'status');
    // Inserted right after the canvas: above the 3D view, below every HUD layer and dialog.
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      top: '60%',
      transform: 'translate(-50%, calc(-100% + 8px))',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5em',
      padding: '0.42em 1.05em 0.42em 0.8em',
      borderRadius: '999px',
      fontFamily: 'var(--font-display)',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: '0',
      transition: this.deps.reducedMotion() ? 'opacity 200ms linear' : 'opacity 280ms ease, transform 280ms ease',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.22)',
    } satisfies Partial<CSSStyleDeclaration>);
    canvas.insertAdjacentElement('afterend', el);
    this.hint = el;
    return el;
  }

  /** Centred over the cabinet, just above the floor line (the bottom of the glass). */
  private placeHint(): void {
    const el = this.hint;
    const hud = this.deps.hud();
    if (!el || !hud) return;
    const ui = this.deps.ui.getState();
    const lang = this.deps.settings.getState().view().system.language;
    const theme = THEMES[ui.themeId].ui;
    const x = Math.round((hud.machine.left + hud.machine.right) / 2);
    const y = Math.round(hud.floorY * hud.vh - Math.max(10, hud.unit * 22));
    const size = Math.max(14, Math.round(hud.unit * 24 * hud.fontScale));
    const key = `${x}|${y}|${size}|${lang}|${ui.themeId}`;
    if (key === this.hintKey) return;
    this.hintKey = key;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.fontSize = `${size}px`;
    el.style.background = `color-mix(in srgb, ${theme.panel} 90%, transparent)`;
    el.style.color = theme.ink;
    el.innerHTML = HINT_ICON;
    const text = document.createElement('span');
    text.textContent = translate(lang, 'peek.hint');
    el.appendChild(text);
  }
}

/** Installs drag-to-peek on the game's canvas; returns the function that removes it again. */
export function attachPeekDrag(deps: PeekDragDeps): () => void {
  return new PeekDrag(deps).attach();
}
