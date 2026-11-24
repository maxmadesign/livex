/**
 * Minimal structured logger for the API proxy. Everything that is written
 * passes through `redact`, so API keys and bearer tokens can not end up in
 * logs even if an upstream error message echoes them. Long strings (prompts,
 * model output) are truncated.
 */

export type LogLevel = 'silent' | 'error' | 'info' | 'debug';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  error(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  /** Adds a secret that appears at run time (a key replaced in Settings) to the redaction list. */
  addSecret?(secret: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { silent: 0, error: 1, info: 2, debug: 3 };
const MAX_FIELD_CHARS = 160;

/** `secrets` is read on every call, so entries added later are redacted too. */
export function makeRedactor(secrets: readonly (string | null | undefined)[]): (text: string) => string {
  return (text: string) => {
    let out = text;
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('[redacted]');
    }
    return out
      .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]');
  };
}

export function createLogger(
  level: LogLevel,
  secrets: readonly (string | null | undefined)[] = [],
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  const known = [...secrets];
  const redact = makeRedactor(known);
  const write = (lvl: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[lvl]) return;
    let line = `[plush-api] ${new Date().toISOString()} ${lvl} ${message}`;
    if (fields) {
      for (const key of Object.keys(fields)) {
        const value = fields[key];
        if (value === undefined) continue;
        let text = typeof value === 'string' ? value.replace(/\s+/g, ' ') : String(value);
        if (text.length > MAX_FIELD_CHARS) text = `${text.slice(0, MAX_FIELD_CHARS)}…(${text.length} chars)`;
        line += ` ${key}=${JSON.stringify(text)}`;
      }
    }
    sink(redact(line));
  };
  return {
    error: (message, fields) => write('error', message, fields),
    info: (message, fields) => write('info', message, fields),
    debug: (message, fields) => write('debug', message, fields),
    addSecret: (secret) => {
      if (secret && !known.includes(secret)) known.push(secret);
    },
  };
}
