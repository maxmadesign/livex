/**
 * Connection limits for listeners that face the booth network. Every open connection holds a file
 * descriptor of this one process; without a cap a single visitor can open enough idle or slow
 * connections to the claim listener that the kiosk's own API (same process) can not accept or open
 * anything more (EMFILE): no game, no new codes.
 *
 * Loopback peers are never capped: they are the kiosk itself, the Vite dev proxy or a tunnel
 * running on this machine that carries every visitor.
 */
import type { Server } from 'node:net';
import { addressKey } from './clientKey';
import { isLoopbackAddress } from './keys';

export interface ConnectionLimits {
  /** Open connections one address (IPv6: one /64) may hold at a time. */
  perAddress: number;
  /** Open connections in total (null = no total cap). Loopback peers count towards it too. */
  total: number | null;
}

/** Claim listener: a phone needs a handful; a booth sees far fewer than this many phones at once. */
export const CLAIM_CONNECTION_LIMITS: ConnectionLimits = { perAddress: 16, total: 256 };
/** Main and HTTPS servers when they listen on the network (a game load opens a few dozen at most). */
export const LAN_CONNECTION_LIMITS: ConnectionLimits = { perAddress: 48, total: null };

/** Timeouts of the claim listener: its requests are tiny, so slow ones are dropped early. */
export const CLAIM_SERVER_OPTIONS = {
  headersTimeout: 10_000,
  requestTimeout: 20_000,
  keepAliveTimeout: 5_000,
  connectionsCheckingInterval: 2_000,
} as const;

/**
 * Applies `limits` to `server`; returns a function that reports the open connections per key.
 * `exempt` decides which peers are never capped (default: loopback; tests count those too).
 */
export function limitConnections(
  server: Server,
  limits: ConnectionLimits,
  onRefused?: (key: string) => void,
  exempt: (address: string) => boolean = isLoopbackAddress,
): () => Map<string, number> {
  const open = new Map<string, number>();
  if (limits.total !== null) server.maxConnections = limits.total;
  server.on('connection', (socket) => {
    const address = socket.remoteAddress ?? 'unknown';
    if (exempt(address)) return;
    const key = addressKey(address);
    const count = (open.get(key) ?? 0) + 1;
    if (count > limits.perAddress) {
      onRefused?.(key);
      socket.destroy();
      return;
    }
    open.set(key, count);
    socket.once('close', () => {
      const left = (open.get(key) ?? 1) - 1;
      if (left <= 0) open.delete(key);
      else open.set(key, left);
    });
  });
  return () => new Map(open);
}
