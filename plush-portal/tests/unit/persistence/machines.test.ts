import { beforeEach, describe, expect, it } from 'vitest';
import { RANK_SIZE } from '../../../src/game/machines/rush';
import { createCollectionStore } from '../../../src/persistence/collection';
import {
  MACHINES_VERSION,
  UNKNOWN_INITIALS,
  addRanking,
  cleanInitials,
  clearMachines,
  emptyMachines,
  loadMachineRecord,
  loadMachines,
  rankingsOf,
  recordPlay,
  sanitizeMachines,
  saveMachineRecord,
  saveMachines,
} from '../../../src/persistence/machines';
import { installMemoryStorage } from '../settings/memoryStorage';

let data: Map<string, string>;
beforeEach(() => {
  data = installMemoryStorage();
});
const KEY = 'plush-portal/machines';
const entry = (initials: string, score: number, at: number) => ({ initials, score, at, difficulty: 'arcade' as const });

describe('machines/v1 records (design 4.3)', () => {
  it('start empty and keep per-machine bests, versioned, next to the untouched classic scores', () => {
    expect(loadMachines()).toEqual(emptyMachines());
    expect(loadMachineRecord('shelf')).toEqual({ best: 0, lifetime: 0 });
    expect(saveMachineRecord('shelf', { best: 900, lifetime: 2400 })).toBe(true);
    expect(saveMachineRecord('rush', { best: 50, lifetime: 10 })).toBe(true);
    const stored = JSON.parse(data.get(KEY)!);
    expect(stored.version).toBe(MACHINES_VERSION);
    expect(loadMachineRecord('shelf')).toEqual({ best: 900, lifetime: 2400 });
    // The lifetime can never be lower than the best.
    expect(loadMachineRecord('rush')).toEqual({ best: 50, lifetime: 50 });
    expect(data.has('plush-portal/scores')).toBe(false);
    clearMachines();
    expect(data.has(KEY)).toBe(false);
    expect(loadMachineRecord('shelf')).toEqual({ best: 0, lifetime: 0 });
  });

  it('repair corrupt, hostile and newer-version data', () => {
    expect(sanitizeMachines(null)).toEqual(emptyMachines());
    expect(sanitizeMachines({ best: { shelf: { best: 5 } } })).toEqual(emptyMachines()); // no version
    expect(sanitizeMachines({ version: MACHINES_VERSION + 1, best: { shelf: { best: 5, lifetime: 5 } } })).toEqual(emptyMachines());
    const s = sanitizeMachines({
      version: 1,
      best: { shelf: { best: 1e15, lifetime: -3 }, 'BAD KEY': { best: 3 }, rush: 'x' },
      rankings: { rush: [entry('abc', 10, 5), { initials: 'ZZZ', score: -4, at: 1 }, null, entry('QQQQ', 30, 2), entry('XYZ', 20, 'soon' as unknown as number)] },
      plays: { shelf: 3.7, rush: -1, bridge: 'many' },
    });
    expect(s.best).toEqual({ shelf: { best: 999_999_999, lifetime: 999_999_999 } });
    // Sorted best first; invalid initials became ???, a negative score was dropped.
    expect(s.rankings.rush!.map((e) => [e.initials, e.score])).toEqual([
      [UNKNOWN_INITIALS, 30],
      ['XYZ', 20],
      ['ABC', 10],
    ]);
    expect(s.plays).toEqual({ shelf: 3 });
    data.set(KEY, '{not json');
    expect(loadMachines()).toEqual(emptyMachines());
  });

  it('never overwrite data written by a newer build', () => {
    const newer = JSON.stringify({ version: MACHINES_VERSION + 1, best: { shelf: { best: 1, lifetime: 1 } }, extra: true });
    data.set(KEY, newer);
    expect(saveMachines(emptyMachines())).toBe(false);
    expect(saveMachineRecord('shelf', { best: 100, lifetime: 100 })).toBe(false);
    expect(addRanking('rush', entry('ABC', 100, 1))).toBeNull();
    expect(data.get(KEY)).toBe(newer);
  });

  it('count plays per machine', () => {
    recordPlay('shelf');
    recordPlay('shelf');
    recordPlay('rush');
    expect(loadMachines().plays).toEqual({ shelf: 2, rush: 1 });
  });
});

describe('local rankings (design 3.3)', () => {
  it('keep the top 10 best first; ties keep the older entry first', () => {
    for (let i = 0; i < 12; i++) addRanking('rush', entry('AAA', 100 + i * 10, i + 1));
    const top = rankingsOf('rush');
    expect(top).toHaveLength(RANK_SIZE);
    expect(top[0]!.score).toBe(210);
    expect(top[RANK_SIZE - 1]!.score).toBe(120);
    // A tie with #3 lands behind it.
    expect(addRanking('rush', entry('BBB', 190, 99))).toBe(4);
    expect(rankingsOf('rush')[3]!.initials).toBe('BBB');
    // Too low for the top 10.
    expect(addRanking('rush', entry('CCC', 50, 100))).toBeNull();
    expect(rankingsOf('rush').some((e) => e.initials === 'CCC')).toBe(false);
    // Rankings are per machine.
    expect(rankingsOf('shelf')).toEqual([]);
  });

  it('filter initials: three letters A-Z, else ???; a tiny blocklist becomes ???', () => {
    expect(cleanInitials('abc')).toBe('ABC');
    expect(cleanInitials(' kim ')).toBe('KIM');
    expect(cleanInitials('AB')).toBe(UNKNOWN_INITIALS);
    expect(cleanInitials('A1C')).toBe(UNKNOWN_INITIALS);
    expect(cleanInitials('ÄBC')).toBe(UNKNOWN_INITIALS);
    expect(cleanInitials(42)).toBe(UNKNOWN_INITIALS);
    expect(cleanInitials('ass')).toBe(UNKNOWN_INITIALS);
    expect(cleanInitials('KKK')).toBe(UNKNOWN_INITIALS);
    expect(addRanking('rush', entry('fuk', 500, 1))).toBe(1);
    expect(rankingsOf('rush')[0]!.initials).toBe(UNKNOWN_INITIALS);
  });
});

describe('collection: prizes per machine (design 3.5)', () => {
  const COLLECTION = 'plush-portal/collection/v1';
  it('counts machineWins for machines other than classic; classic-only data keeps its stored shape', () => {
    const store = createCollectionStore();
    store.getState().addPrize('sakura.bunny', 'p-1');
    store.getState().addPrize('sakura.bunny', 'p-2', 'classic');
    expect(Object.keys(JSON.parse(data.get(COLLECTION)!))).toEqual(['counts', 'firstWon', 'prizeIds', 'attempts', 'wins']);
    expect(store.getState().machineWins).toEqual({});
    store.getState().addPrize('sakura.tanuki', 'p-3', 'bridge');
    store.getState().addPrize('sakura.tanuki', 'p-3', 'bridge'); // same prize id: counted once
    store.getState().addPrize('sakura.fox', 'p-4-S', 'shelf');
    expect(store.getState().machineWins).toEqual({ bridge: 1, shelf: 1 });
    expect(store.getState().wins).toBe(4);
    // Survives a reload; corrupt entries are dropped.
    const raw = JSON.parse(data.get(COLLECTION)!);
    raw.machineWins = { ...raw.machineWins, rush: -2, 'NO WAY': 3, classic: 7 };
    data.set(COLLECTION, JSON.stringify(raw));
    expect(createCollectionStore().getState().machineWins).toEqual({ bridge: 1, shelf: 1 });
    store.getState().clear();
    expect(store.getState().machineWins).toEqual({});
  });
});
