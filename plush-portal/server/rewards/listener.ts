/**
 * The LAN claim listener: a second HTTP server on 0.0.0.0:PLUSH_CLAIM_PORT that serves only the
 * claim pages (createClaimApp), so phones on the booth network can open the QR link while the
 * main server (game, /api, /staff) stays on 127.0.0.1.
 *
 * It never takes the main server down: a busy port or a missing permission is logged and the QR
 * codes keep pointing at the loopback fallback (the kiosk then says phones can not reach it).
 */
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
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
}

export interface ClaimListener {
  server: ReturnType<typeof serve>;
  /** Resolves with the port it listens on, or null when it could not start. */
  ready: Promise<number | null>;
  close(callback?: () => void): void;
}

export function startClaimListener(options: ClaimListenerOptions): ClaimListener {
  const lanAddress = options.lanAddress ?? (() => firstLanIPv4());
  let settled = false;
  let resolveReady: (port: number | null) => void = () => {};
  const ready = new Promise<number | null>((resolve) => {
    resolveReady = resolve;
  });
  const server = serve({ fetch: options.app.fetch, port: options.port, hostname: options.host }, (info) => {
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
  return {
    server,
    ready,
    close: (callback) => {
      if (!server.listening) {
        callback?.();
        return;
      }
      server.close(() => callback?.());
    },
  };
}
