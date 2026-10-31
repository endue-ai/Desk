// The view and the editor on the plugin's own index.html, in a small DOM: what each view draws, that
// file text only ever reaches it as text, the keys, and the editor's fields and checks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { span } from "../ui/calendar/layout.js";
import { occurrences } from "../ui/calendar/model.js";
import type { CalendarState, EditorState } from "../ui/calendar.js";
import { createEditor } from "../ui/editor.js";
import { createView } from "../ui/view.js";
import { documentOf, type El, FakeEvent, key } from "./dom";
import { at, ics, model } from "./fixtures";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const TODAY = day("2026-10-30");

const TEXT = ics(
  [
    "UID:a",
    "DTSTART;TZID=Asia/Seoul:20261030T090000",
    "DTEND;TZID=Asia/Seoul:20261030T100000",
    "SUMMARY:<img src=x onerror=alert(1)>",
    "LOCATION:Room 4",
  ],
  [
    "UID:b",
    "DTSTART;TZID=Asia/Seoul:20261030T093000",
    "DTEND;TZID=Asia/Seoul:20261030T110000",
    "SUMMARY:Overlap",
    "STATUS:TENTATIVE",
  ],
  ["UID:c", "DTSTART;VALUE=DATE:20261029", "DTEND;VALUE=DATE:20261031", "SUMMARY:Trip"],
  ...["d", "e", "f", "g", "h"].map((uid, i) => [
    `UID:${uid}`,
    `DTSTART;TZID=Asia/Seoul:2026103${1}T1${i}0000`,
    `SUMMARY:Busy ${uid}`,
  ]),
);

const state = (mode: CalendarState["mode"], extra: Partial<CalendarState> = {}): CalendarState => {
  const range = span(mode, TODAY, 0);
  const list = occurrences(
    model(TEXT),
    at("2026-09-01T00:00:00Z"),
    at("2026-12-31T00:00:00Z"),
  ).filter((o) => o.endWall > range.from * 86_400_000 && o.startWall < range.to * 86_400_000);
  return {
    calendar: {
      name: "Team",
      path: "~/Calendar/team.ics",
      modified: false,
      readOnly: false,
      problems: [],
    },
    mode,
    anchor: TODAY,
    today: TODAY,
    weekStart: 0,
    span: range,
    title: "October 2026",
    occurrences: list,
    now: TODAY * 86_400_000 + 10.5 * 3_600_000,
    dayStart: 8,
    locale: "en-US",
    ...extra,
  };
};

function setup() {
  const doc = documentOf(html);
  const actions = {
    previous: vi.fn(),
    next: vi.fn(),
    today: vi.fn(),
    show: vi.fn(),
    goto: vi.fn(),
    compose: vi.fn(),
    edit: vi.fn(),
    ask: vi.fn(),
  };
  const view = createView(doc as never, actions);
  const grid = doc.getElementById("grid") as El;
  return { doc, view, actions, grid };
}

describe("the view", () => {
  it("draws the month as a grid of six weeks, with file text only as text", () => {
    const { doc, view, grid } = setup();
    view.render(state("month"));
    expect(doc.getElementById("cal-title")?.textContent).toBe("October 2026");
    expect(doc.getElementById("cal-name")?.textContent).toBe("Team · ~/Calendar/team.ics");
    expect(grid.querySelector("table")?.getAttribute("role")).toBe("grid");
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
    const today = grid.querySelector(`[data-day="${TODAY}"]`);
    expect(today?.getAttribute("aria-current")).toBe("date");
    expect(today?.getAttribute("tabindex")).toBe("0");
    expect(today?.getAttribute("aria-label")).toBe("Friday, October 30, 3 events");
    const titles = today?.querySelectorAll("button.event").map((b) => b.textContent);
    expect(titles).toEqual(["Trip", "9:00 AM<img src=x onerror=alert(1)>", "9:30 AMOverlap"]);
    // The title is a text node, never markup.
    expect(grid.querySelector("img")).toBeNull();
    // Five events: three, then "+2 more" (four would all show: "+1 more" hides nothing).
    const saturday = grid.querySelector(`[data-day="${TODAY + 1}"]`);
    expect(saturday?.querySelectorAll("button.event")).toHaveLength(3);
    expect(saturday?.querySelector("button.more")?.textContent).toBe("+2 more");
    const modes = doc
      .querySelectorAll("button[data-mode]")
      .map((b) => [b.getAttribute("data-mode"), b.getAttribute("aria-checked")]);
    expect(modes).toEqual([
      ["month", "true"],
      ["week", "false"],
      ["day", "false"],
      ["agenda", "false"],
    ]);
  });

  it("moves between days with the arrow keys and adds an event with Enter", () => {
    const { view, grid, actions } = setup();
    view.render(state("month"));
    const today = grid.querySelector(`[data-day="${TODAY}"]`) as El;
    today.dispatchEvent(key("ArrowRight"));
    const next = grid.querySelector(`[data-day="${TODAY + 1}"]`);
    expect(next?.getAttribute("tabindex")).toBe("0");
    expect(today.getAttribute("tabindex")).toBe("-1");
    next?.dispatchEvent(key("Enter"));
    expect(actions.compose).toHaveBeenCalledWith({ day: TODAY + 1 });
    // Past the grid's last week, the view moves on.
    const last = grid.querySelector(`[data-day="${TODAY + 8}"]`) as El;
    last.dispatchEvent(key("ArrowDown"));
    expect(actions.goto).toHaveBeenCalledWith(TODAY + 15);
  });

  it("draws a week of columns: all-day row, overlapping blocks side by side, the time now", () => {
    const { view, grid, actions } = setup();
    view.render(state("week"));
    const columns = grid.querySelectorAll('[role="group"]');
    expect(columns).toHaveLength(14); // seven all-day cells and seven day columns
    const blocks = grid.querySelectorAll("button.block");
    const [first, second] = blocks;
    expect([
      first?.style.left,
      first?.style.width,
      second?.style.left,
      second?.style.width,
    ]).toEqual(["0%", "50%", "50%", "50%"]);
    expect(first?.style.top).toBe(`${(540 / 1440) * 100}%`);
    expect(grid.querySelectorAll("button.banner").map((b) => b.textContent)).toEqual([
      "Trip",
      "Trip",
    ]);
    expect(grid.querySelector(".now")?.style.top).toBe(`${(10.5 / 24) * 100}%`);
    first?.click();
    expect(actions.edit).toHaveBeenCalledWith("a");
  });

  it("draws the agenda by day, and says when there is nothing", () => {
    const { view, grid } = setup();
    view.render(state("agenda"));
    expect(grid.querySelectorAll("h2").map((h) => h.textContent)).toEqual([
      "Friday, October 30",
      "Saturday, October 31",
    ]);
    const row = grid.querySelector("button.row");
    expect(row?.textContent).toBe("Oct 29 – Oct 30Trip");
    view.render(state("agenda", { occurrences: [] }));
    expect(grid.textContent).toBe("Nothing on the calendar for the next 30 days.");
  });

  it("plain keys move and switch views; not in a field, and never chords", () => {
    const { doc, view, actions } = setup();
    view.render(state("month"));
    const body = doc.body;
    for (const k of ["t", "j", "k", "w", "c", "g"]) body.dispatchEvent(key(k));
    expect(actions.today).toHaveBeenCalledTimes(1);
    expect(actions.next).toHaveBeenCalledTimes(1);
    expect(actions.previous).toHaveBeenCalledTimes(1);
    expect(actions.show).toHaveBeenCalledWith("week");
    expect(actions.compose).toHaveBeenCalledTimes(1);
    expect(actions.ask).toHaveBeenCalledTimes(1);
    body.dispatchEvent(key("t", { metaKey: true }));
    doc.getElementById("title")?.dispatchEvent(key("t"));
    expect(actions.today).toHaveBeenCalledTimes(1);
  });

  it("with no calendar, says so and turns the bar's buttons off", () => {
    const { doc, view, grid } = setup();
    view.render(state("month", { calendar: null }));
    expect(doc.getElementById("cal-title")?.textContent).toBe("No calendar open");
    expect(grid.textContent).toBe("No calendar open.");
    expect(doc.getElementById("new")?.disabled).toBe(true);
    view.render(
      state("month", {
        calendar: {
          name: "x",
          path: "x.ics",
          modified: true,
          readOnly: false,
          problems: ["a", "b"],
        },
      }),
    );
    expect(doc.getElementById("cal-mark")?.hidden).toBe(false);
    expect(doc.getElementById("cal-problems")?.textContent).toBe(
      "2 things in this file could not be read",
    );
  });
});

describe("the editor", () => {
  const H = 3_600_000;
  const start = Date.parse("2026-10-30T09:00:00Z");
  const editing = (extra: Partial<EditorState["fields"]> = {}, recurring = false): EditorState => ({
    kind: "edit",
    recurring,
    zone: "Asia/Seoul",
    fields: {
      title: "Review",
      allDay: false,
      start,
      end: start + H,
      zone: "Asia/Seoul",
      location: "",
      description: "",
      rrule: null,
      reminder: 10,
      free: false,
      ...extra,
    },
  });
  const open = (s: EditorState) => {
    const doc = documentOf(html);
    const actions = { save: vi.fn(), remove: vi.fn(), close: vi.fn() };
    const editor = createEditor(doc as never, actions);
    editor.open(s);
    const field = (name: string) => doc.querySelector(`[name="${name}"]`) as El;
    const submit = () => doc.querySelector('button[type="submit"]')?.click();
    return { doc, actions, editor, field, submit };
  };

  it("shows the fields and hands them back unchanged", () => {
    const { doc, field, submit, actions } = open(
      editing({ rrule: "FREQ=WEEKLY", reminder: 10 }, true),
    );
    expect(doc.getElementById("editor")?.open).toBe(true);
    expect(doc.getElementById("editor-title")?.textContent).toBe("Edit event");
    expect([field("startDate").value, field("startTime").value, field("endTime").value]).toEqual([
      "2026-10-30",
      "09:00",
      "10:00",
    ]);
    expect(field("repeat").value).toBe("weekly");
    expect(field("reminder").value).toBe("10");
    expect(doc.getElementById("editor-scope")?.hidden).toBe(false);
    submit();
    // The rule stays as written: FREQ=WEEKLY is not rewritten as FREQ=WEEKLY;BYDAY=FR.
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review",
        start,
        end: start + H,
        rrule: "FREQ=WEEKLY",
        reminder: 10,
      }),
      "one",
    );
  });

  it("an all-day event's end field shows its last day; the end it hands back is the day after", () => {
    const day0 = Date.parse("2026-10-29T00:00:00Z");
    const { field, submit, actions } = open(
      editing({ allDay: true, start: day0, end: day0 + 2 * 24 * H, zone: "", reminder: null }),
    );
    expect(field("endDate").value).toBe("2026-10-30");
    expect(field("startTime").hidden).toBe(true);
    submit();
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, start: day0, end: day0 + 2 * 24 * H, zone: "" }),
      "all",
    );
  });

  it("refuses an end before the start, an unknown zone and a rule that does not parse", () => {
    const { doc, field, submit, actions } = open(editing());
    field("endTime").value = "08:00";
    field("zone").value = "Mars/Base";
    field("repeat").value = "custom";
    field("rrule").value = "FREQ=OFTEN";
    submit();
    expect(actions.save).not.toHaveBeenCalled();
    expect(doc.getElementById("endDate-error")?.textContent).toBe(
      "The event ends before it starts.",
    );
    expect(doc.getElementById("zone-error")?.textContent).toBe("Mars/Base is not a time zone.");
    expect(doc.getElementById("rrule-error")?.textContent).toBe(
      "Not a repeat rule: FREQ=OFTEN is unknown.",
    );
    expect(field("zone").getAttribute("aria-invalid")).toBe("true");
  });

  it("a preset follows the new start date; Delete and Cancel go to their actions", () => {
    const { doc, field, submit, actions } = open(editing({ rrule: "FREQ=WEEKLY;BYDAY=FR" }, true));
    field("startDate").value = "2026-11-02";
    field("endDate").value = "2026-11-02";
    field("startDate").dispatchEvent(new FakeEvent("change"));
    expect(field("repeat").value).toBe("weekly");
    (doc.querySelector('input[name="scope"][value="all"]') as El).checked = true;
    (doc.querySelector('input[name="scope"][value="one"]') as El).checked = false;
    submit();
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ rrule: "FREQ=WEEKLY;BYDAY=MO" }),
      "all",
    );
    doc.getElementById("editor-delete")?.click();
    expect(actions.remove).toHaveBeenCalledWith("all");
    doc.getElementById("editor-cancel")?.click();
    expect(actions.close).toHaveBeenCalled();
  });
});
