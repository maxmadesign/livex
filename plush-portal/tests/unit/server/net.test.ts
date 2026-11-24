/**
 * Outbound proxy and CA handling. Everything runs against local servers: a
 * small CONNECT proxy and an HTTPS / WSS server with a certificate generated
 * by server/tls.ts, trusted only through the explicit `ca` option.
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ConnectTunnelAgent,
  ProxyRoutingDispatcher,
  bypassesProxy,
  describeProxy,
  loadExtraCaCertificates,
  proxyFor,
  resolveProxySettings,
  setupNetwork,
  splitPemBundle,
} from '../../../server/net';
import { generateSelfSignedCertificate } from '../../../server/tls';

const u = (s: string) => new URL(s);

describe('proxy settings from the environment', () => {
  it('reads HTTPS_PROXY / HTTP_PROXY / NO_PROXY (lower case wins) and falls back to HTTP_PROXY for https', () => {
    expect(resolveProxySettings({})).toEqual({ https: null, http: null, noProxy: '' });
    const s = resolveProxySettings({ HTTPS_PROXY: 'http://proxy.example:3128', NO_PROXY: 'localhost' });
    expect(s.https?.href).toBe('http://proxy.example:3128/');
    expect(s.http).toBeNull();
    expect(s.noProxy).toBe('localhost');
    expect(resolveProxySettings({ HTTPS_PROXY: 'http://upper:1', https_proxy: 'http://lower:2' }).https?.host).toBe('lower:2');
    expect(resolveProxySettings({ HTTP_PROXY: 'http://only-http:8080' }).https?.host).toBe('only-http:8080');
    expect(resolveProxySettings({ HTTPS_PROXY: 'proxy.example:3128' }).https?.href).toBe('http://proxy.example:3128/');
    expect(resolveProxySettings({ HTTPS_PROXY: 'socks5://nope:1080' }).https).toBeNull();
  });

  it('matches NO_PROXY like undici (exact host, ".suffix", "*", host:port) plus IPv4 CIDR', () => {
    const list = 'localhost,127.0.0.0/8,::1,.internal.example,*.corp.example,registry.example:8443';
    expect(bypassesProxy(u('https://api.openai.com/v1'), list)).toBe(false);
    expect(bypassesProxy(u('http://localhost:8787'), list)).toBe(true);
    expect(bypassesProxy(u('http://127.4.5.6:80'), list)).toBe(true);
    expect(bypassesProxy(u('http://[::1]:8787'), list)).toBe(true);
    expect(bypassesProxy(u('https://a.internal.example'), list)).toBe(true);
    expect(bypassesProxy(u('https://internal.example'), list)).toBe(true);
    expect(bypassesProxy(u('https://x.y.corp.example'), list)).toBe(true);
    expect(bypassesProxy(u('https://registry.example:8443'), list)).toBe(true);
    expect(bypassesProxy(u('https://registry.example'), list)).toBe(false); // other port
    expect(bypassesProxy(u('https://notlocalhost.example'), list)).toBe(false);
    expect(bypassesProxy(u('https://anything.example'), '*')).toBe(true);
    expect(bypassesProxy(u('https://anything.example'), '')).toBe(false);
  });

  it('picks the proxy per scheme (wss uses the https proxy) and never prints credentials', () => {
    const settings = resolveProxySettings({ HTTPS_PROXY: 'http://user:s3cret@proxy.example:3128', HTTP_PROXY: 'http://plain.example:80', NO_PROXY: 'localhost,127.0.0.1' });
    expect(proxyFor('https://api.openai.com/v1', settings)?.host).toBe('proxy.example:3128');
    expect(proxyFor('wss://api.openai.com/v1/realtime?model=x', settings)?.host).toBe('proxy.example:3128');
    expect(proxyFor('http://example.org', settings)?.host).toBe('plain.example');
    expect(proxyFor('http://127.0.0.1:8787', settings)).toBeNull();
    expect(describeProxy(settings.https)).toBe('http://proxy.example:3128');
    expect(describeProxy(null)).toBe('direct');
    const network = setupNetwork({ HTTPS_PROXY: 'http://user:s3cret@proxy.example:3128' }, { installGlobal: false });
    const line = network.describe('https://api.openai.com/v1');
    expect(line).toBe('api.openai.com via http://proxy.example:3128');
    expect(line).not.toContain('s3cret');
    expect(network.wsOptionsFor('wss://api.openai.com/v1/realtime').agent).toBeInstanceOf(ConnectTunnelAgent);
    expect(setupNetwork({}, { installGlobal: false }).wsOptionsFor('wss://api.openai.com/v1/realtime')).toEqual({});
  });
});

describe('extra CA certificates', () => {
  const a = generateSelfSignedCertificate({ hosts: ['a.test'] }).cert;
  const b = generateSelfSignedCertificate({ hosts: ['b.test'] }).cert;

  it('splits bundles and reads NODE_EXTRA_CA_CERTS and SSL_CERT_FILE once each', () => {
    expect(splitPemBundle(`junk\n${a}\nmore junk\n${b}`)).toHaveLength(2);
    const files: Record<string, string> = { '/ca/extra.pem': `${a}${b}`, '/ca/ssl.pem': a, '/ca/empty.pem': 'nothing here' };
    const read = (file: string) => {
      if (!(file in files)) throw new Error('ENOENT');
      return files[file]!;
    };
    const both = loadExtraCaCertificates({ NODE_EXTRA_CA_CERTS: '/ca/extra.pem', SSL_CERT_FILE: '/ca/ssl.pem' }, read);
    expect(both.files).toEqual(['/ca/extra.pem', '/ca/ssl.pem']);
    expect(both.certificates).toHaveLength(2); // the duplicate in ssl.pem is dropped
    const same = loadExtraCaCertificates({ NODE_EXTRA_CA_CERTS: '/ca/ssl.pem', SSL_CERT_FILE: '/ca/ssl.pem' }, read);
    expect(same.files).toEqual(['/ca/ssl.pem']);
    const broken = loadExtraCaCertificates({ NODE_EXTRA_CA_CERTS: '/ca/missing.pem', SSL_CERT_FILE: '/ca/empty.pem' }, read);
    expect(broken).toEqual({ certificates: [], files: [], failed: ['/ca/missing.pem', '/ca/empty.pem'] });
    expect(loadExtraCaCertificates({}, read).certificates).toEqual([]);
  });
});

/* --------------------------------------------- live tunnel through a proxy */

const listen = (server: Server | HttpsServer) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

const pem = generateSelfSignedCertificate({ hosts: ['localhost', '127.0.0.1'] });
const proxy = { server: null as Server | null, port: 0, connects: [] as { target: string; auth: string }[], refuse: false, sockets: new Set<net.Socket>() };
const origin = { server: null as HttpsServer | null, port: 0, wss: null as WebSocketServer | null };

beforeAll(async () => {
  proxy.server = createHttpServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.server.on('connect', (req, client, head) => {
    proxy.sockets.add(client as net.Socket);
    proxy.connects.push({ target: req.url ?? '', auth: String(req.headers['proxy-authorization'] ?? '') });
    if (proxy.refuse) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(port), host === 'localhost' ? '127.0.0.1' : host, () => {
      proxy.sockets.add(upstream);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  proxy.port = await listen(proxy.server);

  origin.server = createHttpsServer({ key: pem.key, cert: pem.cert }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization ?? null }));
  });
  origin.wss = new WebSocketServer({ server: origin.server });
  origin.wss.on('connection', (socket, req) => {
    socket.on('message', (data) => socket.send(`echo:${data.toString()}:${req.url}`));
  });
  origin.port = await listen(origin.server);
});

afterAll(async () => {
  for (const socket of proxy.sockets) socket.destroy();
  origin.wss?.close();
  origin.server?.closeAllConnections();
  proxy.server?.closeAllConnections();
  await new Promise((r) => origin.server?.close(r));
  await new Promise((r) => proxy.server?.close(r));
});

describe('CONNECT tunnel for the Realtime WebSocket', () => {
  it('opens wss:// through the proxy with proxy auth and the extra CA', async () => {
    proxy.connects.length = 0;
    const proxyUrl = new URL(`http://tester:p%40ss@127.0.0.1:${proxy.port}`);
    const agent = new ConnectTunnelAgent(proxyUrl, { ca: [pem.cert] });
    const socket = new WebSocket(`wss://localhost:${origin.port}/v1/realtime?model=test-model`, { agent, headers: { authorization: 'Bearer sk-test-WS-0000000000' } });
    const reply = await new Promise<string>((resolve, reject) => {
      socket.once('open', () => socket.send('hello'));
      socket.once('message', (data) => resolve(data.toString()));
      socket.once('error', reject);
    });
    socket.close();
    expect(reply).toBe('echo:hello:/v1/realtime?model=test-model');
    expect(proxy.connects).toEqual([{ target: `localhost:${origin.port}`, auth: `Basic ${Buffer.from('tester:p@ss').toString('base64')}` }]);
  });

  it('fails cleanly when the proxy refuses the tunnel', async () => {
    proxy.refuse = true;
    try {
      const agent = new ConnectTunnelAgent(new URL(`http://127.0.0.1:${proxy.port}`), { ca: [pem.cert] });
      const socket = new WebSocket(`wss://localhost:${origin.port}/x`, { agent });
      const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
      expect(error.message).toMatch(/CONNECT failed \(403\)/);
    } finally {
      proxy.refuse = false;
    }
  });

  it('does not trust the local certificate without the extra CA', async () => {
    const agent = new ConnectTunnelAgent(new URL(`http://127.0.0.1:${proxy.port}`));
    const socket = new WebSocket(`wss://localhost:${origin.port}/x`, { agent });
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    expect(error.message).toMatch(/self-signed|certificate/i);
  });
});

describe('fetch dispatcher', () => {
  it('sends https requests through the proxy and NO_PROXY hosts direct', async () => {
    proxy.connects.length = 0;
    const via = new ProxyRoutingDispatcher(resolveProxySettings({ HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, NO_PROXY: '' }), [pem.cert]);
    expect(via.route(`https://localhost:${origin.port}/`)).not.toBe('direct');
    const response = await fetch(`https://localhost:${origin.port}/v1/models`, {
      headers: { authorization: 'Bearer sk-test-FETCH-0000000000' },
      // @ts-expect-error undici's non-standard option
      dispatcher: via,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: '/v1/models', auth: 'Bearer sk-test-FETCH-0000000000' });
    expect(proxy.connects.map((c) => c.target)).toEqual([`localhost:${origin.port}`]);
    await via.close();

    proxy.connects.length = 0;
    const direct = new ProxyRoutingDispatcher(resolveProxySettings({ HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, NO_PROXY: 'localhost' }), [pem.cert]);
    expect(direct.route(`https://localhost:${origin.port}/`)).toBe('direct');
    // @ts-expect-error undici's non-standard option
    const plain = await fetch(`https://localhost:${origin.port}/direct`, { dispatcher: direct });
    expect(plain.status).toBe(200);
    expect(proxy.connects).toEqual([]);
    await direct.destroy();
  });
});
