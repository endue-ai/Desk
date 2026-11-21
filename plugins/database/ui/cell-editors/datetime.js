// The date, time and timestamp editors (PG-40): text as the server writes it (ISO, DateStyle ISO),
// checked before it becomes a pending change: a day that exists, hours, minutes and seconds in range,
// an offset or a zone only where the type keeps one, and PostgreSQL's words (infinity, now, today
// ...). Beside the text, a date picker and a time picker write its parts; the header shows the
// session's time zone for a type that keeps one.

import { el } from "../dom.js";
import { field } from "./panel.js";

/** @typedef {import("./resolve.js").Editor} Editor */

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );
const DAY_WORDS = /^(?:-?infinity|epoch|now|today|tomorrow|yesterday)$/iu;
const TIME_WORDS = /^(?:now|allballs)$/iu;
const DATE = /^(\d{4,})-(\d{2})-(\d{2})$/u;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(.*)$/u;
const ZONE = /^(?:Z|[-+]\d{1,2}(?::?\d{2}(?::?\d{2})?)?|\s+[A-Za-z][A-Za-z0-9_+\-/]*)$/u;
const PARTS = /^(\d{4,}-\d{2}-\d{2})?([ T])?(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(.*)$/u;

const leap = (/** @type {number} */ y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Why an ISO day does not exist, or "" when it does. */
function dayWhy(/** @type {string} */ text, /** @type {boolean} */ bc) {
  const [, y, m, d] = DATE.exec(text) ?? [];
  const [year, month, day] = [Number(y), Number(m), Number(d)];
  if (year === 0) return "There is no year 0: 1 BC comes before 1.";
  if (month < 1 || month > 12) return `Month ${m} does not exist: a month is 01 to 12.`;
  // Before Christ, year n is astronomical year 1 - n (1 BC is a leap year).
  const days =
    [31, leap(bc ? 1 - year : year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ??
    31;
  if (day < 1 || day > days) return `${MONTHS[month - 1]} ${y}${bc ? " BC" : ""} has ${days} days.`;
  return "";
}

/** Why a time (with what follows it) is wrong for the type, or "" when it is right. */
function timeWhy(/** @type {string} */ text, /** @type {Editor} */ editor) {
  const [, h, m, s, rest = ""] = TIME.exec(text) ?? [];
  if (h === undefined) return "";
  const [hour, minute, second] = [Number(h), Number(m), Number(s ?? 0)];
  if (hour > 24 || (hour === 24 && (minute > 0 || second > 0)))
    return `Hour ${h} does not exist: an hour is 00 to 23 (24:00:00 is the end of a day).`;
  if (minute > 59) return `Minute ${m} does not exist: a minute is 00 to 59.`;
  if (second > 60) return `Second ${s} does not exist: a second is 00 to 59.`;
  if (rest && !ZONE.test(rest)) return "bad";
  if (rest && !editor.zone) return `${editor.type} keeps no offset: remove "${rest.trim()}".`;
  return "";
}

const formats = (/** @type {Editor} */ editor) => {
  const zone = editor.zone ? ", with an offset such as +09 if you like" : "";
  if (editor.kind === "date")
    return "A date is YYYY-MM-DD, as 2026-11-21, or infinity, -infinity, today.";
  if (editor.kind === "time") return `A time is HH:MM or HH:MM:SS, as 14:30:00${zone}.`;
  return `A timestamp is YYYY-MM-DD HH:MM[:SS], as 2026-11-21 14:30:00${zone}.`;
};

/** @param {string} text @param {Editor} editor */
function check(text, editor) {
  const t = text.trim();
  const bad = { error: formats(editor) };
  const bc = / BC$/iu.test(t);
  const body = t.replace(/ BC$/iu, "");
  if (editor.kind === "time") {
    if (TIME_WORDS.test(t)) return { value: t };
    if (!TIME.test(t)) return bad;
    const why = timeWhy(t, editor);
    return why === "bad" ? bad : why ? { error: why } : { value: t };
  }
  if (DAY_WORDS.test(t)) return { value: t };
  const [, day, sep, time, rest = ""] = PARTS.exec(body) ?? [];
  if (!day || !DATE.test(day) || (editor.kind === "date" && (sep || time || rest))) return bad;
  const dayError = dayWhy(day, bc);
  if (dayError) return { error: dayError };
  if (editor.kind === "date") return { value: t };
  if (!time) return sep || rest ? bad : { value: t };
  const why = timeWhy(`${time}${rest}`, editor);
  return why === "bad" ? bad : why ? { error: why } : { value: t };
}

/**
 * A date or time picker, and how it reads and writes its part of the text.
 * @param {Document} doc
 * @param {"date" | "time"} part
 */
function picker(doc, part) {
  return /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      type: part,
      class: "desk-field cell-editor-pick",
      ...(part === "time" ? { step: "1" } : {}),
      "aria-label": part === "date" ? "Pick a date" : "Pick a time",
    })
  );
}

/** The editor of a date, time or timestamp. */
export const datetime = {
  check,
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const { doc, editor } = ctx;
    const f = field(ctx, {
      check: (text) => check(text, editor),
      example:
        editor.kind === "date"
          ? "2026-11-21"
          : editor.kind === "time"
            ? "14:30:00"
            : "2026-11-21 14:30:00",
    });
    const date = editor.kind === "time" ? undefined : picker(doc, "date");
    const time = editor.kind === "date" ? undefined : picker(doc, "time");
    /** The text's parts: day, separator, time, what follows (an offset); a time alone for time. */
    const parts = () => {
      const text = f.input.value.trim();
      if (DAY_WORDS.test(text) || TIME_WORDS.test(text))
        return { day: "", sep: "", time: "", rest: "" };
      if (editor.kind === "time") {
        const [, h, m, s, rest = ""] = TIME.exec(text) ?? [];
        return {
          day: "",
          sep: "",
          time: h ? `${h.padStart(2, "0")}:${m}${s ? `:${s}` : ""}` : "",
          rest,
        };
      }
      const [, day = "", sep = "", clock = "", rest = ""] = PARTS.exec(text) ?? [];
      return { day, sep, time: clock, rest };
    };
    const fromText = () => {
      const p = parts();
      if (date) date.value = p.day;
      if (time) time.value = p.time.replace(/\.\d+$/u, "").padStart(5, "0");
    };
    /** Write the part a picker changed into the text, keeping the rest (a fraction, an offset). */
    const toText = (/** @type {"date" | "time"} */ from) => {
      const p = parts();
      const picked = time?.value ?? "";
      const day = from === "date" ? (date?.value ?? "") : p.day;
      const clock = from === "time" ? (picked.length === 5 ? `${picked}:00` : picked) : p.time;
      if (editor.kind === "date") f.input.value = day;
      else if (editor.kind === "time") f.input.value = `${clock}${p.rest}`;
      else f.input.value = `${day}${day && clock ? p.sep || " " : ""}${clock}${p.rest}`;
      ctx.clear();
    };
    date?.addEventListener("input", () => toText("date"));
    time?.addEventListener("input", () => toText("time"));
    f.input.addEventListener("input", fromText);
    fromText();
    const row = el(doc, "div", { class: "cell-editor-picks" }, date, time);
    return {
      el: el(doc, "div", { class: "cell-editor-body" }, f.input, row),
      read: f.read,
      focus: f.focus,
    };
  },
};
