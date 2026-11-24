/** Wraps raw little-endian PCM16 mono chunks in a WAV container. */
export function pcm16ToWav(chunks: readonly Uint8Array[], sampleRate: number): Uint8Array {
  let dataBytes = 0;
  for (const chunk of chunks) dataBytes += chunk.byteLength;
  dataBytes -= dataBytes % 2; // whole samples only
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    const room = out.byteLength - offset;
    if (room <= 0) break;
    out.set(chunk.byteLength <= room ? chunk : chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return out;
}
