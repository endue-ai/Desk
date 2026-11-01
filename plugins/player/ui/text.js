// Text files in the encodings subtitles and playlists come in: a byte order mark says UTF-8 or
// UTF-16; without one, UTF-8 when the bytes are UTF-8, else the fallback (EUC-KR for subtitles, where
// Korean SAMI and SRT files are its most common other encoding; windows-1252 for playlists).

/**
 * @param {Uint8Array} bytes
 * @param {string} [fallback] the encoding when the bytes are not UTF-8
 * @returns {{ text: string, encoding: string }}
 */
export function decodeText(bytes, fallback = "euc-kr") {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    try {
      return { text: new TextDecoder(fallback).decode(bytes), encoding: fallback };
    } catch {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
    }
  }
}

/** Whether decoded text looks like text: few control characters (a binary file decodes too). */
export function looksLikeText(/** @type {string} */ text) {
  if (text.length === 0) return false;
  const sample = text.slice(0, 4096);
  let control = 0;
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    if ((code < 9 || (code > 13 && code < 32) || code === 0xfffd) && code !== 0x1b) control++;
  }
  return control / sample.length < 0.05;
}
