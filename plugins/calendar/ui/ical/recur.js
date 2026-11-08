// The recurrence set a rule makes (RFC 5545 §3.3.10 and §3.8.5.3), in wall time: the rule is applied
// to the local date and time of DTSTART, so a 09:00 meeting stays at 09:00 across a time change.
// Each period of FREQ (a year, a month, a week, a day, an hour...) builds its candidate days and
// times as the BYxxx table says (expand or limit), then BYSETPOS picks among them. DTSTART always
// counts as the first occurrence.
import { DAY, dayNumber, daysInMonth, HOUR, isLeap, MINUTE, weekday, ymd } from "./values.js";

/** @typedef {import("./rrule.js").Rule} Rule */

/** Periods a single expansion may walk before it gives up: a rule that never matches ends here. */
const MAX_PERIODS = 1_000_000;

/**
 * The first day of week 1 of a year: weeks start on `wkst`, and week 1 is the first one with at
 * least four days in the year (ISO 8601, as BYWEEKNO counts).
 * @param {number} y
 * @param {number} wkst
 */
const weekOneStart = (y, wkst) => {
  const jan1 = dayNumber(y, 1, 1);
  const into = (weekday(jan1) - wkst + 7) % 7;
  return into <= 3 ? jan1 - into : jan1 + 7 - into;
};

/**
 * Whether a day is in one of the weeks BYWEEKNO names; negative numbers count from the last week of
 * the year the day's week belongs to.
 * @param {number} day
 * @param {number[]} weeks
 * @param {number} wkst
 */
const inWeeks = (day, weeks, wkst) => {
  let { y } = ymd(day);
  if (day < weekOneStart(y, wkst)) y--;
  else if (day >= weekOneStart(y + 1, wkst)) y++;
  const first = weekOneStart(y, wkst);
  const count = (weekOneStart(y + 1, wkst) - first) / 7;
  const week = Math.floor((day - first) / 7) + 1;
  return weeks.some((n) => (n > 0 ? n === week : count + n + 1 === week));
};

/**
 * Whether `day` is the n-th of its weekday between `first` and `last` (negative n counts back).
 * @param {number} day
 * @param {number} n
 * @param {number} first
 * @param {number} last
 */
const nth = (day, n, first, last) =>
  n > 0 ? Math.floor((day - first) / 7) + 1 === n : Math.floor((last - day) / 7) + 1 === -n;

/**
 * @typedef {object} ExpandOptions
 * @property {number} end no start after this wall time is wanted: expansion stops there
 * @property {number} [from] no start before this wall time is wanted; without COUNT, whole periods
 *   before it are skipped
 * @property {(wall: number) => boolean} [pastUntil] whether a start is after UNTIL; the caller
 *   compares in the zone of DTSTART
 */

/**
 * The starts of a recurrence set, as wall times in increasing order, DTSTART first.
 * @param {Rule} rule
 * @param {number} start DTSTART as a wall time
 * @param {ExpandOptions} options
 * @returns {Generator<number>}
 */
export function* expand(rule, start, { end, from, pastUntil = () => false }) {
  const freq = rule.freq;
  const order = ["YEARLY", "MONTHLY", "WEEKLY", "DAILY", "HOURLY", "MINUTELY", "SECONDLY"].indexOf(
    freq,
  );
  const startDay = Math.floor(start / DAY);
  const startSeconds = Math.round((start - startDay * DAY) / 1000);
  const [sh, smi, ss] = [
    Math.floor(startSeconds / 3600),
    Math.floor(startSeconds / 60) % 60,
    startSeconds % 60,
  ];
  const s = ymd(startDay);

  let { bymonth, bymonthday, byday } = rule;
  const { byyearday, byweekno, bysetpos, wkst, interval } = rule;
  if (!byweekno && !byyearday && !bymonthday && !byday) {
    if (freq === "YEARLY") {
      bymonth ??= [s.m];
      bymonthday = [s.d];
    } else if (freq === "MONTHLY") bymonthday = [s.d];
    else if (freq === "WEEKLY") byday = [{ n: 0, wd: weekday(startDay) }];
  }
  const byhour = rule.byhour ?? (order < 4 ? [sh] : undefined);
  const byminute = rule.byminute ?? (order < 5 ? [smi] : undefined);
  const bysecond = rule.bysecond ?? (order < 6 ? [ss] : undefined);
  const plain = new Set(byday?.filter((d) => d.n === 0).map((d) => d.wd));
  const numbered = byday?.filter((d) => d.n !== 0) ?? [];
  // A numbered BYDAY counts within the month for MONTHLY, and for YEARLY with BYMONTH.
  const inMonth = freq === "MONTHLY" || (freq === "YEARLY" && rule.bymonth !== undefined);

  /** @param {number} day */
  const keep = (day) => {
    const { y, m, d } = ymd(day);
    if (bymonth && !bymonth.includes(m)) return false;
    if (byweekno && !inWeeks(day, byweekno, wkst)) return false;
    if (byyearday) {
      const doy = day - dayNumber(y, 1, 1) + 1;
      const size = isLeap(y) ? 366 : 365;
      if (!byyearday.some((n) => (n > 0 ? n === doy : size + n + 1 === doy))) return false;
    }
    if (bymonthday) {
      const size = daysInMonth(y, m);
      if (!bymonthday.some((n) => (n > 0 ? n === d : size + n + 1 === d))) return false;
    }
    if (byday) {
      const wd = weekday(day);
      if (plain.has(wd)) return true;
      const first = inMonth ? dayNumber(y, m, 1) : dayNumber(y, 1, 1);
      const last = inMonth ? first + daysInMonth(y, m) - 1 : dayNumber(y + 1, 1, 1) - 1;
      return numbered.some((b) => b.wd === wd && nth(day, b.n, first, last));
    }
    return true;
  };

  /** Every combination of the listed hours, minutes and seconds, in seconds of the day, sorted. */
  const times = (
    /** @type {number[]} */ hours,
    /** @type {number[]} */ minutes,
    /** @type {number[]} */ seconds,
  ) =>
    hours
      .flatMap((h) => minutes.flatMap((mi) => seconds.map((sec) => (h * 60 + mi) * 60 + sec)))
      .sort((a, b) => a - b);
  const dailyTimes = order < 4 ? times(byhour ?? [], byminute ?? [], bysecond ?? []) : [];

  // The period: a year and month for YEARLY and MONTHLY, a day for WEEKLY and DAILY (the week is the
  // one holding it), a wall time for the finer ones.
  let y = s.y;
  let m = s.m;
  let day = startDay;
  let wall = order === 4 ? startDay * DAY + sh * HOUR : order === 5 ? start - ss * 1000 : start;

  if (rule.count === undefined && from !== undefined && from > start) {
    // Skip whole periods that end before `from`; one period of margin keeps BYSETPOS whole.
    const f = ymd(Math.floor(from / DAY));
    const skip = (/** @type {number} */ units) => Math.max(0, Math.floor(units / interval) - 1);
    if (order === 0) y += skip(f.y - s.y) * interval;
    else if (order === 1) {
      const months = skip((f.y - s.y) * 12 + f.m - s.m) * interval;
      y += Math.floor((m - 1 + months) / 12);
      m = ((m - 1 + months) % 12) + 1;
    } else if (order === 2) day += skip(Math.floor((from - start) / (7 * DAY))) * 7 * interval;
    else if (order === 3) day += skip(Math.floor((from - start) / DAY)) * interval;
    else {
      const unit = order === 4 ? HOUR : order === 5 ? MINUTE : 1000;
      wall += skip(Math.floor((from - wall) / unit)) * interval * unit;
    }
  }

  let count = 0;
  if (!pastUntil(start)) {
    yield start;
    count++;
  } else return;

  for (let period = 0; period < MAX_PERIODS; period++) {
    /** @type {number[]} */
    let days;
    /** @type {number} */
    let periodStart;
    if (order === 0) {
      periodStart = dayNumber(y, 1, 1);
      const months = bymonth ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      days = byweekno || byyearday ? range(periodStart, dayNumber(y + 1, 1, 1)) : [];
      if (!byweekno && !byyearday)
        for (const month of [...months].sort((a, b) => a - b)) {
          const first = dayNumber(y, month, 1);
          days.push(...range(first, first + daysInMonth(y, month)));
        }
    } else if (order === 1) {
      periodStart = dayNumber(y, m, 1);
      days = range(periodStart, periodStart + daysInMonth(y, m));
    } else if (order === 2) {
      periodStart = day - ((weekday(day) - wkst + 7) % 7);
      days = range(periodStart, periodStart + 7);
    } else {
      periodStart = order === 3 ? day : Math.floor(wall / DAY);
      days = [periodStart];
    }
    if (periodStart * DAY > end || ymd(periodStart).y > 9999) return;

    /** @type {number[]} */
    let set = [];
    for (const d of days) {
      if (!keep(d)) continue;
      if (order < 4) {
        for (const t of dailyTimes) set.push(d * DAY + t * 1000);
        continue;
      }
      const seconds = Math.round((wall - d * DAY) / 1000);
      const [h, mi] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60];
      if (byhour && !byhour.includes(h)) continue;
      if (order === 4) {
        for (const t of times([h], byminute ?? [], bysecond ?? [])) set.push(d * DAY + t * 1000);
        continue;
      }
      if (byminute && !byminute.includes(mi)) continue;
      if (order === 5) {
        for (const sec of [...(bysecond ?? [])].sort((a, b) => a - b))
          set.push(d * DAY + ((h * 60 + mi) * 60 + sec) * 1000);
        continue;
      }
      if (bysecond && !bysecond.includes(seconds % 60)) continue;
      set.push(wall);
    }
    if (bysetpos) {
      const picked = new Set(
        bysetpos.map((n) => set[n > 0 ? n - 1 : set.length + n]).filter((v) => v !== undefined),
      );
      set = [...picked].sort((a, b) => a - b);
    }

    for (const candidate of set) {
      if (candidate <= start) continue;
      if (candidate > end || pastUntil(candidate)) return;
      yield candidate;
      count++;
      if (rule.count !== undefined && count >= rule.count) return;
    }

    if (order === 0) y += interval;
    else if (order === 1) {
      m += interval;
      y += Math.floor((m - 1) / 12);
      m = ((m - 1) % 12) + 1;
    } else if (order === 2) day += 7 * interval;
    else if (order === 3) day += interval;
    else wall += interval * (order === 4 ? HOUR : order === 5 ? MINUTE : 1000);
  }
}

/** The integers from `from` up to, not including, `to`. */
const range = (/** @type {number} */ from, /** @type {number} */ to) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
