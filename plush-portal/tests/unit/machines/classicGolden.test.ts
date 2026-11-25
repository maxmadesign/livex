/**
 * Classic stays bit-identical (docs/design/machines.md, section 2.8): a fresh classic machine
 * replays the golden script exactly as the tree did before the machine framework existed. The
 * fixture is written by tools/dev/golden-classic.ts; a mismatch here means classic gameplay
 * changed, which no machine work may do.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameCore } from '../../../src/game/GameCore';
import { makeCore } from '../game/harness';
import { GOLDEN_CASES, recordGolden, type GoldenTrace } from './goldenScenario';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, '__golden__', 'classic.json'), 'utf8')) as { version: number; traces: GoldenTrace[] };

const cores: GameCore[] = [];
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
});

describe('classic golden trace', () => {
  it('covers both recorded cases', () => {
    expect(golden.version).toBe(1);
    expect(golden.traces.map((t) => `${t.theme}/${t.seed}`)).toEqual(GOLDEN_CASES.map((c) => `${c.theme}/${c.seed}`));
  });

  for (const c of GOLDEN_CASES) {
    it(`${c.theme} seed ${c.seed}: a fresh classic machine replays the fixture bit for bit`, { timeout: 120_000 }, async () => {
      const expected = golden.traces.find((t) => t.theme === c.theme && t.seed === c.seed)!;
      const core = await makeCore({ theme: c.theme, seed: c.seed });
      cores.push(core);
      const trace = recordGolden(core, c);
      // The labels the aims were chosen for still hold (a readable failure before the hashes).
      expect(trace.results.slice(0, 3).map((r) => r.outcome)).toEqual(c.aims.map((a) => (a.label === 'win' ? 'won' : a.label === 'slip' ? 'slipped' : 'empty')));
      expect(trace.fill).toBe(expected.fill);
      expect(trace.start).toEqual(expected.start);
      expect(trace.results).toEqual(expected.results);
      expect(trace.awards).toEqual(expected.awards);
      expect(trace.timeline).toEqual(expected.timeline);
      expect(trace.poses).toEqual(expected.poses);
      expect(trace.takeover).toBe(expected.takeover);
      expect(trace.end).toEqual(expected.end);
      expect(trace).toEqual(expected);
    });
  }
});
