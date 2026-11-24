import { describe, expect, it } from 'vitest';
import { AdaptiveQuality } from '../../../src/app/AdaptiveQuality';
import { GRAPHICS_PRESETS } from '../../../src/app/presets';
import { defaultSettings, type GraphicsSettings } from '../../../src/settings/spec';

function graphics(preset: keyof typeof GRAPHICS_PRESETS): GraphicsSettings {
  return { ...defaultSettings().graphics, ...GRAPHICS_PRESETS[preset], preset, autoOptimize: true };
}

/** Feeds `seconds` of frames of the given duration; returns how often the level changed. */
function feed(a: AdaptiveQuality, frameMs: number, seconds: number, targetFps = 60): number {
  let changes = 0;
  for (let t = 0; t < seconds * 1000; t += frameMs) if (a.sample(frameMs, targetFps)) changes++;
  return changes;
}

describe('AdaptiveQuality', () => {
  it('does nothing while the target is met', () => {
    const a = new AdaptiveQuality();
    expect(feed(a, 16.7, 30)).toBe(0);
    expect(a.level).toBe(0);
    const out = a.apply(graphics('ultra'));
    expect(out.reductions).toEqual([]);
    expect(out.scale).toBe(1);
    expect(out.graphics).toEqual(graphics('ultra'));
  });

  it('reduces only after sustained slow frames, one step at a time', () => {
    const a = new AdaptiveQuality();
    // Short bursts of slow frames (well under a fifth of the window) are not enough.
    for (let i = 0; i < 6; i++) {
      feed(a, 16.7, 2);
      feed(a, 30, 0.5);
    }
    feed(a, 16.7, 3);
    expect(a.level).toBe(0);
    // Several slow seconds in a row are, and each evaluation removes at most one step.
    const changes = feed(a, 30, 3.2);
    expect(a.level).toBeGreaterThanOrEqual(1);
    expect(changes).toBe(a.level);
    expect(a.level).toBeLessThanOrEqual(2);
  });

  it('removes cost in the documented order and never touches gameplay-relevant settings', () => {
    const user = graphics('ultra');
    const seenOrder: string[] = [];
    const a = new AdaptiveQuality();
    for (let level = 1; level <= 11; level++) {
      a.level = level;
      const { graphics: g, scale, reductions } = a.apply(user);
      for (const r of reductions) if (!seenOrder.includes(r)) seenOrder.push(r);
      // Never raised above the user's choice.
      expect(g.particles).toBeLessThanOrEqual(user.particles);
      expect(g.bloom).toBeLessThanOrEqual(user.bloom);
      expect(scale).toBeLessThanOrEqual(1);
      expect(scale).toBeGreaterThanOrEqual(0.5);
      // Things the optimiser must leave alone.
      expect(g.lod).toBe(user.lod);
      expect(g.textures).toBe(user.textures);
      expect(g.targetFps).toBe(user.targetFps);
      expect(g.renderScale).toBe(user.renderScale);
      expect(g.maxPixels).toBe(user.maxPixels);
      expect(g.preset).toBe(user.preset);
    }
    const index = (name: string) => seenOrder.indexOf(name);
    // particles → bloom → ambient occlusion → reflections / glass → resolution → shadows
    expect(index('particles')).toBe(0);
    expect(index('bloom')).toBeGreaterThan(index('particles'));
    expect(index('ao')).toBeGreaterThan(index('bloom'));
    expect(index('reflections')).toBeGreaterThan(index('ao'));
    expect(index('glass')).toBeGreaterThan(index('reflections'));
    expect(index('scale90')).toBeGreaterThan(index('glass'));
    expect(index('shadows')).toBeGreaterThan(index('scale90'));
    // The user's own settings object is never modified.
    expect(user).toEqual(graphics('ultra'));
  });

  it('a one-second dip to half the frame rate removes nothing', () => {
    const a = new AdaptiveQuality();
    feed(a, 16.7, 10);
    for (let i = 0; i < 5; i++) {
      expect(feed(a, 33, 1)).toBe(0);
      expect(feed(a, 16.7, 6)).toBe(0);
    }
    expect(a.level).toBe(0);
  });

  it('skips steps that would change nothing for the selected quality', () => {
    const a = new AdaptiveQuality();
    a.level = 5; // particles, bloom, ao, reflections, glass
    const safe = a.apply(graphics('safe'));
    // Safe has no bloom / AO / live reflections / transmission glass and few particles.
    expect(safe.reductions).toEqual([]);
    expect(safe.graphics).toEqual(graphics('safe'));
  });

  it('recovers slowly and does not flap on borderline frame times', () => {
    const a = new AdaptiveQuality();
    feed(a, 34, 8);
    // The one-second window that straddles the end of the slow period may still count as slow.
    feed(a, 16.7, 2);
    const reduced = a.level;
    expect(reduced).toBeGreaterThanOrEqual(2);
    // Frames inside the hysteresis band (neither clearly slow nor clearly fast) change nothing.
    expect(feed(a, 16.7, 20)).toBe(0);
    expect(feed(a, 18.5, 20)).toBe(0);
    expect(a.level).toBe(reduced);
    // Clearly fast frames restore one step only after several clean seconds.
    feed(a, 10, 3);
    expect(a.level).toBe(reduced);
    feed(a, 10, 12);
    expect(a.level).toBeLessThan(reduced);
    expect(a.level).toBeGreaterThanOrEqual(reduced - 3);
  });

  it('ignores huge hitches (tab switches, shader compilation)', () => {
    const a = new AdaptiveQuality();
    for (let i = 0; i < 200; i++) {
      a.sample(16.7, 60);
      if (i % 10 === 0) a.sample(900, 60);
    }
    expect(a.level).toBe(0);
  });

  it('respects the 30 fps target of the safe preset', () => {
    const a = new AdaptiveQuality();
    expect(feed(a, 33.3, 20, 30)).toBe(0);
    expect(a.level).toBe(0);
    feed(a, 55, 6, 30);
    expect(a.level).toBeGreaterThan(0);
  });

  it('changes nothing when disabled and forgets reductions on clear', () => {
    const a = new AdaptiveQuality();
    a.enabled = false;
    expect(feed(a, 80, 10)).toBe(0);
    a.level = 9;
    const off = a.apply(graphics('high'));
    expect(off.reductions).toEqual([]);
    expect(off.scale).toBe(1);
    expect(off.graphics).toEqual(graphics('high'));
    a.enabled = true;
    expect(a.apply(graphics('high')).reductions.length).toBeGreaterThan(0);
    a.clear();
    expect(a.level).toBe(0);
    expect(a.apply(graphics('high')).reductions).toEqual([]);
  });
});
