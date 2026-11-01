// RTF tokens: groups, control words with their parameters, control symbols, \'hh bytes, \binN
// data and plain text. Bytes over 127 that a writer left unescaped are passed on as bytes, so the
// code page decides what they mean.

/**
 * @typedef {{ t: "open" } | { t: "close" } | { t: "word", word: string, param: number | undefined }
 *   | { t: "symbol", ch: string } | { t: "byte", value: number } | { t: "bin", bytes: Uint8Array }
 *   | { t: "text", text: string }} Token
 */

const isLetter = (/** @type {number} */ c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isDigit = (/** @type {number} */ c) => c >= 48 && c <= 57;
const hexValue = (/** @type {number} */ c) =>
  isDigit(c) ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1;

/**
 * @param {Uint8Array} bytes
 * @returns {Generator<Token>}
 */
export function* tokens(bytes) {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const c = bytes[i] ?? 0;
    if (c === 0x7b) {
      i++;
      yield { t: "open" };
    } else if (c === 0x7d) {
      i++;
      yield { t: "close" };
    } else if (c === 0x5c) {
      const next = bytes[i + 1] ?? 0;
      if (isLetter(next)) {
        let j = i + 1;
        while (j < n && isLetter(bytes[j] ?? 0)) j++;
        const word = String.fromCharCode(...bytes.subarray(i + 1, j));
        let param;
        let k = j;
        if (bytes[k] === 0x2d || isDigit(bytes[k] ?? 0)) {
          const start = k;
          if (bytes[k] === 0x2d) k++;
          while (k < n && isDigit(bytes[k] ?? 0) && k - start < 11) k++;
          const digits = String.fromCharCode(...bytes.subarray(start, k));
          param = digits === "-" ? undefined : Number(digits);
        }
        if (bytes[k] === 0x20) k++;
        i = k;
        if (word === "bin" && param !== undefined && param > 0) {
          yield { t: "bin", bytes: bytes.subarray(i, i + param) };
          i += param;
          continue;
        }
        yield { t: "word", word, param };
      } else if (next === 0x27) {
        const hi = hexValue(bytes[i + 2] ?? 0);
        const lo = hexValue(bytes[i + 3] ?? 0);
        i += 4;
        if (hi >= 0 && lo >= 0) yield { t: "byte", value: hi * 16 + lo };
      } else if (next === 0x0a || next === 0x0d) {
        // A backslash before a line break is a paragraph mark.
        i += 2;
        yield { t: "word", word: "par", param: undefined };
      } else {
        i += 2;
        yield { t: "symbol", ch: String.fromCharCode(next) };
      }
    } else if (c === 0x0a || c === 0x0d) {
      i++;
    } else if (c >= 0x80) {
      i++;
      yield { t: "byte", value: c };
    } else {
      let j = i;
      while (j < n) {
        const d = bytes[j] ?? 0;
        if (d === 0x7b || d === 0x7d || d === 0x5c || d === 0x0a || d === 0x0d || d >= 0x80) break;
        j++;
      }
      yield { t: "text", text: String.fromCharCode(...bytes.subarray(i, j)) };
      i = j;
    }
  }
}

/** The TextDecoder label for a Windows code page (\ansicpgN) or a font charset (\fcharsetN). */
export function codepageLabel(/** @type {number} */ cp) {
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  return (
    /** @type {Record<number, string>} */ ({
      874: "windows-874",
      932: "shift_jis",
      936: "gbk",
      949: "euc-kr",
      950: "big5",
      1361: "euc-kr",
      10000: "macintosh",
      65001: "utf-8",
      20127: "windows-1252",
      437: "windows-1252",
      850: "windows-1252",
    })[cp] ?? "windows-1252"
  );
}

/** The code page a font's \fcharset implies, or undefined for "use the document's". */
export function charsetCodepage(/** @type {number} */ charset) {
  return /** @type {Record<number, number>} */ ({
    0: 1252,
    77: 10000,
    128: 932,
    129: 949,
    130: 1361,
    134: 936,
    136: 950,
    161: 1253,
    162: 1254,
    163: 1258,
    177: 1255,
    178: 1256,
    186: 1257,
    204: 1251,
    222: 874,
    238: 1250,
  })[charset];
}

/** Code pages whose characters take two bytes. */
export const DOUBLE_BYTE = new Set([932, 936, 949, 950, 1361]);
