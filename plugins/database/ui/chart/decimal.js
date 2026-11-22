// Exact decimals from the text a server sends (PG-44): a value is its digits as a BigInt and how many
// of them are after the point, so 9007199254740993 + 1 and 0.1 + 0.2 come out as they would on the
// server, never through floating point. PostgreSQL's NaN and infinities are values of their own,
// ordered as the server orders them (-Infinity, the numbers, Infinity, NaN). Only relative imports:
// the chart's worker reads this too.

/**
 * @typedef {{ kind: "finite", digits: bigint, scale: number }} Finite
 * @typedef {Finite | { kind: "nan" } | { kind: "inf", sign: 1 | -1 }} Decimal
 */

const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,6}))?$/u;
const INFINITY = /^([+-]?)inf(?:inity)?$/iu;
/** Places an exponent may move the point: past it the text is not taken as a number. */
const MAX_SHIFT = 100_000;

const TEN = 10n;
const pow10 = (/** @type {number} */ n) => TEN ** BigInt(n);

/** A value's text as a decimal, or null when it is not a number. @returns {Decimal | null} */
export function parseDecimal(/** @type {string} */ text) {
  const t = text.trim();
  if (/^nan$/iu.test(t)) return { kind: "nan" };
  const inf = INFINITY.exec(t);
  if (inf) return { kind: "inf", sign: inf[1] === "-" ? -1 : 1 };
  const m = NUMBER.exec(t);
  if (!m) return null;
  const [, sign, int = "", frac = ""] = m;
  if (!int && !frac) return null;
  const exp = m[4] ? Number(m[4]) : 0;
  if (Math.abs(exp) > MAX_SHIFT) return null;
  let digits = BigInt(`${int}${frac}` || "0");
  let scale = frac.length - exp;
  if (scale < 0) {
    digits *= pow10(-scale);
    scale = 0;
  }
  return { kind: "finite", digits: sign === "-" ? -digits : digits, scale };
}

/** Two finite values' digits at the same scale. */
const aligned = (/** @type {Finite} */ a, /** @type {Finite} */ b) => {
  const scale = Math.max(a.scale, b.scale);
  return {
    x: a.digits * pow10(scale - a.scale),
    y: b.digits * pow10(scale - b.scale),
    scale,
  };
};

/** a + b, at the larger scale; NaN and the infinities as PostgreSQL adds them. @returns {Decimal} */
export function addDecimal(/** @type {Decimal} */ a, /** @type {Decimal} */ b) {
  if (a.kind === "nan" || b.kind === "nan") return { kind: "nan" };
  if (a.kind === "inf" && b.kind === "inf") return a.sign === b.sign ? a : { kind: "nan" };
  if (a.kind === "inf") return a;
  if (b.kind === "inf") return b;
  const { x, y, scale } = aligned(a, b);
  return { kind: "finite", digits: x + y, scale };
}

/** The order of a value's kind: -Infinity, a number, Infinity, NaN. */
const rank = (/** @type {Decimal} */ d) =>
  d.kind === "nan" ? 3 : d.kind === "inf" ? d.sign + 1 : 1;

/** -1, 0 or 1 as a is below, equal to or above b. */
export function compareDecimal(/** @type {Decimal} */ a, /** @type {Decimal} */ b) {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (a.kind !== "finite" || b.kind !== "finite") return 0;
  const { x, y } = aligned(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A value with no zeros at the end of its fraction. @returns {Decimal} */
export function trimDecimal(/** @type {Decimal} */ d) {
  if (d.kind !== "finite") return d;
  let { digits, scale } = d;
  while (scale > 0 && digits % TEN === 0n) {
    digits /= TEN;
    scale--;
  }
  return { kind: "finite", digits, scale };
}

/** The same key for equal values (1, 1.0 and 1e0), for counting distinct ones. */
export function keyOfDecimal(/** @type {Decimal} */ d) {
  const t = trimDecimal(d);
  if (t.kind === "finite") return `${t.digits}e${t.scale}`;
  return t.kind === "nan" ? "NaN" : t.sign < 0 ? "-Infinity" : "Infinity";
}

/**
 * d divided by a count, rounded half away from zero to `extra` places past d's scale, with no zeros
 * left at the end of the fraction. @returns {Decimal}
 */
export function divideDecimal(/** @type {Decimal} */ d, /** @type {bigint} */ count, extra = 6) {
  if (d.kind !== "finite") return d;
  const n = d.digits * pow10(extra);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  let q = abs / count;
  if ((abs % count) * 2n >= count) q += 1n;
  return trimDecimal({ kind: "finite", digits: negative ? -q : q, scale: d.scale + extra });
}

/** A value as text: its digits with the point `scale` places from the right. */
export function formatDecimal(/** @type {Decimal} */ d) {
  if (d.kind === "nan") return "NaN";
  if (d.kind === "inf") return d.sign < 0 ? "-Infinity" : "Infinity";
  const negative = d.digits < 0n;
  const abs = (negative ? -d.digits : d.digits).toString().padStart(d.scale + 1, "0");
  const int = abs.slice(0, abs.length - d.scale);
  const frac = d.scale ? `.${abs.slice(abs.length - d.scale)}` : "";
  return `${negative ? "-" : ""}${int}${frac}`;
}

/** A value as a float, only to place it on a chart's axis. */
export function toNumber(/** @type {Decimal} */ d) {
  if (d.kind === "nan") return Number.NaN;
  if (d.kind === "inf") return d.sign * Number.POSITIVE_INFINITY;
  return Number(formatDecimal(d));
}
