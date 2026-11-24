import { describe, expect, it } from 'vitest';
import { JACKPOT_SECONDS, WIN_SECONDS } from '../../../src/scene/fx/constants';
import type { FxTier } from '../../../src/scene/fx/api';
import { EXIT, makeFx, peakFamilies, run } from './helpers';

const TIERS: FxTier[] = ['common', 'rare', 'epic', 'legendary'];

function celebrateAndWatch(tier: FxTier) {
  const fx = makeFx({ budget: 60, intensity: 1 });
  fx.lightShow('idle');
  fx.celebrate(tier, EXIT);
  const spawned = fx.liveCount();
  fx.update(1 / 60);
  const first = fx.fxState();
  const modes = new Set<string>();
  let flash = first.flash;
  let peakLive = 0;
  const families = peakFamilies(fx, 3.5);
  run(fx, 0.01);
  // Second pass for light-show observations over the whole show.
  const fx2 = makeFx({ budget: 60, intensity: 1 });
  fx2.lightShow('idle');
  fx2.celebrate(tier, EXIT);
  run(fx2, 4.5, () => {
    const s = fx2.fxState();
    modes.add(s.lightShowActive);
    flash ||= s.flash;
    peakLive = Math.max(peakLive, s.live);
  });
  const end = fx2.fxState();
  fx.dispose();
  fx2.dispose();
  return { spawned, families, modes, flash, peakLive, end };
}

describe('celebrate escalates by tier', () => {
  const results = Object.fromEntries(TIERS.map((t) => [t, celebrateAndWatch(t)])) as Record<FxTier, ReturnType<typeof celebrateAndWatch>>;

  it('common: sparkle burst and confetti only', () => {
    const r = results.common;
    expect(r.families.sparkle).toBeGreaterThan(10);
    expect(r.families.confetti).toBeGreaterThan(20);
    expect(r.families.motif).toBeGreaterThan(0);
    expect(r.families.ring ?? 0).toBe(0);
    expect(r.families.firework ?? 0).toBe(0);
    expect(r.flash).toBe(false);
    expect([...r.modes]).toEqual(['idle']);
  });

  it('rare: adds a shockwave and a light flash', () => {
    const r = results.rare;
    expect(r.families.ring).toBeGreaterThanOrEqual(1);
    expect(r.families.spark).toBeGreaterThan(0);
    expect(r.flash).toBe(true);
    expect(r.families.firework ?? 0).toBe(0);
    expect(r.modes.has('win')).toBe(false);
  });

  it('epic: adds fireworks, star-burst rays and the win light show', () => {
    const r = results.epic;
    expect(r.families.shell).toBeGreaterThan(0);
    expect(r.families.firework).toBeGreaterThan(20);
    expect(r.families.ray).toBeGreaterThan(0);
    expect(r.modes.has('win')).toBe(true);
    expect(r.modes.has('jackpot')).toBe(false);
  });

  it('legendary: everything plus coins, confetti rain and the jackpot show', () => {
    const r = results.legendary;
    expect(r.families.coin).toBeGreaterThan(0);
    expect(r.families.rain).toBeGreaterThan(0);
    expect(r.families.firework).toBeGreaterThan(results.epic.families.firework!);
    expect(r.modes.has('jackpot')).toBe(true);
  });

  it('particle counts grow with every tier', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(results[TIERS[i]!].spawned).toBeGreaterThan(results[TIERS[i - 1]!].spawned);
      expect(results[TIERS[i]!].peakLive).toBeGreaterThan(results[TIERS[i - 1]!].peakLive);
    }
  });

  it('timed shows return to the persistent mode afterwards', () => {
    expect(results.epic.end.lightShowActive).toBe('idle');
    expect(results.legendary.end.lightShowActive).toBe('idle');
    expect(results.legendary.end.lightShow).toBe('idle');
  });
});

describe('light show modes', () => {
  it('win lasts about 2.6 s and jackpot about 4 s', () => {
    for (const [mode, seconds] of [['win', WIN_SECONDS], ['jackpot', JACKPOT_SECONDS]] as const) {
      const fx = makeFx();
      fx.lightShow('attract');
      fx.lightShow(mode);
      run(fx, seconds - 0.2);
      expect(fx.fxState().lightShowActive).toBe(mode);
      run(fx, 0.4);
      expect(fx.fxState().lightShowActive).toBe('attract');
      fx.dispose();
    }
  });

  it('beams per mode: off none, idle subtle, attract lively, jackpot all', () => {
    const counts: Record<string, number> = {};
    for (const mode of ['off', 'idle', 'attract', 'win', 'jackpot'] as const) {
      const fx = makeFx();
      fx.lightShow(mode);
      run(fx, 1.5);
      counts[mode] = fx.fxState().beams;
      fx.dispose();
    }
    expect(counts.off).toBe(0);
    expect(counts.idle).toBe(2);
    expect(counts.attract).toBe(4);
    expect(counts.win).toBe(6);
    expect(counts.jackpot).toBe(6);
  });

  it("'off' cancels a running timed show; idle does not", () => {
    const fx = makeFx();
    fx.lightShow('jackpot');
    fx.lightShow('idle');
    run(fx, 0.5);
    expect(fx.fxState().lightShowActive).toBe('jackpot');
    fx.lightShow('off');
    run(fx, 0.1);
    expect(fx.fxState().lightShowActive).toBe('off');
    run(fx, 2);
    expect(fx.fxState().beams).toBe(0);
    fx.dispose();
  });

  it('the cabinet LED energy follows the show', () => {
    const fx = makeFx();
    fx.lightShow('idle');
    run(fx, 1);
    const idle = fx.ledEnergy();
    fx.lightShow('attract');
    run(fx, 1);
    const attract = fx.ledEnergy();
    fx.lightShow('jackpot');
    run(fx, 1);
    const jackpot = fx.ledEnergy();
    expect(idle).toBeLessThan(0.05);
    expect(attract).toBeGreaterThan(idle);
    expect(jackpot).toBeGreaterThan(attract);
    expect(jackpot).toBeLessThanOrEqual(1);
    fx.dispose();
  });
});
