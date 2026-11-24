/**
 * TLS material for the opt-in HTTPS mode (phones on the LAN: browsers only
 * allow the camera on HTTPS pages or on localhost).
 *
 * Either the operator supplies a certificate (PLUSH_TLS_CERT / PLUSH_TLS_KEY,
 * PEM files) or a self-signed one is generated on first start and kept in
 * `<data dir>/tls/`. Generation uses only node:crypto (ECDSA P-256, X.509 v3
 * encoded by hand below), so no OpenSSL binary is needed. The certificate is
 * renewed when it is about to expire or no longer names this machine's current
 * LAN addresses. Browsers show a warning for a self-signed certificate; the
 * steps for phones are in docs/AI.md.
 */
import { X509Certificate, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------- DER encoding */

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const seq = (...items: Buffer[]) => tlv(0x30, ...items);
const set = (...items: Buffer[]) => tlv(0x31, ...items);
const octets = (value: Buffer) => tlv(0x04, value);
const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, 'utf8'));
const bool = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const bitString = (value: Buffer, unusedBits = 0) => tlv(0x03, Buffer.from([unusedBits]), value);

function integer(value: Buffer): Buffer {
  let bytes = value;
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1]! & 0x80) === 0) bytes = bytes.subarray(1);
  if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

function oid(dotted: string): Buffer {
  const arcs = dotted.split('.').map(Number);
  const out: number[] = [40 * arcs[0]! + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    let n = Math.floor(arc / 128);
    while (n > 0) {
      chunk.unshift((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date: Date): Buffer {
  const iso = date.toISOString(); // 2026-11-24T10:00:00.000Z
  const compact = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  // UTCTime up to 2049, GeneralizedTime after (RFC 5280 §4.1.2.5).
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(compact.slice(2), 'ascii')) : tlv(0x18, Buffer.from(compact, 'ascii'));
}

function ipBytes(address: string): Buffer | null {
  if (net.isIPv4(address)) return Buffer.from(address.split('.').map(Number));
  if (!net.isIPv6(address)) return null;
  const [head, tail] = address.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4) is not needed for our SANs.
  if ([...left, ...right].some((group) => group.includes('.'))) return null;
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...(tail !== undefined ? new Array<string>(missing).fill('0') : []), ...right];
  if (groups.length !== 8) return null;
  const out = Buffer.alloc(16);
  groups.forEach((group, i) => out.writeUInt16BE(Number.parseInt(group || '0', 16), i * 2));
  return out;
}

/* --------------------------------------------------------- generation */

const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const extension = (id: string, critical: boolean, value: Buffer) =>
  critical ? seq(oid(id), bool(true), octets(value)) : seq(oid(id), octets(value));

export interface CertificateRequest {
  /** DNS names and IP addresses the certificate is valid for. */
  hosts: string[];
  commonName?: string;
  /** Validity in days (Apple platforms refuse server certificates valid for more than 825 days). */
  days?: number;
  now?: Date;
}

export interface Pem {
  key: string;
  cert: string;
}

function toPem(label: string, der: Buffer): string {
  const body = der.toString('base64').replace(/.{1,64}/g, '$&\n');
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}

/** A self-signed X.509 v3 server certificate (ECDSA P-256 / SHA-256) for `hosts`. */
export function generateSelfSignedCertificate(request: CertificateRequest): Pem {
  const now = request.now ?? new Date();
  const days = Math.min(825, Math.max(1, request.days ?? 397));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  // The key bits are the BIT STRING at the end of the SubjectPublicKeyInfo (65 bytes for P-256).
  const keyBits = spki.subarray(spki.length - 65);

  const names: Buffer[] = [];
  for (const host of [...new Set(request.hosts.map((h) => h.trim()).filter(Boolean))]) {
    const ip = ipBytes(host);
    if (ip) names.push(tlv(0x87, ip));
    else if (/^[A-Za-z0-9.*-]+$/.test(host)) names.push(tlv(0x82, Buffer.from(host.toLowerCase(), 'ascii')));
  }
  const commonName = request.commonName ?? 'PLUSH PORTAL local server';
  const subject = seq(set(seq(oid(OID.organization), utf8('PLUSH PORTAL'))), set(seq(oid(OID.commonName), utf8(commonName))));
  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000); // tolerate clocks that are a little behind
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const algorithm = seq(oid(OID.ecdsaWithSha256));

  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), // version v3
    integer(serial),
    algorithm,
    subject, // issuer = subject (self-signed)
    seq(time(notBefore), time(notAfter)),
    subject,
    spki,
    tlv(
      0xa3,
      seq(
        extension(OID.basicConstraints, true, seq()),
        extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)), // digitalSignature
        extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
        extension(OID.subjectKeyIdentifier, false, octets(createHash('sha1').update(keyBits).digest())),
        extension(OID.subjectAltName, false, seq(...names)),
      ),
    ),
  );
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const certificate = seq(tbs, algorithm, bitString(signature));
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: toPem('CERTIFICATE', certificate),
  };
}

/* -------------------------------------------------------------- hosts */

/** localhost, the loopback addresses, this machine's name and its current LAN IPv4 addresses. */
export function localHostNames(interfaces = os.networkInterfaces(), hostname = os.hostname()): string[] {
  const hosts = ['localhost', '127.0.0.1', '::1'];
  const name = hostname.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(name)) {
    hosts.push(name);
    if (!name.includes('.')) hosts.push(`${name}.local`);
  }
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.internal) continue;
      if (info.family === 'IPv4' || (info.family as unknown) === 4) hosts.push(info.address);
    }
  }
  return [...new Set(hosts)];
}

/** The DNS names / IP addresses a PEM certificate names in its subjectAltName. */
export function certificateHosts(cert: X509Certificate): string[] {
  const san = cert.subjectAltName ?? '';
  return san
    .split(/,\s*/)
    .map((entry) => entry.replace(/^(DNS|IP Address):/, '').trim().toLowerCase())
    .filter(Boolean);
}

/* ------------------------------------------------------------ loading */

export interface TlsMaterial extends Pem {
  source: 'user' | 'stored' | 'generated';
  hosts: string[];
  /** SHA-256 fingerprint (colon separated), to compare with what the phone shows. */
  fingerprint256: string;
  validTo: string;
  certFile: string;
  keyFile: string;
}

export interface TlsOptions {
  /** Folder for generated material (`<data dir>/tls`). */
  dir: string;
  /** User supplied PEM files; both or neither. */
  certFile?: string | null;
  keyFile?: string | null;
  hosts?: string[];
  now?: Date;
}

const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

function describe(pem: Pem, source: TlsMaterial['source'], certFile: string, keyFile: string): TlsMaterial {
  const cert = new X509Certificate(pem.cert);
  return { ...pem, source, hosts: certificateHosts(cert), fingerprint256: cert.fingerprint256, validTo: cert.validTo, certFile, keyFile };
}

/**
 * Returns the certificate and key for the HTTPS listener: the user's files
 * when configured, otherwise the stored self-signed pair, regenerated when it
 * is missing, unreadable, expiring within 30 days or missing one of `hosts`.
 */
export function ensureTlsMaterial(options: TlsOptions): TlsMaterial {
  if (options.certFile || options.keyFile) {
    if (!options.certFile || !options.keyFile) throw new Error('PLUSH_TLS_CERT and PLUSH_TLS_KEY must be set together.');
    const pem = { cert: readFileSync(options.certFile, 'utf8'), key: readFileSync(options.keyFile, 'utf8') };
    // Fail at start, not on the first phone connection.
    createPrivateKey(pem.key);
    return describe(pem, 'user', options.certFile, options.keyFile);
  }
  const hosts = options.hosts ?? localHostNames();
  const now = options.now ?? new Date();
  const certFile = path.join(options.dir, 'cert.pem');
  const keyFile = path.join(options.dir, 'key.pem');
  if (existsSync(certFile) && existsSync(keyFile)) {
    try {
      const pem = { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') };
      const cert = new X509Certificate(pem.cert);
      const keyMatches = cert.checkPrivateKey(createPrivateKey(pem.key));
      const fresh = new Date(cert.validTo).getTime() - now.getTime() > RENEW_BEFORE_MS && new Date(cert.validFrom).getTime() <= now.getTime();
      const named = new Set(certificateHosts(cert));
      const covers = hosts.every((host) => named.has(host.toLowerCase()) || named.has(ipBytes(host) ? expandIp(host) : host.toLowerCase()));
      if (keyMatches && fresh && covers) return describe(pem, 'stored', certFile, keyFile);
    } catch {
      /* unreadable: generate a new pair below */
    }
  }
  const pem = generateSelfSignedCertificate({ hosts, now });
  mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  writeFileSync(certFile, pem.cert, { encoding: 'utf8', mode: 0o644 });
  writeFileSync(keyFile, pem.key, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(keyFile, 0o600);
  } catch {
    /* not supported on this file system */
  }
  return describe(pem, 'generated', certFile, keyFile);
}

/** Node prints IPv6 SAN entries fully expanded in upper case groups; compare in that form. */
function expandIp(address: string): string {
  const bytes = ipBytes(address);
  if (!bytes || bytes.length === 4) return address;
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16).toUpperCase());
  return groups.join(':').toLowerCase();
}

/** Public key of a PEM certificate (tests). */
export function publicKeyOf(certPem: string) {
  return createPublicKey(new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'pem' }));
}
