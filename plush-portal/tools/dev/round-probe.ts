/** Headless probe: plays full rounds against stand-in toys and prints what happened. */
import { GameCore } from '../../src/game/GameCore';
import { initRapier } from '../../src/physics/PhysicsWorld';
import { CLAW, FIXED_DT } from '../../src/physics/fieldSpec';
import { DEFAULT_CLAW_PARAMS } from '../../src/physics/ClawRig';
import { FAKE_ASSETS } from '../../tests/unit/helpers/fakeAssets';
import type { RoundResult } from '../../src/core/types';

await initRapier();

function makeCore(seed = 7, assist = 1) {
  const core = new GameCore({
    binFloorY: -0.6,
    toyFriction: 1,
    params: { ...DEFAULT_CLAW_PARAMS, gripAssist: assist, aimTimeLimit: 0 },
    field: { count: 18, scale: 1, density: 0.2, massScale: 1, seed },
    themeId: 'sakura',
  });
  core.populate(FAKE_ASSETS, seed);
  return core;
}

/** Plays one round aiming at (x, z); returns the result. */
function playRound(core: GameCore, x: number, z: number, verbose = false): RoundResult {
  let result: RoundResult | null = null;
  const offResult = core.machine.events.on('result', (r) => (result = r));
  const offPhase = core.machine.events.on('phase', (e) => verbose && console.log(`   t=${core.time.toFixed(2)} ${e.prev} -> ${e.phase}`));
  const offGrip = core.controller.events.on('gripEvaluated', (e) =>
    verbose && console.log('   grip', e.toy?.asset.slug, e.facts && Object.fromEntries(Object.entries(e.facts).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(2)) : v]))),
  );
  const offSlip = core.controller.events.on('slipped', (e) => verbose && console.log(`   slipped: ${e.reason} in ${e.phase}`));
  if (core.machine.phase === 'ATTRACT') core.machine.start(false);
  else if (core.machine.phase === 'RESULT') core.machine.next(false);
  // Let the claw travel home, then steer to the aim point like a player would.
  let guard = 0;
  while (guard++ < 240 * 30) {
    const dx = x - core.claw.trolleyX;
    const dz = z - core.claw.trolleyZ;
    const d = Math.hypot(dx, dz);
    if (core.machine.phase === 'READY' || core.machine.phase === 'AIMING') {
      if (d > 0.004) {
        const k = Math.min(1, d / 0.05) / Math.max(d, 1e-6);
        core.controller.inputX = dx * k;
        core.controller.inputZ = dz * k;
      } else {
        core.controller.clearInput();
        if (Math.hypot(core.claw.trolleyVX, core.claw.trolleyVZ) < 0.01) core.controller.requestGrab();
      }
    }
    core.fixedStep();
    if (result) break;
  }
  offResult();
  offPhase();
  offGrip();
  offSlip();
  if (!result) throw new Error('round did not finish');
  return result;
}

const core = makeCore(7);
const toys = core.field.onField();
console.log('toys on field', toys.length, 'settled, max speed', core.phys.maxToySpeed().toFixed(3));
for (const t of toys.slice(0, 4)) console.log('  ', t.asset.slug, [...t.pose.pos].map((v) => v.toFixed(3)).join(','), 'mass', t.mass.toFixed(3));

// 1) aim straight at a toy in the middle of the field
const mid = toys.slice().sort((a, b) => Math.hypot(a.pose.pos[0]! - 0.1, a.pose.pos[2]! + 0.4) - Math.hypot(b.pose.pos[0]! - 0.1, b.pose.pos[2]! + 0.4))[0]!;
console.log('\n[centred grab] target', mid.asset.slug, mid.pose.pos[0]!.toFixed(3), mid.pose.pos[2]!.toFixed(3));
console.log(playRound(core, mid.pose.pos[0]!, mid.pose.pos[2]!, true));

// 2) grab at an empty spot (over the chute wall corner area is unreachable, pick the gap between toys)
console.log('\n[empty grab]');
const core2 = makeCore(7);
for (const t of core2.field.onField()) if (Math.hypot(t.pose.pos[0]! - 0.1, t.pose.pos[2]! + 0.4) < 0.22) core2.phys.removeToy(t);
console.log(playRound(core2, 0.1, -0.4, true));

// 3) sweep of offsets from a toy centre
console.log('\n[offset sweep]');
for (const off of [0, 0.02, 0.04, 0.06, 0.08, 0.1]) {
  const c = makeCore(11);
  const t = c.field.onField().slice().sort((a, b) => Math.hypot(a.pose.pos[0]! - 0.1, a.pose.pos[2]! + 0.4) - Math.hypot(b.pose.pos[0]! - 0.1, b.pose.pos[2]! + 0.4))[0]!;
  const r = playRound(c, t.pose.pos[0]! + off, t.pose.pos[2]!);
  console.log(`  offset ${off.toFixed(2)} -> ${r.outcome} contact=${r.contact} q=${r.gripQuality} slip=${r.slipReason ?? '-'} lifted=${r.liftedMs}ms`);
  c.dispose();
}
console.log('step ms', core.phys.lastStepMs.toFixed(3), 'sim time', core.time.toFixed(1), void CLAW, void FIXED_DT);
