/**
 * Grab-feel measurement for the real characters, run headless:
 *
 *   npx tsx tools/dev/grip-sweep.ts                       offset sweep, Arcade, all themes
 *   npx tsx tools/dev/grip-sweep.ts --difficulty all      Easy / Arcade / Skill tables
 *   npx tsx tools/dev/grip-sweep.ts --themes sakura --seeds 3 --verbose
 *   npx tsx tools/dev/grip-sweep.ts --long 300            long-run stability (random aims)
 *   npx tsx tools/dev/grip-sweep.ts --demo 40             demo pilot win share
 *
 * Every round is a real simulation through GameCore; nothing here feeds back
 * into the game. Outcomes are whatever the physics produced.
 */
import { DemoPilot } from '../../src/app/DemoPilot';
import { makeRng } from '../../src/core/math';
import { THEME_IDS, type ThemeId } from '../../src/core/types';
import { CHUTE_CENTER, CLAW, FIXED_DT } from '../../src/physics/fieldSpec';
import { comOf, inspectWorld, insideChuteFootprint, makeCore, playRound, reachableToys, themeAssets, toysOnChuteWall, type Difficulty, type RoundTrace } from '../../tests/unit/game/harness';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};

const themes = (value('themes', THEME_IDS.join(',')).split(',') as ThemeId[]).filter((t) => THEME_IDS.includes(t));
const difficulties = (value('difficulty', 'arcade') === 'all' ? ['easy', 'arcade', 'skill'] : value('difficulty', 'arcade').split(',')) as Difficulty[];
const seeds = Array.from({ length: Number(value('seeds', '2')) }, (_, i) => 11 + i * 17);
const verbose = flag('verbose');
const OFFSETS_CM = value('offsets', '0,1.5,3,4.5,6,8,10').split(',').map(Number);

interface Tally {
  n: number;
  won: number;
  slipped: number;
  empty: number;
  reasons: Record<string, number>;
  seconds: number;
}
const newTally = (): Tally => ({ n: 0, won: 0, slipped: 0, empty: 0, reasons: {}, seconds: 0 });
function add(t: Tally, trace: RoundTrace): void {
  t.n++;
  t.seconds += trace.grabSeconds;
  const r = trace.result;
  if (r.outcome === 'won') t.won++;
  else if (r.outcome === 'slipped') {
    t.slipped++;
    const key = r.slipReason ?? 'unknown';
    t.reasons[key] = (t.reasons[key] ?? 0) + 1;
  } else t.empty++;
}
const pct = (a: number, n: number) => (n === 0 ? '  –' : `${Math.round((100 * a) / n)}%`.padStart(4));
const anomalies: string[] = [];

function checkRound(label: string, core: Awaited<ReturnType<typeof makeCore>>, trace: RoundTrace): void {
  if (trace.awards > 1) anomalies.push(`${label}: ${trace.awards} awards in one round`);
  if (trace.recoveries.length > 0) anomalies.push(`${label}: watchdog forced ${trace.recoveries.join(',')}`);
  if (trace.result.outcome === 'won') {
    if (!trace.prizeAt) anomalies.push(`${label}: won without prize detection`);
    else if (!(trace.prizeAt[1] < -0.05 && insideChuteFootprint(trace.prizeAt[0], trace.prizeAt[2]))) anomalies.push(`${label}: prize detected outside the chute at ${trace.prizeAt.map((v) => v.toFixed(2))}`);
  }
  for (const a of inspectWorld(core)) anomalies.push(`${label}: ${a.kind} ${a.detail}`);
}

async function sweep(difficulty: Difficulty): Promise<void> {
  console.log(`\n================ offset sweep · ${difficulty} ================`);
  const byOffset = new Map<number, Tally>();
  const byChar = new Map<string, Map<number, Tally>>();
  const emptyTally = newTally();
  let rounds = 0;
  const t0 = performance.now();
  for (const theme of themes) {
    const themeOffset = new Map<number, Tally>();
    for (const seed of seeds) {
      const probe = await makeCore({ theme, seed, difficulty });
      const targets = reachableToys(probe, 0.0).map((t) => ({ id: t.id, type: t.asset.id, ...comOf(t) }));
      probe.dispose();
      for (let ti = 0; ti < targets.length; ti++) {
        const target = targets[ti]!;
        for (const off of OFFSETS_CM) {
          // Two directions per offset, rotated per toy so every direction is covered across the field.
          const dirs = off === 0 ? [0] : [ti * 1.3 + off, ti * 1.3 + off + Math.PI * 0.9];
          for (const a of dirs) {
            const x = target.x + (Math.cos(a) * off) / 100;
            const z = target.z + (Math.sin(a) * off) / 100;
            if (x < CLAW.minX || x > CLAW.maxX || z < CLAW.minZ || z > CLAW.maxZ) continue;
            const core = await makeCore({ theme, seed, difficulty });
            const label = `${difficulty}/${theme}/seed${seed}/${target.type}@${off}cm`;
            let trace: RoundTrace;
            try {
              trace = playRound(core, x, z);
            } catch (error) {
              anomalies.push(`${label}: ${(error as Error).message}`);
              core.dispose();
              continue;
            }
            // Did the claw at least go for the intended toy? (Grabbing a neighbour still counts as an outcome.)
            checkRound(label, core, trace);
            for (let i = 0; i < 120; i++) core.fixedStep();
            for (const toy of toysOnChuteWall(core)) anomalies.push(`${label}: ${toy.asset.id} resting on the chute guard`);
            rounds++;
            for (const map of [byOffset, themeOffset]) {
              if (!map.has(off)) map.set(off, newTally());
              add(map.get(off)!, trace);
            }
            if (!byChar.has(target.type)) byChar.set(target.type, new Map());
            const cm = byChar.get(target.type)!;
            if (!cm.has(off)) cm.set(off, newTally());
            add(cm.get(off)!, trace);
            if (verbose) {
              const r = trace.result;
              console.log(`  ${label.padEnd(52)} ${r.outcome.padEnd(8)} ${r.contact.padEnd(8)} q=${r.gripQuality.toFixed(2)} ${r.slipReason ?? ''} got=${r.targetTypeId ?? '-'} ${trace.grabSeconds.toFixed(1)}s`);
            }
            core.dispose();
          }
        }
      }
      // Empty spots: over the chute, and in a gap made by removing the toys around the aim point.
      for (const [ex, ez, clear] of [
        [CHUTE_CENTER.x, CHUTE_CENTER.z, false],
        [0.1, -0.4, true],
        [-0.05, -0.55, true],
      ] as const) {
        const core = await makeCore({ theme, seed, difficulty });
        if (clear) for (const t of core.field.onField()) if (Math.hypot(comOf(t).x - ex, comOf(t).z - ez) < 0.24) core.phys.removeToy(t);
        const x = Math.min(CLAW.maxX, Math.max(CLAW.minX, ex));
        const z = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, ez));
        const trace = playRound(core, x, z);
        checkRound(`${difficulty}/${theme}/seed${seed}/empty(${ex},${ez})`, core, trace);
        add(emptyTally, trace);
        if (trace.result.outcome !== 'empty') anomalies.push(`${difficulty}/${theme}/seed${seed}: empty spot (${ex},${ez}) ended ${trace.result.outcome} contact=${trace.result.contact}`);
        core.dispose();
      }
    }
    console.log(`  ${theme.padEnd(10)} ${OFFSETS_CM.map((o) => `${o}cm ${pct(themeOffset.get(o)?.won ?? 0, themeOffset.get(o)?.n ?? 0)}`).join('  ')}`);
  }
  console.log(`\n  offset   n    won  slipped empty   avg s   slip reasons`);
  for (const off of OFFSETS_CM) {
    const t = byOffset.get(off) ?? newTally();
    console.log(
      `  ${`${off} cm`.padEnd(7)} ${String(t.n).padStart(4)} ${pct(t.won, t.n)} ${pct(t.slipped, t.n)}   ${pct(t.empty, t.n)}  ${(t.seconds / Math.max(1, t.n)).toFixed(1).padStart(5)}   ${Object.entries(t.reasons).map(([k, v]) => `${k}:${v}`).join(' ')}`,
    );
  }
  console.log(`  empty spots: ${emptyTally.n} rounds, ${emptyTally.empty} empty, avg ${(emptyTally.seconds / Math.max(1, emptyTally.n)).toFixed(1)} s`);
  console.log(`\n  per character (win % by offset; centred = 0 and 1.5 cm together)`);
  const rows = [...byChar.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [type, map] of rows) {
    const c0 = map.get(0) ?? newTally(), c1 = map.get(1.5) ?? newTally();
    const centred = { won: c0.won + c1.won, n: c0.n + c1.n };
    console.log(`  ${type.padEnd(24)} centred ${pct(centred.won, centred.n)} (n=${String(centred.n).padStart(2)})  ${OFFSETS_CM.filter((o) => o >= 3).map((o) => `${o}:${pct(map.get(o)?.won ?? 0, map.get(o)?.n ?? 0)}`).join(' ')}`);
  }
  console.log(`  ${rounds} rounds in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

async function longRun(count: number): Promise<void> {
  console.log(`\n================ long run · ${count} rounds per theme ================`);
  for (const theme of themes) {
    const core = await makeCore({ theme, seed: 5, difficulty: 'arcade' });
    const rng = makeRng(99);
    const tally = newTally();
    const assets = themeAssets(theme);
    const expected = 18;
    let awardedTotal = 0;
    const bodies0 = core.phys.world.bodies.len();
    const colliders0 = core.phys.world.colliders.len();
    const stepMs: number[] = [];
    let simSeconds = 0;
    for (let i = 0; i < count; i++) {
      // Half the time aim at a random toy (with a random error), otherwise anywhere.
      const toys = reachableToys(core);
      let x: number, z: number;
      if (toys.length > 0 && rng() < 0.6) {
        const t = comOf(toys[Math.floor(rng() * toys.length)]!);
        const e = rng() * 0.06, a = rng() * Math.PI * 2;
        x = t.x + Math.cos(a) * e;
        z = t.z + Math.sin(a) * e;
      } else {
        x = CLAW.minX + rng() * (CLAW.maxX - CLAW.minX);
        z = CLAW.minZ + rng() * (CLAW.maxZ - CLAW.minZ);
      }
      const label = `long/${theme}/round${i + 1}`;
      const w0 = performance.now();
      const steps0 = core.phys.stepCount;
      let trace: RoundTrace;
      try {
        trace = playRound(core, x, z);
      } catch (error) {
        anomalies.push(`${label}: ${(error as Error).message}`);
        break;
      }
      stepMs.push((performance.now() - w0) / Math.max(1, core.phys.stepCount - steps0));
      simSeconds += trace.totalSeconds;
      add(tally, trace);
      checkRound(label, core, trace);
      if (trace.result.outcome === 'won') awardedTotal++;
      // Round boundary exactly like the game: collect the bin, then restock one toy at a time.
      const inBin = core.field.inBin();
      const prizes = inBin.filter((t) => t.id === trace.result.targetToyId && trace.result.outcome === 'won').length;
      const strays = inBin.length - prizes;
      if (strays > 0 && verbose) console.log(`  ${label}: ${strays} stray toy(s) returned`);
      core.field.clearBin();
      core.controller.forgetStrays();
      let guard = 0;
      while (core.field.missing() > 0 && guard++ < 40) {
        core.field.restockOne();
        for (let s = 0; s < 50; s++) core.fixedStep();
      }
      const onField = core.field.onField().length;
      if (onField !== expected) anomalies.push(`${label}: ${onField} toys on the field, expected ${expected}`);
      for (const toy of toysOnChuteWall(core)) if (verbose) console.log(`  ${label}: ${toy.asset.id} currently on the chute guard`);
    }
    for (let s = 0; s < 240; s++) core.fixedStep();
    const stuck = toysOnChuteWall(core);
    for (const toy of stuck) anomalies.push(`long/${theme}: ${toy.asset.id} left resting on the chute guard at the end`);
    const bodies1 = core.phys.world.bodies.len();
    const colliders1 = core.phys.world.colliders.len();
    const q = Math.floor(stepMs.length / 4);
    const head = stepMs.slice(0, q).reduce((a, b) => a + b, 0) / Math.max(1, q);
    const tail = stepMs.slice(-q).reduce((a, b) => a + b, 0) / Math.max(1, q);
    if (tail > head * 1.6 + 0.05) anomalies.push(`long/${theme}: step time grew from ${head.toFixed(3)} to ${tail.toFixed(3)} ms`);
    void assets;
    console.log(
      `  ${theme.padEnd(10)} won ${pct(tally.won, tally.n)} slipped ${pct(tally.slipped, tally.n)} empty ${pct(tally.empty, tally.n)} · prizes ${awardedTotal} · bodies ${bodies0}→${bodies1} colliders ${colliders0}→${colliders1} · step ${head.toFixed(3)}→${tail.toFixed(3)} ms · ${simSeconds.toFixed(0)} s simulated · reasons ${Object.entries(tally.reasons).map(([k, v]) => `${k}:${v}`).join(' ')}`,
    );
    if (bodies1 > bodies0 + 1 || colliders1 > colliders0 + 12) anomalies.push(`long/${theme}: physics objects grew (${bodies0}→${bodies1} bodies, ${colliders0}→${colliders1} colliders)`);
    core.dispose();
  }
}

async function demoRun(count: number): Promise<void> {
  console.log(`\n================ demo pilot · ${count} rounds per theme ================`);
  for (const theme of themes) {
    const core = await makeCore({ theme, seed: 23, difficulty: 'arcade' });
    const pilot = new DemoPilot();
    const tally = newTally();
    for (let i = 0; i < count; i++) {
      let result: RoundTrace['result'] | null = null;
      const off = core.machine.events.on('result', (r) => (result = r));
      if (core.machine.phase === 'ATTRACT') core.machine.start(true);
      else if (core.machine.phase === 'RESULT') core.machine.next(true);
      pilot.reset();
      const t0 = core.time;
      for (let s = 0; s < 40 / FIXED_DT && !result; s++) {
        pilot.update(core, FIXED_DT);
        core.fixedStep();
      }
      off();
      if (!result) {
        anomalies.push(`demo/${theme}/round${i + 1}: did not finish`);
        break;
      }
      add(tally, { result, grabSeconds: core.time - t0, totalSeconds: core.time - t0, phases: [], awards: 0, recoveries: [], slip: null, prizeAt: null });
      core.field.clearBin();
      core.controller.forgetStrays();
      let guard = 0;
      while (core.field.missing() > 0 && guard++ < 40) {
        core.field.restockOne();
        for (let s = 0; s < 50; s++) core.fixedStep();
      }
    }
    console.log(`  ${theme.padEnd(10)} demo rounds ${tally.n}: won ${pct(tally.won, tally.n)} slipped ${pct(tally.slipped, tally.n)} empty ${pct(tally.empty, tally.n)} · avg ${(tally.seconds / Math.max(1, tally.n)).toFixed(1)} s`);
    core.dispose();
  }
}

if (args.includes('--long')) await longRun(Number(value('long', '300')));
else if (args.includes('--demo')) await demoRun(Number(value('demo', '40')));
else for (const d of difficulties) await sweep(d);

console.log(`\nanomalies: ${anomalies.length}`);
const grouped = new Map<string, number>();
for (const a of anomalies) {
  const key = a.replace(/seed\d+\//, '').replace(/round\d+/, 'round*');
  grouped.set(key, (grouped.get(key) ?? 0) + 1);
}
for (const [k, n] of [...grouped.entries()].slice(0, 60)) console.log(`  ${n}× ${k}`);
