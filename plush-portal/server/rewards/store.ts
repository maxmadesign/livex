/**
 * Issued claim codes. One JSON file (`<PLUSH_DATA_DIR>/rewards.json`, mode 0600) holds every
 * record; it is loaded once at start into an in-memory index and rewritten atomically (temp file,
 * flushed to disk, then renamed) on every change. A change only becomes visible after the file was
 * written, so a failed write leaves the previous state in memory and on disk: nothing half-issued,
 * nothing lost.
 *
 * What is never thrown away at start: a file that is not valid JSON is moved aside and the complete
 * records in it are recovered; records this version can not read are written back unchanged; a
 * file from a newer version (or one that can not be read) blocks all writes instead of being
 * overwritten. Only codes that expired more than KEEP_EXPIRED_MS ago are dropped.
 *
 * Records hold codes and prize facts only (see ClaimRecord): no names, contacts or device data.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
        // Flushed before the rename: a booth machine that loses power right after a change keeps
        // either the old or the new file, never a renamed but still empty one.
        const fd = openSync(temp, 'w', 0o600);
        try {
          writeFileSync(fd, text, 'utf8');
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
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
      // The rename itself lasts once the folder is flushed too (folders can not be opened for that on Windows).
      try {
        const dirFd = openSync(dir, 'r');
        try {
          fsyncSync(dirFd);
        } finally {
          closeSync(dirFd);
        }
      } catch {
        /* best effort */
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
/** Records whose code expired longer ago than this are dropped when the file is loaded (or the store is full). */
export const KEEP_EXPIRED_MS = 30 * 24 * 3_600_000;
/**
 * Most records the file holds. Every change rewrites the whole file and blocks the server while it
 * does (about 30 ms at this size); a booth issues a few hundred codes a day, so this is weeks of use.
 */
export const MAX_RECORDS = 20_000;

/**
 * The complete record objects of a damaged (for example truncated) rewards file, in file order.
 * Strings are skipped over properly, so braces inside a prize name do not confuse it.
 */
export function salvageRecords(text: string): unknown[] {
  const key = text.indexOf('"records"');
  const open = key === -1 ? -1 : text.indexOf('[', key);
  if (open === -1) return [];
  const out: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) break;
      if (depth === 0 && start !== -1) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* not a complete record */
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

/* --------------------------------------------------------------- store */

export interface LoadReport {
  loaded: number;
  /** Records that failed the shape check or repeat a code: not used, but written back unchanged. */
  skipped: number;
  /** Records whose code expired more than KEEP_EXPIRED_MS ago: dropped. */
  pruned: number;
  /**
   * 'damaged': the file was not valid JSON; it was moved aside (`movedTo`) and the complete records
   * in it were recovered (`loaded`). 'blocked': the file can not be read, moved aside or understood
   * (written by a newer version); codes in it are shown, but nothing is written until it is fixed.
   */
  problem: 'none' | 'damaged' | 'blocked';
  /** File name the damaged file was moved to, or null. */
  movedTo: string | null;
  /** One line for the start-up log, or null when there is nothing to report. */
  error: string | null;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly reason: 'write' | 'blocked' | 'full' | 'duplicate' = 'write',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

const roundKey = (session: string, roundId: number) => `${session}\u0000${roundId}`;

export class RewardStore {
  private readonly byCode = new Map<string, ClaimRecord>();
  private readonly byRound = new Map<string, string>();
  /** Raw records this version can not use; written back as they are, and their codes never drawn again. */
  private kept: unknown[] = [];
  private readonly keptCodes = new Set<string>();
  /** True when writing would destroy data: the file can not be read or moved aside, or a newer version wrote it. */
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

  /** True when no change can be saved (see LoadReport.problem 'blocked'). */
  get readOnly(): boolean {
    return this.blocked;
  }

  load(): LoadReport {
    this.byCode.clear();
    this.byRound.clear();
    this.kept = [];
    this.keptCodes.clear();
    this.blocked = false;
    const report: LoadReport = { loaded: 0, skipped: 0, pruned: 0, problem: 'none', movedTo: null, error: null };
    let text: string | null;
    try {
      text = this.storage.read();
    } catch {
      this.blocked = true;
      return { ...report, problem: 'blocked', error: 'the rewards file could not be read; new codes are refused until it is fixed' };
    }
    if (text === null || text.trim() === '') return report;

    let records: unknown[];
    let damaged = false;
    try {
      const data = JSON.parse(text) as { version?: unknown; records?: unknown };
      if (!data || typeof data !== 'object' || !Array.isArray(data.records)) throw new Error('no records array');
      records = data.records;
      if (typeof data.version === 'number' && data.version > FILE_VERSION) {
        this.blocked = true;
        report.problem = 'blocked';
        report.error = `the rewards file was written by a newer version (file version ${data.version}); its codes are shown, but nothing is changed or issued until that version runs again`;
      }
    } catch {
      const suffix = `corrupt-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`;
      try {
        this.storage.quarantine?.(suffix);
      } catch {
        this.blocked = true;
        return { ...report, problem: 'blocked', error: 'the rewards file is not valid JSON and could not be moved aside; new codes are refused' };
      }
      damaged = true;
      records = salvageRecords(text);
      report.problem = 'damaged';
      report.movedTo = this.storage.quarantine ? `${REWARDS_FILE}.${suffix}` : null;
    }

    const oldest = this.now() - KEEP_EXPIRED_MS;
    for (const raw of records) {
      const parsed = ClaimRecordSchema.safeParse(raw);
      if (!parsed.success || this.byCode.has(parsed.data.code)) {
        report.skipped++;
        this.keep(raw);
        continue;
      }
      const record = parsed.data as ClaimRecord;
      if (Date.parse(record.expiresAt) < oldest) {
        report.pruned++;
        continue;
      }
      this.index(record);
    }
    report.loaded = this.byCode.size;

    if (damaged) {
      report.error = `the rewards file was not valid JSON; it was moved aside${report.movedTo ? ` to ${report.movedTo}` : ''} and ${report.loaded} complete records were recovered from it`;
      // Written at once, so a restart before the next change does not lose the recovered codes.
      try {
        this.persist(this.records());
      } catch {
        /* the next change tries again and reports it */
      }
    } else if (report.skipped > 0 && !report.error) {
      report.error = `${report.skipped} stored records could not be read by this version; they are kept in the file but not used`;
    }
    return report;
  }

  get(code: string): ClaimRecord | null {
    return this.byCode.get(code) ?? null;
  }

  /** True for codes in use, including those of records this version can not read. */
  has(code: string): boolean {
    return this.byCode.has(code) || this.keptCodes.has(code);
  }

  findRound(session: string, roundId: number): ClaimRecord | null {
    const code = this.byRound.get(roundKey(session, roundId));
    return code ? (this.byCode.get(code) ?? null) : null;
  }

  /** Every record, newest first. */
  all(): ClaimRecord[] {
    return [...this.byCode.values()].reverse();
  }

  /** True when a new record would be refused (MAX_RECORDS, after dropping long-expired codes). */
  full(): boolean {
    return this.byCode.size + this.kept.length >= MAX_RECORDS && this.withoutLongExpired().length + this.kept.length >= MAX_RECORDS;
  }

  /** Adds a record. Throws StorageError (and changes nothing) when the file can not be written or is full. */
  insert(record: ClaimRecord): void {
    if (this.has(record.code)) throw new StorageError('duplicate code', 'duplicate');
    let current = this.records();
    let pruned = false;
    if (current.length + this.kept.length >= MAX_RECORDS) {
      current = this.withoutLongExpired();
      pruned = true;
      if (current.length + this.kept.length >= MAX_RECORDS) throw new StorageError(`the rewards file holds the maximum of ${MAX_RECORDS} codes`, 'full');
    }
    this.persist([...current, record]);
    if (pruned) {
      this.byCode.clear();
      this.byRound.clear();
      for (const existing of current) this.index(existing);
    }
    this.index(record);
  }

  /** Replaces the record with the same code. Throws StorageError (and changes nothing) when the file can not be written. */
  replace(record: ClaimRecord): void {
    if (!this.byCode.has(record.code)) throw new StorageError('unknown code');
    this.persist(this.records().map((existing) => (existing.code === record.code ? record : existing)));
    this.byCode.set(record.code, record);
  }

  /** Records in file order (oldest first). */
  private records(): ClaimRecord[] {
    return [...this.byCode.values()];
  }

  private withoutLongExpired(): ClaimRecord[] {
    const oldest = this.now() - KEEP_EXPIRED_MS;
    return this.records().filter((record) => Date.parse(record.expiresAt) >= oldest);
  }

  private keep(raw: unknown): void {
    this.kept.push(raw);
    const code = raw && typeof raw === 'object' ? (raw as { code?: unknown }).code : undefined;
    if (typeof code === 'string') this.keptCodes.add(code);
  }

  private index(record: ClaimRecord): void {
    this.byCode.set(record.code, record);
    this.byRound.set(roundKey(record.session, record.roundId), record.code);
  }

  private persist(records: ClaimRecord[]): void {
    if (this.blocked) throw new StorageError('the rewards file can not be used safely; refusing to overwrite it', 'blocked');
    const text = `${JSON.stringify({ version: FILE_VERSION, records: [...this.kept, ...records] })}\n`;
    try {
      this.storage.write(text);
    } catch {
      throw new StorageError('the rewards file could not be written');
    }
  }
}
