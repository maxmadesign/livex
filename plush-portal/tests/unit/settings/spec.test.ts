import { describe, expect, it } from 'vitest';
import { DISPLAY_PROFILE_IDS } from '../../../src/core/types';
import {
  defaultSettings,
  diffSettings,
  exportableSettings,
  getFieldAt,
  getValueAt,
  isField,
  listFieldPaths,
  profileDefaults,
  sanitizeSettings,
  setValueAt,
  settingsSpec,
  type Field,
} from '../../../src/settings/spec';

describe('settings spec', () => {
  it('has valid defaults for every field', () => {
    const d = defaultSettings();
    for (const path of listFieldPaths()) {
      const field = getFieldAt(path)!;
      const value = getValueAt(d, path);
      expect(field, path).toBeTruthy();
      switch (field.kind) {
        case 'num':
          expect(typeof value, path).toBe('number');
          expect(value as number, path).toBeGreaterThanOrEqual(field.min);
          expect(value as number, path).toBeLessThanOrEqual(field.max);
          break;
        case 'bool':
          expect(typeof value, path).toBe('boolean');
          break;
        case 'enum':
          expect(field.options as readonly string[], path).toContain(value);
          break;
        case 'str':
          expect((value as string).length, path).toBeLessThanOrEqual(field.maxLen);
          break;
        case 'vec3':
          expect(value, path).toHaveLength(3);
          for (const c of value as number[]) {
            expect(c, path).toBeGreaterThanOrEqual(field.min);
            expect(c, path).toBeLessThanOrEqual(field.max);
          }
          break;
        default:
          expect(Array.isArray(value), path).toBe(true);
      }
    }
    // Sanitising the defaults changes nothing.
    expect(sanitizeSettings(d)).toEqual(d);
  });

  it('matches the product defaults that matter', () => {
    const d = defaultSettings();
    expect(d.system.language).toBe('en');
    expect(d.themes.current).toBe('sakura');
    expect(d.graphics.preset).toBe('medium');
    expect(d.gameplay.difficulty).toBe('arcade');
    expect(d.gameplay.toyCount).toBe(18);
    expect(d.gameplay.aimTimeLimit).toBe(0);
    expect(d.camera.enabled).toBe(true);
    expect(d.ai.enabled).toBe(true);
    expect(d.ai.provider).toBe('openai');
    expect(d.audio.muted).toBe(false);
    expect(d.graphics.dof).toBe(false);
    expect(d.graphics.motionBlur).toBe(false);
    const p86 = d.profiles.portrait86.layout;
    expect(p86.safeTop).toBe(0.25);
    expect(p86.safeBottom).toBe(0.75);
    expect(p86.anchorY).toBe(0.6);
    expect(d.profiles.portrait86.view.screenW).toBeCloseTo(1.071, 3);
    expect(d.profiles.portrait86.view.screenH).toBeCloseTo(1.904, 3);
    expect(d.profiles.portrait32.view.screenW).toBeCloseTo(0.398, 3);
    expect(d.profiles.portrait32.view.screenH).toBeCloseTo(0.708, 3);
  });

  it('repairs garbage, wrong types and out-of-range values', () => {
    for (const garbage of [null, undefined, 42, 'nope', [], { gameplay: 'x', graphics: [1, 2], profiles: null }]) {
      expect(sanitizeSettings(garbage)).toEqual(defaultSettings());
    }
    const dirty = sanitizeSettings({
      gameplay: { moveSpeed: 99, clawForce: -3, toyCount: 'many', difficulty: 'impossible', aimReticle: 'yes', unknownKey: 1 },
      graphics: { renderScale: Number.NaN, bloom: Number.POSITIVE_INFINITY, aa: 5, preset: 'ultra' },
      audio: { master: 7, muted: 0 },
      themes: { current: 'lava', disabledToys: ['a', 'a', 7, '', 'b'], customModels: [{ slotId: 's', fileKey: 'k', scale: 99 }, 'junk', { slotId: 1 }] },
      camera: { numFaces: 2.6, deviceId: 12 },
      ai: { systemPrompt: 'x'.repeat(9000), timeoutMs: 1 },
      system: { language: 'fr' },
      extra: { anything: true },
    });
    const d = defaultSettings();
    expect(dirty.gameplay.moveSpeed).toBe(0.9);
    expect(dirty.gameplay.clawForce).toBe(0.3);
    expect(dirty.gameplay.toyCount).toBe(d.gameplay.toyCount);
    expect(dirty.gameplay.difficulty).toBe('arcade');
    expect(dirty.gameplay.aimReticle).toBe(true);
    expect((dirty.gameplay as Record<string, unknown>).unknownKey).toBeUndefined();
    expect((dirty as Record<string, unknown>).extra).toBeUndefined();
    expect(dirty.graphics.renderScale).toBe(d.graphics.renderScale);
    expect(dirty.graphics.bloom).toBe(d.graphics.bloom);
    expect(dirty.graphics.aa).toBe(d.graphics.aa);
    expect(dirty.graphics.preset).toBe('ultra');
    expect(dirty.audio.master).toBe(1);
    expect(dirty.audio.muted).toBe(false);
    expect(dirty.themes.current).toBe('sakura');
    expect(dirty.themes.disabledToys).toEqual(['a', 'b']);
    expect(dirty.themes.customModels).toHaveLength(1);
    expect(dirty.themes.customModels[0]!.scale).toBe(2);
    expect(dirty.camera.numFaces).toBe(3);
    expect(dirty.camera.deviceId).toBe('');
    expect(dirty.ai.systemPrompt).toHaveLength(4000);
    expect(dirty.ai.timeoutMs).toBe(800);
    expect(dirty.system.language).toBe('en');
  });

  it('keeps the interactive zone usable no matter what is imported', () => {
    for (const id of DISPLAY_PROFILE_IDS) {
      const cases = [
        { safeTop: 0.6, safeBottom: 0.4, anchorY: 0.95 },
        { safeTop: 0.5, safeBottom: 0.55, anchorY: 0.2 },
        { safeTop: 0, safeBottom: 1, anchorY: 0.01 },
        { safeTop: 0.45, safeBottom: 0.6, anchorY: 0.9 },
        { safeTop: 99, safeBottom: -4, anchorY: Number.NaN },
      ];
      for (const layout of cases) {
        const s = sanitizeSettings({ profiles: { [id]: { layout } } });
        const l = s.profiles[id].layout;
        expect(l.safeBottom - l.safeTop, JSON.stringify(layout)).toBeGreaterThanOrEqual(0.3 - 1e-9);
        expect(l.safeTop).toBeGreaterThanOrEqual(0);
        expect(l.safeBottom).toBeLessThanOrEqual(1);
        expect(l.anchorY).toBeGreaterThanOrEqual(l.safeTop + 0.04 - 1e-9);
        expect(l.anchorY).toBeLessThanOrEqual(l.safeBottom - 0.04 + 1e-9);
      }
      // The reference eye can never end up behind (or inside) the glass.
      const v = sanitizeSettings({ profiles: { [id]: { view: { eye: [0, 0, -2], minDistance: 0.4 } } } }).profiles[id].view;
      expect(v.eye[2]).toBeGreaterThanOrEqual(v.minDistance);
    }
  });

  it('setValueAt is immutable, validates and ignores unknown paths', () => {
    const a = defaultSettings();
    const b = setValueAt(a, 'gameplay.moveSpeed', 0.61);
    expect(b).not.toBe(a);
    expect(a.gameplay.moveSpeed).toBe(defaultSettings().gameplay.moveSpeed);
    expect(b.gameplay.moveSpeed).toBe(0.61);
    expect(b.graphics).toBe(a.graphics); // untouched branches are shared
    expect(setValueAt(a, 'gameplay.moveSpeed', 'fast').gameplay.moveSpeed).toBe(a.gameplay.moveSpeed);
    expect(setValueAt(a, 'gameplay.moveSpeed', 1e9).gameplay.moveSpeed).toBe(0.9);
    expect(setValueAt(a, 'nope.nothing', 1)).toBe(a);
    expect(setValueAt(a, 'gameplay', {})).toBe(a);
    expect(diffSettings(a, b)).toEqual(['gameplay.moveSpeed']);
  });

  it('keeps the three display profiles independent', () => {
    const a = defaultSettings();
    let b = setValueAt(a, 'profiles.portrait86.layout.anchorY', 0.55);
    b = setValueAt(b, 'profiles.portrait86.layout.uiScale', 0.9);
    b = setValueAt(b, 'profiles.portrait86.view.eye', [0.1, 0.4, 1.2]);
    b = setValueAt(b, 'profiles.portrait86.view.calibrated', true);
    expect(b.profiles.desktop).toEqual(a.profiles.desktop);
    expect(b.profiles.portrait32).toEqual(a.profiles.portrait32);
    expect(b.profiles.portrait86.layout.anchorY).toBe(0.55);
    for (const path of diffSettings(a, b)) expect(path.startsWith('profiles.portrait86.')).toBe(true);
    // Each preset has its own defaults.
    expect(profileDefaults('portrait86')).toEqual(a.profiles.portrait86);
    expect(profileDefaults('portrait86').layout).not.toEqual(profileDefaults('portrait32').layout);
    expect(profileDefaults('desktop').view.windowMode).toBe('window');
  });

  it('never exports fields marked as local-only', () => {
    const s = setValueAt(setValueAt(defaultSettings(), 'system.lockPin', '4711'), 'system.lockSettings', true);
    const exported = exportableSettings(s) as { system: Record<string, unknown> };
    expect('lockPin' in exported.system).toBe(false);
    expect(JSON.stringify(exported)).not.toContain('4711');
    // Nothing in the spec looks like a credential.
    const paths = listFieldPaths().join('\n').toLowerCase();
    for (const word of ['apikey', 'api_key', 'secret', 'token', 'password']) expect(paths).not.toContain(word);
  });

  it('every spec leaf is a well-formed field', () => {
    const walk = (node: unknown, path: string) => {
      if (isField(node as Field)) {
        const f = node as Field;
        if (f.kind === 'num') {
          expect(f.min, path).toBeLessThan(f.max);
          expect(f.step, path).toBeGreaterThan(0);
        }
        expect(['live', 'round', 'rebuild'], path).toContain(f.apply);
        return;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(settingsSpec, '');
    // Authoritative gameplay values are never "live": they wait for a round boundary.
    for (const path of listFieldPaths()) {
      if (/^gameplay\.(moveSpeed|moveAccel|descendSpeed|liftSpeed|clawForce|closeSpeed|gripAssist|ropeSwing|toyFriction|toyMass|toyCount|aimTimeLimit|difficulty)$/.test(path)) {
        expect(getFieldAt(path)!.apply, path).not.toBe('live');
      }
      if (path.startsWith('graphics.')) expect(getFieldAt(path)!.apply, path).toBe('live');
    }
  });
});
