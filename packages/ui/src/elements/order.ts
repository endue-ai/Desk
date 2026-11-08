// How the elements order values they are given: times as instants, numbers as numbers, text by the
// person's language; a missing value goes last whichever way the order runs.

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const missing = (value: unknown) => value === undefined || value === null || value === "";

/** Compare two values for an order; `sign` 1 is ascending, -1 descending. */
export function compareValues(a: unknown, b: unknown, sign: 1 | -1 = 1): number {
  if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  const [x, y] = [String(a), String(b)];
  if (TIME.test(x) && TIME.test(y)) return sign * (Date.parse(x) - Date.parse(y));
  return sign * x.localeCompare(y);
}

/** Milliseconds since the epoch of an RFC 3339 time, a Date or a number; NaN for anything else. */
export function instant(value: unknown): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}
