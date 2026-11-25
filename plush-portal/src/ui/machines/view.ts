/**
 * Pure view logic of the machine UI (docs/design/machines.md, sections 4.1, 4.8 and 4.11): number
 * formatting, the coin plate, the lobby cards' rule line and order, where the session HUD goes, the
 * try toast's rows and the initials entry. No React, no stores: unit tested in tests/unit/ui.
 */
import type { MachineCardInfo, MachineUiState, SessionResultUi } from '../../app/gameStore';
import type { GenreId, MachineId } from '../../game/machines/ids';
import type { ScoreAward } from '../../game/scoring';
import type { HudLayout, Rect } from '../../layout/solve';
import type { Settings } from '../../settings/spec';
import type { ScoreHudRect } from '../ScoreHud';

type Params = Record<string, string | number>;

/** The timer turns urgent (red, pulsing) at and below this many seconds (the time_low line comes at 10 s too). */
export const TIME_LOW_SECONDS = 10;

/** m:ss for a whole number of seconds (75 → "1:15", 9 → "0:09"); never negative. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** The coin plate's parameters for display: the time plate shows m:ss instead of plain seconds. */
export function plateParams(plate: MachineUiState['plate']): Params | undefined {
  if (!plate.params) return undefined;
  if (plate.key === 'machines.plate.time' && typeof plate.params.s === 'number') return { ...plate.params, s: formatClock(plate.params.s) };
  return plate.params;
}

/** The plate is urgent: a timed run in its last seconds. */
export function plateLow(machine: Pick<MachineUiState, 'session'>): boolean {
  const s = machine.session;
  return s.kind === 'timed' && s.state === 'running' && s.secondsLeft !== null && s.secondsLeft <= TIME_LOW_SECONDS;
}

/** The short rule line of a lobby card, from the committed settings (tries, boxes for a prize, seconds). */
export function ruleLine(genre: GenreId, machines: Settings['machines']): { key: string; params?: Params } {
  switch (genre) {
    case 'shelf':
      return { key: 'machines.rule.shelf', params: { tries: machines.shelf.tries, items: machines.shelf.rewardItems } };
    case 'rush':
      return { key: 'machines.rule.rush', params: { s: machines.rush.seconds } };
    case 'bridge':
      return { key: 'machines.rule.bridge' };
    default:
      return { key: 'machines.rule.classic' };
  }
}

/** Index i wrapped into 0..n-1 (the carousel wraps around at both ends). */
export function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return ((Math.round(i) % n) + n) % n;
}

/** The card the lobby starts on: the machine being played, else today's pick, else the first. */
export function initialCardIndex(cards: readonly Pick<MachineCardInfo, 'current' | 'dailyPick'>[]): number {
  const current = cards.findIndex((c) => c.current);
  if (current >= 0) return current;
  const pick = cards.findIndex((c) => c.dailyPick);
  return pick >= 0 ? pick : 0;
}

/** How the lobby lays out its cards: a sideways carousel, or a list on tall screens. */
export type LobbyFlow = 'row' | 'column';

export function lobbyFlow(layout: Pick<HudLayout, 'vw' | 'vh'>): LobbyFlow {
  return layout.vh > layout.vw * 1.15 ? 'column' : 'row';
}

/**
 * Cards across the carousel: three on wide screens, about two on phones (the next one peeks in, so
 * the row reads as scrollable), fewer when the dialog is narrow.
 */
export function cardsAcross(layout: Pick<HudLayout, 'controls' | 'modal' | 'unit'>, count: number): number {
  const fit = layout.modal.w / (layout.controls ? 300 : 380 * layout.unit + 40);
  const want = layout.controls ? 2.2 : 3;
  return Math.max(1, Math.min(count, want, Math.max(1.15, fit)));
}

/** The lobby button: shown only when there is something to choose (more than one machine offered). */
export function lobbyButton(machine: Pick<MachineUiState, 'lobby' | 'switching'>, lobbySetting: boolean, offered: number, modalOpen: boolean): { visible: boolean; enabled: boolean } {
  const visible = lobbySetting && offered > 1;
  return { visible, enabled: visible && machine.lobby && !machine.switching && !modalOpen };
}

/** The session HUD is shown on a machine other than classic while a player (not the demo) plays. */
export function showSessionHud(machine: Pick<MachineUiState, 'id' | 'switching'>, phase: string, demo: boolean): boolean {
  return machine.id !== 'classic' && !machine.switching && !demo && phase !== 'ATTRACT';
}

export interface SessionHudRect extends Rect {
  place: 'below' | 'above' | 'side';
}

/**
 * Where the session HUD goes: under the score where the score sits at the top (desktop, phone, 32"),
 * on the other side of the control panel where the score sits beside it (86"), else just above the
 * score. Inside the safe zone on every preset.
 */
export function sessionHudRect(layout: HudLayout, score: ScoreHudRect): SessionHudRect {
  const u = layout.unit;
  const gap = 10 * u;
  if (score.place === 'side') {
    const p = layout.panel;
    const w = score.w;
    const h = Math.min(p.h, 250 * u);
    const x = layout.handed === 'left' ? p.x + p.w + 12 * u : p.x - 12 * u - w;
    return { x: Math.max(layout.marginX, Math.min(x, layout.vw - layout.marginX - w)), y: p.y + (p.h - h) / 2, w, h, place: 'side' };
  }
  const w = Math.min(layout.vw - 2 * layout.marginX, Math.max(score.w, 380 * u));
  const h = (layout.controls ? 64 : 76) * u;
  const x = (layout.vw - w) / 2;
  if (score.place === 'abovePanel') return { x, y: Math.max(layout.safeTop + 4, score.y - h - gap), w, h, place: 'above' };
  return { x, y: Math.min(layout.safeBottom - h, score.y + score.h + gap), w, h, place: 'below' };
}

/** Five segments of the bridge's progress meter, each 0..1 filled. */
export function progressSegments(progress: number | null, segments = 5): number[] {
  const p = Math.max(0, Math.min(1, progress ?? 0)) * segments;
  return Array.from({ length: segments }, (_, i) => Math.max(0, Math.min(1, p - i)));
}

/* ------------------------------------------------------------------ the try toast */

export interface TryRow {
  key: string;
  params?: Params;
}

/** What the try toast says about one items try: the items, the points and the extra rows (multi-drop, handful, today). */
export function tryToastView(genre: GenreId, lastTry: NonNullable<MachineUiState['lastTry']>, award: ScoreAward | null): { scored: boolean; headline: TryRow; points: number; extras: TryRow[] } {
  const scored = lastTry.items > 0;
  const headline: TryRow = scored ? { key: genre === 'rush' ? 'machines.try.gems' : 'machines.try.boxes', params: { n: lastTry.items } } : { key: 'machines.try.none' };
  const extras: TryRow[] = [];
  const own = award && award.roundId === lastTry.roundId && !award.demo ? award : null;
  for (const extra of own?.extras ?? []) {
    if (extra.points === 0) continue;
    if (extra.key === 'multiDrop' || extra.key === 'handful') extras.push({ key: `machines.try.${extra.key}`, params: { mult: own!.comboMultiplier } });
    else if (extra.key === 'daily') extras.push({ key: 'machines.try.daily', params: { mult: own!.dailyBonus ?? 1 } });
  }
  return { scored, headline, points: lastTry.points, extras };
}

/** How long the try toast stays (ms): a little longer when something dropped. */
export function tryToastMs(genre: GenreId, scored: boolean): number {
  if (genre === 'rush') return scored ? 1500 : 900;
  return scored ? 2200 : 1500;
}

/* ------------------------------------------------------------------ the session card */

export interface SessionSummaryRow {
  key: string;
  label: TryRow;
  value: string;
}

/** The text under the session card's title: the prize, how close the shelf came, or a thank-you. */
export function sessionSubtitle(card: SessionResultUi, genre: GenreId, machines: Settings['machines'], prizeName: string | null): TryRow {
  if (card.rewardTypeId && prizeName) return { key: 'machines.session.reward', params: { name: prizeName } };
  if (genre === 'shelf') {
    const missing = machines.shelf.rewardItems - card.items;
    if (missing > 0) return { key: 'machines.session.noReward', params: { n: missing } };
  }
  if (genre === 'rush' && machines.rush.rewardValue > 0) return { key: 'machines.session.noRewardRush' };
  return { key: 'machines.session.thanks' };
}

/* ------------------------------------------------------------------ initials */

export const INITIALS_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The letter `steps` places after `ch` (wrapping A ↔ Z); anything else starts at A. */
export function cycleLetter(ch: string, steps: number): string {
  const i = INITIALS_LETTERS.indexOf(ch.toUpperCase());
  const n = INITIALS_LETTERS.length;
  return INITIALS_LETTERS[(((i < 0 ? 0 : i) + Math.round(steps)) % n + n) % n]!;
}

/** Three letters A-Z from what a player typed or picked (missing or invalid letters become A). */
export function normaliseInitials(letters: readonly string[]): string {
  return [0, 1, 2].map((i) => (INITIALS_LETTERS.includes((letters[i] ?? '').toUpperCase()) && (letters[i] ?? '').length === 1 ? letters[i]!.toUpperCase() : 'A')).join('');
}

/** Whole seconds left before the initials time out (the director saves `???` then). */
export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** The machine's display name key. */
export const nameKey = (id: MachineId): string => `machines.${id}.name`;
