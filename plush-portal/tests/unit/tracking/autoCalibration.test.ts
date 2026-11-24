import { describe, expect, it } from 'vitest';
import { IDLE_CALIBRATION, type CalibrationStatus, type TrackerState } from '../../../src/core/contracts';
import { AutoCalibrationPolicy, type AutoCalibrationInput } from '../../../src/tracking/autoCalibration';
import { ROTATED } from '../../../src/tracking/countdown';

const countdown = (remaining = 3): CalibrationStatus => ({ phase: 'countdown', remaining, detail: '' });
const failed = (detail = 'unstable'): CalibrationStatus => ({ phase: 'failed', remaining: 0, detail });
const done: CalibrationStatus = { phase: 'done', remaining: 0, detail: 'ok' };

/** Drives a policy like the overlay does: state is kept here, `step` advances the clock. */
function harness(options: { autoCalibrate?: boolean } = {}) {
  const policy = new AutoCalibrationPolicy();
  const input: AutoCalibrationInput = {
    nowMs: 0,
    enabled: true,
    autoCalibrate: options.autoCalibrate ?? true,
    trackerState: 'idle',
    calibration: IDLE_CALIBRATION,
    roundIdle: true,
    modalOpen: false,
    visible: true,
  };
  const actions: string[] = [];
  /** One evaluation; the tracker reacts synchronously like the real one (start → countdown, cancel → idle). */
  const evaluate = () => {
    const action = policy.update(input);
    if (!action) return;
    actions.push(action);
    input.calibration = action === 'start' ? countdown() : IDLE_CALIBRATION;
  };
  const step = (ms: number, patch: Partial<AutoCalibrationInput> = {}) => {
    Object.assign(input, patch);
    const end = input.nowMs + ms;
    evaluate();
    while (input.nowMs < end) {
      input.nowMs = Math.min(end, input.nowMs + 250);
      evaluate();
    }
    return actions[actions.length - 1] ?? null;
  };
  /** Camera started and a face is tracked. */
  const track = () => {
    step(0, { trackerState: 'requesting' });
    step(500, { trackerState: 'searching' });
    step(0, { trackerState: 'tracking' });
  };
  return { policy, input, actions, step, track, set: (state: TrackerState) => step(0, { trackerState: state }) };
}

describe('AutoCalibrationPolicy', () => {
  it('starts once, after the camera started and a face was tracked steadily', () => {
    const h = harness();
    h.step(1000); // camera not started yet
    expect(h.actions).toEqual([]);
    h.track();
    expect(h.policy.armed).toBe(true);
    h.step(500);
    expect(h.actions).toEqual([]); // not steady long enough yet
    h.step(500);
    expect(h.actions).toEqual(['start']);
    expect(h.policy.running).toBe(true);
    // The countdown runs and completes: nothing more for this camera run.
    h.step(3000, { calibration: countdown() });
    h.step(2000, { calibration: done });
    h.step(5000, { calibration: IDLE_CALIBRATION });
    expect(h.actions).toEqual(['start']);
    expect(h.policy.armed).toBe(false);
  });

  it('never starts during a round: waits for READY / ATTRACT', () => {
    const h = harness();
    h.step(0, { roundIdle: false }); // the player is aiming / the claw is busy
    h.track();
    h.step(10_000);
    expect(h.actions).toEqual([]);
    h.step(1000, { roundIdle: true });
    expect(h.actions).toEqual(['start']);
  });

  it('cancels an automatic countdown when the round starts and tries again at the next READY', () => {
    const h = harness();
    h.track();
    h.step(1000);
    expect(h.actions).toEqual(['start']);
    h.step(1000, { calibration: countdown(2) });
    h.step(0, { roundIdle: false }); // player pressed a direction: AIMING
    expect(h.actions).toEqual(['start', 'cancel']);
    expect(h.policy.armed).toBe(true);
    h.step(15_000, { calibration: IDLE_CALIBRATION });
    expect(h.actions).toEqual(['start', 'cancel']);
    h.step(1000, { roundIdle: true });
    expect(h.actions).toEqual(['start', 'cancel', 'start']);
  });

  it('does not interfere with a calibration the player started by hand', () => {
    const h = harness({ autoCalibrate: false });
    h.track();
    h.step(1000, { calibration: countdown() });
    h.step(0, { roundIdle: false });
    expect(h.actions).toEqual([]);
  });

  it('waits while a dialog is open or the page is hidden', () => {
    const h = harness();
    h.step(0, { modalOpen: true });
    h.track();
    h.step(3000);
    expect(h.actions).toEqual([]);
    h.step(0, { modalOpen: false, visible: false });
    h.step(3000);
    expect(h.actions).toEqual([]);
    h.step(1000, { visible: true });
    expect(h.actions).toEqual(['start']);
  });

  it('arms again every time the camera is switched on again', () => {
    const h = harness();
    h.track();
    h.step(1000);
    h.step(4000, { calibration: done });
    h.step(1000, { calibration: IDLE_CALIBRATION });
    expect(h.actions).toEqual(['start']);
    h.step(0, { enabled: false, trackerState: 'off' });
    h.step(1000);
    h.step(0, { enabled: true, trackerState: 'idle' });
    h.track();
    h.step(1000);
    expect(h.actions).toEqual(['start', 'start']);
  });

  it('stays off when camera.autoCalibrate is off', () => {
    const h = harness({ autoCalibrate: false });
    h.track();
    h.step(20_000);
    expect(h.actions).toEqual([]);
  });

  it('a failed automatic run is not retried automatically; it is dismissed when a round starts or after a while', () => {
    const h = harness();
    h.track();
    h.step(1000);
    h.step(3000, { calibration: countdown() });
    h.step(500, { calibration: failed('no_face') });
    expect(h.actions).toEqual(['start']);
    h.step(0, { roundIdle: false });
    expect(h.actions).toEqual(['start', 'dismiss']);
    h.step(20_000, { calibration: IDLE_CALIBRATION, roundIdle: true });
    expect(h.actions).toEqual(['start', 'dismiss']);

    const left = harness();
    left.track();
    left.step(1000);
    left.step(500, { calibration: failed('unstable') });
    left.step(29_000);
    expect(left.actions).toEqual(['start']);
    left.step(1500);
    expect(left.actions).toEqual(['start', 'dismiss']);
  });

  it('a failure shown while a dialog covers it is kept for the full hold time after the dialog closes', () => {
    const h = harness({ autoCalibrate: false });
    h.track();
    h.step(0, { modalOpen: true }); // "Calibrate now" in the settings dialog
    h.step(5000, { calibration: failed('no_face') });
    h.step(60_000); // the player reads the dialog for a minute
    expect(h.actions).toEqual([]);
    h.step(29_000, { modalOpen: false });
    expect(h.actions).toEqual([]);
    h.step(1500);
    expect(h.actions).toEqual(['dismiss']);
  });

  it('Skip disarms until the next camera start', () => {
    const h = harness();
    h.track();
    h.step(1000);
    h.step(500, { calibration: countdown() });
    h.policy.skip();
    h.step(10_000, { calibration: IDLE_CALIBRATION });
    expect(h.actions).toEqual(['start']);
  });

  it('an automatic run interrupted by the page being hidden or the camera restarting is tried again', () => {
    const h = harness();
    h.track();
    h.step(1000);
    h.step(500, { calibration: countdown() });
    h.step(0, { calibration: IDLE_CALIBRATION, visible: false });
    expect(h.policy.armed).toBe(true);
    h.step(1000, { visible: true });
    expect(h.actions).toEqual(['start', 'start']);
  });

  it('does not loop when the tracker ignores the start (e.g. a null tracker)', () => {
    const policy = new AutoCalibrationPolicy();
    const input: AutoCalibrationInput = { nowMs: 0, enabled: true, autoCalibrate: true, trackerState: 'requesting', calibration: IDLE_CALIBRATION, roundIdle: true, modalOpen: false, visible: true };
    policy.update(input);
    input.trackerState = 'tracking';
    const actions: string[] = [];
    for (let t = 0; t <= 10_000; t += 250) {
      input.nowMs = t;
      const a = policy.update(input); // the status never leaves idle
      if (a) actions.push(a);
    }
    expect(actions).toEqual(['start']);
  });

  it('arms again after the camera picture rotated (phone turned)', () => {
    const h = harness();
    h.track();
    h.step(1000);
    h.step(3000, { calibration: done });
    h.step(500, { calibration: IDLE_CALIBRATION });
    h.step(0, { calibration: { phase: 'idle', remaining: 0, detail: ROTATED }, trackerState: 'searching' });
    h.step(500, { trackerState: 'tracking' });
    expect(h.actions).toEqual(['start']);
    h.step(500);
    expect(h.actions).toEqual(['start', 'start']);
    // Without automatic calibration the overlay shows a prompt instead.
    const manual = harness({ autoCalibrate: false });
    manual.track();
    manual.step(0, { calibration: { phase: 'idle', remaining: 0, detail: ROTATED } });
    manual.step(5000);
    expect(manual.actions).toEqual([]);
  });
});
