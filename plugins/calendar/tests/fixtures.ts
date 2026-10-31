// Calendars for the tests: a VCALENDAR around VEVENT lines, parsed into a model, and the occurrences of
// a window, shown as "date time title" strings in the display zone so expectations stay readable.

import { buildModel, type Occurrence, occurrences } from "../ui/calendar/model.js";
import { formatComponent, parse } from "../ui/ical/component.js";
import { ianaZone } from "../ui/ical/zones.js";

export const SEOUL = ianaZone("Asia/Seoul") as NonNullable<ReturnType<typeof ianaZone>>;
export const NEW_YORK = ianaZone("America/New_York") as NonNullable<ReturnType<typeof ianaZone>>;

/** A VCALENDAR holding these VEVENTs, each given as its property lines. */
export const ics = (...events: string[][]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

export const model = (text: string, display = SEOUL) => buildModel(parse(text), display, "Test");

/** An instant from an ISO string with an offset. */
export const at = (iso: string) => Date.parse(iso);

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-30 09:00 Title" in the display zone, or "2026-10-30 all-day Title". */
export const label = (occ: Occurrence) => {
  const d = new Date(occ.startWall);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = occ.allDay ? "all-day" : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date} ${time} ${occ.title}`;
};

export const labels = (text: string, from: string, to: string, display = SEOUL) =>
  occurrences(model(text, display), at(from), at(to)).map(label);

/** The document written back as text. */
export const written = (doc: ReturnType<typeof parse>) =>
  doc.calendars.map(formatComponent).join("");
