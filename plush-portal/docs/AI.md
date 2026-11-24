# Momo — AI guide

Momo is the small mascot who comments on the game in one short line at a time.
She never takes part in the simulation: the game pushes **facts** to her, she
answers asynchronously with a subtitle and (optionally) a voice. Physics and
results are never decided or altered by the model.

```
game ──GuideEvent(facts)──▶ src/ai (GuideDirector)
                              │  priority · cooldown · de-dup · stale guard
                              ├─ local line bank (always available)
                              └─ POST /api/ai/line ──▶ server/ ──▶ OpenAI Responses API
                                                        (key lives only here)
                              voice: AI (POST /api/ai/speech) ▸ system TTS ▸ babble ▸ subtitles only
```

## Running it

| Mode | What happens |
| --- | --- |
| No `.env` / no key | Fully playable. Momo uses the local line bank (en / zh / ja, 4 themes) and the built-in babble voice. Status shows **Local lines**. |
| `OPENAI_API_KEY` set | Lines come from GPT through the proxy; voice from OpenAI. Any timeout or error falls back to a local line immediately. |

1. `cp .env.example .env` and set `OPENAI_API_KEY`.
2. `npm run dev` (Vite proxies `/api` to the API server) or `npm run build && npm start` (API + `dist/` on one port).
3. Settings → AI Guide → **Test connection**.

All settings are documented in `.env.example`. Defaults: text `gpt-6-luna`,
voice `gpt-realtime-2.1-mini` over the Realtime API, voice id `marin`, port 8787,
bound to `127.0.0.1`.

## Server (`server/`)

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness. |
| `GET /api/ai/status` | `{ configured, provider, textModel, speechModel, speechApi, voice, allowClientPrompt, adminProtected, speechConfigError, warnings, limits, version }`. Never a secret. |
| `POST /api/ai/line` | Body: `{ event: { type, facts }, theme, lang, recentLines, persona?, systemPrompt?, length, model?, temperature?, timeoutMs? }` → `{ text, emotion, shouldSpeak, model, latencyMs }`. |
| `POST /api/ai/speech` | Body: `{ text, voice?, speed?, lang, model? }` → audio bytes (`audio/wav` from Realtime, `audio/mpeg` from the Speech API) plus `x-plush-speech-model / -api / -voice / -cache` headers. |
| `POST /api/ai/test` | Real minimal round trip (text, optional `{ "speech": true }`). No key → `{ ok: false, code: "no_key" }`. |
| `GET /api/ai/models` | `models.list()` of the configured key, filtered to text and speech models, with what each accepts. |

Errors are always `{ "error": { "code", "message" } }` with messages written by
the proxy; upstream error text is never forwarded (OpenAI's own 401 message
contains a masked key). Codes: `no_key`, `bad_request`, `payload_too_large`,
`forbidden`, `rate_limited`, `timeout`, `cancelled`, `upstream_auth`,
`upstream_rate_limited`, `upstream_model`, `upstream_rejected`, `upstream_error`,
`bad_output`, `model_mismatch`, `speech_unavailable`, `not_found`, `internal`.

**Text.** `client.responses.create()` with `text.format` built by the SDK's
`zodTextFormat(LineOutputSchema, 'momo_line')` (strict JSON schema: `text`,
`emotion`, `shouldSpeak`), `store: false`, bounded `max_output_tokens`. The
answer is searched in every message item of the response, validated with zod,
normalised and length-checked (hard limits: 24 words en / 34 chars zh / 46 chars
ja for "short"); longer output is cut back to whole sentences or rejected as
`bad_output`. One retry with backoff on 429 / 5xx / connection errors, within
the smaller of the client's `timeoutMs` and `PLUSH_TEXT_TIMEOUT_MS`.
`roundId` / event ids are never sent to the model and never read from it: the
browser matches replies to rounds itself.

**Which parameters are sent** (`server/capabilities.ts`). Unknown models get
neither `reasoning` nor `temperature`.

| Model id pattern | `reasoning.effort` | `temperature` |
| --- | --- | --- |
| `gpt-6-luna`, `gpt-6-sol` | `none` | yes |
| other `gpt-6*` (Astra, 6.1, 6.2) | `low` | no |
| `*-pro` | not sent | no |
| `gpt-5.1`, `gpt-5.2` | `none` | yes |
| other `gpt-5*` | `low` | no |
| `o*` | `low` | no |
| `gpt-4.1*`, `gpt-4o*` | not sent | yes |
| anything else | not sent | no |

If OpenAI answers 400 naming `temperature` or `reasoning` as the offending
parameter, the proxy drops that parameter, remembers it for the model and
retries once.

**Voice.** A `ServerSpeechProvider` per OpenAI interface, chosen by
`OPENAI_SPEECH_API`:

- `realtime` (default): one short Realtime session per line over WebSocket
  (`openai/realtime/ws`): `session.update` (audio output only, `audio/pcm`
  24 kHz, voice, speed, style instructions, turn detection off) →
  `conversation.item.create` (the line as `input_text`) → `response.create` →
  `response.output_audio.delta` … → `response.done`; the PCM is wrapped as WAV.
  No microphone, no input audio.
- `speech`: `client.audio.speech.create()` with a TTS model (mp3).
  `instructions` only for `gpt-4o-mini-tts*`.

The model id must belong to the chosen interface (name-based classification).
A text model in a speech slot, a TTS model for Realtime or a Realtime model for
the Speech API is rejected with `model_mismatch` and nothing is sent upstream;
a wrong server configuration shows up as `speechConfigError` in the status.
Identical requests are served from a small LRU cache.

**Protection.** Token bucket per client IP (`PLUSH_RATE_LIMIT_PER_MIN`), 16 KB
body limit, zod validation with unknown keys stripped, requests from foreign
origins refused (`PLUSH_ALLOWED_ORIGINS`), optional `PLUSH_ADMIN_TOKEN` for the
test route and model overrides, `PLUSH_ALLOW_CLIENT_PROMPT=false` to lock prompt,
personality and model to the server's values. Logs pass through a redactor
(configured secrets, `sk-…`, `Bearer …`) and truncate long fields; request and
prompt bodies are not logged. The limiter is in-memory and per process: for a
multi-instance public deployment put a real gateway in front.

## Browser (`src/ai/`)

`createGuide({ audio, fetchImpl?, now?, rng?, storage?, baseUrl?, speech? })`
returns the `GuidePort` from `src/core/contracts.ts` plus
`configure({ settings, uiLang, themeId, themeVersion, voiceVolume? })`,
`debugStats()` and `serverStatus()`.

- **Priority**: results and explicit tip requests (3) > round feedback such as
  `grab_started`, `welcome`, `theme_changed` (2) > hints (1) > idle chatter (0).
  A higher priority replaces what is in flight or on screen; one piece of round
  feedback may wait behind an equal line (5 s TTL); hints are dropped, never queued.
- **Cooldowns** per event type, scaled by Settings → frequency (quiet ×2.5,
  chatty ×0.45); results are never throttled.
- **Stale guard**: a reply is shown only if the ticket is still the active one
  and round id, language and theme version are unchanged and the guide is not
  paused. `invalidateBefore(roundId)` removes older lines, including the one on
  screen. Pausing drops the current line for good; nothing is replayed later.
- **Never blocks**: GPT gets `settings.timeoutMs`; then a cached GPT line for the
  same situation or a local line is shown. After three failures in a row GPT is
  skipped for 45 s so players do not wait on every line.
- **Status is literal**: `gpt` only after a real reply (line or connection
  test), `checking` while a key is configured but unproven, `local` without key
  or server, `error` after a failed request, `off` when disabled.
  `status().voice` reports `ai` only after OpenAI audio really played.
- **Voice chain**: AI voice (if the server is configured) → `localVoice`:
  `system` (Web Speech API, when the device has a voice for the language) or
  `babble` (synthesised mascot voice, `speech/babbleSynth.ts`, no assets) →
  subtitles only. One utterance at a time; the music duck is held through
  `AudioPort.playVoice` / `setVoiceActive`.
- **Cache** (Settings → cache): `off`, `session` (memory) or `persistent`
  (`localStorage` key `plush-portal.ai.lines.v1`, text only, bounded).
- **Prompt**: `DEFAULT_SYSTEM_PROMPT` and `DEFAULT_PERSONA` are exported for the
  settings UI (edit / copy / restore). Whatever is edited, the server appends
  the fixed output rules (language, length, facts only, no promised wins, JSON
  shape).

### Local lines

`src/ai/lines/{en,zh,ja}.ts`: about 150 original lines per language covering
every event type in all four themes, chosen from facts:

- `empty_grab` with `contact: none` → direction hint from `facts.nearest`
  (+dx = move right, +dz = move toward the front); no "so close" wording.
- `contact: touched | gripped | lifted` → close-call wording is allowed.
- `slipped_after_grip` → lines per `slipReason` (`eccentric`, `weak_support`,
  `contact_lost`, `transport_swing`, `overload`, `bounced_out`); unknown reasons
  use the generic pool.
- `prize_won` → mentions the toy, separate lines for a new character and for
  demo rounds (which never claim a collection entry).

## Data that leaves the device

Only when a key is configured, and only: event type, theme, language, phase,
counters (attempts, wins, loss streak), outcome / contact / slip reason, lift
time, the public toy name and kind, the nearest-toy offset, two booleans
(`newCharacter`, `headTracking`), up to four recent lines, and the prompt /
personality text. `sanitizeFacts` (browser) and the zod schema (server) both
whitelist these fields. Camera frames, face landmarks and eye positions are not
part of the protocol and are stripped if present. Responses are requested with
`store: false`.

## Verified / not verified

Verified in this repository (`npx vitest run tests/unit/ai tests/unit/server`):

- Request / response shapes against the **installed SDK typings** (openai
  7.63.0): Responses params, `zodTextFormat` with zod 4, Speech params, and the
  Realtime client / server event unions (the Realtime payloads are type-checked;
  the pre-GA event name `response.audio.delta` does not compile).
- The **real SDK client against local mock servers**
  (`tests/unit/server/sdk-integration.test.ts`): `/v1/responses`,
  `/v1/audio/speech`, `/v1/models`, and a full Realtime session over `wss://`
  with the SDK's WebSocket helper (URL, bearer header, event order, WAV output,
  error event, dropped connection, refused socket).
- Routes with an injected fake client: validation, no-key behaviour, capability
  table, parameter learning, retries, error mapping, model / endpoint mismatch,
  rate limiting, origins, admin token, no key or prompt in responses or logs,
  static file serving.
- Director logic with fake timers, the line bank (coverage, lengths, direction
  signs, honesty rules), babble synthesis, speech providers and router.
- Manual: server started without a key and with a dummy key (curl on every
  route); headless Chromium loading the guide from `--serve-dist` without a key:
  local line shown, babble audio measured at the output, status `local`.

Not verified (no API key and no route to `api.openai.com` in the build
environment):

- That OpenAI accepts these requests today, real latency, and how the default
  models behave. Model names, deprecations and parameter rules were taken from
  the SDK typings and from the OpenAI documentation as returned by web search in
  November 2026 (the documentation pages themselves could not be fetched from
  the sandbox): model pages for `gpt-6-luna` and `gpt-realtime-2.1-mini`,
  "Reasoning models", "Using GPT-6.2", "Structured model outputs", "Text to
  speech", "Realtime conversations" and "Deprecations" on
  developers.openai.com. The per-family rule for `gpt-5.4` – `gpt-5.6` is a
  conservative choice (`low`, no sampling), not a documented fact.
- The AI voice: Realtime models answer a prompt, so the spoken wording is
  steered ("read exactly as written") but not guaranteed to be verbatim; the
  subtitle is always the intended text. Run **Test connection** and **Preview
  voice** with a real key before a public installation.
- The system voice on real devices (headless Chromium has no voices).

Known notes: the Speech API models (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) are
scheduled to shut down on 2027-01-06, which is why Realtime is the default;
`gpt-4.1*` / `gpt-4o*` text models are scheduled for 2027-01-14.
