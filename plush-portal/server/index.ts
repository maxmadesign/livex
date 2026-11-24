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
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createApp, type ClientBundle, type OpenAILike } from './app';
import { loadConfig, type ServerConfig } from './config';
import { createFileKeyStore, createKeyManager, maskKey, type KeyManager } from './keys';
import { createLogger, type Logger } from './log';
import { setupNetwork, type NetworkSetup } from './net';
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
  const app = createApp({ config, keys, logger });
  return { app, logger, keys };
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
  return server;
}

export function start(env: Record<string, string | undefined> = process.env, argv: readonly string[] = process.argv.slice(2)) {
  const config = loadConfig(env, argv, readVersion());
  const network = setupNetwork(env);
  const { app, logger, keys } = createServerApp(config, network);
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
  });
  const secure = config.https.enabled ? listenHttps(config, app, logger) : null;
  const shutdown = () => {
    let open = secure ? 2 : 1;
    const closed = () => {
      if (--open <= 0) process.exit(0);
    };
    server.close(closed);
    secure?.close(closed);
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
