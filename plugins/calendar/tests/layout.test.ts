// What the views show: the month grid, overlapping events side by side in a day, the agenda, moving
// by month, the editor's repeat presets, and words for dates.
import { describe, expect, it } from "vitest";
import {
  agenda,
  dayBlocks,
  localeWeekStart,
  monthGrid,
  span,
  step,
} from "../ui/calendar/layout.js";
import { occurrences } from "../ui/calendar/model.js";
import { presetOf, repeatPresets } from "../ui/choices.js";
import { eventText, heading, whenText } from "../ui/format.js";
import { at, ics, model } from "./fixtures";

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const ev = (uid: string, start: string, end: string, title = uid) => [
  `UID:${uid}`,
  `DTSTART;TZID=Asia/Seoul:${start}`,
  `DTEND;TZID=Asia/Seoul:${end}`,
  `SUMMARY:${title}`,
];

const TEXT = ics(
  ev("a", "20261030T090000", "20261030T100000"),
  ev("b", "20261030T093000", "20261030T110000"),
  ev("c", "20261030T094500", "20261030T101500"),
  ev("d", "20261030T120000", "20261030T130000"),
  ev("late", "20261030T230000", "20261031T010000"),
  ["UID:trip", "DTSTART;VALUE=DATE:20261029", "DTEND;VALUE=DATE:20261101", "SUMMARY:Trip"],
);
const list = occurrences(
  model(TEXT),
  at("2026-10-01T00:00:00+09:00"),
  at("2026-12-01T00:00:00+09:00"),
);

describe("layout", () => {
  it("packs overlapping events into columns, one cluster at a time", () => {
    const blocks = dayBlocks(list, day("2026-10-30"));
    expect(blocks.map((b) => [b.occ.title, b.top, b.height, b.col, b.cols])).toEqual(
      [
        ["b", 570, 90, 1, 3],
        ["a", 540, 60, 0, 3],
        ["c", 585, 30, 2, 3],
        ["d", 720, 60, 0, 1],
        ["late", 1380, 60, 0, 1],
      ].sort((x, y) => Number(x[1]) - Number(y[1])),
    );
    expect(blocks.find((b) => b.occ.title === "late")).toMatchObject({
      continues: true,
      continued: false,
    });
    expect(dayBlocks(list, day("2026-10-31"))).toEqual([
      expect.objectContaining({ top: 0, height: 60, continued: true, continues: false }),
    ]);
  });

  it("the month grid holds six weeks; a multi-day event is on each of its days, first", () => {
    const weeks = monthGrid(list, day("2026-10-15"), 1, day("2026-10-30"));
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]?.day).toBe(day("2026-09-28"));
    const friday = weeks.flat().find((d) => d.day === day("2026-10-30"));
    expect(friday).toMatchObject({ inMonth: true, today: true });
    expect(friday?.events.map((o) => o.title)).toEqual(["Trip", "a", "b", "c", "d", "late"]);
    expect(
      weeks
        .flat()
        .filter((d) => d.events.some((o) => o.title === "Trip"))
        .map((d) => d.day),
    ).toEqual([day("2026-10-29"), day("2026-10-30"), day("2026-10-31")]);
  });

  it("the agenda lists only days with events", () => {
    expect(
      agenda(list, day("2026-10-28"), day("2026-11-03")).map((d) => [d.day, d.events.length]),
    ).toEqual([
      [day("2026-10-29"), 1],
      [day("2026-10-30"), 6],
      [day("2026-10-31"), 2],
    ]);
  });

  it("spans and steps: months keep their day, shortened at the month's end", () => {
    expect(span("week", day("2026-10-30"), 0)).toEqual({
      from: day("2026-10-25"),
      to: day("2026-11-01"),
    });
    expect(span("day", day("2026-10-30"), 0)).toEqual({
      from: day("2026-10-30"),
      to: day("2026-10-31"),
    });
    expect(step("month", day("2026-01-31"), 1)).toBe(day("2026-02-28"));
    expect(step("month", day("2026-01-31"), -1)).toBe(day("2025-12-31"));
    expect(step("week", day("2026-10-30"), -1)).toBe(day("2026-10-23"));
    expect(step("agenda", day("2026-10-30"), 1)).toBe(day("2026-11-29"));
    expect(localeWeekStart("en-US")).toBe(0);
    expect(localeWeekStart("de-DE")).toBe(1);
  });
});

describe("repeat presets", () => {
  const start = Date.parse("2026-10-30T09:00:00Z");
  it("are made from the start date: the last Friday, day 30, October 30", () => {
    expect(repeatPresets(start).map((p) => [p.id, p.label, p.rrule])).toEqual([
      ["none", "Does not repeat", null],
      ["daily", "Every day", "FREQ=DAILY"],
      ["weekdays", "Every weekday (Monday to Friday)", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
      ["weekly", "Every week on Friday", "FREQ=WEEKLY;BYDAY=FR"],
      ["monthly-day", "Every month on day 30", "FREQ=MONTHLY;BYMONTHDAY=30"],
      ["monthly-weekday", "Every month on the last Friday", "FREQ=MONTHLY;BYDAY=-1FR"],
      ["yearly", "Every year on October 30", "FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=30"],
    ]);
  });

  it("recognise their rules and bare ones; anything else is custom", () => {
    expect(presetOf(null, start)).toBe("none");
    expect(presetOf("FREQ=WEEKLY;BYDAY=FR", start)).toBe("weekly");
    expect(presetOf("FREQ=WEEKLY", start)).toBe("weekly");
    expect(presetOf("FREQ=WEEKLY;BYDAY=MO", start)).toBe("custom");
    expect(presetOf("FREQ=DAILY;COUNT=5", start)).toBe("custom");
  });
});

describe("words", () => {
  const [a, , , , late] = list.filter((o) => !o.allDay);
  const trip = list.find((o) => o.allDay);
  it("headings, times and full names in the locale", () => {
    const s = (text: string) => text.replace(/\s/g, " ");
    expect(heading("en-US", "month", span("month", day("2026-10-30"), 0), day("2026-10-30"))).toBe(
      "October 2026",
    );
    expect(
      s(heading("ko-KR", "month", span("month", day("2026-10-30"), 0), day("2026-10-30"))),
    ).toBe("2026년 10월");
    expect(a && s(whenText("en-US", a))).toBe("9:00 AM – 10:00 AM");
    expect(late && s(whenText("en-GB", late))).toBe("30 Oct, 23:00 – 31 Oct, 01:00");
    expect(trip && whenText("en-US", trip)).toBe("Oct 29 – Oct 31");
    expect(a && s(eventText("en-US", a))).toBe("a, 9:00 AM – 10:00 AM");
  });
});
