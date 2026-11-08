// A 16-bit PCM WAV file from samples, for what the player decodes itself (AU and SND) or renders
// (MIDI): the webview then plays it through a blob: URL like any other file.

/**
 * @param {Float32Array[] | Int16Array[]} channels the samples per channel, float in [-1, 1] or int16
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + frames * count * 2);
  const view = new DataView(bytes.buffer);
  const text = (/** @type {number} */ at, /** @type {string} */ value) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * count * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * count * 2, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const value = channel[i] ?? 0;
      const sample =
        channel instanceof Int16Array
          ? value
          : Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
      view.setInt16(at, sample, true);
      at += 2;
    }
  }
  return bytes;
}
