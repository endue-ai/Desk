// Readers for the other two clients' output. The mysql client's `--xml`: a <resultset> per result,
// a NULL as `xsi:nil`, so NULL, '' and 'NULL' stay three values. sqlite3's quote mode: every value
// as an SQL literal (NULL, a number, '..', X'..', unistr('..') for control characters), so the
// storage class survives. Pure functions over captured text.

/**
 * @typedef {{ columns: string[], rows: (string | null)[][] }} Table
 * @typedef {{ table: Table, closed: boolean }} XmlResult
 */

const RESULTSET = /<resultset\b[^>]*>([\s\S]*?)(<\/resultset>|$)/gu;
const ROW = /<row>([\s\S]*?)<\/row>/gu;
const FIELD = /<field name="([^"]*)"(?: xsi:nil="true" \/>|>([^<]*)<\/field>)/gu;

/**
 * The result sets of the mysql client's XML output, in order. A set the output stops inside keeps
 * its complete rows and `closed: false`.
 * @param {string} xml
 * @returns {XmlResult[]}
 */
export function readMysqlXml(xml) {
  /** @type {XmlResult[]} */
  const results = [];
  for (const set of xml.matchAll(RESULTSET)) {
    /** @type {string[]} */
    let columns = [];
    /** @type {(string | null)[][]} */
    const rows = [];
    for (const row of (set[1] ?? "").matchAll(ROW)) {
      /** @type {string[]} */
      const names = [];
      /** @type {(string | null)[]} */
      const values = [];
      for (const field of (row[1] ?? "").matchAll(FIELD)) {
        names.push(entities(field[1] ?? ""));
        values.push(field[2] === undefined ? null : entities(field[2]));
      }
      if (rows.length === 0) columns = names;
      rows.push(values);
    }
    results.push({ table: { columns, rows }, closed: set[2] !== "" });
  }
  return results;
}

/** XML's five entities and numeric references. */
function entities(/** @type {string} */ text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/gu, (whole, name) => {
    const named = /** @type {Record<string, string>} */ ({
      lt: "<",
      gt: ">",
      amp: "&",
      quot: '"',
      apos: "'",
    })[name];
    if (named) return named;
    const code = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * The records of sqlite3's quote mode: values separated by commas, a record per line, a line break
 * inside a quoted value kept. With `partial`, a record the output stops inside is dropped.
 * @param {string} text
 * @param {boolean} [partial]
 * @returns {(string | null)[][]}
 */
export function readQuoted(text, partial = false) {
  /** @type {(string | null)[][]} */
  const records = [];
  /** @type {(string | null)[]} */
  let record = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\n") {
      records.push(record);
      record = [];
      i++;
      continue;
    }
    const read = value(text, i);
    if (!read) break;
    record.push(read.value);
    i = read.end;
    if (text[i] === ",") i++;
  }
  if (record.length > 0 && !partial) records.push(record);
  return records;
}

/**
 * One value at `at`, or undefined when the text ends inside it.
 * @param {string} text
 * @param {number} at
 * @returns {{ value: string | null, end: number } | undefined}
 */
function value(text, at) {
  if (text[at] === "'") return quoted(text, at);
  if (/^[xX]'/u.test(text.slice(at, at + 2))) {
    const close = text.indexOf("'", at + 2);
    if (close < 0) return undefined;
    return { value: `0x${text.slice(at + 2, close).toUpperCase()}`, end: close + 1 };
  }
  if (text.startsWith("unistr(", at)) {
    const inner = quoted(text, at + 7);
    if (!inner || text[inner.end] !== ")") return undefined;
    return { value: unistr(inner.value ?? ""), end: inner.end + 1 };
  }
  if (text.startsWith("replace(", at)) return replaced(text, at);
  let end = at;
  while (end < text.length && text[end] !== "," && text[end] !== "\n") end++;
  if (end === text.length) return undefined;
  const raw = text.slice(at, end);
  return { value: raw === "NULL" ? null : real(raw), end };
}

/** A '...' literal with doubled quotes. */
function quoted(/** @type {string} */ text, /** @type {number} */ at) {
  let out = "";
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" && text[i + 1] === "'") {
      out += "'";
      i += 2;
    } else if (c === "'") return { value: out, end: i + 1 };
    else {
      out += c;
      i++;
    }
  }
  return undefined;
}

/** sqlite3 before unistr(): replace(replace('..','\r',char(13)),'\n',char(10)). */
function replaced(/** @type {string} */ text, /** @type {number} */ at) {
  const inner = value(text, at + 8);
  if (!inner || text[inner.end] !== ",") return undefined;
  const from = quoted(text, inner.end + 1);
  if (!from || text[from.end] !== ",") return undefined;
  const char = /^char\((\d+)\)\)/u.exec(text.slice(from.end + 1));
  if (!char) return undefined;
  // The literal holds the two characters `\n` where a line break was; char(10) puts it back.
  const to = String.fromCodePoint(Number(char[1]));
  return {
    value: (inner.value ?? "").replaceAll(from.value ?? "", to),
    end: from.end + 1 + char[0].length,
  };
}

/** SQLite's unistr(): \uXXXX, \UXXXXXXXX, \+XXXXXX, \XXXX and \\; any other backslash stays. */
function unistr(/** @type {string} */ text) {
  return text.replace(
    /\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|\+([0-9a-fA-F]{6})|([0-9a-fA-F]{4})|(\\))/gu,
    (whole, u4, u8, plus, bare, slash) => {
      if (slash) return "\\";
      const code = Number.parseInt(u4 ?? u8 ?? plus ?? bare, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * A number as SQLite printed it. Integers stay as written (they may pass 2^53); a REAL is printed
 * with 17 digits (0.1 as 0.1000000000000000055), so it is shortened to the same double's shortest
 * form, keeping a `.0` on whole values.
 */
export function real(/** @type {string} */ raw) {
  if (!/[.eE]/u.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return n.toFixed(1);
  return String(n);
}
