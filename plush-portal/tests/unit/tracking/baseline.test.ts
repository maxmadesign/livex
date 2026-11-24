import { beforeEach, describe, expect, it } from 'vitest';
import { DISPLAY_PROFILE_IDS, type Vec3 } from '../../../src/core/types';
import { defaultSettings, diffSettings, getFieldAt, sanitizeSettings, setValueAt } from '../../../src/settings/spec';
import { createSettingsStore } from '../../../src/settings/store';
import { baselineWrites, clearHeadBaselineWrites, headBiasFor, roundDegrees } from '../../../src/tracking/baseline';
import type { CalibrationValues } from '../../../src/tracking/calibration';
import { installMemoryStorage } from '../settings/memoryStorage';

const DEG = Math.PI / 180;

const baseline = (eye: Vec3, yaw: number, pitch: number): CalibrationValues => ({ calDepthK: 0, calNeutral: eye, calibrated: true, headYaw: yaw, headPitch: pitch });

describe('baseline persistence per display preset', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('declares a head-direction baseline for every display preset in the camera section', () => {
    const d = defaultSettings();
    for (const id of DISPLAY_PROFILE_IDS) {
      for (const axis of ['yaw', 'pitch']) {
        const field = getFieldAt(`camera.headBaseline.${id}.${axis}`);
        expect(field, `${id}.${axis}`).toMatchObject({ kind: 'num', def: 0, apply: 'live' });
      }
      expect(d.camera.headBaseline[id as keyof typeof d.camera.headBaseline]).toEqual({ yaw: 0, pitch: 0 });
    }
    expect(getFieldAt('camera.headWeight')).toMatchObject({ kind: 'num', def: 0.4, min: 0, max: 1.5 });
    expect(getFieldAt('camera.lowPower')).toMatchObject({ kind: 'enum', def: 'auto', options: ['auto', 'on', 'off'] });
  });

  it('writes eye + head baseline only into the active preset and keeps them across a reload', () => {
    const store = createSettingsStore();
    const before = store.getState().settings;
    for (const [path, value] of baselineWrites('portrait86', baseline([0.03, 0.48, 1.02], 6.04, -9.96))) store.getState().set(path, value);
    const after = store.getState().settings;
    const changed = diffSettings(before, after);
    expect(changed.sort()).toEqual(
      ['camera.headBaseline.portrait86.pitch', 'camera.headBaseline.portrait86.yaw', 'profiles.portrait86.view.calNeutral', 'profiles.portrait86.view.calibrated'].sort(),
    );
    expect(after.profiles.portrait86.view.calNeutral).toEqual([0.03, 0.48, 1.02]);
    expect(after.camera.headBaseline.portrait86).toEqual({ yaw: 6, pitch: -10 });
    for (const id of ['desktop', 'portrait32', 'mobile'] as const) {
      expect(after.profiles[id]).toEqual(before.profiles[id]);
      expect(after.camera.headBaseline[id]).toEqual({ yaw: 0, pitch: 0 });
    }
    // A fresh store (page reload) reads the same values back.
    const reloaded = createSettingsStore().getState().settings;
    expect(reloaded.profiles.portrait86.view.calibrated).toBe(true);
    expect(reloaded.profiles.portrait86.view.calNeutral).toEqual([0.03, 0.48, 1.02]);
    expect(reloaded.camera.headBaseline.portrait86).toEqual({ yaw: 6, pitch: -10 });
    // And the tracker reads radians for the active preset only.
    const bias = headBiasFor(reloaded.camera, 'portrait86', true);
    expect(bias.yaw / DEG).toBeCloseTo(6, 9);
    expect(bias.pitch / DEG).toBeCloseTo(-10, 9);
    expect(headBiasFor(reloaded.camera, 'desktop', true)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('two presets keep two independent baselines', () => {
    let s = defaultSettings();
    for (const [p, v] of baselineWrites('desktop', baseline([0.01, 0.13, 0.6], -3, 2))) s = setValueAt(s, p, v);
    for (const [p, v] of baselineWrites('mobile', baseline([0, 0.02, 0.35], 12, -20))) s = setValueAt(s, p, v);
    expect(s.camera.headBaseline.desktop).toEqual({ yaw: -3, pitch: 2 });
    expect(s.camera.headBaseline.mobile).toEqual({ yaw: 12, pitch: -20 });
    expect(s.profiles.desktop.view.calNeutral).toEqual([0.01, 0.13, 0.6]);
    expect(s.profiles.mobile.view.calNeutral).toEqual([0, 0.02, 0.35]);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('a quick calibration / re-centre (no head values) leaves the head baseline alone', () => {
    const writes = baselineWrites('desktop', { calDepthK: 33, calNeutral: [0, 0.1, 0.62], calibrated: true });
    expect(writes.map(([p]) => p)).toEqual(['profiles.desktop.view.calDepthK', 'profiles.desktop.view.calNeutral', 'profiles.desktop.view.calibrated']);
  });

  it('the head baseline counts only while the preset is calibrated; clearing resets it', () => {
    let s = defaultSettings();
    for (const [p, v] of baselineWrites('portrait32', baseline([0, 0.2, 0.62], 4, 4))) s = setValueAt(s, p, v);
    expect(headBiasFor(s.camera, 'portrait32', false)).toEqual({ yaw: 0, pitch: 0 });
    expect(headBiasFor(s.camera, null, true)).toEqual({ yaw: 0, pitch: 0 });
    for (const [p, v] of clearHeadBaselineWrites('portrait32')) s = setValueAt(s, p, v);
    expect(s.camera.headBaseline.portrait32).toEqual({ yaw: 0, pitch: 0 });
  });

  it('rounds to the 0.1° grid the settings keep, so the tracker and the store agree exactly', () => {
    for (const v of [6.04, -9.96, 0.05, 59.99, 72, -80]) {
      const r = roundDegrees(v);
      expect(setValueAt(defaultSettings(), 'camera.headBaseline.desktop.yaw', r).camera.headBaseline.desktop.yaw).toBe(r);
    }
    expect(roundDegrees(72)).toBe(60);
  });

  it('while the settings dialog is open the baseline goes into the draft (Apply keeps it, Cancel drops it)', () => {
    const store = createSettingsStore();
    store.getState().beginEdit();
    for (const [path, value] of baselineWrites('desktop', baseline([0.02, 0.15, 0.6], 3, -2))) store.getState().set(path, value);
    expect(store.getState().settings.camera.headBaseline.desktop).toEqual({ yaw: 0, pitch: 0 });
    expect(store.getState().view().camera.headBaseline.desktop).toEqual({ yaw: 3, pitch: -2 });
    store.getState().cancelEdit();
    expect(store.getState().view().camera.headBaseline.desktop).toEqual({ yaw: 0, pitch: 0 });
    store.getState().beginEdit();
    for (const [path, value] of baselineWrites('desktop', baseline([0.02, 0.15, 0.6], 3, -2))) store.getState().set(path, value);
    store.getState().applyEdit();
    expect(store.getState().settings.camera.headBaseline.desktop).toEqual({ yaw: 3, pitch: -2 });
  });
});
