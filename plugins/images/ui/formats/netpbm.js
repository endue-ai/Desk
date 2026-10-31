// Netpbm: P1 to P3 (plain text), P4 to P6 (binary, 8 or 16 bits) and P7 (PAM, with its tuple
// types: black and white, greyscale and RGB, each with or without alpha).
import { ascii, fail } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";

/** Header tokens of P1 to P6, skipping comments; `end` is where the data starts. */
function header(/** @type {Uint8Array} */ bytes, /** @type {number} */ count) {
  /** @type {string[]} */
  const tokens = [];
  let at = 2;
  while (tokens.length < count && at < bytes.length) {
    const c = bytes[at] ?? 0;
    if (c === 0x23) {
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at++;
    } else if (c <= 0x20) at++;
    else {
      const start = at;
      while (at < bytes.length && (bytes[at] ?? 0) > 0x20 && bytes[at] !== 0x23) at++;
      tokens.push(ascii(bytes, start, at - start));
    }
  }
  if (tokens.length < count) fail("Its Netpbm header is cut short.");
  return { values: tokens.map(Number), end: at + 1 };
}

/** The PAM header: WIDTH, HEIGHT, DEPTH, MAXVAL and TUPLTYPE lines up to ENDHDR. */
function pamHeader(/** @type {Uint8Array} */ bytes) {
  const stop = ascii(bytes, 0, 4096).indexOf("ENDHDR");
  if (stop < 0) fail("Its PAM header has no ENDHDR.");
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of ascii(bytes, 3, stop - 3).split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key && !key.startsWith("#")) fields[key] = rest.join(" ");
  }
  const end = stop + 6 + (bytes[stop + 6] === 0x0d ? 2 : 1);
  return { fields, end };
}

/** @returns {import("./pixels.js").Pixels} */
export function decodeNetpbm(/** @type {Uint8Array} */ bytes) {
  const kind = (bytes[1] ?? 0) - 0x30;
  let width;
  let height;
  let max = 1;
  let channels;
  let start;
  if (kind === 7) {
    const { fields, end } = pamHeader(bytes);
    [width, height, channels, max] = ["WIDTH", "HEIGHT", "DEPTH", "MAXVAL"].map((k) =>
      Number(fields[k]),
    );
    start = end;
  } else {
    const bitmap = kind === 1 || kind === 4;
    const { values, end } = header(bytes, bitmap ? 2 : 3);
    [width = 0, height = 0, max = 1] = bitmap ? [...values, 1] : values;
    channels = kind === 3 || kind === 6 ? 3 : 1;
    start = end;
  }
  if (!(max >= 1 && max <= 65535) || !(channels >= 1 && channels <= 4))
    fail("Its Netpbm header is damaged.");
  const out = canvasFor(width ?? 0, height ?? 0);
  const total = (width ?? 0) * (height ?? 0);
  const scale = 255 / max;
  /** @type {number[]} */
  const samples = [];

  if (kind === 1) {
    // Plain bitmaps may run their digits together.
    for (let at = start - 1; at < bytes.length && samples.length < total; at++) {
      const c = bytes[at];
      if (c === 0x30 || c === 0x31) samples.push(c === 0x31 ? 0 : 1);
      else if (c === 0x23) while (at < bytes.length && bytes[at] !== 0x0a) at++;
    }
  } else if (kind === 2 || kind === 3) {
    const text = ascii(bytes, start - 1, bytes.length).replace(/#[^\n]*/g, " ");
    for (const token of text.split(/\s+/)) if (token !== "") samples.push(Number(token) * scale);
  } else if (kind === 4) {
    const row = Math.ceil((width ?? 0) / 8);
    enough(bytes, start, row * (height ?? 0));
    for (let y = 0; y < (height ?? 0); y++)
      for (let x = 0; x < (width ?? 0); x++) {
        const bit = ((bytes[start + y * row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        samples.push(bit ? 0 : 1);
      }
  } else {
    const wide = max > 255;
    const count = total * channels;
    enough(bytes, start, count * (wide ? 2 : 1));
    for (let i = 0; i < count; i++) {
      const v = wide
        ? ((bytes[start + i * 2] ?? 0) << 8) | (bytes[start + i * 2 + 1] ?? 0)
        : (bytes[start + i] ?? 0);
      samples.push(v * scale);
    }
  }
  const bits = kind === 1 || kind === 4;
  if (samples.length < total * channels) fail("The file ends before its pixels do.");
  // P1 and P4 bits are 1 for black (flipped above); a PAM black-and-white tuple is 1 for white.
  const white = bits ? 255 : 1;
  const alpha = channels === 2 || channels === 4;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const s = i * channels;
    if (channels >= 3) out.set([samples[s] ?? 0, samples[s + 1] ?? 0, samples[s + 2] ?? 0], p);
    else out[p] = out[p + 1] = out[p + 2] = (samples[s] ?? 0) * white;
    out[p + 3] = alpha ? (samples[s + channels - 1] ?? 0) : 255;
  }
  const colour =
    channels >= 3
      ? alpha
        ? "RGBA"
        : "RGB"
      : bits || max === 1
        ? "black and white"
        : alpha
          ? "greyscale with alpha"
          : "greyscale";
  const depth = max === 1 ? "1-bit" : `${Math.ceil(Math.log2(max + 1))}-bit`;
  return { width: width ?? 0, height: height ?? 0, rgba: out, depth: `${depth} ${colour}` };
}
