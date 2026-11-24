import type { AudioPort } from '../../core/contracts';
import type { Lang } from '../../core/types';
import type { SpeechPlayback, SpeechProvider, SpeechRequest } from './types';

const BCP47: Record<Lang, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };
const LANG_PREFIXES: Record<Lang, string[]> = { en: ['en'], zh: ['zh', 'cmn'], ja: ['ja'] };
const START_TIMEOUT_MS = 1800;

export interface SystemSpeechDeps {
  audio: AudioPort | null;
  /** 0..1; the system voice does not pass through the audio engine, so its volume is set here. */
  volume: () => number;
  /** Injectable for tests; defaults to the browser's speechSynthesis. */
  synth?: SpeechSynthesis | null;
}

function findSynth(): SpeechSynthesis | null {
  const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
  return g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function' ? g.speechSynthesis : null;
}

/**
 * The operating system's text-to-speech voice (Web Speech API). Availability
 * depends on the device: many kiosks have no Chinese or Japanese voice, in
 * which case `available()` is false and the router moves on.
 */
export function createSystemSpeech(deps: SystemSpeechDeps): SpeechProvider {
  const synth = deps.synth === undefined ? findSynth() : deps.synth;
  let voices: SpeechSynthesisVoice[] = [];
  const refresh = () => {
    try {
      voices = synth?.getVoices() ?? [];
    } catch {
      voices = [];
    }
  };
  refresh();
  // Chrome fills the voice list asynchronously.
  try {
    synth?.addEventListener?.('voiceschanged', refresh);
  } catch {
    /* older engines without addEventListener on speechSynthesis */
  }

  const pickVoice = (lang: Lang): SpeechSynthesisVoice | null => {
    if (voices.length === 0) refresh();
    const matches = voices.filter((v) => LANG_PREFIXES[lang].some((p) => v.lang.toLowerCase().startsWith(p)));
    if (matches.length === 0) return null;
    // Prefer an exact locale, then on-device voices (they start faster and work offline).
    const exact = matches.filter((v) => v.lang.toLowerCase() === BCP47[lang].toLowerCase());
    const pool = exact.length > 0 ? exact : matches;
    return pool.find((v) => v.localService) ?? pool[0] ?? null;
  };

  return {
    path: 'system',
    available(lang: Lang) {
      return synth !== null && pickVoice(lang) !== null;
    },
    speak(request: SpeechRequest): Promise<SpeechPlayback | null> {
      return new Promise((resolveStart) => {
        const voice = synth ? pickVoice(request.lang) : null;
        if (!synth || !voice || request.signal.aborted) {
          resolveStart(null);
          return;
        }
        let started = false;
        let finished = false;
        let resolveDone: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(startTimer);
          request.signal.removeEventListener('abort', stop);
          if (started) deps.audio?.setVoiceActive(false);
          resolveDone();
          if (!started) resolveStart(null);
        };
        const stop = () => {
          try {
            synth.cancel();
          } catch {
            /* ignore */
          }
          finish();
        };
        let utterance: SpeechSynthesisUtterance;
        try {
          utterance = new SpeechSynthesisUtterance(request.text);
          utterance.voice = voice;
          utterance.lang = voice.lang || BCP47[request.lang];
          utterance.rate = Math.min(1.6, Math.max(0.6, request.speed * 1.05));
          utterance.pitch = 1.35; // a little higher: Momo is small
          utterance.volume = Math.min(1, Math.max(0, deps.volume()));
        } catch {
          resolveStart(null);
          return;
        }
        utterance.onstart = () => {
          if (finished) return;
          started = true;
          clearTimeout(startTimer);
          deps.audio?.setVoiceActive(true);
          resolveStart({ path: 'system', done, stop });
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        // Some engines never fire `start` (no audio device, blocked autoplay): give up and fall through.
        const startTimer = setTimeout(() => {
          if (!started) stop();
        }, START_TIMEOUT_MS);
        request.signal.addEventListener('abort', stop, { once: true });
        try {
          synth.cancel(); // drop anything stale from an earlier line
          synth.speak(utterance);
        } catch {
          finish();
        }
      });
    },
  };
}
