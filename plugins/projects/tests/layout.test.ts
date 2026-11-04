// The views without a DOM: filtering, grouping and sorting, the board's columns across sources, the
// swimlanes, the timeline's bars and the calendar's weeks.
import { describe, expect, it } from "vitest";
import type { Work } from "../ui/adapters/common.js";
import { workOf } from "../ui/adapters/index.js";
import { columnsOf, laneChange, lanesOf, statusFor } from "../ui/layout/board.js";
import { calendarOf } from "../ui/layout/calendar.js";
import { addMonths, dateOfDay, dayOf, shortDate, weekStartOf } from "../ui/layout/dates.js";
import { step, timelineOf } from "../ui/layout/timeline.js";
import { filtered, grouped, sorted, statusesOf } from "../ui/model.js";
import { JIRA, LINEAR, sample } from "./fixtures";

const works = (): Work[] => sample().map(workOf);
const refs = (list: Work[]) => list.map((w) => w.ref || w.title);
const TODAY = dayOf("2026-10-30");
/** The value, or a failed test when there is none. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

describe("the model", () => {
  it("filters by source, finished work and every word of a search", () => {
    const all = works();
    const base = { text: "", source: null, showDone: true };
    expect(filtered(all, base)).toHaveLength(6);
    expect(refs(filtered(all, { ...base, showDone: false }))).not.toContain("PAY-9");
    expect(refs(filtered(all, { ...base, source: `${LINEAR}/default` }))).toEqual([
      "ENG-42",
      "ENG-44",
    ]);
    expect(refs(filtered(all, { ...base, text: "ada payments" }))).toEqual(["PAY-12"]);
    expect(refs(filtered(all, { ...base, text: "onboarding" }))).toEqual(["ENG-42"]);
  });

  it("groups by a field in its order, the empty group last", () => {
    const byPriority = grouped(works(), "priority").map((g) => `${g.title}:${g.works.length}`);
    expect(byPriority).toEqual(["Urgent:1", "High:1", "Medium:1", "Low:2", "No priority:1"]);
    const byAssignee = grouped(works(), "assignee").map((g) => g.title);
    expect(byAssignee.at(-1)).toBe("Unassigned");
    expect(grouped(works(), "none")).toHaveLength(1);
  });

  it("sorts by a field either way with missing values last, else most urgent and soonest first", () => {
    expect(refs(sorted(works(), { field: "due", dir: "asc" }))).toEqual([
      "PAY-9",
      "Water the plants",
      "PAY-12",
      "Book the venue",
      "ENG-42",
      "ENG-44",
    ]);
    expect(refs(sorted(works(), { field: "due", dir: "desc" })).at(-1)).toBe("ENG-44");
    expect(refs(sorted(works(), null)).slice(0, 2)).toEqual(["PAY-12", "ENG-42"]);
  });

  it("lists the statuses one connector's work has, in board order", () => {
    expect(statusesOf(works(), JIRA)).toEqual(["In Progress", "Done"]);
    expect(statusesOf(works(), LINEAR)).toEqual(["Backlog", "Todo"]);
  });
});

describe("the board", () => {
  it("has a column per status in category order, the same name from two sources one column", () => {
    const list = works();
    const todoIssue = workOf({
      ...must(sample()[0]),
      id: "10003",
      raw: {
        key: "PAY-13",
        fields: { summary: "Retry", status: { name: "To Do", statusCategory: { key: "new" } } },
      },
    });
    const columns = columnsOf([...list, todoIssue]);
    expect(columns.map((c) => `${c.title}:${c.works.length}`)).toEqual([
      "Backlog:1",
      "Todo:3",
      "In Progress:2",
      "Done:1",
    ]);
    expect(columns.map((c) => c.category)).toEqual(["backlog", "todo", "doing", "done"]);
    const todo = must(columns[1]);
    expect(refs(todo.works)).toEqual(["ENG-42", "Water the plants", "PAY-13"]);
    expect(todo.names).toEqual({ [LINEAR]: "Todo", "acme.todo": "To do", [JIRA]: "To Do" });
    // A card dropped on a column moves to its own source's name for it, else the column's.
    expect(statusFor(todo, must(list[0]))).toBe("To Do");
    expect(statusFor(must(columns[2]), must(list[4]))).toBe("In progress");
    expect(statusFor(must(columns[0]), must(list[0]))).toBe("Backlog");
  });

  it("cuts the columns into lanes, and knows what moving between lanes changes", () => {
    const { columns, lanes } = lanesOf(works(), "assignee");
    // Mina Park and mina@acme.test are one person: one lane, by email.
    expect(lanes.map((l) => `${l.title}:${l.count}`)).toEqual([
      "Ada Lovelace:1",
      "Jun Choi:1",
      "Mina Park:2",
      "Unassigned:2",
    ]);
    for (const lane of lanes) expect(lane.cells).toHaveLength(columns.length);
    expect(lanes.reduce((n, l) => n + l.count, 0)).toBe(6);
    const mina = must(lanes.find((l) => l.title === "Mina Park"));
    expect(laneChange("assignee", mina.key, mina.cells.flat())).toEqual({
      assignee: { name: "Mina Park", email: "mina@acme.test" },
    });
    expect(laneChange("assignee", "", [])).toEqual({ assignee: null });
    expect(laneChange("priority", "2", [])).toEqual({ priority: 2 });
    expect(laneChange("priority", "", [])).toEqual({ priority: null });
    expect(laneChange("project", "payments", [])).toBeUndefined();
  });
});

describe("the timeline", () => {
  it("places bars from start to due, cuts what runs past the span and counts the rest", () => {
    const t = timelineOf(works(), {
      anchor: TODAY,
      zoom: "week",
      group: "project",
      weekStart: 1,
      today: TODAY,
    });
    expect(dateOfDay(t.from)).toBe("2026-10-26");
    expect(t.days).toBe(14);
    expect(t.todayAt).toBe(4);
    expect(t.rows.map((r) => r.title)).toEqual(["Home", "Offsite", "Payments", "Q4 Launch"]);
    const bars = Object.fromEntries(
      t.rows.flatMap((r) => r.bars).map((b) => [b.work.ref || b.work.title, b]),
    );
    expect(bars["PAY-12"]).toMatchObject({
      left: 0,
      span: 9,
      milestone: false,
      cutStart: false,
      late: false,
    });
    expect(bars["Book the venue"]).toMatchObject({ left: 7, span: 4 });
    expect(bars["ENG-42"]).toMatchObject({ left: 11, span: 1, milestone: true });
    expect(bars["PAY-9"]).toMatchObject({ left: 1, milestone: true, late: false });
    expect(t.unscheduled).toBe(1);
    expect(t.scale[0]).toMatchObject({ date: "2026-10-26", month: "Oct", label: "26" });
    expect(t.scale.find((s) => s.date === "2026-11-01")).toMatchObject({
      month: "Nov",
      weekend: true,
    });
  });

  it("marks open work past its due date late and cuts bars at the span's edges", () => {
    const t = timelineOf(works(), {
      anchor: dayOf("2026-11-04"),
      zoom: "week",
      group: "none",
      weekStart: 1,
      today: dayOf("2026-11-04"),
    });
    const pay = must(must(t.rows[0]).bars.find((b) => b.work.ref === "PAY-12"));
    expect(dateOfDay(t.from)).toBe("2026-11-02");
    expect(pay).toMatchObject({ left: 0, span: 2, cutStart: true, late: true });
    expect(t.outside).toBe(2);
  });

  it("steps a week, a month or a quarter at a time", () => {
    expect(dateOfDay(step(TODAY, "week", 1))).toBe("2026-11-06");
    expect(dateOfDay(step(TODAY, "month", -1))).toBe("2026-09-30");
    expect(dateOfDay(step(dayOf("2026-11-30"), "quarter", 1))).toBe("2027-02-28");
    expect(dateOfDay(addMonths(dayOf("2026-01-31"), 1))).toBe("2026-02-28");
  });
});

describe("the calendar", () => {
  it("lays the month out in weeks and puts work on its due date, else its start", () => {
    const m = calendarOf(works(), { anchor: TODAY, weekStart: 1, today: TODAY });
    expect(m.title).toBe("October 2026");
    expect(m.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(m.weeks).toHaveLength(5);
    expect(must(must(m.weeks[0])[0]).date).toBe("2026-09-28");
    expect(must(must(m.weeks.at(-1)).at(-1)).date).toBe("2026-11-01");
    const on = (date: string) => must(m.weeks.flat().find((c) => c.date === date));
    expect(on("2026-10-30")).toMatchObject({ today: true, inMonth: true });
    expect(refs(on("2026-10-30").works)).toEqual(["Water the plants"]);
    expect(refs(on("2026-10-27").works)).toEqual(["PAY-9"]);
    expect(on("2026-10-27").late.size).toBe(0);
    expect(m.unscheduled).toBe(1);
    const sunday = calendarOf(works(), { anchor: dayOf("2026-11-15"), weekStart: 0, today: TODAY });
    expect(must(must(sunday.weeks[0])[0]).date).toBe("2026-11-01");
    expect(refs(must(sunday.weeks.flat().find((c) => c.date === "2026-11-03")).works)).toEqual([
      "PAY-12",
    ]);
  });

  it("says dates short, with the year only when it is not this one's", () => {
    expect(shortDate("2026-11-03", "2026-10-30")).toBe("Nov 3");
    expect(shortDate("2027-01-04", "2026-10-30")).toBe("Jan 4, 2027");
    expect(shortDate(undefined, "2026-10-30")).toBe("");
    expect(dateOfDay(weekStartOf(TODAY, 0))).toBe("2026-10-25");
  });
});
