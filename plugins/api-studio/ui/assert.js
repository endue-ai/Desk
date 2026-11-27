// Assertions without code: a row reads a value from the response (the same expressions captures
// use), applies an operator and compares with an expected value, which may hold {{variables}}
// and is read as a number, true/false/null, JSON or text. Each gives a pass or a failure in words.

import { read } from "./expr.js";

/** @typedef {import("./model.js").Assertion} Assertion @typedef {import("./send.js").Response} Response */

/** Operators: id, label, whether it takes a value. */
export const OPS = /** @type {const} */ ([
  ["eq", "equals", true],
  ["neq", "does not equal", true],
  ["gt", ">", true],
  ["gte", "≥", true],
  ["lt", "<", true],
  ["lte", "≤", true],
  ["contains", "contains", true],
  ["notContains", "does not contain", true],
  ["startsWith", "starts with", true],
  ["endsWith", "ends with", true],
  ["matches", "matches regex", true],
  ["in", "is one of", true],
  ["length", "has length", true],
  ["isEmpty", "is empty", false],
  ["isNotEmpty", "is not empty", false],
  ["isDefined", "exists", false],
  ["isUndefined", "does not exist", false],
  ["isNull", "is null", false],
  ["isTruthy", "is truthy", false],
  ["isFalsy", "is falsy", false],
  ["isNumber", "is a number", false],
  ["isString", "is a string", false],
  ["isBoolean", "is a boolean", false],
  ["isArray", "is an array", false],
  ["isObject", "is an object", false],
]);

/** An expected value as typed: numbers, booleans, null, JSON, "quoted" text, else text. @param {string} text */
export function expected(text) {
  const t = text.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  if (t === "null") return null;
  if (/^["[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

/** @param {unknown} v */
const show = (v) =>
  v === undefined
    ? "nothing"
    : typeof v === "string"
      ? JSON.stringify(v)
      : (JSON.stringify(v) ?? String(v));
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => {
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b)))
    return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a)))
    return Number(a) === b;
  return JSON.stringify(a) === JSON.stringify(b);
};
/** @param {unknown} v */
const size = (v) =>
  typeof v === "string" || Array.isArray(v)
    ? v.length
    : v && typeof v === "object"
      ? Object.keys(v).length
      : undefined;

/**
 * Check one assertion on a response.
 * @param {Assertion} a @param {Response} res @param {(text: string) => string} fill
 * @returns {{ ok: boolean, message: string, actual?: unknown }}
 */
export function check(a, res, fill) {
  /** @type {unknown} */
  let actual;
  try {
    actual = read(a.target, res);
  } catch (error) {
    return { ok: false, message: String(/** @type {Error} */ (error).message) };
  }
  const want = expected(fill(a.value));
  const label = OPS.find(([id]) => id === a.op)?.[1] ?? a.op;
  const fail = (/** @type {string} */ why) => ({ ok: false, message: why, actual });
  const pass = {
    ok: true,
    message: `${a.target} ${label}${OPS.find(([id]) => id === a.op)?.[2] ? ` ${show(want)}` : ""}`,
    actual,
  };
  const num = (/** @type {unknown} */ v) =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  const text = (/** @type {unknown} */ v) =>
    typeof v === "string" ? v : (JSON.stringify(v) ?? "");
  switch (a.op) {
    case "eq":
      return same(actual, want) ? pass : fail(`expected ${show(want)}, got ${show(actual)}`);
    case "neq":
      return !same(actual, want) ? pass : fail(`expected anything but ${show(want)}`);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const x = num(actual);
      const y = num(want);
      if (Number.isNaN(x) || Number.isNaN(y))
        return fail(`cannot compare ${show(actual)} with ${show(want)} as numbers`);
      const ok = a.op === "gt" ? x > y : a.op === "gte" ? x >= y : a.op === "lt" ? x < y : x <= y;
      return ok ? pass : fail(`expected ${label} ${y}, got ${x}`);
    }
    case "contains":
    case "notContains": {
      const has = Array.isArray(actual)
        ? actual.some((x) => same(x, want))
        : text(actual).includes(text(want));
      return has === (a.op === "contains")
        ? pass
        : fail(
            `${show(actual)} ${a.op === "contains" ? "does not contain" : "contains"} ${show(want)}`,
          );
    }
    case "startsWith":
      return text(actual).startsWith(text(want))
        ? pass
        : fail(`${show(actual)} does not start with ${show(want)}`);
    case "endsWith":
      return text(actual).endsWith(text(want))
        ? pass
        : fail(`${show(actual)} does not end with ${show(want)}`);
    case "matches": {
      try {
        const m = /^\/(.*)\/([gimsuy]*)$/.exec(String(want));
        const re = m ? new RegExp(m[1] ?? "", m[2]) : new RegExp(String(want));
        return re.test(text(actual))
          ? pass
          : fail(`${show(actual)} does not match ${String(want)}`);
      } catch {
        return fail(`${String(want)} is not a regular expression`);
      }
    }
    case "in": {
      const list = Array.isArray(want)
        ? want
        : String(want)
            .split(",")
            .map((s) => expected(s));
      return list.some((x) => same(actual, x))
        ? pass
        : fail(`${show(actual)} is not one of ${show(list)}`);
    }
    case "length": {
      const n = size(actual);
      return n === num(want)
        ? pass
        : fail(`expected length ${show(want)}, got ${n ?? "no length"}`);
    }
    case "isEmpty":
      return size(actual) === 0 || actual === "" ? pass : fail(`${show(actual)} is not empty`);
    case "isNotEmpty":
      return (size(actual) ?? 0) > 0 ? pass : fail(`${show(actual)} is empty`);
    case "isDefined":
      return actual !== undefined ? pass : fail(`${a.target} is not there`);
    case "isUndefined":
      return actual === undefined ? pass : fail(`${a.target} is there: ${show(actual)}`);
    case "isNull":
      return actual === null ? pass : fail(`expected null, got ${show(actual)}`);
    case "isTruthy":
      return actual ? pass : fail(`${show(actual)} is falsy`);
    case "isFalsy":
      return !actual ? pass : fail(`${show(actual)} is truthy`);
    case "isNumber":
    case "isString":
    case "isBoolean": {
      const type = a.op.slice(2).toLowerCase();
      return typeof actual === type ? pass : fail(`expected a ${type}, got ${show(actual)}`);
    }
    case "isArray":
      return Array.isArray(actual) ? pass : fail(`expected an array, got ${show(actual)}`);
    case "isObject":
      return actual !== null && typeof actual === "object" && !Array.isArray(actual)
        ? pass
        : fail(`expected an object, got ${show(actual)}`);
    default:
      return fail(`unknown operator ${a.op}`);
  }
}
