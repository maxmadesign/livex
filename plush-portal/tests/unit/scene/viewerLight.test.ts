import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../../src/themes/themes';
import { VIEWER_CORE, VIEWER_EDGE, VIEWER_INTENSITY, VIEWER_LEAD, VIEWER_LIFT, VIEWER_SHADOW, VIEWER_TARGET, ViewerLight, viewerCone, viewerLightColor } from '../../../src/scene/viewerLight';

const target = new Vector3(...VIEWER_TARGET);

describe('viewer light', () => {
  /**
   * Where the light should be for an eye: above it by VIEWER_LIFT × its distance to the target, and
   * VIEWER_LEAD times as far from the window's centre line sideways.
   */
  const expected = (eye: readonly [number, number, number]) => [eye[0] * VIEWER_LEAD, eye[1] + target.distanceTo(new Vector3(...eye)) * VIEWER_LIFT, eye[2]];

  it('stands just above the eye (leading it sideways) and keeps aiming at the middle of the play field', () => {
    const v = new ViewerLight(31);
    for (const eye of [
      [0, 0.86, 2.7],
      [-1.08, 0.86, 2.7],
      [1.08, 0.86, 2.7],
      [0, 0.004, 2.7],
      [0, 1.71, 2.7],
      [0.4, 0.72, 1.65],
    ] as const) {
      v.setEye(eye[0], eye[1], eye[2]);
      const want = expected(eye);
      expect(v.light.position.x).toBeCloseTo(want[0]!, 12);
      expect(v.light.position.y).toBeCloseTo(want[1]!, 12);
      expect(v.light.position.z).toBe(want[2]);
      expect(v.eyePosition(new Vector3()).toArray()).toEqual([eye[0], eye[1], eye[2]]);
      // A little over ten degrees above the line of sight (straight ahead): the shadows peek out from behind their casters.
      if (eye[0] === 0) {
        const toEye = new Vector3(...eye).sub(target).normalize();
        const toLight = v.light.position.clone().sub(target).normalize();
        const degrees = (Math.acos(toEye.dot(toLight)) * 180) / Math.PI;
        expect(degrees).toBeGreaterThan(8);
        expect(degrees).toBeLessThan(14);
      }
      expect(v.light.target.position.toArray()).toEqual([...VIEWER_TARGET]);
      // The shadow camera looks from the eye towards the target.
      v.light.shadow.updateMatrices(v.light);
      const cam = v.light.shadow.camera;
      expect(cam.position.distanceTo(v.light.position)).toBeLessThan(1e-9);
      const forward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const toTarget = target.clone().sub(cam.position).normalize();
      expect(forward.dot(toTarget)).toBeGreaterThan(0.9999);
    }
  });

  it('moves the same way as the eye, frame by frame (no lag, no smoothing of its own)', () => {
    const v = new ViewerLight(31);
    let x = -0.5;
    for (let i = 0; i < 20; i++, x += 0.05) {
      const eye = [x, 0.8 + i * 0.01, 2.5] as const;
      v.setEye(eye[0], eye[1], eye[2]);
      const want = expected(eye);
      expect(v.light.position.x).toBeCloseTo(want[0]!, 12);
      expect(v.light.position.y).toBeCloseTo(want[1]!, 12);
      expect(v.light.position.z).toBeCloseTo(want[2]!, 12);
    }
    // Step left: the light goes left too (further than the eye), so shadows slide right.
    v.setEye(0, 0.86, 2.7);
    const centre = v.light.position.x;
    v.setEye(-0.3, 0.86, 2.7);
    expect(v.light.position.x).toBeLessThan(centre - 0.3);
  });

  it('stays in front of the glass', () => {
    const v = new ViewerLight(31);
    v.setEye(0, 0.5, -0.3);
    expect(v.light.position.z).toBeGreaterThan(0);
  });

  it('lights the play field fully and fades out beyond it, from any viewing distance', () => {
    for (const d of [0.95, 1.65, 3.1, 7.4]) {
      const { angle, penumbra } = viewerCone(d);
      // Light ends where the cone ends: VIEWER_EDGE from the target (or the widest cone allowed).
      expect(Math.tan(angle) * d).toBeCloseTo(Math.min(VIEWER_EDGE, Math.tan(1.25) * d), 6);
      // Full strength inside angle·(1 − penumbra): about VIEWER_CORE around the target.
      const inner = angle * (1 - penumbra);
      expect(Math.tan(inner) * d).toBeGreaterThan(VIEWER_CORE * 0.95);
      expect(penumbra).toBeGreaterThan(0.2);
      expect(penumbra).toBeLessThanOrEqual(1);
    }
  });

  it('brings the same light to the target whatever the distance (decay normalised there)', () => {
    const v = new ViewerLight(31);
    for (const eye of [
      [0, 0.86, 2.7],
      [0, 0.72, 1.65],
      [0, 0.3, 7.0],
    ] as const) {
      v.setEye(eye[0], eye[1], eye[2]);
      const distance = v.light.position.distanceTo(target);
      const atTarget = v.light.intensity / Math.pow(distance, v.light.decay);
      expect(atTarget).toBeCloseTo(VIEWER_INTENSITY, 9);
    }
  });

  it('follows the tiers: no shadow on Off / Low (Safe), 1024 on Medium, 2048 on High; off when the setting is off', () => {
    const v = new ViewerLight(31);
    expect(VIEWER_SHADOW.off.size).toBe(0);
    expect(VIEWER_SHADOW.low.size).toBe(0);
    v.setQuality(true, 'low');
    expect(v.light.visible).toBe(true);
    expect(v.light.castShadow).toBe(false);
    v.setQuality(true, 'medium');
    expect(v.light.castShadow).toBe(true);
    expect(v.light.shadow.mapSize.x).toBe(1024);
    expect(v.shadowMapSize).toBe(1024);
    v.setQuality(true, 'high');
    expect(v.light.shadow.mapSize.x).toBe(2048);
    expect(v.light.shadow.radius).toBeGreaterThan(VIEWER_SHADOW.medium.radius);
    v.setQuality(false, 'high');
    expect(v.light.visible).toBe(false);
    expect(v.light.castShadow).toBe(false);
    expect(v.shadowMapSize).toBe(0);
  });

  it('redraws its shadow map only when the eye or a caster moved', () => {
    const v = new ViewerLight(31);
    v.setQuality(true, 'medium');
    v.setEye(0, 0.86, 2.7);
    // A fresh light has no map yet: the first frame always draws.
    expect(v.needsShadow(100)).toBe(true);
    // Pretend the shadow pass ran (three.js clears the flag and keeps the map).
    v.light.shadow.needsUpdate = false;
    (v.light.shadow as unknown as { map: object }).map = {};
    expect(v.needsShadow(100)).toBe(false);
    expect(v.needsShadow(100)).toBe(false);
    // A caster moved.
    expect(v.needsShadow(101)).toBe(true);
    v.light.shadow.needsUpdate = false;
    expect(v.needsShadow(101)).toBe(false);
    // The eye moved.
    v.setEye(0.01, 0.86, 2.7);
    expect(v.needsShadow(101)).toBe(true);
    v.light.shadow.needsUpdate = false;
    // Layout / theme / quality changes force a redraw.
    v.invalidate();
    expect(v.needsShadow(101)).toBe(true);
    // Without a shadow nothing is drawn.
    v.setQuality(true, 'low');
    expect(v.needsShadow(5)).toBe(false);
  });

  it('is neutral white in the brand-kit / circuit theme, a warm white elsewhere', () => {
    expect(viewerLightColor(THEMES.gpu)).toBe('#ffffff');
    for (const id of ['sakura', 'storybook', 'ocean', 'cosmic'] as const) {
      const hex = viewerLightColor(THEMES[id]);
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      expect(r).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThanOrEqual(b);
      expect(b).toBeGreaterThan(200);
    }
    const v = new ViewerLight(31);
    v.setTheme(THEMES.gpu);
    expect(v.light.color.getHexString()).toBe('ffffff');
  });

  it('is drawn by the shadow pre-pass (its shadow camera sees the pre-pass layer and layer 0)', () => {
    const v = new ViewerLight(31);
    expect(v.light.shadow.camera.layers.isEnabled(31)).toBe(true);
    expect(v.light.shadow.camera.layers.isEnabled(0)).toBe(true);
    expect(v.light.shadow.autoUpdate).toBe(false);
  });
});
