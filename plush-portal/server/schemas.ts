/**
 * Request and model-output schemas. Unknown keys are stripped by zod, so
 * nothing outside this whitelist (for example camera or face data, should a
 * client bug ever attach it) can reach the model.
 */
import { z } from 'zod';
import { GUIDE_EVENT_TYPES } from '../src/core/contracts';
import { LANGS, ROUND_PHASES, THEME_IDS } from '../src/core/types';
import { AI_LIMITS, GUIDE_EMOTIONS } from '../src/ai/protocol';

// Control characters would only serve prompt formatting tricks; drop them.
// eslint-disable-next-line no-control-regex
const stripControl = (value: string) => value.replace(/[\u0000-\u001f\u007f  ]/g, ' ').trim();
const text = (max: number) => z.string().max(max).transform(stripControl);
const modelId = z
  .string()
  .max(AI_LIMITS.maxModelIdChars)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'invalid model id');

export const FactsSchema = z.object({
  phase: z.enum(ROUND_PHASES),
  demo: z.boolean().default(false),
  attempts: z.number().int().min(0).max(1_000_000).default(0),
  wins: z.number().int().min(0).max(1_000_000).default(0),
  lossStreak: z.number().int().min(0).max(1_000_000).default(0),
  outcome: z.enum(['won', 'empty', 'slipped']).optional(),
  contact: z.enum(['none', 'touched', 'gripped', 'lifted']).optional(),
  // Tolerant on purpose: newer game builds may report reasons this server does not know yet.
  slipReason: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .nullable()
    .optional(),
  liftedMs: z.number().min(0).max(3_600_000).optional(),
  toy: z
    .object({ typeId: text(64), name: text(AI_LIMITS.maxToyNameChars), kind: text(40) })
    .nullable()
    .optional(),
  nearest: z
    .object({
      dx: z.number().min(-10).max(10),
      dz: z.number().min(-10).max(10),
      dist: z.number().min(0).max(20),
      name: text(AI_LIMITS.maxToyNameChars),
    })
    .nullable()
    .optional(),
  newCharacter: z.boolean().optional(),
  headTracking: z.boolean().optional(),
});

export const LineRequestSchema = z.object({
  event: z.object({ type: z.enum(GUIDE_EVENT_TYPES), facts: FactsSchema }),
  theme: z.enum(THEME_IDS),
  lang: z.enum(LANGS),
  recentLines: z.array(text(AI_LIMITS.maxRecentLineChars)).max(AI_LIMITS.maxRecentLines).default([]),
  persona: text(AI_LIMITS.maxPersonaChars).optional(),
  systemPrompt: text(AI_LIMITS.maxSystemPromptChars).optional(),
  length: z.enum(['short', 'medium']).default('short'),
  model: modelId.optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  timeoutMs: z.number().min(AI_LIMITS.minTimeoutMs).max(AI_LIMITS.maxTimeoutMs).optional(),
});
export type LineRequest = z.infer<typeof LineRequestSchema>;

export const SpeechRequestSchema = z.object({
  text: z.string().min(1).max(AI_LIMITS.maxSpeechChars).transform(stripControl),
  voice: z
    .string()
    .max(AI_LIMITS.maxVoiceChars)
    .regex(/^[A-Za-z0-9_-]+$/, 'invalid voice id')
    .optional(),
  speed: z.number().min(0.5).max(1.5).optional(),
  lang: z.enum(LANGS),
  model: modelId.optional(),
});
export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;

export const TestRequestSchema = z.object({
  speech: z.boolean().optional(),
  lang: z.enum(LANGS).optional(),
});

/** Structured output the model must produce (also used to build the strict JSON schema). */
export const LineOutputSchema = z.object({
  text: z.string().describe('The single line Momo says.'),
  emotion: z.enum(GUIDE_EMOTIONS).describe('How Momo feels while saying it.'),
  shouldSpeak: z.boolean().describe('False only when the line works better as a silent caption.'),
});
export type LineOutput = z.infer<typeof LineOutputSchema>;

/** First validation problem as a short, safe message ("event.facts.phase: Invalid option"). */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request body';
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`.slice(0, 200);
}
