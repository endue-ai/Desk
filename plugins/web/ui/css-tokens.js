// A CSS tokenizer after CSS Syntax Level 3: names, strings and url() with their escapes decoded,
// so `u\72l(`, `\65xpression(` and `@\69mport` are seen for what the browser will see. Each token
// keeps its place in the source, so a cleaned sheet is the source with tokens dropped or replaced.

/**
 * @typedef {"ws" | "comment" | "string" | "bad-string" | "url" | "bad-url" | "function" | "ident" |
 *   "at" | "hash" | "number" | "percentage" | "dimension" | "delim" | "{" | "}" | "(" | ")" | "[" |
 *   "]" | ";" | ":" | "," | "cdo" | "cdc"} TokenType
 * @typedef {{ type: TokenType, start: number, end: number, value: string }} Token
 */

const isLetter = (/** @type {number} */ c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDigit = (/** @type {number} */ c) => c >= 48 && c <= 57;
const isHex = (/** @type {number} */ c) =>
  isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isNameStart = (/** @type {number} */ c) => isLetter(c) || c === 95 || c >= 0x80;
const isName = (/** @type {number} */ c) => isNameStart(c) || isDigit(c) || c === 45;
const isSpace = (/** @type {number} */ c) =>
  c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isNewline = (/** @type {number} */ c) => c === 10 || c === 12 || c === 13;
const SINGLE = /** @type {Record<string, TokenType>} */ ({
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "{": "{",
  "}": "}",
  ",": ",",
  ":": ":",
  ";": ";",
});

/** @param {string} src @returns {Token[]} */
export function tokenize(src) {
  const n = src.length;
  const at = (/** @type {number} */ k) => (k < n ? src.charCodeAt(k) : -1);
  const validEscape = (/** @type {number} */ k) =>
    at(k) === 92 && k + 1 < n && !isNewline(at(k + 1));
  const startsIdent = (/** @type {number} */ k) => {
    const c = at(k);
    if (c === 45) return isNameStart(at(k + 1)) || at(k + 1) === 45 || validEscape(k + 1);
    return isNameStart(c) || validEscape(k);
  };
  const startsNumber = (/** @type {number} */ k) => {
    const c = at(k);
    if (c === 43 || c === 45) return isDigit(at(k + 1)) || (at(k + 1) === 46 && isDigit(at(k + 2)));
    if (c === 46) return isDigit(at(k + 1));
    return isDigit(c);
  };
  /** The escape after a backslash at k - 1: [text, next]. */
  const unescapeAt = (/** @type {number} */ k) => {
    if (k >= n) return ["�", k];
    if (!isHex(at(k))) {
      const cp = src.codePointAt(k) ?? 0xfffd;
      return [String.fromCodePoint(cp), k + (cp > 0xffff ? 2 : 1)];
    }
    let j = k;
    while (j < n && j - k < 6 && isHex(at(j))) j++;
    const cp = Number.parseInt(src.slice(k, j), 16);
    if (isSpace(at(j))) j += at(j) === 13 && at(j + 1) === 10 ? 2 : 1;
    const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
    return [ok ? String.fromCodePoint(cp) : "�", j];
  };
  const name = (/** @type {number} */ k) => {
    let out = "";
    while (k < n) {
      if (isName(at(k))) out += src[k++];
      else if (validEscape(k)) {
        const [text, next] = unescapeAt(k + 1);
        out += text;
        k = /** @type {number} */ (next);
      } else break;
    }
    return /** @type {[string, number]} */ ([out, k]);
  };

  /** @type {Token[]} */
  const tokens = [];
  const push = (
    /** @type {TokenType} */ type,
    /** @type {number} */ start,
    /** @type {number} */ end,
    value = "",
  ) => tokens.push({ type, start, end, value });
  let i = 0;
  while (i < n) {
    const c = at(i);
    const start = i;
    if (c === 47 && at(i + 1) === 42) {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
      push("comment", start, i);
    } else if (isSpace(c)) {
      while (isSpace(at(i))) i++;
      push("ws", start, i);
    } else if (c === 34 || c === 39) {
      let value = "";
      let type = /** @type {TokenType} */ ("string");
      i++;
      while (i < n && at(i) !== c) {
        if (isNewline(at(i))) {
          type = "bad-string";
          break;
        }
        if (at(i) === 92) {
          if (i + 1 >= n) i++;
          else if (isNewline(at(i + 1))) i += at(i + 1) === 13 && at(i + 2) === 10 ? 3 : 2;
          else {
            const [text, next] = unescapeAt(i + 1);
            value += text;
            i = /** @type {number} */ (next);
          }
        } else value += src[i++];
      }
      if (at(i) === c) i++;
      push(type, start, i, value);
    } else if (c === 35 && (isName(at(i + 1)) || validEscape(i + 1))) {
      const [value, next] = name(i + 1);
      i = next;
      push("hash", start, i, value);
    } else if (startsNumber(i)) {
      if (c === 43 || c === 45) i++;
      while (isDigit(at(i))) i++;
      if (at(i) === 46 && isDigit(at(i + 1))) for (i++; isDigit(at(i)); ) i++;
      if (
        (at(i) === 69 || at(i) === 101) &&
        (isDigit(at(i + 1)) || ((at(i + 1) === 43 || at(i + 1) === 45) && isDigit(at(i + 2))))
      )
        for (i += 2; isDigit(at(i)); ) i++;
      if (startsIdent(i)) {
        const [unit, next] = name(i);
        i = next;
        push("dimension", start, i, unit);
      } else if (at(i) === 37) push("percentage", start, ++i);
      else push("number", start, i);
    } else if (c === 45 && at(i + 1) === 45 && at(i + 2) === 62) {
      i += 3;
      push("cdc", start, i);
    } else if (c === 60 && src.startsWith("<!--", i)) {
      i += 4;
      push("cdo", start, i);
    } else if (c === 64 && startsIdent(i + 1)) {
      const [value, next] = name(i + 1);
      i = next;
      push("at", start, i, value);
    } else if (startsIdent(i)) {
      const [value, next] = name(i);
      i = next;
      if (at(i) !== 40) push("ident", start, i, value);
      else if (value.toLowerCase() !== "url") push("function", start, ++i, value);
      else {
        let k = i + 1;
        while (isSpace(at(k))) k++;
        if (at(k) === 34 || at(k) === 39) {
          i += 1;
          push("function", start, i, value);
        } else {
          i = k;
          let url = "";
          let type = /** @type {TokenType} */ ("url");
          while (i < n && at(i) !== 41) {
            const u = at(i);
            if (isSpace(u)) {
              while (isSpace(at(i))) i++;
              if (i < n && at(i) !== 41) type = "bad-url";
              continue;
            }
            if (u === 34 || u === 39 || u === 40 || u < 0x20 || u === 0x7f || type === "bad-url") {
              type = "bad-url";
              if (validEscape(i)) i = /** @type {number} */ (unescapeAt(i + 1)[1]);
              else i++;
              continue;
            }
            if (u === 92) {
              if (!validEscape(i)) {
                type = "bad-url";
                i++;
                continue;
              }
              const [text, next] = unescapeAt(i + 1);
              url += text;
              i = /** @type {number} */ (next);
            } else url += src[i++];
          }
          if (at(i) === 41) i++;
          push(type, start, i, url);
        }
      }
    } else {
      const single = SINGLE[src[i] ?? ""];
      i++;
      push(single ?? "delim", start, i, src[start] ?? "");
    }
  }
  return tokens;
}

/**
 * For each token that opens a block or a function, the index of the token that closes it (or the
 * end, when the source leaves it open). A closer of another kind inside is an ordinary token.
 * @param {Token[]} tokens
 */
export function pairs(tokens) {
  const close = new Int32Array(tokens.length).fill(-1);
  /** @type {Array<[number, TokenType]>} */
  const open = [];
  const closerOf = /** @type {Record<string, TokenType>} */ ({
    "{": "}",
    "(": ")",
    "[": "]",
    function: ")",
  });
  tokens.forEach((token, index) => {
    const closer = closerOf[token.type];
    if (closer) open.push([index, closer]);
    else if (open.length && open[open.length - 1]?.[1] === token.type)
      close[open.pop()?.[0] ?? 0] = index;
  });
  for (const [index] of open) close[index] = tokens.length;
  return close;
}
