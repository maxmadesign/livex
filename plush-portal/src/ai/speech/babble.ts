import type { AudioPort } from '../../core/contracts';
import { planBabble, renderBabble } from './babbleSynth';
import type { SpeechPlayback, SpeechProvider, SpeechRequest } from './types';

const BABBLE_SAMPLE_RATE = 24000;

/**
 * Plays the synthesised mascot voice on the audio engine's voice bus. The
 * engine applies the voice volume; `setVoiceActive` holds the music duck while
 * the babble is audible.
 */
export function createBabbleSpeech(audio: AudioPort | null): SpeechProvider {
  return {
    path: 'babble',
    available() {
      return audio !== null && audio.voiceBus() !== null;
    },
    async speak(request: SpeechRequest): Promise<SpeechPlayback | null> {
      if (!audio || request.signal.aborted) return null;
      const bus = audio.voiceBus();
      if (!bus) return null;
      try {
        const plan = planBabble(request.text, request.lang, { emotion: request.emotion, speed: request.speed });
        if (plan.syllables.length === 0) return null;
        const samples = renderBabble(plan, BABBLE_SAMPLE_RATE);
        const { context, input } = bus;
        const buffer = context.createBuffer(1, samples.length, BABBLE_SAMPLE_RATE);
        buffer.getChannelData(0).set(samples);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        // The tone is dense; keep it a little under the level of a recorded voice.
        gain.gain.value = 0.8;
        source.connect(gain);
        gain.connect(input);

        let finished = false;
        let resolveDone: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });
        const finish = () => {
          if (finished) return;
          finished = true;
          request.signal.removeEventListener('abort', stop);
          try {
            source.disconnect();
            gain.disconnect();
          } catch {
            /* already disconnected */
          }
          audio.setVoiceActive(false);
          resolveDone();
        };
        const stop = () => {
          try {
            source.stop();
          } catch {
            /* not started or already stopped */
          }
          finish();
        };
        source.onended = finish;
        request.signal.addEventListener('abort', stop, { once: true });
        audio.setVoiceActive(true);
        source.start();
        return { path: 'babble', done, stop };
      } catch {
        // Context closed, buffer creation refused, ...: let the router fall through.
        audio.setVoiceActive(false);
        return null;
      }
    },
  };
}
