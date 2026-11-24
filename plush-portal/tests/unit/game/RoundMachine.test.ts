import { describe, expect, it } from 'vitest';
import { ROUND_PHASES, type RoundPhase, type RoundResult } from '../../../src/core/types';
import { BUSY_PHASES, PHASE_WATCHDOG, RoundMachine } from '../../../src/game/RoundMachine';

function resultFor(m: RoundMachine, outcome: RoundResult['outcome'] = 'empty'): RoundResult {
  return {
    roundId: m.roundId,
    outcome,
    demo: m.demo,
    themeId: 'sakura',
    targetToyId: null,
    targetTypeId: null,
    prizeId: m.award?.prizeId ?? null,
    contact: 'none',
    slipReason: null,
    slipPhase: null,
    liftedMs: 0,
    gripQuality: 0,
    nearest: null,
  };
}

/** Drives the machine to the given phase through legal transitions only. */
function advanceTo(m: RoundMachine, phase: RoundPhase): void {
  const steps: [RoundPhase, () => unknown][] = [
    ['READY', () => (m.phase === 'ATTRACT' ? m.start() : m.phase === 'RESULT' ? m.next() : null)],
    ['AIMING', () => m.beginAim()],
    ['DESCENDING', () => m.grab()],
    ['CLOSING', () => m.landed()],
    ['LIFTING', () => m.closed()],
    ['TRANSPORTING', () => m.lifted()],
    ['RELEASING', () => m.arrived()],
    ['SETTLING', () => m.released()],
    ['RESULT', () => m.finish(resultFor(m))],
  ];
  if (phase === 'ATTRACT') return;
  for (const [name, go] of steps) {
    go();
    if (m.phase !== name) throw new Error(`expected ${name}, got ${m.phase}`);
    if (name === phase) return;
  }
}

describe('RoundMachine', () => {
  it('walks the documented path and reports every phase once', () => {
    const m = new RoundMachine('s');
    const seen: RoundPhase[] = [];
    m.events.on('phase', (e) => seen.push(e.phase));
    advanceTo(m, 'RESULT');
    expect(seen).toEqual(['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING', 'RESULT']);
    expect(m.next()).toBe(true);
    expect(m.phase).toBe('READY');
    expect(m.roundId).toBe(2);
  });

  it('rejects every milestone that does not belong to the current phase', () => {
    for (const phase of ROUND_PHASES) {
      const m = new RoundMachine('s');
      advanceTo(m, phase);
      const before = m.phase;
      const attempts: [RoundPhase, () => boolean][] = [
        ['DESCENDING', () => m.landed()],
        ['CLOSING', () => m.closed()],
        ['LIFTING', () => m.lifted()],
        ['TRANSPORTING', () => m.arrived()],
        ['RELEASING', () => m.released()],
      ];
      for (const [valid, attempt] of attempts) {
        if (valid === before) continue;
        expect(attempt(), `${before}: milestone of ${valid}`).toBe(false);
        expect(m.phase).toBe(before);
      }
      if (before !== 'ATTRACT') expect(m.start()).toBe(false);
      if (before !== 'RESULT') expect(m.next()).toBe(false);
      if (before !== 'READY') expect(m.beginAim()).toBe(false);
      if (before !== 'SETTLING') expect(m.finish(resultFor(m))).toBe(false);
      expect(m.phase).toBe(before);
    }
  });

  it('allows exactly one grab per round', () => {
    const m = new RoundMachine('s');
    m.start();
    expect(m.grab()).toBe(true);
    expect(m.phase).toBe('DESCENDING');
    for (const next of [() => m.landed(), () => m.closed(), () => m.lifted(), () => m.arrived(), () => m.released()]) {
      expect(m.grab()).toBe(false);
      next();
    }
    expect(m.grab()).toBe(false);
    m.finish(resultFor(m));
    expect(m.grab()).toBe(false); // RESULT
    m.next();
    expect(m.grab()).toBe(true); // a new round gets a new grab
  });

  it('grab is possible straight from READY and from AIMING but not from ATTRACT', () => {
    const a = new RoundMachine('s');
    expect(a.grab()).toBe(false);
    a.start();
    expect(a.grab()).toBe(true);
    const b = new RoundMachine('s');
    b.start();
    b.beginAim();
    expect(b.grab()).toBe(true);
  });

  it('settles a prize exactly once, only for the current round and only in award phases', () => {
    const m = new RoundMachine('sess');
    const awards: string[] = [];
    m.events.on('award', (a) => awards.push(a.prizeId));
    m.start();
    expect(m.awardPrize(m.roundId, 't', 'x')).toBeNull(); // READY
    m.grab();
    expect(m.awardPrize(m.roundId, 't', 'x')).toBeNull(); // DESCENDING
    m.landed();
    expect(m.awardPrize(m.roundId, 't', 'x')).toBeNull(); // CLOSING
    m.closed();
    expect(m.awardPrize(m.roundId + 1, 't', 'x')).toBeNull(); // wrong round
    expect(m.awardPrize(m.roundId - 1, 't', 'x')).toBeNull();
    const first = m.awardPrize(m.roundId, 'toy-1', 'sakura.bunny');
    expect(first).not.toBeNull();
    expect(first!.prizeId).toBe('sess-1');
    expect(first!.typeId).toBe('sakura.bunny');
    // Duplicate events (same or another toy) never settle again.
    expect(m.awardPrize(m.roundId, 'toy-1', 'sakura.bunny')).toBeNull();
    expect(m.awardPrize(m.roundId, 'toy-2', 'sakura.tanuki')).toBeNull();
    m.lifted();
    m.arrived();
    m.released();
    expect(m.awardPrize(m.roundId, 'toy-1', 'sakura.bunny')).toBeNull();
    m.finish(resultFor(m, 'won'));
    expect(m.awardPrize(m.roundId, 'toy-1', 'sakura.bunny')).toBeNull(); // RESULT
    expect(awards).toEqual(['sess-1']);
    m.next();
    expect(m.award).toBeNull();
    // The old round can never be settled again from a later round.
    advanceTo(m, 'LIFTING');
    expect(m.awardPrize(1, 'toy-1', 'sakura.bunny')).toBeNull();
    expect(m.awardPrize(2, 'toy-3', 'sakura.cat')!.prizeId).toBe('sess-2');
    expect(awards).toEqual(['sess-1', 'sess-2']);
  });

  it('prize ids are unique per session', () => {
    const a = new RoundMachine();
    const b = new RoundMachine();
    advanceTo(a, 'LIFTING');
    advanceTo(b, 'LIFTING');
    expect(a.awardPrize(1, 't', 'x')!.prizeId).not.toBe(b.awardPrize(1, 't', 'x')!.prizeId);
  });

  it('finishes a round once and only with the result of that round', () => {
    const m = new RoundMachine('s');
    const results: RoundResult[] = [];
    m.events.on('result', (r) => results.push(r));
    advanceTo(m, 'SETTLING');
    expect(m.finish({ ...resultFor(m), roundId: m.roundId + 1 })).toBe(false);
    expect(m.phase).toBe('SETTLING');
    expect(m.finish(resultFor(m))).toBe(true);
    expect(m.finish(resultFor(m))).toBe(false);
    expect(results).toHaveLength(1);
  });

  it('fires the watchdog once per phase and re-arms it for the next phase', () => {
    const m = new RoundMachine('s');
    const fired: RoundPhase[] = [];
    m.events.on('watchdog', (e) => fired.push(e.phase));
    m.start();
    for (let i = 0; i < 2000; i++) m.tick(0.1); // READY has no watchdog
    expect(fired).toEqual([]);
    m.grab();
    const limit = PHASE_WATCHDOG.DESCENDING!;
    for (let t = 0; t < limit + 3; t += 0.05) m.tick(0.05);
    expect(fired).toEqual(['DESCENDING']);
    m.landed();
    for (let t = 0; t < PHASE_WATCHDOG.CLOSING! + 3; t += 0.05) m.tick(0.05);
    expect(fired).toEqual(['DESCENDING', 'CLOSING']);
    for (const phase of BUSY_PHASES) expect(PHASE_WATCHDOG[phase], phase).toBeGreaterThan(0);
  });

  it('never advances phase time without a positive dt (pausing accumulates nothing)', () => {
    const m = new RoundMachine('s');
    m.start();
    m.grab();
    m.tick(0.5);
    expect(m.phaseTime).toBeCloseTo(0.5);
    for (const dt of [0, -1, Number.NaN, -0.0001]) m.tick(dt);
    expect(m.phaseTime).toBeCloseTo(0.5);
    m.landed();
    expect(m.phaseTime).toBe(0);
  });

  it('abort recovers from every phase without awarding anything', () => {
    for (const phase of ROUND_PHASES) {
      const m = new RoundMachine('s');
      const awards: unknown[] = [];
      const aborted: string[] = [];
      m.events.on('award', (a) => awards.push(a));
      m.events.on('abort', (e) => aborted.push(e.reason));
      advanceTo(m, phase);
      const before = m.roundId;
      m.abort('test');
      expect(m.phase, phase).toBe('READY');
      expect(m.roundId).toBe(before + 1);
      expect(m.demo).toBe(false);
      expect(m.award).toBeNull();
      expect(awards).toEqual([]);
      expect(aborted).toEqual(['test']);
      expect(m.grab()).toBe(true); // the fresh round is fully playable
    }
    const m = new RoundMachine('s');
    advanceTo(m, 'LIFTING');
    m.abort('to attract', 'ATTRACT');
    expect(m.phase).toBe('ATTRACT');
    expect(m.start()).toBe(true);
  });

  it('goes back to attract only between rounds', () => {
    const m = new RoundMachine('s');
    m.start();
    m.beginAim();
    expect(m.toAttract()).toBe(true);
    expect(m.phase).toBe('ATTRACT');
    m.start();
    m.grab();
    expect(m.toAttract()).toBe(false);
    expect(m.phase).toBe('DESCENDING');
    advanceToResult(m);
    expect(m.toAttract()).toBe(true);
  });

  it('flags demo rounds and reports round boundaries', () => {
    const m = new RoundMachine('s');
    expect(m.atRoundBoundary).toBe(true);
    m.start(true);
    expect(m.demo).toBe(true);
    m.grab();
    expect(m.atRoundBoundary).toBe(false);
    expect(m.busy).toBe(true);
    m.landed();
    m.closed();
    expect(m.awardPrize(m.roundId, 't', 'x')!.demo).toBe(true);
    advanceToResult(m);
    expect(m.atRoundBoundary).toBe(true);
    expect(m.busy).toBe(false);
    m.next(false);
    expect(m.demo).toBe(false);
  });
});

function advanceToResult(m: RoundMachine): void {
  m.landed();
  m.closed();
  m.lifted();
  m.arrived();
  m.released();
  m.finish(resultFor(m));
  expect(m.phase).toBe('RESULT');
}
