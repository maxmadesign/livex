/** Headless probe of the claw rig: checks hinge direction, rope hang and finger closing. */
import { Vector3 } from 'three';
import { PhysicsWorld, initRapier } from '../../src/physics/PhysicsWorld';
import { ClawRig } from '../../src/physics/ClawRig';
import { CLAW, FIXED_DT } from '../../src/physics/fieldSpec';

await initRapier();
const phys = new PhysicsWorld({ binFloorY: -0.6, toyFriction: 1 });
const claw = new ClawRig(phys);
const tip = new Vector3();
const report = (label: string) => {
  const p = claw.hubPose.pos;
  const tips = claw.fingers.map((_, i) => {
    claw.fingerTip(i, tip);
    return `r=${Math.hypot(tip.x - p[0]!, tip.z - p[2]!).toFixed(3)} dy=${(tip.y - p[1]!).toFixed(3)}`;
  });
  console.log(
    label.padEnd(18),
    `hubY=${p[1]!.toFixed(3)} rope=${claw.ropeLength.toFixed(3)} T=${claw.tension.toFixed(2)}N`,
    `angles=${claw.fingers.map((f) => f.angle.toFixed(3)).join(',')}`,
    tips.join(' | '),
  );
};
const run = (seconds: number) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    claw.preStep();
    phys.step();
    claw.postStep();
  }
};
run(1);
report('rest open');
console.log('expected hubY', (CLAW.anchorY - CLAW.ropeMin - CLAW.hubTop).toFixed(3), 'weight', ((CLAW.hubMass + 3 * CLAW.fingerMass) * 9.81).toFixed(2));
claw.setFingers(0);
run(1);
report('closed');
claw.setFingers(1);
run(1);
report('re-open');
claw.setWinch(CLAW.ropeMax, 0.55);
let landedAt = -1;
for (let i = 0; i < 3 / FIXED_DT; i++) {
  claw.preStep();
  phys.step();
  claw.postStep();
  if (landedAt < 0 && claw.slackTime > 0.08) landedAt = i * FIXED_DT;
}
report('descended');
console.log('landed (slack) at t=', landedAt.toFixed(2), 'clearance', claw.clearanceBelow(0.3).toFixed(3));
claw.setWinch(CLAW.ropeMin, 0.42);
run(2.5);
report('lifted');
claw.setTrolleyTarget(CLAW.dropX, CLAW.dropZ, 0.42);
let maxSwing = 0;
for (let i = 0; i < 3 / FIXED_DT; i++) {
  claw.preStep();
  phys.step();
  claw.postStep();
  maxSwing = Math.max(maxSwing, Math.hypot(claw.hubPose.pos[0]! - claw.trolleyX, claw.hubPose.pos[2]! - claw.trolleyZ));
}
report('at chute');
console.log('arrived', claw.trolleyArrived(), 'max lateral swing', maxSwing.toFixed(3), 'step ms', phys.lastStepMs.toFixed(3));
