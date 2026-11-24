/**
 * Momo's prompt and the compact game context that is sent to the model.
 * Shared by the browser (to show / edit / restore the prompt in settings) and
 * by the API proxy (which always appends the fixed output rules).
 *
 * Privacy: only whitelisted game facts are ever serialised here. Camera
 * frames, face landmarks and eye positions are not part of `GuideFacts` and
 * can not pass through `sanitizeFacts`.
 */
import type { GuideEventType, GuideFacts } from '../core/contracts';
import type { Lang, ThemeId } from '../core/types';
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

export const THEME_PROMPT_INFO: Record<ThemeId, { name: string; mood: string }> = {
  sakura: { name: 'Sakura Kawaii', mood: 'Japanese kawaii plush shop, cherry blossoms, cream and pink, soft and sweet' },
  storybook: { name: 'Storybook Friends', mood: 'animated-film toy box, warm light, friendly characters on an adventure' },
  ocean: { name: 'Ocean Dream', mood: 'dreamy sea, pearl and sea-salt blue, gentle waves, squishy sea friends' },
  cosmic: { name: 'Cosmic Arcade', mood: 'playful space arcade, nebula purple and neon, little explorers among the stars' },
  gpu: { name: 'GPU Party', mood: 'graphics-card and AI-computing fan shop, glossy black with vivid green light, cute plush chips and graphics cards' },
};

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

function lengthSentence(lang: Lang, length: LineLength): string {
  const rule = LENGTH_RULES[length][lang];
  return `${rule.targetMin}-${rule.targetMax} ${rule.unit}`;
}

/**
 * Fixed rules that are appended to every request, also when the base prompt
 * was replaced in settings, so a custom prompt can not break length, language,
 * honesty or the JSON shape.
 */
export function buildOutputRules(lang: Lang, length: LineLength): string {
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
}

export function buildInstructions(options: InstructionOptions): string {
  const base = (options.systemPrompt ?? '').trim().slice(0, AI_LIMITS.maxSystemPromptChars) || DEFAULT_SYSTEM_PROMPT;
  const persona = (options.persona ?? '').trim().slice(0, AI_LIMITS.maxPersonaChars) || DEFAULT_PERSONA;
  return `${base}\n\nPersonality: ${persona}\n\n${buildOutputRules(options.lang, options.length)}`;
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
  return out;
}

export interface LineContext {
  event: { type: GuideEventType; facts: GuideFacts };
  theme: ThemeId;
  recentLines: string[];
}

/** The user message: a compact JSON document with everything Momo may talk about. */
export function buildLineInput(context: LineContext): string {
  const facts = sanitizeFacts(context.event.facts);
  const payload: Record<string, unknown> = {
    event: context.event.type,
    task: EVENT_TASKS[context.event.type],
    theme: { id: context.theme, ...THEME_PROMPT_INFO[context.theme] },
    facts,
    recentLines: context.recentLines
      .filter((line) => typeof line === 'string' && line.length > 0)
      .slice(-AI_LIMITS.maxRecentLines)
      .map((line) => line.slice(0, AI_LIMITS.maxRecentLineChars)),
  };
  const slipNote = describeSlipReason(facts.slipReason);
  if (slipNote) payload.slipReasonMeaning = slipNote;
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
