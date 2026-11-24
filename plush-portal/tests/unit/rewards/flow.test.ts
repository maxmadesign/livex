import { describe, expect, it, vi } from 'vitest';
import { INITIAL_REWARD, createGameStore, type RewardUiState } from '../../../src/app/gameStore';
import { BRAND_KITS, type BrandKit } from '../../../src/brand/kits';
import { THEME_IDS, type ThemeId } from '../../../src/core/types';
import type { IssueInput, RewardClient } from '../../../src/rewards/client';
import { RewardFlow, localOnly, ownLink, scannableQrOnScreen, type RewardWin, type RewardsSettings } from '../../../src/rewards/flow';
import { DEMO_CLAIM_BASE, localDemoCode, rewardsApply, shouldIssue } from '../../../src/rewards/policy';
import { CODE_ALPHABET, UNSAFE_TEXT_CHARS, cleanDisplayText, type IssueResponseBody } from '../../../src/rewards/protocol';
import { defaultSettings } from '../../../src/settings/spec';

const kitFor = (kit: BrandKit | null) => (theme: ThemeId) => (kit && kit.theme === theme ? kit : null);

describe('when rewards apply', () => {
  it('mode gtc: only the theme the build kit dresses, for both kits', () => {
    for (const kit of [BRAND_KITS.gtc, BRAND_KITS.neutral]) {
      for (const theme of THEME_IDS) expect(rewardsApply('gtc', theme, kitFor(kit)), `${kit.id}/${theme}`).toBe(theme === kit.theme);
    }
    // A build whose kit dresses no theme gives no codes in gtc mode.
    for (const theme of THEME_IDS) expect(rewardsApply('gtc', theme, kitFor(null))).toBe(false);
  });

  it('mode all: every theme; mode off: none', () => {
    for (const theme of THEME_IDS) {
      expect(rewardsApply('all', theme, kitFor(null))).toBe(true);
      expect(rewardsApply('off', theme, kitFor(BRAND_KITS.gtc))).toBe(false);
    }
  });

  it('the default build (gtc kit) and default settings: the GPU theme only', () => {
    expect(defaultSettings().rewards.mode).toBe('gtc');
    expect(rewardsApply('gtc', 'gpu')).toBe(true);
    expect(rewardsApply('gtc', 'sakura')).toBe(false);
  });

  it('never for demo rounds, never for a round that was not won', () => {
    for (const mode of ['gtc', 'all', 'off'] as const) {
      expect(shouldIssue({ demo: true, outcome: 'won' }, mode, 'gpu', kitFor(BRAND_KITS.gtc))).toBe(false);
      expect(shouldIssue({ demo: false, outcome: 'slipped' }, mode, 'gpu', kitFor(BRAND_KITS.gtc))).toBe(false);
    }
    expect(shouldIssue({ demo: false, outcome: 'won' }, 'gtc', 'gpu', kitFor(BRAND_KITS.gtc))).toBe(true);
  });

  it('demo-build codes use the claim alphabet and a reserved example domain', () => {
    const code = localDemoCode();
    expect(code).toHaveLength(8);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(DEMO_CLAIM_BASE.startsWith('https://example.com/')).toBe(true);
  });
});

const ISSUED: IssueResponseBody = {
  code: 'K7M2QX9D',
  url: 'http://192.168.1.20:8788/c/K7M2QX9D',
  reach: 'lan',
  issuedAt: '2026-11-24T20:00:00.000Z',
  expiresAt: '2026-11-26T20:00:00.000Z',
  options: 'both',
  repeated: false,
};

function win(over: Partial<RewardWin> = {}): RewardWin {
  return { roundId: 5, demo: false, themeId: 'gpu', prizeId: 'gpu_keynote_chief', prizeName: 'Keynote Chief', tier: 'legendary', lang: 'en', ...over };
}

type IssueAnswer = Awaited<ReturnType<RewardClient['issue']>>;

function setup(opts: { settings?: Partial<RewardsSettings>; demoBuild?: boolean; kit?: BrandKit | null } = {}) {
  const ui = createGameStore('desktop', true, 'gpu');
  let now = 1_000_000;
  const settings: RewardsSettings = { ...defaultSettings().rewards, ...opts.settings };
  let release: (value: IssueAnswer) => void = () => undefined;
  // The server answers when the test says so (`answer`).
  const issue = vi.fn(
    (_input: IssueInput) =>
      new Promise<IssueAnswer>((resolve) => {
        release = resolve;
      }),
  );
  const client: RewardClient = { session: 'S', status: vi.fn(), issue };
  const flow = new RewardFlow({ ui, settings: () => settings, client, demoBuild: opts.demoBuild ?? false, now: () => now, kitFor: kitFor(opts.kit === undefined ? BRAND_KITS.gtc : opts.kit) });
  return {
    ui,
    flow,
    issue,
    reward: () => ui.getState().reward,
    answer: async (value: IssueAnswer) => {
      release(value);
      await Promise.resolve();
      await Promise.resolve();
    },
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

describe('reward flow', () => {
  it('a real win in the GPU theme: issuing, then ready with the server code', async () => {
    const t = setup();
    t.flow.onWin(win());
    expect(t.reward()).toMatchObject({ state: 'issuing', roundId: 5, code: null, url: null });
    expect(t.issue).toHaveBeenCalledTimes(1);
    expect(t.issue.mock.calls[0]![0]).toMatchObject({ roundId: 5, prizeId: 'gpu_keynote_chief', prizeName: 'Keynote Chief', themeId: 'gpu', options: 'both', claimUrl: '' });
    await t.answer({ ok: true, body: ISSUED });
    expect(t.reward()).toMatchObject({ state: 'ready', roundId: 5, code: 'K7M2QX9D', url: ISSUED.url, reach: 'lan', reason: null });
    // The same round again (the result after the exit event): no second request.
    t.flow.onWin(win());
    expect(t.issue).toHaveBeenCalledTimes(1);
  });

  it('demo rounds, other themes in gtc mode and mode off never ask', () => {
    for (const [label, w, settings] of [
      ['demo round', win({ demo: true }), {}],
      ['sakura in gtc mode', win({ themeId: 'sakura' }), {}],
      ['mode off', win(), { mode: 'off' as const }],
    ] as const) {
      const t = setup({ settings });
      t.flow.onWin(w);
      expect(t.reward(), label).toBe(INITIAL_REWARD);
      expect(t.issue, label).not.toHaveBeenCalled();
    }
    // Mode all: another theme gets a code too.
    const all = setup({ settings: { mode: 'all' } });
    all.flow.onWin(win({ themeId: 'sakura' }));
    expect(all.reward().state).toBe('issuing');
  });

  it('a failure is reported honestly: no code, no URL, and the idle reset need not wait', async () => {
    const t = setup();
    t.flow.onWin(win());
    t.flow.onCardShown(5);
    expect(t.flow.holdsIdle()).toBe(true);
    await t.answer({ ok: false, reason: 'storage' });
    expect(t.reward()).toMatchObject({ state: 'unavailable', reason: 'storage', code: null, url: null, visibleUntil: 0 });
    expect(t.flow.holdsIdle()).toBe(false);
  });

  it('an answer that arrives after PLAY AGAIN is dropped', async () => {
    const t = setup();
    t.flow.onWin(win());
    t.flow.reset();
    await t.answer({ ok: true, body: ISSUED });
    expect(t.reward()).toBe(INITIAL_REWARD);
  });

  it('the card shows the QR for qrSeconds, holds the idle reset meanwhile, then hides it by itself', async () => {
    const t = setup({ settings: { qrSeconds: 30 } });
    t.flow.onWin(win());
    await t.answer({ ok: true, body: ISSUED });
    expect(t.flow.holdsIdle()).toBe(false); // no card yet
    t.flow.onCardShown(5);
    expect(t.reward().visibleUntil).toBe(t.now() + 30_000);
    // A second "shown" (re-render, the exit event and the result) does not extend it.
    t.advance(10_000);
    t.flow.onCardShown(5);
    expect(t.reward().visibleUntil).toBe(t.now() + 20_000);
    t.advance(19_999);
    t.flow.tick();
    expect(t.flow.holdsIdle()).toBe(true);
    expect(t.reward().state).toBe('ready');
    t.advance(1);
    expect(t.flow.holdsIdle()).toBe(false);
    t.flow.tick();
    expect(t.reward()).toBe(INITIAL_REWARD);
  });

  it('a card shown for another round does not start this QR', async () => {
    const t = setup();
    t.flow.onWin(win());
    t.flow.onCardShown(4);
    expect(t.reward().visibleUntil).toBe(0);
  });

  it('only well-formed owner links are sent', () => {
    const t = setup({ settings: { claimUrl: 'ftp://nope/{code}', swagUrl: 'https://shop.example.com', discountText: ' 20% off ' } });
    t.flow.onWin(win());
    expect(t.issue.mock.calls[0]![0]).toMatchObject({ claimUrl: '', swagUrl: 'https://shop.example.com', discountText: '20% off' });
  });

  it('demo build: a local DEMO code, nothing is sent', () => {
    const t = setup({ demoBuild: true });
    t.flow.onWin(win());
    const r = t.reward();
    expect(r.state).toBe('demoBuild');
    expect(r.code).toHaveLength(8);
    expect(r.url).toBe(`${DEMO_CLAIM_BASE}${r.code}`);
    expect(t.issue).not.toHaveBeenCalled();
    // Still never for demo rounds.
    const d = setup({ demoBuild: true });
    d.flow.onWin(win({ demo: true }));
    expect(d.reward()).toBe(INITIAL_REWARD);
  });

  it('a client that throws while asking never leaves the card spinning', async () => {
    const ui = createGameStore('desktop', true, 'gpu');
    const client: RewardClient = {
      session: 'S',
      status: vi.fn(),
      issue: () => {
        throw new Error('boom');
      },
    };
    const flow = new RewardFlow({ ui, settings: () => defaultSettings().rewards, client, demoBuild: false, kitFor: kitFor(BRAND_KITS.gtc) });
    flow.onWin(win());
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.getState().reward).toMatchObject({ state: 'unavailable', reason: 'error', roundId: 5 });
  });

  it('owner links are trimmed and only well-formed http(s) links are kept', () => {
    expect(ownLink('  https://claim.example.com/c/{code} ')).toBe('https://claim.example.com/c/{code}');
    expect(ownLink('ftp://x/{code}')).toBe('');
    expect(ownLink('javascript:alert(1)')).toBe('');
    expect(ownLink('https://user:pw@example.com/')).toBe('');
    expect(ownLink('   ')).toBe('');
    const t = setup({ settings: { claimUrl: ' https://claim.example.com/c/{code} ', discountText: '20% off\tall swag' } });
    t.flow.onWin(win());
    expect(t.issue.mock.calls[0]![0]).toMatchObject({ claimUrl: 'https://claim.example.com/c/{code}', discountText: '20% off all swag' });
  });
});

describe('what the card and the guide may say about the QR', () => {
  const ready = (over: Partial<RewardUiState> = {}): RewardUiState => ({ ...INITIAL_REWARD, state: 'ready', roundId: 5, code: 'K7M2QX9D', url: ISSUED.url, reach: 'lan', visibleUntil: 2_000, ...over });
  const at = { roundId: 5, demo: false, phone: false, now: 1_000 };

  it('a ready code of this round on a kiosk screen is a scannable QR until its time is up', () => {
    expect(scannableQrOnScreen(ready(), at)).toBe(true);
    expect(scannableQrOnScreen(ready({ visibleUntil: 0 }), at)).toBe(true); // card not shown yet
    expect(scannableQrOnScreen(ready(), { ...at, now: 2_000 })).toBe(false);
    expect(scannableQrOnScreen(ready({ state: 'demoBuild', reach: null }), at)).toBe(true);
  });

  it('never for another round, a demo round, a lost round, while issuing or after a failure', () => {
    expect(scannableQrOnScreen(ready(), { ...at, roundId: 6 })).toBe(false);
    expect(scannableQrOnScreen(ready(), { ...at, demo: true })).toBe(false);
    expect(scannableQrOnScreen(ready(), { ...at, outcome: 'slipped' })).toBe(false);
    expect(scannableQrOnScreen(ready(), { ...at, outcome: 'won' })).toBe(true);
    expect(scannableQrOnScreen(ready({ state: 'issuing', code: null, url: null }), at)).toBe(false);
    expect(scannableQrOnScreen(ready({ state: 'unavailable', code: null, url: null }), at)).toBe(false);
  });

  it('not on a phone (the card shows a claim link) and not for a loopback-only link (no QR is drawn)', () => {
    expect(scannableQrOnScreen(ready(), { ...at, phone: true })).toBe(false);
    expect(localOnly(ready({ reach: 'loopback' }))).toBe(true);
    expect(localOnly(ready({ reach: 'lan' }))).toBe(false);
    expect(localOnly(ready({ state: 'issuing', reach: 'loopback' }))).toBe(false);
    expect(scannableQrOnScreen(ready({ reach: 'loopback' }), at)).toBe(false);
    expect(scannableQrOnScreen(ready({ reach: 'external' }), at)).toBe(true);
  });
});

describe('display text as the server accepts it', () => {
  it('controls and bidi overrides become spaces, runs collapse, the result is trimmed and cut safely', () => {
    expect(cleanDisplayText('20% off\tall swag', 80)).toBe('20% off all swag');
    expect(cleanDisplayText('‮20% off⁩ ', 80)).toBe('20% off');
    expect(cleanDisplayText('a\u0085b c', 80)).toBe('a b c');
    expect(cleanDisplayText('   ', 80)).toBe('');
    // A cut never leaves half of a surrogate pair (an emoji) behind.
    expect(cleanDisplayText('abcd\u{1F381}', 5)).toBe('abcd');
    expect(cleanDisplayText('ab \u{1F381}', 4)).toBe('ab');
    expect(UNSAFE_TEXT_CHARS.test('fine text 20%')).toBe(false);
  });
});
