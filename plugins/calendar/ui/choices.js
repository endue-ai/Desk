// The choices the editor offers: repeat presets made from the start date (every week on its weekday,
// every month on its day or on its n-th weekday) and reminder times. A rule that is none of them is
// "custom" and kept as written, so the editor never rewrites a rule it did not make.
import { WEEKDAYS } from "./ical/rrule.js";
import { DAY, daysInMonth, weekday, ymd } from "./ical/values.js";

const ORDINALS = ["first", "second", "third", "fourth", "last"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The repeat presets for an event that starts at `start` (a wall time).
 * @param {number} start
 * @returns {Array<{ id: string, label: string, rrule: string | null }>}
 */
export function repeatPresets(start) {
  const day = Math.floor(start / DAY);
  const { y, m, d } = ymd(day);
  const wd = weekday(day);
  const last = d + 7 > daysInMonth(y, m);
  const n = last ? -1 : Math.ceil(d / 7);
  return [
    { id: "none", label: "Does not repeat", rrule: null },
    { id: "daily", label: "Every day", rrule: "FREQ=DAILY" },
    {
      id: "weekdays",
      label: "Every weekday (Monday to Friday)",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    },
    {
      id: "weekly",
      label: `Every week on ${DAY_NAMES[wd]}`,
      rrule: `FREQ=WEEKLY;BYDAY=${WEEKDAYS[wd]}`,
    },
    { id: "monthly-day", label: `Every month on day ${d}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` },
    {
      id: "monthly-weekday",
      label: `Every month on the ${ORDINALS[n < 0 ? 4 : n - 1]} ${DAY_NAMES[wd]}`,
      rrule: `FREQ=MONTHLY;BYDAY=${n}${WEEKDAYS[wd]}`,
    },
    {
      id: "yearly",
      label: `Every year on ${MONTH_NAMES[m - 1]} ${d}`,
      rrule: `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}`,
    },
  ];
}

/** Rules that say the same as a preset without naming the day: the day comes from DTSTART. */
const BARE = /** @type {Record<string, string>} */ ({
  "FREQ=DAILY": "daily",
  "FREQ=WEEKLY": "weekly",
  "FREQ=MONTHLY": "monthly-day",
  "FREQ=YEARLY": "yearly",
});

/**
 * The preset a rule is for an event starting at `start`: "none", a preset id, or "custom".
 * @param {string | null | undefined} rrule
 * @param {number} start
 */
export function presetOf(rrule, start) {
  if (!rrule) return "none";
  const text = rrule.trim().toUpperCase();
  const bare = BARE[text];
  if (bare) return bare;
  return repeatPresets(start).find((p) => p.rrule === text)?.id ?? "custom";
}

/** The reminder choices, in minutes before the start, for a timed and for an all-day event. */
export const REMINDERS = {
  timed: [
    { minutes: 0, label: "At the start" },
    { minutes: 5, label: "5 minutes before" },
    { minutes: 10, label: "10 minutes before" },
    { minutes: 15, label: "15 minutes before" },
    { minutes: 30, label: "30 minutes before" },
    { minutes: 60, label: "1 hour before" },
    { minutes: 120, label: "2 hours before" },
    { minutes: 1440, label: "1 day before" },
  ],
  allDay: [
    { minutes: -540, label: "On the day at 9:00" },
    { minutes: 900, label: "The day before at 9:00" },
    { minutes: 9540, label: "A week before at 9:00" },
  ],
};
