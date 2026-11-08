// Sun AU and NeXT SND: the header (data offset, size, encoding, rate, channels, an annotation) and
// the samples, decoded into a WAV: μ-law and A-law (G.711), 8-, 16-, 24- and 32-bit PCM and floats.
import { Cursor, latin1, startsWith } from "./bytes.js";
import { encodeWav } from "./wav.js";

const ENCODINGS = /** @type {Record<number, string>} */ ({
  1: "μ-law",
  2: "8-bit PCM",
  3: "16-bit PCM",
  4: "24-bit PCM",
  5: "32-bit PCM",
  6: "32-bit float",
  7: "64-bit float",
  27: "A-law",
});

/** G.711 μ-law to a 16-bit sample. */
function ulaw(/** @type {number} */ byte) {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 7;
  const magnitude = (((u & 0x0f) << 3) + 0x84) << exponent;
  return sign ? 0x84 - magnitude : magnitude - 0x84;
}

/** G.711 A-law to a 16-bit sample. */
function alaw(/** @type {number} */ byte) {
  const a = byte ^ 0x55;
  const exponent = (a >> 4) & 7;
  const mantissa = a & 0x0f;
  const magnitude =
    exponent === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (exponent - 1);
  return a & 0x80 ? magnitude : -magnitude;
}

/**
 * Decode an AU file. Throws an Error that says why when it is damaged or the encoding is not one
 * of those above.
 * @param {Uint8Array} bytes the whole file
 */
export function decodeAu(bytes) {
  if (!startsWith(bytes, ".snd")) throw new Error("The AU header is missing.");
  const c = new Cursor(bytes, 4);
  const offset = c.u32();
  const declared = c.u32();
  const code = c.u32();
  const sampleRate = c.u32();
  const channels = c.u32();
  const encoding = ENCODINGS[code];
  if (!encoding) throw new Error(`AU encoding ${code} is not one the player decodes.`);
  if (!sampleRate || !channels || channels > 16 || offset < 24)
    throw new Error("The AU header is damaged.");
  const annotation = latin1(bytes.subarray(24, Math.min(offset, 24 + 1024)))
    .replace(/\0+$/, "")
    .trim();
  const end = declared === 0xffffffff ? bytes.length : Math.min(bytes.length, offset + declared);
  const width =
    code === 1 || code === 2 || code === 27
      ? 1
      : code === 3
        ? 2
        : code === 4
          ? 3
          : code === 7
            ? 8
            : 4;
  const frames = Math.floor((end - offset) / width / channels);
  const out = Array.from({ length: channels }, () => new Int16Array(frames));
  const data = new DataView(bytes.buffer, bytes.byteOffset + offset, end - offset);
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const at = (i * channels + ch) * width;
      let sample;
      if (code === 1) sample = ulaw(data.getUint8(at));
      else if (code === 27) sample = alaw(data.getUint8(at));
      else if (code === 2) sample = data.getInt8(at) << 8;
      else if (code === 3) sample = data.getInt16(at);
      else if (code === 4) sample = data.getInt16(at);
      else if (code === 5) sample = data.getInt32(at) >> 16;
      else {
        const value = code === 6 ? data.getFloat32(at) : data.getFloat64(at);
        sample = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
      }
      const channel = out[ch];
      if (channel) channel[i] = sample;
    }
  }
  return {
    wav: encodeWav(out, sampleRate),
    encoding,
    sampleRate,
    channels,
    duration: frames / sampleRate,
    annotation,
  };
}
