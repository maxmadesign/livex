/**
 * The prize-claim flow on the game side: decides whether a win earns a code, asks the server for it
 * and keeps the `reward` slice of the UI store (src/app/gameStore.ts) in step with the round.
 *
 *   prize passes the exit ─▶ issuing ─▶ ready (QR)          the win card appears: visibleUntil is set
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
import { createRewardClient, type RewardClient } from './client';
import { REWARDS_DEMO_BUILD, demoClaimUrl, localDemoCode, shouldIssue } from './policy';
import { isSafeHttpUrl } from './protocol';

export type RewardsSettings = Settings['rewards'];

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
    void this.client
      .issue({
        roundId: win.roundId,
        prizeId: win.prizeId,
        prizeName: win.prizeName,
        tier: win.tier,
        themeId: win.themeId,
        lang: win.lang,
        options: cfg.options,
        // Only well-formed owner links travel; anything else falls back to the built-in page / wording.
        claimUrl: cfg.claimUrl && isSafeHttpUrl(cfg.claimUrl) ? cfg.claimUrl : '',
        discountText: cfg.discountText.trim(),
        swagUrl: cfg.swagUrl && isSafeHttpUrl(cfg.swagUrl) ? cfg.swagUrl : '',
      })
      .then((result) => {
        const now = this.state;
        // PLAY AGAIN, a theme change or an idle reset came first: this answer belongs to nobody.
        if (now.roundId !== win.roundId || now.state !== 'issuing') return;
        if (result.ok) {
          const b = result.body;
          this.set({ ...now, state: 'ready', code: b.code, url: b.url, reach: b.reach, options: b.options, expiresAt: b.expiresAt, reason: null });
          if (b.reach === 'loopback') log('warn', 'rewards', 'claim page is only reachable on this machine: phones cannot open the QR code (see Settings → Rewards)');
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
