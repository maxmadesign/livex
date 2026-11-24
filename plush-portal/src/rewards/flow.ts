/**
 * The prize-claim flow on the game side: decides whether a win earns a code, asks the server for it
 * and keeps the `reward` slice of the UI store (src/app/gameStore.ts) in step with the round.
 *
 *   prize passes the exit ─▶ issuing ─▶ ready (QR)          the win card appears: visibleUntil is set
 *                                   │   (reach loopback: the code without a QR, see localOnly)
 *                                   └─▶ unavailable (note)   no QR, ever faked
 *   demo build (VITE_REWARDS_DEMO=1) ─▶ demoBuild            local DEMO code, nothing sent
 *   PLAY AGAIN / theme change / idle reset / visibleUntil passed ─▶ idle (INITIAL_REWARD)
 *
 * Demo / attract rounds never get here with a code. Owned by src/app/Game.ts, which calls the hooks.
 */
import { INITIAL_REWARD, type GameStore, type RewardUiState } from '../app/gameStore';
import type { BrandKit } from '../brand';
import type { Lang, ThemeId } from '../core/types';
import { log } from '../diagnostics/log';
import type { RarityTier } from '../game/rarity';
import type { Settings } from '../settings/spec';
import { createRewardClient, type RewardClient, type RewardResult } from './client';
import { REWARDS_DEMO_BUILD, demoClaimUrl, localDemoCode, shouldIssue } from './policy';
import { REWARD_LIMITS, cleanDisplayText, isSafeHttpUrl, type IssueResponseBody } from './protocol';

export type RewardsSettings = Settings['rewards'];

/** An owner link setting as it is sent: trimmed, and '' unless it is a well-formed http(s) URL. */
export function ownLink(value: string): string {
  const link = value.trim();
  return link && isSafeHttpUrl(link) ? link : '';
}

/**
 * A code only this machine can open (reach "loopback": no LAN address, claim listener off or its
 * port busy): a phone scanning its QR would open 127.0.0.1 on itself. The kiosk draws no QR for
 * it; the code stays on the card for booth staff (docs/REWARDS.md, "reach").
 */
export function localOnly(reward: Pick<RewardUiState, 'state' | 'reach'>): boolean {
  return reward.state === 'ready' && reward.reach === 'loopback';
}

/**
 * True while the win card of the current round shows a QR code a visitor can scan: a real code
 * (or the labelled public-demo code) for this very round, not past its time, not a loopback-only
 * link, and not on a phone (the phone card shows a claim link instead). The guide only invites a
 * scan then (Game.facts → facts.reward).
 */
export function scannableQrOnScreen(
  reward: RewardUiState,
  at: { roundId: number; demo: boolean; phone: boolean; now: number; outcome?: string },
): boolean {
  if (at.demo || at.phone || (at.outcome !== undefined && at.outcome !== 'won')) return false;
  if (reward.roundId !== at.roundId || (reward.state !== 'ready' && reward.state !== 'demoBuild')) return false;
  if (localOnly(reward)) return false;
  return reward.visibleUntil <= 0 || at.now < reward.visibleUntil;
}

/** A real (or demo) win as the game reports it. */
export interface RewardWin {
  roundId: number;
  demo: boolean;
  themeId: ThemeId;
  /** Character type id of the plush (what staff hand out). */
  prizeId: string;
  /** Its display name in the interface language (shown on the claim page). */
  prizeName: string;
  tier: RarityTier;
  lang: Lang;
}

export interface RewardFlowDeps {
  ui: GameStore;
  /** The applied rewards settings (read at the moment of each win). */
  settings: () => RewardsSettings;
  /** Created on the first win that needs it. */
  client?: RewardClient;
  demoBuild?: boolean;
  now?: () => number;
  /** Which brand kit dresses a theme (tests); the build's kit by default. */
  kitFor?: (theme: ThemeId) => BrandKit | null;
}

/** States in which a QR (or its placeholder) is on the card. */
const SHOWS_QR: ReadonlySet<RewardUiState['state']> = new Set(['issuing', 'ready', 'demoBuild']);

export class RewardFlow {
  private client: RewardClient | null;
  private readonly demoBuild: boolean;
  private readonly now: () => number;

  constructor(private readonly deps: RewardFlowDeps) {
    this.client = deps.client ?? null;
    this.demoBuild = deps.demoBuild ?? REWARDS_DEMO_BUILD;
    this.now = deps.now ?? (() => Date.now());
  }

  private get state(): RewardUiState {
    return this.deps.ui.getState().reward;
  }

  private set(reward: RewardUiState): void {
    this.deps.ui.setState({ reward });
  }

  /**
   * The prize passed the exit (or the result reported a win the exit missed): request the code now,
   * so it is usually ready when the win card appears. Idempotent per round; never for demo rounds.
   */
  onWin(win: RewardWin): void {
    const cfg = this.deps.settings();
    if (!shouldIssue({ demo: win.demo }, cfg.mode, win.themeId, this.deps.kitFor)) return;
    const current = this.state;
    if (current.roundId === win.roundId && current.state !== 'idle') return;
    const base: RewardUiState = { ...INITIAL_REWARD, roundId: win.roundId, options: cfg.options };
    if (this.demoBuild) {
      // Public demo copy without a server: a local code, labelled DEMO on the card, unknown to any server.
      const code = localDemoCode();
      this.set({ ...base, state: 'demoBuild', code, url: demoClaimUrl(code) });
      return;
    }
    this.set({ ...base, state: 'issuing' });
    this.client ??= createRewardClient();
    let request: Promise<RewardResult<IssueResponseBody>>;
    try {
      request = this.client.issue({
        roundId: win.roundId,
        prizeId: win.prizeId,
        prizeName: win.prizeName,
        tier: win.tier,
        themeId: win.themeId,
        lang: win.lang,
        options: cfg.options,
        // Only well-formed owner links travel (trimmed: a pasted space must not end up in the QR);
        // anything else falls back to the built-in page / wording.
        claimUrl: ownLink(cfg.claimUrl),
        discountText: cleanDisplayText(cfg.discountText, REWARD_LIMITS.maxDiscountTextChars),
        swagUrl: ownLink(cfg.swagUrl),
      });
    } catch {
      // Never leave the card spinning: no request went out, so the card says no code came.
      request = Promise.resolve({ ok: false, reason: 'error' });
    }
    void request
      .then((result) => {
        const now = this.state;
        // PLAY AGAIN, a theme change or an idle reset came first: this answer belongs to nobody.
        if (now.roundId !== win.roundId || now.state !== 'issuing') return;
        if (result.ok) {
          const b = result.body;
          this.set({ ...now, state: 'ready', code: b.code, url: b.url, reach: b.reach, options: b.options, expiresAt: b.expiresAt, reason: null });
          if (b.reach === 'loopback') log('warn', 'rewards', 'claim page is only reachable on this machine: the card shows the code without a QR (see Settings → Rewards)');
        } else {
          // No QR without a real code: the card says so honestly and the idle reset need not wait.
          this.set({ ...now, state: 'unavailable', reason: result.reason, code: null, url: null, visibleUntil: 0 });
          log('warn', 'rewards', `no claim code for round ${win.roundId}: ${result.reason}`);
        }
      });
  }

  /** The win card of `roundId` appeared: the QR stays up for rewards.qrSeconds from now. */
  onCardShown(roundId: number): void {
    const r = this.state;
    if (r.roundId !== roundId || !SHOWS_QR.has(r.state) || r.visibleUntil > 0) return;
    const seconds = Math.max(1, this.deps.settings().qrSeconds);
    this.set({ ...r, visibleUntil: this.now() + seconds * 1000 });
  }

  /** True while a QR card is on screen: the idle reset waits until visibleUntil. */
  holdsIdle(now = this.now()): boolean {
    const r = this.state;
    return SHOWS_QR.has(r.state) && r.visibleUntil > now;
  }

  /** Per frame: the QR hides by itself once visibleUntil has passed. */
  tick(now = this.now()): void {
    const r = this.state;
    if (SHOWS_QR.has(r.state) && r.visibleUntil > 0 && now >= r.visibleUntil) this.reset();
  }

  /** PLAY AGAIN, a theme change, a new player, the idle reset: nothing to show any more. */
  reset(): void {
    if (this.state !== INITIAL_REWARD) this.set(INITIAL_REWARD);
  }
}
