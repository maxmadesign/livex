/**
 * The kiosk's reward client and flow (src/rewards) against the real server routes and service
 * (server/rewards), in process: what the game sends must pass the server's strict validation, and
 * what the server answers must be accepted by the game. Requests go through the Hono app with a
 * loopback socket, exactly as the kiosk on the booth machine makes them.
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_REWARD, createGameStore } from '../../../src/app/gameStore';
import { createApp } from '../../../server/app';
import { loadConfig } from '../../../server/config';
import { createLogger } from '../../../server/log';
import { createBrandAssets, createMemoryRewardStorage, createRewardsService } from '../../../server/rewards';
import { BRAND_KITS, type BrandKit } from '../../../src/brand/kits';
import type { ThemeId } from '../../../src/core/types';
import { createRewardClient, type RewardClient } from '../../../src/rewards/client';
import { RewardFlow, type RewardWin, type RewardsSettings } from '../../../src/rewards/flow';
import { REWARD_LIMITS, type ClaimReach } from '../../../src/rewards/protocol';
import { defaultSettings } from '../../../src/settings/spec';

const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const kitFor = (theme: ThemeId): BrandKit | null => (BRAND_KITS.gtc.theme === theme ? BRAND_KITS.gtc : null);

function server(target: { base: string; reach: ClaimReach } = { base: 'http://192.168.1.5:8788', reach: 'lan' }) {
  const config = loadConfig({ PLUSH_KEY_MANAGEMENT: 'off' });
  const logger = createLogger('error', [], () => undefined);
  const rewards = createRewardsService({ enabled: true, ttlHours: 24, storage: createMemoryRewardStorage(), brand: BRAND_KITS.gtc, claimTarget: target, now: () => T0, logger });
  const assets = createBrandAssets(rewards.brand, config.rewards.assetDirs, () => T0);
  const app = createApp({ config, client: null, logger, now: () => T0, rewards, brandAssets: assets });
  const bodies: unknown[] = [];
  const statuses: number[] = [];
  // The kiosk's fetch: same origin, from this machine.
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    if (typeof init.body === 'string') bodies.push(JSON.parse(init.body));
    const response = (await app.request(
      input,
      { ...init, headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', ...(init.headers as Record<string, string>) } },
      { incoming: { socket: { remoteAddress: '127.0.0.1', remotePort: 50000, remoteFamily: 'IPv4' } } },
    )) as Response;
    statuses.push(response.status);
    return response;
  }) as unknown as typeof fetch;
  const client = createRewardClient({ fetchImpl, session: 'KIOSKSESSION01' });
  return { rewards, client, bodies, statuses };
}

function flowWith(client: RewardClient, settings: Partial<RewardsSettings> = {}) {
  const ui = createGameStore('desktop', true, 'gpu');
  const cfg: RewardsSettings = { ...defaultSettings().rewards, ...settings };
  const flow = new RewardFlow({ ui, settings: () => cfg, client, demoBuild: false, now: () => T0, kitFor });
  return { ui, flow, reward: () => ui.getState().reward };
}

const win = (over: Partial<RewardWin> = {}): RewardWin => ({ roundId: 7, demo: false, themeId: 'gpu', prizeId: 'gpu_keynote_chief', prizeName: 'Keynote Chief', tier: 'legendary', lang: 'en', ...over });

/** Lets the in-process request and the flow's promise chain finish. */
const drain = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('kiosk client ↔ real server', () => {
  it('a win gets a server code with the claim listener link; exit + result ask once, the server stores one code', async () => {
    const s = server();
    const t = flowWith(s.client);
    t.flow.onWin(win());
    t.flow.onWin(win()); // the result after the exit event
    await drain();
    expect(t.reward()).toMatchObject({ state: 'ready', roundId: 7, reach: 'lan', reason: null });
    expect(t.reward().url).toBe(`http://192.168.1.5:8788/c/${t.reward().code}`);
    expect(s.bodies).toHaveLength(1);
    expect(s.rewards.counts().issued).toBe(1);
  });

  it('the longest claim link template the settings allow still gives a usable answer', async () => {
    const s = server();
    const base = 'https://claim.example.com/c/{code}?event=gtc&ref=';
    const template = base + 'x'.repeat(REWARD_LIMITS.maxUrlChars - base.length);
    expect(template).toHaveLength(REWARD_LIMITS.maxUrlChars);
    const t = flowWith(s.client, { claimUrl: template });
    t.flow.onWin(win());
    await drain();
    expect(s.statuses).toEqual([200]);
    // The server issued and stored a code: the kiosk must show it, not "unavailable".
    expect(s.rewards.counts().issued).toBe(1);
    expect(t.reward()).toMatchObject({ state: 'ready', reach: 'external', reason: null });
    expect(t.reward().url).toBe(template.replace('{code}', t.reward().code!));
    // A template without {code} gets ?code= appended (also beyond 300 characters).
    const plain = 'https://claim.example.com/' + 'p'.repeat(REWARD_LIMITS.maxUrlChars - 26);
    const s2 = server();
    const t2 = flowWith(s2.client, { claimUrl: plain });
    t2.flow.onWin(win());
    await drain();
    expect(t2.reward()).toMatchObject({ state: 'ready', reach: 'external' });
    expect(t2.reward().url).toBe(`${plain}?code=${t2.reward().code}`);
  });

  it('owner text pasted with a tab, a line break or a bidi control does not make every claim fail', async () => {
    for (const discountText of ['20% off\tall swag', '20% off\nall swag', '‮20% off all swag', '20% off all swag⁩']) {
      const s = server();
      const t = flowWith(s.client, { discountText });
      t.flow.onWin(win());
      await drain();
      expect(s.statuses, JSON.stringify(discountText)).toEqual([200]);
      expect(t.reward().state).toBe('ready');
      const sent = s.bodies[0] as { discountText: string };
      expect(sent.discountText).toBe('20% off all swag');
      // What the claim page will show is the cleaned wording.
      expect(s.rewards.find(t.reward().code!)!.discountText).toBe('20% off all swag');
    }
  });

  it('a plush name with control characters is cleaned, an empty one falls back to its id', async () => {
    const s = server();
    const t = flowWith(s.client);
    t.flow.onWin(win({ prizeName: 'Keynote\u0007 Chief' }));
    t.flow.onWin(win({ roundId: 8, prizeName: '   ' }));
    await drain();
    expect(s.statuses).toEqual([200, 200]);
    expect((s.bodies[0] as { prizeName: string }).prizeName).toBe('Keynote Chief');
    expect((s.bodies[1] as { prizeName: string }).prizeName).toBe('gpu_keynote_chief');
  });

  it('claim and swag links with surrounding spaces are sent trimmed: the QR holds a clean URL', async () => {
    const s = server();
    const t = flowWith(s.client, { claimUrl: '  https://claim.example.com/c/{code} ', swagUrl: ' https://shop.example.com/gtc  ' });
    t.flow.onWin(win());
    await drain();
    const code = t.reward().code!;
    expect(t.reward().url).toBe(`https://claim.example.com/c/${code}`);
    expect(s.bodies[0]).toMatchObject({ claimUrl: 'https://claim.example.com/c/{code}', swagUrl: 'https://shop.example.com/gtc' });
    expect(s.rewards.find(code)!.swagUrl).toBe('https://shop.example.com/gtc');
  });

  it('an answer that arrives after PLAY AGAIN never reaches the next round; the next win gets its own code', async () => {
    const s = server();
    const t = flowWith(s.client);
    t.flow.onWin(win({ roundId: 7 }));
    t.flow.reset(); // PLAY AGAIN before the answer
    t.flow.onWin(win({ roundId: 8 }));
    await drain();
    expect(t.reward()).toMatchObject({ state: 'ready', roundId: 8 });
    const first = s.rewards.list().find((r) => r.roundId === 7)!;
    const second = s.rewards.list().find((r) => r.roundId === 8)!;
    expect(t.reward().code).toBe(second.code);
    expect(first.code).not.toBe(second.code);
    // A late result event of round 7 shows nothing: its card is gone.
    expect(t.reward().roundId).toBe(8);
    t.flow.reset();
    expect(t.reward()).toBe(INITIAL_REWARD);
  });
});
