/**
 * PLUSH PORTAL API server.
 *
 *   tsx server/index.ts               API only (the Vite dev server proxies /api to it)
 *   tsx server/index.ts --serve-dist  API + the production build from dist/
 *
 * Configuration comes from environment variables / `.env` (see .env.example).
 * Without OPENAI_API_KEY the server still runs: the AI routes report `no_key`
 * and the game plays with its local lines.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createApp, type OpenAILike } from './app';
import { loadConfig, type ServerConfig } from './config';
import { createLogger } from './log';
import { openAiRealtimeConnect } from './speech';

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

export function createServerApp(config: ServerConfig) {
  const logger = createLogger(config.logLevel, [config.apiKey, config.adminToken]);
  // The SDK's own retries are off: the proxy does one bounded retry itself so the time budget stays predictable.
  const openai = config.apiKey
    ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl ?? undefined, maxRetries: 0, timeout: config.textTimeoutMs })
    : null;
  const app = createApp({
    config,
    client: openai as unknown as OpenAILike | null,
    realtimeConnect: openai ? openAiRealtimeConnect(openai) : null,
    logger,
  });
  return { app, logger };
}

export function start(env: Record<string, string | undefined> = process.env, argv: readonly string[] = process.argv.slice(2)) {
  const config = loadConfig(env, argv, readVersion());
  const { app, logger } = createServerApp(config);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    logger.info('listening', {
      url: `http://${config.host}:${info.port}`,
      serveDist: config.serveDist,
      gptConfigured: config.apiKey !== null,
      textModel: config.textModel,
      speechApi: config.speechApi,
      speechModel: config.speechModel,
      adminProtected: config.adminToken !== null,
    });
    if (!config.apiKey) logger.info('no OPENAI_API_KEY: AI routes answer "no_key" and the game uses local lines');
    if (config.speechConfigError) logger.error('speech configuration problem', { detail: config.speechConfigError });
    for (const warning of config.warnings) logger.info('config note', { detail: warning });
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
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
