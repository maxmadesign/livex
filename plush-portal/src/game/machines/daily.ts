/**
 * Today's pick and the unlock rule (docs/design/machines.md, section 4.4). Pure: the app passes the
 * local date and the candidates in; nothing here reads the clock or storage.
 *
 *   - dailyPick: one machine per local day earns a points bonus. FNV-1a of `plush:<YYYY-MM-DD>`
 *     modulo the candidates. Classic is never a candidate, so classic scoring never changes.
 *   - isUnlocked: in the 'progress' unlock mode a machine opens once enough prizes were collected;
 *     classic and the home machine are always open.
 */
import type { MachineId } from './ids';
import type { MachineDef } from './types';

/** 32-bit FNV-1a of a string's UTF-16 code units. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A local calendar date as `YYYY-MM-DD` (the caller supplies the date; headless code never reads it). */
export function ymdOf(date: { getFullYear(): number; getMonth(): number; getDate(): number }): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The machine that earns today's points bonus, or null when no candidate is left. Classic is
 * dropped from the candidates whatever the caller passes; the order of `candidates` is the lobby
 * order (the same date gives the same machine as long as the offered set does not change).
 */
export function dailyPick(ymd: string, candidates: readonly MachineId[]): MachineId | null {
  const list = candidates.filter((id, i) => id !== 'classic' && candidates.indexOf(id) === i);
  if (list.length === 0) return null;
  return list[fnv1a(`plush:${ymd}`) % list.length]!;
}

export type UnlockMode = 'open' | 'progress';

/** Collected prizes still needed before `def` opens (0 = open). Classic and the home machine are always open. */
export function winsToUnlock(def: Pick<MachineDef, 'id' | 'unlockAfterWins'>, mode: UnlockMode, wins: number, home: MachineId): number {
  if (mode !== 'progress' || def.id === 'classic' || def.id === home) return 0;
  return Math.max(0, Math.ceil(def.unlockAfterWins) - Math.max(0, Math.floor(wins)));
}

export function isUnlocked(def: Pick<MachineDef, 'id' | 'unlockAfterWins'>, mode: UnlockMode, wins: number, home: MachineId): boolean {
  return winsToUnlock(def, mode, wins, home) === 0;
}
