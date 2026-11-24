/**
 * The prize-claim service: issues codes for real wins, records the visitor's single choice and
 * the staff's redemption. HTTP-free, so the API routes, the claim pages and the LAN listener share
 * one instance (and one in-memory index) per process.
 */
import type { BrandKit } from '../../src/brand/kits';
import {
  fillClaimTemplate,
  type ClaimReach,
  type ClaimRecord,
  type IssueResponseBody,
  type RewardChoice,
  type RewardErrorBody,
  type RewardErrorCode,
  type RewardsStatusBody,
} from '../../src/rewards/protocol';
import type { Logger } from '../log';
import { uniqueCode, type RandomBytes } from './codes';
import { MAX_RECORDS, RewardStore, StorageError, type LoadReport, type RewardStorage } from './store';
import type { IssueRequest } from './validate';

/** A failure with a RewardErrorCode; the routes turn it into JSON or a friendly page. */
export class RewardFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: RewardErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'RewardFailure';
  }

  body(): RewardErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Where the built-in claim page is reached (what the QR code points to without a kiosk template). */
export interface ClaimTarget {
  /** No trailing slash. */
  base: string;
  reach: ClaimReach;
}

/** open = no choice yet; chosen = waiting at the booth / swag counter; redeemed; expired (never redeemed in time). */
export type RewardState = 'open' | 'chosen' | 'redeemed' | 'expired';

export interface RewardCounts {
  issued: number;
  /** Codes with a choice (redeemed ones included). */
  chosen: number;
  redeemed: number;
  /** Not redeemed before they expired. */
  expired: number;
}

export interface RewardsServiceOptions {
  enabled: boolean;
  ttlHours: number;
  storage: RewardStorage;
  brand: BrandKit;
  claimTarget: ClaimTarget;
  now?: () => number;
  random?: RandomBytes;
  logger?: Logger;
}

export interface RewardsService {
  readonly enabled: boolean;
  readonly ttlHours: number;
  readonly brand: BrandKit;
  readonly location: string;
  readonly loadReport: LoadReport;
  /** True when new codes are refused because the store holds MAX_RECORDS (shown on the staff page). */
  storeFull(): boolean;
  now(): number;
  claimTarget(): ClaimTarget;
  setClaimTarget(target: ClaimTarget): void;
  status(canIssue: boolean): RewardsStatusBody;
  issue(request: IssueRequest): IssueResponseBody;
  find(code: string): ClaimRecord | null;
  stateOf(record: ClaimRecord): RewardState;
  /** Records the visitor's pick once. Picking the same option again is a no-op (`changed` false). */
  choose(code: string, choice: RewardChoice): { record: ClaimRecord; changed: boolean };
  redeem(code: string): ClaimRecord;
  counts(): RewardCounts;
  /** Newest first; `query` matches the start of a code (dashes / case ignored). */
  list(options?: { query?: string; limit?: number }): ClaimRecord[];
}

export const allowedChoices = (options: ClaimRecord['options']): RewardChoice[] =>
  options === 'both' ? ['prize', 'swag'] : [options];

export function createRewardsService(options: RewardsServiceOptions): RewardsService {
  const now = options.now ?? (() => Date.now());
  const store = new RewardStore(options.storage, now);
  const loadReport = store.load();
  const ttlMs = options.ttlHours * 3_600_000;
  let target: ClaimTarget = { ...options.claimTarget, base: options.claimTarget.base.replace(/\/+$/, '') };
  const logger = options.logger;

  const stateOf = (record: ClaimRecord): RewardState => {
    if (record.redeemedAt) return 'redeemed';
    if (now() >= Date.parse(record.expiresAt)) return 'expired';
    return record.choice ? 'chosen' : 'open';
  };

  const urlFor = (record: ClaimRecord, template: string): { url: string; reach: ClaimReach } =>
    template ? { url: fillClaimTemplate(template, record.code), reach: 'external' } : { url: `${target.base}/c/${record.code}`, reach: target.reach };

  const respond = (record: ClaimRecord, template: string, repeated: boolean): IssueResponseBody => {
    const { url, reach } = urlFor(record, template);
    return { code: record.code, url, reach, issuedAt: record.issuedAt, expiresAt: record.expiresAt, options: record.options, repeated };
  };

  const requireRecord = (code: string): ClaimRecord => {
    const record = store.get(code);
    if (!record) throw new RewardFailure(404, 'not_found', 'This code does not exist.');
    return record;
  };

  const save = (record: ClaimRecord): void => {
    try {
      store.replace(record);
    } catch (error) {
      if (error instanceof StorageError) throw new RewardFailure(500, 'storage', 'The change could not be saved on the server.');
      throw error;
    }
  };

  return {
    enabled: options.enabled,
    ttlHours: options.ttlHours,
    brand: options.brand,
    location: store.location,
    loadReport,
    storeFull: () => store.full(),
    now,
    claimTarget: () => target,
    setClaimTarget(next) {
      target = { ...next, base: next.base.replace(/\/+$/, '') };
    },
    status: (canIssue) => ({ enabled: options.enabled, canIssue, claimBase: target.base, reach: target.reach, ttlHours: options.ttlHours }),

    issue(request) {
      if (!options.enabled) throw new RewardFailure(503, 'rewards_off', 'Prize codes are switched off on this server.');
      const existing = store.findRound(request.session, request.roundId);
      if (existing) return respond(existing, request.claimUrl, true);
      const code = uniqueCode((candidate) => store.has(candidate), options.random);
      if (!code) throw new RewardFailure(500, 'internal', 'No free code could be drawn.');
      const issuedAt = now();
      const record: ClaimRecord = {
        code,
        session: request.session,
        roundId: request.roundId,
        prizeId: request.prizeId,
        prizeName: request.prizeName,
        tier: request.tier,
        themeId: request.themeId,
        lang: request.lang,
        options: request.options,
        discountText: request.discountText,
        swagUrl: request.swagUrl,
        issuedAt: new Date(issuedAt).toISOString(),
        expiresAt: new Date(issuedAt + ttlMs).toISOString(),
        choice: null,
        chosenAt: null,
        redeemedAt: null,
      };
      try {
        store.insert(record);
      } catch (error) {
        const reason = error instanceof StorageError ? error.reason : 'unknown';
        logger?.error('reward code could not be stored', { store: store.location, reason });
        if (error instanceof StorageError && error.reason === 'full') {
          throw new RewardFailure(500, 'storage', `The prize store is full (${MAX_RECORDS} codes), so none was issued.`);
        }
        if (error instanceof StorageError) throw new RewardFailure(500, 'storage', 'The code could not be saved on the server, so none was issued.');
        throw error;
      }
      const response = respond(record, request.claimUrl, false);
      logger?.info('reward issued', { tier: record.tier, theme: record.themeId, options: record.options, reach: response.reach });
      logger?.debug('reward code', { code });
      return response;
    },

    find: (code) => store.get(code),
    stateOf,

    choose(code, choice) {
      const record = requireRecord(code);
      const state = stateOf(record);
      if (state === 'redeemed') throw new RewardFailure(409, 'already_redeemed', 'This code was already redeemed.');
      if (state === 'expired') throw new RewardFailure(410, 'expired', 'This code has expired.');
      if (record.choice) {
        if (record.choice === choice) return { record, changed: false };
        throw new RewardFailure(409, 'already_chosen', 'A reward was already chosen for this code.');
      }
      if (!allowedChoices(record.options).includes(choice)) throw new RewardFailure(400, 'bad_request', 'This option is not available for this code.');
      const next: ClaimRecord = { ...record, choice, chosenAt: new Date(now()).toISOString() };
      save(next);
      logger?.info('reward chosen', { choice });
      logger?.debug('reward code', { code, event: 'chosen' });
      return { record: next, changed: true };
    },

    redeem(code) {
      const record = requireRecord(code);
      const state = stateOf(record);
      if (state === 'redeemed') throw new RewardFailure(409, 'already_redeemed', 'This code was already redeemed.');
      if (state === 'expired') throw new RewardFailure(410, 'expired', 'This code has expired.');
      if (!record.choice) throw new RewardFailure(409, 'bad_request', 'The visitor has not chosen a reward for this code yet.');
      const next: ClaimRecord = { ...record, redeemedAt: new Date(now()).toISOString() };
      save(next);
      logger?.info('reward redeemed', { choice: next.choice });
      logger?.debug('reward code', { code, event: 'redeemed' });
      return next;
    },

    counts() {
      const counts: RewardCounts = { issued: 0, chosen: 0, redeemed: 0, expired: 0 };
      for (const record of store.all()) {
        counts.issued++;
        if (record.choice) counts.chosen++;
        const state = stateOf(record);
        if (state === 'redeemed') counts.redeemed++;
        else if (state === 'expired') counts.expired++;
      }
      return counts;
    },

    list({ query = '', limit = 50 } = {}) {
      const needle = query.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
      const out: ClaimRecord[] = [];
      for (const record of store.all()) {
        if (needle && !record.code.startsWith(needle)) continue;
        out.push(record);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
