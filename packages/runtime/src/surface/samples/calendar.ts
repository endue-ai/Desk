/** Sample surface: a week grid. Events that overlap get the attention outline and say so in words. */
import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";

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

const FIRST = 9;
const LAST = 17;

export function overlaps(events: Event[]): Set<number> {
  const out = new Set<number>();
  events.forEach((a, i) => {
    events.forEach((b, j) => {
      if (i !== j && a.day === b.day && a.start < b.end && b.start < a.end) out.add(i);
    });
  });
  return out;
}

export function calendarBody(ctx: ShellCtx): HTMLElement {
  const days =
    ctx.store.get().lang === "ko"
      ? ["월", "화", "수", "목", "금"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const clash = overlaps(EVENTS);
  const span = LAST - FIRST;
  // Overlapping events sit side by side: the earlier one left, the later one right.
  const lane = (i: number) =>
    EVENTS.some((e, j) => j < i && clash.has(j) && e.day === EVENTS[i]?.day) ? 1 : 0;
  return h(
    "div",
    { class: "cal" },
    h(
      "div",
      { class: "cal-head" },
      h("span"),
      days.map((d) => h("span", { class: "cal-day" }, d)),
    ),
    h(
      "div",
      { class: "cal-grid" },
      h(
        "div",
        { class: "cal-hours", "aria-hidden": "true" },
        Array.from({ length: span }, (_, i) => h("span", { class: "cal-hour" }, String(FIRST + i))),
      ),
      days.map((d, day) =>
        h(
          "div",
          { class: "cal-col", role: "list", "aria-label": d },
          EVENTS.map((e, i) => ({ e, i }))
            .filter(({ e }) => e.day === day)
            .map(({ e, i }) =>
              h(
                "div",
                {
                  class: `cal-event${clash.has(i) ? ` is-overlap is-lane-${lane(i)}` : ""}`,
                  role: "listitem",
                  style: {
                    top: `${((e.start - FIRST) / span) * 100}%`,
                    height: `${((e.end - e.start) / span) * 100}%`,
                  },
                },
                h("span", { class: "cal-title" }, e.title),
                clash.has(i) ? h("span", { class: "cal-flag" }, ctx.tr("overlap")) : null,
              ),
            ),
        ),
      ),
    ),
  );
}
