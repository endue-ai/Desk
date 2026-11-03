import { DAY } from "./ical/values.js";

/** A day from words: 2026-11-03, 2026-11, today, tomorrow, yesterday. */
export function dayFrom(/** @type {string} */ words, /** @type {number} */ today) {
  const text = words.trim().toLowerCase();
  const relative = { today: 0, tomorrow: 1, yesterday: -1 }[text];
  if (relative !== undefined) return today + relative;
  const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? 1);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return Math.floor(date.getTime() / DAY);
}
