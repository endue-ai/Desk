// Changing a calendar: new events, changes to one instance, to the instances from one on and to a
// whole series, deletions, and the file written back as RFC 5545 asks.
import { describe, expect, it } from "vitest";
import {
  createEvent,
  deleteEvent,
  emptyDocument,
  fieldsOf,
  type Scope,
  updateEvent,
} from "../ui/calendar/edit.js";
import { buildModel, type Occurrence, occurrences } from "../ui/calendar/model.js";
import { reminderOf } from "../ui/calendar/write.js";
import { parse, prop, text } from "../ui/ical/component.js";
import { parseRule } from "../ui/ical/rrule.js";
import { wallOf } from "../ui/ical/values.js";
import { vtimezoneZone } from "../ui/ical/zones.js";
import { at, ics, label, NEW_YORK, SEOUL, written } from "./fixtures";

const NOW = at("2026-10-30T00:00:00Z");
let next = 0;
const context = { now: NOW, uid: () => `new-${++next}@endue.ai`, display: SEOUL };

const wall = (y: number, m: number, d: number, h = 0, mi = 0) =>
  wallOf({ date: false, y, m, d, h, mi, s: 0, utc: false });

/** Parse, apply, write and parse again: what another app would read. */
const reread = (doc: ReturnType<typeof parse>) => parse(written(doc));

const list = (doc: ReturnType<typeof parse>, from: string, to: string, display = SEOUL) =>
  occurrences(buildModel(reread(doc), display, "Test"), at(from), at(to));

const find = (doc: ReturnType<typeof parse>, id: string, display = SEOUL): Occurrence => {
  const found = occurrences(
    buildModel(doc, display, "Test"),
    at("2026-01-01T00:00:00Z"),
    at("2027-06-01T00:00:00Z"),
  ).find((o) => o.id === id);
  if (!found) throw new Error(`no occurrence ${id}`);
  return found;
};

describe("new events", () => {
  it("get a UID, the stamps, and a VTIMEZONE for their zone; the file gets VERSION and PRODID", () => {
    const { doc, uid } = createEvent(
      { calendars: [], problems: [] },
      {
        title: "Dentist",
        allDay: false,
        start: wall(2026, 11, 3, 9),
        end: wall(2026, 11, 3, 10),
        zone: "America/New_York",
        location: "Main St, 4",
        reminder: 30,
      },
      context,
    );
    const out = written(doc);
    expect(out).toContain("VERSION:2.0\r\n");
    expect(out).toContain("PRODID:-//endue//Desk Calendar 0.1//EN\r\n");
    expect(out).toContain(`UID:${uid}\r\n`);
    expect(out).toContain("DTSTAMP:20261030T000000Z\r\n");
    expect(out).toContain("DTSTART;TZID=America/New_York:20261103T090000\r\n");
    expect(out).toContain("LOCATION:Main St\\, 4\r\n");
    expect(out).toContain("TRIGGER:-PT30M\r\n");
    const calendar = reread(doc).calendars[0];
    const vtimezone = calendar?.components.find((c) => c.name === "VTIMEZONE");
    expect(vtimezone && prop(vtimezone, "TZID")?.value).toBe("America/New_York");
    expect(vtimezone?.components.map((c) => [c.name, prop(c, "RRULE")?.value])).toEqual([
      ["DAYLIGHT", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"],
      ["STANDARD", "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"],
    ]);
    // The generated VTIMEZONE agrees with the tz database for years to come.
    const zone = vtimezone && vtimezoneZone(vtimezone, "America/New_York");
    for (const iso of [
      "2027-03-14T06:59:00Z",
      "2027-03-14T07:00:00Z",
      "2030-11-03T05:59:00Z",
      "2030-11-03T06:00:00Z",
    ])
      expect(zone?.offset(at(iso)), iso).toBe(NEW_YORK.offset(at(iso)));
    expect(list(doc, "2026-11-01T00:00:00Z", "2026-11-05T00:00:00Z").map(label)).toEqual([
      "2026-11-03 23:00 Dentist",
    ]);
  });

  it("a zone with a last-Sunday rule gets -1SU, and one without changes a single STANDARD", () => {
    const berlin = createEvent(
      emptyDocument("Home"),
      {
        title: "A",
        allDay: false,
        start: wall(2026, 6, 1, 9),
        end: wall(2026, 6, 1, 10),
        zone: "Europe/Berlin",
      },
      context,
    );
    const rules = reread(berlin.doc).calendars[0]?.components[0]?.components.map(
      (c) => prop(c, "RRULE")?.value,
    );
    expect(rules).toEqual([
      "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    ]);
    const seoul = createEvent(
      emptyDocument(),
      {
        title: "B",
        allDay: false,
        start: wall(2026, 6, 1, 9),
        end: wall(2026, 6, 1, 10),
        zone: "Asia/Seoul",
      },
      context,
    );
    const observances = reread(seoul.doc).calendars[0]?.components[0]?.components;
    expect(observances?.map((c) => [c.name, prop(c, "TZOFFSETTO")?.value])).toEqual([
      ["STANDARD", "+0900"],
    ]);
  });

  it("all-day and floating events are written as DATE and without TZID", () => {
    const { doc } = createEvent(
      emptyDocument(),
      { title: "Off", allDay: true, start: wall(2026, 12, 24), end: wall(2026, 12, 26), zone: "" },
      context,
    );
    const out = written(doc);
    expect(out).toContain("DTSTART;VALUE=DATE:20261224\r\n");
    expect(out).toContain("DTEND;VALUE=DATE:20261226\r\n");
    expect(out).not.toContain("VTIMEZONE");
  });
});

const SERIES = ics(
  [
    "UID:s",
    "DTSTART;TZID=Asia/Seoul:20261005T100000",
    "DTEND;TZID=Asia/Seoul:20261005T110000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "EXDATE;TZID=Asia/Seoul:20261019T100000",
    "SUMMARY:Review",
    "X-VENDOR-FLAG;X-P=1:keep me",
    "SEQUENCE:2",
  ],
  [
    "UID:s",
    "RECURRENCE-ID;TZID=Asia/Seoul:20261026T100000",
    "DTSTART;TZID=Asia/Seoul:20261026T160000",
    "DTEND;TZID=Asia/Seoul:20261026T170000",
    "SUMMARY:Review",
  ],
);
const OCT = ["2026-10-01T00:00:00+09:00", "2026-11-17T00:00:00+09:00"] as const;
const titles = (doc: ReturnType<typeof parse>) => list(doc, ...OCT).map(label);

describe("changing a series", () => {
  const doc = parse(SERIES);
  const nov2 = () => find(doc, "s@20261102T010000Z");
  const moveTo = (occ: Occurrence, h: number, title = occ.title) => {
    const fields = fieldsOf(occ, SEOUL);
    const day = Math.floor(fields.start / 86_400_000) * 86_400_000;
    return { ...fields, title, start: day + h * 3_600_000, end: day + (h + 1) * 3_600_000 };
  };

  it("shows the series as it is read", () => {
    expect(titles(doc)).toEqual([
      "2026-10-05 10:00 Review",
      "2026-10-12 10:00 Review",
      "2026-10-26 16:00 Review",
      "2026-11-02 10:00 Review",
      "2026-11-09 10:00 Review",
      "2026-11-16 10:00 Review",
    ]);
    expect(fieldsOf(nov2(), SEOUL)).toMatchObject({
      zone: "Asia/Seoul",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      reminder: null,
    });
  });

  it("this event: an override with RECURRENCE-ID written as DTSTART is", () => {
    const changed = updateEvent(doc, nov2(), moveTo(nov2(), 14, "Review (late)"), "one", context);
    expect(titles(changed)).toContain("2026-11-02 14:00 Review (late)");
    expect(titles(changed)).toHaveLength(6);
    expect(written(changed)).toContain("RECURRENCE-ID;TZID=Asia/Seoul:20261102T100000\r\n");
    const override = reread(changed).calendars[0]?.components.find(
      (c) => prop(c, "RECURRENCE-ID")?.value === "20261102T100000",
    );
    expect(override && prop(override, "RRULE")).toBeUndefined();
    expect(override && prop(override, "SEQUENCE")?.value).toBe("3");
    // A second change edits the same override instead of adding one.
    const again = updateEvent(
      changed,
      find(changed, "s@20261102T010000Z"),
      moveTo(nov2(), 15),
      "one",
      context,
    );
    expect(written(again).match(/RECURRENCE-ID/g)).toHaveLength(2);
    expect(titles(again)).toContain("2026-11-02 15:00 Review");
  });

  it("this and following: the series ends with UNTIL and a new UID carries the rest", () => {
    const changed = updateEvent(doc, nov2(), moveTo(nov2(), 9, "Review v2"), "following", context);
    expect(titles(changed)).toEqual([
      "2026-10-05 10:00 Review",
      "2026-10-12 10:00 Review",
      "2026-10-26 16:00 Review",
      "2026-11-02 09:00 Review v2",
      "2026-11-09 09:00 Review v2",
      "2026-11-16 09:00 Review v2",
    ]);
    const out = written(changed);
    expect(out).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261102T005959Z;BYDAY=MO\r\n");
    expect(out).toContain("X-VENDOR-FLAG;X-P=1:keep me\r\n");
    const events =
      reread(changed).calendars[0]?.components.filter((c) => c.name === "VEVENT") ?? [];
    expect(events.map((e) => prop(e, "UID")?.value)).toEqual([
      "s",
      expect.stringMatching(/^new-\d+@endue\.ai$/),
      "s",
    ]);
  });

  it("this and following on a COUNT series splits the count", () => {
    const counted = parse(
      SERIES.replace("RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6"),
    );
    const occ = find(counted, "s@20261102T010000Z");
    const changed = updateEvent(counted, occ, moveTo(occ, 10, "Later"), "following", context);
    const rules = reread(changed)
      .calendars[0]?.components.filter((c) => c.name === "VEVENT")
      .map((c) => prop(c, "RRULE")?.value);
    // Four instances came before, the one EXDATE removed among them: EXDATE gives no count back.
    expect(rules).toEqual([
      "FREQ=WEEKLY;UNTIL=20261102T005959Z;BYDAY=MO",
      "FREQ=WEEKLY;COUNT=2;BYDAY=MO",
      undefined,
    ]);
  });

  it("all events: the times move, and EXDATE and overrides move with them", () => {
    const changed = updateEvent(doc, nov2(), moveTo(nov2(), 11, "Weekly review"), "all", context);
    expect(titles(changed)).toEqual([
      "2026-10-05 11:00 Weekly review",
      "2026-10-12 11:00 Weekly review",
      "2026-10-26 16:00 Weekly review",
      "2026-11-02 11:00 Weekly review",
      "2026-11-09 11:00 Weekly review",
      "2026-11-16 11:00 Weekly review",
    ]);
    const out = written(changed);
    expect(out).toContain("EXDATE;TZID=Asia/Seoul:20261019T110000\r\n");
    expect(out).toContain("RECURRENCE-ID;TZID=Asia/Seoul:20261026T110000\r\n");
    expect(out).toContain("SEQUENCE:3\r\n");
  });

  it("all events with no repeat leaves one event at the chosen time", () => {
    const changed = updateEvent(
      doc,
      nov2(),
      { ...moveTo(nov2(), 10), rrule: null },
      "all",
      context,
    );
    expect(titles(changed)).toEqual(["2026-11-02 10:00 Review"]);
  });
});

describe("deleting", () => {
  const doc = parse(SERIES);
  const run = (id: string, scope: Scope) => titles(deleteEvent(doc, find(doc, id), scope, context));

  it("one instance becomes an EXDATE; an override goes with it", () => {
    expect(run("s@20261102T010000Z", "one")).not.toContain("2026-11-02 10:00 Review");
    const moved = deleteEvent(doc, find(doc, "s@20261026T010000Z"), "one", context);
    expect(titles(moved)).toHaveLength(5);
    expect(written(moved)).not.toContain("RECURRENCE-ID");
  });

  it("this and following ends the series; all removes it; a single event goes", () => {
    expect(run("s@20261026T010000Z", "following")).toEqual([
      "2026-10-05 10:00 Review",
      "2026-10-12 10:00 Review",
    ]);
    expect(run("s@20261012T010000Z", "all")).toEqual([]);
    expect(run("s@20261005T010000Z", "following")).toEqual([]);
    const single = parse(ics(["UID:x", "DTSTART:20261030T000000Z", "SUMMARY:Gone"]));
    expect(titles(deleteEvent(single, find(single, "x"), "all", context))).toEqual([]);
  });
});

describe("writing back", () => {
  it("keeps what it does not know, changes only what was edited, and reads the reminder back", () => {
    const original = ics([
      "UID:k",
      "DTSTAMP:20200101T000000Z",
      "DTSTART;TZID=Asia/Seoul:20261030T090000",
      "DTEND;TZID=Asia/Seoul:20261030T100000",
      "SUMMARY:Keep",
      "ATTENDEE;CN=Jane;PARTSTAT=ACCEPTED:mailto:jane@example.com",
      "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
    ]);
    const doc = parse(original);
    const occ = find(doc, "k");
    const changed = updateEvent(
      doc,
      occ,
      { ...fieldsOf(occ, SEOUL), title: "Kept", reminder: 10 },
      "all",
      context,
    );
    const event = reread(changed).calendars[0]?.components.find((c) => c.name === "VEVENT");
    if (!event) throw new Error("no event");
    expect(text(event, "SUMMARY")).toBe("Kept");
    expect(prop(event, "ATTENDEE")).toMatchObject({
      name: "ATTENDEE",
      params: { CN: ["Jane"], PARTSTAT: ["ACCEPTED"] },
      value: "mailto:jane@example.com",
    });
    expect(prop(event, "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR")?.value).toBe("AUTOMATIC");
    expect(prop(event, "DTSTAMP")?.value).toBe("20261030T000000Z");
    expect(prop(event, "SEQUENCE")).toBeUndefined();
    expect(reminderOf(event)).toBe(10);
  });

  it("an all-day series keeps UNTIL a DATE; a timed one in a zone gets UNTIL in UTC", () => {
    const doc = parse(
      ics([
        "UID:d",
        "DTSTART;VALUE=DATE:20261005",
        "RRULE:FREQ=DAILY;UNTIL=20261010",
        "SUMMARY:Days",
      ]),
    );
    const occ = find(doc, "d@20261005");
    const timed = updateEvent(
      doc,
      occ,
      {
        ...fieldsOf(occ, SEOUL),
        allDay: false,
        zone: "Asia/Seoul",
        start: wall(2026, 10, 5, 9),
        end: wall(2026, 10, 5, 10),
      },
      "all",
      context,
    );
    const rule = prop(
      reread(timed).calendars[0]?.components.find((c) => c.name === "VEVENT") ?? {
        name: "",
        props: [],
        components: [],
      },
      "RRULE",
    )?.value;
    expect(rule).toBe("FREQ=DAILY;UNTIL=20261010T145959Z");
    expect(parseRule(rule ?? "")).toMatchObject({ rule: { freq: "DAILY" } });
    expect(list(timed, ...OCT).map(label)).toHaveLength(6);
  });
});
