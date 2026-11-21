// The interval editor (PG-40): PostgreSQL's forms (datatype-datetime.html, 8.5.4): numbers with
// units (3 hours, 1 year 2 mons, 1.5 weeks), a time (02:00:00), the @ and ago of the old style, a
// year-month 1-2, infinity, and ISO 8601 (P1Y2M3DT4H5M6S). The value stays as typed.

import { field } from "./panel.js";

const UNITS = new Set(
  (
    "microsecond microseconds us usec usecs millisecond milliseconds ms msec msecs second seconds s " +
    "sec secs minute minutes m min mins hour hours h hr hrs day days d week weeks w month months mon " +
    "mons year years y yr yrs decade decades dec decs century centuries c cent millennium millennia mil mils"
  ).split(" "),
);
const ISO =
  /^P(?!$)(?:-?\d+(?:\.\d+)?Y)?(?:-?\d+(?:\.\d+)?M)?(?:-?\d+(?:\.\d+)?W)?(?:-?\d+(?:\.\d+)?D)?(?:T(?=-?\d)(?:-?\d+(?:\.\d+)?H)?(?:-?\d+(?:\.\d+)?M)?(?:-?\d+(?:\.\d+)?S)?)?$/iu;
const NUMBER = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))([a-z]*)$/iu;
const CLOCK = /^[-+]?\d+:\d{2}(?::\d{2}(?:\.\d+)?)?$/u;
const YEAR_MONTH = /^[-+]?\d+-\d+$/u;
const HOW =
  "An interval is numbers with units, as 3 hours or 1 day 02:00:00, or ISO 8601, as P1DT2H.";

export const interval = {
  check(/** @type {string} */ text) {
    const t = text.trim();
    if (!t) return { error: HOW };
    if (/^[-+]?infinity$/iu.test(t) || ISO.test(t)) return { value: t };
    const words = t
      .replace(/^@\s*/u, "")
      .replace(/\s+ago$/iu, "")
      .split(/\s+/u)
      .filter(Boolean);
    if (words.length === 0) return { error: HOW };
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? "";
      if (CLOCK.test(word) || YEAR_MONTH.test(word)) continue;
      const number = NUMBER.exec(word);
      if (!number) return { error: `"${word}" is not part of an interval: ${HOW}` };
      const unit =
        number[2] ||
        (i + 1 < words.length && !NUMBER.test(words[i + 1] ?? "") && !CLOCK.test(words[i + 1] ?? "")
          ? words[++i]
          : "");
      if (unit && !UNITS.has(unit.toLowerCase()))
        return {
          error: `"${unit}" is not a unit of an interval: use seconds, minutes, hours, days, weeks, months or years.`,
        };
      if (!unit && i + 1 < words.length) return { error: `${word} needs a unit: ${HOW}` };
    }
    return { value: t };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const f = field(ctx, { check: interval.check, example: "1 day 02:00:00" });
    return { el: f.input, read: f.read, focus: f.focus };
  },
};
