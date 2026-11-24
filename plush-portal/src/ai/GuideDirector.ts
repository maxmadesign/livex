/**
 * GuideDirector: decides when Momo speaks, what she says and how it is voiced.
 *
 * It never takes part in the game loop: the game pushes facts in (`handle`),
 * the director answers asynchronously through `subscribe`. All external work
 * (GPT text, AI voice) can be cancelled and is guarded against staleness, so a
 * late answer for an old round, language or theme is dropped instead of shown.
 */
import type {
  AudioPort,
  GuideConnection,
  GuideEmotion,
  GuideEvent,
  GuideEventType,
  GuideLine,
  GuidePort,
  GuideSource,
  GuideStatus,
} from '../core/contracts';
import type { Lang, ThemeId, Unsubscribe } from '../core/types';
import type { AiSettings } from '../settings/spec';
import { LineCache, lineCacheKey, type CachedLine, type StorageLike } from './cache';
import { pickLocalLine } from './lines';
import { DEFAULT_PERSONA, DEFAULT_SYSTEM_PROMPT, sanitizeFacts } from './prompt';
import {
  GUIDE_EMOTIONS,
  type ApiErrorBody,
  type LineRequestBody,
  type LineResponseBody,
  type StatusResponseBody,
  type TestResponseBody,
} from './protocol';
import { createAiSpeech, type AiSpeechInfo } from './speech/aiSpeech';
import { createBabbleSpeech } from './speech/babble';
import { SpeechRouter, type SpeechProviders } from './speech/router';
import { createSystemSpeech } from './speech/systemSpeech';
import type { SpeechPath, SpeechPlayback, SpeechProvider } from './speech/types';
import { displayDurationMs, fitLine } from './textLength';

/* ------------------------------------------------------------------ tuning */

/** 3 = results and explicit requests, 2 = round feedback, 1 = hints, 0 = idle chatter. */
export const GUIDE_PRIORITY: Record<GuideEventType, number> = {
  prize_won: 3,
  empty_grab: 3,
  slipped_after_grip: 3,
  user_requested_tip: 3,
  welcome: 2,
  first_play: 2,
  grab_started: 2,
  theme_changed: 2,
  aim_help: 1,
  retry_prompt: 1,
  idle_hint: 0,
};
const RESULT_PRIORITY = 3;
const FEEDBACK_PRIORITY = 2;

/** Minimum time between two accepted events of the same type at "normal" frequency. */
export const GUIDE_COOLDOWN_MS: Record<GuideEventType, number> = {
  prize_won: 0,
  empty_grab: 0,
  slipped_after_grip: 0,
  user_requested_tip: 600,
  welcome: 45_000,
  first_play: 20_000,
  grab_started: 14_000,
  theme_changed: 1_200,
  aim_help: 18_000,
  retry_prompt: 16_000,
  idle_hint: 24_000,
};
export const FREQUENCY_SCALE: Record<AiSettings['frequency'], number> = { quiet: 2.5, normal: 1, chatty: 0.45 };

/** Hints and idle chatter wait at least this long after the previous line ended. */
const CHATTER_GAP_MS = 2500;
/** A waiting feedback line is dropped if it could not start within this time. */
const PENDING_TTL_MS = 5000;
/** The line stays a moment after its audio ended. */
const AFTER_SPEECH_MS = 650;
const RECENT_LINES = 6;
/**
 * Status probe. The very first one runs while the page boots (shader
 * compilation, model loading, software rendering), when the main thread can be
 * blocked for many seconds; it gets a generous limit. A failed probe is
 * retried quickly with backoff before Momo settles on "local lines", and the
 * page asks again when it becomes visible or the network comes back.
 */
export const STATUS_FIRST_TIMEOUT_MS = 12_000;
export const STATUS_TIMEOUT_MS = 6_000;
export const STATUS_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
const REPROBE_AFTER_MS = 60_000;
/** Visibility / online events re-probe at most this often. */
const WAKE_REPROBE_GAP_MS = 5_000;
/** Chatter is served from the cache once this many GPT variants exist for the situation. */
const CACHE_VARIANTS_FOR_CHATTER = 3;
/** After this many failed GPT requests in a row, lines come from the local bank for a while. */
const GPT_FAILURES_BEFORE_PAUSE = 3;
const GPT_PAUSE_MS = 45_000;

const PREVIEW_TEXT: Record<Lang, string> = {
  en: "Hi, I'm Momo! Ready to catch something cute?",
  zh: '嗨，我是Momo！准备好抓一只可爱的娃娃了吗？',
  ja: 'やっほー、モモだよ！かわいい子をつかまえる準備はいい？',
};

/* ------------------------------------------------------------------- types */

export interface GuideConfig {
  settings: AiSettings;
  uiLang: Lang;
  themeId: ThemeId;
  /** Bumped by the game whenever the theme (or its toy set) changes. */
  themeVersion: number;
  /** 0..1, only used for the system voice, which bypasses the audio engine. Defaults to 1. */
  voiceVolume?: number;
}

export interface GuideDeps {
  audio: AudioPort | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Random source for choosing local lines (tests pass a seeded one). */
  rng?: () => number;
  /** Storage for the persistent line cache; defaults to localStorage when available. */
  storage?: StorageLike | null;
  /** Prefix for API calls, e.g. '' (same origin) or 'https://kiosk.example'. */
  baseUrl?: string;
  /** Replace individual speech paths (tests). */
  speech?: Partial<SpeechProviders>;
  /**
   * Calls the listener when the page becomes visible again or the network
   * comes back (default: document "visibilitychange" + window "online").
   * Pass null to disable (tests).
   */
  onWake?: ((listener: () => void) => Unsubscribe) | null;
}

/** Default wake source of the browser: tab visible again, network back online. */
function browserWake(listener: () => void): Unsubscribe {
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  const onVisible = () => {
    if (!doc || doc.visibilityState === 'visible') listener();
  };
  doc?.addEventListener('visibilitychange', onVisible);
  win?.addEventListener('online', listener);
  return () => {
    doc?.removeEventListener('visibilitychange', onVisible);
    win?.removeEventListener('online', listener);
  };
}

export interface GuideStats {
  accepted: number;
  shown: number;
  gptLines: number;
  localLines: number;
  cachedLines: number;
  droppedCooldown: number;
  droppedBusy: number;
  droppedStale: number;
  droppedPaused: number;
  gptRequests: number;
  gptFailures: number;
}

interface Ticket {
  seq: number;
  event: GuideEvent;
  priority: number;
  roundId: number;
  lang: Lang;
  themeVersion: number;
  abort: AbortController;
  showing: boolean;
  displayElapsed: boolean;
  speechPending: boolean;
  displayTimer: ReturnType<typeof setTimeout> | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  playback: SpeechPlayback | null;
}

interface ServerInfo {
  state: 'unknown' | 'probing' | 'ok' | 'unreachable';
  status: StatusResponseBody | null;
  at: number;
}

/**
 * Momo's language. Default ('en'): she speaks and writes English whatever the
 * interface language; 'ui' follows the interface. Local lines, GPT lines and
 * the voice all use this language; the rest of the UI keeps its own.
 */
export function guideLanguage(settings: Pick<AiSettings, 'voiceLanguage'>, uiLang: Lang): Lang {
  return settings.voiceLanguage === 'ui' ? uiLang : 'en';
}
const resolveLang = (cfg: GuideConfig): Lang => guideLanguage(cfg.settings, cfg.uiLang);
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/* ---------------------------------------------------------------- director */

export class GuideDirector implements GuidePort {
  private cfg: GuideConfig | null = null;
  private lang: Lang = 'en';
  private readonly listeners = new Set<(line: GuideLine | null, status: GuideStatus) => void>();
  private line: GuideLine | null = null;
  private active: Ticket | null = null;
  private pending: { event: GuideEvent; priority: number; expiresAt: number } | null = null;
  private seq = 0;
  private lineCounter = 0;
  private minRoundId = Number.NEGATIVE_INFINITY;
  private paused = false;
  private disposed = false;
  private readonly lastAcceptedAt = new Map<GuideEventType, number>();
  private lastLineEndAt = Number.NEGATIVE_INFINITY;
  private recent: string[] = [];
  private server: ServerInfo = { state: 'unknown', status: null, at: Number.NEGATIVE_INFINITY };
  private probePromise: Promise<StatusResponseBody | null> | null = null;
  /** Identifies the newest probe: answers of older ones no longer change the state. */
  private probeSeq = 0;
  /** Failed probes in the current series (0 = next probe starts a new series). */
  private probeAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt: number | null = null;
  /** True once the status endpoint answered at least once. */
  private serverAnswered = false;
  private lastWakeProbeAt = Number.NEGATIVE_INFINITY;
  private readonly offWake: Unsubscribe | null;
  private connection: GuideConnection = 'off';
  private detail = 'Guide not configured yet';
  private lastLatencyMs: number | null = null;
  /** True once a real GPT round trip succeeded with the current server. */
  private gptVerified = false;
  private gptFailuresInRow = 0;
  private gptPausedUntil = Number.NEGATIVE_INFINITY;
  /** Speech path that really produced sound most recently (under the current voice settings). */
  private lastVoice: SpeechPath | null = null;
  private previewAbort: AbortController | null = null;

  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly fetchImpl: typeof fetch | null;
  private readonly baseUrl: string;
  private readonly cache: LineCache;
  private readonly router: SpeechRouter;
  private readonly aiSpeech: (SpeechProvider & { reset(): void }) | null;
  private readonly stats: GuideStats = {
    accepted: 0,
    shown: 0,
    gptLines: 0,
    localLines: 0,
    cachedLines: 0,
    droppedCooldown: 0,
    droppedBusy: 0,
    droppedStale: 0,
    droppedPaused: 0,
    gptRequests: 0,
    gptFailures: 0,
  };

  constructor(private readonly deps: GuideDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.rng = deps.rng ?? Math.random;
    const globalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
    this.fetchImpl = deps.fetchImpl ?? globalFetch;
    this.baseUrl = (deps.baseUrl ?? '').replace(/\/+$/, '');
    this.cache = new LineCache(deps.storage === undefined ? undefined : deps.storage);

    const defaultAi = this.fetchImpl
      ? createAiSpeech({
          audio: deps.audio,
          fetchImpl: this.fetchImpl,
          baseUrl: this.baseUrl,
          now: this.now,
          eligible: () => this.aiVoiceEligible(),
          timeoutMs: () => Math.min(6000, Math.max(2500, (this.cfg?.settings.timeoutMs ?? 2500) + 1500)),
          onResult: (info) => this.onAiSpeechResult(info),
        })
      : null;
    this.aiSpeech = deps.speech?.ai ? null : defaultAi;
    const unavailable = (path: SpeechPath): SpeechProvider => ({ path, available: () => false, speak: async () => null });
    this.router = new SpeechRouter(
      {
        ai: deps.speech?.ai ?? defaultAi ?? unavailable('ai'),
        system: deps.speech?.system ?? createSystemSpeech({ audio: deps.audio, volume: () => this.cfg?.voiceVolume ?? 1 }),
        babble: deps.speech?.babble ?? createBabbleSpeech(deps.audio),
      },
      this.now,
    );
    const wake = deps.onWake === undefined ? browserWake : deps.onWake;
    this.offWake = wake ? wake(() => this.onWake()) : null;
  }

  /* ------------------------------------------------------- configuration */

  configure(cfg: GuideConfig): void {
    if (this.disposed) return;
    const previous = this.cfg;
    const previousLang = this.lang;
    this.cfg = cfg;
    this.lang = resolveLang(cfg);
    this.cache.setMode(cfg.settings.cache);

    const s = cfg.settings;
    const p = previous?.settings;
    if (!p || p.voice !== s.voice || p.localVoice !== s.localVoice || p.provider !== s.provider || previousLang !== this.lang) {
      this.lastVoice = null;
      this.aiSpeech?.reset();
    }
    if (!p || p.provider !== s.provider || p.model !== s.model || p.enabled !== s.enabled) {
      this.gptFailuresInRow = 0;
      this.gptPausedUntil = Number.NEGATIVE_INFINITY;
    }

    if (!s.enabled) {
      this.pending = null;
      this.cancelActive();
      this.setConnection('off', 'AI guide is switched off');
      return;
    }
    // Anything in flight for the old language or theme is stale now.
    if (this.active && (this.active.lang !== this.lang || this.active.themeVersion !== cfg.themeVersion)) {
      this.stats.droppedStale++;
      this.cancelActive();
    }
    if (this.pending && previous && (previousLang !== this.lang || previous.themeVersion !== cfg.themeVersion)) {
      this.pending = null;
    }

    if (s.provider === 'local') {
      this.setConnection('local', 'Local lines selected in settings');
    } else if (!this.fetchImpl) {
      this.setConnection('local', 'No network API in this environment: local lines');
    } else if (this.server.state === 'unknown' || (p && p.provider !== s.provider) || (p && !p.enabled)) {
      void this.probe(true);
    } else {
      this.applyServerState();
    }
    this.emit();
  }

  /* -------------------------------------------------------------- events */

  handle(event: GuideEvent): void {
    const cfg = this.cfg;
    if (this.disposed || !cfg || !cfg.settings.enabled) return;
    if (this.paused) {
      this.stats.droppedPaused++;
      return;
    }
    if (event.roundId < this.minRoundId) {
      this.stats.droppedStale++;
      return;
    }
    const priority = GUIDE_PRIORITY[event.type];
    if (priority === undefined) return;
    const now = this.now();
    const scale = FREQUENCY_SCALE[cfg.settings.frequency] ?? 1;
    const last = this.lastAcceptedAt.get(event.type);
    if (last !== undefined && now - last < GUIDE_COOLDOWN_MS[event.type] * scale) {
      this.stats.droppedCooldown++;
      return;
    }
    if (priority < FEEDBACK_PRIORITY && now - this.lastLineEndAt < CHATTER_GAP_MS * scale) {
      this.stats.droppedCooldown++;
      return;
    }

    if (this.active) {
      const current = this.active.priority;
      const replaces = priority > current || (priority === current && priority >= RESULT_PRIORITY);
      if (!replaces) {
        // Round feedback may wait for one slot; hints and idle chatter are simply dropped.
        if (priority >= FEEDBACK_PRIORITY && priority === current && (!this.pending || priority >= this.pending.priority)) {
          this.lastAcceptedAt.set(event.type, now);
          this.pending = { event, priority, expiresAt: now + PENDING_TTL_MS };
        } else {
          this.stats.droppedBusy++;
        }
        return;
      }
      if (this.pending && this.pending.priority < priority) this.pending = null;
      this.cancelActive();
    }

    this.lastAcceptedAt.set(event.type, now);
    this.start(event, priority);
  }

  invalidateBefore(roundId: number): void {
    if (roundId > this.minRoundId) this.minRoundId = roundId;
    if (this.pending && this.pending.event.roundId < this.minRoundId) this.pending = null;
    if (this.active && this.active.roundId < this.minRoundId) {
      this.stats.droppedStale++;
      this.cancelActive();
    }
  }

  silence(): void {
    this.pending = null;
    this.previewAbort?.abort();
    this.previewAbort = null;
    this.cancelActive();
    this.router.stop();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    // Pausing drops the current line for good: nothing is replayed after resuming.
    if (paused) this.silence();
  }

  /* -------------------------------------------------------------- status */

  status(): GuideStatus {
    const cfg = this.cfg;
    const server = this.server.status;
    const usesServer = !!cfg && cfg.settings.enabled && cfg.settings.provider === 'openai' && !!server?.configured;
    const clientModels = usesServer && server!.allowClientPrompt && !server!.adminProtected;
    return {
      connection: this.connection,
      detail: this.detail,
      textModel: usesServer ? (clientModels && cfg!.settings.model) || server!.textModel : null,
      speechModel: usesServer ? (clientModels && cfg!.settings.speechModel) || server!.speechModel : null,
      voice: this.currentVoice(),
      lastLatencyMs: this.lastLatencyMs,
    };
  }

  currentLine(): GuideLine | null {
    return this.line;
  }

  subscribe(listener: (line: GuideLine | null, status: GuideStatus) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Counters for diagnostics and tests. */
  debugStats(): GuideStats {
    return { ...this.stats };
  }

  /** Last server status seen (never contains secrets), for the settings panel. */
  serverStatus(): StatusResponseBody | null {
    return this.server.status;
  }

  /**
   * Asks the server again right away, e.g. after the OpenAI key was replaced
   * or restored in Settings. Never throws.
   */
  refreshServerStatus(): Promise<StatusResponseBody | null> {
    if (this.disposed) return Promise.resolve(null);
    this.gptVerified = false;
    this.gptFailuresInRow = 0;
    this.gptPausedUntil = Number.NEGATIVE_INFINITY;
    return this.probe(true);
  }

  /* ------------------------------------------------------- connection test */

  async testConnection(): Promise<{ ok: boolean; detail: string; latencyMs: number | null; sample?: string }> {
    const cfg = this.cfg;
    if (this.disposed || !cfg) return { ok: false, detail: 'Guide is not configured yet', latencyMs: null };
    if (!this.fetchImpl) return { ok: false, detail: 'No network API in this environment', latencyMs: null };
    const status = await this.probe(true);
    if (!status) return { ok: false, detail: 'AI server is not reachable; local lines are in use', latencyMs: null };
    if (!status.configured) {
      return { ok: false, detail: 'The server has no OpenAI API key; local lines are in use', latencyMs: null };
    }
    const started = this.now();
    const fail = (detail: string) => {
      this.gptVerified = false;
      if (cfg.settings.enabled && cfg.settings.provider === 'openai') this.setConnection('error', detail);
      return { ok: false, detail, latencyMs: this.now() - started };
    };
    const succeed = (model: string, latencyMs: number, sample: string | undefined) => {
      this.gptVerified = true;
      this.gptFailuresInRow = 0;
      this.gptPausedUntil = Number.NEGATIVE_INFINITY;
      this.lastLatencyMs = latencyMs;
      const detail = `${model} replied in ${Math.round(latencyMs)} ms`;
      if (cfg.settings.enabled && cfg.settings.provider === 'openai') this.setConnection('gpt', detail);
      return { ok: true, detail, latencyMs, sample };
    };
    try {
      const response = await this.fetchJson('/api/ai/test', { speech: false, lang: this.lang }, 12_000);
      if (response.status === 401 || response.status === 403) {
        // The test endpoint is admin-only on this server: verify with an ordinary line request instead.
        const line = await this.fetchJson('/api/ai/line', this.buildLineBody(this.syntheticTipEvent(), cfg), 12_000);
        if (line.ok) {
          const body = line.body as LineResponseBody;
          return succeed(body.model, body.latencyMs ?? this.now() - started, body.text);
        }
        return fail(`Line request failed (${this.errorCode(line.body, line.status)})`);
      }
      const body = response.body as TestResponseBody | null;
      if (response.ok && body?.ok && body.text?.ok) return succeed(body.text.model, body.text.latencyMs, body.text.sample);
      const code = body?.text?.code ?? body?.code ?? this.errorCode(response.body, response.status);
      return fail(`Connection test failed (${code})`);
    } catch {
      return fail('Connection test failed (network error)');
    }
  }

  async previewVoice(): Promise<{ ok: boolean; detail: string }> {
    const cfg = this.cfg;
    if (this.disposed || !cfg) return { ok: false, detail: 'Guide is not configured yet' };
    this.silence();
    const order = this.speechOrder();
    if (order.length === 0) return { ok: false, detail: 'No voice selected (subtitles only)' };
    const abort = new AbortController();
    this.previewAbort = abort;
    const playback = await this.router.speak(order, {
      text: PREVIEW_TEXT[this.lang],
      lang: this.lang,
      emotion: 'happy',
      speed: cfg.settings.voiceSpeed,
      voiceName: cfg.settings.voiceName,
      model: cfg.settings.speechModel,
      signal: abort.signal,
    });
    if (!playback) {
      if (this.previewAbort === abort) this.previewAbort = null;
      return { ok: false, detail: 'No voice could play on this device (subtitles only)' };
    }
    this.lastVoice = playback.path;
    this.emit();
    void playback.done.then(() => {
      if (this.previewAbort === abort) this.previewAbort = null;
    });
    const label = playback.path === 'ai' ? 'AI voice (OpenAI)' : playback.path === 'system' ? 'System voice' : 'Momo babble voice';
    return { ok: true, detail: label };
  }

  dispose(): void {
    if (this.disposed) return;
    this.silence();
    this.clearRetry();
    this.offWake?.();
    this.disposed = true;
    this.listeners.clear();
  }

  /* ------------------------------------------------------------ internals */

  private start(event: GuideEvent, priority: number): void {
    const cfg = this.cfg!;
    this.stats.accepted++;
    const ticket: Ticket = {
      seq: ++this.seq,
      event,
      priority,
      roundId: event.roundId,
      lang: this.lang,
      themeVersion: cfg.themeVersion,
      abort: new AbortController(),
      showing: false,
      displayElapsed: false,
      speechPending: false,
      displayTimer: null,
      lingerTimer: null,
      playback: null,
    };
    this.active = ticket;

    const key = this.cacheKeyFor(event, cfg);
    if (!this.gptUsable()) {
      this.maybeReprobe();
      this.presentLocal(ticket);
      return;
    }
    if (this.now() < this.gptPausedUntil) {
      // Recent requests kept failing: answer at once from the cache / local bank.
      this.presentFallback(ticket, key);
      return;
    }
    if (priority < RESULT_PRIORITY) {
      const cached = this.freshCached(key);
      if (cached.length >= CACHE_VARIANTS_FOR_CHATTER) {
        this.presentCached(ticket, cached);
        return;
      }
    }
    void this.requestGpt(ticket, key);
  }

  private async requestGpt(ticket: Ticket, key: string): Promise<void> {
    const cfg = this.cfg!;
    const timeoutMs = cfg.settings.timeoutMs;
    const started = this.now();
    // The request has its own abort handle so that a timeout does not cancel the ticket itself.
    const request = new AbortController();
    const onTicketAbort = () => request.abort();
    ticket.abort.signal.addEventListener('abort', onTicketAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    this.stats.gptRequests++;
    const call = (async () => {
      const response = await this.fetchImpl!(`${this.baseUrl}/api/ai/line`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.buildLineBody(ticket.event, cfg)),
        signal: request.signal,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { kind: 'reply' as const, ok: response.ok, status: response.status, body };
    })().catch(() => ({ kind: 'failed' as const }));

    const outcome = await Promise.race([call, timeout]);
    if (timer) clearTimeout(timer);
    ticket.abort.signal.removeEventListener('abort', onTicketAbort);
    if (outcome.kind === 'timeout') request.abort();

    if (!this.isCurrent(ticket)) {
      this.dropStale(ticket);
      return;
    }
    if (outcome.kind === 'timeout') {
      this.failGpt(ticket, key, `No reply within ${timeoutMs} ms: local line used`);
      return;
    }
    if (outcome.kind === 'failed') {
      // Network failure: stop asking until a status probe sees the server again.
      this.server = { state: 'unreachable', status: null, at: this.now() };
      this.failGpt(ticket, key, 'AI server unreachable: local line used');
      return;
    }
    const { body } = outcome;
    if (outcome.ok && body && typeof (body as LineResponseBody).text === 'string') {
      const reply = body as LineResponseBody;
      const fitted = fitLine(reply.text, ticket.lang, cfg.settings.length);
      if (!fitted) {
        this.failGpt(ticket, key, 'Reply did not pass the length check: local line used');
        return;
      }
      const emotion: GuideEmotion = (GUIDE_EMOTIONS as readonly string[]).includes(reply.emotion) ? reply.emotion : 'happy';
      const line: CachedLine = { text: fitted.text, emotion, shouldSpeak: reply.shouldSpeak !== false };
      this.gptVerified = true;
      this.gptFailuresInRow = 0;
      this.lastLatencyMs = this.now() - started;
      this.setConnection('gpt', `${reply.model || 'GPT'} replied in ${Math.round(this.lastLatencyMs)} ms`, false);
      this.cache.add(key, line);
      if (this.recent.includes(normalize(line.text))) {
        // The model repeated itself: prefer something the player has not just heard.
        this.presentFallback(ticket, key);
      } else {
        this.stats.gptLines++;
        this.present(ticket, line, 'gpt');
      }
      return;
    }
    const code = this.errorCode(body, outcome.status);
    if (code === 'no_key') {
      if (this.server.status) this.server.status = { ...this.server.status, configured: false };
      this.gptVerified = false;
      this.setConnection('local', 'The server has no OpenAI API key: local lines', false);
      this.presentFallback(ticket, key);
      return;
    }
    this.failGpt(ticket, key, `Line request failed (${code}): local line used`);
  }

  private failGpt(ticket: Ticket, key: string, detail: string): void {
    this.stats.gptFailures++;
    this.gptVerified = false;
    this.gptFailuresInRow++;
    if (this.gptFailuresInRow >= GPT_FAILURES_BEFORE_PAUSE) {
      // Do not make the player wait for a timeout on every single line.
      this.gptPausedUntil = this.now() + GPT_PAUSE_MS;
      this.gptFailuresInRow = 0;
      detail = `${detail} | GPT paused for ${Math.round(GPT_PAUSE_MS / 1000)} s after repeated failures`;
    }
    this.setConnection('error', detail, false);
    this.presentFallback(ticket, key);
  }

  /** Prefer a cached GPT line for the same situation, otherwise a local line. */
  private presentFallback(ticket: Ticket, key: string): void {
    const cached = this.freshCached(key);
    if (cached.length > 0) this.presentCached(ticket, cached);
    else this.presentLocal(ticket);
  }

  private presentCached(ticket: Ticket, cached: CachedLine[]): void {
    const pick = cached[Math.min(cached.length - 1, Math.floor(this.rng() * cached.length))]!;
    this.stats.cachedLines++;
    this.present(ticket, pick, 'gpt');
  }

  private presentLocal(ticket: Ticket): void {
    const local = pickLocalLine(ticket.event, ticket.lang, { recent: this.recent, rng: this.rng });
    this.stats.localLines++;
    this.present(ticket, { text: local.text, emotion: local.emotion, shouldSpeak: true }, 'local');
  }

  private present(ticket: Ticket, content: CachedLine, source: GuideSource): void {
    if (this.active !== ticket) return;
    const cfg = this.cfg!;
    ticket.showing = true;
    this.stats.shown++;
    this.recent.push(normalize(content.text));
    if (this.recent.length > RECENT_LINES) this.recent.shift();
    this.line = {
      id: `momo-${++this.lineCounter}`,
      text: content.text,
      emotion: content.emotion,
      source,
      eventType: ticket.event.type,
      roundId: ticket.roundId,
      lang: ticket.lang,
      speaking: false,
      voice: 'none',
    };
    ticket.displayTimer = setTimeout(() => {
      ticket.displayTimer = null;
      ticket.displayElapsed = true;
      this.maybeFinish(ticket);
    }, displayDurationMs(content.text, ticket.lang));
    this.emit();
    if (cfg.settings.voice && content.shouldSpeak) void this.speak(ticket, content);
  }

  private async speak(ticket: Ticket, content: CachedLine): Promise<void> {
    const cfg = this.cfg!;
    const order = this.speechOrder();
    if (order.length === 0) return;
    ticket.speechPending = true;
    const playback = await this.router.speak(order, {
      text: content.text,
      lang: ticket.lang,
      emotion: content.emotion,
      speed: cfg.settings.voiceSpeed,
      voiceName: cfg.settings.voiceName,
      model: cfg.settings.speechModel,
      signal: ticket.abort.signal,
    });
    if (this.active !== ticket || !this.line) {
      playback?.stop();
      return;
    }
    if (!playback) {
      ticket.speechPending = false;
      this.maybeFinish(ticket);
      return;
    }
    ticket.playback = playback;
    this.lastVoice = playback.path;
    this.line = { ...this.line, speaking: true, voice: playback.path };
    this.emit();
    void playback.done.then(() => {
      if (this.active !== ticket) return;
      ticket.playback = null;
      if (this.line) {
        this.line = { ...this.line, speaking: false };
        this.emit();
      }
      ticket.lingerTimer = setTimeout(() => {
        ticket.lingerTimer = null;
        ticket.speechPending = false;
        this.maybeFinish(ticket);
      }, AFTER_SPEECH_MS);
    });
  }

  private maybeFinish(ticket: Ticket): void {
    if (this.active !== ticket) return;
    if (!ticket.displayElapsed || ticket.speechPending) return;
    this.clearTicket(ticket);
    this.active = null;
    this.line = null;
    this.lastLineEndAt = this.now();
    this.emit();
    this.startPending();
  }

  private startPending(): void {
    const pending = this.pending;
    if (!pending || this.active || this.paused || this.disposed) return;
    this.pending = null;
    if (!this.cfg?.settings.enabled) return;
    if (this.now() > pending.expiresAt || pending.event.roundId < this.minRoundId) {
      this.stats.droppedStale++;
      return;
    }
    this.start(pending.event, pending.priority);
  }

  private clearTicket(ticket: Ticket): void {
    if (ticket.displayTimer) clearTimeout(ticket.displayTimer);
    if (ticket.lingerTimer) clearTimeout(ticket.lingerTimer);
    ticket.displayTimer = null;
    ticket.lingerTimer = null;
  }

  /** Aborts the active line (request, audio, subtitle). */
  private cancelActive(): void {
    const ticket = this.active;
    if (!ticket) return;
    this.active = null;
    this.clearTicket(ticket);
    ticket.abort.abort();
    ticket.playback?.stop();
    this.router.stop();
    const hadLine = this.line !== null;
    this.line = null;
    if (hadLine) {
      this.lastLineEndAt = this.now();
      this.emit();
    }
  }

  private dropStale(ticket: Ticket): void {
    this.stats.droppedStale++;
    if (this.active === ticket) {
      this.clearTicket(ticket);
      this.active = null;
      if (this.line) {
        this.line = null;
        this.emit();
      }
    }
  }

  /** A response may only be shown if nothing it depended on changed meanwhile. */
  private isCurrent(ticket: Ticket): boolean {
    const cfg = this.cfg;
    return (
      !this.disposed &&
      !this.paused &&
      !!cfg &&
      cfg.settings.enabled &&
      this.active === ticket &&
      ticket.roundId >= this.minRoundId &&
      ticket.lang === this.lang &&
      ticket.themeVersion === cfg.themeVersion
    );
  }

  private gptUsable(): boolean {
    const cfg = this.cfg;
    return !!cfg && !!this.fetchImpl && cfg.settings.provider === 'openai' && this.server.status?.configured === true;
  }

  private aiVoiceEligible(): boolean {
    const status = this.server.status;
    return this.gptUsable() && !!status && !status.speechConfigError;
  }

  private speechOrder(): SpeechPath[] {
    const cfg = this.cfg;
    if (!cfg) return [];
    const order: SpeechPath[] = [];
    if (this.aiVoiceEligible()) order.push('ai');
    if (cfg.settings.localVoice === 'system') order.push('system', 'babble');
    else if (cfg.settings.localVoice === 'babble') order.push('babble');
    return order;
  }

  /**
   * Speech path really in use. 'ai' is only reported after OpenAI audio has
   * actually played; before anything was spoken this is the local path that
   * would be used.
   */
  private currentVoice(): GuideStatus['voice'] {
    const cfg = this.cfg;
    if (!cfg || !cfg.settings.enabled || !cfg.settings.voice) return 'none';
    if (this.lastVoice) return this.lastVoice;
    const local = this.router.usable(
      this.speechOrder().filter((path) => path !== 'ai'),
      this.lang,
    );
    return local[0] ?? 'none';
  }

  private onAiSpeechResult(info: AiSpeechInfo): void {
    if (!info.ok && this.connection === 'gpt') {
      // Text works but the voice does not: say so without flipping the text status.
      this.detail = `${this.detail.split(' | ')[0]} | ${info.detail}`;
      this.emit();
    }
  }

  private cacheKeyFor(event: GuideEvent, cfg: GuideConfig): string {
    return lineCacheKey({
      event,
      lang: this.lang,
      theme: cfg.themeId,
      length: cfg.settings.length,
      model: cfg.settings.model,
      promptText: `${cfg.settings.systemPrompt}\n${cfg.settings.personality}`,
    });
  }

  private freshCached(key: string): CachedLine[] {
    return this.cache.get(key).filter((line) => !this.recent.includes(normalize(line.text)));
  }

  private buildLineBody(event: GuideEvent, cfg: GuideConfig): LineRequestBody {
    const s = cfg.settings;
    const body: LineRequestBody = {
      event: { type: event.type, facts: sanitizeFacts(event.facts) },
      theme: event.themeId,
      lang: this.lang,
      recentLines: this.recent.slice(-4),
      length: s.length,
      temperature: s.temperature,
      timeoutMs: s.timeoutMs,
    };
    if (s.personality.trim() && s.personality.trim() !== DEFAULT_PERSONA) body.persona = s.personality.trim();
    if (s.systemPrompt.trim() && s.systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT) body.systemPrompt = s.systemPrompt.trim();
    if (s.model.trim()) body.model = s.model.trim();
    return body;
  }

  private syntheticTipEvent(): GuideEvent {
    return {
      type: 'user_requested_tip',
      roundId: Math.max(0, Number.isFinite(this.minRoundId) ? this.minRoundId : 0),
      themeId: this.cfg!.themeId,
      facts: { phase: 'READY', demo: false, attempts: 0, wins: 0, lossStreak: 0 },
    };
  }

  private errorCode(body: unknown, status: number): string {
    const code = (body as ApiErrorBody | null)?.error?.code;
    return typeof code === 'string' && code ? code : `HTTP ${status}`;
  }

  private async fetchJson(
    path: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl!(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { ok: response.ok, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Asks the server whether a key is configured. Never throws.
   * `force` starts a new probe even while one is in flight; `continueSeries`
   * is used by the retry timer (otherwise the retry count starts from zero).
   */
  private probe(force = false, continueSeries = false): Promise<StatusResponseBody | null> {
    if (!this.fetchImpl) return Promise.resolve(null);
    if (this.probePromise && !force) return this.probePromise;
    this.clearRetry();
    if (!continueSeries) this.probeAttempt = 0;
    const cfg = this.cfg;
    if (cfg?.settings.enabled && cfg.settings.provider === 'openai' && this.connection !== 'gpt') {
      this.setConnection('checking', 'Asking the server whether GPT is configured');
    }
    this.server.state = 'probing';
    const seq = ++this.probeSeq;
    const attempt = this.probeAttempt;
    const timeoutMs = !this.serverAnswered && attempt === 0 ? STATUS_FIRST_TIMEOUT_MS : STATUS_TIMEOUT_MS;
    const run = async (): Promise<{ status: StatusResponseBody | null; retry: boolean }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl!(`${this.baseUrl}/api/ai/status`, { signal: controller.signal });
        // 404: there is no API server behind this page at all (static hosting): no point in retrying.
        if (response.status === 404) return { status: null, retry: false };
        const body = (await response.json()) as StatusResponseBody;
        if (!response.ok || typeof body?.configured !== 'boolean') return { status: null, retry: true };
        return { status: body, retry: false };
      } catch {
        return { status: null, retry: true };
      } finally {
        clearTimeout(timer);
      }
    };
    const promise = run().then(({ status, retry }) => {
      if (this.probePromise === promise) this.probePromise = null;
      // A newer probe owns the state now.
      if (seq !== this.probeSeq || this.disposed) return status;
      if (status) {
        const previous = this.server.status;
        const keyChanged =
          previous?.credential?.fingerprint !== status.credential?.fingerprint || previous?.credential?.source !== status.credential?.source;
        if (previous?.configured !== status.configured || previous?.textModel !== status.textModel || keyChanged) this.gptVerified = false;
        this.server = { state: 'ok', status, at: this.now() };
        this.serverAnswered = true;
        this.probeAttempt = 0;
      } else {
        this.server = { state: 'unreachable', status: null, at: this.now() };
        this.gptVerified = false;
        if (retry && attempt < STATUS_RETRY_DELAYS_MS.length && this.wantsServer()) {
          const delay = STATUS_RETRY_DELAYS_MS[attempt]!;
          this.probeAttempt = attempt + 1;
          this.retryAt = this.now() + delay;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.retryAt = null;
            void this.probe(true, true);
          }, delay);
        } else {
          this.probeAttempt = 0;
        }
      }
      this.applyServerState();
      return status;
    });
    this.probePromise = promise;
    return promise;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  /** True when the settings ask for GPT, so the server's answer matters. */
  private wantsServer(): boolean {
    const cfg = this.cfg;
    return !!cfg && cfg.settings.enabled && cfg.settings.provider === 'openai' && !!this.fetchImpl && !this.disposed;
  }

  /** Tab visible again / network back: ask again if the last answer is missing or old. */
  private onWake(): void {
    if (!this.wantsServer() || this.probePromise) return;
    const now = this.now();
    if (now - this.lastWakeProbeAt < WAKE_REPROBE_GAP_MS) return;
    if (this.server.state === 'ok' && now - this.server.at < REPROBE_AFTER_MS) return;
    this.lastWakeProbeAt = now;
    void this.probe(true);
  }

  private maybeReprobe(): void {
    const cfg = this.cfg;
    if (!cfg || cfg.settings.provider !== 'openai' || !this.fetchImpl || this.probePromise || this.retryTimer) return;
    if (this.now() - this.server.at >= REPROBE_AFTER_MS) void this.probe();
  }

  /** Derives the connection state from settings + what the server told us. */
  private applyServerState(): void {
    const cfg = this.cfg;
    if (!cfg) return;
    if (!cfg.settings.enabled) {
      this.setConnection('off', 'AI guide is switched off');
      return;
    }
    if (cfg.settings.provider === 'local') {
      this.setConnection('local', 'Local lines selected in settings');
      return;
    }
    const { state, status } = this.server;
    if (state === 'probing' || state === 'unknown') {
      if (this.connection !== 'gpt') this.setConnection('checking', 'Asking the server whether GPT is configured');
      return;
    }
    if (state === 'unreachable' || !status) {
      if (this.retryAt !== null) {
        // Not settled yet: the page or the server may just have been busy (boot, sleep, network change).
        const seconds = Math.max(1, Math.round((this.retryAt - this.now()) / 1000));
        this.setConnection('checking', `AI server did not answer yet; asking again in ${seconds} s (local lines meanwhile)`);
        return;
      }
      this.setConnection('local', 'AI server not reachable: local lines');
      return;
    }
    if (!status.configured) {
      this.setConnection('local', 'The server has no OpenAI API key: local lines');
      return;
    }
    if (this.gptVerified) {
      if (this.connection !== 'gpt') this.setConnection('gpt', `GPT connected (${status.textModel})`);
      return;
    }
    if (this.connection !== 'error') {
      // A key exists, but nothing has proven yet that OpenAI accepts it.
      this.setConnection('checking', `Key configured (${status.textModel}); not verified by a reply yet`);
    }
  }

  private setConnection(connection: GuideConnection, detail: string, notify = true): void {
    if (this.connection === connection && this.detail === detail) return;
    this.connection = connection;
    this.detail = detail;
    if (notify) this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    const status = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(this.line, status);
      } catch (error) {
        console.error('[guide] listener threw', error);
      }
    }
  }
}
