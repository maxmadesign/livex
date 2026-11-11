#!/usr/bin/env python3
"""Performance patch for the X-Ray Mirror page.

    python3 patch.py "<X-Ray Mirror.html>" "<X-Ray Mirror (fast).html>"

Reads the original single-file page (sha256 b5e12cd0755ac097...) and writes a copy that keeps up with the camera on
slower computers. The anatomy data and the look are untouched. What changes:

  1. Hand tracker scheduling. The original runs the hand tracker on every camera frame, even with no hand in view.
     Now it only looks for a hand a few times a second, follows a hand at a rate that depends on how fast the
     computer is, and does that work in the spare moment between two camera frames.
  2. Automatic quality. The 3D layer is drawn at a sharpness that this computer can sustain (7 steps) and the hand
     tracker runs as often as it can afford (4 steps, the last two following one hand instead of two), both chosen
     by watching the real frame rate. A "Performance" panel shows what it is doing and lets you pin it.
  3. No graphics card: the trackers switch to their CPU version (several times faster than emulated GPU), look at a
     smaller copy of the picture, the camera is asked for 640x360, and the page says what to switch on.
  4. Cheaper drawing: the hand's dark silhouette no longer goes through a canvas blur (the most expensive single
     step on a slow computer) and is drawn only where the hand is, style changes are skipped when nothing changed,
     and the 3D layer asks for the fast graphics card on computers that have two.
  5. Smoothing is tied to time instead of to frames, so motion feels the same at any frame rate.
  6. One fix found during analysis: left and right hands were swapped.
"""
import hashlib
import sys

SRC_SHA256 = "b5e12cd0755ac0976e655c4f9ac914c2a7a6b54474455d66549cbdfa6511dfb0"


def main():
    src_path, out_path = sys.argv[1], sys.argv[2]
    s = open(src_path, encoding="utf-8").read()
    digest = hashlib.sha256(s.encode("utf-8")).hexdigest()
    if digest != SRC_SHA256:
        print("warning: this is not the file the patch was written for (sha256 %s)" % digest[:16], file=sys.stderr)

    def rep(old, new):
        nonlocal s
        n = s.count(old)
        if n != 1:
            raise SystemExit("patch anchor found %d times, expected once: %r" % (n, old[:70]))
        s = s.replace(old, new)

    def block(start, end, new):
        """replace everything from the line holding `start` up to (not including) `end`"""
        nonlocal s
        if s.count(start) != 1 or s.count(end) != 1:
            raise SystemExit("block markers not unique: %r / %r" % (start[:50], end[:50]))
        a, b = s.index(start), s.index(end)
        if a >= b:
            raise SystemExit("block markers out of order: %r" % start[:50])
        s = s[:a] + new + s[b:]

    # ---------------------------------------------------------------- panel
    rep('''    <div class="panel">
      <label class="ck"><input type="checkbox" id="showdata">Show tracking data</label>''',
        '''    <div class="panel">
      <h3>Performance</h3>
      <div class="row">
        <label for="perf">Mode</label>
        <select id="perf">
          <option value="auto">Automatic</option>
          <option value="quality">Best picture</option>
          <option value="balanced">Balanced</option>
          <option value="fast">Fastest</option>
        </select>
      </div>
      <p class="small" id="perfinfo" style="margin-top:9px">Adjusts itself to keep the picture smooth.</p>
    </div>

    <div class="panel">
      <label class="ck"><input type="checkbox" id="showdata">Show tracking data</label>''')

    # ---------------------------------------------------------------- settings
    rep('fx: 0, fy: 0, fz: 0, labels: false };', 'fx: 0, fy: 0, fz: 0, labels: false, perf: "auto" };')
    rep('  $("labels").checked = S.labels;', '  $("labels").checked = S.labels; $("perf").value = S.perf;')
    rep('''$("fitreset").onclick = () => { S.fs = S.fw = S.fh = S.fd = 1; S.fx = S.fy = S.fz = 0; save(); syncUI(); };''',
        '''$("fitreset").onclick = () => { S.fs = S.fw = S.fh = S.fd = 1; S.fx = S.fy = S.fz = 0; save(); syncUI(); };
$("perf").onchange = e => { S.perf = e.target.value; save(); gov.setMode(S.perf, performance.now()); applyQuality(); };''')

    # ---------------------------------------------------------------- performance section
    rep('// ------------------------------ 3D scene ------------------------------', PERF_JS + '''
// ------------------------------ 3D scene ------------------------------''')

    # ---------------------------------------------------------------- renderer
    rep('''  renderer = new THREE.WebGLRenderer({ canvas: $("gl"), alpha: true, antialias: true });''',
        '''  // Edge smoothing is kept wherever a graphics card does the work; a processor drawing every pixel cannot afford it.
  const smooth = !(perf.software && S.perf !== "quality");
  renderer = new THREE.WebGLRenderer({ canvas: $("gl"), alpha: true, antialias: smooth, powerPreference: "high-performance" });''')
    rep('''    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));''',
        '''    perf.scale = renderScale(); renderer.setPixelRatio(perf.scale);''')

    # ---------------------------------------------------------------- smoothing tied to time
    rep('''function updateHead(matrixData, lms, jawOpen) {''',
        '''function updateHead(matrixData, lms, jawOpen, dt) {
  const k = easing(dt);                                   // the same smoothing per second at any frame rate''')
    rep('''  else { head.pos.lerp(tmpP, 0.6); head.quat.slerp(tmpQ, 0.55); head.scl.lerp(tmpS, 0.5); }''',
        '''  else { head.pos.lerp(tmpP, k(0.6)); head.quat.slerp(tmpQ, k(0.55)); head.scl.lerp(tmpS, k(0.5)); }''')
    rep('''  head.jaw += (jawOpen - head.jaw) * 0.6;''', '''  head.jaw += (jawOpen - head.jaw) * k(0.6);''')
    rep('''  head.fitS += (s - head.fitS) * 0.5;''', '''  head.fitS += (s - head.fitS) * k(0.5);''')
    rep('''  head.fitX += (qmx - head.fitS * pmx - head.fitX) * 0.7;''', '''  head.fitX += (qmx - head.fitS * pmx - head.fitX) * k(0.7);''')
    rep('''  head.fitY += (qmy - head.fitS * pmy - head.fitY) * 0.7;''', '''  head.fitY += (qmy - head.fitS * pmy - head.fitY) * k(0.7);''')
    rep('''function updateHand(rig, lms, isRight) {''', '''function updateHand(rig, lms, isRight, dt) {
  const k = easing(dt);''')
    rep('''if (fresh) rig.pts[i].copy(tmpV); else rig.pts[i].lerp(tmpV, 0.65); });''',
        '''if (fresh) rig.pts[i].copy(tmpV); else rig.pts[i].lerp(tmpV, k(0.65)); });''')

    # ---------------------------------------------------------------- hand silhouette
    block('// the dark "veil" that hides the real hand', '// ------------------------------ labels ------------------------------', VEIL_JS)

    # ---------------------------------------------------------------- per-frame drawing
    rep('''function renderFrame(now, faceLms, hands, sides) {''', '''let lastMask = "";
function renderFrame(now, faceLms, hands, sides, dt) {''')
    rep('''      updateHand(rig, lms, sides[i]);''', '''      updateHand(rig, lms, sides[i], dt);''')
    rep('''  for (const id of ["gl", "shade"]) { const st = $(id).style; st.maskImage = mask; st.webkitMaskImage = mask; }''',
        '''  if (mask !== lastMask) { lastMask = mask; for (const id of ["gl", "shade"]) { const st = $(id).style; st.maskImage = mask; st.webkitMaskImage = mask; } }''')
    rep('''      rows.push(["layers", LAYERS.filter(k => S[k]).join(", ") || "none"], ["speed", fps + " frames/s"]);''',
        '''      rows.push(["layers", LAYERS.filter(k => S[k]).join(", ") || "none"], ["speed", fps + " frames/s"]);
      rows.push(["camera", perf.camFps ? perf.camFps.toFixed(0) + " frames/s" : "not reported"],
                ["sharpness", Math.round(perf.scale * 100) + "%, step " + (gov.step() + 1) + "/" + SCALES.length + " (" + S.perf + ")"],
                ["face tracker", perf.faceBy ? perf.faceMs.toFixed(0) + " ms, " + perf.faceBy : "off"],
                ["hand tracker", perf.handBy ? perf.handMs.toFixed(0) + " ms, " + perf.handBy : "off"],
                ["hand rate", perf.handBy ? nth(gov.handEvery()) + " frame, " + (gov.hands() === 1 ? "1 hand" : "2 hands") : "off"],
                ["graphics", perf.gpu ? perf.gpu.replace(/^ANGLE \\(/, "").slice(0, 22) : "not reported"]);''')
    rep('''  if (now - fpsAt >= 1000) { fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; }''',
        '''  if (now - fpsAt >= 1000) { fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; showPerf(); }''')

    # ---------------------------------------------------------------- trackers
    rep('''    runningMode: "VIDEO", numHands: 2 });''', '''    runningMode: "VIDEO", numHands: (perf.handCount = gov.hands()) });''')
    rep('''  try { faceTracker = await mkFace("GPU"); } catch (e) { faceTracker = await mkFace("CPU"); }
  try { try { handTracker = await mkHand("GPU"); } catch (e) { handTracker = await mkHand("CPU"); } }
  catch (e) { handTracker = null; }                        // the head view still works without hand tracking''',
        '''  // Without a graphics card the "GPU" trackers are emulated, which is several times slower than their CPU version.
  const order = perf.software ? ["CPU"] : ["GPU", "CPU"];
  const first = async mk => { let err; for (const d of order) { try { return [await mk(d), d]; } catch (e) { err = e; } } throw err; };
  [faceTracker, perf.faceBy] = await first(mkFace);
  try { [handTracker, perf.handBy] = await first(mkHand); }
  catch (e) { handTracker = null; perf.handBy = ""; }      // the head view still works without hand tracking
  if (perf.faceBy === "CPU" || perf.handBy === "CPU") {
    // CPU trackers copy the picture out of the graphics memory, so they get a small one. Going through a canvas also
    // matters for correctness: handed a camera stream that the browser has scaled, they found no face at all in testing.
    perf.small = document.createElement("canvas");
    perf.smallCtx = perf.small.getContext("2d");
  }''')
    block('function liveLoop() {', '// Built-in test scene (open the page with #demo)', LOOP_JS)

    # ---------------------------------------------------------------- start-up
    rep('''    await boot();
''', '''    await boot();
    if (perf.software) {                                   // every pixel is drawn by the processor here: ask the camera for fewer
      try { await stream.getVideoTracks()[0].applyConstraints({ width: { ideal: 640 }, height: { ideal: 360 } }); } catch (e) {}
    }
''')
    rep('''    await loadTrackers();
''', '''    await loadTrackers();
    showPerf();
''')

    open(out_path, "w", encoding="utf-8").write(s)
    print("wrote %s (%d bytes)" % (out_path, len(s.encode("utf-8"))))


PERF_JS = r'''// ------------------------------ performance ------------------------------
// When this computer cannot keep up with the camera, two things give way: the 3D layer is drawn less sharp, and the
// hand tracker runs less often. Each has its own row of steps, best first.
const SCALES = [2, 1.5, 1.25, 1, 0.8, 0.65, 0.5];     // sharpness limit of the 3D layer (1 = one drawn pixel per CSS pixel)
const PROBE = [3, 4, 4, 6, 8, 10, 15];                // with no hand in view, look for one on every n-th camera frame
const HAND_STEPS = [                                  // with a hand in view: follow it on every n-th camera frame, one or two hands.
  { every: 1, hands: 2 }, { every: 2, hands: 2 },     // Looking for a second hand doubles the cost of every run, so the
  { every: 2, hands: 1 }, { every: 3, hands: 1 },     // last two steps follow one hand only.
];
const FIXED = { quality: [0, 0], balanced: [2, 1], fast: [5, 3] };
const perf = { software: false, gpu: "", faceBy: "", handBy: "", faceMs: 0, handMs: 0, camFps: 0, scale: 1, handCount: 2, small: null, smallCtx: null };

// Chooses the steps. frame() is called once for every camera frame that was drawn and returns true when a step changed.
function makeGovernor(startScale, startHand) {
  let mode = "auto", si = startScale, hi = startHand, fps = 30, busy = 0, last = 0, decided = 0, changed = 0, lastKnob = "";
  let trial = null, keepScaleUntil = 0, keepScaleFor = 30000;
  const knobs = { s: { wait: 6000, last: -1e9, good: 0 }, h: { wait: 6000, last: -1e9, good: 0 } };
  return {
    setMode(m, now) {
      mode = FIXED[m] ? m : "auto";
      if (FIXED[m]) { si = FIXED[m][0]; hi = FIXED[m][1]; } else { si = startScale; hi = startHand; }
      changed = now; trial = null; knobs.s.good = knobs.h.good = 0;
    },
    scale: () => SCALES[si], probeEvery: () => PROBE[si], handEvery: () => HAND_STEPS[hi].every, hands: () => HAND_STEPS[hi].hands,
    best: () => si === 0, step: () => si, fps: () => fps, busy: () => busy,
    // busyMs: time this page worked on the frame. camFps: the camera's own rate, 0 if unknown. spare: share of recent
    // frames that left the page waiting for the camera (0..1). handInView: the hand tracker is following a hand.
    frame(now, busyMs, camFps, spare, handInView) {
      const dt = now - last; last = now;
      if (dt > 0 && dt < 1000) { const a = 1 - Math.exp(-dt / 400); fps += (1000 / dt - fps) * a; busy += (busyMs - busy) * a; }
      if (mode !== "auto" || now - changed < 1500 || now - decided < 500) return false;
      decided = now;
      const target = camFps > 5 ? Math.min(camFps, 60) : 30, room = 1000 / Math.max(fps, 10);
      const over = fps < target * 0.88 - 0.5 && spare < 0.25;                 // camera frames are being dropped
      const slack = !over && busy < room * 0.45 && (spare > 0.6 || fps > target * 0.94);
      if (trial) {                                                            // did the last cut in sharpness buy anything?
        const t = trial; trial = null;
        if (t.hand !== handInView) { si = t.from; changed = now; return true; }    // a hand came or went meanwhile: no fair comparison, undo
        if (fps >= t.fps * 1.04) keepScaleFor = 30000;
        else {                                                                // no: the trackers are the limit, so give it back
          si = t.from; keepScaleUntil = now + keepScaleFor; keepScaleFor = Math.min(keepScaleFor * 2, 300000);
          changed = now; return true;
        }
      }
      // With a hand in view the hand tracker is the extra load, so its rate gives way first and comes back first.
      // If the page itself is idle most of the time, the graphics card is the limit and only sharpness helps.
      let knob = "s";
      if (handInView && !(over && busy < room * 0.4)) knob = over ? (hi < HAND_STEPS.length - 1 ? "h" : "s") : (hi > 0 ? "h" : "s");
      if (knob !== lastKnob) { lastKnob = knob; knobs[knob].good = 0; }
      const u = knobs[knob];
      if (over) {
        if (now - u.last < 6000) u.wait = Math.min(u.wait * 2, 120000);       // the last step up was one too many: wait longer next time
        knobs.s.good = knobs.h.good = 0;
        if (knob === "h") { hi++; changed = now; return true; }
        if (now < keepScaleUntil) return false;
        const to = Math.min(SCALES.length - 1, si + (fps < target * 0.75 ? 2 : 1));
        if (to !== si) { trial = { from: si, fps, hand: handInView }; si = to; changed = now; return true; }
      } else if (slack) {
        if (!u.good) u.good = now;
        if (now - u.good >= u.wait) {
          if (knob === "h" && hi > 0) hi--; else if (knob === "s" && si > 0) si--; else return false;
          u.last = now; u.good = 0; changed = now; return true;
        }
      } else knobs.s.good = knobs.h.good = 0;
      return false;
    }
  };
}

// Is the browser drawing with a real graphics card? Software drawing shows up in the renderer's name.
(function probeGraphics() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    if (!gl) return;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    perf.gpu = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
    perf.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(perf.gpu);
    const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
  } catch (e) {}
})();
const touchDevice = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
const gov = perf.software ? makeGovernor(SCALES.length - 1, HAND_STEPS.length - 1) : touchDevice ? makeGovernor(3, 1) : makeGovernor(1, 0);
gov.setMode(S.perf, 0);

function renderScale() {          // sharpness of the 3D layer: the screen's own, limited by the current step and by a total pixel count
  const want = Math.min(window.devicePixelRatio || 1, gov.scale());
  return S.perf === "quality" ? want : Math.max(0.35, Math.min(want, Math.sqrt(3.2e6 / (W * H))));
}
function applyQuality() {
  if (renderer) {
    const s = renderScale();
    if (Math.abs(s - perf.scale) > 0.02) { perf.scale = s; renderer.setPixelRatio(s); renderer.setSize(W, H, false); }
  }
  showPerf();
}
// Smoothing constants are written for 30 camera frames a second; this converts one to the time that really passed.
const SAME = a => a;
function easing(dt) {
  if (!dt) return SAME;
  const n = Math.max(0.25, Math.min(4, dt / 33.3));
  return a => 1 - Math.pow(1 - a, n);
}
const nth = n => n === 1 ? "every" : n === 2 ? "every 2nd" : n === 3 ? "every 3rd" : "every " + n + "th";
function showPerf() {
  const el = $("perfinfo");
  let t = S.perf === "auto" ? "Adjusts itself to keep the picture smooth." : "Fixed setting.";
  if (fps) t += " Now " + fps + " frames a second at " + Math.round(perf.scale * 100) + "% sharpness"
              + (handTracker && gov.handEvery() > 1 ? ", " + (gov.hands() === 1 ? "one hand" : "hands") + " followed on " + nth(gov.handEvery()) + " frame." : ".");
  if (perf.software) t += " This browser is drawing without a graphics card, which is slow. Switching on hardware acceleration in its settings helps most.";
  el.textContent = t; el.style.color = perf.software ? "var(--bad)" : "";
}
'''

VEIL_JS = r'''// the dark "veil" that hides the real hand so the bones read clearly (drawn on the 2D layer under the 3D one)
function drawHandVeil(g, lms, alpha) {
  const px = i => lms[i].x * W, py = i => lms[i].y * H;
  const d = Math.hypot(px(5) - px(17), py(5) - py(17)) || 1;
  const blur = S.feather * d * 0.22;                     // soften the hand's dark outline by the same setting
  // Only the part of the picture the hand covers is touched: its box, plus the stroke width and the soft edge.
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < lms.length; i++) { const x = px(i), y = py(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = d * 0.2 + blur * 3 + 2;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 1 || bh < 1) return;
  g.fillStyle = g.strokeStyle = "rgba(4,7,13," + alpha.toFixed(3) + ")";
  g.lineJoin = g.lineCap = "round";
  const path = new Path2D();
  [0, 1, 2, 5, 9, 13, 17].forEach((i, k) => k ? path.lineTo(px(i), py(i)) : path.moveTo(px(i), py(i)));
  path.closePath();
  const fingers = new Path2D();
  for (const c of [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]])
    c.forEach((i, k) => k ? fingers.lineTo(px(i), py(i)) : fingers.moveTo(px(i), py(i)));
  // draw opaque on a scratch canvas first so overlapping strokes do not darken twice
  const sc = drawHandVeil.sc || (drawHandVeil.sc = document.createElement("canvas"));
  const s = sc.getContext("2d");
  const draw = () => { s.fillStyle = s.strokeStyle = "#04070d"; s.lineJoin = s.lineCap = "round";
                       s.lineWidth = d * 0.34; s.fill(path); s.stroke(path); s.lineWidth = d * 0.36; s.stroke(fingers); };
  g.globalAlpha = alpha;
  if (gov.best() || blur <= 0.5) {
    // best picture: a true blur, as before
    if (sc.width < bw || sc.height < bh) { sc.width = Math.max(sc.width, bw); sc.height = Math.max(sc.height, bh); }
    s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, sc.width, sc.height); s.translate(-x0, -y0); draw();
    g.filter = blur > 0.5 ? "blur(" + blur.toFixed(1) + "px)" : "none";
    g.drawImage(sc, 0, 0, bw, bh, x0, y0, bw, bh); g.filter = "none";
  } else {
    // A canvas blur is the single most expensive step on a slow computer. Drawing the silhouette small and letting
    // the enlargement soften its edge looks nearly the same and costs next to nothing.
    const f = Math.max(2, Math.min(12, blur * 2.5)), sw = Math.ceil(bw / f) + 2, sh = Math.ceil(bh / f) + 2;
    if (sc.width < sw || sc.height < sh) { sc.width = Math.max(sc.width, sw); sc.height = Math.max(sc.height, sh); }
    s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, sc.width, sc.height);   // all of it: the enlargement also reads the pixels next door
    s.setTransform(1 / f, 0, 0, 1 / f, 1 - x0 / f, 1 - y0 / f); draw();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(sc, 0, 0, sw, sh, x0 - f, y0 - f, sw * f, sh * f);
  }
  g.globalAlpha = 1;
}

'''

LOOP_JS = r'''function liveLoop() {
  let lastTime = -1, lostAt = 0, said = "", frameNo = 0, lastFresh = 0, handDue = false, busy = 0, waited = 0, spare = 0.5, inputFor = -1;
  let switching = false;
  const held = { hands: [], sides: [], frame: -99 };       // the last hand result, kept between runs of the hand tracker
  const say = (t, c) => { if (said !== t) { said = t; setStatus(t, c); } };
  gov.setMode(S.perf, performance.now() + 1500);           // the first inferences are slow: do not judge the speed by them

  // the camera's real frame rate, where the browser reports it
  if (video.requestVideoFrameCallback) {
    let n0 = 0, t0 = 0;
    const onFrame = (t, meta) => {
      if (!t0) { n0 = meta.presentedFrames; t0 = t; }
      else if (t - t0 >= 1000) {
        const r = (meta.presentedFrames - n0) * 1000 / (t - t0);
        perf.camFps = perf.camFps ? perf.camFps + (r - perf.camFps) * 0.5 : r; n0 = meta.presentedFrames; t0 = t;
      }
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  function input() {                 // what the trackers look at: the camera picture itself, or a small copy of it for CPU trackers
    if (!perf.small || !video.videoWidth) return video;
    if (inputFor !== frameNo) {
      const w = Math.min(640, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
      if (perf.small.width !== w || perf.small.height !== h) { perf.small.width = w; perf.small.height = h; }
      perf.smallCtx.drawImage(video, 0, 0, w, h); inputFor = frameNo;
    }
    return perf.small;
  }
  function fitHandCount() {          // one hand or two, as the current step asks
    const n = gov.hands();
    if (!handTracker || switching || n === perf.handCount) return;
    switching = true;
    handTracker.setOptions({ numHands: n }).then(() => { perf.handCount = n; }, () => {}).then(() => { switching = false; });
  }
  function runHands() {
    if (switching) return 0;
    const t0 = performance.now();
    const hr = handTracker.detectForVideo(input(), t0);
    held.hands = hr.landmarks || [];
    const hd = hr.handedness || hr.handednesses || [];
    // The tracker names each hand as it is in an unmirrored picture, which is what it is given here.
    held.sides = held.hands.map((h, i) => !!(hd[i] && hd[i][0] && hd[i][0].categoryName === "Right"));
    held.frame = frameNo; handDue = false;
    const ms = performance.now() - t0;
    perf.handMs += (ms - perf.handMs) * (perf.handMs ? 0.2 : 1);
    return ms;
  }

  function tick() {
    requestAnimationFrame(tick);
    if (video.readyState < 2) return;
    const wantHands = !!handTracker && (S.hands || S.reveal === "lens" || S.showdata);
    if (video.currentTime === lastTime) {
      // A spare moment between two camera frames. The hand tracker uses it, so it does not hold up the next picture.
      waited++;
      if (handDue && wantHands) { try { busy += runHands(); } catch (e) { say("The tracker hit an error: " + e.message, "bad"); } }
      return;
    }
    lastTime = video.currentTime; frameNo++;
    const now = performance.now(), dt = lastFresh ? now - lastFresh : 33.3; lastFresh = now;
    fitHandCount();
    let faceLms = null;
    try {
      if (handDue && wantHands) runHands();                // no spare moment came, so it runs now
      const t0 = performance.now();
      const fr = faceTracker.detectForVideo(input(), t0);
      perf.faceMs += (performance.now() - t0 - perf.faceMs) * (perf.faceMs ? 0.2 : 1);
      faceLms = fr.faceLandmarks && fr.faceLandmarks[0];
      const mat = fr.facialTransformationMatrixes && fr.facialTransformationMatrixes[0];
      if (faceLms && mat) {
        let jaw = 0;
        const bs = fr.faceBlendshapes && fr.faceBlendshapes[0];
        if (bs) for (const c of bs.categories) if (c.categoryName === "jawOpen") jaw = c.score;
        updateHead(mat.data, faceLms, jaw, dt); lostAt = 0;
      } else { faceLms = null; if (!lostAt) lostAt = now; if (now - lostAt > 250) head.found = false; }
      if (!wantHands) { held.hands = []; held.sides = []; held.frame = -99; handDue = false; }
      else if (frameNo - held.frame >= (held.hands.length ? gov.handEvery() : gov.probeEvery())) {
        // A hand in view on a fast computer is followed within the same frame; everything else waits for a spare moment.
        if (held.hands.length && gov.handEvery() === 1) runHands(); else handDue = true;
      }
    } catch (e) { say("The tracker hit an error: " + e.message, "bad"); return; }
    const hands = held.hands, sides = held.sides;
    say(head.found ? "Tracking your head." + (hands.length ? " Hand bones on." : "")
                   : hands.length ? "Hand found. Face the camera to see inside your head."
                   : "No face found. Face the camera, with light on your face.", head.found || hands.length ? "ok" : "bad");
    renderFrame(now, faceLms, hands, sides, dt);
    busy += performance.now() - now;
    spare += (Math.min(waited, 1) - spare) * 0.1; waited = 0;
    if (gov.frame(now, busy, perf.camFps, spare, hands.length > 0)) applyQuality();
    busy = 0;
  }
  tick();
}

'''

if __name__ == "__main__":
    main()
