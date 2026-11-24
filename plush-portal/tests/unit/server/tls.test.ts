/**
 * HTTPS mode for phones: the self-signed certificate made with node:crypto
 * only, how it is stored and renewed, a real TLS handshake against it, and the
 * configuration switches.
 */
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../server/config';
import { certificateHosts, ensureTlsMaterial, generateSelfSignedCertificate, localHostNames } from '../../../server/tls';

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plush-tls-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('self-signed certificate', () => {
  it('is a valid ECDSA P-256 server certificate for the given names and addresses', () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const pem = generateSelfSignedCertificate({ hosts: ['localhost', '127.0.0.1', '::1', '192.168.1.20', 'kiosk.local'], now });
    const cert = new X509Certificate(pem.cert);
    expect(cert.verify(cert.publicKey)).toBe(true); // self-signed
    expect(cert.checkPrivateKey(createPrivateKey(pem.key))).toBe(true);
    expect(cert.publicKey.asymmetricKeyType).toBe('ec');
    expect(cert.ca).toBe(false);
    expect(cert.checkHost('localhost')).toBe('localhost');
    expect(cert.checkHost('kiosk.local')).toBe('kiosk.local');
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(cert.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(cert.checkIP('::1')).toBe('::1');
    expect(cert.checkHost('example.com')).toBeUndefined();
    expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']); // Node lists the extended key usage: serverAuth
    expect(certificateHosts(cert)).toEqual(['localhost', '127.0.0.1', '0:0:0:0:0:0:0:1', '192.168.1.20', 'kiosk.local']);
    const days = (new Date(cert.validTo).getTime() - now.getTime()) / 86_400_000;
    // Apple platforms refuse server certificates valid for more than 825 days.
    expect(days).toBeGreaterThan(390);
    expect(days).toBeLessThanOrEqual(825);
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(now.getTime());
  });

  it('lists localhost, loopback, the machine name and LAN IPv4 addresses (not internal ones)', () => {
    const hosts = localHostNames(
      {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
        wlan0: [
          { address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:01', cidr: '192.168.1.20/24' },
          { address: 'fe80::1', family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:01', cidr: 'fe80::1/64', scopeid: 3 },
        ],
      },
      'Kiosk-PC',
    );
    expect(hosts).toEqual(['localhost', '127.0.0.1', '::1', 'kiosk-pc', 'kiosk-pc.local', '192.168.1.20']);
  });

  it('serves a real TLS handshake that a client trusting it accepts', async () => {
    const pem = generateSelfSignedCertificate({ hosts: ['localhost', '127.0.0.1'] });
    const server: Server = createServer({ key: pem.key, cert: pem.cert }, (_req, res) => res.end('ok'));
    const port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
    try {
      const authorized = await new Promise<boolean>((resolve, reject) => {
        const socket = tls.connect({ host: '127.0.0.1', port, servername: 'localhost', ca: [pem.cert] }, () => {
          resolve(socket.authorized);
          socket.end();
        });
        socket.once('error', reject);
      });
      expect(authorized).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('certificate storage', () => {
  it('generates on first start, reuses it later, and renews when the LAN address changes or it expires', () => {
    const dir = path.join(tempDir(), 'tls');
    const now = new Date('2026-11-24T10:00:00Z');
    const first = ensureTlsMaterial({ dir, hosts: ['localhost', '127.0.0.1', '192.168.1.20'], now });
    expect(first.source).toBe('generated');
    expect(statSync(first.keyFile).mode & 0o777).toBe(0o600);
    expect(first.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const second = ensureTlsMaterial({ dir, hosts: ['localhost', '127.0.0.1', '192.168.1.20'], now });
    expect(second.source).toBe('stored');
    expect(second.fingerprint256).toBe(first.fingerprint256);
    // The kiosk got a new address from the router: the phone would see a name mismatch.
    const moved = ensureTlsMaterial({ dir, hosts: ['localhost', '127.0.0.1', '192.168.1.77'], now });
    expect(moved.source).toBe('generated');
    expect(moved.hosts).toContain('192.168.1.77');
    // Less than 30 days left: renewed.
    const later = ensureTlsMaterial({ dir, hosts: ['localhost', '127.0.0.1', '192.168.1.77'], now: new Date(now.getTime() + 380 * 86_400_000) });
    expect(later.source).toBe('generated');
  });

  it('uses the operator’s own PEM files when both are given', () => {
    const dir = tempDir();
    const pem = generateSelfSignedCertificate({ hosts: ['kiosk.example'] });
    writeFileSync(path.join(dir, 'c.pem'), pem.cert);
    writeFileSync(path.join(dir, 'k.pem'), pem.key);
    const material = ensureTlsMaterial({ dir: path.join(dir, 'unused'), certFile: path.join(dir, 'c.pem'), keyFile: path.join(dir, 'k.pem') });
    expect(material.source).toBe('user');
    expect(material.hosts).toEqual(['kiosk.example']);
    expect(() => ensureTlsMaterial({ dir, certFile: path.join(dir, 'c.pem') })).toThrow(/together/);
    writeFileSync(path.join(dir, 'bad.pem'), 'not a key');
    expect(() => ensureTlsMaterial({ dir, certFile: path.join(dir, 'c.pem'), keyFile: path.join(dir, 'bad.pem') })).toThrow();
  });
});

describe('configuration', () => {
  it('keeps HTTPS off by default and reads the HTTPS / key-management variables', () => {
    const d = loadConfig({});
    expect(d.https).toMatchObject({ enabled: false, port: 8443, host: '0.0.0.0', certFile: null, keyFile: null });
    expect(d.keyManagement).toBe('local');
    expect(d.keyCheck).toBe(true);
    expect(d.dataDir.endsWith(`${path.sep}.data`)).toBe(true);
    const c = loadConfig({
      PLUSH_HTTPS: '1',
      PLUSH_HTTPS_PORT: '9443',
      PLUSH_HTTPS_HOST: '192.168.1.20',
      PLUSH_TLS_CERT: 'certs/kiosk.crt',
      PLUSH_TLS_KEY: 'certs/kiosk.key',
      PLUSH_KEY_MANAGEMENT: 'token',
      PLUSH_ADMIN_TOKEN: 'admin-token-FOR-TESTS-123456',
      PLUSH_KEY_CHECK: 'false',
      PLUSH_DATA_DIR: '/tmp/plush-data',
    });
    expect(c.https.enabled).toBe(true);
    expect(c.https.port).toBe(9443);
    expect(c.https.host).toBe('192.168.1.20');
    expect(path.isAbsolute(c.https.certFile!)).toBe(true);
    expect(c.https.certFile!.endsWith(path.join('certs', 'kiosk.crt'))).toBe(true);
    expect(c.keyManagement).toBe('token');
    expect(c.keyCheck).toBe(false);
    expect(c.dataDir).toBe('/tmp/plush-data');
    expect(c.warnings).toEqual([]);
  });

  it('warns about half a TLS pair, an unknown management mode and token mode without a token', () => {
    const c = loadConfig({ PLUSH_TLS_CERT: 'a.pem', PLUSH_KEY_MANAGEMENT: 'everyone' });
    expect(c.https.certFile).toBeNull();
    expect(c.keyManagement).toBe('local');
    expect(c.warnings.join(' ')).toMatch(/PLUSH_TLS_CERT and PLUSH_TLS_KEY/);
    expect(c.warnings.join(' ')).toMatch(/PLUSH_KEY_MANAGEMENT/);
    expect(loadConfig({ PLUSH_KEY_MANAGEMENT: 'token' }).warnings.join(' ')).toMatch(/needs PLUSH_ADMIN_TOKEN/);
  });
});
