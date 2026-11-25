/**
 * The classic golden scenario (docs/design/machines.md, section 2.8): a fixed script of player
 * rounds, restocks, attract demo rounds and a takeover, run on the real classic machine. Every
 * result, award, phase change and controller event is recorded together with a hash of the pose
 * of every rigid body every 30 fixed steps.
 *
 * The trace was recorded on the tree before the machine framework existed
 * (tools/dev/golden-classic.ts writes tests/unit/machines/__golden__/classic.json), so any change
 * to the classic simulation (the Rapier creation order, a moved statement in the round
 * controller, a different restock) shows up as a mismatch.
 */
import { DemoPilot } from '../../../src/app/DemoPilot';
import type { RoundPhase, RoundResult, ThemeId } from '../../../src/core/types';
import { AttractDirector } from '../../../src/game/attract';
import type { GameCore } from '../../../src/game/GameCore';
import type { PrizeAward } from '../../../src/game/RoundMachine';
import { FIXED_DT } from '../../../src/physics/fieldSpec';
import { playRound } from '../game/harness';

export interface GoldenAim {
  label: 'win' | 'slip' | 'empty';
  x: number;
  z: number;
}

export interface GoldenCase {
  theme: ThemeId;
  seed: number;
  /** Three player rounds, in order (each one starts on the field the previous one left). */
  aims: readonly GoldenAim[];
}

/** Fixed aims, found once on the untouched tree (each label is what the round really produced there). */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    theme: 'sakura',
    seed: 7,
    aims: [
      { label: 'win', x: 0.003, z: -0.402 },
      { label: 'slip', x: 0.2105, z: -0.392 },
      { label: 'empty', x: -0.1, z: -0.13 },
    ],
  },
  {
    theme: 'gpu',
    seed: 3,
    aims: [
      { label: 'win', x: -0.005, z: -0.406 },
      { label: 'slip', x: 0.2235, z: -0.401 },
      { label: 'empty', x: 0.36, z: -0.13 },
    ],
  },
];

/** How often the body poses are hashed (fixed steps). */
export const POSE_EVERY = 30;

export interface GoldenCounts {
  toys: number;
  bodies: number;
  colliders: number;
}

export interface GoldenTrace {
  theme: ThemeId;
  seed: number;
  /** Hash of every body pose right after the field was filled and settled. */
  fill: string;
  start: GoldenCounts;
  results: RoundResult[];
  awards: PrizeAward[];
  /** `<step>:<event>` for every phase change and controller event, in order. */
  timeline: string[];
  /** Pose hash of every rigid body, every POSE_EVERY steps. */
  poses: string[];
  /** Hash right after the takeover reset the field. */
  takeover: string;
  end: GoldenCounts;
  steps: number;
}

/* ------------------------------------------------------------------ hashing */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fold(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

/** A value rounded to 1e-9 as text ("-0" folds like "0"). */
function q(v: number): string {
  return String(Math.round(v * 1e9) || 0);
}

/** FNV-1a over the pose of every rigid body of the world, in the world's own order. */
export function poseHash(core: GameCore): string {
  let h = FNV_OFFSET;
  core.phys.world.forEachRigidBody((body) => {
    const t = body.translation();
    const r = body.rotation();
    h = fold(h, `${q(t.x)},${q(t.y)},${q(t.z)},${q(r.x)},${q(r.y)},${q(r.z)},${q(r.w)};`);
  });
  return h.toString(16).padStart(8, '0');
}

export function counts(core: GameCore): GoldenCounts {
  return { toys: core.phys.toys.size, bodies: core.phys.world.bodies.len(), colliders: core.phys.world.colliders.len() };
}

/* ------------------------------------------------------------------ script */

/** Toy ids may carry a stack prefix (`e2-toy-7`); the trace keeps the plain part. */
export function plainToyId(id: string | null): string | null {
  return id === null ? null : id.replace(/^e\d+-/, '');
}

/**
 * Runs the golden script on a core that was just populated (phase ATTRACT, nothing played yet).
 * Every step goes through core.fixedStep(), exactly like the game.
 */
export function recordGolden(core: GameCore, c: GoldenCase): GoldenTrace {
  const m = core.machine;
  // Read through a function: the checks below must not narrow the phase for the rest of the script.
  const phase = (): RoundPhase => m.phase;
  if (phase() !== 'ATTRACT') throw new Error(`golden: the core must start in ATTRACT (is ${phase()})`);
  let steps = 0;
  const poses: string[] = [];
  const timeline: string[] = [];
  const results: RoundResult[] = [];
  const awards: PrizeAward[] = [];
  const note = (text: string) => timeline.push(`${steps}:${text}`);
  const afterStep = () => {
    steps++;
    if (steps % POSE_EVERY === 0) poses.push(poseHash(core));
  };
  const step = () => {
    core.fixedStep();
    afterStep();
  };

  const ce = core.controller.events;
  const offs = [
    m.events.on('phase', (e) => note(`${e.prev}>${e.phase}${e.demo ? ' demo' : ''}`)),
    m.events.on('award', (a) => {
      awards.push({ ...a, toyId: plainToyId(a.toyId)! });
      note(`award ${a.typeId}`);
    }),
    m.events.on('result', (r) => {
      results.push({ ...r, targetToyId: plainToyId(r.targetToyId) });
      note(`result ${r.outcome}`);
    }),
    m.events.on('abort', (e) => note(`abort ${e.reason}`)),
    m.events.on('watchdog', (e) => note(`watchdog ${e.phase}`)),
    ce.on('grabStarted', (e) => note(`grabStarted ${e.nearest?.typeId ?? '-'}`)),
    ce.on('clawTouch', (e) => note(`clawTouch ${e.onToy}`)),
    ce.on('gripEvaluated', (e) => note(`gripEvaluated ${e.toy ? e.toy.asset.id : '-'} ${e.facts ? q(e.facts.quality) : '-'}`)),
    ce.on('liftStarted', (e) => note(`liftStarted ${e.holding}`)),
    ce.on('slipped', (e) => note(`slipped ${e.reason} ${e.phase}`)),
    ce.on('released', (e) => note(`released ${e.holding}`)),
    ce.on('prizeDetected', (e) => note(`prizeDetected ${e.toy.asset.id}`)),
    ce.on('strayInBin', (e) => note(`strayInBin ${e.toy.asset.id}`)),
    ce.on('recovered', (e) => note(`recovered ${e.phase}`)),
  ];

  /** Between rounds the game clears the bin and drops replacement toys in one by one. */
  const restock = () => {
    const cleared = core.field.clearBin().length;
    core.controller.forgetStrays();
    let added = 0;
    for (let guard = 0; core.field.missing() > 0 && guard < 40; guard++) {
      if (!core.field.restockOne()) break;
      added++;
      for (let s = 0; s < 50; s++) step();
    }
    note(`restock -${cleared} +${added}`);
  };

  const fill = poseHash(core);
  const start = counts(core);

  // Three player rounds at fixed aims.
  for (const aim of c.aims) {
    playRound(core, aim.x, aim.z, { onStep: afterStep });
    restock();
  }

  // Attract mode: demo rounds by the pilot, then a player takes over in the middle of the second one.
  m.toAttract();
  const director = new AttractDirector(core);
  const pilot = new DemoPilot();
  let demosEnded = 0;
  let demoRounds = 0;
  const cap = Math.round(90 / FIXED_DT);
  for (let i = 0; i < cap; i++) {
    if (m.demo) pilot.update(core, FIXED_DT);
    step();
    const flow = director.update(FIXED_DT, { demoEnabled: true, firstDemo: false, restockPending: false });
    if (flow === 'demoStarted') {
      demoRounds++;
      pilot.reset();
    } else if (flow === 'demoEnded') {
      demosEnded++;
      restock();
    }
    if (demoRounds === 2 && demosEnded === 1 && (phase() === 'LIFTING' || phase() === 'TRANSPORTING')) break;
  }
  note(`takeover ${phase()}`);
  director.leave();
  const takeover = poseHash(core);
  for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step();

  for (const off of offs) off();
  return { theme: c.theme, seed: c.seed, fill, start, results, awards, timeline, poses, takeover, end: counts(core), steps };
}

/**
 * The part of a trace that no demo-pilot choice can influence: the fill, the three player rounds
 * and their restocks, up to the step at which the first demo round starts. The pilot's variety
 * term reads `toy.id.length` and the round id (src/app/DemoPilot.ts), both of which legitimately
 * differ after a machine switch (toy ids carry the stack prefix, round ids keep counting), so its
 * picks may differ while the physics is identical (docs/design/machines.md, V13).
 */
export function beforeDemos(trace: GoldenTrace): unknown {
  const line = trace.timeline.find((l) => l.endsWith('ATTRACT>READY demo'));
  const step = line ? Number(line.split(':')[0]) : trace.steps;
  const c = comparable(trace) as GoldenTrace;
  return {
    fill: c.fill,
    start: c.start,
    demoStartsAt: step,
    results: c.results.filter((r) => !r.demo),
    awards: c.awards.filter((a) => !a.demo),
    timeline: c.timeline.filter((l) => Number(l.split(':')[0]) <= step),
    poses: c.poses.slice(0, Math.floor(step / POSE_EVERY)),
  };
}

/** The trace without what keeps counting across machine switches by design (round ids, prize ids). */
export function comparable(trace: GoldenTrace): unknown {
  return {
    ...trace,
    results: trace.results.map(({ roundId, prizeId, ...rest }) => ({ ...rest, won: prizeId !== null })),
    awards: trace.awards.map(({ roundId, prizeId, ...rest }) => rest),
  };
}
