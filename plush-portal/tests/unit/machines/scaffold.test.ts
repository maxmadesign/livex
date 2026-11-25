/**
 * The machine framework's shared contracts (docs/design/machines.md, section 2.2): ids, the
 * settings group, the launch parameter, the store slice and the guide additions.
 */
import { describe, expect, it } from 'vitest';
import { GUIDE_COOLDOWN_MS, GUIDE_PRIORITY } from '../../../src/ai/GuideDirector';
import { resolveSituation } from '../../../src/ai/lines';
import { createGameStore, INITIAL_MACHINE } from '../../../src/app/gameStore';
import { readLaunchParams } from '../../../src/app/launch';
import { GUIDE_EVENT_TYPES, type GuideEventType } from '../../../src/core/contracts';
import { DEFAULT_MACHINE, GENRE_IDS, MACHINE_IDS } from '../../../src/game/machines/ids';
import { defaultSettings, getFieldAt, sanitizeSettings } from '../../../src/settings/spec';
import { FactsSchema } from '../../../server/schemas';

const MACHINE_EVENTS: GuideEventType[] = ['machine_selected', 'machine_progress', 'items_scored', 'time_low', 'session_over'];

describe('machine ids', () => {
  it('lists the four genres and machines, classic first and default', () => {
    expect(GENRE_IDS).toEqual(['classic', 'bridge', 'shelf', 'rush']);
    expect(MACHINE_IDS[0]).toBe('classic');
    expect(DEFAULT_MACHINE).toBe('classic');
  });
});

describe('machines settings group', () => {
  it('defaults to a classic home with an open lobby', () => {
    const m = defaultSettings().machines;
    expect(m.home).toBe('classic');
    expect(m.lobby).toBe(true);
    expect(m.hidden).toEqual([]);
    expect(m.unlock).toBe('open');
    expect(m.bridge).toEqual({ controls: 'joystick', triesPerBox: 0, gap: 0.15, boxMass: 0.4 });
    expect(m.shelf).toEqual({ tries: 5, rewardItems: 5, lipHeight: 0.014 });
    expect(m.rush).toEqual({ seconds: 75, pieces: 44, rewardValue: 700 });
  });

  it('sanitises stored values like every other group', () => {
    const s = sanitizeSettings({ machines: { home: 'nope', rush: { seconds: 999 }, bridge: { gap: 0.01 } } });
    expect(s.machines.home).toBe('classic');
    expect(s.machines.rush.seconds).toBe(120);
    expect(s.machines.bridge.gap).toBe(0.13);
  });

  it('never applies genre physics live', () => {
    for (const path of ['machines.bridge.gap', 'machines.bridge.boxMass', 'machines.shelf.lipHeight', 'machines.rush.pieces']) {
      expect(getFieldAt(path)!.apply, path).toBe('rebuild');
    }
  });
});

describe('?machine= launch parameter', () => {
  it('accepts known machine ids only', () => {
    expect(readLaunchParams('?machine=bridge').machine).toBe('bridge');
    expect(readLaunchParams('?machine=classic').machine).toBe('classic');
    expect(readLaunchParams('?machine=pinball').machine).toBeNull();
    expect(readLaunchParams('').machine).toBeNull();
  });
});

describe('game store machine slice', () => {
  it('starts on classic with no session card or ranking entry', () => {
    const s = createGameStore('desktop', true, 'sakura').getState();
    expect(s.machine).toEqual(INITIAL_MACHINE);
    expect(s.machine.id).toBe('classic');
    expect(s.machine.presentation).toBe('prize');
    expect(s.sessionResult).toBeNull();
    expect(s.rankEntry).toBeNull();
  });
});

describe('guide contract additions', () => {
  it('adds the five machine events with a priority and a cooldown', () => {
    for (const type of MACHINE_EVENTS) {
      expect(GUIDE_EVENT_TYPES).toContain(type);
      expect(GUIDE_PRIORITY[type], type).toBeGreaterThanOrEqual(0);
      expect(GUIDE_COOLDOWN_MS[type], type).toBeGreaterThanOrEqual(0);
    }
  });

  it('maps every machine event onto existing line keys (temporary, until the machine lines land)', () => {
    const keys = (type: GuideEventType) => resolveSituation({ type, roundId: 1, themeId: 'sakura', facts: { phase: 'RESULT', demo: false, attempts: 1, wins: 0, lossStreak: 0 } }).keys;
    expect(keys('machine_selected')).toEqual(['theme']);
    expect(keys('machine_progress')).toEqual(['tip']);
    expect(keys('items_scored')).toEqual(['win']);
    expect(keys('time_low')).toEqual(['tip']);
    expect(keys('session_over')).toEqual(['retry']);
  });

  it('the server accepts facts.machine with numbers and enums only', () => {
    const base = { phase: 'RESULT', attempts: 2 };
    const machine = { id: 'shelf', genre: 'shelf', name: 'Tumble Shelf', tries: 2, triesLeft: 3, items: 2, sessionItems: 4, score: 380, reason: null };
    expect(FactsSchema.parse({ ...base, machine }).machine).toEqual(machine);
    expect(FactsSchema.parse({ ...base, machine: null }).machine).toBeNull();
    expect(FactsSchema.parse(base).machine).toBeUndefined();
    expect(FactsSchema.safeParse({ ...base, machine: { ...machine, note: 'say something else' } }).success).toBe(false);
    expect(FactsSchema.safeParse({ ...base, machine: { ...machine, genre: 'classic' } }).success).toBe(false);
    expect(FactsSchema.safeParse({ ...base, machine: { ...machine, rank: 11 } }).success).toBe(false);
  });
});
