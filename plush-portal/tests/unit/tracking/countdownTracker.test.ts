import { afterEach, describe, expect, it } from 'vitest';
import type { CalibrationStatus } from '../../../src/core/contracts';
import type { Vec3 } from '../../../src/core/types';
import { setValueAt, type Settings, defaultSettings } from '../../../src/settings/spec';
import { baselineWrites } from '../../../src/tracking/baseline';
import { ROTATED, WAITING_CAMERA } from '../../../src/tracking/countdown';
import { HEAD_DEADZONE } from '../../../src/tracking/headPose';
import { createRig, flush, runUntil, type Person, type Rig } from './trackerRig';

const rigs: Rig[] = [];
const rigFor = (options?: Parameters<typeof createRig>[0]) => {
  const rig = createRig(options);
  rigs.push(rig);
  return rig;
};
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.tracker.dispose();
});

const cal = (rig: Rig): CalibrationStatus => rig.tracker.status().calibration;

/** Records the sequence of calibration states ("countdown 3", "capturing", …). */
function recordPhases(rig: Rig): string[] {
  const seen: string[] = [];
  rig.tracker.subscribe((s) => {
    const c = s.calibration;
    const label = c.phase === 'countdown' ? `countdown ${c.remaining}${c.detail ? ` ${c.detail}` : ''}` : c.phase === 'failed' ? `failed ${c.detail}` : c.phase;
    if (seen[seen.length - 1] !== label) seen.push(label);
  });
  return seen;
}

/** Starts the tracker with someone in view and waits until they are tracked. */
async function tracked(rig: Rig, person: Person | (() => Person[])): Promise<void> {
  rig.scene = typeof person === 'function' ? person : () => [person];
  await rig.tracker.start();
  await runUntil(rig, () => rig.tracker.status().state === 'tracking', 3000);
  expect(rig.tracker.status().state).toBe('tracking');
}

describe('FaceTracker countdown calibration', () => {
  it('counts down 3-2-1, captures, and makes the current eye position and head direction the baseline', async () => {
    const rig = rigFor();
    rig.tracker.setActiveProfile('desktop');
    // Standing off-centre, looking at the screen with the head turned a little (a personal bias).
    const stand: Person = { eye: [0.06, 0.1, 0.7], yawDeg: 6, pitchDeg: -4 };
    await tracked(rig, stand);
    const phases = recordPhases(rig);
    const startedAt = rig.clock.now;
    rig.tracker.startCalibration(3);
    expect(cal(rig)).toEqual({ phase: 'countdown', remaining: 3, detail: '' });
    const ms = await runUntil(rig, () => cal(rig).phase === 'done', 6000);
    expect(phases).toEqual(['countdown 3', 'countdown 2', 'countdown 1', 'capturing', 'done']);
    // 3 s countdown + a capture window well under a second.
    expect(ms).toBeGreaterThan(3500);
    expect(ms).toBeLessThan(4300);
    void startedAt;

    expect(rig.calibrations).toHaveLength(1);
    const event = rig.calibrations[0]!;
    expect(event.kind).toBe('baseline');
    for (let i = 0; i < 3; i++) expect(Math.abs(event.values.calNeutral[i]! - stand.eye[i]!)).toBeLessThan(0.003);
    expect(event.values.calDepthK).toBe(rig.config.view.calDepthK); // the distance scale is kept
    expect(Math.abs(event.values.headYaw! - 6)).toBeLessThan(0.7);
    expect(Math.abs(event.values.headPitch! - -4)).toBeLessThan(0.7);
    expect(rig.tracker.status().calibrated).toBe(true);
    const diag = rig.tracker.diagnostics();
    expect(diag.headBaselineDeg.yaw).toBeCloseTo(event.values.headYaw!, 6);
    expect(diag.lastBaseline!.samples).toBeGreaterThanOrEqual(4);

    // The baseline pose now maps onto the reference eye (screen-centred, design distance) …
    const after = await rig.run(1500);
    for (let i = 0; i < 3; i++) expect(Math.abs(after.eye[i]! - rig.config.view.eye[i]!)).toBeLessThan(0.004);
    // … and the "done" state is shown briefly, then the status returns to idle.
    await rig.run(1000);
    expect(cal(rig).phase).toBe('idle');
  });

  it('afterwards, moving is measured 1:1 from the baseline and turning the head shifts the view that way', async () => {
    const rig = rigFor();
    rig.tracker.setActiveProfile('desktop');
    const base: Person = { eye: [0.02, 0.12, 0.65], yawDeg: 3, pitchDeg: -5 };
    let person = base;
    await tracked(rig, () => [person]);
    rig.tracker.startCalibration(1);
    await runUntil(rig, () => cal(rig).phase === 'done', 4000);
    expect(cal(rig).phase).toBe('done');
    const eyeRef = rig.config.view.eye;

    // Sideways / up / closer while still watching the window: pure position parallax, 1:1.
    person = { ...base, eye: [base.eye[0] + 0.1, base.eye[1] + 0.05, base.eye[2] - 0.08] };
    const moved = await rig.run(2000);
    expect(moved.eye[0] - eyeRef[0]).toBeCloseTo(0.1, 2);
    expect(moved.eye[1] - eyeRef[1]).toBeCloseTo(0.05, 2);
    expect(moved.eye[2] - eyeRef[2]).toBeCloseTo(-0.08, 2);

    // Back at the baseline, turning the head 20° to the right moves the view right (weight 0.4).
    person = { ...base, yawDeg: base.yawDeg! + 20 };
    const turned = await rig.run(2000);
    const expected = 0.4 * eyeRef[2] * Math.sin(20 * (Math.PI / 180) - HEAD_DEADZONE);
    expect(Math.abs(turned.eye[0] - eyeRef[0] - expected)).toBeLessThan(0.012);
    expect(Math.abs(turned.eye[1] - eyeRef[1])).toBeLessThan(0.01);
    // Looking up moves it up, looking left moves it left.
    person = { ...base, pitchDeg: base.pitchDeg! + 15 };
    expect((await rig.run(2000)).eye[1] - eyeRef[1]).toBeGreaterThan(0.03);
    person = { ...base, yawDeg: base.yawDeg! - 20 };
    expect((await rig.run(2000)).eye[0] - eyeRef[0]).toBeLessThan(-0.05);

    // Weight 0 switches the head-turn term off; position parallax stays. (The application persists
    // the baseline first – configure() with unpersisted settings would revert the calibration.)
    let s: Settings = { ...defaultSettings(), camera: rig.config.camera, profiles: { ...defaultSettings().profiles, desktop: { ...defaultSettings().profiles.desktop, view: rig.config.view } } };
    for (const [path, value] of baselineWrites('desktop', rig.calibrations[0]!.values)) s = setValueAt(s, path, value);
    rig.configure({ camera: { ...s.camera, headWeight: 0 }, view: s.profiles.desktop.view });
    expect(Math.abs((await rig.run(2000)).eye[0] - eyeRef[0])).toBeLessThan(0.005);
  });

  it('no face during the capture: failed (no_face), Retry works; Cancel keeps the stored baseline', async () => {
    const rig = rigFor();
    let visible = true;
    const stand: Person = { eye: [0, 0.14, 0.62] };
    await tracked(rig, () => (visible ? [stand] : []));
    visible = false;
    rig.tracker.startCalibration(1);
    await runUntil(rig, () => cal(rig).phase === 'failed', 6000);
    expect(cal(rig)).toEqual({ phase: 'failed', remaining: 0, detail: 'no_face' });
    expect(rig.calibrations).toHaveLength(0);
    expect(rig.tracker.status().calibrated).toBe(false);

    // Retry with the player back in view.
    visible = true;
    await rig.run(1500);
    rig.tracker.startCalibration(1);
    await runUntil(rig, () => cal(rig).phase === 'done', 4000);
    expect(cal(rig).phase).toBe('done');
    expect(rig.calibrations).toHaveLength(1);
    const stored = rig.calibrations[0]!.values.calNeutral;

    // A new countdown that is cancelled changes nothing.
    rig.tracker.startCalibration(3);
    await rig.run(1200);
    expect(cal(rig).phase).toBe('countdown');
    rig.tracker.cancelCalibration();
    expect(cal(rig).phase).toBe('idle');
    await rig.run(4000);
    expect(rig.calibrations).toHaveLength(1);
    expect(rig.tracker.diagnostics().lastBaseline!.eye).toEqual(stored);
  });

  it('too much movement during the capture: failed (unstable)', async () => {
    const rig = rigFor();
    const start = rig.clock.now;
    await tracked(rig, () => [{ eye: [0.15 * Math.sin((rig.clock.now - start) / 300), 0.14, 0.62] }]);
    rig.tracker.startCalibration(1);
    await runUntil(rig, () => cal(rig).phase === 'failed' || cal(rig).phase === 'done', 8000);
    expect(cal(rig)).toEqual({ phase: 'failed', remaining: 0, detail: 'unstable' });
    expect(rig.calibrations).toHaveLength(0);
  });

  it('with head tracking off it fails at once (not_running); before the camera ran it starts it and waits', async () => {
    const off = rigFor({ camera: { enabled: false } });
    off.tracker.startCalibration(3);
    expect(cal(off)).toEqual({ phase: 'failed', remaining: 0, detail: 'not_running' });
    expect(off.requests).toHaveLength(0);

    const rig = rigFor({ autoAnswer: false });
    rig.scene = () => [{ eye: [0, 0.14, 0.62] }];
    const phases = recordPhases(rig);
    rig.tracker.startCalibration(2);
    expect(rig.requests).toHaveLength(1); // a user action may open the camera
    expect(cal(rig)).toEqual({ phase: 'countdown', remaining: 2, detail: WAITING_CAMERA });
    await rig.run(5000); // the permission prompt is still open: the countdown waits
    expect(cal(rig)).toEqual({ phase: 'countdown', remaining: 2, detail: WAITING_CAMERA });
    rig.answerCamera();
    await flush();
    await runUntil(rig, () => cal(rig).phase === 'done', 5000);
    expect(phases).toEqual([`countdown 2 ${WAITING_CAMERA}`, 'countdown 2', 'countdown 1', 'capturing', 'done']);
  });

  it('a countdown requested while the inference backend is being replaced starts once it is back', async () => {
    const rig = rigFor();
    await tracked(rig, { eye: [0, 0.14, 0.62] });
    // A new delegate reloads the backend while the camera stays open.
    rig.configure({ camera: { ...rig.config.camera, delegate: 'cpu' } });
    rig.tracker.startCalibration(1);
    expect(cal(rig)).toEqual({ phase: 'countdown', remaining: 1, detail: WAITING_CAMERA });
    await runUntil(rig, () => cal(rig).phase === 'done' || cal(rig).phase === 'failed', 5000);
    expect(cal(rig).phase).toBe('done');
  });

  it('a camera that cannot be opened ends a waiting countdown with the reason', async () => {
    const rig = rigFor({ autoAnswer: false });
    rig.tracker.startCalibration(3);
    rig.answerCamera({ ok: false, state: 'insecure', detail: 'not a secure context' });
    await flush();
    expect(rig.tracker.status().state).toBe('insecure');
    expect(cal(rig)).toEqual({ phase: 'failed', remaining: 0, detail: 'insecure' });
    const denied = rigFor({ autoAnswer: false });
    denied.tracker.startCalibration(3);
    denied.answerCamera({ ok: false, state: 'denied', detail: 'NotAllowedError' });
    await flush();
    expect(cal(denied).detail).toBe('denied');
  });

  it('stop / switch-off cancel, an unplugged camera fails (camera_lost), a hidden page drops the countdown', async () => {
    const rig = rigFor();
    await tracked(rig, { eye: [0, 0.14, 0.62] });
    rig.tracker.startCalibration(3);
    await rig.run(500);
    rig.tracker.stop();
    expect(cal(rig).phase).toBe('idle');

    await tracked(rig, { eye: [0, 0.14, 0.62] });
    rig.tracker.startCalibration(3);
    await rig.run(500);
    rig.cameras[rig.cameras.length - 1]!.unplug();
    expect(cal(rig)).toEqual({ phase: 'failed', remaining: 0, detail: 'camera_lost' });

    const hidden = rigFor();
    await tracked(hidden, { eye: [0, 0.14, 0.62] });
    hidden.tracker.startCalibration(3);
    await hidden.run(500);
    hidden.tracker.setPaused(true);
    expect(cal(hidden).phase).toBe('idle');
    hidden.tracker.setPaused(false);

    const disabled = rigFor();
    await tracked(disabled, { eye: [0, 0.14, 0.62] });
    disabled.tracker.startCalibration(3);
    disabled.configure({ camera: { ...disabled.config.camera, enabled: false } });
    expect(disabled.tracker.status().state).toBe('off');
    expect(cal(disabled).phase).toBe('idle');
  });

  it('a rotated camera picture (phone turned) asks for a new baseline', async () => {
    const rig = rigFor();
    await tracked(rig, { eye: [0, 0.05, 0.4] });
    rig.tracker.startCalibration(3);
    await rig.run(500);
    // The phone is turned to portrait: the camera now delivers 480×640 frames.
    rig.frameSize = [480, 640];
    await runUntil(rig, () => cal(rig).detail === ROTATED, 1000);
    expect(cal(rig)).toEqual({ phase: 'idle', remaining: 0, detail: ROTATED });
    expect(rig.tracker.status().videoWidth).toBe(480);
    // Tracking continues in the new orientation; calibrating clears the prompt.
    await runUntil(rig, () => rig.tracker.status().state === 'tracking', 3000);
    expect(rig.tracker.status().state).toBe('tracking');
    rig.tracker.startCalibration(1);
    expect(cal(rig).detail).toBe('');
    await runUntil(rig, () => cal(rig).phase === 'done', 4000);
    expect(cal(rig).phase).toBe('done');
    // A screen-orientation event alone does the same (debounced with the frame change).
    await rig.run(3000);
    rig.rotateScreen();
    expect(cal(rig).detail).toBe(ROTATED);
    rig.tracker.cancelCalibration();
    expect(cal(rig).detail).toBe('');
  });

  it('keeps one head-direction baseline per display preset', async () => {
    const rig = rigFor();
    let settings: Settings = defaultSettings();
    const persist = (profile: 'desktop' | 'portrait86') => {
      for (const [path, value] of baselineWrites(profile, rig.calibrations[rig.calibrations.length - 1]!.values)) settings = setValueAt(settings, path, value);
    };
    rig.tracker.setActiveProfile('desktop');
    let person: Person = { eye: [0, 0.14, 0.62], yawDeg: 8 };
    await tracked(rig, () => [person]);
    rig.tracker.startCalibration(0);
    await runUntil(rig, () => cal(rig).phase === 'done', 3000);
    persist('desktop');
    expect(settings.camera.headBaseline.desktop.yaw).toBeCloseTo(8, 0);
    expect(settings.camera.headBaseline.portrait86).toEqual({ yaw: 0, pitch: 0 });

    // The application passes the stored values back: nothing changes.
    rig.configure({ camera: { ...rig.config.camera, headBaseline: settings.camera.headBaseline }, view: { ...settings.profiles.desktop.view } });
    expect(rig.tracker.diagnostics().headBaselineDeg.yaw).toBeCloseTo(settings.camera.headBaseline.desktop.yaw, 6);
    const still = await rig.run(1500);
    expect(Math.abs(still.eye[0] - rig.config.view.eye[0])).toBeLessThan(0.004);

    // Another preset with its own baseline.
    settings = setValueAt(settings, 'camera.headBaseline.portrait86.yaw', -12);
    settings = setValueAt(settings, 'profiles.portrait86.view.calibrated', true);
    rig.configure({ camera: { ...rig.config.camera, headBaseline: settings.camera.headBaseline } });
    rig.tracker.setActiveProfile('portrait86');
    expect(rig.tracker.diagnostics().headBaselineDeg.yaw).toBeCloseTo(-12, 6);
    rig.tracker.setActiveProfile('desktop');
    expect(rig.tracker.diagnostics().headBaselineDeg.yaw).toBeCloseTo(settings.camera.headBaseline.desktop.yaw, 6);

    // configure() with the OLD (unchanged) stored values does not undo a fresh capture …
    person = { eye: [0, 0.14, 0.62], yawDeg: -5 };
    await rig.run(1500);
    rig.tracker.startCalibration(0);
    await runUntil(rig, () => cal(rig).phase === 'done', 3000);
    const fresh = rig.calibrations[rig.calibrations.length - 1]!.values.headYaw!;
    expect(fresh).toBeCloseTo(-5, 0);
    rig.configure({ camera: { ...rig.config.camera } });
    expect(rig.tracker.diagnostics().headBaselineDeg.yaw).toBeCloseTo(fresh, 6);
    // … but a different stored value (e.g. Cancel in the settings dialog, or "Clear") wins.
    rig.configure({ camera: { ...rig.config.camera, headBaseline: { ...settings.camera.headBaseline, desktop: { yaw: 1, pitch: 0 } } } });
    expect(rig.tracker.diagnostics().headBaselineDeg.yaw).toBeCloseTo(1, 6);
  });

  it('phones: smaller frame, lower inference rate and one face (front camera); desktops unchanged', async () => {
    const phone = rigFor({ device: { mobile: true, cores: 8, memoryGb: 6 } });
    await tracked(phone, { eye: [0, 0.05, 0.35] });
    expect(phone.requests[0]!.resolution).toBe('360p');
    expect(phone.requests[0]!.deviceId).toBe(''); // no device chosen: the opener asks for facingMode 'user'
    expect(phone.backendOptions[0]!.numFaces).toBe(1);
    const before = phone.inferCalls;
    await phone.run(2000);
    expect((phone.inferCalls - before) / 2).toBeLessThanOrEqual(12.5);
    expect(phone.tracker.diagnostics().capture).toMatchObject({ lowPower: true, reason: 'phone', inferenceHz: 12 });

    const desk = rigFor();
    await tracked(desk, { eye: [0, 0.14, 0.62] });
    expect(desk.requests[0]!.resolution).toBe('480p');
    expect(desk.backendOptions[0]!.numFaces).toBe(2);
    const b = desk.inferCalls;
    await desk.run(2000);
    expect((desk.inferCalls - b) / 2).toBeGreaterThan(14);

    // Switching the mode on reopens the camera with the reduced frame size.
    desk.configure({ camera: { ...desk.config.camera, lowPower: 'on' } });
    await flush();
    await desk.run(500);
    expect(desk.requests[desk.requests.length - 1]!.resolution).toBe('360p');
  });

  it('the view never depends on anything but the camera: without a face it stays at the reference eye', async () => {
    const rig = rigFor();
    rig.scene = () => [];
    await rig.tracker.start();
    rig.tracker.startCalibration(0);
    const { eye, source } = await rig.run(4000);
    expect(source).toBe('neutral');
    expect(eye).toEqual(rig.config.view.eye);
    expect(cal(rig).detail).toBe('no_face');
  });

  it('auto-calibration is not started by the tracker itself', async () => {
    const rig = rigFor();
    await tracked(rig, { eye: [0, 0.14, 0.62] });
    await rig.run(5000);
    expect(cal(rig).phase).toBe('idle');
    expect(rig.calibrations).toHaveLength(0);
    const v: Vec3 = [0, 0, 0];
    rig.tracker.sampleEye(rig.clock.now, v);
  });
});
