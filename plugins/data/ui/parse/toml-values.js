// TOML 1.0's values as text: the four kinds of strings with their escapes, integers and floats as
// written (with `_`, hex, octal, binary, inf and nan) and the four kinds of dates and times, checked
// against the calendar. The table structure is in toml.js.

export class TomlFail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

/** @type {Record<string, string>} */
const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
const INTEGER =
  /^[+-]?(?:0|[1-9](?:_?[0-9])*)$|^0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*$|^0o[0-7](?:_?[0-7])*$|^0b[01](?:_?[01])*$/;
const FLOAT =
  /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?$|^[+-]?(?:inf|nan)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:\d{2})?$/;

/** @param {number} year @param {number} month */
const daysIn = (year, month) =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/** @param {string} text */
const validDate = (text) => {
  const m = DATE.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
};

/** @param {string} text */
const validTime = (text) => {
  const m = TIME.exec(text);
  return m !== null && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) <= 60;
};

/** @param {string} text */
const validOffset = (text) => {
  if (text === "Z" || text === "z") return true;
  return Number(text.slice(1, 3)) < 24 && Number(text.slice(4, 6)) < 60;
};

/**
 * What a bare value is: a boolean, a number or one of the four dates and times. Undefined when it
 * is none of them.
 * @param {string} text
 * @returns {{ kind: "boolean" | "number" | "date", tag?: string } | undefined}
 */
export function classify(text) {
  if (text === "true" || text === "false") return { kind: "boolean" };
  if (INTEGER.test(text) || (FLOAT.test(text) && /[.eEin]/.test(text))) return { kind: "number" };
  const dt = DATE_TIME.exec(text);
  if (dt) {
    if (!validDate(dt[1] ?? "") || !validTime(dt[2] ?? "")) return undefined;
    if (!dt[3]) return { kind: "date", tag: "local date-time" };
    return validOffset(dt[3]) ? { kind: "date", tag: "offset date-time" } : undefined;
  }
  if (DATE.test(text)) return validDate(text) ? { kind: "date", tag: "local date" } : undefined;
  if (TIME.test(text)) return validTime(text) ? { kind: "date", tag: "local time" } : undefined;
  return undefined;
}

/**
 * A string at `at` in `text`, of any of the four kinds. Returns its value and where it ends.
 * @param {string} text
 * @param {number} at
 * @returns {{ value: string, end: number }}
 */
export function readString(text, at) {
  const quote = text[at] ?? "";
  const multi = text.startsWith(quote.repeat(3), at);
  const literal = quote === "'";
  let pos = at + (multi ? 3 : 1);
  if (multi && text[pos] === "\n") pos++;
  else if (multi && text.startsWith("\r\n", pos)) pos += 2;
  let out = "";
  for (;;) {
    const c = text[pos];
    if (c === undefined) throw new TomlFail(at, "A string is not closed.");
    if (c === quote) {
      if (!multi) return { value: out, end: pos + 1 };
      if (text.startsWith(quote.repeat(3), pos)) {
        // Up to two quotes may end the string's content right before its closing three.
        let extra = 0;
        while (extra < 2 && text[pos + 3 + extra] === quote) extra++;
        return { value: out + quote.repeat(extra), end: pos + 3 + extra };
      }
      out += c;
      pos++;
      continue;
    }
    if ((c === "\n" || c === "\r") && !multi) throw new TomlFail(pos, "A line break in a string.");
    if (c === "\\" && !literal) {
      const e = text[pos + 1] ?? "";
      if (multi && /[ \t\r\n]/.test(e)) {
        let skip = pos + 1;
        while (/[ \t]/.test(text[skip] ?? "")) skip++;
        if (text[skip] !== "\n" && text[skip] !== "\r")
          throw new TomlFail(pos, "A backslash ends a line only before the line break.");
        while (/[ \t\r\n]/.test(text[skip] ?? "")) skip++;
        pos = skip;
        continue;
      }
      if (e === "u" || e === "U") {
        const size = e === "u" ? 4 : 8;
        const hex = text.slice(pos + 2, pos + 2 + size);
        const code = Number.parseInt(hex, 16);
        if (
          !/^[0-9A-Fa-f]+$/.test(hex) ||
          hex.length !== size ||
          code > 0x10ffff ||
          (code >= 0xd800 && code < 0xe000)
        )
          throw new TomlFail(pos, `\\${e} needs ${size} hex digits of a Unicode scalar value.`);
        out += String.fromCodePoint(code);
        pos += 2 + size;
        continue;
      }
      const escaped = ESCAPES[e];
      if (escaped === undefined) throw new TomlFail(pos, `Unknown escape \\${e}.`);
      out += escaped;
      pos += 2;
      continue;
    }
    const code = c.charCodeAt(0);
    if ((code < 0x20 && c !== "\t" && c !== "\n" && c !== "\r") || code === 0x7f)
      throw new TomlFail(pos, "A control character in a string.");
    out += c;
    pos++;
  }
}

/** A bare key's characters. */
export const BARE_KEY = /[A-Za-z0-9_-]/;

/**
 * A bare value's end: a number, boolean or date, which may hold one space between a date and its
 * time.
 * @param {string} text
 * @param {number} at
 */
export function bareEnd(text, at) {
  let end = at;
  while (end < text.length && !/[\s,\]}#]/.test(text[end] ?? "")) end++;
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text.slice(at, end)) &&
    text[end] === " " &&
    /^\d{2}:/.test(text.slice(end + 1, end + 4))
  ) {
    end++;
    while (end < text.length && !/[\s,\]}#]/.test(text[end] ?? "")) end++;
  }
  return end;
}
