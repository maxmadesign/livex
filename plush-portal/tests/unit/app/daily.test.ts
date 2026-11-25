import { describe, expect, it } from 'vitest';
import { dailyPick, fnv1a, isUnlocked, winsToUnlock, ymdOf } from '../../../src/game/machines/daily';
import type { MachineId } from '../../../src/game/machines/ids';

const ALL: MachineId[] = ['classic', 'bridge', 'shelf', 'rush'];

function year(y: number): string[] {
  const out: string[] = [];
  for (let d = 0; d < 365; d++) out.push(ymdOf(new Date(y, 0, 1 + d)));
  return out;
}

describe("today's pick (design 4.4)", () => {
  it('hashes plush:<date> with FNV-1a', () => {
    // Reference values of the 32-bit FNV-1a.
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('formats the local date as YYYY-MM-DD', () => {
    expect(ymdOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(ymdOf(new Date(2026, 10, 25))).toBe('2026-11-25');
    expect(ymdOf({ getFullYear: () => 987, getMonth: () => 11, getDate: () => 31 })).toBe('0987-12-31');
  });

  it('is stable for a date, changes across dates and never picks classic', () => {
    const a = dailyPick('2026-11-25', ALL);
    expect(a).not.toBeNull();
    expect(dailyPick('2026-11-25', ALL)).toBe(a);
    const picks = new Set(year(2026).map((d) => dailyPick(d, ALL)));
    expect(picks.has('classic')).toBe(false);
    expect(picks.size).toBe(3);
    // Consecutive days do not all agree.
    const days = year(2026);
    let changes = 0;
    for (let i = 1; i < days.length; i++) if (dailyPick(days[i]!, ALL) !== dailyPick(days[i - 1]!, ALL)) changes++;
    expect(changes).toBeGreaterThan(100);
  });

  it('returns null with nothing but classic, and respects the candidate list', () => {
    expect(dailyPick('2026-11-25', [])).toBeNull();
    expect(dailyPick('2026-11-25', ['classic'])).toBeNull();
    for (const d of year(2026).slice(0, 60)) {
      expect(dailyPick(d, ['classic', 'shelf'])).toBe('shelf');
      expect(['bridge', 'rush']).toContain(dailyPick(d, ['bridge', 'rush']));
    }
    // Duplicates do not weigh a machine twice.
    expect(dailyPick('2026-11-25', ['shelf', 'shelf', 'rush'])).toBe(dailyPick('2026-11-25', ['shelf', 'rush']));
  });

  it('spreads the machines evenly: each within ±30 % of the mean over 365 dates', () => {
    for (const cands of [['bridge', 'shelf', 'rush'], ['bridge', 'shelf'], ['shelf', 'rush'], ['bridge', 'rush']] as MachineId[][]) {
      for (const y of [2025, 2026, 2027]) {
        const counts = new Map<string, number>();
        for (const d of year(y)) {
          const p = dailyPick(d, cands)!;
          counts.set(p, (counts.get(p) ?? 0) + 1);
        }
        const mean = 365 / cands.length;
        for (const id of cands) {
          const n = counts.get(id) ?? 0;
          expect(n, `${id} in ${y} of ${cands.join(',')}`).toBeGreaterThanOrEqual(mean * 0.7);
          expect(n, `${id} in ${y} of ${cands.join(',')}`).toBeLessThanOrEqual(mean * 1.3);
        }
      }
    }
  });
});

describe('unlocks (design 4.4)', () => {
  const shelf = { id: 'shelf' as const, unlockAfterWins: 3 };
  it('open mode: everything is open', () => {
    expect(isUnlocked(shelf, 'open', 0, 'classic')).toBe(true);
    expect(winsToUnlock(shelf, 'open', 0, 'classic')).toBe(0);
  });
  it('progress mode: opens with enough collected prizes; classic and home always open', () => {
    expect(winsToUnlock(shelf, 'progress', 1, 'classic')).toBe(2);
    expect(isUnlocked(shelf, 'progress', 2, 'classic')).toBe(false);
    expect(isUnlocked(shelf, 'progress', 3, 'classic')).toBe(true);
    expect(isUnlocked(shelf, 'progress', 0, 'shelf')).toBe(true);
    expect(isUnlocked({ id: 'classic', unlockAfterWins: 9 }, 'progress', 0, 'bridge')).toBe(true);
  });
});
