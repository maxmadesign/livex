import { describe, expect, it, vi } from 'vitest';
import { ISSUE_TIMEOUT_MS, createRewardClient, failureFromResponse, randomSessionId, validIssueResponse, type IssueInput } from '../../../src/rewards/client';
import { CODE_ALPHABET, REWARD_LIMITS, type IssueResponseBody } from '../../../src/rewards/protocol';

const INPUT: IssueInput = {
  roundId: 3,
  prizeId: 'gpu_keynote_chief',
  prizeName: 'Keynote Chief',
  tier: 'legendary',
  themeId: 'gpu',
  lang: 'en',
  options: 'both',
  claimUrl: '',
  discountText: '',
  swagUrl: '',
};

const OK_BODY: IssueResponseBody = {
  code: 'K7M2QX9D',
  url: 'http://192.168.1.20:8788/c/K7M2QX9D',
  reach: 'lan',
  issuedAt: '2026-11-24T20:00:00.000Z',
  expiresAt: '2026-11-26T20:00:00.000Z',
  options: 'both',
  repeated: false,
};

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('reward client: issue', () => {
  it('posts one request with the session id and returns the code', async () => {
    const fetchImpl = vi.fn(async () => json(200, OK_BODY));
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch, session: 'SESSIONAAAA' });
    const result = await client.issue(INPUT);
    expect(result).toEqual({ ok: true, body: OK_BODY });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rewards/issue');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({ ...INPUT, session: 'SESSIONAAAA' });
  });

  it('asks at most once per round: a second call returns the first answer without a request', async () => {
    const fetchImpl = vi.fn(async () => json(200, OK_BODY));
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const a = client.issue(INPUT);
    const b = client.issue({ ...INPUT, prizeName: 'changed' });
    expect(b).toBe(a);
    await a;
    await client.issue(INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Another round is another request.
    await client.issue({ ...INPUT, roundId: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped request once, then never again for the same round', async () => {
    // The server keys codes on session + round id, so the single retry can only get the same code.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.issue(INPUT)).toEqual({ ok: false, reason: 'offline' });
    expect(await client.issue(INPUT)).toEqual({ ok: false, reason: 'offline' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a retry after a timeout returns the code the server already stored', async () => {
    const answer = { code: 'ABCD2345', url: 'http://192.0.2.2:8788/c/ABCD2345', reach: 'lan', issuedAt: new Date(0).toISOString(), expiresAt: new Date(3_600_000).toISOString(), options: 'both', repeated: true };
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new DOMException('aborted', 'AbortError');
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.issue(INPUT);
    expect(result.ok).toBe(true);
    expect(result.ok && result.body.code).toBe('ABCD2345');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].body);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('gives up after the timeout and reports offline', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const pending = client.issue(INPUT);
      // The first attempt times out, the single retry times out too.
      await vi.advanceTimersByTimeAsync(2 * ISSUE_TIMEOUT_MS - 100);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toEqual({ ok: false, reason: 'offline' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cuts the prize name and discount text to the protocol limits', async () => {
    const fetchImpl = vi.fn(async () => json(200, OK_BODY));
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.issue({ ...INPUT, prizeName: 'x'.repeat(200), discountText: 'y'.repeat(200) });
    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.prizeName).toHaveLength(REWARD_LIMITS.maxPrizeNameChars);
    expect(sent.discountText).toHaveLength(REWARD_LIMITS.maxDiscountTextChars);
  });
});

describe('reward client: failures map to what the card can say', () => {
  const cases: [string, number, unknown, string][] = [
    ['server switched off', 503, { error: { code: 'rewards_off', message: 'off' } }, 'rewards_off'],
    ['not the kiosk', 403, { error: { code: 'forbidden', message: 'no' } }, 'forbidden'],
    ['401 without a body', 401, null, 'forbidden'],
    ['rate limit', 429, { error: { code: 'rate_limited', message: 'slow down' } }, 'rate_limited'],
    ['429 without a body', 429, null, 'rate_limited'],
    ['could not store the code', 500, { error: { code: 'storage', message: 'disk' } }, 'storage'],
    ['internal error', 500, { error: { code: 'internal', message: 'boom' } }, 'error'],
    ['bad request', 400, { error: { code: 'bad_request', message: 'bad' } }, 'error'],
    ['server without the rewards routes', 404, null, 'offline'],
    ['proxy could not reach the API', 502, null, 'offline'],
  ];
  for (const [label, status, body, reason] of cases) {
    it(`${label} → ${reason}`, async () => {
      expect(failureFromResponse(status, body)).toBe(reason);
      const client = createRewardClient({ fetchImpl: (async () => json(status, body ?? undefined)) as unknown as typeof fetch });
      expect(await client.issue(INPUT)).toEqual({ ok: false, reason });
    });
  }

  it('an answer that is not a usable code is an error, never a QR', async () => {
    for (const body of [
      { ...OK_BODY, code: 'SHORT' },
      { ...OK_BODY, code: 'ILOU1234' },
      { ...OK_BODY, url: 'javascript:alert(1)' },
      { ...OK_BODY, url: 'https://user:pass@example.com/c/X' },
      { ...OK_BODY, reach: 'moon' },
      { ...OK_BODY, options: 'everything' },
      '<html>index</html>',
      null,
    ]) {
      expect(validIssueResponse(body), JSON.stringify(body)).toBe(false);
      const client = createRewardClient({ fetchImpl: (async () => json(200, body)) as unknown as typeof fetch });
      expect(await client.issue(INPUT)).toEqual({ ok: false, reason: 'error' });
    }
    expect(validIssueResponse(OK_BODY)).toBe(true);
  });
});

describe('reward client: status and session', () => {
  it('reads the status', async () => {
    const body = { enabled: true, canIssue: true, claimBase: 'http://192.168.1.20:8788', reach: 'lan', ttlHours: 48 };
    const fetchImpl = vi.fn(async () => json(200, body));
    const client = createRewardClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.status()).toEqual({ ok: true, body });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/rewards/status');
  });

  it('reports an unreachable server', async () => {
    const client = createRewardClient({ fetchImpl: (async () => json(404, undefined)) as unknown as typeof fetch });
    expect(await client.status()).toEqual({ ok: false, reason: 'offline' });
  });

  it('makes a random session id from the claim alphabet, inside the protocol limit', () => {
    const a = randomSessionId();
    const b = randomSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(REWARD_LIMITS.maxSessionChars);
    for (const ch of a) expect(CODE_ALPHABET).toContain(ch);
    // One id per page load: two clients share it.
    expect(createRewardClient().session).toBe(createRewardClient().session);
  });
});
