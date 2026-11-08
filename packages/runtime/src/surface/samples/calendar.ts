/**
 * Sample surface: this week's calendar as a universal view with inline data (ADR 0103): six events
 * from Monday to Friday, two of them overlapping on Wednesday and tagged so.
 */
import type { UniversalView } from "@endue-ai/bridge";

interface Event {
  day: number;
  start: number;
  end: number;
  title: string;
}

export const EVENTS: Event[] = [
  { day: 0, start: 9.5, end: 10.5, title: "Standup" },
  { day: 1, start: 11, end: 12.5, title: "Design review" },
  { day: 2, start: 14, end: 15, title: "Client call" },
  { day: 2, start: 14.5, end: 16, title: "Budget sync" },
  { day: 3, start: 10, end: 11, title: "1:1 Theo" },
  { day: 4, start: 13, end: 14, title: "Focus" },
];

export function overlaps(events: Event[]): Set<number> {
  const out = new Set<number>();
  events.forEach((a, i) => {
    events.forEach((b, j) => {
      if (i !== j && a.day === b.day && a.start < b.end && b.start < a.end) out.add(i);
    });
  });
  return out;
}

const HOUR = 3_600_000;

/** Monday 00:00 UTC of the week `now` falls in. */
function monday(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

/**
 * The week of `now` (in UTC, so the sample reads the same on every machine) with the events in
 * it; `overlap` is the tag the overlapping ones carry.
 */
export function calendarView(now: number, overlap: string): UniversalView {
  const base = monday(now);
  const at = (day: number, hour: number) =>
    new Date(base + (day * 24 + hour) * HOUR).toISOString().replace(".000Z", "Z");
  const clash = overlaps(EVENTS);
  const entries = EVENTS.map((e, i) => ({
    id: `event-${i + 1}`,
    title: e.title,
    start: at(e.day, e.start),
    end: at(e.day, e.end),
    ...(clash.has(i) ? { tags: [overlap] } : {}),
  }));
  return {
    type: "calendar",
    options: { range: "week", zone: "UTC" },
    source: { data: { entries } },
  };
}
