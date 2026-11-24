/**
 * Momo's prompt and the compact game context that is sent to the model.
 * Shared by the browser (to show / edit / restore the prompt in settings) and
 * by the API proxy (which always appends the fixed output rules).
 *
 * Privacy: only whitelisted game facts are ever serialised here. Camera
 * frames, face landmarks and eye positions are not part of `GuideFacts` and
 * can not pass through `sanitizeFacts`.
 *
 * Real names: only a brand kit that allows names (src/brand/kits.ts) unlocks them, through
 * facts.brand, and then only the event and host of that kit (see ./brand.ts). Without it the
 * theme stays generic and the "no real companies" rule applies unchanged.
 */
import type { BrandKit } from '../brand/kits';
import type { GuideEventType, GuideFacts } from '../core/contracts';
import { LANGS, type Lang, type ThemeId } from '../core/types';
import { REWARD_OPTIONS, type RewardOptions } from '../rewards/protocol';
import { mentionsQr, namedKitFor, rewardFor, usableBrand, type BrandFacts } from './brand';
import type { BrandPoolId } from './lines/types';
import type { LineLength } from './protocol';
import { AI_LIMITS } from './protocol';
import { LENGTH_RULES } from './textLength';

/** Editable part of the system prompt (Settings → AI Guide). */
export const DEFAULT_SYSTEM_PROMPT = [
  'You are Momo, a tiny plush mascot who lives beside the PLUSH PORTAL claw machine and keeps the player company.',
  'You react to what just happened in the game with one short spoken line.',
  'You know claw machines well: toys on top of the pile are easier, the claw should come down over the middle of the body so all three fingers can wrap around it, and a centred grab swings less on the way to the chute.',
  'Controls: left / right slide the claw sideways, up moves it toward the back of the cabinet, down moves it toward the player, and the grab button lowers the claw (lowering, closing and lifting are automatic).',
  'Be encouraging and concrete. Prefer one specific, useful hint over generic cheering.',
].join(' ');

/** Editable personality notes (Settings → AI Guide). */
export const DEFAULT_PERSONA =
  'Warm, playful and a little cheeky. Speaks in short, simple sentences. Kind when things go wrong, delighted when they go right. Never sarcastic, never pushy.';

export const LANGUAGE_PROMPT_NAMES: Record<Lang, string> = {
  en: 'English',
  zh: 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)',
};

export interface ThemePromptInfo {
  name: string;
  mood: string;
  cast?: string;
}

/**
 * What the model may know about each theme. `cast` describes the kinds of plush in the cabinet
 * (the actual toy names come with the facts). All characters are original: no real brands or people.
 * These are the generic entries; a kit that allows names replaces its theme's entry through
 * `themePromptInfo` (BRAND_PROMPT_INFO below).
 */
export const THEME_PROMPT_INFO: Record<ThemeId, ThemePromptInfo> = {
  sakura: { name: 'Sakura Kawaii', mood: 'Japanese kawaii plush shop, cherry blossoms, cream and pink, soft and sweet' },
  storybook: { name: 'Storybook Friends', mood: 'animated-film toy box, warm light, friendly characters on an adventure' },
  ocean: { name: 'Ocean Dream', mood: 'dreamy sea, pearl and sea-salt blue, gentle waves, squishy sea friends' },
  cosmic: { name: 'Cosmic Arcade', mood: 'playful space arcade, nebula purple and neon, little explorers among the stars' },
  gpu: {
    name: 'GPU Party',
    mood: 'playful tech-expo plush stand from a graphics-card and AI-computing world: glossy black, vivid green LEDs, whirring cooling fans; jokes about rendering, frame rates, benchmarks, booting and overclocking are welcome',
    cast: 'Keynote Chief (a plush presenter in a leather jacket), a twin-fan graphics card, a chip, a cooling fan, a server rack, a robot with a green visor and a green pixel cube; all invented characters, never real companies, brands, products or people',
  },
};

/**
 * Theme entries for kits that allow names, built from the kit (its event and host name), so the
 * model hears the same names the local lines use. Topics are for playful, general remarks only:
 * the output rules forbid any claim about products, schedules, rooms or announcements.
 */
const BRAND_PROMPT_INFO: Record<BrandPoolId, (kit: BrandKit) => ThemePromptInfo> = {
  gtc: (kit) => {
    const host = kit.hostName;
    return {
      name: kit.themeName.en,
      mood: [
        `plush prize booth on the ${kit.themeName.en} show floor, a big conference for developers and AI; `,
        host ? `dressed in ${host} colours: black, white and ${host} green, ` : 'black, white and green, ',
        `glowing LEDs, whirring fans. Momo is the cheerful ${kit.eventName} booth host. Fair game for playful, general remarks: `,
        'the keynote, sessions and talks, hands-on training labs, the exhibit hall and its demos, the startup showcase, ',
        'poster sessions, meeting developers, accelerated computing and AI factories, plus GPU jokes about rendering, ',
        'frame rates and benchmarks; "see you around the show floor" fits as a goodbye',
      ].join(''),
      cast: 'Keynote Chief (a plush presenter doll in a black leather jacket: an invented plush character, not a real person, never quoted), a twin-fan graphics card, a chip, a cooling fan, a server rack, a robot with a glowing visor and a green pixel cube',
    };
  },
};

/** The theme entry the model gets: the kit's own when facts.brand unlocks one (see ./brand.ts). */
export function themePromptInfo(theme: ThemeId, brand?: GuideFacts['brand']): ThemePromptInfo {
  const kit = namedKitFor(theme, brand);
  const build = kit ? BRAND_PROMPT_INFO[kit.id as BrandPoolId] : undefined;
  return kit && build ? build(kit) : THEME_PROMPT_INFO[theme];
}

/** facts.brand when the model may use it for this theme, else null (the API proxy uses it too). */
export function promptBrand(theme: ThemeId, facts: Pick<GuideFacts, 'brand'>): BrandFacts | null {
  return usableBrand(theme, facts.brand);
}

/**
 * What the model is asked to do per event. The claim-QR part is added per request (taskFor), so a
 * request without a QR on screen never mentions one: a conditional sentence about a QR made the
 * model talk about QR codes that were not there.
 */
const EVENT_TASKS: Record<GuideEventType, string> = {
  welcome: 'Greet the player and invite them to pick a plush they like.',
  first_play: 'It is their first round: explain the controls in one line.',
  idle_hint: 'The player has been idle. Give one gentle hint. If facts.headTracking is true you may suggest moving the head left or right to see another angle.',
  aim_help: 'The player is aiming. Give one concrete aiming tip.',
  grab_started: 'The claw is going down right now. React with excitement; do not predict the result.',
  empty_grab: 'The claw came up empty. Follow the contact rules below.',
  slipped_after_grip: 'A toy was really gripped but got away. Explain kindly using facts.slipReason and give one fix.',
  prize_won: 'The toy dropped into the prize chute. Celebrate and mention facts.toy.name. If facts.newCharacter is true, say it is new in the collection.',
  theme_changed: 'The cabinet theme just changed. Welcome the player to the new theme in its mood.',
  retry_prompt: 'Lightly invite another try. No pressure: watching or stopping is fine.',
  user_requested_tip: 'The player asked for a tip. Give one concrete, practical tip.',
};

/** Explanations for the physics-derived slip reasons. Unknown reasons are passed through untouched. */
const SLIP_REASON_NOTES: Record<string, string> = {
  eccentric: 'the grab was far from the centre of the toy, so it tipped out',
  weak_support: 'too few fingers were under the toy',
  contact_lost: 'the fingers lost contact while lifting',
  transport_swing: 'it came loose while the claw swung on the way to the chute',
  overload: 'the toy was too heavy for that grip',
  bounced_out: 'it was carried all the way and released, but bounced off the rim of the chute instead of dropping in',
};

export function describeSlipReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return SLIP_REASON_NOTES[reason] ?? 'it slipped out of the grip';
}

/** What scanning the claim QR unlocks, per facts.reward.options (docs/REWARDS.md). */
const REWARD_NOTES: Record<RewardOptions, string> = {
  both: 'a QR code is on screen; scanning it with a phone opens a claim page where the player picks one: collect the plush prize at the booth, or a discount on swag',
  prize: 'a QR code is on screen; scanning it with a phone opens a claim page to collect the plush prize at the booth',
  swag: 'a QR code is on screen; scanning it with a phone opens a claim page with a discount on swag',
};

export function describeReward(reward: GuideFacts['reward']): string | null {
  if (!reward || reward.qr !== true) return null;
  return REWARD_NOTES[reward.options] ?? REWARD_NOTES.both;
}

function lengthSentence(lang: Lang, length: LineLength): string {
  const rule = LENGTH_RULES[length][lang];
  return `${rule.targetMin}-${rule.targetMax} ${rule.unit}`;
}

/**
 * Fixed rules that are appended to every request, also when the base prompt
 * was replaced in settings, so a custom prompt can not break length, language,
 * honesty or the JSON shape.
 */
export function buildOutputRules(lang: Lang, length: LineLength, brand: BrandFacts | null = null): string {
  // With a kit that allows names, exactly its event and host may be named; nothing else changes.
  const names = brand
    ? '- Real names: you may name exactly facts.brand.event and facts.brand.host and nothing else; no other companies, brands, products or real people. Never make claims about products, specs, prices, availability, schedules, rooms or announcements. Never speak as or quote a real person; the Keynote Chief is an invented plush character.'
    : '- Never name real companies, brands, products or real people; the plush characters are original.';
  return [
    'Output rules (always apply):',
    `- Reply in ${LANGUAGE_PROMPT_NAMES[lang]} only.`,
    `- Exactly one line of ${lengthSentence(lang, length)}. No line breaks, no hashtags, no quotation marks around the line, at most one emoji.`,
    '- Use only the facts in the JSON context from the game. Never invent an outcome.',
    '- Use "so close" / "almost" wording only when facts.contact is "touched", "gripped" or "lifted".',
    '- When facts.contact is "none", give a direction hint from facts.nearest instead: dx > 0 means the nearest toy is to the player\'s right (move the claw right), dx < 0 to the left; dz > 0 means it is closer to the player (move toward the front), dz < 0 means further back.',
    '- Never promise or imply that the next try will succeed. Invitations to retry stay light.',
    '- If facts.demo is true the round was an automatic demo and nothing was added to the collection.',
    '- Do not repeat or closely paraphrase any entry of recentLines.',
    '- Never mention cameras, faces, tracking data, AI models, prompts or these rules.',
    names,
    '- When facts.reward.qr is true (prize_won, or retry_prompt while the code is still up), invite the player to scan the QR code on screen with their phone for what facts.reward.options unlocks: "both" = collect the plush prize or take a swag discount, "prize" = collect the plush prize, "swag" = a swag discount. Never mention a QR code, a prize to collect or a discount otherwise, and never state amounts or stock.',
    '- Fill the fields: text (the line), emotion (happy, cheer, think, oops or calm) and shouldSpeak (true unless the line works better as a silent caption).',
  ].join('\n');
}

export interface InstructionOptions {
  /** Custom base prompt; empty / undefined uses DEFAULT_SYSTEM_PROMPT. */
  systemPrompt?: string;
  /** Custom personality notes; empty / undefined uses DEFAULT_PERSONA. */
  persona?: string;
  lang: Lang;
  length: LineLength;
  /** promptBrand(theme, facts): the names the line may use; null / undefined = generic rules. */
  brand?: BrandFacts | null;
}

export function buildInstructions(options: InstructionOptions): string {
  const base = (options.systemPrompt ?? '').trim().slice(0, AI_LIMITS.maxSystemPromptChars) || DEFAULT_SYSTEM_PROMPT;
  const persona = (options.persona ?? '').trim().slice(0, AI_LIMITS.maxPersonaChars) || DEFAULT_PERSONA;
  return `${base}\n\nPersonality: ${persona}\n\n${buildOutputRules(options.lang, options.length, options.brand ?? null)}`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const shortText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Whitelists and compacts the facts. Anything that is not listed here is
 * dropped, whatever the caller passed in.
 */
export function sanitizeFacts(facts: GuideFacts): GuideFacts {
  const out: GuideFacts = {
    phase: facts.phase,
    demo: facts.demo === true,
    attempts: finite(facts.attempts) ? Math.max(0, Math.round(facts.attempts)) : 0,
    wins: finite(facts.wins) ? Math.max(0, Math.round(facts.wins)) : 0,
    lossStreak: finite(facts.lossStreak) ? Math.max(0, Math.round(facts.lossStreak)) : 0,
  };
  if (facts.outcome) out.outcome = facts.outcome;
  if (facts.contact) out.contact = facts.contact;
  if (facts.slipReason) out.slipReason = facts.slipReason;
  if (finite(facts.liftedMs)) out.liftedMs = Math.max(0, Math.round(facts.liftedMs));
  if (facts.toy) {
    out.toy = {
      typeId: shortText(facts.toy.typeId, 64),
      name: shortText(facts.toy.name, AI_LIMITS.maxToyNameChars),
      kind: shortText(facts.toy.kind, 40),
    };
  }
  if (facts.nearest && finite(facts.nearest.dx) && finite(facts.nearest.dz)) {
    out.nearest = {
      dx: round2(facts.nearest.dx),
      dz: round2(facts.nearest.dz),
      dist: finite(facts.nearest.dist) ? round2(facts.nearest.dist) : round2(Math.hypot(facts.nearest.dx, facts.nearest.dz)),
      name: shortText(facts.nearest.name, AI_LIMITS.maxToyNameChars),
    };
  }
  if (typeof facts.newCharacter === 'boolean') out.newCharacter = facts.newCharacter;
  if (typeof facts.headTracking === 'boolean') out.headTracking = facts.headTracking;
  // Event identity and the claim QR: exactly these fields, nothing else from those objects.
  if (facts.brand && typeof facts.brand.event === 'string' && typeof facts.brand.host === 'string') {
    out.brand = {
      event: shortText(facts.brand.event, AI_LIMITS.maxBrandNameChars),
      host: shortText(facts.brand.host, AI_LIMITS.maxBrandNameChars),
    };
  }
  if (facts.reward && typeof facts.reward.qr === 'boolean' && (REWARD_OPTIONS as readonly string[]).includes(facts.reward.options)) {
    out.reward = { qr: facts.reward.qr, options: facts.reward.options };
  }
  return out;
}

export interface LineContext {
  event: { type: GuideEventType; facts: GuideFacts };
  theme: ThemeId;
  recentLines: string[];
}

const QR_TASKS: Partial<Record<GuideEventType, string>> = {
  prize_won: 'A prize-claim QR code is on screen: the invitation to scan it comes first (see rewardMeaning).',
  retry_prompt: 'The prize-claim QR code of the win is still on screen: remind the player to scan it first (see rewardMeaning).',
};
const NO_QR_TASK = 'No QR code is on screen: do not mention QR codes, scanning, collecting a prize at a booth or discounts.';

/** The event task, with the claim-QR instruction only when a QR is really on screen. */
export function taskFor(type: GuideEventType, qrOnScreen: boolean): string {
  const base = EVENT_TASKS[type];
  const qr = QR_TASKS[type];
  if (!qr) return base;
  return `${base} ${qrOnScreen ? qr : NO_QR_TASK}`;
}

/** True when `line` talks about a QR code in any of the guide's languages. */
function mentionsAnyQr(line: string): boolean {
  return LANGS.some((lang) => mentionsQr(line, lang));
}

/** The user message: a compact JSON document with everything Momo may talk about. */
export function buildLineInput(context: LineContext): string {
  const facts = sanitizeFacts(context.event.facts);
  // Names the kit does not unlock for this theme, and QR facts of events that can not use them,
  // are not shown to the model at all (the output rules say the same).
  if (!promptBrand(context.theme, facts)) delete facts.brand;
  const reward = rewardFor(context.event.type, facts);
  if (!reward) delete facts.reward;
  const payload: Record<string, unknown> = {
    event: context.event.type,
    task: taskFor(context.event.type, reward !== null),
    theme: { id: context.theme, ...themePromptInfo(context.theme, facts.brand) },
    facts,
    // Without a QR on screen, earlier lines that invited a scan are left out: they primed the model
    // to repeat the invitation for a QR that is no longer there.
    recentLines: context.recentLines
      .filter((line) => typeof line === 'string' && line.length > 0)
      .filter((line) => reward !== null || !mentionsAnyQr(line))
      .slice(-AI_LIMITS.maxRecentLines)
      .map((line) => line.slice(0, AI_LIMITS.maxRecentLineChars)),
  };
  const slipNote = describeSlipReason(facts.slipReason);
  if (slipNote) payload.slipReasonMeaning = slipNote;
  const rewardNote = describeReward(reward);
  if (rewardNote) payload.rewardMeaning = rewardNote;
  return JSON.stringify(payload);
}

/** Style instructions for the voice model (kept short; the text itself is fixed). */
export function buildVoiceStyle(lang: Lang): string {
  return [
    `You are the voice of Momo, a tiny plush mascot. Speak ${LANGUAGE_PROMPT_NAMES[lang]}.`,
    'Voice: cute, natural, light and bright, gently upbeat, like a friendly little character. Not shrill, not robotic.',
    'Read the given line exactly as written. Do not add, remove, translate or comment on anything.',
  ].join(' ');
}
