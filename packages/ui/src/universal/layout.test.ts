import type { UniversalData } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  calendarOf,
  dayOf,
  dayStart,
  kanbanOf,
  rowsOf,
  timelineOf,
  type UniversalEnv,
} from "./index";

const SEOUL = "Asia/Seoul";
const env: UniversalEnv = {
  zone: SEOUL,
  locale: "en-US",
  now: Date.parse("2026-11-04T10:00:00+09:00"),
};
const plan: UniversalData = {
  entries: [
    {
      id: "review",
      title: "Review",
      start: "2026-11-04T16:00:00+09:00",
      end: "2026-11-04T17:00:00+09:00",
    },
    {
      id: "standup",
      title: "Standup",
      start: "2026-11-04T09:00:00+09:00",
      end: "2026-11-04T09:15:00+09:00",
    },
    { id: "trip", title: "Trip", start: "2026-11-03", end: "2026-11-05" },
    { id: "ship", title: "Ship", start: "2026-11-06T00:30:00+09:00" },
    { id: "idea", title: "Someday" },
    { id: "old", title: "Kickoff", start: "2026-10-30T10:00:00+09:00" },
  ],
};
const rows = rowsOf(plan, { zone: SEOUL });

describe("days in a zone", () => {
  it("cross month and DST edges in UTC arithmetic, and meet instants through the offset", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(dayOf(Date.parse("2026-11-03T16:00:00Z"), SEOUL)).toBe("2026-11-04");
    expect(dayOf(Date.parse("2026-11-03T16:00:00Z"), "UTC")).toBe("2026-11-03");
    expect(dayStart("2026-11-04", SEOUL)).toBe(Date.parse("2026-11-04T00:00:00+09:00"));
    // New York leaves daylight time on 2026-11-01: that midnight is still -04:00.
    expect(dayStart("2026-11-01", "America/New_York")).toBe(
      Date.parse("2026-11-01T00:00:00-04:00"),
    );
    expect(dayStart("2026-11-02", "America/New_York")).toBe(
      Date.parse("2026-11-02T00:00:00-05:00"),
    );
  });
});

describe("timelineOf", () => {
  it("groups dated rows by day in time order, whole days first, undated ones after", () => {
    const model = timelineOf(rows, env);
    expect(model.days.map((day) => day.day)).toEqual([
      "2026-10-30",
      "2026-11-03",
      "2026-11-04",
      "2026-11-06",
    ]);
    const today = model.days[2];
    expect(today?.today).toBe(true);
    expect(today?.label).toBe("Wed, Nov 4");
    expect(today?.rows.map((r) => [r.row.id, r.time, r.until])).toEqual([
      ["standup", "09:00", "09:15"],
      ["review", "16:00", "17:00"],
    ]);
    expect(model.days[1]?.rows[0]?.time).toBe("All day");
    expect(model.undated.map((row) => row.id)).toEqual(["idea"]);
  });

  it("puts the now-line before the first row still ahead and marks past and current rows", () => {
    const model = timelineOf(rows, env);
    expect(model.now).toEqual({ day: 2, index: 1 });
    expect(model.days[2]?.rows[0]?.past).toBe(true);
    expect(model.days[1]?.rows[0]?.current).toBe(true);
    expect(model.days[3]?.rows[0]?.past).toBe(false);
    const latest = timelineOf(rows, env, "desc");
    expect(latest.days.map((day) => day.day)[0]).toBe("2026-11-06");
    expect(latest.now).toEqual({ day: 1, index: 1 });
  });

  it("draws no now-line when today is outside the rows' days", () => {
    const later = { ...env, now: Date.parse("2027-01-01T00:00:00Z") };
    expect(timelineOf(rows, later).now).toBeNull();
    expect(timelineOf([], env)).toEqual({ days: [], undated: [], now: null });
  });
});

describe("calendarOf", () => {
  it("lays a month out in whole weeks from Monday, entries on every day they cover", () => {
    const model = calendarOf(rows, env);
    expect(model.title).toBe("November 2026");
    expect(model.columns).toBe(7);
    expect(model.weekdays[0]).toBe("Mon");
    expect(model.cells[0]?.day).toBe("2026-10-26");
    expect(model.cells[model.cells.length - 1]?.day).toBe("2026-12-06");
    expect(model.cells.length % 7).toBe(0);
    const cell = (day: string) => model.cells.find((c) => c.day === day);
    expect(cell("2026-10-30")?.inPeriod).toBe(false);
    expect(cell("2026-10-30")?.entries.map((e) => e.row.id)).toEqual(["old"]);
    expect(cell("2026-11-04")?.today).toBe(true);
    expect(cell("2026-11-04")?.entries.map((e) => [e.row.id, e.time, e.continues])).toEqual([
      ["trip", "", true],
      ["standup", "09:00", false],
      ["review", "16:00", false],
    ]);
    expect(cell("2026-11-05")?.entries.map((e) => e.row.id)).toEqual(["trip"]);
    expect(cell("2026-11-06")?.entries.map((e) => e.row.id)).toEqual(["ship"]);
    expect(cell("2026-11-07")?.weekend).toBe(true);
    expect([model.prev, model.next, model.today]).toEqual([
      "2026-10-01",
      "2026-12-01",
      "2026-11-04",
    ]);
    expect(model.undated).toBe(1);
  });

  it("shows a week or one day around its anchor", () => {
    const week = calendarOf(rows, env, { range: "week", anchor: "2026-11-06" });
    expect(week.cells.map((c) => c.day)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(week.title).toBe("Mon, Nov 2 – Sun, Nov 8");
    expect([week.prev, week.next]).toEqual(["2026-10-26", "2026-11-09"]);
    const day = calendarOf(rows, env, { range: "day", anchor: "2026-11-05" });
    expect(day.columns).toBe(1);
    expect(day.weekdays).toEqual(["Thu"]);
    expect(day.cells.map((c) => c.entries.map((e) => e.row.id))).toEqual([["trip"]]);
  });
});

describe("kanbanOf", () => {
  const board = rowsOf({
    entries: [
      { id: "a", group: "doing" },
      { id: "b", group: "review" },
      { id: "c" },
      { id: "d", group: "todo" },
      { id: "e", group: "review" },
    ],
  });

  it("draws the named columns first, even empty, then the others as they appear, ungrouped last", () => {
    const columns = kanbanOf(board, ["todo", "doing", "done"]);
    expect(columns.map((c) => [c.title, c.rows.map((r) => r.id)])).toEqual([
      ["todo", ["d"]],
      ["doing", ["a"]],
      ["done", []],
      ["review", ["b", "e"]],
      ["No group", ["c"]],
    ]);
    expect(kanbanOf(board).map((c) => c.group)).toEqual(["doing", "review", "todo", ""]);
  });
});
