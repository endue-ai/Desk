// COPY's text format read back into rows (PG-64): a line per row, its fields cut at the delimiter,
// `\N` alone a NULL and every backslash escape the server writes (`\b \f \n \r \t \v \\` and the
// delimiter's) or reads (`\` and up to three octal digits, `\x` and up to two hex digits) decoded.
// Chunks may end anywhere, inside a line or a UTF-8 character: what is left waits for the next. No
// DOM.

/**
 * @typedef {(string | null)[]} Row
 * @typedef {{ push(data: string, encoding?: "utf8" | "base64"): Row[], end(): Row[] }} TextReader
 */

const SIMPLE = /** @type {Record<string, string>} */ ({
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
});

/** One field as the server wrote it: NULL, or its text with the escapes decoded. */
export function fieldOf(/** @type {string} */ raw) {
  if (raw === "\\N") return null;
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let at = 0; at < raw.length; at++) {
    const c = raw[at] ?? "";
    if (c !== "\\" || at === raw.length - 1) {
      out += c;
      continue;
    }
    const next = raw[++at] ?? "";
    if (next in SIMPLE) out += SIMPLE[next];
    else if (next >= "0" && next <= "7") {
      const digits = /^[0-7]{1,3}/u.exec(raw.slice(at))?.[0] ?? next;
      out += String.fromCharCode(Number.parseInt(digits, 8) & 0xff);
      at += digits.length - 1;
    } else if (next === "x" && /^[0-9A-Fa-f]/u.test(raw[at + 1] ?? "")) {
      const digits = /^[0-9A-Fa-f]{1,2}/u.exec(raw.slice(at + 1))?.[0] ?? "";
      out += String.fromCharCode(Number.parseInt(digits, 16));
      at += digits.length;
    } else out += next;
  }
  return out;
}

/** One line's fields: cut at every delimiter not escaped by a backslash. */
export function rowOf(/** @type {string} */ line, delimiter = "\t") {
  /** @type {Row} */
  const out = [];
  let start = 0;
  for (let at = 0; at < line.length; at++) {
    const c = line[at];
    if (c === "\\") at++;
    else if (c === delimiter) {
      out.push(fieldOf(line.slice(start, at)));
      start = at + 1;
    }
  }
  out.push(fieldOf(line.slice(start)));
  return out;
}

/**
 * A reader of COPY ... TO STDOUT's text format, chunk by chunk.
 * @param {string} [delimiter]
 * @returns {TextReader}
 */
export function textReader(delimiter = "\t") {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  const lines = (/** @type {string} */ text, /** @type {boolean} */ last) => {
    const all = rest + text;
    const cut = all.lastIndexOf("\n");
    if (cut < 0 && !last) {
      rest = all;
      return [];
    }
    const whole = last ? all : all.slice(0, cut + 1);
    rest = last ? "" : all.slice(cut + 1);
    const parts = whole.split("\n");
    if (parts.at(-1) === "") parts.pop();
    return parts.map((line) => rowOf(line, delimiter));
  };
  return {
    push(data, encoding = "utf8") {
      if (encoding === "utf8") return lines(decoder.decode() + data, false);
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return lines(decoder.decode(bytes, { stream: true }), false);
    },
    end: () => lines(decoder.decode(), true),
  };
}
