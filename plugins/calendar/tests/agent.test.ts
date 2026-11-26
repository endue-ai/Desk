// The commands agents and other plugins run: events as specs/item/v0 items (checked against the schema),
// overlapping events, and adding one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { SPECS } from "../ui/agent-specs.js";
import { ics } from "./fixtures";
import { disk, file, mount } from "./harness";

const root = join(import.meta.dirname, "../../..");

/** A validator for item/v0 items; the item spec references the plugin spec, which references it. */
function itemValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(JSON.parse(readFileSync(join(dir, name), "utf8")) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/item/v0/item.schema.json");
  if (!validate) throw new Error("cannot compile item.schema.json");
  return validate;
}

const A = file("~/Calendar/Work Calendar.ics");
const WORK = ics(
  [
    "UID:plan",
    "DTSTAMP:20261001T000000Z",
    "LAST-MODIFIED:20261020T120000Z",
    "CREATED:20261001T000000Z",
    "DTSTART;TZID=Asia/Seoul:20261102T100000",
    "DTEND;TZID=Asia/Seoul:20261102T110000",
    "SUMMARY:Planning",
    "LOCATION:Room 3",
    "DESCRIPTION:Bring the roadmap",
    "ORGANIZER;CN=Mina Park:mailto:mina@example.com",
    "ATTENDEE;CN=Jun;PARTSTAT=ACCEPTED:mailto:jun@example.com",
    "ATTENDEE:mailto:not-an-email",
    "CATEGORIES:Work,Planning",
    "URL:https://meet.example.com/plan",
    "SEQUENCE:3",
  ],
  [
    "UID:sync",
    "DTSTART;TZID=Asia/Seoul:20261102T103000",
    "DTEND;TZID=Asia/Seoul:20261102T113000",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:Vendor sync",
  ],
  [
    "UID:lunch",
    "DTSTART;TZID=Asia/Seoul:20261102T103000",
    "DTEND;TZID=Asia/Seoul:20261102T113000",
    "TRANSP:TRANSPARENT",
    "SUMMARY:Hold",
  ],
  ["UID:off", "DTSTART;VALUE=DATE:20261103", "SUMMARY:Day off"],
);

describe("agent commands", () => {
  it("are declared in the manifest as agent.js describes them, the reads read-only", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "plugins/calendar/plugin.json"), "utf8"),
    ) as {
      contributes: { commands: Array<Record<string, unknown>> };
    };
    for (const [id, spec] of Object.entries(SPECS)) {
      const declared = manifest.contributes.commands.find((c) => c.id === id);
      expect(declared, id).toMatchObject({ ...spec, agent: true });
      expect(String(declared?.description).length, id).toBeGreaterThan(20);
    }
    expect(SPECS["endue.calendar.events"]?.readOnly).toBe(true);
    expect(SPECS["endue.calendar.conflicts"]?.readOnly).toBe(true);
    expect(SPECS["endue.calendar.delete"]?.irreversible).toBeUndefined();
    expect(SPECS["endue.calendar.save"]?.irreversible).toBe(true);
    expect(SPECS["endue.calendar.add"]?.readOnly).toBeUndefined();
  });

  it("events answers item/v0 items for the span, in the person's zone", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    const answer = (await host.command("endue.calendar.events", {
      from: "2026-11-02",
      to: "2026-11-04",
    })) as {
      timeZone: string;
      items: Array<Record<string, unknown>>;
    };
    expect(answer.timeZone).toBe("Asia/Seoul");
    const validate = itemValidator();
    for (const item of answer.items)
      expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
    expect(answer.items.map((i) => i.title)).toEqual([
      "Planning",
      "Hold",
      "Vendor sync",
      "Day off",
    ]);
    expect(answer.items[0]).toEqual({
      id: "plan",
      source: { connector: "endue.calendar", instance: "work-calendar" },
      kind: "event",
      title: "Planning",
      updatedAt: "2026-10-20T12:00:00Z",
      createdAt: "2026-10-01T00:00:00Z",
      deepLink: "https://meet.example.com/plan",
      body: "Bring the roadmap",
      start: "2026-11-02T10:00:00+09:00",
      end: "2026-11-02T11:00:00+09:00",
      location: "Room 3",
      attendees: [{ name: "Jun", email: "jun@example.com" }],
      calendar: "Work Calendar",
      raw: {
        uid: "plan",
        status: "CONFIRMED",
        busy: true,
        sequence: 3,
        organizer: { name: "Mina Park", email: "mina@example.com" },
        categories: ["Work", "Planning"],
      },
    });
    expect(answer.items[2]).toMatchObject({
      id: "sync@20261102T013000Z",
      recurrence: "FREQ=WEEKLY;COUNT=3",
    });
    expect(answer.items[3]).toMatchObject({
      allDay: true,
      start: "2026-11-03T00:00:00+09:00",
      end: "2026-11-04T00:00:00+09:00",
    });
    const found = (await host.command("endue.calendar.events", {
      from: "2026-11-01",
      text: "ROADMAP",
    })) as { items: unknown[] };
    expect(found.items).toHaveLength(1);
  });

  it("conflicts names busy events that overlap, leaving out free and all-day ones", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    const answer = (await host.command("endue.calendar.conflicts", { from: "2026-11-02" })) as {
      conflicts: Array<{
        a: { title: string };
        b: { title: string };
        from: string;
        to: string;
        minutes: number;
      }>;
    };
    expect(answer.conflicts.map((c) => [c.a.title, c.b.title, c.from, c.to, c.minutes])).toEqual([
      ["Planning", "Vendor sync", "2026-11-02T10:30", "2026-11-02T11:00", 30],
    ]);
  });

  it("reads the default calendar file when none is open", async () => {
    const { host } = await mount({ handlers: disk({ "~/Calendar/calendar.ics": WORK }) });
    const answer = (await host.command("endue.calendar.events", {
      from: "2026-11-02T00:00:00+09:00",
      to: "2026-11-03T00:00:00+09:00",
    })) as {
      items: Array<{ source: { instance: string } }>;
    };
    expect(answer.items).toHaveLength(3);
    expect(answer.items[0]?.source.instance).toBe("calendar");
  });

  it("add puts an event on the calendar on screen, unsaved, and answers it as an item", async () => {
    const files = { [A.path]: WORK };
    const { host, view, ran, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    const answer = (await host.command("endue.calendar.add", {
      title: "Call with Jun",
      start: "2026-11-04T15:00",
      end: "2026-11-04T15:30",
      reminder: 5,
      location: "Phone",
    })) as { item: Record<string, unknown> };
    await settle();
    expect(itemValidator()(answer.item)).toBe(true);
    expect(answer.item).toMatchObject({
      id: "uid-1@endue.ai",
      title: "Call with Jun",
      start: "2026-11-04T15:00:00+09:00",
      end: "2026-11-04T15:30:00+09:00",
      location: "Phone",
    });
    expect(view.last.calendar?.modified).toBe(true);
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);
    expect(files[A.path]).toBe(WORK);
  });

  it("refuses arguments it cannot read, saying which", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    const fail = (id: string, args: Record<string, unknown>) =>
      host.command(id, args).then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(await fail("endue.calendar.events", { from: "next week" })).toContain(
      "from: next week is not a time.",
    );
    expect(await fail("endue.calendar.events", { from: "2026-11-02", to: "2026-11-01" })).toContain(
      "to must come after from.",
    );
    expect(await fail("endue.calendar.events", { from: "2026-01-01", to: "2028-01-01" })).toContain(
      "A span is 366 days at most.",
    );
    expect(
      await fail("endue.calendar.add", {
        title: "X",
        start: "2026-11-04T15:00",
        timeZone: "Mars/Base",
      }),
    ).toContain("timeZone: Mars/Base is not a time zone.");
    expect(
      await fail("endue.calendar.add", {
        title: "X",
        start: "2026-11-04",
        rrule: "FREQ=SOMETIMES",
      }),
    ).toContain("rrule: FREQ=SOMETIMES is unknown.");
  });

  it("update moves and renames an event it names, and one instance of a series alone", async () => {
    const files = { [A.path]: WORK };
    const { host, view, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    const moved = (await host.command("endue.calendar.update", {
      id: "plan",
      start: "2026-11-02T10:00:00+09:00",
      newStart: "2026-11-02T14:00",
      title: "Planning, moved",
    })) as { item: Record<string, unknown> };
    await settle();
    expect(moved.item).toMatchObject({
      title: "Planning, moved",
      start: "2026-11-02T14:00:00+09:00",
      end: "2026-11-02T15:00:00+09:00",
      location: "Room 3",
    });
    expect(view.last.calendar?.modified).toBe(true);
    const events = (await host.command("endue.calendar.events", {
      from: "2026-11-09",
      to: "2026-11-10",
    })) as { items: Array<{ id: string; start: string; title: string }> };
    const second = events.items.find((e) => e.title === "Vendor sync");
    if (!second) throw new Error("no second instance");
    await host.command("endue.calendar.update", {
      id: second.id,
      start: second.start,
      title: "Sync, once",
    });
    const after = (await host.command("endue.calendar.events", {
      from: "2026-11-02",
      to: "2026-11-17",
    })) as { items: Array<{ title: string }> };
    expect(after.items.map((e) => e.title).filter((t) => /sync/i.test(t))).toEqual([
      "Vendor sync",
      "Sync, once",
      "Vendor sync",
    ]);
    await expect(
      host.command("endue.calendar.update", { id: "nope", start: "2026-11-02" }),
    ).rejects.toThrow(/There is no event nope/);
  });

  it("delete takes an event off, and save writes the calendar through the desk", async () => {
    const files = { [A.path]: WORK };
    const commands = { "desk.files.save": () => ({}) };
    const { host, ran, settle } = await mount({ handlers: disk(files), commands });
    await host.command("desk.files.visit", A);
    await expect(host.command("endue.calendar.save")).resolves.toEqual({ path: null });
    await expect(
      host.command("endue.calendar.delete", { id: "lunch", start: "2026-11-02T10:30:00+09:00" }),
    ).resolves.toEqual({ deleted: "lunch" });
    await settle();
    const left = (await host.command("endue.calendar.events", {
      from: "2026-11-02",
      to: "2026-11-03",
    })) as { items: Array<{ title: string }> };
    expect(left.items.map((e) => e.title)).not.toContain("Hold");
    await expect(host.command("endue.calendar.save")).resolves.toEqual({ path: A.path });
    expect(ran("desk.files.save")).toEqual([{ buffer: A.buffer }]);
  });

  it("changes an event's actual calendar and adds to a named calendar without switching it", async () => {
    const B = file("~/Calendar/other.ics");
    const other = ics([
      "UID:clinic",
      "DTSTART;TZID=Asia/Seoul:20261102T140000",
      "DTEND;TZID=Asia/Seoul:20261102T143000",
      "SUMMARY:Clinic",
    ]);
    const files = { [A.path]: WORK, [B.path]: other };
    const { host, view, ran, settle } = await mount({
      handlers: disk(files),
      commands: { "desk.files.save": () => ({}) },
    });
    await host.command("desk.files.visit", B);
    await host.command("desk.files.visit", A);
    const target = { id: "clinic", start: "2026-11-02T14:00:00+09:00" };
    expect(
      await host.command("endue.calendar.update", { ...target, title: "Moved" }),
    ).toMatchObject({
      item: { title: "Moved", raw: { path: B.path } },
    });
    await host.command("endue.calendar.delete", target);
    await host.command("endue.calendar.add", {
      calendar: B.path,
      title: "Another event",
      start: "2026-11-04T12:30",
    });
    await settle();
    expect(view.last.calendar).toMatchObject({ path: A.path, modified: false });
    expect(ran("desk.buffers.update")).toEqual([{ id: B.buffer, modified: true }]);
    expect(files).toEqual({ [A.path]: WORK, [B.path]: other });
    expect(await host.command("endue.calendar.save", { calendar: B.path })).toEqual({
      path: B.path,
    });
    expect(ran("desk.files.save")).toEqual([{ buffer: B.buffer }]);
  });

  it("goes to a named view, reads its span and selection and preloads the editor", async () => {
    const { host, app, view, params } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    await host.command("endue.calendar.show", { date: "2026-11-02", view: "day" });
    app.edit("plan");
    expect(await host.command("endue.calendar.current")).toMatchObject({
      view: "day",
      date: "2026-11-02",
      span: { from: "2026-11-02", to: "2026-11-03" },
      event: { id: "plan", title: "Planning" },
    });
    app.close();
    await host.command("endue.calendar.new", {
      fields: { title: "Review first", start: "2026-11-02T13:00", location: "Office" },
    });
    expect(view.editors.at(-1)).toMatchObject({
      kind: "new",
      fields: {
        title: "Review first",
        start: Date.parse("2026-11-02T13:00:00Z"),
        location: "Office",
      },
    });
    expect(view.last.calendar?.modified).toBe(false);
    expect(params("fs.write")).toEqual([]);
  });
});
