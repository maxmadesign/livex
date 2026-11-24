import { describe, expect, it } from 'vitest';
import { DIFFICULTY_KEYS, DIFFICULTY_PRESETS } from '../../../src/app/presets';
import { defaultSettings, getFieldAt } from '../../../src/settings/spec';

describe('difficulty presets', () => {
  it('only contain physical parameters that the settings dialog can show', () => {
    for (const [name, preset] of Object.entries(DIFFICULTY_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual([...DIFFICULTY_KEYS].sort());
      for (const key of DIFFICULTY_KEYS) {
        const field = getFieldAt(`gameplay.${key}`);
        expect(field, `gameplay.${key}`).not.toBeNull();
        expect(field!.kind, `gameplay.${key}`).toBe('num');
        if (field && field.kind === 'num') {
          const v = preset[key];
          expect(v, `${name}.${key}`).toBeGreaterThanOrEqual(field.min);
          expect(v, `${name}.${key}`).toBeLessThanOrEqual(field.max);
          const steps = (v - field.min) / field.step;
          expect(Math.abs(steps - Math.round(steps)), `${name}.${key} is on the slider grid`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('Arcade is exactly what a fresh install plays', () => {
    const gameplay = defaultSettings().gameplay as unknown as Record<string, unknown>;
    expect(gameplay.difficulty).toBe('arcade');
    for (const key of DIFFICULTY_KEYS) expect(gameplay[key], key).toBe(DIFFICULTY_PRESETS.arcade[key]);
  });

  it('Easy → Arcade → Skill gets monotonically stricter', () => {
    const { easy, arcade, skill } = DIFFICULTY_PRESETS;
    // Weaker limited assist and a livelier cable ...
    expect(easy.gripAssist).toBeGreaterThan(arcade.gripAssist);
    expect(arcade.gripAssist).toBeGreaterThan(skill.gripAssist);
    expect(easy.ropeSwing).toBeLessThan(arcade.ropeSwing);
    expect(arcade.ropeSwing).toBeLessThan(skill.ropeSwing);
    // ... never a stronger claw, and everything moves a little faster.
    expect(easy.clawForce).toBeGreaterThanOrEqual(arcade.clawForce);
    expect(arcade.clawForce).toBeGreaterThanOrEqual(skill.clawForce);
    for (const key of ['moveSpeed', 'descendSpeed', 'liftSpeed'] as const) {
      expect(easy[key]).toBeLessThanOrEqual(arcade[key]);
      expect(arcade[key]).toBeLessThanOrEqual(skill[key]);
    }
    // Even Skill keeps some of the (slippable) assist: it is strict, not rigged.
    expect(skill.gripAssist).toBeGreaterThan(0);
  });
});
