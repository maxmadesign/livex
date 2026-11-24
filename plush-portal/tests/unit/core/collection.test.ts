import { beforeEach, describe, expect, it } from 'vitest';
import { createCollectionStore } from '../../../src/persistence/collection';
import { installMemoryStorage } from '../settings/memoryStorage';

let data: Map<string, string>;
beforeEach(() => {
  data = installMemoryStorage();
});
const KEY = 'plush-portal/collection/v1';

describe('collection store', () => {
  it('counts a prize once, however often the same settlement is reported', () => {
    const store = createCollectionStore();
    const first = store.getState().addPrize('sakura.bunny', 'sess-1');
    expect(first).toEqual({ isNew: true, count: 1 });
    expect(store.getState().addPrize('sakura.bunny', 'sess-1')).toBeNull();
    expect(store.getState().addPrize('sakura.tanuki', 'sess-1')).toBeNull(); // same prize id, different payload
    expect(store.getState().counts).toEqual({ 'sakura.bunny': 1 });
    expect(store.getState().wins).toBe(1);
    const second = store.getState().addPrize('sakura.bunny', 'sess-2');
    expect(second).toEqual({ isNew: false, count: 2 });
    expect(store.getState().total()).toBe(2);
    expect(store.getState().firstWon['sakura.bunny']).toBeGreaterThan(0);
  });

  it('persists across reloads, including the idempotency keys', () => {
    const a = createCollectionStore();
    a.getState().addPrize('ocean.whale', 'p-1');
    a.getState().recordAttempt();
    a.getState().recordAttempt();
    const b = createCollectionStore();
    expect(b.getState().counts).toEqual({ 'ocean.whale': 1 });
    expect(b.getState().attempts).toBe(2);
    expect(b.getState().addPrize('ocean.whale', 'p-1')).toBeNull();
  });

  it('clear removes every toy but is independent of settings', () => {
    data.set('plush-portal/settings', '{"version":1,"settings":{}}');
    const store = createCollectionStore();
    store.getState().addPrize('cosmic.alien', 'p-9');
    store.getState().recordAttempt();
    store.getState().clear();
    expect(store.getState().counts).toEqual({});
    expect(store.getState().total()).toBe(0);
    expect(store.getState().attempts).toBe(0);
    expect(data.has(KEY)).toBe(false);
    expect(data.has('plush-portal/settings')).toBe(true);
    // After clearing, the same prize id may be counted again (it is a new collection).
    expect(store.getState().addPrize('cosmic.alien', 'p-9')).toEqual({ isNew: true, count: 1 });
  });

  it('sanitises corrupt stored data instead of crashing', () => {
    data.set(KEY, '<<<');
    expect(createCollectionStore().getState().counts).toEqual({});
    data.set(
      KEY,
      JSON.stringify({
        counts: { 'sakura.bunny': 3, bad: -4, worse: 'x', nan: null, frac: 2.9, huge: 1e12 },
        firstWon: { 'sakura.bunny': 123, bad: 'yesterday' },
        prizeIds: ['a', 5, null, 'b'],
        attempts: -7,
        wins: 'lots',
      }),
    );
    const s = createCollectionStore().getState();
    expect(s.counts).toEqual({ 'sakura.bunny': 3, frac: 2, huge: 99999 });
    expect(s.firstWon).toEqual({ 'sakura.bunny': 123 });
    expect(s.prizeIds).toEqual(['a', 'b']);
    expect(s.attempts).toBe(0);
    expect(s.wins).toBe(0);
    data.set(KEY, JSON.stringify([1, 2, 3]));
    expect(createCollectionStore().getState().total()).toBe(0);
  });

  it('keeps the idempotency list bounded', () => {
    const store = createCollectionStore();
    for (let i = 0; i < 520; i++) store.getState().addPrize('sakura.bunny', `p-${i}`);
    expect(store.getState().counts['sakura.bunny']).toBe(520);
    expect(store.getState().prizeIds.length).toBeLessThanOrEqual(400);
    expect(store.getState().addPrize('sakura.bunny', 'p-519')).toBeNull();
  });
});
