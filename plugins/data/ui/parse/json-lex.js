// The tokens of JSON, JSONC and JSON5 over a text: space and comments, strings, numbers, words and
// JSON5's bare keys. A lexer method moves `pos` past its token or throws a Fail at the offset where
// the text stops being what the dialect allows. Strings are checked in one pass and decoded only
// when a node is built.

/** @typedef {"json" | "jsonc" | "json5"} Dialect */

export class Fail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

const HEX = /^[0-9a-fA-F]+$/;
const IDENT =
  /(?:[\p{ID_Start}$_]|\\u[0-9a-fA-F]{4})(?:[\p{ID_Continue}$\u200c\u200d]|\\u[0-9a-fA-F]{4})*/uy;
/** JSON5's white space beyond JSON's: \v \f, no-break space, BOM, line and paragraph separators, Zs. */
const SPACE5 = /[\v\f\u00a0\ufeff\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
/** @type {Record<string, string>} */
const ESCAPES = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", 0: "\0" };

/** @param {number} c */
const isDigit = (c) => c >= 0x30 && c <= 0x39;
/** @param {string} text @param {number} at */
const quoted = (text, at) => (at < text.length ? JSON.stringify(text[at]) : "the end");

export class Lexer {
  /**
   * @param {string} text
   * @param {Dialect} dialect
   * @param {number} from
   * @param {number} to
   */
  constructor(text, dialect, from = 0, to = text.length) {
    this.text = text;
    this.pos = from;
    this.end = to;
    this.comments = dialect !== "json";
    this.trailing = dialect !== "json";
    this.five = dialect === "json5";
  }

  /** @param {string} [what] */
  unexpected(what) {
    const at = this.pos;
    const found = at >= this.end ? "end of input" : quoted(this.text, at);
    return new Fail(at, `Unexpected ${found}${what ? `: expected ${what}` : ""}.`);
  }

  /** Skip white space and, where the dialect allows them, comments. */
  space() {
    const { text, end } = this;
    let pos = this.pos;
    for (;;) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else if (c === 0x2f && this.comments && pos < end) {
        const next = text.charCodeAt(pos + 1);
        if (next === 0x2f) {
          const nl = text.indexOf("\n", pos);
          pos = nl < 0 || nl > end ? end : nl + 1;
        } else if (next === 0x2a) {
          const close = text.indexOf("*/", pos + 2);
          if (close < 0 || close + 2 > end) throw new Fail(pos, "A comment is not closed.");
          pos = close + 2;
        } else break;
      } else if (this.five && c > 0x7f && SPACE5.test(text[pos] ?? "")) pos++;
      else if (this.five && (c === 0x0b || c === 0x0c)) pos++;
      else break;
    }
    this.pos = Math.min(pos, end);
  }

  /** The char code at `pos`, or -1 at the end. */
  peek() {
    return this.pos < this.end ? this.text.charCodeAt(this.pos) : -1;
  }

  /** Skip a string at `pos` (it starts with its quote) and return where it ends. */
  string() {
    const { text, end } = this;
    const quote = text.charCodeAt(this.pos);
    let pos = this.pos + 1;
    for (;;) {
      if (pos >= end) throw new Fail(pos, "A string is not closed.");
      const c = text.charCodeAt(pos);
      if (c === quote) break;
      if (c === 0x5c) {
        pos = this.escape(pos);
        continue;
      }
      if (c === 0x0a || c === 0x0d) throw new Fail(pos, "A line break in a string.");
      if (c < 0x20 && !this.five) throw new Fail(pos, "A control character in a string.");
      pos++;
    }
    this.pos = pos + 1;
    return this.pos;
  }

  /** @param {number} pos The backslash. @returns {number} Where the escape ends. */
  escape(pos) {
    const { text } = this;
    const e = text[pos + 1] ?? "";
    if (e === "u") {
      if (!HEX.test(text.slice(pos + 2, pos + 6)) || pos + 6 > this.end)
        throw new Fail(pos, "A \\u escape needs four hex digits.");
      return pos + 6;
    }
    if ('"\\/bfnrt'.includes(e) && e !== "") return pos + 2;
    if (!this.five) throw new Fail(pos, `Unknown escape \\${e}.`);
    if (e === "x") {
      if (!HEX.test(text.slice(pos + 2, pos + 4)))
        throw new Fail(pos, "A \\x escape needs two hex digits.");
      return pos + 4;
    }
    if (e === "\r" && text[pos + 2] === "\n") return pos + 3;
    if (/[1-9]/.test(e) || (e === "0" && isDigit(text.charCodeAt(pos + 2))))
      throw new Fail(pos, "Digits cannot be escaped.");
    return pos + 2;
  }

  /** Decode the string between `start` (its quote) and `stop` (after its closing quote). */
  decode(start, stop) {
    const { text } = this;
    const last = stop - 1;
    /** The next backslash before the closing quote, or -1: indexOf would search the whole text. */
    const next = (/** @type {number} */ from) => {
      for (let i = from; i < last; i++) if (text.charCodeAt(i) === 0x5c) return i;
      return -1;
    };
    let chunk = start + 1;
    let at = next(chunk);
    if (at < 0) return text.slice(chunk, last);
    let out = "";
    while (at >= 0) {
      out += text.slice(chunk, at);
      const e = text[at + 1] ?? "";
      if (e === "u") {
        out += String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 6), 16));
        chunk = at + 6;
      } else if (e === "x") {
        out += String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 4), 16));
        chunk = at + 4;
      } else if (e === "\r" && text[at + 2] === "\n") chunk = at + 3;
      else {
        if (e !== "\n" && e !== "\r" && e !== "\u2028" && e !== "\u2029") out += ESCAPES[e] ?? e;
        chunk = at + 2;
      }
      at = next(chunk);
    }
    return out + text.slice(chunk, last);
  }

  /** Skip a number at `pos`. */
  number() {
    const { text } = this;
    const start = this.pos;
    let pos = start;
    let c = text.charCodeAt(pos);
    if (c === 0x2d || (this.five && c === 0x2b)) c = text.charCodeAt(++pos);
    if (this.five) {
      for (const word of ["Infinity", "NaN"]) {
        if (text.startsWith(word, pos)) return this.after(pos + word.length);
      }
      if (c === 0x30 && (text[pos + 1] === "x" || text[pos + 1] === "X")) {
        let digits = pos + 2;
        while (/[0-9a-fA-F]/.test(text[digits] ?? "")) digits++;
        if (digits === pos + 2) throw new Fail(pos, "A hex number needs digits.");
        return this.after(digits);
      }
    }
    const intStart = pos;
    if (c === 0x30) c = text.charCodeAt(++pos);
    else while (isDigit(c)) c = text.charCodeAt(++pos);
    const intDigits = pos - intStart;
    if (intDigits === 0 && !(this.five && c === 0x2e)) {
      this.pos = pos;
      throw this.unexpected("a value");
    }
    if (intDigits > 0 && text.charCodeAt(intStart) === 0x30 && isDigit(c))
      throw new Fail(pos, "A number cannot start with 0.");
    if (c === 0x2e) {
      const fraction = ++pos;
      c = text.charCodeAt(pos);
      while (isDigit(c)) c = text.charCodeAt(++pos);
      if (pos === fraction && !(this.five && intDigits > 0))
        throw new Fail(pos, "A number needs digits after its decimal point.");
    }
    if (c === 0x65 || c === 0x45) {
      c = text.charCodeAt(++pos);
      if (c === 0x2b || c === 0x2d) c = text.charCodeAt(++pos);
      const exponent = pos;
      while (isDigit(c)) c = text.charCodeAt(++pos);
      if (pos === exponent) throw new Fail(pos, "A number needs digits in its exponent.");
    }
    return this.after(pos);
  }

  /** @param {number} pos */
  after(pos) {
    if (pos > this.end) throw new Fail(this.end, "Unexpected end of input.");
    this.pos = pos;
    return pos;
  }

  /** Skip true, false or null at `pos`, and return which. */
  word() {
    for (const word of ["true", "false", "null"]) {
      if (this.text.startsWith(word, this.pos)) {
        this.after(this.pos + word.length);
        return word;
      }
    }
    throw this.unexpected("a value");
  }

  /** A member's name: a string, or in JSON5 an identifier. */
  key() {
    const start = this.pos;
    const c = this.peek();
    if (c === 0x22 || (this.five && c === 0x27)) return this.decode(start, this.string());
    if (this.five) {
      IDENT.lastIndex = start;
      const match = IDENT.exec(this.text);
      if (match && start + match[0].length <= this.end) {
        this.pos = start + match[0].length;
        return match[0].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      }
    }
    throw this.unexpected("a key in quotes");
  }
}
