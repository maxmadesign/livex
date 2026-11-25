/**
 * Records the classic golden trace (docs/design/machines.md, section 2.8):
 *
 *   npx tsx tools/dev/golden-classic.ts            writes tests/unit/machines/__golden__/classic.json
 *   npx tsx tools/dev/golden-classic.ts --check    compares a fresh run with the committed file
 *
 * The fixture is what the classic machine did before the machine framework existed. Only
 * re-record it on purpose, after a deliberate change to classic gameplay, and say so in the
 * commit: tests/unit/machines/classicGolden.test.ts holds every later change to it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCore } from '../../tests/unit/game/harness';
import { GOLDEN_CASES, recordGolden, type GoldenTrace } from '../../tests/unit/machines/goldenScenario';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'tests', 'unit', 'machines', '__golden__', 'classic.json');
const check = process.argv.includes('--check');

async function main(): Promise<void> {
  const traces: GoldenTrace[] = [];
  for (const c of GOLDEN_CASES) {
    const core = await makeCore({ theme: c.theme, seed: c.seed });
    const t0 = performance.now();
    const trace = recordGolden(core, c);
    core.dispose();
    const outcomes = trace.results.map((r) => `${r.demo ? 'demo ' : ''}${r.outcome}`).join(', ');
    console.log(`${c.theme} seed ${c.seed}: ${trace.steps} steps, ${trace.poses.length} pose hashes, ${outcomes} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    traces.push(trace);
  }
  const json = `${JSON.stringify({ version: 1, traces }, null, 1)}\n`;
  if (check) {
    const same = readFileSync(out, 'utf8') === json;
    console.log(same ? 'golden trace: identical' : 'golden trace: DIFFERENT');
    process.exitCode = same ? 0 : 1;
    return;
  }
  writeFileSync(out, json);
  console.log(`wrote ${out}`);
}

await main();
