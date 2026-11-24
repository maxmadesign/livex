/**
 * Prize claim codes without HTTP: code format and uniqueness, the store (atomic file, restart,
 * corrupt file, write failures), the service rules (dedupe, choose once, redeem, expiry), the
 * claim base selection and the configuration.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../server/config';
import { createLogger } from '../../../server/log';
import {
  RewardFailure,
  allowedChoices,
  createFileRewardStorage,
  createMemoryRewardStorage,
  createRewardsService,
  firstLanIPv4,
  generateCode,
  initialClaimTarget,
  parseIssueRequest,
  selectClaimBase,
  uniqueCode,
  type RewardStorage,
} from '../../../server/rewards';
import { BRAND_KITS } from '../../../src/brand/kits';
import { CODE_ALPHABET, REWARD_LIMITS, type IssueRequestBody } from '../../../src/rewards/protocol';

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plush-rewards-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${REWARD_LIMITS.codeLength}}$`);

export const issueBody = (overrides: Partial<IssueRequestBody> = {}): IssueRequestBody => ({
  session: 'k3x9q2ab',
  roundId: 4,
  prizeId: 'k3x9q2ab-4',
  prizeName: 'Neon Byte',
  tier: 'legendary',
  themeId: 'gpu',
  lang: 'en',
  options: 'both',
  claimUrl: '',
  discountText: '20% off all swag',
  swagUrl: '',
  ...overrides,
});

function service(options: { storage?: RewardStorage; enabled?: boolean; ttlHours?: number; random?: (n: number) => Uint8Array } = {}) {
  const clock = { now: T0 };
  const logs: string[] = [];
  const storage = options.storage ?? createMemoryRewardStorage();
  const rewards = createRewardsService({
    enabled: options.enabled ?? true,
    ttlHours: options.ttlHours ?? 24,
    storage,
    brand: BRAND_KITS.gtc,
    claimTarget: { base: 'http://192.168.1.5:8788/', reach: 'lan' },
    now: () => clock.now,
    random: options.random,
    logger: createLogger('debug', [], (line) => logs.push(line)),
  });
  return { rewards, clock, storage, logs };
}

const failure = (fn: () => unknown): RewardFailure => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RewardFailure) return error;
    throw error;
  }
  throw new Error('expected a RewardFailure');
};

/* --------------------------------------------------------------- codes */

describe('claim codes', () => {
  it('are REWARD_LIMITS.codeLength characters of the Crockford alphabet, from the CSPRNG', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const code = generateCode();
      expect(code).toMatch(CODE_RE);
      seen.add(code);
      for (const ch of code) chars.add(ch);
    }
    expect(seen.size).toBe(3000);
    // Every symbol shows up (no modulo bias would starve the tail of the alphabet).
    expect(chars.size).toBe(CODE_ALPHABET.length);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('maps random bytes to symbols with five bits each', () => {
    expect(generateCode(() => Uint8Array.from([0, 1, 31, 32, 255, 10, 17, 30]))).toBe('01Z0ZAHY');
  });

  it('draws again on a collision and gives up on a broken random source', () => {
    const taken = new Set(['00000000']);
    let calls = 0;
    const scripted = (size: number) => {
      calls++;
      return new Uint8Array(size).fill(calls < 3 ? 0 : 1);
    };
    expect(uniqueCode((code) => taken.has(code), scripted)).toBe('11111111');
    expect(calls).toBe(3);
    expect(uniqueCode(() => true, scripted, 4)).toBeNull();
  });
});

/* -------------------------------------------------------- validation */

describe('issue request validation', () => {
  it('accepts a complete body and trims display text', () => {
    const parsed = parseIssueRequest({ ...issueBody(), prizeName: '  Neon Byte  ', swagUrl: 'https://shop.example/swag', claimUrl: 'https://claim.example/c/{code}' });
    expect(parsed).toMatchObject({ ok: true, request: { prizeName: 'Neon Byte', swagUrl: 'https://shop.example/swag' } });
  });

  it('refuses unknown fields, wrong enums, long or control-laden text and unsafe URLs without echoing them', () => {
    const bad: [string, unknown][] = [
      ['extra field', { ...issueBody(), email: 'someone@example.com' }],
      ['missing field', (({ session, ...rest }) => rest)(issueBody())],
      ['tier', issueBody({ tier: 'mythic' as never })],
      ['theme', issueBody({ themeId: 'nvidia' as never })],
      ['lang', issueBody({ lang: 'de' as never })],
      ['options', issueBody({ options: 'all' as never })],
      ['long name', issueBody({ prizeName: 'x'.repeat(REWARD_LIMITS.maxPrizeNameChars + 1) })],
      ['empty name', issueBody({ prizeName: '   ' })],
      ['control char', issueBody({ prizeName: 'Neon\u0007Byte' })],
      ['line separator', issueBody({ discountText: 'a\u2028b' })],
      ['bidi override', issueBody({ prizeName: 'abc\u202edcba' })],
      ['long discount', issueBody({ discountText: 'x'.repeat(REWARD_LIMITS.maxDiscountTextChars + 1) })],
      ['javascript url', issueBody({ swagUrl: 'javascript:alert(1)' })],
      ['data url', issueBody({ claimUrl: 'data:text/html,hi' })],
      ['ftp url', issueBody({ swagUrl: 'ftp://files.example/' })],
      ['credentials', issueBody({ claimUrl: 'https://user:pw@claim.example/{code}' })],
      ['long url', issueBody({ swagUrl: `https://shop.example/${'a'.repeat(REWARD_LIMITS.maxUrlChars)}` })],
      ['session chars', issueBody({ session: 'has space' })],
      ['long session', issueBody({ session: 'a'.repeat(REWARD_LIMITS.maxSessionChars + 1) })],
      ['fraction round', issueBody({ roundId: 1.5 })],
      ['negative round', issueBody({ roundId: -1 })],
      ['string round', { ...issueBody(), roundId: '4' }],
      ['not an object', ['nope']],
      ['null', null],
    ];
    for (const [label, body] of bad) {
      const parsed = parseIssueRequest(body);
      expect(parsed.ok, label).toBe(false);
      if (!parsed.ok) {
        expect(parsed.message, label).not.toContain('someone@example.com');
        expect(parsed.message, label).not.toContain('javascript');
      }
    }
  });
});

/* ------------------------------------------------------------ service */

describe('rewards service', () => {
  it('issues a code with the claim URL, the TTL and the options', () => {
    const { rewards } = service();
    const issued = rewards.issue(issueBody());
    expect(issued.code).toMatch(CODE_RE);
    expect(issued).toMatchObject({
      url: `http://192.168.1.5:8788/c/${issued.code}`,
      reach: 'lan',
      issuedAt: '2026-11-24T10:00:00.000Z',
      expiresAt: '2026-11-25T10:00:00.000Z',
      options: 'both',
      repeated: false,
    });
    expect(rewards.find(issued.code)).toMatchObject({ prizeName: 'Neon Byte', choice: null, chosenAt: null, redeemedAt: null });
  });

  it('returns the same code for the same session + round, a new one otherwise', () => {
    const { rewards } = service();
    const first = rewards.issue(issueBody());
    const again = rewards.issue(issueBody({ prizeName: 'Something else' }));
    expect(again).toMatchObject({ code: first.code, repeated: true });
    expect(rewards.find(first.code)?.prizeName).toBe('Neon Byte');
    const nextRound = rewards.issue(issueBody({ roundId: 5, prizeId: 'k3x9q2ab-5' }));
    const otherSession = rewards.issue(issueBody({ session: 'zz99yy88' }));
    expect(new Set([first.code, nextRound.code, otherSession.code]).size).toBe(3);
    expect(rewards.counts().issued).toBe(3);
  });

  it('points the QR at a kiosk URL template when one is given, and still tracks the code', () => {
    const { rewards } = service();
    const issued = rewards.issue(issueBody({ claimUrl: 'https://claim.example/booth?c={code}&x=1' }));
    expect(issued).toMatchObject({ url: `https://claim.example/booth?c=${issued.code}&x=1`, reach: 'external' });
    const plain = rewards.issue(issueBody({ roundId: 9, claimUrl: 'https://claim.example/redeem' }));
    expect(plain.url).toBe(`https://claim.example/redeem?code=${plain.code}`);
    expect(rewards.find(issued.code)).not.toBeNull();
  });

  it('refuses to issue when switched off', () => {
    const { rewards } = service({ enabled: false });
    expect(failure(() => rewards.issue(issueBody()))).toMatchObject({ status: 503, code: 'rewards_off' });
    expect(rewards.status(true)).toMatchObject({ enabled: false, canIssue: true, claimBase: 'http://192.168.1.5:8788', reach: 'lan', ttlHours: 24 });
  });

  it('issues nothing when the store can not be written, and recovers once it can', () => {
    const storage = createMemoryRewardStorage();
    const { rewards, logs } = service({ storage });
    storage.failWrites = true;
    expect(failure(() => rewards.issue(issueBody()))).toMatchObject({ status: 500, code: 'storage' });
    expect(rewards.counts().issued).toBe(0);
    expect(storage.text).toBeNull();
    expect(logs.join('\n')).toContain('reward code could not be stored');
    storage.failWrites = false;
    // The failed round is not remembered: the retry gets a fresh, stored code.
    const retry = rewards.issue(issueBody());
    expect(retry.repeated).toBe(false);
    expect(JSON.parse(storage.text!).records).toHaveLength(1);
  });

  it('records one choice, refuses a different one and options the code does not have', () => {
    const { rewards, clock } = service();
    const { code } = rewards.issue(issueBody());
    clock.now += 60_000;
    expect(rewards.choose(code, 'prize')).toMatchObject({ changed: true, record: { choice: 'prize', chosenAt: '2026-11-24T10:01:00.000Z' } });
    expect(rewards.choose(code, 'prize').changed).toBe(false);
    expect(failure(() => rewards.choose(code, 'swag'))).toMatchObject({ status: 409, code: 'already_chosen' });
    expect(rewards.find(code)?.choice).toBe('prize');

    const swagOnly = rewards.issue(issueBody({ roundId: 7, options: 'swag' }));
    expect(failure(() => rewards.choose(swagOnly.code, 'prize'))).toMatchObject({ status: 400, code: 'bad_request' });
    expect(rewards.choose(swagOnly.code, 'swag').changed).toBe(true);
    expect(failure(() => rewards.choose('ZZZZZZZZ', 'prize'))).toMatchObject({ status: 404, code: 'not_found' });
    expect(allowedChoices('both')).toEqual(['prize', 'swag']);
  });

  it('redeems once, only after a choice and before expiry', () => {
    const { rewards, clock } = service();
    const { code } = rewards.issue(issueBody());
    expect(failure(() => rewards.redeem(code))).toMatchObject({ status: 409, code: 'bad_request' });
    rewards.choose(code, 'swag');
    expect(rewards.redeem(code).redeemedAt).toBe('2026-11-24T10:00:00.000Z');
    expect(failure(() => rewards.redeem(code))).toMatchObject({ status: 409, code: 'already_redeemed' });
    expect(failure(() => rewards.choose(code, 'swag'))).toMatchObject({ status: 409, code: 'already_redeemed' });
    expect(rewards.stateOf(rewards.find(code)!)).toBe('redeemed');
    // Redeemed codes stay redeemed after their expiry time.
    clock.now += 25 * 3_600_000;
    expect(rewards.stateOf(rewards.find(code)!)).toBe('redeemed');
  });

  it('expires codes after the TTL', () => {
    const { rewards, clock } = service({ ttlHours: 2 });
    const open = rewards.issue(issueBody());
    const chosen = rewards.issue(issueBody({ roundId: 8 }));
    rewards.choose(chosen.code, 'prize');
    clock.now += 2 * 3_600_000 - 1;
    expect(rewards.stateOf(rewards.find(open.code)!)).toBe('open');
    clock.now += 1;
    expect(rewards.stateOf(rewards.find(open.code)!)).toBe('expired');
    expect(failure(() => rewards.choose(open.code, 'prize'))).toMatchObject({ status: 410, code: 'expired' });
    expect(failure(() => rewards.redeem(chosen.code))).toMatchObject({ status: 410, code: 'expired' });
    expect(rewards.counts()).toEqual({ issued: 2, chosen: 1, redeemed: 0, expired: 2 });
  });

  it('lists newest first and finds codes by prefix the way staff type them', () => {
    const { rewards, clock } = service();
    const codes: string[] = [];
    for (let round = 1; round <= 5; round++) {
      clock.now += 1000;
      codes.push(rewards.issue(issueBody({ roundId: round })).code);
    }
    expect(rewards.list().map((record) => record.code)).toEqual([...codes].reverse());
    expect(rewards.list({ limit: 2 })).toHaveLength(2);
    const target = codes[2]!;
    const typed = `${target.slice(0, 4).toLowerCase()}-${target.slice(4, 6)}`.replace(/0/g, 'o').replace(/1/g, 'l');
    expect(rewards.list({ query: typed }).map((record) => record.code)).toContain(target);
  });

  it('logs codes at debug level only, and never prize names or sessions', () => {
    const { rewards, logs } = service();
    const { code } = rewards.issue(issueBody({ prizeName: 'Secretive Sloth', session: 'sess-ABCDEF' }));
    rewards.choose(code, 'prize');
    rewards.redeem(code);
    const info = logs.filter((line) => !line.includes(' debug '));
    expect(info.length).toBeGreaterThan(0);
    expect(info.join('\n')).not.toContain(code);
    expect(logs.join('\n')).not.toContain('Secretive Sloth');
    expect(logs.join('\n')).not.toContain('sess-ABCDEF');
    expect(logs.filter((line) => line.includes(code)).every((line) => line.includes(' debug '))).toBe(true);
  });
});

/* -------------------------------------------------------------- store */

describe('rewards file', () => {
  it('survives a restart: records, choices and the dedupe index come back', () => {
    const dir = path.join(tempDir(), 'data');
    const first = service({ storage: createFileRewardStorage(dir) });
    const issued = first.rewards.issue(issueBody());
    first.rewards.choose(issued.code, 'prize');
    const second = first.rewards.issue(issueBody({ roundId: 11 }));

    const file = path.join(dir, 'rewards.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual(['rewards.json']); // no temp files left behind
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data).toMatchObject({ version: 1 });
    expect(data.records).toHaveLength(2);

    const restarted = service({ storage: createFileRewardStorage(dir) });
    expect(restarted.rewards.loadReport).toEqual({ loaded: 2, skipped: 0, error: null });
    expect(restarted.rewards.find(issued.code)).toMatchObject({ choice: 'prize', prizeName: 'Neon Byte' });
    expect(restarted.rewards.issue(issueBody())).toMatchObject({ code: issued.code, repeated: true });
    expect(restarted.rewards.list().map((record) => record.code)).toEqual([second.code, issued.code]);
  });

  it('moves a corrupt file aside instead of overwriting it, and skips malformed records', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'rewards.json'), '{ not json');
    const broken = service({ storage: createFileRewardStorage(dir) });
    expect(broken.rewards.loadReport.error).toMatch(/moved aside/);
    expect(readdirSync(dir).some((name) => name.startsWith('rewards.json.corrupt-'))).toBe(true);
    expect(broken.rewards.issue(issueBody()).repeated).toBe(false);

    const good = JSON.parse(readFileSync(path.join(dir, 'rewards.json'), 'utf8')).records[0];
    const old = { ...good, code: 'ABCDEFGH', session: 'old', expiresAt: '2026-09-01T00:00:00.000Z' };
    writeFileSync(path.join(dir, 'rewards.json'), JSON.stringify({ version: 1, records: [good, { ...good, code: 'lower!!!' }, { nope: true }, old] }));
    const reloaded = service({ storage: createFileRewardStorage(dir) });
    expect(reloaded.rewards.loadReport).toEqual({ loaded: 1, skipped: 3, error: null });
  });

  it('refuses to issue (storage error) when the data folder can not be written', () => {
    const parent = tempDir();
    const notADir = path.join(parent, 'blocked');
    writeFileSync(notADir, 'a file where the data folder should be');
    const { rewards } = service({ storage: createFileRewardStorage(notADir) });
    expect(failure(() => rewards.issue(issueBody()))).toMatchObject({ status: 500, code: 'storage' });
    expect(rewards.counts().issued).toBe(0);
    expect(existsSync(path.join(notADir, 'rewards.json'))).toBe(false);
  });

  it('keeps an unreadable file untouched and issues nothing', () => {
    const storage: RewardStorage = {
      location: '(broken)',
      read: () => {
        throw new Error('EACCES');
      },
      write: () => {
        throw new Error('must not be written');
      },
    };
    const { rewards } = service({ storage });
    expect(rewards.loadReport.error).toMatch(/could not be read/);
    expect(failure(() => rewards.issue(issueBody()))).toMatchObject({ code: 'storage' });
  });
});

/* --------------------------------------------------------- claim base */

describe('claim base selection', () => {
  it('prefers an external URL, then the LAN listener, then loopback', () => {
    expect(selectClaimBase({ publicUrl: 'https://claim.example/booth/', listenerPort: 8788, lanAddress: '192.168.1.20', mainPort: 8787 })).toEqual({
      base: 'https://claim.example/booth',
      reach: 'external',
    });
    expect(selectClaimBase({ publicUrl: null, listenerPort: 8788, lanAddress: '192.168.1.20', mainPort: 8787 })).toEqual({ base: 'http://192.168.1.20:8788', reach: 'lan' });
    expect(selectClaimBase({ publicUrl: null, listenerPort: 40123, lanAddress: null, mainPort: 8787 })).toEqual({ base: 'http://127.0.0.1:40123', reach: 'loopback' });
    expect(selectClaimBase({ publicUrl: null, listenerPort: null, lanAddress: '192.168.1.20', mainPort: 8787 })).toEqual({ base: 'http://127.0.0.1:8787', reach: 'loopback' });
  });

  it('takes the first non-internal, non-link-local IPv4 address', () => {
    const info = (address: string, family: string | number, internal = false) => ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never;
    expect(
      firstLanIPv4({
        lo: [info('127.0.0.1', 'IPv4', true)],
        eth0: [info('fe80::1', 'IPv6'), info('169.254.10.2', 'IPv4')],
        wlan0: [info('10.20.30.40', 4), info('192.168.1.9', 'IPv4')],
      }),
    ).toBe('10.20.30.40');
    expect(firstLanIPv4({ lo: [info('127.0.0.1', 'IPv4', true)] })).toBeNull();
  });
});

/* -------------------------------------------------------------- config */

describe('rewards configuration', () => {
  it('defaults: on, claim listener on 8788 for the LAN, 24 h, GTC kit, no warnings', () => {
    const config = loadConfig({});
    expect(config.brand).toBe('gtc');
    expect(config.rewards).toMatchObject({ enabled: true, claimPort: 8788, claimHost: '0.0.0.0', claimLan: true, publicUrl: null, ttlHours: 24 });
    expect(config.rewards.assetDirs[0]).toBe(config.distDir);
    expect(config.rewards.assetDirs[1]).toMatch(/public$/);
    expect(config.warnings).toEqual([]);
    expect(initialClaimTarget(config)).toEqual({ base: 'http://127.0.0.1:8787', reach: 'loopback' });
  });

  it('reads the switches, clamps numbers and validates the public URL', () => {
    const config = loadConfig({
      PLUSH_REWARDS: 'off',
      PLUSH_CLAIM_PORT: '0',
      PLUSH_CLAIM_LAN: 'false',
      PLUSH_CLAIM_PUBLIC_URL: 'https://claim.example/booth/',
      PLUSH_REWARD_TTL_HOURS: '100000',
      PLUSH_BRAND: 'Neutral',
    });
    expect(config.brand).toBe('neutral');
    expect(config.rewards).toMatchObject({ enabled: false, claimPort: 0, claimLan: false, publicUrl: 'https://claim.example/booth', ttlHours: 720 });
    expect(initialClaimTarget(config)).toEqual({ base: 'https://claim.example/booth', reach: 'external' });
    expect(loadConfig({ PLUSH_BRAND: 'acme' }).brand).toBe('gtc');
    expect(loadConfig({ PLUSH_REWARD_TTL_HOURS: '0' }).rewards.ttlHours).toBe(1);
    for (const bad of ['javascript:alert(1)', 'https://claim.example/?a=1', 'https://claim.example/#x', 'https://u:p@claim.example', 'https://claim.example/{code}', 'not a url']) {
      const result = loadConfig({ PLUSH_CLAIM_PUBLIC_URL: bad });
      expect(result.rewards.publicUrl, bad).toBeNull();
      expect(result.warnings.join(' '), bad).toMatch(/PLUSH_CLAIM_PUBLIC_URL/);
    }
  });
});
