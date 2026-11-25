/**
 * Headless tuning runner for the machine genres (docs/design/machines.md, section 8.2):
 *
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge                    Arcade, 8 seeds × 40 tries
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge --difficulty all   Easy / Arcade / Skill
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge --seeds 3 --tries 20 --verbose
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge --set boxMass=0.5,liftDelta=0.06 --perf
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge --json out.json    the report as JSON too
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge --seedBase 500     another set of seeds (11 by default)
 *
 * Every try is a real simulation through GameCore (tests/unit/game/harness.ts), like
 * tools/dev/grip-sweep.ts; nothing here feeds back into the game. Each genre has a plug-in in
 * tools/dev/sweeps/<genre>.ts that plays its machine with its pilot and returns metrics and the
 * design's gates; this file parses the options, runs the plug-in per difficulty and prints the
 * tables. The exit code is 1 when a gate fails or an anomaly was seen (so it can gate a merge).
 *
 * `--set key=value,…` passes overrides to the plug-in (genre parameters or pilot knobs; each
 * plug-in documents its keys). The gates are only meaningful without overrides.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeRng } from '../../src/core/math';
import type { ThemeId } from '../../src/core/types';
import type { GenreId } from '../../src/game/machines/ids';
import type { Difficulty } from '../../tests/unit/game/harness';

/* ------------------------------------------------------------ the plug-in contract */

export interface SweepOptions {
  difficulty: Difficulty;
  /** Field seeds, one simulated machine each. */
  seeds: number[];
  /** Tries per seed (the plug-in decides what a try is). */
  tries: number;
  themes: ThemeId[];
  /** Measure the wall-clock cost of every fixed step. */
  perf: boolean;
  verbose: boolean;
  /** --set overrides (raw strings; the plug-in parses its own keys). */
  set: Record<string, string>;
  log: (line: string) => void;
}

export interface Gate {
  name: string;
  value: number;
  /** Inclusive bounds; absent = unbounded on that side. */
  min?: number;
  max?: number;
  unit?: string;
  pass: boolean;
}

export interface SweepReport {
  /** One line describing what was played (machine, parameters, pilot). */
  title: string;
  /** Free-form table lines printed under the title. */
  lines: string[];
  metrics: Record<string, number>;
  gates: Gate[];
  /** Every problem seen (NaN poses, escaped bodies, awards outside the sensor, double awards…). */
  anomalies: string[];
}

export interface SweepPlugin {
  genre: GenreId;
  /** Keys understood by --set, with a short description each. */
  keys: Record<string, string>;
  run(options: SweepOptions): Promise<SweepReport>;
}

/* ------------------------------------------------------------ helpers for plug-ins */

export function gate(name: string, value: number, bounds: { min?: number; max?: number; unit?: string }): Gate {
  const pass = Number.isFinite(value) && (bounds.min === undefined || value >= bounds.min) && (bounds.max === undefined || value <= bounds.max);
  return { name, value, ...bounds, pass };
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** Linear-interpolated quantile; NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Deterministic Gaussian noise (Box–Muller on the project RNG), for a simulated player's aim error. */
export function gaussian(seed: number): (sigma: number) => number {
  const rng = makeRng(seed);
  return (sigma) => {
    const u = Math.max(1e-12, rng());
    const v = rng();
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export function pct(part: number, whole: number): string {
  return whole === 0 ? '   –' : `${((100 * part) / whole).toFixed(1)}%`.padStart(6);
}

/** Parses a --set value as a number (throws on garbage, so a typo never runs a silent default). */
export function num(set: Record<string, string>, key: string, fallback: number): number {
  const raw = set[key];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`--set ${key}=${raw}: not a number`);
  return v;
}

/** Wall-clock step timer for --perf. */
export class StepTimer {
  readonly samples: number[] = [];
  time<T>(fn: () => T): T {
    const t0 = performance.now();
    const out = fn();
    this.samples.push(performance.now() - t0);
    return out;
  }
}

/* ------------------------------------------------------------ the runner */

const GENRE_PLUGINS: Partial<Record<GenreId, string>> = { bridge: './sweeps/bridge.ts', shelf: './sweeps/shelf.ts', rush: './sweeps/rush.ts' };

function parseArgs(argv: string[]) {
  const value = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : def;
  };
  const set: Record<string, string> = {};
  for (const pair of value('set', '').split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    if (!k || v === undefined) throw new Error(`--set: expected key=value, got "${pair}"`);
    set[k.trim()] = v.trim();
  }
  const d = value('difficulty', 'arcade');
  return {
    machine: value('machine', 'bridge'),
    difficulties: (d === 'all' ? ['easy', 'arcade', 'skill'] : d.split(',')) as Difficulty[],
    seeds: Array.from({ length: Number(value('seeds', '8')) }, (_, i) => Number(value('seedBase', '11')) + i * 17),
    tries: Number(value('tries', '40')),
    themes: value('themes', 'sakura').split(',') as ThemeId[],
    perf: argv.includes('--perf'),
    verbose: argv.includes('--verbose'),
    json: value('json', ''),
    set,
  };
}

function formatGate(g: Gate): string {
  const bound = g.min !== undefined && g.max !== undefined ? `${g.min} … ${g.max}` : g.min !== undefined ? `≥ ${g.min}` : g.max !== undefined ? `≤ ${g.max}` : '';
  const v = Number.isInteger(g.value) ? String(g.value) : g.value.toFixed(3);
  return `  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name.padEnd(34)} ${`${v}${g.unit ?? ''}`.padStart(10)}   (${bound}${g.unit ?? ''})`;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const a = parseArgs(argv);
  const genre = a.machine as GenreId;
  const path = GENRE_PLUGINS[genre];
  if (!path) throw new Error(`no sweep plug-in for machine "${a.machine}" (known: ${Object.keys(GENRE_PLUGINS).join(', ')})`);
  const plugin = ((await import(path)) as { default: SweepPlugin }).default;
  for (const key of Object.keys(a.set)) if (!(key in plugin.keys)) throw new Error(`--set ${key}: unknown key for ${genre} (known: ${Object.keys(plugin.keys).join(', ')})`);
  const reports: { difficulty: Difficulty; report: SweepReport; seconds: number }[] = [];
  let failed = false;
  for (const difficulty of a.difficulties) {
    const t0 = performance.now();
    const report = await plugin.run({ difficulty, seeds: a.seeds, tries: a.tries, themes: a.themes, perf: a.perf, verbose: a.verbose, set: a.set, log: (l) => console.log(l) });
    const seconds = (performance.now() - t0) / 1000;
    reports.push({ difficulty, report, seconds });
    console.log(`\n================ ${genre} · ${difficulty} · ${a.seeds.length} seeds × ${a.tries} tries · ${seconds.toFixed(0)} s ================`);
    console.log(report.title);
    for (const l of report.lines) console.log(l);
    console.log('gates:');
    for (const g of report.gates) console.log(formatGate(g));
    console.log(`anomalies: ${report.anomalies.length === 0 ? 'none' : report.anomalies.length}`);
    for (const x of report.anomalies.slice(0, 30)) console.log(`  ${x}`);
    if (report.gates.some((g) => !g.pass) || report.anomalies.length > 0) failed = true;
  }
  if (Object.keys(a.set).length > 0) console.log(`\n(overrides: ${Object.entries(a.set).map(([k, v]) => `${k}=${v}`).join(', ')}; the gates only hold for the defaults)`);
  if (a.json) writeFileSync(a.json, JSON.stringify({ machine: genre, seeds: a.seeds, tries: a.tries, set: a.set, reports }, null, 2));
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(2);
    },
  );
}
