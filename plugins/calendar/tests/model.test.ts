// Reading events: times in zones, all-day and floating events, durations, series with EXDATE, RDATE
// and RECURRENCE-ID overrides, and what the calendar says it could not read.
import { describe, expect, it } from "vitest";
import { occurrences } from "../ui/calendar/model.js";
import { at, ics, labels, model, NEW_YORK } from "./fixtures";

const WEEK = ["2026-10-26T00:00:00+09:00", "2026-11-02T00:00:00+09:00"] as const;

describe("single events", () => {
  it("are placed by their zone and shown in the display zone", () => {
    const text = ics(
      [
        "UID:a",
        "DTSTART;TZID=America/New_York:20261029T200000",
        "DTEND;TZID=America/New_York:20261029T210000",
        "SUMMARY:Call",
      ],
      ["UID:b", "DTSTART:20261030T000000Z", "DURATION:PT90M", "SUMMARY:Standup"],
      ["UID:c", "DTSTART;VALUE=DATE:20261031", "SUMMARY:Holiday"],
      ["UID:d", "DTSTART:20261030T150000", "SUMMARY:Floating"],
    );
    expect(labels(text, ...WEEK)).toEqual([
      "2026-10-30 09:00 Call",
      "2026-10-30 09:00 Standup",
      "2026-10-30 15:00 Floating",
      "2026-10-31 all-day Holiday",
    ]);
    const [call, standup, floating, holiday] = occurrences(model(text), at(WEEK[0]), at(WEEK[1]));
    expect(call?.end).toBe(at("2026-10-30T01:00:00Z"));
    expect((standup?.end ?? 0) - (standup?.start ?? 0)).toBe(90 * 60_000);
    // No DTEND: a DATE-TIME lasts no time, a DATE one day (§3.6.1).
    expect(floating?.end).toBe(floating?.start);
    expect(holiday).toMatchObject({ allDay: true, free: true });
    expect(holiday?.end).toBe(at("2026-11-01T00:00:00+09:00"));
  });

  it("an all-day event reaches every day it spans; an event that ends at `from` does not", () => {
    const text = ics(
      ["UID:trip", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261027", "SUMMARY:Trip"],
      [
        "UID:late",
        "DTSTART;TZID=Asia/Seoul:20261025T230000",
        "DTEND;TZID=Asia/Seoul:20261026T000000",
        "SUMMARY:Late",
      ],
    );
    expect(labels(text, ...WEEK)).toEqual(["2026-10-20 all-day Trip"]);
  });

  it("a DURATION in days follows the wall clock across a time change (§3.3.6)", () => {
    const text = ics([
      "UID:x",
      "DTSTART;TZID=America/New_York:20261031T120000",
      "DURATION:P1D",
      "SUMMARY:Day",
    ]);
    const [day] = occurrences(
      model(text, NEW_YORK),
      at("2026-10-30T00:00:00Z"),
      at("2026-11-05T00:00:00Z"),
    );
    // 25 hours: New York falls back on November 1.
    expect((day?.end ?? 0) - (day?.start ?? 0)).toBe(25 * 3_600_000);
  });

  it("read TRANSP, STATUS, LOCATION and DESCRIPTION, and give a title to an untitled event", () => {
    const text = ics([
      "UID:x",
      "DTSTART:20261030T000000Z",
      "TRANSP:TRANSPARENT",
      "STATUS:tentative",
      "LOCATION:Room 4\\, 2F",
      "DESCRIPTION:Agenda:\\n1. Plan",
    ]);
    const [occ] = occurrences(model(text), at(WEEK[0]), at(WEEK[1]));
    expect(occ).toMatchObject({
      title: "(No title)",
      free: true,
      status: "TENTATIVE",
      location: "Room 4, 2F",
      description: "Agenda:\n1. Plan",
      recurring: false,
      id: "x",
    });
  });
});

const SERIES = [
  "UID:weekly",
  "DTSTART;TZID=America/New_York:20261005T090000",
  "DTEND;TZID=America/New_York:20261005T093000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
  "SUMMARY:Sync",
];

describe("series", () => {
  const window = ["2026-10-05T00:00:00-04:00", "2026-11-14T00:00:00-05:00"] as const;
  const list = (text: string) => labels(text, ...window, NEW_YORK);

  it("repeat at the same local time across a time change", () => {
    const all = list(ics(SERIES));
    expect(all).toHaveLength(12);
    expect(all.slice(7, 10)).toEqual([
      "2026-10-28 09:00 Sync",
      "2026-11-02 09:00 Sync",
      "2026-11-04 09:00 Sync",
    ]);
  });

  it("leave out EXDATE instances, in any zone that names the same instant", () => {
    const text = ics([
      ...SERIES,
      "EXDATE;TZID=America/New_York:20261007T090000,20261012T090000",
      "EXDATE:20261102T140000Z",
    ]);
    const all = list(text);
    expect(all).toHaveLength(9);
    expect(all).not.toContain("2026-10-07 09:00 Sync");
    expect(all).not.toContain("2026-10-12 09:00 Sync");
    expect(all).not.toContain("2026-11-02 09:00 Sync");
  });

  it("add RDATE instances, with their own end for a PERIOD", () => {
    const text = ics([
      ...SERIES,
      "RDATE;TZID=America/New_York:20261010T110000",
      "RDATE;VALUE=PERIOD:20261011T150000Z/PT2H",
    ]);
    const all = occurrences(model(text, NEW_YORK), at(window[0]), at(window[1]));
    const saturday = all.find((o) => o.id === "weekly@20261010T150000Z");
    const sunday = all.find((o) => o.id === "weekly@20261011T150000Z");
    expect((saturday?.end ?? 0) - (saturday?.start ?? 0)).toBe(30 * 60_000);
    expect((sunday?.end ?? 0) - (sunday?.start ?? 0)).toBe(2 * 3_600_000);
  });

  it("replace an instance by its override, moved, retitled or cancelled", () => {
    const text = ics(
      SERIES,
      [
        "UID:weekly",
        "RECURRENCE-ID;TZID=America/New_York:20261007T090000",
        "DTSTART;TZID=America/New_York:20261008T140000",
        "DTEND;TZID=America/New_York:20261008T150000",
        "SUMMARY:Sync (moved)",
      ],
      // Google writes RECURRENCE-ID in UTC for a TZID series.
      [
        "UID:weekly",
        "RECURRENCE-ID:20261012T130000Z",
        "STATUS:CANCELLED",
        "DTSTART:20261012T130000Z",
      ],
    );
    const all = list(text);
    expect(all.slice(0, 4)).toEqual([
      "2026-10-05 09:00 Sync",
      "2026-10-08 14:00 Sync (moved)",
      "2026-10-14 09:00 Sync",
      "2026-10-19 09:00 Sync",
    ]);
    const moved = occurrences(model(text, NEW_YORK), at(window[0]), at(window[1]))[1];
    expect(moved).toMatchObject({
      id: "weekly@20261007T130000Z",
      instance: "20261007T130000Z",
      recurring: true,
    });
  });

  it("an override moved into the window shows even when its instance is outside it", () => {
    const text = ics(SERIES, [
      "UID:weekly",
      "RECURRENCE-ID;TZID=America/New_York:20261116T090000",
      "DTSTART;TZID=America/New_York:20261113T090000",
      "SUMMARY:Early",
    ]);
    expect(list(text).at(-1)).toBe("2026-11-13 09:00 Early");
  });

  it("end at UNTIL and COUNT, and an all-day series at a DATE UNTIL", () => {
    expect(
      list(ics([...SERIES.slice(0, 3), "RRULE:FREQ=DAILY;UNTIL=20261007T130000Z", "SUMMARY:D"])),
    ).toEqual(["2026-10-05 09:00 D", "2026-10-06 09:00 D", "2026-10-07 09:00 D"]);
    expect(
      list(ics([...SERIES.slice(0, 3), "RRULE:FREQ=DAILY;COUNT=2", "SUMMARY:C"])),
    ).toHaveLength(2);
    const days = ics([
      "UID:d",
      "DTSTART;VALUE=DATE:20261005",
      "RRULE:FREQ=DAILY;UNTIL=20261006",
      "SUMMARY:A",
    ]);
    expect(list(days)).toEqual(["2026-10-05 all-day A", "2026-10-06 all-day A"]);
  });

  it("a rule that does not parse shows the event once and says why", () => {
    const m = model(
      ics([...SERIES.slice(0, 3), "RRULE:FREQ=WEEKLY;BYDAY=1MO", "SUMMARY:Odd"]),
      NEW_YORK,
    );
    expect(occurrences(m, at(window[0]), at(window[1]))).toHaveLength(1);
    expect(m.problems).toEqual([
      'The repeat rule of "Odd" is not understood (a numbered BYDAY needs FREQ=MONTHLY or YEARLY, not WEEKLY).',
    ]);
  });
});

describe("the calendar", () => {
  it("is named by NAME, then X-WR-CALNAME, then the file", () => {
    expect(model(ics()).name).toBe("Test");
    expect(model(ics().replace("VERSION:2.0", "VERSION:2.0\r\nX-WR-CALNAME:Team")).name).toBe(
      "Team",
    );
    expect(model(ics().replace("VERSION:2.0", "X-WR-CALNAME:Team\r\nNAME:Home")).name).toBe("Home");
  });

  it("says what it could not read: no start, an unknown zone, a shared UID", () => {
    const m = model(
      ics(
        ["UID:a", "SUMMARY:No start"],
        ["UID:b", "DTSTART;TZID=Atlantis/Capital:20261030T090000", "SUMMARY:Lost"],
        ["UID:c", "DTSTART:20261030T000000Z", "SUMMARY:One"],
        ["UID:c", "DTSTART:20261031T000000Z", "SUMMARY:Two"],
      ),
    );
    expect(m.problems).toEqual([
      'The event "No start" has no start time and is not shown.',
      "Two events share the UID c; the second is shown on its own.",
      "The time zone Atlantis/Capital is unknown; its times are read as local times.",
    ]);
    expect(
      labels(
        ics(["UID:b", "DTSTART;TZID=Atlantis/Capital:20261030T090000", "SUMMARY:Lost"]),
        ...WEEK,
      ),
    ).toEqual(["2026-10-30 09:00 Lost"]);
    expect(occurrences(m, at(WEEK[0]), at(WEEK[1])).map((o) => o.title)).toEqual([
      "Lost",
      "One",
      "Two",
    ]);
  });
});
