// Dates as the views count them: a date is YYYY-MM-DD, a day is its number since 1970-01-01, and
// nothing here reads a time zone, so a source's date stays the date it wrote. Today is the
// person's local date, read once from the clock the plugin is given.

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The first day of the week by the setting's name, as Date.getUTCDay counts it. */
export const WEEK_STARTS = /** @type {Record<string, number>} */ ({
  sunday: 0,
  monday: 1,
  saturday: 6,
});

/** The day number of a date, or NaN for anything else. */
export function dayOf(/** @type {string | undefined} */ date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** The date of a day number. */
export const dateOfDay = (/** @type {number} */ day) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The person's local date at a moment. */
export function todayOf(/** @type {number} */ ms) {
  const d = new Date(ms);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The weekday of a day number, 0 Sunday to 6 Saturday. */
export const weekdayOf = (/** @type {number} */ day) => new Date(day * DAY_MS).getUTCDay();

/** The first day of the week that holds `day`. */
export const weekStartOf = (/** @type {number} */ day, /** @type {number} */ weekStart) =>
  day - ((weekdayOf(day) - weekStart + 7) % 7);

/** The first day of the month that holds `day`, and the day after its last. */
export function monthOf(/** @type {number} */ day) {
  const d = new Date(day * DAY_MS);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS;
  return { first, next, year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** The same day of the month `months` away, kept inside a shorter month. */
export function addMonths(/** @type {number} */ day, /** @type {number} */ months) {
  const d = new Date(day * DAY_MS);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1) / DAY_MS;
  const { next } = monthOf(target);
  return Math.min(target + d.getUTCDate() - 1, next - 1);
}

/** "Oct 30", with the year when it is not this year's: "Jan 4, 2027". */
export function shortDate(/** @type {string | undefined} */ date, /** @type {string} */ today) {
  const day = dayOf(date);
  if (Number.isNaN(day)) return "";
  const d = new Date(day * DAY_MS);
  const text = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return date?.slice(0, 4) === today.slice(0, 4) ? text : `${text}, ${d.getUTCFullYear()}`;
}

/** "October 2026". */
export function monthTitle(/** @type {number} */ day) {
  const d = new Date(day * DAY_MS);
  const long = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(d);
  return `${long} ${d.getUTCFullYear()}`;
}

/** The month's short name and the day of the month, for a timeline's scale. */
export function dayParts(/** @type {number} */ day) {
  const d = new Date(day * DAY_MS);
  return { month: MONTHS[d.getUTCMonth()] ?? "", date: d.getUTCDate(), weekday: d.getUTCDay() };
}
