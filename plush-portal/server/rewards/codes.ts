/**
 * Claim codes: REWARD_LIMITS.codeLength characters from CODE_ALPHABET (Crockford base32), drawn
 * from the operating system's CSPRNG. 32 symbols divide 256 evenly, so masking a random byte to
 * five bits keeps every symbol equally likely (40 bits per code).
 */
import { randomBytes } from 'node:crypto';
import { CODE_ALPHABET, REWARD_LIMITS } from '../../src/rewards/protocol';

/** Source of random bytes (tests inject a scripted one to force collisions). */
export type RandomBytes = (size: number) => Uint8Array;

export function generateCode(random: RandomBytes = randomBytes): string {
  const bytes = random(REWARD_LIMITS.codeLength);
  let code = '';
  for (let i = 0; i < REWARD_LIMITS.codeLength; i++) code += CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  return code;
}

/** A code no record uses yet; null when `taken` kept answering yes (a broken random source). */
export function uniqueCode(taken: (code: string) => boolean, random: RandomBytes = randomBytes, attempts = 16): string | null {
  for (let i = 0; i < attempts; i++) {
    const code = generateCode(random);
    if (!taken(code)) return code;
  }
  return null;
}
