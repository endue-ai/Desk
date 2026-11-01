// The desk's file and buffer requests, the person's commands and the editor, on the SDK's test host.
import { describe, expect, it } from "vitest";
import type { EventFields } from "../ui/calendar/write.js";
import { ics } from "./fixtures";
import { denied, disk, file, type Handlers, mount, READ, WRITE } from "./harness";

/** The fields the editor was last opened with. */
const opened = (editors: Array<{ fields: EventFields } | null>): EventFields => {
  const fields = editors.at(-1)?.fields;
  if (!fields) throw new Error("the editor is not open");
  return fields;
};

const A = file("~/Calendar/team.ics");
const TEAM = ics(
  [
    "UID:standup",
    "DTSTART;TZID=Asia/Seoul:20261026T100000",
    "DTEND;TZID=Asia/Seoul:20261026T101500",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "SUMMARY:Standup",
  ],
  [
    "UID:review",
    "DTSTART;TZID=Asia/Seoul:20261030T100000",
    "DTEND;TZID=Asia/Seoul:20261030T110000",
    "SUMMARY:Design review",
    "X-KEEP:yes",
  ],
).replace("\r\n", "\n");

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

describe("the desk's file requests", () => {
  it("visit reads, parses and shows the calendar, and watches the file", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: TEAM }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toEqual([{ path: A.path, encoding: "utf8", scope: READ }]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: READ }]);
    const state = view.last;
    expect(state.calendar).toEqual({
      name: "team",
      path: A.path,
      modified: false,
      readOnly: false,
      problems: [],
    });
    expect(state).toMatchObject({
      mode: "month",
      today: day("2026-10-30"),
      anchor: day("2026-10-30"),
    });
    expect(state.title).toBe("October 2026");
    // The month grid of October 2026 from Sunday September 27 (en-US weeks start on Sunday).
    expect(state.span).toEqual({ from: day("2026-09-27"), to: day("2026-11-08") });
    // Same start: by title, so the review comes before Friday's standup.
    expect(state.occurrences.map((o) => o.title)).toEqual([
      ...Array(4).fill("Standup"),
      "Design review",
      ...Array(6).fill("Standup"),
    ]);
    expect(view.focused).toBe(1);
  });

  it("an empty or missing file is an empty calendar; text that is not iCalendar opens read-only", async () => {
    const files = { [A.path]: "", "~/Calendar/notes.ics": "just some notes\n" };
    const { host, view, app } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    expect(view.last.calendar).toMatchObject({ readOnly: false, problems: [] });
    const notes = file("~/Calendar/notes.ics");
    await host.command("desk.files.visit", notes);
    expect(view.last.calendar).toMatchObject({ readOnly: true });
    app.compose({});
    expect(view.statuses.at(-1)).toBe("notes.ics is not an iCalendar file; it opens read-only.");
    await expect(host.command("desk.files.save", notes)).rejects.toThrow("read-only");
    expect(files["~/Calendar/notes.ics"]).toBe("just some notes\n");
  });

  it("save without a change writes the file exactly as it was read", async () => {
    const files = { [A.path]: TEAM };
    const { host, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    await host.command("desk.files.save", A);
    expect(params("fs.write")).toEqual([
      { path: A.path, content: TEAM, encoding: "utf8", scope: WRITE },
    ]);
  });

  it("a new event from the editor marks the calendar unsaved, and save writes it", async () => {
    const files = { [A.path]: TEAM };
    const { host, view, app, ran, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    app.compose({ day: day("2026-11-02"), minute: 14 * 60 });
    const editor = view.editors.at(-1);
    expect(editor).toMatchObject({ kind: "new", recurring: false, zone: "Asia/Seoul" });
    expect(editor?.fields).toMatchObject({
      title: "",
      allDay: false,
      zone: "Asia/Seoul",
      reminder: 10,
    });
    expect((editor?.fields.end ?? 0) - (editor?.fields.start ?? 0)).toBe(3_600_000);
    app.save({ ...opened(view.editors), title: "Lunch with Mina" }, "all");
    await settle();
    expect(view.editors.at(-1)).toBeNull();
    expect(view.statuses.at(-1)).toBe("Added Lunch with Mina.");
    expect(view.last.calendar?.modified).toBe(true);
    expect(view.last.anchor).toBe(day("2026-11-02"));
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);
    await host.command("desk.files.save", A);
    const saved = files[A.path] ?? "";
    expect(saved).toContain("SUMMARY:Lunch with Mina\r\n");
    expect(saved).toContain("DTSTART;TZID=Asia/Seoul:20261102T140000\r\n");
    expect(saved).toContain("BEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\n");
    expect(saved).toContain("X-KEEP:yes\r\n");
    expect(view.last.calendar?.modified).toBe(false);
  });

  it("changing one instance of a series asks for the scope and keeps the rest", async () => {
    const files = { [A.path]: TEAM };
    const { host, view, app } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    const standup = view.last.occurrences.find((o) => o.id === "standup@20261029T010000Z");
    app.edit(standup?.id ?? "");
    const editor = view.editors.at(-1);
    expect(editor).toMatchObject({ kind: "edit", recurring: true });
    expect(editor?.fields.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    app.save({ ...opened(view.editors), title: "Standup (short)" }, "one");
    const titles = view.last.occurrences.map((o) => o.title);
    expect(titles.filter((t) => t === "Standup (short)")).toHaveLength(1);
    expect(titles.filter((t) => t === "Standup")).toHaveLength(9);
    app.edit("review");
    app.remove("all");
    expect(view.last.occurrences.map((o) => o.title)).not.toContain("Design review");
    expect(view.statuses.at(-1)).toBe("Deleted Design review.");
  });

  it("an editor whose end comes before its start says so and saves nothing", async () => {
    const { host, view, app } = await mount({ handlers: disk({ [A.path]: TEAM }) });
    await host.command("desk.files.visit", A);
    app.compose({});
    const fields = opened(view.editors);
    app.save({ ...fields, end: fields.start - 1 }, "all");
    expect(view.statuses.at(-1)).toBe("The event ends before it starts.");
    expect(view.last.calendar?.modified).toBe(false);
  });

  it("revert reads the file again and forgets the changes", async () => {
    const files = { [A.path]: TEAM };
    const { host, view, app } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    app.edit("review");
    app.remove("all");
    await host.command("desk.files.revert", A);
    expect(view.last.calendar?.modified).toBe(false);
    expect(view.last.occurrences.map((o) => o.title)).toContain("Design review");
  });

  it("a file changed on disk is reported to the desk, which decides", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: TEAM }) });
    await host.command("desk.files.visit", A);
    host.emit({
      event: "fs.changed",
      data: { watchId: "w1", path: A.path, kind: "modified" },
    } as never);
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
  });

  it("a refused read asks once for the file's folder and tries again", async () => {
    const files = { "~/Work/plan.ics": TEAM };
    const read = disk(files)["fs.read"];
    if (!read) throw new Error("no fs.read");
    let granted = false;
    const handlers: Handlers = {
      ...disk(files),
      "fs.read": (params, caller) => {
        if (!granted) throw denied("fs:read");
        return read(params, caller);
      },
      "perm.request": () => {
        granted = true;
        return { granted: true, duration: "session" };
      },
    };
    const { host, params, view } = await mount({ handlers });
    await host.command("desk.files.visit", file("~/Work/plan.ics"));
    expect(params("perm.request")).toEqual([
      {
        permission: { permission: "fs:read", paths: ["~/Work/**"] },
        reason: "To open ~/Work/plan.ics in Calendar",
      },
    ]);
    expect(view.last.calendar?.path).toBe("~/Work/plan.ics");
  });

  it("closing the buffer forgets the calendar", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: TEAM }) });
    await host.command("desk.files.visit", A);
    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.last.calendar).toBeNull();
    await expect(host.command("desk.files.save", A)).rejects.toThrow(`No calendar ${A.buffer}.`);
  });
});

describe("the person's commands", () => {
  it("move by view, switch views, and go to today", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: TEAM }) });
    await host.command("desk.files.visit", A);
    await host.command("endue.calendar.next");
    expect(view.last.title).toBe("November 2026");
    await host.command("endue.calendar.week");
    // ICU puts thin spaces around the dash of a range.
    expect(view.last.mode).toBe("week");
    expect(view.last.title.replace(/\s/g, " ")).toBe("Nov 29 – Dec 5, 2026");
    await host.command("endue.calendar.previous");
    await host.command("endue.calendar.day");
    expect(view.last.title).toBe("Monday, November 23, 2026");
    await host.command("endue.calendar.today");
    await host.command("endue.calendar.agenda");
    expect(view.last).toMatchObject({ mode: "agenda", anchor: day("2026-10-30") });
    expect(host.state).toMatchObject({ mode: "agenda", anchor: day("2026-10-30") });
  });

  it("go to a date takes words, or asks through the palette", async () => {
    const { host, view, ran } = await mount({
      handlers: disk({ [A.path]: TEAM }),
      commands: { "desk.palette.pick": () => "2027-01-15" },
    });
    await host.command("desk.files.visit", A);
    await host.command("endue.calendar.goto", { date: "tomorrow" });
    expect(view.last.anchor).toBe(day("2026-10-31"));
    await host.command("endue.calendar.goto");
    expect(ran("desk.palette.pick")).toHaveLength(1);
    expect(view.last.anchor).toBe(day("2027-01-15"));
    await expect(host.command("endue.calendar.goto", { date: "someday" })).rejects.toThrow(
      '"someday" is not a date; write it as 2026-11-03.',
    );
  });

  it("open my calendar makes an empty file when there is none, then opens it", async () => {
    const files: Record<string, string> = {};
    const { host, params, ran } = await mount({
      handlers: disk(files),
      commands: { "desk.files.open": () => "file:~/Calendar/calendar.ics" },
    });
    await host.command("endue.calendar.open");
    expect(params("fs.write")).toEqual([
      expect.objectContaining({ path: "~/Calendar/calendar.ics", createDirs: true, scope: WRITE }),
    ]);
    expect(files["~/Calendar/calendar.ics"]).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(ran("desk.files.open")).toEqual([{ path: "~/Calendar/calendar.ics" }]);
  });

  it("settings choose the view, the week's first day and the zone", async () => {
    const { host, view } = await mount({
      handlers: disk({ [A.path]: TEAM }),
      settings: {
        "endue.calendar.view": "week",
        "endue.calendar.week-start": "monday",
        "endue.calendar.time-zone": "America/New_York",
      },
    });
    await host.command("desk.files.visit", A);
    // 2026-10-30T00:00Z is still October 29 in New York.
    expect(view.last).toMatchObject({ mode: "week", weekStart: 1, today: day("2026-10-29") });
    expect(view.last.span.from).toBe(day("2026-10-26"));
    const review = view.last.occurrences.find((o) => o.id === "review");
    expect(new Date(review?.startWall ?? 0).toISOString()).toBe("2026-10-29T21:00:00.000Z");
  });
});
