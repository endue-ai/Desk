// What an .xlsx cell holds (PG-61): each column's kind from its PostgreSQL type, its declared type,
// or else its values, and each value as a number, a date or text. A number is a number cell only
// when it has at most 15 significant digits, which a double holds exactly; a date or a timestamp
// without a time zone from 1900-03-01 on is a date cell (a serial day count) when its seconds have
// at most 3 decimals; anything else is text, so nothing changes on the way. No DOM.

/**
 * @typedef {"number" | "date" | "timestamp" | "text"} Kind
 * @typedef {{ t: "n", v: string } | { t: "d", v: number, s: 1 | 2 | 3 } | { t: "s", v: string }} Cell
 *   `s` is the date style: 1 a day, 2 to the second, 3 to the millisecond.
 */

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/u;

/** PostgreSQL type OIDs: int8, int2, int4, oid, float4, float8, numeric; date; timestamp. */
const NUMBER_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);
const OID_KINDS = /** @type {Map<number, Kind>} */ (
  new Map([
    [1082, "date"],
    [1114, "timestamp"],
  ])
);

/** A column's kind from a type's name, or undefined when the name says nothing. */
function kindOfName(/** @type {string} */ name) {
  const type = name.toLowerCase().trim();
  if (!type) return undefined;
  if (/^(?:tiny|small|medium|big)?int|^integer|^numeric|^decimal|^real|^double|^float/u.test(type))
    return "number";
  if (type === "date") return "date";
  if (/^(?:timestamp(?:\(\d\))?(?: without time zone)?|datetime(?:\(\d\))?)$/u.test(type))
    return "timestamp";
  return "text";
}

/**
 * Each column's kind.
 * @param {(string | null)[][]} rows
 * @param {number} count Columns.
 * @param {(number | undefined)[]} oids
 * @param {(string | undefined)[]} names
 * @returns {Kind[]}
 */
export function kindsOf(rows, count, oids, names) {
  return Array.from({ length: count }, (_, c) => {
    const oid = oids[c];
    if (oid !== undefined && oid > 0)
      return NUMBER_OIDS.has(oid) ? "number" : (OID_KINDS.get(oid) ?? "text");
    const named = kindOfName(names[c] ?? "");
    if (named) return named;
    /** @type {Kind | undefined} */
    let kind;
    for (const row of rows) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      const seen = NUMBER.test(v)
        ? "number"
        : DATE.test(v)
          ? "date"
          : STAMP.test(v)
            ? "timestamp"
            : "text";
      if (kind && kind !== seen) return "text";
      if (seen === "text") return "text";
      kind = seen;
    }
    return kind ?? "text";
  });
}

/** Whether a decimal survives a double exactly: at most 15 significant digits, within range. */
export function exactNumber(/** @type {string} */ v) {
  if (!NUMBER.test(v)) return false;
  const mantissa = v
    .replace(/^-/u, "")
    .replace(/[eE].*$/u, "")
    .replace(".", "");
  const digits = mantissa.replace(/^0+/u, "").replace(/0+$/u, "");
  if (digits.length > 15) return false;
  const n = Math.abs(Number(v));
  return n === 0 || (n >= 2.2250738585072014e-308 && n < 1e308);
}

const EPOCH = Date.UTC(1899, 11, 30);
const FIRST = Date.UTC(1900, 2, 1);
const DAY = 86_400_000;

/** A date or timestamp as a serial day count, or undefined when it is not one a cell holds. */
export function serialOf(/** @type {string} */ v) {
  const m = STAMP.exec(v) ?? DATE.exec(v);
  if (!m) return undefined;
  const [y, mo, d, h = "0", mi = "0", s = "0", frac = ""] = m.slice(1);
  if (/[1-9]/u.test(frac.slice(3))) return undefined;
  const ms = Number(frac.slice(0, 3).padEnd(3, "0"));
  const at = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  const back = new Date(at);
  if (
    Number.isNaN(at) ||
    at < FIRST ||
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() !== Number(mo) - 1 ||
    back.getUTCDate() !== Number(d) ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(s) > 59
  )
    return undefined;
  return {
    serial: (at - EPOCH) / DAY,
    style: /** @type {1 | 2 | 3} */ (m[4] === undefined ? 1 : ms ? 3 : 2),
  };
}

/** A value as a cell of its column's kind, or undefined for an empty cell. @returns {Cell | undefined} */
export function cellOf(
  /** @type {string | null} */ v,
  /** @type {Kind} */ kind,
  /** @type {string} */ nullText,
) {
  if (v === null) return nullText ? { t: "s", v: nullText } : undefined;
  if (kind === "number" && exactNumber(v)) return { t: "n", v };
  if (kind === "date" || kind === "timestamp") {
    const date = serialOf(v);
    if (date) return { t: "d", v: date.serial, s: date.style };
  }
  return { t: "s", v };
}
