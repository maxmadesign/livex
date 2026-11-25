/**
 * TIPPY BRIDGE sweep plug-in (docs/design/machines.md, sections 3.1 and 8.2; results in
 * docs/machines/bridge.md). Run it through the shared runner:
 *
 *   npx tsx tools/dev/machine-sweep.ts --machine bridge [--difficulty all] [--seeds 8] [--tries 40] [--perf]
 *
 * Per seed one machine is played for `tries` tries by the attract pilot's strategy (bridgeAimAt)
 * with a simulated player's aim error (Gaussian, `noise` m on x and z) and the pilot's patience.
 * The box persists between tries exactly as in the game; a won box is replaced at the next READY;
 * a box flagged stuck gets "Call staff" (the seeded start pose, never an award). Then two batches of
 * single tries on fresh boxes measure the one-try win rate: one with the pilot's aim, one with
 * random aims anywhere over the box (a player hunting for a lucky one-shot).
 *
 * Gates (section 3.1): median tries per box 4-8, one-try wins < 3 %, stuck < 10 % of boxes,
 * no anomaly, median step ≤ 0.5 ms (with --perf). A win is only ever counted from the award event,
 * and every award is checked against the physical opening test at that moment.
 */
import { makeRng } from '../../../src/core/math';
import { BRIDGE_AIM, BRIDGE_DEFAULTS, BRIDGE_LAYOUT, bridgeAimAt, bridgeGeometry, bridgePit, bridgeState, boxPose, inOpening, type BridgeAimKnobs } from '../../../src/game/machines/bridge';
import { resolveMachine } from '../../../src/game/machines/registry';
import type { BridgeParams, ResolvedMachine } from '../../../src/game/machines/types';
import type { GameCore } from '../../../src/game/GameCore';
import { overOpening } from '../../../src/physics/fieldGeometry';
import { CLAW } from '../../../src/physics/fieldSpec';
import { inspectWorld, makeCore, playRound } from '../../../tests/unit/game/harness';
import { StepTimer, gate, gaussian, mean, median, num, pct, quantile, type SweepOptions, type SweepPlugin, type SweepReport } from '../machine-sweep';

const KEYS: Record<string, string> = {
  gap: 'inner gap between the bar surfaces (m)',
  barRadius: 'bar radius (m)',
  barY: 'bar centre height (m)',
  barFriction: 'bar friction',
  barCombine: "bar friction combine: 0 = average, 1 = min (the slick bar wins)",
  fenceHeight: 'fence height (m)',
  pitHalfX: 'half width of the pit along x (m)',
  centerX: 'x of the bridge centre (m)',
  boxL: 'box length along x (m)',
  boxH: 'box height (m)',
  boxW: 'box depth along z (m)',
  boxMass: 'box mass (kg)',
  boxFriction: 'box friction',
  liftDelta: 'partial lift (m)',
  startYawDeg: 'start yaw jitter (deg)',
  startJitter: 'start position jitter (m)',
  clawForce: 'claw force multiplier',
  gripAssist: 'grip assist multiplier',
  liftSpeed: 'lift speed multiplier',
  descendSpeed: 'descend speed multiplier',
  moveSpeed: 'move speed multiplier',
  closeSpeed: 'closing speed multiplier',
  ropeSwing: 'rope swing multiplier',
  inset: 'pilot: aim this far in from the end (m)',
  dz: 'pilot: aim this far towards the player from the box centre line (m)',
  end: "pilot: 'far' or 'near' end (0 = far, 1 = near)",
  patience: 'pilot: seconds to wait for the swing to calm',
  raised: 'pilot: work a box tilted more than this (deg) at its raised end (0 = never)',
  noise: 'simulated player: aim error sigma on x and z (m)',
  oneTry: 'fresh boxes per seed and batch for the one-try win rate',
};

/** The bridge machine with --set overrides applied to its parameters. */
export function bridgeMachine(set: Record<string, string>): ResolvedMachine<'bridge'> {
  if (set.barCombine !== undefined) BRIDGE_LAYOUT.barCombine = num(set, 'barCombine', 0) === 1 ? 'min' : 'average';
  if (set.fenceHeight !== undefined) BRIDGE_LAYOUT.fenceHeight = num(set, 'fenceHeight', BRIDGE_LAYOUT.fenceHeight);
  if (set.pitHalfX !== undefined) BRIDGE_LAYOUT.pitHalfX = num(set, 'pitHalfX', BRIDGE_LAYOUT.pitHalfX);
  const base = resolveMachine('bridge', undefined, { includeUnavailable: true }) as ResolvedMachine<'bridge'>;
  if (base.def.id !== 'bridge') throw new Error('the bridge genre module is not registered');
  const d = base.params;
  const claw = { ...d.claw };
  for (const k of ['clawForce', 'gripAssist', 'liftSpeed', 'descendSpeed', 'moveSpeed', 'closeSpeed', 'ropeSwing'] as const) if (set[k] !== undefined) claw[k] = num(set, k, 1);
  const params: BridgeParams = {
    ...d,
    centerX: num(set, 'centerX', d.centerX),
    gap: num(set, 'gap', d.gap),
    barRadius: num(set, 'barRadius', d.barRadius),
    barY: num(set, 'barY', d.barY),
    barFriction: num(set, 'barFriction', d.barFriction),
    box: [num(set, 'boxL', d.box[0]), num(set, 'boxH', d.box[1]), num(set, 'boxW', d.box[2])],
    boxMass: num(set, 'boxMass', d.boxMass),
    boxFriction: num(set, 'boxFriction', d.boxFriction),
    liftDelta: num(set, 'liftDelta', d.liftDelta),
    startYawDeg: num(set, 'startYawDeg', d.startYawDeg),
    startJitter: num(set, 'startJitter', d.startJitter),
    claw,
  };
  return { ...base, params, geometry: bridgeGeometry(params) };
}

function aimKnobs(set: Record<string, string>): BridgeAimKnobs {
  return {
    inset: num(set, 'inset', BRIDGE_AIM.inset),
    dz: num(set, 'dz', BRIDGE_AIM.dz),
    end: set.end === undefined ? BRIDGE_AIM.end : num(set, 'end', 0) === 1 ? 'near' : 'far',
    patience: num(set, 'patience', BRIDGE_AIM.patience),
    raisedTiltDeg: num(set, 'raised', BRIDGE_AIM.raisedTiltDeg),
  };
}

interface BoxRecord {
  seed: number;
  tries: number;
  won: boolean;
  stuck: boolean;
  staff: number;
}

/** Physics checks after a try: the world inspection plus the bridge's own (the box left the pit, a box stuck in the claw). */
function bridgeAnomalies(core: GameCore, p: BridgeParams, label: string): string[] {
  const out = inspectWorld(core).map((a) => `${label}: ${a.kind} ${a.detail}`);
  const box = bridgeState(core.phys).box;
  if (box && !box.inBin && core.phys.toys.has(box.id)) {
    const c = box.body.worldCom();
    const pit = bridgePit(p);
    const m = 0.02;
    if (c.y > -0.02 && (c.x < pit.xMin - m || c.x > pit.xMax + m || c.z < pit.zMin - m || c.z > pit.zMax + m)) out.push(`${label}: box left the pit (at ${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)})`);
    if (c.y > 0.3) out.push(`${label}: box held up at ${c.y.toFixed(3)} after the try`);
  }
  return out;
}

const plugin: SweepPlugin = {
  genre: 'bridge',
  keys: KEYS,
  async run(o: SweepOptions): Promise<SweepReport> {
    const machine = bridgeMachine(o.set);
    const p = machine.params;
    const knobs = aimKnobs(o.set);
    const sigma = num(o.set, 'noise', 0.01);
    const oneTry = num(o.set, 'oneTry', 20);
    const anomalies: string[] = [];
    const boxes: BoxRecord[] = [];
    const timer = new StepTimer();
    let tries = 0;
    let simSeconds = 0;
    let awards = 0;
    let wins = 0;
    let recoveries = 0;
    let firstTryWins = 0;
    const gains: number[] = [];
    const stuckWhy: Record<string, number> = {};

    for (const theme of o.themes) {
      for (const seed of o.seeds) {
        const core = await makeCore({ theme, seed, difficulty: o.difficulty, machine });
        const noise = gaussian(seed * 7919 + 13);
        const label = (i: number) => `${o.difficulty}/${theme}/seed${seed}/try${i + 1}`;
        let awardsHere = 0;
        let badAward = '';
        const offs = [
          core.machine.events.on('award', () => awardsHere++),
          core.controller.events.on('prizeDetected', (e) => {
            // Never a scripted win: the award must coincide with the box physically in the opening.
            if (!inOpening(core.phys, e.toy)) badAward = 'award without the opening test';
            const c = e.toy.body.worldCom();
            if (!(c.y < core.phys.opening.awardComY && overOpening(core.phys.opening, c.x, c.z))) badAward = `award outside the opening at ${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`;
          }),
        ];
        let current: BoxRecord = { seed, tries: 0, won: false, stuck: false, staff: 0 };
        for (let i = 0; i < o.tries; i++) {
          // Start the round first: a won box is only replaced at the next READY (at rest, settled).
          if (core.machine.phase === 'ATTRACT') core.machine.start(false);
          else if (core.machine.phase === 'RESULT') core.machine.next(false);
          const s = bridgeState(core.phys);
          const box = s.box;
          if (!box || box.inBin) {
            anomalies.push(`${label(i)}: no box on the bars at READY`);
            break;
          }
          const a = bridgeAimAt(p, boxPose(box), i, knobs);
          const x = Math.min(CLAW.maxX, Math.max(CLAW.minX, a.x + noise(sigma)));
          const z = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, a.z + noise(sigma)));
          awardsHere = 0;
          badAward = '';
          const t0 = core.time;
          let trace;
          try {
            trace = playRound(core, x, z, { settleSwing: knobs.patience });
          } catch (error) {
            anomalies.push(`${label(i)}: ${(error as Error).message}`);
            break;
          }
          simSeconds += core.time - t0;
          tries++;
          current.tries++;
          recoveries += trace.recoveries.length;
          if (trace.recoveries.length > 0) anomalies.push(`${label(i)}: watchdog forced ${trace.recoveries.join(',')}`);
          if (awardsHere > 1) anomalies.push(`${label(i)}: ${awardsHere} awards in one try`);
          if (badAward) anomalies.push(`${label(i)}: ${badAward}`);
          awards += awardsHere;
          const r = trace.result;
          if (r.outcome !== 'won' && r.outcome !== 'empty') anomalies.push(`${label(i)}: outcome ${r.outcome}`);
          if (r.outcome === 'won' && awardsHere !== 1) anomalies.push(`${label(i)}: won without its award`);
          if (r.machine?.progressGain !== null && r.machine?.progressGain !== undefined) gains.push(r.machine.progressGain);
          for (const x2 of bridgeAnomalies(core, p, label(i))) anomalies.push(x2);
          if (core.claw.ropeLength > CLAW.ropeMin + 0.01) anomalies.push(`${label(i)}: the try ended with the claw low (cable ${core.claw.ropeLength.toFixed(3)} m)`);
          if (o.verbose) o.log(`  ${label(i).padEnd(34)} aim ${x.toFixed(3)},${z.toFixed(3)} ${r.outcome.padEnd(5)} progress ${r.machine?.progress?.toFixed(2) ?? '  - '} gain ${r.machine?.progressGain?.toFixed(2) ?? '  - '}${r.machine?.stuck ? ' STUCK' : ''}`);
          if (r.outcome === 'won') {
            wins++;
            if (current.tries === 1 && current.staff === 0) firstTryWins++;
            current.won = true;
            boxes.push(current);
            current = { seed, tries: 0, won: false, stuck: false, staff: 0 };
          } else if (r.machine?.stuck) {
            const why = bridgeState(core.phys).stuckReason ?? 'unknown';
            stuckWhy[why] = (stuckWhy[why] ?? 0) + 1;
            current.stuck = true;
            current.staff++;
            core.field.staffReset?.();
            core.settle(1.5);
          }
          if (o.perf) {
            // A short idle window between tries measures the step cost with the box at rest and the claw home.
            for (let k = 0; k < 30; k++) timer.time(() => core.fixedStep());
          }
        }
        if (current.tries > 0) boxes.push(current);
        for (const off of offs) off();
        core.dispose();
      }
    }

    // One-try win rates on fresh boxes (each from a seeded start pose).
    let pilotOne = 0;
    let pilotOneN = 0;
    let randomOne = 0;
    let randomOneN = 0;
    for (const seed of o.seeds) {
      const core = await makeCore({ theme: o.themes[0]!, seed: seed + 1000, difficulty: o.difficulty, machine });
      const noise = gaussian(seed * 104729 + 7);
      const rng = makeRng(seed * 31 + 5);
      for (let k = 0; k < 2 * oneTry; k++) {
        core.field.resetForTakeover?.();
        core.settle(1.5);
        const box = bridgeState(core.phys).box!;
        const pose = boxPose(box);
        let x: number;
        let z: number;
        const pilot = k < oneTry;
        if (pilot) {
          const a = bridgeAimAt(p, pose, k, knobs);
          x = a.x + noise(sigma);
          z = a.z + noise(sigma);
        } else {
          x = pose.com[0] + (rng() * 2 - 1) * (p.box[0] / 2 + 0.04);
          z = pose.com[2] + (rng() * 2 - 1) * (p.box[2] / 2 + 0.06);
        }
        x = Math.min(CLAW.maxX, Math.max(CLAW.minX, x));
        z = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, z));
        const trace = playRound(core, x, z, { settleSwing: knobs.patience });
        const won = trace.result.outcome === 'won';
        if (pilot) {
          pilotOneN++;
          if (won) pilotOne++;
        } else {
          randomOneN++;
          if (won) randomOne++;
        }
        for (const x2 of bridgeAnomalies(core, p, `${o.difficulty}/oneTry/seed${seed}/${k}`)) anomalies.push(x2);
      }
      core.dispose();
    }

    const won = boxes.filter((b) => b.won);
    const unfinished = boxes.filter((b) => !b.won);
    // Unfinished boxes count as "more tries than were played" (censored), so they push the median up.
    const censored = boxes.map((b) => (b.won ? b.tries : Number.POSITIVE_INFINITY));
    const medianTries = median(censored);
    const stuckBoxes = boxes.filter((b) => b.stuck).length;
    const hist = new Map<string, number>();
    for (const b of boxes) {
      const key = b.won ? (b.tries >= 16 ? '16+' : String(b.tries)) : 'open';
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    const order = [...Array.from({ length: 15 }, (_, i) => String(i + 1)), '16+', 'open'];
    const lines = [
      `tries ${tries}, boxes ${boxes.length} (won ${won.length}, still on the bars ${unfinished.length}), awards ${awards}, sim ${(simSeconds / Math.max(1, tries)).toFixed(1)} s per try`,
      `tries per won box: median ${median(won.map((b) => b.tries)).toFixed(1)}, p25 ${quantile(won.map((b) => b.tries), 0.25).toFixed(1)}, p75 ${quantile(won.map((b) => b.tries), 0.75).toFixed(1)}, mean ${mean(won.map((b) => b.tries)).toFixed(1)}; with unfinished boxes counted as never: median ${Number.isFinite(medianTries) ? medianTries.toFixed(1) : '∞'}`,
      `histogram (tries → boxes): ${order.filter((k) => hist.has(k)).map((k) => `${k}:${hist.get(k)}`).join('  ')}`,
      `first try on a box won: ${firstTryWins}/${boxes.length}; one-try batches: pilot ${pilotOne}/${pilotOneN} (${pct(pilotOne, pilotOneN).trim()}), random aims ${randomOne}/${randomOneN} (${pct(randomOne, randomOneN).trim()})`,
      `stuck boxes ${stuckBoxes}/${boxes.length} (${pct(stuckBoxes, boxes.length).trim()}), staff resets ${boxes.reduce((a, b) => a + b.staff, 0)} (${Object.entries(stuckWhy).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), watchdog recoveries ${recoveries}`,
      `progress gain per try: median ${median(gains).toFixed(3)}, mean ${mean(gains).toFixed(3)}`,
    ];
    const metrics: Record<string, number> = {
      tries,
      boxes: boxes.length,
      boxesWon: won.length,
      medianTriesPerBox: medianTries,
      medianTriesPerWonBox: median(won.map((b) => b.tries)),
      oneTryPilot: pilotOneN ? pilotOne / pilotOneN : 0,
      oneTryRandom: randomOneN ? randomOne / randomOneN : 0,
      firstTryWins,
      stuckShare: boxes.length ? stuckBoxes / boxes.length : 0,
      anomalies: anomalies.length,
    };
    const gates = [
      gate('median tries per box', medianTries, { min: 4, max: 8 }),
      gate('one-try wins, pilot (%)', 100 * metrics.oneTryPilot!, { max: 3, unit: '%' }),
      gate('one-try wins, random aims (%)', 100 * metrics.oneTryRandom!, { max: 3, unit: '%' }),
      gate('stuck boxes (%)', 100 * metrics.stuckShare!, { max: 10, unit: '%' }),
      gate('anomalies', anomalies.length, { max: 0 }),
    ];
    if (o.perf) {
      metrics.stepMedianMs = median(timer.samples);
      metrics.stepP95Ms = quantile(timer.samples, 0.95);
      lines.push(`step cost (claw home, box at rest): median ${metrics.stepMedianMs.toFixed(3)} ms, p95 ${metrics.stepP95Ms.toFixed(3)} ms over ${timer.samples.length} steps`);
      gates.push(gate('median step (ms)', metrics.stepMedianMs, { max: 0.5, unit: ' ms' }));
    }
    const changed = Object.entries(o.set).map(([k, v]) => `${k}=${v}`);
    const title = `bridge: gap ${p.gap}, bars r ${p.barRadius} at y ${p.barY} (friction ${p.barFriction}), box ${p.box.join('×')} ${p.boxMass} kg (friction ${p.boxFriction}), lift ${p.liftDelta}, claw ${JSON.stringify(p.claw)}; pilot inset ${knobs.inset} dz ${knobs.dz} ${knobs.end} end, patience ${knobs.patience} s, aim noise ${sigma} m${changed.length ? `  [--set ${changed.join(',')}]` : ''}`;
    void BRIDGE_DEFAULTS;
    return { title, lines, metrics, gates, anomalies };
  },
};

export default plugin;
