import { createStore } from 'zustand/vanilla';
import { readJson, removeKey, writeJson } from './storage';

const KEY = 'collection/v1';
const MAX_PRIZE_IDS = 400;

export interface CollectionData {
  /** How many of each character (manifest id) the player has won. */
  counts: Record<string, number>;
  /** When each character was first won (ms since epoch). */
  firstWon: Record<string, number>;
  /** Recently settled prize ids: makes settlement idempotent across duplicate events. */
  prizeIds: string[];
  attempts: number;
  wins: number;
  /**
   * Prizes won per machine other than classic (machine id → wins), for the lobby's "prizes won here".
   * Classic's share is `wins` minus the others (older stored data has no such field at all).
   */
  machineWins: Record<string, number>;
}

export interface CollectionState extends CollectionData {
  /**
   * Adds a prize. Returns null when this prize id was already counted. `machineId`: the machine it
   * was won on; counted in `machineWins` unless it is classic.
   */
  addPrize(typeId: string, prizeId: string, machineId?: string): { isNew: boolean; count: number } | null;
  recordAttempt(): void;
  /** Removes every collected toy (settings are untouched). */
  clear(): void;
  total(): number;
}

function sanitize(raw: unknown): CollectionData {
  const data: CollectionData = { counts: {}, firstWon: {}, prizeIds: [], attempts: 0, wins: 0, machineWins: {} };
  if (!raw || typeof raw !== 'object') return data;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  if (o.counts && typeof o.counts === 'object') {
    for (const [k, v] of Object.entries(o.counts as Record<string, unknown>)) if (num(v) > 0) data.counts[k.slice(0, 64)] = Math.min(num(v), 99999);
  }
  if (o.firstWon && typeof o.firstWon === 'object') {
    for (const [k, v] of Object.entries(o.firstWon as Record<string, unknown>)) if (num(v) > 0) data.firstWon[k.slice(0, 64)] = num(v);
  }
  if (Array.isArray(o.prizeIds)) data.prizeIds = o.prizeIds.filter((v): v is string => typeof v === 'string').slice(-MAX_PRIZE_IDS);
  data.attempts = num(o.attempts);
  data.wins = num(o.wins);
  if (o.machineWins && typeof o.machineWins === 'object') {
    for (const [k, v] of Object.entries(o.machineWins as Record<string, unknown>)) {
      if (/^[a-z][a-z0-9_-]{0,31}$/.test(k) && k !== 'classic' && num(v) > 0) data.machineWins[k] = Math.min(num(v), 99999);
    }
  }
  return data;
}

export function createCollectionStore() {
  const initial = sanitize(readJson(KEY));
  const store = createStore<CollectionState>()((set, get) => {
    const persist = () => {
      const { counts, firstWon, prizeIds, attempts, wins, machineWins } = get();
      // machineWins only once a machine other than classic paid out: classic-only data keeps its shape.
      writeJson(KEY, Object.keys(machineWins).length > 0 ? { counts, firstWon, prizeIds, attempts, wins, machineWins } : { counts, firstWon, prizeIds, attempts, wins });
    };
    return {
      ...initial,
      addPrize(typeId, prizeId, machineId) {
        const state = get();
        if (state.prizeIds.includes(prizeId)) return null;
        const count = (state.counts[typeId] ?? 0) + 1;
        const isNew = count === 1;
        const here = machineId && machineId !== 'classic' ? { ...state.machineWins, [machineId]: Math.min(99999, (state.machineWins[machineId] ?? 0) + 1) } : state.machineWins;
        set({
          counts: { ...state.counts, [typeId]: count },
          firstWon: isNew ? { ...state.firstWon, [typeId]: Date.now() } : state.firstWon,
          prizeIds: [...state.prizeIds, prizeId].slice(-MAX_PRIZE_IDS),
          wins: state.wins + 1,
          machineWins: here,
        });
        persist();
        return { isNew, count };
      },
      recordAttempt() {
        set({ attempts: get().attempts + 1 });
        persist();
      },
      clear() {
        set({ counts: {}, firstWon: {}, prizeIds: [], attempts: 0, wins: 0, machineWins: {} });
        removeKey(KEY);
      },
      total() {
        return Object.values(get().counts).reduce((a, b) => a + b, 0);
      },
    };
  });
  return store;
}

export type CollectionStore = ReturnType<typeof createCollectionStore>;
