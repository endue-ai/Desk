// RECUR values (RFC 5545 §3.3.10): FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE. Parsing checks every part's
// range and the rules the RFC states between parts; a rule with an error is not expanded, and the
// event shows once, at its start. Parts this plugin does not know (RSCALE, SKIP from RFC 7529) are
// errors too: guessing would put events on the wrong days.
import { parseTime } from "./values.js";

/** @typedef {import("./values.js").TimeValue} TimeValue */

export const FREQS = /** @type {const} */ ([
  "YEARLY",
  "MONTHLY",
  "WEEKLY",
  "DAILY",
  "HOURLY",
  "MINUTELY",
  "SECONDLY",
]);
export const WEEKDAYS = /** @type {const} */ (["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);

/**
 * @typedef {typeof FREQS[number]} Freq
 * @typedef {{ n: number, wd: number }} ByDay an ordinal (0 for every one) and a weekday, 0 = SU
 * @typedef {{ freq: Freq, interval: number, count?: number, until?: TimeValue,
 *   bysecond?: number[], byminute?: number[], byhour?: number[], byday?: ByDay[],
 *   bymonthday?: number[], byyearday?: number[], byweekno?: number[], bymonth?: number[],
 *   bysetpos?: number[], wkst: number }} Rule
 */

/**
 * @param {string} text
 * @param {number} min
 * @param {number} max
 * @param {boolean} [signed] negative values from -max to -min count from the end
 */
const numbers = (text, min, max, signed = false) => {
  const list = text.split(",").map((part) => {
    if (!/^[+-]?\d+$/.test(part)) throw new Error(`${part} is not a number`);
    const n = Number(part);
    const size = Math.abs(n);
    if (size < min || size > max || (n < 0 && !signed)) throw new Error(`${part} is out of range`);
    return n;
  });
  return [...new Set(list)];
};

/** @param {string} text */
const weekdayOf = (text) => {
  const wd = WEEKDAYS.indexOf(/** @type {typeof WEEKDAYS[number]} */ (text.toUpperCase()));
  if (wd < 0) throw new Error(`${text} is not a weekday`);
  return wd;
};

/**
 * Parse a RECUR value.
 * @param {string} text
 * @returns {{ rule: Rule } | { error: string }}
 */
export function parseRule(text) {
  /** @type {Partial<Rule>} */
  const rule = { interval: 1, wkst: 1 };
  const seen = new Set();
  try {
    for (const part of text.trim().split(";")) {
      if (part === "") continue;
      const eq = part.indexOf("=");
      if (eq < 1) throw new Error(`${part} is not NAME=VALUE`);
      const name = part.slice(0, eq).toUpperCase();
      const value = part.slice(eq + 1);
      if (seen.has(name)) throw new Error(`${name} appears twice`);
      seen.add(name);
      switch (name) {
        case "FREQ": {
          const freq = /** @type {Freq} */ (value.toUpperCase());
          if (!FREQS.includes(freq)) throw new Error(`FREQ=${value} is unknown`);
          rule.freq = freq;
          break;
        }
        case "INTERVAL":
          rule.interval = numbers(value, 1, 1_000_000)[0];
          break;
        case "COUNT":
          rule.count = numbers(value, 1, 1_000_000)[0];
          break;
        case "UNTIL": {
          const until = parseTime(value);
          if (!until) throw new Error(`UNTIL=${value} is not a date or date-time`);
          rule.until = until;
          break;
        }
        case "BYSECOND":
          rule.bysecond = numbers(value, 0, 60);
          break;
        case "BYMINUTE":
          rule.byminute = numbers(value, 0, 59);
          break;
        case "BYHOUR":
          rule.byhour = numbers(value, 0, 23);
          break;
        case "BYDAY":
          rule.byday = value.split(",").map((day) => {
            const match = /^([+-]?\d{1,2})?([A-Za-z]{2})$/.exec(day);
            if (!match) throw new Error(`BYDAY ${day} is malformed`);
            const n = match[1] ? Number(match[1]) : 0;
            if (match[1] && (n === 0 || Math.abs(n) > 53))
              throw new Error(`BYDAY ${day} is out of range`);
            return { n, wd: weekdayOf(match[2] ?? "") };
          });
          break;
        case "BYMONTHDAY":
          rule.bymonthday = numbers(value, 1, 31, true);
          break;
        case "BYYEARDAY":
          rule.byyearday = numbers(value, 1, 366, true);
          break;
        case "BYWEEKNO":
          rule.byweekno = numbers(value, 1, 53, true);
          break;
        case "BYMONTH":
          rule.bymonth = numbers(value, 1, 12);
          break;
        case "BYSETPOS":
          rule.bysetpos = numbers(value, 1, 366, true);
          break;
        case "WKST":
          rule.wkst = weekdayOf(value);
          break;
        default:
          throw new Error(`${name} is not supported`);
      }
    }
  } catch (error) {
    return { error: /** @type {Error} */ (error).message };
  }
  if (!rule.freq) return { error: "FREQ is missing" };
  if (rule.count !== undefined && rule.until) return { error: "COUNT and UNTIL are both given" };
  const order = FREQS.indexOf(rule.freq);
  if (rule.byweekno && rule.freq !== "YEARLY") return { error: "BYWEEKNO needs FREQ=YEARLY" };
  if (rule.byyearday && order >= 1 && order <= 3)
    return { error: `BYYEARDAY does not go with FREQ=${rule.freq}` };
  if (rule.bymonthday && rule.freq === "WEEKLY")
    return { error: "BYMONTHDAY does not go with FREQ=WEEKLY" };
  const ordinal = rule.byday?.some((day) => day.n !== 0);
  if (ordinal && rule.freq !== "MONTHLY" && rule.freq !== "YEARLY")
    return { error: `a numbered BYDAY needs FREQ=MONTHLY or YEARLY, not ${rule.freq}` };
  if (ordinal && rule.freq === "YEARLY" && rule.byweekno)
    return { error: "a numbered BYDAY does not go with BYWEEKNO" };
  return { rule: /** @type {Rule} */ (rule) };
}

/**
 * Write a rule with its parts in the RFC's order. UNTIL is written as given.
 * @param {Rule} rule
 * @param {(until: TimeValue) => string} formatUntil
 */
export function formatRule(rule, formatUntil) {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.until) parts.push(`UNTIL=${formatUntil(rule.until)}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  const list = (/** @type {string} */ name, /** @type {number[] | undefined} */ values) => {
    if (values?.length) parts.push(`${name}=${values.join(",")}`);
  };
  list("BYSECOND", rule.bysecond);
  list("BYMINUTE", rule.byminute);
  list("BYHOUR", rule.byhour);
  if (rule.byday?.length)
    parts.push(`BYDAY=${rule.byday.map((day) => `${day.n || ""}${WEEKDAYS[day.wd]}`).join(",")}`);
  list("BYMONTHDAY", rule.bymonthday);
  list("BYYEARDAY", rule.byyearday);
  list("BYWEEKNO", rule.byweekno);
  list("BYMONTH", rule.bymonth);
  list("BYSETPOS", rule.bysetpos);
  if (rule.wkst !== 1) parts.push(`WKST=${WEEKDAYS[rule.wkst]}`);
  return parts.join(";");
}
