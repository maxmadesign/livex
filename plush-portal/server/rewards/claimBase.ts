/**
 * Which URL the QR code points to when the kiosk sends no claim URL template of its own.
 *
 *   PLUSH_CLAIM_PUBLIC_URL set and valid         → that URL                          reach "external"
 *   claim listener up and a LAN IPv4 address     → http://<lan address>:<claim port> reach "lan"
 *   claim listener up, no LAN address            → http://127.0.0.1:<claim port>     reach "loopback"
 *   no claim listener (PLUSH_CLAIM_LAN=off, port busy, not started yet)
 *                                                → http://127.0.0.1:<main port>      reach "loopback"
 *
 * "loopback" means a phone can NOT open the link; the kiosk shows that instead of a useless QR.
 */
import os from 'node:os';
import type { ClaimTarget } from './service';

export interface ClaimBaseInput {
  /** Validated PLUSH_CLAIM_PUBLIC_URL, or null. */
  publicUrl: string | null;
  /** Port the claim listener really listens on, or null when it is not running. */
  listenerPort: number | null;
  /** First usable LAN IPv4 address of this machine, or null. */
  lanAddress: string | null;
  /** Port of the main server (it serves /c/* as well). */
  mainPort: number;
}

export function selectClaimBase(input: ClaimBaseInput): ClaimTarget {
  if (input.publicUrl) return { base: input.publicUrl.replace(/\/+$/, ''), reach: 'external' };
  if (input.listenerPort !== null) {
    if (input.lanAddress) return { base: `http://${input.lanAddress}:${input.listenerPort}`, reach: 'lan' };
    return { base: `http://127.0.0.1:${input.listenerPort}`, reach: 'loopback' };
  }
  return { base: `http://127.0.0.1:${input.mainPort}`, reach: 'loopback' };
}

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/**
 * The first non-internal IPv4 address in the order the OS lists the interfaces. Link-local
 * 169.254.x.x addresses (no DHCP answer) are skipped: no phone could reach them.
 */
export function firstLanIPv4(interfaces: Interfaces = os.networkInterfaces()): string | null {
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.internal) continue;
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue;
      if (info.address.startsWith('169.254.')) continue;
      return info.address;
    }
  }
  return null;
}
