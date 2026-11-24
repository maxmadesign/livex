/**
 * In-memory diagnostics log shown in Settings → System. Messages are redacted
 * before they are stored: nothing that looks like a key or token survives, and
 * no camera or face data is ever passed in here.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: number;
  level: LogLevel;
  scope: string;
  message: string;
}

const MAX_ENTRIES = 120;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)([^\s"',;]{4,})/gi,
];

export function redact(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0]!, 'sk-***');
  out = out.replace(SECRET_PATTERNS[1]!, 'Bearer ***');
  out = out.replace(SECRET_PATTERNS[2]!, '$1$2***');
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

export function log(level: LogLevel, scope: string, message: string): void {
  entries.push({ time: Date.now(), level, scope, message: redact(message) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener();
}

export function logError(scope: string, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  log('error', scope, message);
}

export function getLog(): readonly LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Text version for the "copy diagnostics" button. */
export function formatLog(): string {
  return entries.map((e) => `${new Date(e.time).toISOString()} [${e.level}] ${e.scope}: ${e.message}`).join('\n');
}
