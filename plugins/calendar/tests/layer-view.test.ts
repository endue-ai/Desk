// The system calendar's layer on the plugin's own index.html, in the small DOM: its events in their
// calendar's colour and named read-only in every view, a toggle per calendar, and the layer drawn
// when no file is open.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EventItem } from "../../../packages/bridge/src/index";
import { span } from "../ui/calendar/layout.js";
import { occurrences } from "../ui/calendar/model.js";
import type { CalendarState } from "../ui/calendar.js";
import { layerOccurrence } from "../ui/layer.js";
import { createView } from "../ui/view.js";
import { documentOf, type El, key } from "./dom";
import { at, ics, model, SEOUL } from "./fixtures";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const DAY = 86_400_000;
const TODAY = Math.floor(Date.parse("2026-10-30T00:00:00Z") / DAY);
const WORK_KEY = "desk.calendar/default/cal-work";
const HOME_KEY = "desk.calendar/default/cal-home";

const item = (id: string, title: string, start: string, end: string, extra: Partial<EventItem>) =>
  ({
    id,
    source: { connector: "desk.calendar", instance: "default" },
    kind: "event",
    title,
    updatedAt: "2026-10-29T00:00:00Z",
    start,
    end,
    ...extra,
  }) as EventItem;

const LAYER = [
  item("sync", "Team sync", "2026-10-30T11:00:00+09:00", "2026-10-30T12:00:00+09:00", {
    calendar: "Work",
    raw: { calendarId: "cal-work", color: "#ff3b30" },
  }),
  item("trip", "Trip", "2026-10-30T00:00:00+09:00", "2026-10-31T00:00:00+09:00", {
    allDay: true,
    calendar: "Home",
    raw: { calendarId: "cal-home", color: "#34c759" },
  }),
].map((i) => layerOccurrence(i, SEOUL));

const FILE = occurrences(
  model(
    ics([
      "UID:a",
      "DTSTART;TZID=Asia/Seoul:20261030T090000",
      "DTEND;TZID=Asia/Seoul:20261030T100000",
      "SUMMARY:Review",
    ]),
  ),
  at("2026-09-01T00:00:00Z"),
  at("2026-12-31T00:00:00Z"),
);

const SOURCES = [
  { key: HOME_KEY, name: "Home", color: "#34c759", hidden: false },
  { key: WORK_KEY, name: "Work", color: "#ff3b30", hidden: true },
];

const state = (mode: CalendarState["mode"], extra: Partial<CalendarState> = {}): CalendarState => ({
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
  span: span(mode, TODAY, 0),
  title: "October 2026",
  occurrences: [...FILE, ...LAYER].sort((a, b) => a.start - b.start),
  now: TODAY * DAY + 10.5 * 3_600_000,
  dayStart: 8,
  locale: "en-US",
  layer: SOURCES,
  ...extra,
});

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
    layer: vi.fn(),
  };
  const view = createView(doc as never, actions);
  const grid = doc.getElementById("grid") as El;
  return { doc, view, actions, grid };
}

describe("the layer in the view", () => {
  it("draws the layer's events in their calendar's colour, named read-only", () => {
    const { view, grid, actions } = setup();
    for (const mode of ["month", "week", "day", "agenda"] as const) {
      view.render(state(mode));
      const sync = grid.querySelector(`button[data-layer="${WORK_KEY}"]`);
      expect(sync?.getAttribute("style"), mode).toBe("--source: #ff3b30");
      expect(sync?.getAttribute("aria-label"), mode).toMatch(/^Team sync, .*, Work, read-only$/);
      const trip = grid.querySelector(`button[data-layer="${HOME_KEY}"]`);
      expect(trip?.getAttribute("aria-label"), mode).toBe("Trip, All day, Home, read-only");
      // The file's own events are not the layer's.
      const review = grid.querySelector('button[data-id="a"]');
      expect(review?.getAttribute("data-layer"), mode).toBeNull();
      expect(review?.getAttribute("style"), mode).toBeNull();
    }
    grid.querySelector(`button[data-layer="${WORK_KEY}"]`)?.click();
    expect(actions.edit).toHaveBeenCalledWith(LAYER[0]?.id);
  });

  it("lists the layer's calendars as toggles that hide and show them", () => {
    const { doc, view, actions } = setup();
    view.render(state("month"));
    const layers = doc.getElementById("cal-layers") as El;
    expect(layers.hidden).toBe(false);
    const buttons = layers.querySelectorAll("button");
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Home", "true"],
      ["Work", "false"],
    ]);
    expect(buttons[0]?.getAttribute("style")).toBe("--source: #34c759");
    buttons[1]?.focus();
    buttons[1]?.click();
    expect(actions.layer).toHaveBeenCalledWith(WORK_KEY);
    // Drawn again with Work shown, the toggle keeps the focus.
    const shown = SOURCES.map((s) => ({ ...s, hidden: false }));
    view.render(state("month", { layer: shown }));
    const work = layers.querySelectorAll("button")[1];
    expect(work?.getAttribute("aria-pressed")).toBe("true");
    expect(doc.activeElement).toBe(work);
    view.render(state("month", { layer: [] }));
    expect(layers.hidden).toBe(true);
    expect(layers.querySelectorAll("button")).toHaveLength(0);
  });

  it("with no file open, draws the layer instead of saying no calendar is open", () => {
    const { doc, view, grid, actions } = setup();
    view.render(state("month", { calendar: null, occurrences: LAYER }));
    expect(doc.getElementById("cal-title")?.textContent).toBe("October 2026");
    expect(doc.getElementById("cal-name")?.textContent).toBe("System calendar · read-only");
    expect(grid.querySelectorAll("button[data-layer]").length).toBeGreaterThan(0);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
    for (const id of ["prev", "next", "today", "new"])
      expect((doc.getElementById(id) as El).disabled, id).toBe(false);
    doc.body.dispatchEvent(key("t"));
    doc.body.dispatchEvent(key("c"));
    expect(actions.today).toHaveBeenCalledTimes(1);
    expect(actions.compose).toHaveBeenCalledTimes(1);
  });
});
