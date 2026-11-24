/**
 * What the guide may do with facts.brand and facts.reward. Pure (no DOM, no Vite env): shared by
 * the local line bank, the GuideDirector and the API proxy, so all three agree.
 *
 * facts.brand only unlocks a kit's names when they are exactly that kit's names and the kit dresses
 * the theme of the event. Anything else (an old client, a hand-made request) leaves Momo generic,
 * so a request can not make her name an arbitrary company.
 */
import { BRAND_KITS, type BrandKit } from '../brand/kits';
import type { GuideEventType, GuideFacts } from '../core/contracts';
import type { Lang, ThemeId } from '../core/types';
import { BRAND_POOL_IDS, type BrandPoolId } from './lines/types';

export type BrandFacts = { event: string; host: string };

/** The names-allowed kit that dresses `theme` and whose names `brand` carries, or null. */
export function namedKitFor(theme: ThemeId, brand: GuideFacts['brand']): BrandKit | null {
  if (!brand || typeof brand.event !== 'string' || typeof brand.host !== 'string' || !brand.event) return null;
  for (const kit of Object.values(BRAND_KITS)) {
    if (kit.namesAllowed && kit.theme === theme && kit.eventName === brand.event && kit.hostName === brand.host) return kit;
  }
  return null;
}

/** facts.brand when it may be used for this theme (see namedKitFor), else null. */
export function usableBrand(theme: ThemeId, brand: GuideFacts['brand']): BrandFacts | null {
  const kit = namedKitFor(theme, brand);
  return kit ? { event: kit.eventName, host: kit.hostName } : null;
}

/** Pool id of the kit behind facts.brand, or null (theme / generic pools only). */
export function brandPoolFor(theme: ThemeId, brand: GuideFacts['brand']): BrandPoolId | null {
  const kit = namedKitFor(theme, brand);
  return kit && (BRAND_POOL_IDS as readonly string[]).includes(kit.id) ? (kit.id as BrandPoolId) : null;
}

/**
 * Events on which Momo may talk about the claim QR: the win itself, and the retry prompt that
 * follows while the card is still up. Everywhere else facts.reward is ignored.
 */
export const REWARD_EVENTS: readonly GuideEventType[] = ['prize_won', 'retry_prompt'];

/** The QR facts that apply to this event, or null (say nothing about a QR). */
export function rewardFor(type: GuideEventType, facts: Pick<GuideFacts, 'demo' | 'reward'>): NonNullable<GuideFacts['reward']> | null {
  const reward = facts.reward;
  if (!reward || reward.qr !== true || facts.demo || !REWARD_EVENTS.includes(type)) return null;
  return reward;
}

/** Words a line uses when it talks about the claim QR code. */
const QR_WORDS: Record<Lang, RegExp> = {
  en: /\bQR\b|\bscan/i,
  zh: /QR|二维码|扫/i,
  ja: /QR|スキャン|読み取/i,
};

/** True when `text` talks about scanning a QR code. */
export function mentionsQr(text: string, lang: Lang): boolean {
  return QR_WORDS[lang].test(text);
}

/**
 * Model lines are checked against the QR facts: a reward event must invite the player to scan
 * (that is the point of the line at the booth), and no other line may talk about a QR that is not
 * on screen. A line that fails is replaced by a local one, which follows the facts exactly.
 */
export function qrMentionFits(text: string, lang: Lang, type: GuideEventType, facts: Pick<GuideFacts, 'demo' | 'reward'>): boolean {
  return mentionsQr(text, lang) === (rewardFor(type, facts) !== null);
}
