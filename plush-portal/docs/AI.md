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
| No `.env` / no key | Fully playable. Momo uses the local line bank (en / zh / ja, 5 themes, GTC booth-host lines for the GTC kit) and the built-in babble voice. Status shows **Local lines**. |
| `OPENAI_API_KEY` set | Lines come from GPT through the proxy; voice from OpenAI. Any timeout or error falls back to a local line immediately. |
| Key replaced in Settings | Same as above with the replaced key, until **Restore default**. |

1. `cp .env.example .env` and set `OPENAI_API_KEY` — or skip this and paste a key in Settings → AI Guide → **OpenAI API key** later.
2. `npm run dev` (Vite proxies `/api` to the API server) or `npm run build && npm start` (API + `dist/` on one port).
3. Settings → AI Guide → **Test connection**.

Behind an HTTP(S) proxy (corporate network, sandbox) nothing extra is needed:
see [Network](#network-proxy-and-certificates). For phones on the LAN see
[HTTPS for phones](#https-for-phones-on-the-lan).

## The OpenAI key

The server has exactly one active key at a time:

| Source | Where it comes from | Shown as |
| --- | --- | --- |
| `env` | `OPENAI_API_KEY` from `.env` / the environment (the default) | ".env default" |
| `settings` | replaced in Settings → AI Guide; stored in `<PLUSH_DATA_DIR>/secrets.json` (default `.data/secrets.json`, file mode 0600 in a 0700 folder, written atomically, git-ignored) | "Replaced in settings" |
| `none` | neither | "No key" |

A stored key wins over `.env` (also after a restart) until it is removed.
Nothing about the key is ever sent to a browser except its **source** and a
**fingerprint** made of its last four characters (`…wxyz`): `GET /api/ai/status`
and `GET /api/ai/key` carry `credential: { source, fingerprint, envDefault, savedAt, management, canManage }`.

**Settings → AI Guide → OpenAI API key** (`src/ui/settings/tabAi.tsx`, `src/ai/keyClient.ts`):

- shows the source and fingerprint;
- a password field (`autocomplete=off`) with **Save** (sends the key once,
  `POST /api/ai/key {key}`; the field is cleared as soon as it is sent),
  **Test** (checks the typed key without storing it, or the key in use when the
  field is empty) and **Restore default** (`DELETE /api/ai/key`);
- takes effect immediately on the server and is independent of the dialog's
  Apply / Cancel; afterwards the guide re-asks `/api/ai/status`;
- is hidden whenever the public-display lock (`system.lockSettings`) is on.

The key is never part of the settings, never written to `localStorage` /
IndexedDB, never put in a URL, never logged (the server's redactor learns every
key that becomes active) and never shown in diagnostics or exports.

**Saving** checks the format first (`sk-…`, no spaces, 20–512 characters; any
token is accepted when `OPENAI_BASE_URL` points at a gateway), then — unless
`PLUSH_KEY_CHECK=false` — asks OpenAI `GET /v1/models` with only that key
(`PLUSH_KEY_CHECK_TIMEOUT_MS`, default 6 s): 401 → `key_rejected`, nothing is
stored; 403 (restricted key) / 429 (quota) → stored, reported; network failure
→ stored, reported as "could not be checked".

**Who may change it** (`PLUSH_KEY_MANAGEMENT`):

| Mode | Allowed |
| --- | --- |
| `local` (default) | requests made on the server machine itself, or with `Authorization: Bearer <PLUSH_ADMIN_TOKEN>` |
| `token` | only with the admin token |
| `off` | nobody; only `OPENAI_API_KEY` counts and a stored key is ignored |

"On the server machine" means all of: the TCP peer is a loopback address; no
`X-Forwarded-For` / `Forwarded` / `X-Real-IP` header names another address (the
Vite dev proxy forwards with `xfwd`, so a phone behind it is not "local"); the
`Host` header (and `Origin`, when present) names localhost / 127.x / [::1]
(defeats DNS-rebinding pages). Forwarding headers are only used to refuse,
never to allow. Foreign origins are refused by the general origin check as
before. When this browser may not change the key, the block shows the status
read-only and offers an admin-token field (kept in memory only).

All settings are documented in `.env.example`. Defaults: text `gpt-6-luna`,
voice `gpt-realtime-2.1-mini` over the Realtime API, voice id `marin`, port 8787,
bound to `127.0.0.1`.

## Server (`server/`)

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness. |
| `GET /api/ai/status` | `{ configured, provider, textModel, speechModel, speechApi, voice, allowClientPrompt, adminProtected, speechConfigError, warnings, limits, version, credential }`. Never a secret. |
| `GET /api/ai/key` | `{ ok, credential }` — source and fingerprint of the active key, and whether this request may change it. |
| `POST /api/ai/key` | Body `{ key }`. Protected (see [The OpenAI key](#the-openai-key)). Format check, optional check with OpenAI, store, use. → `{ ok, credential, check: { result, latencyMs } }`. |
| `POST /api/ai/key/test` | Body `{ key? }`. Protected. Checks the given key (not stored) or the active one. |
| `DELETE /api/ai/key` | Protected. Removes the stored key: back to `OPENAI_API_KEY` (or no key). |
| `POST /api/ai/line` | Body: `{ event: { type, facts }, theme, lang, recentLines, persona?, systemPrompt?, length, model?, temperature?, timeoutMs? }` → `{ text, emotion, shouldSpeak, model, latencyMs }`. |
| `POST /api/ai/speech` | Body: `{ text, voice?, speed?, lang, model? }` → audio bytes (`audio/wav` from Realtime, `audio/mpeg` from the Speech API) plus `x-plush-speech-model / -api / -voice / -cache` headers. |
| `POST /api/ai/test` | Real minimal round trip (text, optional `{ "speech": true }`). No key → `{ ok: false, code: "no_key" }`. |
| `GET /api/ai/models` | `models.list()` of the configured key, filtered to text and speech models, with what each accepts. |

Errors are always `{ "error": { "code", "message" } }` with messages written by
the proxy; upstream error text is never forwarded (OpenAI's own 401 message
contains a masked key). Codes: `no_key`, `bad_request`, `payload_too_large`,
`forbidden`, `rate_limited`, `timeout`, `cancelled`, `upstream_auth`,
`upstream_rate_limited`, `upstream_model`, `upstream_rejected`, `upstream_error`,
`bad_output`, `model_mismatch`, `speech_unavailable`, `invalid_key`,
`key_rejected`, `key_storage`, `key_management_off`, `not_found`, `internal`.

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

## Network: proxy and certificates

`server/net.ts`, installed by `server/index.ts` at start — plain `npm run dev`
and `npm start` work behind a proxy without `NODE_USE_ENV_PROXY` or other flags:

- **fetch** (Responses API, models list, key checks): an undici dispatcher
  (`undici` 6.29.1, the same version Node 22 bundles) is set as the global
  dispatcher. Each request goes direct when its host matches `NO_PROXY`, else
  through `HTTPS_PROXY` / `HTTP_PROXY` (lower-case variants win) with undici's
  `ProxyAgent` (CONNECT tunnel, proxy credentials from the URL).
- **Realtime WebSocket**: `ws` ignores fetch's dispatcher, so the SDK's
  `OpenAIRealtimeWS` gets an `https.Agent` that opens an HTTP CONNECT tunnel
  through the same proxy (`ConnectTunnelAgent`), then TLS to `api.openai.com`.
- **NO_PROXY** matching: exact host, `.suffix` / `*.suffix`, `host:port`, `*`,
  and IPv4 CIDR ranges (`127.0.0.0/8`).
- **CA certificates** from `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` (PEM file
  or bundle) are read at start — also when they are only set in `.env`, which
  Node itself would ignore — and added to Node's default trust store
  (`tls.setDefaultCACertificates`) and passed explicitly to the proxy agents.
- The start-up log prints the route (`api.openai.com via http://proxy:3128`),
  never proxy credentials.

## Guide language

One setting, `ai.voiceLanguage` (Settings → AI Guide → "Guide speaks"):

- `en` (default) — Momo's subtitles, GPT lines, local fallback lines, voice and
  voice preview are English, whatever the interface language. The rest of the UI
  stays in the chosen language.
- `ui` — Momo follows the interface language (en / zh / ja).

It replaces the older `ai.language` (`ui` | `en` | `zh` | `ja`), which is no
longer in the settings spec. The settings store migrates stored and imported data
with the pure helper `migrateGuideLanguage()` (`src/ai/settingsMigration.ts`,
called from `migrate()` in `src/settings/store.ts`): the old default `ui` and `en` → `en`; an explicit `zh` /
`ja` that matched the interface language → `ui`; anything else → `en`. See also
[SETTINGS.md](SETTINGS.md#6-ai-guide).

## HTTPS for phones on the LAN

Browsers allow the camera (head tracking) only on HTTPS pages or on
`localhost`, so a phone opening `http://192.168.x.y:…` can play but never gets
a camera prompt. Two opt-in HTTPS modes, both using the same certificate:

| Command | What listens |
| --- | --- |
| `npm run start:https` (or `PLUSH_HTTPS=1 npm start`) | `npm start` as usual on `http://127.0.0.1:8787`, plus HTTPS on `0.0.0.0:8443` (`PLUSH_HTTPS_PORT`, `PLUSH_HTTPS_HOST`) serving the same app and API. Run `npm run build` first. |
| `npm run dev:https` (or `PLUSH_DEV_HTTPS=1 npm run dev`) | Vite over HTTPS on `0.0.0.0:5173` (`PLUSH_DEV_HOST` to narrow it); `/api` is proxied to the API on `127.0.0.1:8787` as in `npm run dev`. |

Certificate: `PLUSH_TLS_CERT` + `PLUSH_TLS_KEY` (PEM files) when set; otherwise a
self-signed ECDSA P-256 certificate generated with `node:crypto` only (no
OpenSSL needed) on first start, stored in `.data/tls/cert.pem` + `key.pem`
(0600), valid 397 days, for `localhost`, `127.0.0.1`, `::1`, the machine name
(+ `.local`) and every current LAN IPv4 address. It is regenerated when it is
about to expire or no longer names a current LAN address. The start-up log
prints the HTTPS URLs and the certificate's SHA-256 fingerprint.

Phone testing steps (same Wi-Fi as the computer):

1. On the computer: `npm run build && npm run start:https` (or `npm run dev:https`).
   Note the `https://192.168.x.y:8443` URL (`:5173` for dev) and the SHA-256
   fingerprint in the log. Allow the port in the computer's firewall if asked.
2. On the phone open that URL, e.g. `https://192.168.1.20:8443/?display=mobile`.
3. The browser warns about the self-signed certificate. Compare the fingerprint
   if you like, then continue: Chrome (Android) "Advanced → Proceed",
   Safari (iOS) "Show Details → visit this website".
4. Start a round with the camera on; the browser now asks for camera permission.
5. For a warning-free setup use a certificate the phone trusts (for example from
   a local CA you installed on the phone) via `PLUSH_TLS_CERT` / `PLUSH_TLS_KEY`.

From a phone the OpenAI key block is read-only (the phone is not the server
machine); everything else works as on the computer. None of this has been tried
on a real phone in this repository (see below).

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
- **Status probe** (`/api/ai/status`): the first probe after start may take up
  to 12 s (the page can be blocked for seconds while it boots — shaders, models,
  software rendering); later ones 6 s. A failed or timed-out probe is retried
  after 1 s, 2 s and 4 s, showing `checking` meanwhile (Momo uses local lines
  until then); only then does the status settle on `local`. A 404 (no API
  server behind the page) is final at once. The guide asks again when the tab
  becomes visible or the browser comes back `online`, on the next line after
  60 s, and right after the key was changed in Settings
  (`refreshServerStatus()`).
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

`src/ai/lines/{en,zh,ja}.ts`: about 255 original lines per language (the same
pools in every language) covering every event type in all five themes, chosen
from facts: about 165 generic and theme lines, about 85 for the GTC kit and 8
generic claim-QR lines. GPU Party has its own
flavour lines (booting, rendering, benchmarks, frame rates, cooling fans, the
server rack and pixel cubes) and its own prompt entry (`THEME_PROMPT_INFO.gpu`
with a `cast`: Keynote Chief, the twin-fan graphics card, chip, cooling fan,
server rack, green-visor robot and green pixel cube). All characters are
invented; the output rules tell the model never to name real companies,
brands, products or people — except the event and host of the GTC kit, see
[GTC kit](#gtc-kit-momo-as-a-gtc-booth-host).

- `empty_grab` with `contact: none` → direction hint from `facts.nearest`
  (+dx = move right, +dz = move toward the front); no "so close" wording.
- `contact: touched | gripped | lifted` → close-call wording is allowed.
- `slipped_after_grip` → lines per `slipReason` (`eccentric`, `weak_support`,
  `contact_lost`, `transport_swing`, `overload`, `bounced_out`); unknown reasons
  use the generic pool.
- `prize_won` → mentions the toy, separate lines for a new character and for
  demo rounds (which never claim a collection entry). With a claim QR on screen
  (`facts.reward`, below) the win line invites the player to scan it instead.

### GTC kit: Momo as a GTC booth host

The `gpu` theme is dressed by the brand kit of the build (`src/brand`,
`VITE_BRAND`): `gtc` by default, `neutral` (the original "GPU Party") for public
demo copies. `Game.facts()` adds `facts.brand = brandFacts(themeId)` —
`{ event: 'GTC', host: 'NVIDIA' }` for the GTC kit, nothing for the neutral kit
or any other theme.

**Which names may be used.** `src/ai/brand.ts` (`namedKitFor`) accepts
`facts.brand` only when it is exactly the event and host of a kit with
`namesAllowed` that dresses the event's theme. Anything else (an unknown name,
another theme, the neutral kit) is treated as no brand at all, in the local
bank, in the prompt and in the cache key, so neither a hand-made request nor a
bug can make Momo name an arbitrary company.

**Local lines.** Every line key has a `gtc` pool in en / zh / ja
(`src/ai/lines/types.ts` explains the choice): while `facts.brand` unlocks the
GTC kit it *replaces* the `gpu` pool (the GPU Party voice never mixes in), and
generic lines stay in the mix. Pick weights: event lines 3, theme lines 2,
generic 1. The lines talk like a booth host on the show floor — the keynote,
sessions and talks, hands-on training labs, the exhibit hall and its demos, the
startup showcase, poster sessions, meeting developers, accelerated computing,
CUDA, coffee breaks — and take the names from the `{event}` / `{host}` tokens
(lines with a token are skipped when the kit has no such name). The bank never
spells out a real name itself, so the neutral kit, which sends no
`facts.brand`, can never output "GTC", "NVIDIA" or "CUDA" (tested over every
event, theme, situation and language). Hard rules, also tested: no invented
facts (no session times, rooms, dates, prices, specs, launches, stock), no
other companies or products, never speaking as or quoting a real person (the
Keynote Chief is a plush), plus all the honesty rules above.

**Prompt.** `themePromptInfo(theme, facts.brand)` gives the model the kit's
entry (`name: 'NVIDIA GTC'`, a booth-host mood with the same topics, and the
cast) and the generic `THEME_PROMPT_INFO.gpu` otherwise. With a usable brand the
output rule "never name real companies, brands, products or real people" is
replaced by: *you may name exactly `facts.brand.event` and `facts.brand.host`
and nothing else; never make claims about products, specs, prices,
availability, schedules, rooms or announcements; never speak as or quote a real
person; the Keynote Chief is an invented plush character.* The rule names the
fields, not their values. The model may not say "CUDA" (only the two names);
the curated local lines may.

### The claim QR (`facts.reward`)

After a real win the game may show a QR code that the visitor scans with their
phone to collect the plush prize at the booth or take a swag discount
(docs/REWARDS.md, `src/rewards`). `Game.facts()` sets
`facts.reward = { qr: true, options }` only while the `reward` slice of the UI
store is `ready` (or `demoBuild`) for the current round, the card has not
timed out, and the round was not a demo. The guide uses it on two events:

| Event | Local pool | Says |
| --- | --- | --- |
| `prize_won`, options `both` | `win.reward` | scan to collect your plush prize or take a swag discount |
| `prize_won`, options `prize` | `win.reward.prize` | scan to collect your plush prize |
| `prize_won`, options `swag` | `win.reward.swag` | scan for a swag discount |
| `retry_prompt` while the card is still up | `retry.reward` | nudge: scan the code before playing again |

Each has generic lines (any theme, the neutral kit) and `gtc` lines. A claim QR
beats "new character" on a win. On every other event, on demo rounds and with
`qr: false` the facts are ignored, and no line ever mentions a QR, a prize to
collect or a discount without them. The issuing is asynchronous: when the code
is still on its way as the win card appears, `Game.emitPrizeWon` holds the win
line back for up to 1.5 s, until the code is ready (or has failed). If it is
still not there after that, the win line is an ordinary one and the retry prompt
about seven seconds later carries the nudge.

For GPT, `buildLineInput` keeps `facts.reward` only on those two events and adds
`rewardMeaning` (what scanning unlocks for the given options); the output rules
say to invite the player to scan only then. The task text itself is built per
request (`taskFor`): with a QR on screen it asks for the scan invitation first,
otherwise it says that no QR code is on screen. Earlier scan invitations are then
left out of `recentLines`. A live check with a real key (10 GTC lines) had shown
the model inviting a scan for wins without a QR while the task carried a
conditional QR sentence and recent lines held scan invitations. After the change,
the same check produced no QR wording without a QR and the scan invitation first
with one. The director checks every model
line (`qrMentionFits`): a reward line that does not mention scanning / the QR,
or any other line that does, is replaced by a local line (`debugStats().qrMismatch`)
and not cached; this does not count as a connection failure. Cache keys include
the QR options and the brand, so such lines are never reused in the wrong
situation.

## Data that leaves the device

Only when a key is configured, and only: event type, theme, language, phase,
counters (attempts, wins, loss streak), outcome / contact / slip reason, lift
time, the public toy name and kind, the nearest-toy offset, two booleans
(`newCharacter`, `headTracking`), the event identity of a brand kit
(`brand: { event, host }`, at most 24 characters each), whether a claim QR is on
screen and what it unlocks (`reward: { qr, options }` — never the code or its
URL), up to four recent lines, and the prompt / personality text.
`sanitizeFacts` (browser) and the zod schema (server, strict objects for
`brand` and `reward`) both whitelist these fields. Camera frames, face
landmarks and eye positions are not part of the protocol and are stripped if
present. Responses are requested with `store: false`.

## Verified / not verified

Verified in this repository (`npx vitest run tests/unit/ai tests/unit/server`):

- Request / response shapes against the **installed SDK typings** (openai
  7.63.0): Responses params, `zodTextFormat` with zod 4, Speech params, and the
  Realtime client / server event unions.
- The **real SDK client against local mock servers**
  (`tests/unit/server/sdk-integration.test.ts`): `/v1/responses`,
  `/v1/audio/speech`, `/v1/models`, and a full Realtime session over `wss://`.
- Routes with an injected fake client: validation, no-key behaviour, capability
  table, parameter learning, retries, error mapping, model / endpoint mismatch,
  rate limiting, origins, admin token, no key or prompt in responses or logs,
  static file serving.
- Key handling (`tests/unit/server/keys.test.ts`, made-up keys only): file store
  (0600 / 0700, atomic, damaged files), masking, format checks, the loopback /
  forwarding / Host / Origin / admin-token / mode rules, every `/api/ai/key`
  route, the new key being used for the next line and voice, key never in a
  response body or log line.
- Network (`tests/unit/server/net.test.ts`): proxy variable selection, NO_PROXY
  matching, CA file loading, and a real CONNECT tunnel through a local proxy to a
  local HTTPS / WSS server (fetch via the dispatcher, `ws` via the tunnel agent,
  proxy credentials, refused tunnel, untrusted certificate).
- HTTPS (`tests/unit/server/tls.test.ts`): the generated certificate (verified
  with `X509Certificate`, names / IPs, validity, a real TLS handshake),
  storage, renewal and user-supplied files.
- Director logic with fake timers (`director.test.ts`, `probe.test.ts`): probe
  timeouts, retries with backoff, 404, wake events, key-change re-probe, guide
  language (local lines, GPT requests and voice in English with a zh / ja UI),
  settings migration; the line bank (coverage, lengths, direction signs, honesty
  rules) for all five themes.
- GTC kit and claim QR (`tests/unit/ai/brandLines.test.ts`,
  `brandPrompt.test.ts`, `tests/unit/server/schemas.test.ts`, the last block of
  `director.test.ts`): GTC lines for every key in en / zh / ja, lengths, tokens
  filled, no "GTC" / "NVIDIA" / "CUDA" from the neutral kit, a banned-content
  check (real people, clock times, dates, prices, stock, rooms, other companies
  and products), QR lines exactly when `facts.reward` applies and matching the
  options, the brand exception in the rules only with a usable `facts.brand`,
  schema accept / reject cases, the proxy passing both through, and the director
  replacing a model line that skips or invents the QR.
- In the browser (`tests/e2e/25-gtc-dialogue.spec.ts`, keyless build, gpu theme):
  the guide events carry `brand: { event: 'GTC', host: 'NVIDIA' }`; a real win
  without a code gives a plain win line; with the reward slice set to `ready` for
  that round the win line and the retry prompt invite a scan; a Chinese UI with
  "Guide speaks: interface language" gets Chinese GTC lines. The QR card itself
  and a real issued code are not part of this check.

Run by hand on 2026-11-24 in the build container (behind its HTTPS proxy, with
its re-signing CA in `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE`, started without
`NODE_USE_ENV_PROXY`):

- `POST /api/ai/test {"speech":false}` → `ok: true`, a real line from
  `gpt-6-luna` (~2.4 s).
- `POST /api/ai/test {"speech":true}` → `ok: true`, line plus 79 244 bytes of
  WAV from `gpt-realtime-2.1-mini` over the Realtime WebSocket through the
  CONNECT tunnel (~2.1 s). Nobody listened to the audio.
- `POST /api/ai/key/test` (key in use) → `ok`; `POST /api/ai/key` with a made-up
  key → `key_rejected` (OpenAI answered 401), nothing stored; the same request
  with a LAN `X-Forwarded-For` or a foreign `Host` → `forbidden`.
- Headless Chromium against a keyless, offline build: with `?lang=zh` Momo's
  line was English; the AI tab showed "Guide speaks" and no old language field;
  a fake key was saved (input cleared, `secrets.json` 0600, fingerprint only,
  one request carried the key, nothing in `localStorage`, IndexedDB, the page
  or the settings export), tested, restored; with the public-display lock on
  the block was hidden.
- `--https` listener and `vite --mode https` checked with `curl` trusting only
  the generated certificate; a simulated LAN request through the dev proxy got
  `canManage: false` and `forbidden` on save.
- Independent review, same day: both `/api/ai/test` calls repeated with
  `NODE_EXTRA_CA_CERTS` unset and `NODE_OPTIONS` without `--use-openssl-ca`, so
  only the in-process loading of `SSL_CERT_FILE` could make the proxy's CA
  trusted → text and Realtime voice `ok`; requests reaching the HTTPS listener
  and the HTTPS dev proxy from the container's own non-loopback address got
  `canManage: false` / `forbidden`; in Chromium with `PLUSH_KEY_MANAGEMENT=token`
  the admin token typed into the block caused no request until "Use token",
  then save / restore worked with the token and nothing leaked.

Not verified:

- A real phone (camera prompt over HTTPS, Safari / Chrome accepting the
  self-signed certificate, firewall prompts), any LAN other than the container.
- Long-term behaviour of the live API (latency spread, rate limits, model
  changes); only the handful of calls above were made. Realtime models answer a
  prompt, so the spoken wording is steered ("read exactly as written") but not
  guaranteed to be verbatim; the subtitle is always the intended text.
- File modes on Windows (ignored by the OS there; the folder is still git-ignored).
- The system voice on real devices (headless Chromium has no voices).

Known notes: the Speech API models (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) are
scheduled to shut down on 2027-01-06, which is why Realtime is the default;
`gpt-4.1*` / `gpt-4o*` text models are scheduled for 2027-01-14.
