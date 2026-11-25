/**
 * Headless tuning runner for the machines (docs/design/machines.md, section 8.2): the sweeps whose
 * gates decide when a machine may become `available`.
 *
 *   npx tsx tools/dev/machine-sweep.ts --machine shelf                 Arcade, 8 seeds, 40 tries each
 *   npx tsx tools/dev/machine-sweep.ts --machine rush --perf           + physics step timing table
 *   npx tsx tools/dev/machine-sweep.ts --machine shelf --difficulty all --seeds 3 --tries 20
 *   npx tsx tools/dev/machine-sweep.ts --machine rush --params '{"radiusScale":1.1}' --tune pitch=0.1
 *   npx tsx tools/dev/machine-sweep.ts --machine shelf --noise 0.03 --verbose --json out.json
 *
 * Options shared by every genre:
 *   --machine <id>        the machine (a genre sweep lives in tools/dev/sweeps/<genre>.ts)
 *   --difficulty <list>   easy | arcade | skill, comma separated, or all (default arcade)
 *   --seeds <n>           fields per difficulty (default 8; seeds 11, 28, 45, …)
 *   --tries <n>           tries per seed (default 40; rush: tries per seed spread over 75 s runs)
 *   --noise <m>           the simulated player's aim error, standard deviation in metres (default 0.02)
 *   --params <json>       genre parameter overrides (merged over the defaults; `claw` merged too)
 *   --tune k=v,…          numeric tuning constants of the genre (SHELF_TUNING / RUSH_TUNING)
 *   --perf                report the physics step time distribution
 *   --verbose             one line per try
 *   --json <file>         also write the report as JSON
 *
 * Every try is a real simulation through GameCore with the genre's own rules and field; nothing
 * here feeds back into the game. Exit code 1 when a gate fails or an anomaly was seen.
 *
 * This is the minimal shared runner; the bridge workstream's runner may replace it (it only needs
 * to call `run(options, kit)` of tools/dev/sweeps/<genre>.ts).
 */
import { writeFileSync } from 'node:fs';
import { makeRng } from '../../src/core/math';
import type { Difficulty } from '../../tests/unit/game/harness';

export interface SweepOptions {
  machine: string;
  difficulties: Difficulty[];
  seeds: number[];
  tries: number;
  noise: number;
  params: Record<string, unknown>;
  tune: Record<string, number>;
  perf: boolean;
  verbose: boolean;
}

export interface Gate {
  name: string;
  /** What was measured, formatted. */
  value: string;
  /** The design's target, formatted. */
  target: string;
  pass: boolean;
}

export interface SweepReport {
  machine: string;
  difficulty: Difficulty;
  gates: Gate[];
  anomalies: string[];
  /** Free-form numbers for docs/machines/<genre>.md and the JSON file. */
  data: Record<string, unknown>;
}

/** Small numeric helpers handed to every genre sweep (so the sweeps need no runtime import of this file). */
export interface SweepKit {
  /** A seeded standard normal sampler. */
  gauss(seed: number): () => number;
  quantile(values: readonly number[], q: number): number;
  mean(values: readonly number[]): number;
  pct(part: number, whole: number): string;
  /** A histogram { value: count } of integer samples. */
  histogram(values: readonly number[]): Record<string, number>;
}

export interface SweepModule {
  run(options: SweepOptions, kit: SweepKit): Promise<SweepReport[]>;
}

const SWEEPS: Record<string, () => Promise<SweepModule>> = {
  shelf: () => import('./sweeps/shelf'),
  rush: () => import('./sweeps/rush'),
};

const kit: SweepKit = {
  gauss(seed) {
    const rng = makeRng(seed >>> 0);
    return () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  },
  quantile(values, q) {
    if (values.length === 0) return NaN;
    const s = [...values].sort((a, b) => a - b);
    const pos = Math.min(s.length - 1, Math.max(0, q * (s.length - 1)));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
  },
  mean(values) {
    return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
  },
  pct(part, whole) {
    return whole === 0 ? '–' : `${((100 * part) / whole).toFixed(0)} %`;
  },
  histogram(values) {
    const out: Record<string, number> = {};
    for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
    return out;
  },
};

function parse(argv: string[]): SweepOptions & { json: string | null } {
  const value = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
  };
  const d = value('difficulty', 'arcade');
  const difficulties = (d === 'all' ? ['easy', 'arcade', 'skill'] : d.split(',')) as Difficulty[];
  const seeds = Array.from({ length: Number(value('seeds', '8')) }, (_, i) => 11 + i * 17);
  const tune: Record<string, number> = {};
  for (const pair of value('tune', '').split(',').filter(Boolean)) {
    const [key, raw] = pair.split('=');
    tune[key!] = Number(raw);
  }
  return {
    machine: value('machine', ''),
    difficulties,
    seeds,
    tries: Number(value('tries', '40')),
    noise: Number(value('noise', '0.02')),
    params: JSON.parse(value('params', '{}')) as Record<string, unknown>,
    tune,
    perf: argv.includes('--perf'),
    verbose: argv.includes('--verbose'),
    json: argv.includes('--json') ? value('json', 'machine-sweep.json') : null,
  };
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const load = SWEEPS[options.machine];
  if (!load) {
    console.error(`--machine must be one of: ${Object.keys(SWEEPS).join(', ')}`);
    process.exitCode = 2;
    return;
  }
  const t0 = performance.now();
  const reports = await (await load()).run(options, kit);
  let failed = false;
  for (const r of reports) {
    console.log(`\n================ ${r.machine} · ${r.difficulty} · gates ================`);
    for (const g of r.gates) {
      console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name.padEnd(40)} ${g.value.padEnd(22)} target ${g.target}`);
      if (!g.pass) failed = true;
    }
    console.log(`  anomalies: ${r.anomalies.length}`);
    for (const a of r.anomalies.slice(0, 30)) console.log(`    ${a}`);
    if (r.anomalies.length > 0) failed = true;
  }
  console.log(`\n(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  if (options.json) writeFileSync(options.json, `${JSON.stringify(reports, null, 1)}\n`);
  process.exitCode = failed ? 1 : 0;
}

await main();
