// The commands agents and other plugins run: events as specs/item/v0 items (checked against the schema),
// overlapping events, and adding one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
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
  it("are registered with an argument schema and a description", async () => {
    const { params } = await mount({ handlers: disk({}) });
    const registered = params("cmd.register") as Array<{
      id: string;
      argsSchema: object;
      description: string;
    }>;
    expect(registered.map((r) => r.id)).toEqual([
      "endue.calendar.events",
      "endue.calendar.conflicts",
      "endue.calendar.add",
    ]);
    for (const r of registered) {
      expect(r.description.length).toBeGreaterThan(20);
      expect(r.argsSchema).toMatchObject({ type: "object" });
    }
  });

  it("events answers item/v0 items for the span, in the person's zone", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    const answer = (await host.invoke("endue.calendar.events", {
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
    const found = (await host.invoke("endue.calendar.events", {
      from: "2026-11-01",
      text: "ROADMAP",
    })) as { items: unknown[] };
    expect(found.items).toHaveLength(1);
  });

  it("conflicts names busy events that overlap, leaving out free and all-day ones", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: WORK }) });
    await host.command("desk.files.visit", A);
    const answer = (await host.invoke("endue.calendar.conflicts", { from: "2026-11-02" })) as {
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
    const answer = (await host.invoke("endue.calendar.events", {
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
    const answer = (await host.invoke("endue.calendar.add", {
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
      host.invoke(id, args).then(
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
});
