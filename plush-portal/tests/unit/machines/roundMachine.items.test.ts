/** RoundMachine additions for machines: configure, scoreItem, awardSessionPrize (design section 2.3). */
import { describe, expect, it } from 'vitest';
import type { RoundPhase, RoundResult } from '../../../src/core/types';
import { AWARD_PHASES, RoundMachine, type ItemScore, type PrizeAward } from '../../../src/game/RoundMachine';

const GEM = { kind: 'gem', look: 'gemRuby', print: null, value: 50 } as const;
const SNACK = { kind: 'snack', look: 'snackS', print: 'sakura.bunny', value: 0 } as const;

function resultFor(m: RoundMachine): RoundResult {
  return {
    roundId: m.roundId,
    outcome: 'empty',
    demo: m.demo,
    themeId: 'sakura',
    targetToyId: null,
    targetTypeId: null,
    prizeId: null,
    contact: 'none',
    slipReason: null,
    slipPhase: null,
    liftedMs: 0,
    gripQuality: 0,
    nearest: null,
  };
}

function advanceTo(m: RoundMachine, phase: RoundPhase, demo = false): void {
  const steps: [RoundPhase, () => unknown][] = [
    ['READY', () => (m.phase === 'ATTRACT' ? m.start(demo) : m.phase === 'RESULT' ? m.next(demo) : null)],
    ['AIMING', () => m.beginAim()],
    ['DESCENDING', () => m.grab()],
    ['CLOSING', () => m.landed()],
    ['LIFTING', () => m.closed()],
    ['TRANSPORTING', () => m.lifted()],
    ['RELEASING', () => m.arrived()],
    ['SETTLING', () => m.released()],
    ['RESULT', () => m.finish(resultFor(m))],
  ];
  // Continue from where the machine is (a new round after ATTRACT / RESULT).
  const from = m.phase === 'ATTRACT' || m.phase === 'RESULT' ? 0 : steps.findIndex(([name]) => name === m.phase) + 1;
  for (const [name, go] of steps.slice(from)) {
    go();
    if (m.phase !== name) throw new Error(`expected ${name}, got ${m.phase}`);
    if (name === phase) return;
  }
}

describe('RoundMachine.scoreItem', () => {
  it('scores each toy once, in order, with an event per item', () => {
    const m = new RoundMachine('s');
    const events: ItemScore[] = [];
    m.events.on('item', (e) => events.push(e));
    advanceTo(m, 'TRANSPORTING');
    expect(m.scoreItem(m.roundId, 'item-1', GEM)).toEqual({ toyId: 'item-1', kind: 'gem', look: 'gemRuby', print: null, value: 50, index: 1 });
    expect(m.scoreItem(m.roundId, 'item-1', GEM)).toBeNull();
    expect(m.scoreItem(m.roundId, 'item-2', SNACK)!.index).toBe(2);
    expect(m.roundItems.map((i) => i.toyId)).toEqual(['item-1', 'item-2']);
    expect(events.map((e) => [e.toyId, e.index, e.roundId, e.demo])).toEqual([
      ['item-1', 1, 1, false],
      ['item-2', 2, 1, false],
    ]);
    // A new round starts with no items; a toy scored in an earlier round never scores again.
    advanceTo(m, 'RESULT');
    m.next();
    expect(m.roundItems).toEqual([]);
    expect(m.scoreItem(m.roundId, 'item-1', GEM)).toBeNull();
    expect(m.scoreItem(m.roundId, 'item-3', GEM)!.index).toBe(1);
  });

  it('is refused in ATTRACT and RESULT and for a stale round', () => {
    const m = new RoundMachine('s');
    expect(m.scoreItem(0, 'a', GEM)).toBeNull();
    advanceTo(m, 'RESULT');
    expect(m.scoreItem(m.roundId, 'b', GEM)).toBeNull();
    m.next();
    expect(m.scoreItem(m.roundId - 1, 'c', GEM)).toBeNull();
    // READY counts: a body that fell during the RESULT is picked up at the next READY.
    expect(m.scoreItem(m.roundId, 'd', GEM)).not.toBeNull();
  });

  it('scores demo items as demo', () => {
    const m = new RoundMachine('s');
    const events: ItemScore[] = [];
    m.events.on('item', (e) => events.push(e));
    advanceTo(m, 'SETTLING', true);
    m.scoreItem(m.roundId, 'x', GEM);
    expect(events[0]!.demo).toBe(true);
  });
});

describe('RoundMachine.awardSessionPrize', () => {
  it('awards once per round id with the -S prize id and session: true', () => {
    const m = new RoundMachine('sess');
    const awards: PrizeAward[] = [];
    m.events.on('award', (a) => awards.push(a));
    advanceTo(m, 'RESULT');
    const award = m.awardSessionPrize(m.roundId, 'sakura.biribi');
    expect(award).toEqual({ roundId: 1, prizeId: 'sess-1-S', toyId: '', typeId: 'sakura.biribi', demo: false, session: true });
    expect(m.awardSessionPrize(m.roundId, 'sakura.biribi')).toBeNull();
    expect(awards).toEqual([award]);
    // The try's own award, if any, is untouched (different id space).
    expect(m.award).toBeNull();
  });

  it('may name the last try from the next READY (a timed run that ends without a try)', () => {
    const m = new RoundMachine('s');
    advanceTo(m, 'RESULT');
    m.next();
    expect(m.awardSessionPrize(m.roundId - 1, 'sakura.tanuki')!.prizeId).toBe('s-1-S');
    expect(m.awardSessionPrize(m.roundId + 1, 'sakura.tanuki')).toBeNull();
    expect(m.awardSessionPrize(0, 'sakura.tanuki')).toBeNull();
  });

  it('never for demo rounds, never during a try', () => {
    const m = new RoundMachine('s');
    advanceTo(m, 'RESULT', true);
    expect(m.awardSessionPrize(m.roundId, 'sakura.bunny')).toBeNull();
    m.next(false);
    advanceTo(m, 'LIFTING');
    expect(m.awardSessionPrize(m.roundId, 'sakura.bunny')).toBeNull();
    m.toAttract();
    expect(m.awardSessionPrize(m.roundId, 'sakura.bunny')).toBeNull();
  });
});

describe('RoundMachine.configure', () => {
  it('only at a round boundary', () => {
    const m = new RoundMachine('s');
    expect(() => m.configure({ awardPhases: AWARD_PHASES })).not.toThrow();
    advanceTo(m, 'DESCENDING');
    expect(() => m.configure({ awardPhases: AWARD_PHASES })).toThrow(/round boundary/);
    advanceTo(m, 'RESULT');
    expect(() => m.configure({ awardPhases: AWARD_PHASES })).not.toThrow();
  });

  it('sets the phases in which awardPrize succeeds (classic default unchanged)', () => {
    const classic = new RoundMachine('s');
    advanceTo(classic, 'DESCENDING');
    expect(classic.awardPrize(classic.roundId, 't', 'x')).toBeNull();

    const bridge = new RoundMachine('s');
    bridge.configure({ awardPhases: new Set<RoundPhase>(['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']) });
    advanceTo(bridge, 'DESCENDING');
    expect(bridge.awardPrize(bridge.roundId, 't', 'x')).not.toBeNull();
    expect(bridge.awardPrize(bridge.roundId, 't', 'x')).toBeNull();
  });

  it('forgets the scored toys of the previous machine', () => {
    const m = new RoundMachine('s');
    advanceTo(m, 'READY');
    expect(m.scoreItem(m.roundId, 'item-1', GEM)).not.toBeNull();
    m.configure({ awardPhases: AWARD_PHASES });
    expect(m.roundItems).toEqual([]);
    expect(m.scoreItem(m.roundId, 'item-1', GEM)).not.toBeNull();
  });
});
