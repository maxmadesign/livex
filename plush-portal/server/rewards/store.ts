/**
 * Issued claim codes. One JSON file (`<PLUSH_DATA_DIR>/rewards.json`, mode 0600) holds every
 * record; it is loaded once at start into an in-memory index and rewritten atomically (temp file +
 * rename) on every change. A change only becomes visible after the file was written, so a failed
 * write leaves the previous state in memory and on disk: nothing half-issued, nothing lost.
 *
 * Records hold codes and prize facts only (see ClaimRecord): no names, contacts or device data.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { LANGS, THEME_IDS } from '../../src/core/types';
import { RARITY_TIERS } from '../../src/game/rarity';
import { CODE_ALPHABET, REWARD_CHOICES, REWARD_LIMITS, REWARD_OPTIONS, type ClaimRecord } from '../../src/rewards/protocol';

/* ------------------------------------------------------------- storage */

/** Where the records are kept. `write` must either replace the whole file or throw. */
export interface RewardStorage {
  /** For log lines and docs (the path is not secret). */
  readonly location: string;
  /** The stored text, or null when nothing was stored yet. Throws when the file exists but can not be read. */
  read(): string | null;
  write(text: string): void;
  /** Moves an unreadable file aside so it is kept for inspection instead of being overwritten. */
  quarantine?(suffix: string): void;
}

export const REWARDS_FILE = 'rewards.json';

/** `<dir>/rewards.json`, written like the key store (secrets.json): 0600 file in a 0700 folder, temp file + rename. */
export function createFileRewardStorage(dir: string): RewardStorage {
  const file = path.join(dir, REWARDS_FILE);
  return {
    location: file,
    read() {
      if (!existsSync(file)) return null;
      return readFileSync(file, 'utf8');
    },
    write(text: string) {
      // A folder we create is private; an existing one (PLUSH_DATA_DIR may point anywhere) is left as it is.
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      try {
        writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 });
        try {
          chmodSync(temp, 0o600);
        } catch {
          /* not supported on this file system */
        }
        renameSync(temp, file);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    },
    quarantine(suffix: string) {
      renameSync(file, `${file}.${suffix}`);
    },
  };
}

/** Keeps the text in memory (tests, and createApp without a data folder). `failWrites` simulates a full disk. */
export function createMemoryRewardStorage(initial: string | null = null): RewardStorage & { text: string | null; failWrites: boolean; writes: number } {
  const storage = {
    location: '(memory)',
    text: initial,
    failWrites: false,
    writes: 0,
    read: () => storage.text,
    write: (text: string) => {
      if (storage.failWrites) throw new Error('simulated write failure');
      storage.text = text;
      storage.writes++;
    },
  };
  return storage;
}

/* -------------------------------------------------------------- schema */

const isoTime = z.string().max(40).refine((value) => Number.isFinite(Date.parse(value)), 'not a time');
const codeRe = new RegExp(`^[${CODE_ALPHABET}]{${REWARD_LIMITS.codeLength}}$`);

/** Shape check for records read back from disk (a hand-edited or older file must not break the pages). */
const ClaimRecordSchema = z.object({
  code: z.string().regex(codeRe),
  session: z.string().max(REWARD_LIMITS.maxSessionChars),
  roundId: z.number().int().min(0),
  prizeId: z.string().max(120),
  prizeName: z.string().max(REWARD_LIMITS.maxPrizeNameChars),
  tier: z.enum(RARITY_TIERS),
  themeId: z.enum(THEME_IDS),
  lang: z.enum(LANGS),
  options: z.enum(REWARD_OPTIONS),
  discountText: z.string().max(REWARD_LIMITS.maxDiscountTextChars),
  swagUrl: z.string().max(REWARD_LIMITS.maxUrlChars),
  issuedAt: isoTime,
  expiresAt: isoTime,
  choice: z.enum(REWARD_CHOICES).nullable(),
  chosenAt: isoTime.nullable(),
  redeemedAt: isoTime.nullable(),
});

const FILE_VERSION = 1;
/** Records whose code expired longer ago than this are dropped when the file is loaded. */
export const KEEP_EXPIRED_MS = 30 * 24 * 3_600_000;

/* --------------------------------------------------------------- store */

export interface LoadReport {
  loaded: number;
  /** Records that failed the shape check, or were expired for longer than KEEP_EXPIRED_MS. */
  skipped: number;
  /** Set when the file could not be read or parsed. */
  error: string | null;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

const roundKey = (session: string, roundId: number) => `${session}\u0000${roundId}`;

export class RewardStore {
  private readonly byCode = new Map<string, ClaimRecord>();
  private readonly byRound = new Map<string, string>();
  /** True when the file exists but could not be read or moved aside: writing would destroy it. */
  private blocked = false;

  constructor(
    private readonly storage: RewardStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get location(): string {
    return this.storage.location;
  }

  get size(): number {
    return this.byCode.size;
  }

  load(): LoadReport {
    this.byCode.clear();
    this.byRound.clear();
    let text: string | null;
    try {
      text = this.storage.read();
    } catch {
      this.blocked = true;
      return { loaded: 0, skipped: 0, error: 'the rewards file could not be read; new codes are refused until it is fixed' };
    }
    if (text === null || text.trim() === '') return { loaded: 0, skipped: 0, error: null };
    let records: unknown[];
    try {
      const data = JSON.parse(text) as { version?: unknown; records?: unknown };
      if (!data || typeof data !== 'object' || !Array.isArray(data.records)) throw new Error('no records array');
      records = data.records;
    } catch {
      try {
        this.storage.quarantine?.(`corrupt-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`);
        return { loaded: 0, skipped: 0, error: 'the rewards file was not valid JSON; it was moved aside and a new one is started' };
      } catch {
        this.blocked = true;
        return { loaded: 0, skipped: 0, error: 'the rewards file is not valid JSON and could not be moved aside; new codes are refused' };
      }
    }
    let skipped = 0;
    const oldest = this.now() - KEEP_EXPIRED_MS;
    for (const raw of records) {
      const parsed = ClaimRecordSchema.safeParse(raw);
      if (!parsed.success || this.byCode.has(parsed.data.code)) {
        skipped++;
        continue;
      }
      const record = parsed.data as ClaimRecord;
      if (Date.parse(record.expiresAt) < oldest) {
        skipped++;
        continue;
      }
      this.index(record);
    }
    return { loaded: this.byCode.size, skipped, error: null };
  }

  get(code: string): ClaimRecord | null {
    return this.byCode.get(code) ?? null;
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  findRound(session: string, roundId: number): ClaimRecord | null {
    const code = this.byRound.get(roundKey(session, roundId));
    return code ? (this.byCode.get(code) ?? null) : null;
  }

  /** Every record, newest first. */
  all(): ClaimRecord[] {
    return [...this.byCode.values()].reverse();
  }

  /** Adds a record. Throws StorageError (and changes nothing) when the file can not be written. */
  insert(record: ClaimRecord): void {
    if (this.byCode.has(record.code)) throw new StorageError('duplicate code');
    this.persist([...this.byCode.values(), record]);
    this.index(record);
  }

  /** Replaces the record with the same code. Throws StorageError (and changes nothing) when the file can not be written. */
  replace(record: ClaimRecord): void {
    if (!this.byCode.has(record.code)) throw new StorageError('unknown code');
    this.persist([...this.byCode.values()].map((existing) => (existing.code === record.code ? record : existing)));
    this.byCode.set(record.code, record);
  }

  private index(record: ClaimRecord): void {
    this.byCode.set(record.code, record);
    this.byRound.set(roundKey(record.session, record.roundId), record.code);
  }

  private persist(records: ClaimRecord[]): void {
    if (this.blocked) throw new StorageError('the rewards file is unreadable; refusing to overwrite it');
    const text = `${JSON.stringify({ version: FILE_VERSION, records })}\n`;
    try {
      this.storage.write(text);
    } catch {
      throw new StorageError('the rewards file could not be written');
    }
  }
}
