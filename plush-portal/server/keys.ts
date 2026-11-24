/**
 * The OpenAI key the server uses, and how it can be replaced at run time.
 *
 *  - Default: OPENAI_API_KEY from the environment / `.env` (source "env").
 *  - Replaced in Settings → AI Guide: POST /api/ai/key stores the key in a
 *    git-ignored file (`.data/secrets.json`, mode 0600) and uses it at once
 *    (source "settings"). DELETE /api/ai/key removes it again.
 *
 * The key never leaves this module except as the Authorization header of the
 * OpenAI client: responses carry only the source and a masked fingerprint
 * ("…wxyz"), the logger redacts it, and it is never part of the settings.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CredentialSource } from '../src/ai/protocol';

/* ------------------------------------------------------------- masking */

/** "…wxyz": the last four characters only, never a prefix (prefixes such as "sk-proj-" are not secret but look alarming). */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const tail = key.trim().slice(-4);
  return tail.length === 4 ? `…${tail}` : '…';
}

/* ---------------------------------------------------------- validation */

export const MAX_KEY_CHARS = 512;

export type KeyFormatResult = { ok: true; key: string } | { ok: false; reason: string };

/**
 * Checks the shape of a key before it is used or stored. OpenAI keys start
 * with "sk-" (project, service-account and user keys alike); a gateway set in
 * OPENAI_BASE_URL may use any token, so `requireOpenAiPrefix` is false then.
 * Reasons are fixed texts: they never echo the input.
 */
export function validateKeyFormat(input: unknown, requireOpenAiPrefix = true): KeyFormatResult {
  if (typeof input !== 'string') return { ok: false, reason: 'The key must be a string.' };
  const key = input.trim();
  if (key.length === 0) return { ok: false, reason: 'The key is empty.' };
  if (key.length > MAX_KEY_CHARS) return { ok: false, reason: 'The key is far too long.' };
  if (/\s/.test(key)) return { ok: false, reason: 'The key must not contain spaces or line breaks.' };
  if (!/^[A-Za-z0-9_\-.:~+/=]+$/.test(key)) return { ok: false, reason: 'The key contains characters an API key never has.' };
  if (requireOpenAiPrefix) {
    if (!key.startsWith('sk-')) return { ok: false, reason: 'OpenAI API keys start with "sk-".' };
    if (key.length < 20) return { ok: false, reason: 'The key is too short to be an OpenAI API key.' };
  } else if (key.length < 8) {
    return { ok: false, reason: 'The key is too short.' };
  }
  return { ok: true, key };
}

/* --------------------------------------------------------------- store */

export interface StoredKey {
  key: string;
  savedAt: string;
}

/** Persistence of a replaced key. */
export interface KeyStore {
  /** Where the key lives (for docs and log lines; the path is not secret). */
  readonly location: string;
  read(): StoredKey | null;
  write(key: string, savedAt: string): void;
  clear(): void;
}

const SECRETS_FILE = 'secrets.json';

/**
 * File store in `dir` (default `<project>/.data`): `secrets.json` with mode
 * 0600 inside a 0700 folder, written atomically (temp file + rename). On
 * Windows the modes are ignored by the OS; the folder is still git-ignored.
 */
export function createFileKeyStore(dir: string): KeyStore {
  const file = path.join(dir, SECRETS_FILE);
  return {
    location: file,
    read() {
      if (!existsSync(file)) return null;
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { openaiApiKey?: unknown; savedAt?: unknown };
        const format = validateKeyFormat(data.openaiApiKey, false);
        if (!format.ok) return null;
        return { key: format.key, savedAt: typeof data.savedAt === 'string' ? data.savedAt : '' };
      } catch {
        return null;
      }
    },
    write(key: string, savedAt: string) {
      // A folder we create is private (0700); an existing one (PLUSH_DATA_DIR may point anywhere) is left as it is.
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ openaiApiKey: key, savedAt }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      try {
        chmodSync(temp, 0o600);
      } catch {
        /* not supported on this file system */
      }
      renameSync(temp, file);
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}

/** A store that keeps nothing (tests, or key management switched off). */
export function createMemoryKeyStore(initial: StoredKey | null = null): KeyStore {
  let value = initial;
  return {
    location: '(memory)',
    read: () => value,
    write: (key, savedAt) => {
      value = { key, savedAt };
    },
    clear: () => {
      value = null;
    },
  };
}

/* ------------------------------------------------------------ manager */

export interface ActiveCredential<C> {
  /** null = no key: the AI routes answer "no_key". */
  key: string | null;
  source: CredentialSource;
  /** Client(s) built for this key; null without a key. */
  clients: C | null;
  /** Increases on every replacement, so dependants can rebuild. */
  generation: number;
  savedAt: string | null;
}

export interface KeyManager<C> {
  active(): ActiveCredential<C>;
  /** True when OPENAI_API_KEY provides a default. */
  hasEnvDefault(): boolean;
  /** Stores `key` and switches to it. Throws when the store can not be written. */
  replace(key: string, now?: Date): void;
  /** Forgets the stored key and goes back to the environment default (or no key). */
  restoreDefault(): void;
}

export interface KeyManagerOptions<C> {
  envKey: string | null;
  /** null = replaced keys are neither loaded nor stored (key management off). */
  store: KeyStore | null;
  createClients(key: string): C;
  /** Called with every key that becomes active, so the logger can redact it. */
  onKey?(key: string): void;
}

export function createKeyManager<C>(options: KeyManagerOptions<C>): KeyManager<C> {
  let generation = 0;
  let current: ActiveCredential<C>;

  const activate = (key: string | null, source: CredentialSource, savedAt: string | null) => {
    if (key) options.onKey?.(key);
    current = { key, source, clients: key ? options.createClients(key) : null, generation: ++generation, savedAt };
  };

  const stored = options.store?.read() ?? null;
  if (stored) activate(stored.key, 'settings', stored.savedAt || null);
  else activate(options.envKey, options.envKey ? 'env' : 'none', null);

  return {
    active: () => current,
    hasEnvDefault: () => !!options.envKey,
    replace(key: string, now = new Date()) {
      if (!options.store) throw new Error('Key storage is switched off.');
      const savedAt = now.toISOString();
      options.store.write(key, savedAt);
      activate(key, 'settings', savedAt);
    },
    restoreDefault() {
      options.store?.clear();
      activate(options.envKey, options.envKey ? 'env' : 'none', null);
    },
  };
}

/* ------------------------------------------------------ request origin */

/** 127.0.0.0/8, ::1 and IPv4-mapped loopback. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Host header (or Origin host) naming this machine: localhost, *.localhost, 127.x.x.x, [::1]. */
export function isLoopbackHostName(host: string | null | undefined): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith('[')) name = name.slice(1, name.indexOf(']') === -1 ? undefined : name.indexOf(']'));
  else name = name.replace(/:\d+$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  return isLoopbackAddress(name);
}

export interface RequestOrigin {
  /** Address of the TCP peer, as the socket reports it. */
  socketAddress: string | null;
  host: string | null;
  origin: string | null;
  /** X-Forwarded-For, Forwarded and X-Real-IP, raw. */
  forwarded: (string | null | undefined)[];
}

/** Every address a forwarding header names (for X-Forwarded-For, Forwarded `for=` and X-Real-IP). */
export function forwardedAddresses(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(',')) {
      const forMatch = /for=("?)([^";]+)\1/i.exec(part);
      const raw = (forMatch ? forMatch[2]! : part).trim();
      if (!raw) continue;
      // "1.2.3.4:5678" / "[::1]:5678" → address only
      const address = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(raw) ? raw.replace(/:\d+$/, '') : raw;
      out.push(address);
    }
  }
  return out;
}

/**
 * True only for a request made on this machine: the socket peer is loopback,
 * no forwarding header names another client (a local reverse proxy or the Vite
 * dev proxy forwarding a phone's request), and Host / Origin name this machine
 * (which defeats DNS-rebinding pages that resolve their own name to 127.0.0.1).
 * Forwarding headers are only ever used to refuse, never to allow.
 */
export function isLocalRequest(request: RequestOrigin): boolean {
  if (!isLoopbackAddress(request.socketAddress)) return false;
  if (forwardedAddresses(request.forwarded).some((address) => !isLoopbackAddress(address))) return false;
  if (!isLoopbackHostName(request.host)) return false;
  if (request.origin) {
    // "null" comes from sandboxed frames and local files: never trusted for key management.
    if (request.origin === 'null') return false;
    try {
      if (!isLoopbackHostName(new URL(request.origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
