/**
 * When a win earns a claim code, and the public demo build's stand-in code.
 *
 * rewards.mode
 *   'gtc' (default) – only in the theme dressed by this build's brand kit (src/brand: the GPU theme)
 *   'all'           – in every theme
 *   'off'           – never
 * Demo / attract rounds never earn a code, whatever the mode.
 */
import { brandForTheme, type BrandKit } from '../brand';
import type { ThemeId } from '../core/types';
import type { Settings } from '../settings/spec';
import { randomBytes } from './client';
import { CODE_ALPHABET, REWARD_LIMITS } from './protocol';

export type RewardsMode = Settings['rewards']['mode'];

/**
 * Pure rule: does `mode` give codes in `theme`? `kitFor` says which brand kit dresses a theme
 * (the build's kit by default), so tests can check both kits.
 */
export function rewardsApply(mode: RewardsMode, theme: ThemeId, kitFor: (theme: ThemeId) => BrandKit | null = brandForTheme): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return kitFor(theme) !== null;
}

/** A won round earns a code: a real (never demo) win in a theme where rewards apply. */
export function shouldIssue(round: { demo: boolean; outcome?: string }, mode: RewardsMode, theme: ThemeId, kitFor?: (theme: ThemeId) => BrandKit | null): boolean {
  if (round.demo) return false;
  if (round.outcome !== undefined && round.outcome !== 'won') return false;
  return rewardsApply(mode, theme, kitFor);
}

/**
 * Public demo copies without the API server (build flag VITE_REWARDS_DEMO=1): the card shows a
 * clearly labelled DEMO code that no server knows and nobody can redeem.
 */
export const REWARDS_DEMO_BUILD: boolean = (import.meta.env?.VITE_REWARDS_DEMO ?? '').trim() === '1';

/** Where a demo code's QR points: a reserved example domain, never a real claim page. */
export const DEMO_CLAIM_BASE = 'https://example.com/plush-portal-demo/';

/** A random code in the claim alphabet (demo builds only: real codes come from the server). */
export function localDemoCode(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(REWARD_LIMITS.codeLength);
  let code = '';
  for (let i = 0; i < REWARD_LIMITS.codeLength; i++) code += CODE_ALPHABET[bytes[i]! & 31];
  return code;
}

export function demoClaimUrl(code: string): string {
  return `${DEMO_CLAIM_BASE}${code}`;
}

