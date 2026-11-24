/** Minimal RIFF/WAVE (16-bit PCM) writer and reader. Pure: works on Uint8Array, no Node APIs. */
import { SR } from './core';

/** Deterministic TPDF dither keeps quiet tails clean at 16 bit. */
function ditherer(seed: number): () => number {
  let a = seed >>> 0;
  const next = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
  return () => next() - next();
}

export function encodeWav16(channels: Float32Array[], sampleRate = SR): Uint8Array {
  const numCh = channels.length;
  const frames = channels[0]!.length;
  const dataBytes = frames * numCh * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  const dither = ditherer(0x1234abcd);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = channels[c]![i]! * 32767 + dither();
      view.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v))), true);
      o += 2;
    }
  }
  return out;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  frames: number;
  bitsPerSample: number;
  duration: number;
  data: Float32Array[];
}

export function decodeWav16(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`unsupported bit depth ${bits}`);
      const frames = Math.floor(size / (channels * 2));
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      let o = offset + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          data[c]![i] = view.getInt16(o, true) / 32768;
          o += 2;
        }
      }
      return { sampleRate, channels, frames, bitsPerSample: bits, duration: frames / sampleRate, data };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}
