/**
 * The LAN claim listener: a second HTTP server on 0.0.0.0:PLUSH_CLAIM_PORT that serves only the
 * claim pages (createClaimApp), so phones on the booth network can open the QR link while the
 * main server (game, /api, /staff) stays on 127.0.0.1.
 *
 * It never takes the main server down: a busy port or a missing permission is logged and the QR
 * codes keep pointing at the loopback fallback (the kiosk then says phones can not reach it). Nor
 * can a visitor on the booth network starve it: connections per address and in total are capped
 * and slow requests time out (server/connLimit.ts), so the process keeps file descriptors free.
 */
import type { AddressInfo, Server as NetServer } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { CLAIM_CONNECTION_LIMITS, CLAIM_SERVER_OPTIONS, limitConnections, type ConnectionLimits } from '../connLimit';
import type { Logger } from '../log';
import { firstLanIPv4, selectClaimBase } from './claimBase';
import type { RewardsService } from './service';

export interface ClaimListenerOptions {
  app: Hono;
  port: number;
  host: string;
  rewards: RewardsService;
  logger: Logger;
  /** PLUSH_CLAIM_PUBLIC_URL (validated), or null. */
  publicUrl: string | null;
  mainPort: number;
  lanAddress?: () => string | null;
  /** Default CLAIM_CONNECTION_LIMITS (tests pass smaller ones). */
  limits?: ConnectionLimits;
}

export interface ClaimListener {
  server: ReturnType<typeof serve>;
  /** Resolves with the port it listens on, or null when it could not start. */
  ready: Promise<number | null>;
  /** Open connections per client key (loopback peers are not counted). */
  connections(): Map<string, number>;
  close(callback?: () => void): void;
}

/** Refused connections are logged at most this often (one line with the count, never addresses). */
const REFUSED_LOG_MS = 60_000;

export function startClaimListener(options: ClaimListenerOptions): ClaimListener {
  const lanAddress = options.lanAddress ?? (() => firstLanIPv4());
  let settled = false;
  let resolveReady: (port: number | null) => void = () => {};
  const ready = new Promise<number | null>((resolve) => {
    resolveReady = resolve;
  });
  const server = serve({ fetch: options.app.fetch, port: options.port, hostname: options.host, serverOptions: { ...CLAIM_SERVER_OPTIONS } }, (info) => {
    settled = true;
    const port = (info as AddressInfo).port;
    const target = selectClaimBase({ publicUrl: options.publicUrl, listenerPort: port, lanAddress: lanAddress(), mainPort: options.mainPort });
    options.rewards.setClaimTarget(target);
    options.logger.info('claim pages', { url: `${target.base}/c/<code>`, reach: target.reach, listener: `${options.host}:${port}` });
    if (target.reach === 'loopback') options.logger.info('claim pages: no LAN address found; phones can not open the QR link (set PLUSH_CLAIM_PUBLIC_URL)');
    resolveReady(port);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (settled) {
      options.logger.error('claim listener error', { code: error.code ?? 'unknown' });
      return;
    }
    settled = true;
    const target = options.rewards.claimTarget();
    options.logger.error('claim listener could not start; QR links use the fallback', {
      port: options.port,
      code: error.code ?? 'unknown',
      url: `${target.base}/c/<code>`,
      reach: target.reach,
    });
    resolveReady(null);
  });
  let refused = 0;
  let lastLog = -Infinity;
  const connections = limitConnections(server as unknown as NetServer, options.limits ?? CLAIM_CONNECTION_LIMITS, () => {
    refused++;
    const t = Date.now();
    if (t - lastLog < REFUSED_LOG_MS) return;
    lastLog = t;
    options.logger.info('claim listener refused connections over the per-device limit', { refused });
  });
  return {
    server,
    ready,
    connections,
    close: (callback) => {
      if (!server.listening) {
        callback?.();
        return;
      }
      server.close(() => callback?.());
    },
  };
}
