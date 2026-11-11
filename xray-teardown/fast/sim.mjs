// Runs the patched page's quality governor against simulated computers of different speed and prints what it
// settles on. It reads the governor straight out of the built page, so it tests the code that ships.
//
//   node sim.mjs "<X-Ray Mirror (fast).html>"
//
// The cost model is crude on purpose (fixed tracker times, drawing time proportional to the pixel count). It is
// for checking that the governor converges and does not flip back and forth, not for predicting frame rates.
import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const mod = html.slice(html.indexOf('<script type="module">'));
const src = mod.slice(mod.indexOf('const SCALES'), mod.indexOf('// Is the browser drawing with a real graphics card'));
const { makeGovernor } = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport { makeGovernor };'));

function run(name, m, script, start = [1, 0], dpr = 2) {
  const gov = makeGovernor(start[0], start[1]); gov.setMode('auto', 1500);
  const VS = 1000 / m.hz, CAM = 1000 / m.cam;
  let t = 0, lastCam = -1, frameNo = 0, heldFrame = -99, handDue = false, busy = 0, waited = 0, spare = 0.5, handSeen = false, gpuFree = 0;
  let secFrames = 0, secAt = 0; const hist = [], changes = [];
  const handCost = up => (up ? m.handIn : m.handOut) * (gov.hands() === 1 ? 0.55 : 1);
  while (t < script.total) {
    const handUp = script.hand(t), cam = Math.floor(t / CAM); let work = 0;
    if (cam === lastCam) {                                  // spare tick between two camera frames
      waited++;
      if (handDue) { const c = handCost(handUp); work += c; busy += c; handSeen = handUp; heldFrame = frameNo; handDue = false; }
    } else {
      lastCam = cam; frameNo++;
      if (handDue) { work += handCost(handUp); handSeen = handUp; heldFrame = frameNo; handDue = false; }
      work += m.face;
      if (frameNo - heldFrame >= (handSeen ? gov.handEvery() : gov.probeEvery())) {
        if (handSeen && gov.handEvery() === 1) { work += handCost(handUp); handSeen = handUp; heldFrame = frameNo; } else handDue = true;
      }
      work += m.js + Math.max(0, gpuFree - t);              // a tracker result also waits for the previous picture to finish drawing
      gpuFree = Math.max(gpuFree, t + work) + m.gpu * (Math.min(dpr, gov.scale()) / 2) ** 2;
      busy += work; spare += (Math.min(waited, 1) - spare) * 0.1; waited = 0; secFrames++;
      if (gov.frame(t, busy, m.cam, spare, handSeen)) changes.push(`${(t / 1000).toFixed(0)}s`);
      busy = 0;
    }
    t = Math.ceil(Math.max(t + work, gpuFree - VS * 0.2, t + 0.01) / VS) * VS;
    if (t - secAt >= 10000) { hist.push((secFrames * 1000 / (t - secAt)).toFixed(0)); secFrames = 0; secAt = t; }
  }
  const late = changes.filter(c => parseInt(c) > script.total / 2000).length;
  console.log(`${name.padEnd(28)} ${hist.slice(-6).join(' ').padEnd(18)} frames/s at the end | sharpness ${Math.min(dpr, gov.scale())}x, hand every ${gov.handEvery()} (${gov.hands()}) | ${changes.length} changes, ${late} in the second half`);
}
const hand = (on, off) => t => (t % (on + off)) > off;     // lowered for `off` ms, raised for `on` ms, repeating
const S = { total: 240000, hand: hand(12000, 10000) };
run('fast laptop',                 { hz: 60, cam: 30, face: 6,  handIn: 11, handOut: 7,  js: 2, gpu: 5 },   S);
run('mid laptop, tracker-bound',   { hz: 60, cam: 30, face: 14, handIn: 30, handOut: 16, js: 3, gpu: 8 },   S);
run('weak graphics, fill-bound',   { hz: 60, cam: 30, face: 7,  handIn: 12, handOut: 8,  js: 2, gpu: 70 },  S);
run('old dual-core',               { hz: 60, cam: 30, face: 28, handIn: 55, handOut: 30, js: 5, gpu: 20 },  S);
run('phone',                       { hz: 60, cam: 30, face: 20, handIn: 40, handOut: 22, js: 4, gpu: 30 },  S, [3, 1], 3);
run('no graphics card',            { hz: 60, cam: 30, face: 26, handIn: 65, handOut: 40, js: 6, gpu: 600 }, S, [6, 3], 1);
run('15 frames/s camera',          { hz: 60, cam: 15, face: 6,  handIn: 11, handOut: 7,  js: 2, gpu: 5 },   S);
run('120 Hz screen, never a hand', { hz: 120, cam: 30, face: 5, handIn: 10, handOut: 6,  js: 2, gpu: 4 },   { total: 120000, hand: () => false });
