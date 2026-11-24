/**
 * PLUSH PORTAL API server.
 *
 *   tsx server/index.ts               API only (the Vite dev server proxies /api to it)
 *   tsx server/index.ts --serve-dist  API + the production build from dist/
 *
 * Configuration comes from environment variables / `.env` (see .env.example).
 * Without an OpenAI key the server still runs: the AI routes report `no_key`
 * and the game plays with its local lines. A key replaced in Settings is kept
 * in `.data/secrets.json` and wins over OPENAI_API_KEY until it is restored.
 *
 * Outbound traffic to OpenAI honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY and
 * extra CA certificates (NODE_EXTRA_CA_CERTS, SSL_CERT_FILE) without any
 * special Node flag (see server/net.ts). PLUSH_HTTPS=1 adds an HTTPS listener
 * for phones on the LAN (see server/tls.ts).
 *
 * Prize claim codes (docs/REWARDS.md) are kept in `<PLUSH_DATA_DIR>/rewards.json`; unless
 * PLUSH_REWARDS=off or PLUSH_CLAIM_LAN=off a second listener on 0.0.0.0:PLUSH_CLAIM_PORT (8788)
 * serves only the claim pages to phones on the booth network.
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as NetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { BRAND_KITS } from '../src/brand/kits';
import { createApp, type ClientBundle, type OpenAILike } from './app';
import { makeClientKey } from './clientKey';
import { MIN_ADMIN_TOKEN_CHARS, loadConfig, type ServerConfig } from './config';
import { LAN_CONNECTION_LIMITS, limitConnections } from './connLimit';
import { createFileKeyStore, createKeyManager, isLoopbackHostName, maskKey, type KeyManager } from './keys';
import { createLogger, type Logger } from './log';
import { setupNetwork, type NetworkSetup } from './net';
import {
  createBrandAssets,
  createClaimApp,
  createFileRewardStorage,
  createRewardsService,
  initialClaimTarget,
  startClaimListener,
  type BrandAssets,
  type ClaimListener,
  type RewardsService,
} from './rewards';
import { openAiRealtimeConnect } from './speech';
import { ensureTlsMaterial, localHostNames } from './tls';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Builds the SDK client (and the Realtime connector) for one key. */
export function clientFactory(config: ServerConfig, network: NetworkSetup | null): (key: string) => ClientBundle {
  // Same host as the client's Realtime URL (https → wss), so the proxy decision matches.
  const realtimeUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/^http/, 'ws');
  return (key: string) => {
    // The SDK's own retries are off: the proxy does one bounded retry itself so the time budget stays predictable.
    const openai = new OpenAI({ apiKey: key, baseURL: config.baseUrl ?? undefined, maxRetries: 0, timeout: config.textTimeoutMs });
    return {
      client: openai as unknown as OpenAILike,
      realtimeConnect: openAiRealtimeConnect(openai, network ? network.wsOptionsFor(realtimeUrl) : undefined),
    };
  };
}

export function createServerApp(config: ServerConfig, network: NetworkSetup | null = null) {
  const logger = createLogger(config.logLevel, [config.apiKey, config.adminToken]);
  const keys: KeyManager<ClientBundle> = createKeyManager<ClientBundle>({
    envKey: config.apiKey,
    // PLUSH_KEY_MANAGEMENT=off: a stored replacement is neither used nor written.
    store: config.keyManagement === 'off' ? null : createFileKeyStore(config.dataDir),
    createClients: clientFactory(config, network),
    onKey: (key) => logger.addSecret?.(key),
  });
  const rewards = createRewardsService({
    enabled: config.rewards.enabled,
    ttlHours: config.rewards.ttlHours,
    storage: createFileRewardStorage(config.dataDir),
    brand: BRAND_KITS[config.brand],
    claimTarget: initialClaimTarget(config),
    logger,
  });
  const brandAssets = createBrandAssets(rewards.brand, config.rewards.assetDirs);
  const app = createApp({ config, keys, logger, rewards, brandAssets });
  return { app, logger, keys, rewards, brandAssets };
}

/** Project-relative path of a data file for log lines (absolute when it lives elsewhere). */
function storeLabel(location: string): string {
  const relative = path.relative(projectRoot, location);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : location;
}

/** The claim-only listener for phones (null when rewards or the LAN listener are switched off). */
function listenClaims(config: ServerConfig, rewards: RewardsService, brandAssets: BrandAssets, logger: Logger): ClaimListener | null {
  if (!config.rewards.enabled || !config.rewards.claimLan) {
    const target = rewards.claimTarget();
    logger.info('claim pages', { url: `${target.base}/c/<code>`, reach: target.reach, listener: config.rewards.enabled ? 'off (PLUSH_CLAIM_LAN)' : 'off (PLUSH_REWARDS)' });
    return null;
  }
  const app = createClaimApp({ rewards, assets: brandAssets, logger, now: () => Date.now(), clientKey: makeClientKey(config.trustProxy) });
  return startClaimListener({
    app,
    port: config.rewards.claimPort,
    host: config.rewards.claimHost,
    rewards,
    logger,
    publicUrl: config.rewards.publicUrl,
    mainPort: config.port,
  });
}

function listenHttps(config: ServerConfig, app: ReturnType<typeof createApp>, logger: Logger) {
  let material;
  try {
    material = ensureTlsMaterial({
      dir: path.join(config.dataDir, 'tls'),
      certFile: config.https.certFile,
      keyFile: config.https.keyFile,
    });
  } catch (error) {
    logger.error('https disabled: no usable certificate', { detail: (error as Error)?.message ?? 'unknown' });
    return null;
  }
  const server = serve(
    {
      fetch: app.fetch,
      port: config.https.port,
      hostname: config.https.host,
      createServer: createHttpsServer,
      serverOptions: { key: material.key, cert: material.cert },
    },
    (info) => {
      const lan = config.https.host === '0.0.0.0' || config.https.host === '::' ? localHostNames().filter((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) && h !== '127.0.0.1') : [config.https.host];
      logger.info('https listening', {
        urls: lan.map((h) => `https://${h}:${info.port}`).join(' ') || `https://${config.https.host}:${info.port}`,
        certificate: material.source === 'user' ? 'PLUSH_TLS_CERT' : `self-signed (${material.source})`,
        certFile: path.relative(projectRoot, material.certFile),
        sha256: material.fingerprint256,
        validTo: material.validTo,
      });
    },
  );
  limitConnections(server as unknown as NetServer, LAN_CONNECTION_LIMITS);
  return server;
}

export function start(env: Record<string, string | undefined> = process.env, argv: readonly string[] = process.argv.slice(2)) {
  const config = loadConfig(env, argv, readVersion());
  const network = setupNetwork(env);
  const { app, logger, keys, rewards, brandAssets } = createServerApp(config, network);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    const active = keys.active();
    logger.info('listening', {
      url: `http://${config.host}:${info.port}`,
      serveDist: config.serveDist,
      gptConfigured: active.key !== null,
      keySource: active.source,
      keyFingerprint: maskKey(active.key),
      textModel: config.textModel,
      speechApi: config.speechApi,
      speechModel: config.speechModel,
      adminProtected: config.adminToken !== null,
      keyManagement: config.keyManagement,
    });
    logger.info('outbound', { openai: network.describe(config.baseUrl ?? DEFAULT_BASE_URL) });
    for (const file of network.extraCa.failed) logger.error('extra CA file could not be read', { file });
    if (!active.key) logger.info('no OpenAI key: AI routes answer "no_key" and the game uses local lines');
    if (config.speechConfigError) logger.error('speech configuration problem', { detail: config.speechConfigError });
    for (const warning of config.warnings) logger.info('config note', { detail: warning });
    const report = rewards.loadReport;
    logger.info('rewards', {
      enabled: rewards.enabled,
      brand: rewards.brand.id,
      codes: report.loaded,
      skipped: report.skipped || undefined,
      pruned: report.pruned || undefined,
      ttlHours: rewards.ttlHours,
      store: storeLabel(rewards.location),
    });
    // Also shown on the prize desk, so staff know why a visitor's code may say "not found".
    if (report.error) logger.error('rewards store problem', { detail: report.error });
    // The token issues codes and opens the prize desk from any device; wrong guesses are slowed
    // down (ADMIN_TOKEN_FAILURES_PER_MIN per device), which only protects a long random token.
    if (config.adminToken && config.adminToken.length < MIN_ADMIN_TOKEN_CHARS) {
      logger.error('PLUSH_ADMIN_TOKEN is short and can be guessed', { detail: `use at least ${MIN_ADMIN_TOKEN_CHARS} random characters, e.g. the output of: openssl rand -hex 24` });
    }
    if (config.adminToken && !isLoopbackHostName(config.host) && !config.https.enabled) {
      logger.info('config note', { detail: 'the admin token travels in clear text over plain http on the network; staff devices should use the HTTPS listener (PLUSH_HTTPS=1)' });
    }
  });
  // On the network (PLUSH_API_HOST=0.0.0.0) one device must not be able to use up every file descriptor.
  if (!isLoopbackHostName(config.host)) limitConnections(server as unknown as NetServer, LAN_CONNECTION_LIMITS);
  const secure = config.https.enabled ? listenHttps(config, app, logger) : null;
  const claims = listenClaims(config, rewards, brandAssets, logger);
  const shutdown = () => {
    let open = 1 + (secure ? 1 : 0) + (claims ? 1 : 0);
    const closed = () => {
      if (--open <= 0) process.exit(0);
    };
    server.close(closed);
    secure?.close(closed);
    claims?.close(closed);
    // Do not hang on open keep-alive connections.
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
  start();
}
