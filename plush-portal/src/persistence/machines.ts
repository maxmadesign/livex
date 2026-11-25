import type { MachineId } from '../game/machines/ids';
import { INITIALS_PATTERN, RANK_SIZE, insertRank, type RankEntry } from '../game/machines/rush';
import type { ScoreRecord, ScoringDifficulty } from '../game/scoring';
import { readJson, removeKey, writeJson } from './storage';

/**
 * Points records of the machines other than classic (docs/design/machines.md, section 4.3), kept on
 * this device only, next to the classic `scores` record (which stays untouched):
 *
 *   best      – best session score and lifetime points per machine
 *   rankings  – the local top 10 per machine: three initials, the score, when, at which difficulty
 *   plays     – sessions started per machine (lobby statistics)
 *
 * Like the scores, these are not settings: never exported, cleared by Settings → System → Reset
 * scores. Data written by a newer build is left alone. Demo runs never reach this file.
 */
export const MACHINES_KEY = 'machines';
export const MACHINES_VERSION = 1;

export interface MachinesData {
  version: typeof MACHINES_VERSION;
  best: Partial<Record<MachineId, ScoreRecord>>;
  rankings: Partial<Record<MachineId, RankEntry[]>>;
  plays: Partial<Record<MachineId, number>>;
}

/** Upper bound for stored totals (as src/persistence/scores.ts). */
const MAX_POINTS = 999_999_999;
const MAX_PLAYS = 9_999_999;
const DIFFICULTIES: readonly ScoringDifficulty[] = ['easy', 'arcade', 'skill', 'custom'];
/** What a ranking shows for initials that were not entered, were invalid or are on the blocklist. */
export const UNKNOWN_INITIALS = '???';

/**
 * A tiny blocklist of three-letter combinations a public kiosk should not show. They are saved as
 * `???` instead (the score still counts).
 */
const BLOCKED_INITIALS: ReadonlySet<string> = new Set([
  'ASS', 'CUM', 'DIC', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'FUQ', 'JIZ', 'KKK', 'NAZ', 'NIG', 'SEX', 'SHT', 'TIT', 'WTF', 'XXX',
]);

export function emptyMachines(): MachinesData {
  return { version: MACHINES_VERSION, best: {}, rankings: {}, plays: {} };
}

function points(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_POINTS, Math.floor(v)) : 0;
}

/** Stored machine ids are short plain words; anything else is dropped. */
function machineKey(k: string): k is MachineId {
  return /^[a-z][a-z0-9_-]{0,31}$/.test(k);
}

/** Initials as a ranking stores them: three capital letters A-Z, else `???` (also for blocked words). */
export function cleanInitials(raw: unknown): string {
  if (typeof raw !== 'string') return UNKNOWN_INITIALS;
  const s = raw.trim().toUpperCase();
  if (!INITIALS_PATTERN.test(s) || BLOCKED_INITIALS.has(s)) return UNKNOWN_INITIALS;
  return s;
}

function sanitizeEntry(raw: unknown): RankEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const score = points(o.score);
  if (score <= 0) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? Math.floor(o.at) : 0;
  const difficulty = DIFFICULTIES.includes(o.difficulty as ScoringDifficulty) ? (o.difficulty as ScoringDifficulty) : 'arcade';
  const initials = o.initials === UNKNOWN_INITIALS ? UNKNOWN_INITIALS : cleanInitials(o.initials);
  return { initials, score, at, difficulty };
}

/** Cleans stored data; anything unusable (missing, corrupt, written by a newer build) becomes empty. */
export function sanitizeMachines(raw: unknown): MachinesData {
  const data = emptyMachines();
  if (!raw || typeof raw !== 'object') return data;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'number' || o.version > MACHINES_VERSION) return data;
  if (o.best && typeof o.best === 'object') {
    for (const [k, v] of Object.entries(o.best as Record<string, unknown>)) {
      if (!machineKey(k) || !v || typeof v !== 'object') continue;
      const r = v as Record<string, unknown>;
      const best = points(r.best);
      const record = { best, lifetime: Math.max(best, points(r.lifetime)) };
      if (record.best > 0 || record.lifetime > 0) data.best[k] = record;
    }
  }
  if (o.rankings && typeof o.rankings === 'object') {
    for (const [k, v] of Object.entries(o.rankings as Record<string, unknown>)) {
      if (!machineKey(k) || !Array.isArray(v)) continue;
      let entries: RankEntry[] = [];
      // Re-inserting puts hand-edited or reordered data back into ranking order (ties: older first).
      for (const e of v.slice(0, RANK_SIZE * 4)) {
        const clean = sanitizeEntry(e);
        if (clean) entries = insertRank(entries, clean).entries;
      }
      if (entries.length > 0) data.rankings[k] = entries;
    }
  }
  if (o.plays && typeof o.plays === 'object') {
    for (const [k, v] of Object.entries(o.plays as Record<string, unknown>)) {
      const n = typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_PLAYS, Math.floor(v)) : 0;
      if (machineKey(k) && n > 0) data.plays[k] = n;
    }
  }
  return data;
}

export function loadMachines(): MachinesData {
  return sanitizeMachines(readJson(MACHINES_KEY));
}

function newerBuildData(): boolean {
  const stored = readJson(MACHINES_KEY);
  return !!stored && typeof stored === 'object' && typeof (stored as { version?: unknown }).version === 'number' && (stored as { version: number }).version > MACHINES_VERSION;
}

export function saveMachines(data: MachinesData): boolean {
  // Data written by a newer build is left alone (as with the settings and the scores).
  if (newerBuildData()) return false;
  return writeJson(MACHINES_KEY, sanitizeMachines({ ...data, version: MACHINES_VERSION }));
}

export function clearMachines(): void {
  removeKey(MACHINES_KEY);
}

/** Best session score and lifetime points of one machine (zero when none). */
export function loadMachineRecord(id: MachineId): ScoreRecord {
  const r = loadMachines().best[id];
  return r ? { ...r } : { best: 0, lifetime: 0 };
}

export function saveMachineRecord(id: MachineId, record: ScoreRecord): boolean {
  const data = loadMachines();
  const best = points(record.best);
  data.best[id] = { best, lifetime: Math.max(best, points(record.lifetime)) };
  return saveMachines(data);
}

/** The local top 10 of a machine, best first. */
export function rankingsOf(id: MachineId): RankEntry[] {
  return [...(loadMachines().rankings[id] ?? [])];
}

/**
 * Saves one ranking entry (initials cleaned, `???` when invalid or blocked). Returns its position
 * (1-based) or null when it did not make the top 10 or could not be stored.
 */
export function addRanking(id: MachineId, entry: RankEntry): number | null {
  const data = loadMachines();
  const clean: RankEntry = { ...entry, initials: entry.initials === UNKNOWN_INITIALS ? UNKNOWN_INITIALS : cleanInitials(entry.initials), score: points(entry.score) };
  const { entries, position } = insertRank(data.rankings[id] ?? [], clean);
  if (position === null) return null;
  data.rankings[id] = entries;
  return saveMachines(data) ? position : null;
}

/** One more session started on a machine. */
export function recordPlay(id: MachineId): void {
  const data = loadMachines();
  data.plays[id] = Math.min(MAX_PLAYS, (data.plays[id] ?? 0) + 1);
  saveMachines(data);
}
