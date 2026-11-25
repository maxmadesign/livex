/**
 * TUMBLE SHELF sweep (docs/design/machines.md, sections 3.2 and 8.2), run through
 * tools/dev/machine-sweep.ts --machine shelf.
 *
 * Per difficulty and seed: a fresh shelf (themes rotate per seed; physics does not depend on the
 * prints), a stability check of every fresh stack layout (5 s idle), then `tries` tries played in
 * sessions of `tries` (5) by the attract pilot's strategy with Gaussian aim noise, the app's
 * auto-advance hold in RESULT (1.15 s, or 2.0 s after items) and the bin cleared at every boundary
 * like Game does. PLAY AGAIN (newSession) after each finished session.
 *
 * Gates: 0.8-1.6 items per try, at least 35 % of tries score, 30-60 % of sessions reach
 * `rewardItems`, stacks stable (< 2 mm in 5 s), nothing rests on the gutter, no anomaly.
 */
import { THEME_IDS, type ThemeId } from '../../../src/core/types';
import type { GameCore } from '../../../src/game/GameCore';
import { SHELF_DEFAULTS, SHELF_TUNING, shelfAim, shelfModule } from '../../../src/game/machines/shelf';
import type { MachineDef, ResolvedMachine, SessionSnapshot, ShelfParams } from '../../../src/game/machines/types';
import { overOpening } from '../../../src/physics/fieldGeometry';
import { CLAW } from '../../../src/physics/fieldSpec';
import { idle, inspectWorld, makeCore, playRound, themeAssets, type Difficulty } from '../../../tests/unit/game/harness';
import type { Gate, SweepKit, SweepOptions, SweepReport } from '../machine-sweep';

/** --aim pilot (default: the attract pilot's drag aim) or stack (straight at the box). */
const aimMode = (): string => (process.argv.includes('--aim') ? (process.argv[process.argv.indexOf('--aim') + 1] ?? 'pilot') : 'pilot');

/** Game's auto-advance after a try on an items machine (design section 2.6). */
const HOLD_EMPTY = 1.15;
const HOLD_ITEMS = 2.0;

/** The shelf machine built from its module (available or not), with parameter overrides. */
export function shelfMachine(params: Record<string, unknown>): ResolvedMachine {
  const o = params as Partial<ShelfParams>;
  const p: ShelfParams = { ...SHELF_DEFAULTS, ...o, claw: { ...SHELF_DEFAULTS.claw, ...(o.claw ?? {}) } };
  const def: MachineDef = { id: 'shelf', genre: 'shelf', order: 2, params: {}, available: false, unlockAfterWins: 3 };
  return { def, module: shelfModule, params: p, geometry: shelfModule.geometry(p), session: shelfModule.session(p), controls: shelfModule.controls(p) } as unknown as ResolvedMachine;
}

/** Largest displacement (m) of any body over `seconds` of idling, and which body it was. */
export function stability(core: GameCore, seconds = 5): { move: number; who: string } {
  const before = new Map<string, [number, number, number]>();
  for (const t of core.phys.toys.values()) {
    const p = t.body.translation();
    before.set(t.id, [p.x, p.y, p.z]);
  }
  idle(core, seconds);
  let worst = 0;
  let who = '';
  for (const t of core.phys.toys.values()) {
    const a = before.get(t.id);
    if (!a) continue;
    const p = t.body.translation();
    const d = Math.hypot(p.x - a[0], p.y - a[1], p.z - a[2]);
    if (d > worst) {
      worst = d;
      who = `${t.item?.look ?? t.asset.id} from ${a.map((v) => v.toFixed(3)).join(',')}`;
    }
  }
  return { move: worst, who };
}

export async function run(o: SweepOptions, kit: SweepKit): Promise<SweepReport[]> {
  for (const [k, v] of Object.entries(o.tune)) {
    if (!(k in SHELF_TUNING)) throw new Error(`unknown shelf tuning key ${k} (have ${Object.keys(SHELF_TUNING).join(', ')})`);
    (SHELF_TUNING as Record<string, number>)[k] = v;
  }
  const themes = THEME_IDS.filter((t) => themeAssets(t).length > 0) as ThemeId[];
  const reports: SweepReport[] = [];
  for (const difficulty of o.difficulties) reports.push(await sweep(o, kit, difficulty, themes));
  return reports;
}

async function sweep(o: SweepOptions, kit: SweepKit, difficulty: Difficulty, themes: ThemeId[]): Promise<SweepReport> {
  const machine = shelfMachine(o.params);
  const p = machine.params as ShelfParams;
  const aim = aimMode();
  const anomalies: string[] = [];
  const perTry: number[] = [];
  const sessions: SessionSnapshot[] = [];
  const tiers: Record<string, number> = {};
  const steps: number[] = [];
  const grabSeconds: number[] = [];
  let worstMove = 0;
  let fills = 0;
  let gutterRests = 0;
  let viaGutter = 0;
  const t0 = performance.now();
  for (let si = 0; si < o.seeds.length; si++) {
    const seed = o.seeds[si]!;
    const theme = themes[si % themes.length]!;
    const core = await makeCore({ theme, seed, difficulty, machine });
    const label = `${difficulty}/${theme}/seed${seed}`;
    const checkFill = () => {
      const { move, who } = stability(core);
      worstMove = Math.max(worstMove, move);
      fills++;
      if (move > 0.002) anomalies.push(`${label}/fill${fills}: a fresh layout moved ${(move * 1000).toFixed(1)} mm in 5 s idle (${who}; claw at ${core.claw.trolleyX.toFixed(2)},${core.claw.trolleyZ.toFixed(2)})`);
    };
    checkFill();
    const gauss = kit.gauss(seed * 7 + 3);
    // Items seen on the gutter (to show the drain works) and scored outside the opening (an anomaly).
    const onGutter = new Set<string>();
    core.controller.events.on('itemScored', (e) => {
      const c = e.toy.body.worldCom();
      const o2 = core.phys.opening;
      if (!(c.y < o2.awardComY && (overOpening(o2, c.x, c.z) || c.y < o2.sensorTop))) anomalies.push(`${label}: item scored outside the trough at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`);
      if (onGutter.has(e.toy.id)) viaGutter++;
    });
    core.session.events.on('over', (s) => {
      sessions.push(s);
      if (s.reward) tiers[s.reward.tier] = (tiers[s.reward.tier] ?? 0) + 1;
    });
    for (let t = 0; t < o.tries; t++) {
      if (core.session.snapshot().state === 'over') {
        core.session.newSession();
        checkFill();
      }
      const plan = shelfAim(core, t, p) ?? { x: 0, z: -0.36, patience: 1.5, targetToyId: null };
      // --aim stack: a player who aims straight at the pilot's box instead of dragging it.
      const target = aim === 'stack' && plan.targetToyId ? core.phys.toys.get(plan.targetToyId) : undefined;
      const ax = target ? target.body.translation().x : plan.x;
      const az = target ? target.body.translation().z : plan.z;
      const x = Math.min(CLAW.maxX, Math.max(CLAW.minX, ax + gauss() * o.noise));
      const z = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, az + gauss() * o.noise));
      let trace;
      try {
        trace = playRound(core, x, z, {
          settleSwing: plan.patience,
          onStep: (c) => {
            if (o.perf && c.machine.busy) steps.push(c.phys.lastStepMs);
            for (const toy of c.phys.toys.values()) {
              if (toy.inBin || !toy.item) continue;
              const com = toy.body.translation();
              if (com.x > 0 && com.z > p.shelfFront && com.y < p.shelfY && com.y > 0) onGutter.add(toy.id);
            }
          },
        });
      } catch (error) {
        anomalies.push(`${label}/try${t + 1}: ${(error as Error).message}`);
        break;
      }
      const n = trace.result.machine?.items.length ?? 0;
      perTry.push(n);
      grabSeconds.push(trace.grabSeconds);
      if (trace.recoveries.length > 0) anomalies.push(`${label}/try${t + 1}: watchdog forced ${trace.recoveries.join(',')}`);
      if (!['won', 'empty'].includes(trace.result.outcome)) anomalies.push(`${label}/try${t + 1}: outcome ${trace.result.outcome}`);
      // The app's auto-advance hold: anything still falling lands (or is scored at the next READY).
      idle(core, n > 0 ? HOLD_ITEMS : HOLD_EMPTY);
      for (const a of inspectWorld(core)) anomalies.push(`${label}/try${t + 1}: ${a.kind} ${a.detail}`);
      // Nothing that left the shelf may come to rest outside the opening (the gutter drains, the trough has no floor).
      for (const toy of core.field.onField()) {
        const c = toy.body.translation();
        const v = toy.body.linvel();
        if (c.z > p.shelfFront && c.y < p.shelfY && Math.hypot(v.x, v.y, v.z) < 0.02) {
          gutterRests++;
          anomalies.push(`${label}/try${t + 1}: ${toy.item?.look} at rest in front of the shelf at ${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`);
        }
      }
      if (o.verbose) console.log(`  ${label}/try${t + 1} aim ${x.toFixed(3)},${z.toFixed(3)} items ${n} contact ${trace.result.contact} ${trace.grabSeconds.toFixed(1)} s`);
      core.field.clearBin();
    }
    core.dispose();
    console.log(`  ${label}: ${perTry.length} tries so far, ${sessions.length} sessions (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }

  const tries = perTry.length;
  const items = perTry.reduce((a, b) => a + b, 0);
  const scoring = perTry.filter((n) => n > 0).length;
  const reached = sessions.filter((s) => s.items >= p.rewardItems).length;
  const itemsPerTry = items / Math.max(1, tries);
  const scoringShare = scoring / Math.max(1, tries);
  const reachShare = reached / Math.max(1, sessions.length);
  const gates: Gate[] = [
    { name: 'items per try', value: itemsPerTry.toFixed(2), target: '0.8-1.6', pass: itemsPerTry >= 0.8 && itemsPerTry <= 1.6 },
    { name: 'tries that score', value: kit.pct(scoring, tries), target: '>= 35 %', pass: scoringShare >= 0.35 },
    { name: `sessions reaching ${p.rewardItems} boxes`, value: `${kit.pct(reached, sessions.length)} of ${sessions.length}`, target: '30-60 %', pass: reachShare >= 0.3 && reachShare <= 0.6 },
    { name: 'stacks stable (worst 5 s idle move)', value: `${(worstMove * 1000).toFixed(2)} mm, ${fills} fills`, target: '< 2 mm', pass: worstMove < 0.002 },
    { name: 'items at rest in front of the shelf', value: String(gutterRests), target: '0 (gutter drains)', pass: gutterRests === 0 },
  ];
  const data: Record<string, unknown> = {
    tries,
    items,
    perTry: kit.histogram(perTry),
    sessionItems: kit.histogram(sessions.map((s) => s.items)),
    rewardTiers: tiers,
    viaGutter,
    grabSeconds: { median: kit.quantile(grabSeconds, 0.5), p95: kit.quantile(grabSeconds, 0.95) },
    params: { lipHeight: p.lipHeight, shelfFriction: p.shelfFriction, claw: p.claw, tune: { ...SHELF_TUNING } },
    noise: o.noise,
    aim,
  };
  if (o.perf) data.stepMs = { p50: kit.quantile(steps, 0.5), p95: kit.quantile(steps, 0.95), max: kit.quantile(steps, 1) };
  console.log(`\n  ${difficulty}: per try ${JSON.stringify(data.perTry)} · per session ${JSON.stringify(data.sessionItems)} · reward tiers ${JSON.stringify(tiers)} · scored via the gutter ${viaGutter}`);
  if (o.perf) console.log(`  step ms (busy phases): ${JSON.stringify(data.stepMs)}`);
  return { machine: 'shelf', difficulty, gates, anomalies, data };
}
