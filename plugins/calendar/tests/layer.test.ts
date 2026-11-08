// The system calendar's layer on the SDK's test host: the OS calendar's events that the desk.calendar
// connector brings into the index, drawn beside a file's events with their calendar's name and colour,
// never edited, hidden by calendar, and shown with no file open instead of an empty file.
import { describe, expect, it } from "vitest";
import type { EventItem, Permission } from "../../../packages/bridge/src/index";
import type { EventFields } from "../ui/calendar/write.js";
import { ics } from "./fixtures";
import { disk, file, mount, WRITE } from "./harness";

const LAYER: Permission = { permission: "data:read", kinds: ["event"], sources: ["desk.calendar"] };
const SOURCE = { connector: "desk.calendar", instance: "default" };
const WORK = { calendar: "Work", raw: { calendarId: "cal-work", color: "#ff3b30" } };
const HOME = { calendar: "Home", raw: { calendarId: "cal-home", color: "#34c759" } };
const WORK_KEY = "desk.calendar/default/cal-work";
const HOME_KEY = "desk.calendar/default/cal-home";

const event = (
  id: string,
  title: string,
  start: string,
  end: string,
  extra: Partial<EventItem> = {},
): EventItem => ({
  id,
  source: SOURCE,
  kind: "event",
  title,
  updatedAt: "2026-10-29T00:00:00Z",
  start,
  end,
  ...extra,
});

const ITEMS = [
  event("sync", "Team sync", "2026-10-30T11:00:00+09:00", "2026-10-30T12:00:00+09:00", WORK),
  event("trip", "Trip", "2026-10-31T00:00:00+09:00", "2026-11-02T00:00:00+09:00", {
    allDay: true,
    ...HOME,
  }),
  event("dentist", "Dentist", "2026-11-03T15:00:00+09:00", "2026-11-03T16:00:00+09:00", HOME),
];

const A = file("~/Calendar/team.ics");
const TEAM = ics([
  "UID:review",
  "DTSTART;TZID=Asia/Seoul:20261030T100000",
  "DTEND;TZID=Asia/Seoul:20261030T110000",
  "SUMMARY:Design review",
]);
const DEFAULT = "~/Calendar/calendar.ics";
const OPEN = { "desk.files.open": () => `file:${DEFAULT}` };

type Drawn = { occurrences: Array<{ title: string }> };
const titles = (state: Drawn) => state.occurrences.map((o) => o.title);

describe("the system calendar's layer", () => {
  it("the system calendar's events appear from the index beside the file's, with their calendar's name and colour", async () => {
    const { host, view, params, app } = await mount({
      handlers: disk({ [A.path]: TEAM }),
      grants: [LAYER],
      items: ITEMS,
    });
    expect(params("data.query")).toEqual([
      { query: { kinds: ["event"], sources: ["desk.calendar"], limit: 500 }, scope: LAYER },
    ]);
    await host.command("desk.files.visit", A);
    // The stub's own desk.fixtures events stay out: the layer reads desk.calendar only.
    expect(titles(view.last)).toEqual(["Design review", "Team sync", "Trip", "Dentist"]);
    const sync = view.last.occurrences.find((o) => o.title === "Team sync");
    expect(sync).toMatchObject({
      readOnly: true,
      source: WORK_KEY,
      sourceName: "Work",
      color: "#ff3b30",
      allDay: false,
      startWall: Date.parse("2026-10-30T11:00:00Z"),
      endWall: Date.parse("2026-10-30T12:00:00Z"),
    });
    // An all-day event keeps its dates and begins at midnight in the display zone.
    expect(view.last.occurrences.find((o) => o.title === "Trip")).toMatchObject({
      allDay: true,
      startWall: Date.parse("2026-10-31T00:00:00Z"),
      endWall: Date.parse("2026-11-02T00:00:00Z"),
      start: Date.parse("2026-10-31T00:00:00+09:00"),
    });
    expect(view.last.layer).toEqual([
      { key: HOME_KEY, name: "Home", color: "#34c759", hidden: false },
      { key: WORK_KEY, name: "Work", color: "#ff3b30", hidden: false },
    ]);
    // Every view takes the layer's events in its span.
    app.show("week");
    expect(titles(view.last)).toEqual(["Design review", "Team sync", "Trip"]);
    app.show("day");
    expect(titles(view.last)).toEqual(["Design review", "Team sync"]);
    app.show("agenda");
    expect(titles(view.last)).toEqual(["Design review", "Team sync", "Trip", "Dentist"]);
  });

  it("changes in the index reach the layer", async () => {
    const { host, view, settle, params } = await mount({
      handlers: disk({ [A.path]: TEAM }),
      grants: [LAYER],
      items: ITEMS,
    });
    expect(params("data.subscribe")).toEqual([
      { query: { kinds: ["event"], sources: ["desk.calendar"] }, scope: LAYER },
    ]);
    await host.command("desk.files.visit", A);
    host.upsert(
      event("late", "Late call", "2026-10-30T20:00:00+09:00", "2026-10-30T21:00:00+09:00"),
    );
    await settle();
    expect(titles(view.last)).toContain("Late call");
    // Without a calendar name or colour it is the system calendar, in the theme's accent.
    expect(view.last.layer).toContainEqual({
      key: "desk.calendar/default/",
      name: "System calendar",
      hidden: false,
    });
    host.upsert({ ...(ITEMS[0] as EventItem), title: "Team sync (moved)" });
    host.remove(SOURCE, "dentist");
    await settle();
    expect(titles(view.last)).toEqual(["Design review", "Team sync (moved)", "Late call", "Trip"]);
  });

  it("the layer is read-only: its events open no editor and the file is never changed", async () => {
    const files = { [A.path]: TEAM };
    const { host, view, app, ran } = await mount({
      handlers: disk(files),
      grants: [LAYER],
      items: ITEMS,
    });
    await host.command("desk.files.visit", A);
    const sync = view.last.occurrences.find((o) => o.title === "Team sync");
    app.edit(sync?.id ?? "");
    expect(view.editors).toEqual([]);
    expect(view.statuses.at(-1)).toBe('"Team sync" is from Work; it is read-only here.');
    expect(view.last.calendar?.modified).toBe(false);
    expect(ran("desk.buffers.update")).toEqual([]);
    // A new event of the file is saved without the layer's events.
    app.compose({});
    const fields = view.editors.at(-1)?.fields as EventFields;
    app.save({ ...fields, title: "Lunch" }, "all");
    await host.command("desk.files.save", A);
    expect(files[A.path]).toContain("SUMMARY:Lunch");
    expect(files[A.path]).not.toContain("Team sync");
    expect(files[A.path]).not.toContain("Trip");
  });

  it("a calendar of the layer can be hidden and shown again, and stays hidden after a reload", async () => {
    const first = await mount({
      handlers: disk({ [A.path]: TEAM }),
      grants: [LAYER],
      items: ITEMS,
    });
    const { host, view, app } = first;
    await host.command("desk.files.visit", A);
    app.layer(WORK_KEY);
    expect(view.last.layer?.find((s) => s.key === WORK_KEY)?.hidden).toBe(true);
    expect(titles(view.last)).toEqual(["Design review", "Trip", "Dentist"]);
    expect(host.state).toMatchObject({ hidden: [WORK_KEY] });
    app.layer(WORK_KEY);
    expect(titles(view.last)).toEqual(["Design review", "Team sync", "Trip", "Dentist"]);
    // The command takes a calendar by name, or all of them.
    await host.command("endue.calendar.layer", { calendar: "Home", on: false });
    expect(titles(view.last)).toEqual(["Design review", "Team sync"]);
    await host.command("endue.calendar.layer", {});
    expect(titles(view.last)).toEqual(["Design review"]);
    expect(view.last.layer?.every((s) => s.hidden)).toBe(true);
    await host.command("endue.calendar.layer", {});
    expect(titles(view.last)).toEqual(["Design review", "Team sync", "Trip", "Dentist"]);
    await expect(host.command("endue.calendar.layer", { calendar: "Nope" })).rejects.toThrow(
      "The system calendar has no calendar Nope.",
    );
    await host.command("endue.calendar.layer", { calendar: "Work", on: false });
    const again = await mount({
      handlers: disk({ [A.path]: TEAM }),
      grants: [LAYER],
      items: ITEMS,
      state: host.state,
    });
    await again.host.command("desk.files.visit", A);
    expect(titles(again.view.last)).toEqual(["Design review", "Trip", "Dentist"]);
  });

  it("with no file open, Open my calendar opens on the layer instead of making an empty file", async () => {
    const files: Record<string, string> = {};
    const { host, view, app, params, ran, settle } = await mount({
      handlers: disk(files),
      commands: OPEN,
      grants: [LAYER],
      items: ITEMS,
    });
    await host.command("endue.calendar.open");
    expect(params("fs.write")).toEqual([]);
    expect(ran("desk.files.open")).toEqual([]);
    expect(host.visible).toBe(true);
    expect(view.last.calendar).toBeNull();
    expect(titles(view.last)).toEqual(["Team sync", "Trip", "Dentist"]);
    // New event makes the file, opens it, and opens the editor on it once the desk visits it.
    app.compose({});
    await settle();
    expect(params("fs.write")).toEqual([
      expect.objectContaining({ path: DEFAULT, createDirs: true, scope: WRITE }),
    ]);
    expect(ran("desk.files.open")).toEqual([{ path: DEFAULT }]);
    expect(view.editors).toEqual([]);
    await host.command("desk.files.visit", file(DEFAULT));
    expect(view.editors.at(-1)).toMatchObject({ kind: "new" });
    expect(view.last.calendar?.path).toBe(DEFAULT);
  });

  it("without the grant there is no layer, and Open my calendar makes the empty file as before", async () => {
    const files: Record<string, string> = {};
    const { host, view, params, ran } = await mount({
      handlers: disk(files),
      commands: OPEN,
      items: ITEMS,
    });
    expect(view.last.layer).toEqual([]);
    await host.command("endue.calendar.open");
    expect(params("perm.request")).toEqual([]);
    expect(params("fs.write")).toEqual([
      expect.objectContaining({ path: DEFAULT, createDirs: true, scope: WRITE }),
    ]);
    expect(ran("desk.files.open")).toEqual([{ path: DEFAULT }]);
  });
});
