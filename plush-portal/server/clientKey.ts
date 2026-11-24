/**
 * Which client a request counts against in the rate limits (the AI routes, prize claims, staff
 * sign-in). Shared by the main server and the LAN claim listener.
 *
 *  - The socket address, or with PLUSH_TRUST_PROXY the LAST X-Forwarded-For entry: the address
 *    the proxy right in front of this server saw. Entries further left were sent by the client
 *    itself and can be anything, so they never pick a bucket.
 *  - IPv6 addresses count by their /64 network: one phone may use any address of its /64, so a
 *    per-address bucket would not limit anything. IPv4-mapped addresses count as the IPv4 address.
 */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { forwardedAddresses } from './keys';

/** The eight 16-bit groups of an IPv6 address (zone and embedded IPv4 allowed), or null. */
export function ipv6Groups(input: string): number[] | null {
  let text = input.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((part) => part > 255)) return null;
    text = `${text.slice(0, v4.index)}${((n[0]! << 8) | n[1]!).toString(16)}:${((n[2]! << 8) | n[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/** Rate-limit key of one address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by /64. */
export function addressKey(raw: string): string {
  const address = raw.trim();
  if (!address.includes(':')) return address.slice(0, 64) || 'unknown';
  const groups = ipv6Groups(address);
  if (!groups) return address.slice(0, 64);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/** The rate-limit key function for a server (see the file comment). */
export function makeClientKey(trustProxy: boolean): (c: Context) => string {
  return (c) => {
    if (trustProxy) {
      const forwarded = forwardedAddresses([c.req.header('x-forwarded-for')]);
      const last = forwarded[forwarded.length - 1];
      if (last) return addressKey(last);
    }
    try {
      return addressKey(getConnInfo(c).remote.address ?? 'unknown');
    } catch {
      return 'unknown'; // no socket (in-process tests)
    }
  };
}
