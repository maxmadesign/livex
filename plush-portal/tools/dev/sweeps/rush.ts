/**
 * SPARKLE RUSH sweep (docs/design/machines.md, sections 3.3 and 8.2), run through
 * tools/dev/item-sweep.ts --machine rush.
 *
 * Per difficulty and seed:
 *   - centred grabs: a fresh pile, 10 grabs aimed exactly at the attract pilot's targets (no aim
 *     noise): how many pieces one well-aimed grab delivers;
 *   - timed runs: `tries` / 13 runs of `seconds` (75) on simulated time, played by the pilot's
 *     strategy with Gaussian aim noise, the app's 0.35 s auto-advance hold in RESULT and the bin
 *     cleared at every boundary like Game does; PLAY AGAIN (newSession) between runs.
 *
 * Every scored piece must have been carried (its centre of mass rose above the 20 cm chute guard
 * at some point): a piece pushed along the floor can never get in.
 *
 * Gates: ≥ 1.2 pieces per centred grab, ≥ 70 % of run tries score, 12-16 tries per run, physics
 * step p95 ≤ 1.5 ms during play, 25-35 % of runs reach `rewardValue`, every run ends on time, no
 * anomaly. The suggested `rewardValue` is the multiple of 50 (the settings step) at which the share of
 * qualifying runs is closest to 30 %.
 */
import { THEME_IDS, type ThemeId } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { RUSH_DEFAULTS, RUSH_TUNING, rushAim, rushModule } from '../../../src/game/machines/rush';
import type { MachineDef, ResolvedMachine, RushParams, SessionSnapshot } from '../../../src/game/machines/types';
import { CHUTE, CLAW } from '../../../src/physics/fieldSpec';
import { idle, inspectWorld, makeCore, playRound, themeAssets, type Difficulty } from '../../../tests/unit/game/harness';
import type { Gate, SweepKit, SweepOptions, SweepReport } from '../item-sweep';

/** Game's auto-advance after a try while a run has time left (design section 2.6). */
const HOLD = 0.35;
const CENTRED_GRABS = 10;
const TRIES_PER_RUN_GUESS = 13;

/** The rush machine built from its module (available or not), with parameter overrides. */
export function rushMachine(params: Record<string, unknown>): ResolvedMachine {
  const o = params as Partial<RushParams>;
  const p: RushParams = { ...RUSH_DEFAULTS, ...o, claw: { ...RUSH_DEFAULTS.claw, ...(o.claw ?? {}) } };
  const def: MachineDef = { id: 'rush', genre: 'rush', order: 3, params: {}, available: false, unlockAfterWins: 5 };
  return { def, module: rushModule, params: p, geometry: rushModule.geometry(p), session: rushModule.session(p), controls: rushModule.controls(p) } as unknown as ResolvedMachine;
}

/** Highest centre of mass each piece reached (the carry check). */
function trackHeights(core: GameCore, heights: Map<string, number>): void {
  for (const toy of core.phys.toys.values()) {
    if (!toy.item) continue;
    const y = toy.body.translation().y;
    if (y > (heights.get(toy.id) ?? -Infinity)) heights.set(toy.id, y);
  }
}

export async function run(o: SweepOptions, kit: SweepKit): Promise<SweepReport[]> {
  for (const [k, v] of Object.entries(o.tune)) {
    if (!(k in RUSH_TUNING)) throw new Error(`unknown rush tuning key ${k} (have ${Object.keys(RUSH_TUNING).join(', ')})`);
    (RUSH_TUNING as Record<string, number>)[k] = v;
  }
  const themes = THEME_IDS.filter((t) => themeAssets(t).length > 0) as ThemeId[];
  const reports: SweepReport[] = [];
  for (const difficulty of o.difficulties) reports.push(await sweep(o, kit, difficulty, themes));
  return reports;
}

async function sweep(o: SweepOptions, kit: SweepKit, difficulty: Difficulty, themes: ThemeId[]): Promise<SweepReport> {
  const machine = rushMachine(o.params);
  const p = machine.params as RushParams;
  const anomalies: string[] = [];
  const centred: number[] = [];
  const perTry: number[] = [];
  const triesPerRun: number[] = [];
  const values: number[] = [];
  const runs: SessionSnapshot[] = [];
  const steps: number[] = [];
  const settleSeconds: number[] = [];
  let lateTries = 0;
  let uncarried = 0;
  const runsPerSeed = Math.max(1, Math.round(o.tries / TRIES_PER_RUN_GUESS));
  const t0 = performance.now();

  for (let si = 0; si < o.seeds.length; si++) {
    const seed = o.seeds[si]!;
    const theme = themes[si % themes.length]!;
    const label = `${difficulty}/${theme}/seed${seed}`;

    // Centred grabs on a fresh pile.
    {
      const core = await makeCore({ theme, seed, difficulty, machine });
      settleSeconds.push(core.field.settle(3));
      for (let g = 0; g < CENTRED_GRABS; g++) {
        // Single grabs, not a run: the clock is restarted each time (the pile stays as it is).
        core.session.end('abandoned');
        const plan = rushAim(core, g, p);
        if (!plan) break;
        const trace = playRound(core, plan.x, plan.z, { settleSwing: plan.patience });
        centred.push(trace.result.machine?.items.length ?? 0);
        idle(core, HOLD);
        core.field.clearBin();
      }
      core.dispose();
    }

    // Timed runs.
    const core = await makeCore({ theme, seed, difficulty, machine });
    const gauss = kit.gauss(seed * 13 + 1);
    const heights = new Map<string, number>();
    core.controller.events.on('itemScored', (e) => {
      const top = heights.get(e.toy.id) ?? -Infinity;
      if (top < CHUTE.wallHeight) {
        uncarried++;
        anomalies.push(`${label}: ${e.item.look} scored without a carry (highest centre of mass ${top.toFixed(3)} m)`);
      }
    });
    let over: SessionSnapshot | null = null;
    core.session.events.on('over', (s) => (over = s));
    for (let r = 0; r < runsPerSeed; r++) {
      if (r > 0) core.session.newSession();
      heights.clear();
      trackHeights(core, heights);
      over = null;
      let tries = 0;
      for (let guard = 0; guard < 40 && !over; guard++) {
        // A try that starts after the clock has run out is a timer defect (the run should be over).
        const snap = core.session.snapshot();
        if (snap.state === 'running' && snap.timerStarted && snap.secondsLeft === 0) {
          lateTries++;
          anomalies.push(`${label}/run${r + 1}: try ${tries + 1} starts after the clock ran out`);
        }
        const plan = rushAim(core, guard, p) ?? { x: 0.1, z: -0.45, patience: 1, targetToyId: null };
        const x = Math.min(CLAW.maxX, Math.max(CLAW.minX, plan.x + gauss() * o.noise));
        const z = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, plan.z + gauss() * o.noise));
        let trace;
        try {
          trace = playRound(core, x, z, {
            settleSwing: plan.patience,
            onStep: (c) => {
              if (c.machine.busy) steps.push(c.phys.lastStepMs);
              trackHeights(c, heights);
            },
          });
        } catch (error) {
          // A locked machine (the run ended in READY) never finishes a round: that is the end of the run.
          if (core.session.snapshot().state === 'over') break;
          anomalies.push(`${label}/run${r + 1}: ${(error as Error).message}`);
          break;
        }
        tries++;
        const n = trace.result.machine?.items.length ?? 0;
        perTry.push(n);
        if (trace.recoveries.length > 0) anomalies.push(`${label}/run${r + 1}/try${tries}: watchdog forced ${trace.recoveries.join(',')}`);
        if (o.verbose) console.log(`  ${label}/run${r + 1}/try${tries} aim ${x.toFixed(3)},${z.toFixed(3)} pieces ${n} left ${core.session.snapshot().secondsLeft?.toFixed(1)} s`);
        if (!over) {
          idle(core, HOLD);
          trackHeights(core, heights);
        }
        for (const a of inspectWorld(core)) anomalies.push(`${label}/run${r + 1}/try${tries}: ${a.kind} ${a.detail}`);
        core.field.clearBin();
      }
      const end = over as SessionSnapshot | null;
      if (!end) anomalies.push(`${label}/run${r + 1}: the run did not end`);
      else {
        runs.push(end);
        values.push(end.value);
        triesPerRun.push(end.tries);
        if (end.reason !== 'time') anomalies.push(`${label}/run${r + 1}: ended with ${end.reason}`);
      }
    }
    core.dispose();
    console.log(`  ${label}: ${runs.length} runs so far (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }

  const tries = perTry.length;
  const scoring = perTry.filter((n) => n > 0).length;
  const centredMean = kit.mean(centred);
  const triesMedian = kit.quantile(triesPerRun, 0.5);
  const p95 = kit.quantile(steps, 0.95);
  const rewarded = values.filter((v) => p.rewardValue > 0 && v >= p.rewardValue).length;
  const rewardShare = rewarded / Math.max(1, values.length);
  // The settings step is 50: the multiple of 50 whose share of qualifying runs is closest to 30 %.
  let suggestion = 50;
  for (let v = 50; v <= 5000; v += 50) {
    const share = values.filter((x) => x >= v).length / Math.max(1, values.length);
    const best = values.filter((x) => x >= suggestion).length / Math.max(1, values.length);
    if (Math.abs(share - 0.3) < Math.abs(best - 0.3)) suggestion = v;
  }
  const atSuggestion = values.filter((v) => v >= suggestion).length;
  const gates: Gate[] = [
    { name: 'pieces per centred grab', value: `${centredMean.toFixed(2)} (${centred.length} grabs)`, target: '>= 1.2', pass: centredMean >= 1.2 },
    { name: 'run tries that score', value: kit.pct(scoring, tries), target: '>= 70 %', pass: scoring / Math.max(1, tries) >= 0.7 },
    { name: `tries per ${p.seconds} s run (median)`, value: `${triesMedian} (${Math.min(...triesPerRun)}-${Math.max(...triesPerRun)})`, target: '12-16', pass: triesMedian >= 12 && triesMedian <= 16 },
    { name: 'physics step p95 during play', value: `${p95.toFixed(3)} ms`, target: '<= 1.5 ms', pass: p95 <= 1.5 },
    { name: `runs reaching rewardValue ${p.rewardValue}`, value: `${kit.pct(rewarded, values.length)} of ${values.length}`, target: '25-35 %', pass: rewardShare >= 0.25 && rewardShare <= 0.35 },
    { name: 'runs end on time (no late try)', value: `${lateTries} late tries`, target: '0', pass: lateTries === 0 },
    { name: 'pieces scored without a carry', value: String(uncarried), target: '0', pass: uncarried === 0 },
  ];
  const data: Record<string, unknown> = {
    centred: kit.histogram(centred),
    perTry: kit.histogram(perTry),
    triesPerRun: kit.histogram(triesPerRun),
    values: [...values].sort((a, b) => a - b),
    medianValue: kit.quantile(values, 0.5),
    suggestedRewardValue: suggestion,
    shareAtSuggestion: atSuggestion / Math.max(1, values.length),
    rewardTiers: kit.histogram(runs.map((s) => (s.reward ? s.reward.tier : 'none') as unknown as number)),
    settleSeconds: { max: Math.max(...settleSeconds), median: kit.quantile(settleSeconds, 0.5) },
    stepMs: { p50: kit.quantile(steps, 0.5), p95, p99: kit.quantile(steps, 0.99), max: kit.quantile(steps, 1) },
    params: { radiusScale: p.radiusScale, pieces: p.pieces, claw: p.claw, tune: { ...RUSH_TUNING } },
    noise: o.noise,
  };
  console.log(`\n  ${difficulty}: centred ${JSON.stringify(data.centred)} · per try ${JSON.stringify(data.perTry)} · tries per run ${JSON.stringify(data.triesPerRun)}`);
  console.log(`  raw values ${JSON.stringify(data.values)} · median ${data.medianValue} · suggested rewardValue ${suggestion} (${kit.pct(atSuggestion, values.length)} of runs)`);
  console.log(`  reward tiers ${JSON.stringify(data.rewardTiers)} · fresh pile settles in ${JSON.stringify(data.settleSeconds)} s`);
  if (o.perf) console.log(`  step ms (busy phases): ${JSON.stringify(data.stepMs)}`);
  return { machine: 'rush', difficulty, gates, anomalies, data };
}
