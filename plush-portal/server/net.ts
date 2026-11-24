/**
 * Outbound networking for the OpenAI calls: HTTP(S) proxy support and extra
 * CA certificates, so the server works behind a corporate / sandbox proxy
 * without special Node flags.
 *
 *  - fetch (Responses API, models list, key checks): an undici dispatcher is
 *    installed as the global dispatcher. Requests whose host matches NO_PROXY
 *    go direct, everything else through HTTPS_PROXY / HTTP_PROXY (undici's
 *    ProxyAgent, CONNECT tunnel for https).
 *  - Realtime WebSocket (`ws`): ignores the global dispatcher, so it gets an
 *    https.Agent that opens an HTTP CONNECT tunnel through the same proxy.
 *  - CA certificates from NODE_EXTRA_CA_CERTS / SSL_CERT_FILE are read at
 *    start (Node only reads NODE_EXTRA_CA_CERTS when the process starts, and
 *    never SSL_CERT_FILE) and added to the default trust store.
 *
 * Proxy URLs can contain credentials: they are never logged (see describeProxy).
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import { Agent, Dispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';

type Env = Record<string, string | undefined>;

/* ------------------------------------------------------------ settings */

export interface ProxySettings {
  /** Proxy for https:// (and wss://) targets. */
  https: URL | null;
  /** Proxy for http:// (and ws://) targets. */
  http: URL | null;
  /** Raw NO_PROXY value ('' = proxy everything). */
  noProxy: string;
}

function parseProxyUrl(value: string | undefined): URL | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    // "host:port" without a scheme is common in the wild: treat it as http://.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** Reads the conventional variables (lower case wins, as in curl and undici). */
export function resolveProxySettings(env: Env): ProxySettings {
  const httpProxy = parseProxyUrl(env.http_proxy ?? env.HTTP_PROXY);
  const httpsProxy = parseProxyUrl(env.https_proxy ?? env.HTTPS_PROXY) ?? httpProxy;
  return { https: httpsProxy, http: httpProxy, noProxy: (env.no_proxy ?? env.NO_PROXY ?? '').trim() };
}

interface NoProxyEntry {
  host: string;
  port: number;
  cidr: { base: number; bits: number } | null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function parseNoProxy(value: string): NoProxyEntry[] {
  const entries: NoProxyEntry[] = [];
  for (const token of value.split(/[,\s]+/)) {
    const item = token.trim().toLowerCase();
    if (!item) continue;
    const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(item);
    if (cidr) {
      const base = ipv4ToInt(cidr[1]!);
      const bits = Number(cidr[2]);
      if (base !== null && bits <= 32) entries.push({ host: item, port: 0, cidr: { base, bits } });
      continue;
    }
    // "host:port" (but not a bare IPv6 address such as "::1").
    const withPort = /^(.*[^:]):(\d+)$/.exec(item);
    const host = withPort && !item.startsWith('[') && (withPort[1]!.match(/:/g)?.length ?? 0) === 0 ? withPort[1]! : item;
    const port = withPort && host !== item ? Number(withPort[2]) : 0;
    entries.push({ host: host.replace(/^\[|\]$/g, ''), port, cidr: null });
  }
  return entries;
}

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443 };

/**
 * NO_PROXY matching. Same rules as undici's EnvHttpProxyAgent (exact host, or
 * suffix match for entries starting with "." or "*"; optional ":port"; "*"
 * disables the proxy), plus IPv4 CIDR ranges such as 127.0.0.0/8.
 */
export function bypassesProxy(target: URL, noProxy: string): boolean {
  const value = noProxy.trim();
  if (!value) return false;
  if (value === '*') return true;
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(target.port) || DEFAULT_PORTS[target.protocol] || 0;
  const ip = ipv4ToInt(hostname);
  for (const entry of parseNoProxy(value)) {
    if (entry.port && entry.port !== port) continue;
    if (entry.cidr) {
      if (ip === null) continue;
      const mask = entry.cidr.bits === 0 ? 0 : (0xffffffff << (32 - entry.cidr.bits)) >>> 0;
      if (((ip & mask) >>> 0) === ((entry.cidr.base & mask) >>> 0)) return true;
      continue;
    }
    if (entry.host === '*') return true;
    if (/^[.*]/.test(entry.host)) {
      const suffix = entry.host.replace(/^\*/, '');
      if (hostname.endsWith(suffix) || `.${hostname}` === suffix) return true;
    } else if (hostname === entry.host) {
      return true;
    }
  }
  return false;
}

/** The proxy to use for `target`, or null for a direct connection. */
export function proxyFor(target: URL | string, settings: ProxySettings): URL | null {
  const url = typeof target === 'string' ? new URL(target) : target;
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  const proxy = secure ? settings.https : settings.http;
  if (!proxy) return null;
  return bypassesProxy(url, settings.noProxy) ? null : proxy;
}

/** "http://proxy.example:3128" — never the user name or password. */
export function describeProxy(proxy: URL | null): string {
  if (!proxy) return 'direct';
  return `${proxy.protocol}//${proxy.host}`;
}

/* --------------------------------------------------------- certificates */

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Splits a PEM bundle into single certificates. */
export function splitPemBundle(text: string): string[] {
  return (text.match(PEM_CERT) ?? []).map((pem) => `${pem.trim()}\n`);
}

export interface ExtraCaResult {
  certificates: string[];
  /** Files that were read successfully. */
  files: string[];
  /** Files that were named but could not be read (path only). */
  failed: string[];
}

/** Certificates named by NODE_EXTRA_CA_CERTS and SSL_CERT_FILE (each a PEM file / bundle). */
export function loadExtraCaCertificates(env: Env, read: (file: string) => string = (file) => readFileSync(file, 'utf8')): ExtraCaResult {
  const files = [...new Set([env.NODE_EXTRA_CA_CERTS, env.SSL_CERT_FILE].map((f) => (f ?? '').trim()).filter((f) => f.length > 0))];
  const result: ExtraCaResult = { certificates: [], files: [], failed: [] };
  const seen = new Set<string>();
  for (const file of files) {
    try {
      const certs = splitPemBundle(read(file));
      if (certs.length === 0) {
        result.failed.push(file);
        continue;
      }
      result.files.push(file);
      for (const cert of certs) {
        if (seen.has(cert)) continue;
        seen.add(cert);
        result.certificates.push(cert);
      }
    } catch {
      result.failed.push(file);
    }
  }
  return result;
}

/* --------------------------------------------------- CONNECT tunnel agent */

export interface TunnelOptions {
  /** Trusted CAs for the target's certificate (and an https proxy's). Undefined = Node's default store. */
  ca?: string[];
  /** Time limit for the proxy's answer to CONNECT. */
  timeoutMs?: number;
}

function proxyAuthHeader(proxy: URL): Record<string, string> {
  if (!proxy.username && !proxy.password) return {};
  const user = decodeURIComponent(proxy.username);
  const pass = decodeURIComponent(proxy.password);
  return { 'proxy-authorization': `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

type ConnectionCallback = (error: Error | null, socket: Duplex) => void;

/**
 * An https.Agent whose sockets are TLS connections tunnelled through an HTTP
 * proxy with CONNECT. Used for the Realtime WebSocket (`ws` accepts `agent`).
 */
export class ConnectTunnelAgent extends https.Agent {
  constructor(
    private readonly proxy: URL,
    private readonly tunnel: TunnelOptions = {},
  ) {
    super({ keepAlive: false });
  }

  // Node's Agent accepts either a returned socket or one passed to the callback later.
  override createConnection(requestOptions: http.RequestOptions, callback?: ConnectionCallback): Duplex | null | undefined {
    const options = requestOptions as tls.ConnectionOptions & http.RequestOptions;
    const done = (error: Error | null, socket?: Duplex) => callback?.(error, socket as Duplex);
    const host = String(options.host ?? 'localhost').replace(/^\[|\]$/g, '');
    const port = Number(options.port) || 443;
    const authority = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    const viaTls = this.proxy.protocol === 'https:';
    const request = (viaTls ? https : http).request({
      host: this.proxy.hostname.replace(/^\[|\]$/g, ''),
      port: Number(this.proxy.port) || (viaTls ? 443 : 80),
      method: 'CONNECT',
      path: authority,
      headers: { host: authority, ...proxyAuthHeader(this.proxy) },
      agent: false,
      ...(viaTls && this.tunnel.ca ? { ca: this.tunnel.ca } : {}),
    });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      done(error);
    };
    const timer = setTimeout(() => {
      request.destroy();
      fail(new Error(`The proxy did not answer CONNECT within ${this.tunnel.timeoutMs ?? 10000} ms`));
    }, this.tunnel.timeoutMs ?? 10000);
    request.once('connect', (response, socket, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`Proxy CONNECT failed (${response.statusCode ?? 'no status'})`));
        return;
      }
      if (head && head.length > 0) socket.unshift(head);
      const servername = options.servername || (net.isIP(host) ? undefined : host);
      // The request options also carry the HTTP path; tls.connect must not mistake it for an IPC path.
      const { path: _path, socketPath: _socketPath, ...tlsOptions } = options as tls.ConnectionOptions & { socketPath?: string };
      const secure = tls.connect({
        ...tlsOptions,
        host,
        port,
        socket,
        servername,
        ...(this.tunnel.ca ? { ca: this.tunnel.ca } : {}),
      });
      if (settled) {
        secure.destroy();
        return;
      }
      settled = true;
      done(null, secure);
    });
    request.once('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    request.end();
    return undefined;
  }
}

/* ------------------------------------------------------ fetch dispatcher */

/** Sends each request either direct or through the proxy, by target host (NO_PROXY aware). */
export class ProxyRoutingDispatcher extends Dispatcher {
  private readonly direct: Agent;
  private readonly viaProxy = new Map<string, ProxyAgent>();

  constructor(
    private readonly settings: ProxySettings,
    private readonly ca?: string[],
  ) {
    super();
    this.direct = new Agent(ca ? { connect: { ca } } : {});
  }

  /** Which way a request to `origin` goes (exposed for tests and the start-up log). */
  route(origin: URL | string): 'direct' | URL {
    return proxyFor(origin, this.settings) ?? 'direct';
  }

  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
    const origin = new URL(String(options.origin));
    const proxy = proxyFor(origin, this.settings);
    if (!proxy) return this.direct.dispatch(options, handler);
    let agent = this.viaProxy.get(proxy.href);
    if (!agent) {
      agent = new ProxyAgent({
        uri: proxy.href,
        ...(this.ca ? { requestTls: { ca: this.ca }, proxyTls: { ca: this.ca } } : {}),
      });
      this.viaProxy.set(proxy.href, agent);
    }
    return agent.dispatch(options, handler);
  }

  private all(): Dispatcher[] {
    return [this.direct, ...this.viaProxy.values()];
  }

  // Dispatcher declares callback and promise overloads; one implementation serves both.
  override close(...args: unknown[]): any {
    const done = Promise.all(this.all().map((d) => d.close())).then(() => undefined);
    const callback = args.find((a): a is () => void => typeof a === 'function');
    if (callback) {
      void done.then(callback, callback);
      return undefined;
    }
    return done;
  }

  override destroy(...args: unknown[]): any {
    const error = args.find((a): a is Error => a instanceof Error) ?? null;
    const done = Promise.all(this.all().map((d) => d.destroy(error))).then(() => undefined);
    const callback = args.find((a): a is () => void => typeof a === 'function');
    if (callback) {
      void done.then(callback, callback);
      return undefined;
    }
    return done;
  }
}

/* ----------------------------------------------------------- installation */

export interface NetworkSetup {
  settings: ProxySettings;
  /** Extra CA certificates in use (empty when none were configured). */
  extraCa: ExtraCaResult;
  /** Options for `ws` (the Realtime socket) to reach `url`: a tunnel agent when a proxy applies. */
  wsOptionsFor(url: string): { agent?: https.Agent; ca?: string[] };
  /** One line for the start-up log; never contains proxy credentials. */
  describe(target: string): string;
}

export interface InstallOptions {
  /** Install the fetch dispatcher globally (default true; tests pass false). */
  installGlobal?: boolean;
  read?: (file: string) => string;
}

/**
 * Reads proxy and CA settings from `env` and wires them into fetch (global
 * undici dispatcher) and into the Realtime WebSocket options.
 */
export function setupNetwork(env: Env, options: InstallOptions = {}): NetworkSetup {
  const settings = resolveProxySettings(env);
  const extraCa = loadExtraCaCertificates(env, options.read);
  let ca: string[] | undefined;
  if (extraCa.certificates.length > 0) {
    // Node's own store plus the extra ones (the default store already holds NODE_EXTRA_CA_CERTS
    // when the variable was set before start; duplicates are harmless).
    const base = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : [...tls.rootCertificates];
    ca = [...new Set([...base, ...extraCa.certificates])];
    if (options.installGlobal !== false && typeof tls.setDefaultCACertificates === 'function') {
      try {
        tls.setDefaultCACertificates(ca);
      } catch {
        /* an unparsable certificate: the explicit `ca` options below still apply */
      }
    }
  }
  const needsDispatcher = settings.https !== null || settings.http !== null || ca !== undefined;
  if (options.installGlobal !== false && needsDispatcher) setGlobalDispatcher(new ProxyRoutingDispatcher(settings, ca));
  const agents = new Map<string, ConnectTunnelAgent>();
  return {
    settings,
    extraCa,
    wsOptionsFor(url: string) {
      const proxy = proxyFor(url, settings);
      if (!proxy) return ca ? { ca } : {};
      let agent = agents.get(proxy.href);
      if (!agent) {
        agent = new ConnectTunnelAgent(proxy, { ca });
        agents.set(proxy.href, agent);
      }
      return { agent };
    },
    describe(target: string) {
      const proxy = proxyFor(target, settings);
      const caNote = extraCa.files.length > 0 ? `; extra CA: ${extraCa.certificates.length} certificate(s)` : '';
      return `${new URL(target).host} via ${describeProxy(proxy)}${caNote}`;
    },
  };
}
