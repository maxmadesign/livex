import { beforeEach, describe, expect, it } from 'vitest';
import { ScoreKeeper } from '../../../src/game/scoring';
import { SCORES_VERSION, clearScores, emptyScores, loadScores, sanitizeScores, saveScores } from '../../../src/persistence/scores';
import { createSettingsStore } from '../../../src/settings/store';
import { installMemoryStorage } from '../settings/memoryStorage';

let data: Map<string, string>;
beforeEach(() => {
  data = installMemoryStorage();
});
const KEY = 'plush-portal/scores';

describe('stored scores', () => {
  it('start at zero and survive a reload, versioned', () => {
    expect(loadScores()).toEqual(emptyScores());
    expect(saveScores({ best: 1250, lifetime: 9000 })).toBe(true);
    expect(JSON.parse(data.get(KEY)!)).toEqual({ version: SCORES_VERSION, best: 1250, lifetime: 9000 });
    expect(loadScores()).toEqual({ best: 1250, lifetime: 9000 });
    clearScores();
    expect(data.has(KEY)).toBe(false);
    expect(loadScores()).toEqual(emptyScores());
  });

  it('repair corrupt, hostile and newer-version data with safe values', () => {
    expect(sanitizeScores(null)).toEqual(emptyScores());
    expect(sanitizeScores('x')).toEqual(emptyScores());
    expect(sanitizeScores({ best: 10, lifetime: 20 })).toEqual(emptyScores()); // no version
    expect(sanitizeScores({ version: SCORES_VERSION + 1, best: 10, lifetime: 20 })).toEqual(emptyScores());
    expect(sanitizeScores({ version: 1, best: -5, lifetime: 'lots' })).toEqual({ best: 0, lifetime: 0 });
    expect(sanitizeScores({ version: 1, best: 1e15, lifetime: Infinity })).toEqual({ best: 999_999_999, lifetime: 999_999_999 });
    expect(sanitizeScores({ version: 1, best: 120.7, lifetime: 50 })).toEqual({ best: 120, lifetime: 120 });
    data.set(KEY, '{not json');
    expect(loadScores()).toEqual(emptyScores());
  });

  it('never overwrite scores written by a newer build', () => {
    const newer = JSON.stringify({ version: SCORES_VERSION + 1, best: 5000, lifetime: 90000, extra: true });
    data.set(KEY, newer);
    expect(loadScores()).toEqual(emptyScores());
    expect(saveScores({ best: 100, lifetime: 100 })).toBe(false);
    expect(data.get(KEY)).toBe(newer);
    // Reset scores (Settings → System) still clears them.
    clearScores();
    expect(saveScores({ best: 100, lifetime: 100 })).toBe(true);
  });

  it('persist only the player: demo rounds never write, a player win does', () => {
    const keeper = new ScoreKeeper(loadScores(), saveScores);
    keeper.settle({ roundId: 1, outcome: 'won', typeId: 'ocean.whale', difficulty: 'arcade', firstCatch: false, grip: null, demo: true });
    expect(data.has(KEY)).toBe(false);
    keeper.settle({ roundId: 2, outcome: 'won', typeId: 'ocean.seal', difficulty: 'arcade', firstCatch: true, grip: null, demo: false });
    expect(loadScores()).toEqual({ best: 150, lifetime: 150 });
  });

  it('are not settings: not part of the settings store or a configuration export', () => {
    saveScores({ best: 777, lifetime: 7777 });
    const exported = createSettingsStore().getState().exportJson();
    expect(exported).not.toContain('777');
    expect(exported).not.toMatch(/"best"|"lifetime"|scores/);
  });
});
