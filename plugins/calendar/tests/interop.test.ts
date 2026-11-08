// Files as Google Calendar, Outlook (Exchange) and Apple Calendar export them: each is read as those
// apps show it, written back byte for byte, and an edit to one event changes only what was edited.
import { describe, expect, it } from "vitest";
import { fieldsOf, updateEvent } from "../ui/calendar/edit.js";
import { buildModel, occurrences } from "../ui/calendar/model.js";
import { reminderOf } from "../ui/calendar/write.js";
import { formatComponent, parse } from "../ui/ical/component.js";
import { fold } from "../ui/ical/lines.js";
import { at, label, SEOUL } from "./fixtures";

/** Lines folded as RFC 5545 folds them, with CRLF. */
const file = (...lines: string[]) => lines.map(fold).join("");

const GOOGLE = file(
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Team",
  "X-WR-TIMEZONE:Asia/Seoul",
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Seoul",
  "X-LIC-LOCATION:Asia/Seoul",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0900",
  "TZOFFSETTO:+0900",
  "TZNAME:KST",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Asia/Seoul:20261026T100000",
  "DTEND;TZID=Asia/Seoul:20261026T103000",
  "RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE",
  "EXDATE;TZID=Asia/Seoul:20261028T100000",
  "DTSTAMP:20261030T000000Z",
  "UID:7kukuqrfedlm2f9t0vr42q9qgd@google.com",
  "CREATED:20261001T000000Z",
  "DESCRIPTION:Weekly sync.\\nJoin: https://meet.google.com/abc-defg-hij",
  "LAST-MODIFIED:20261020T000000Z",
  "LOCATION:",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Team sync",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261104T020000Z",
  "DTEND:20261104T023000Z",
  "DTSTAMP:20261030T000000Z",
  "UID:7kukuqrfedlm2f9t0vr42q9qgd@google.com",
  "RECURRENCE-ID;TZID=Asia/Seoul:20261104T100000",
  "SEQUENCE:1",
  "SUMMARY:Team sync (at 11)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261109",
  "DTEND;VALUE=DATE:20261110",
  "DTSTAMP:20261030T000000Z",
  "UID:20261109_holiday@google.com",
  "SUMMARY:Holiday",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "END:VCALENDAR",
);

const OUTLOOK = file(
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "X-WR-CALNAME:Calendar",
  "BEGIN:VTIMEZONE",
  "TZID:Pacific Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DESCRIPTION:\\n",
  "RRULE:FREQ=MONTHLY;UNTIL=20270101T000000Z;INTERVAL=1;BYDAY=2TU",
  "UID:040000008200E00074C5B7101A82E00800000000B0C2E2A3B54ADA01000000000000000010000000D7E4F5A1B2C3D4E5F60718293A4B5C6D",
  "SUMMARY;LANGUAGE=en-US:Board meeting",
  "DTSTART;TZID=Pacific Standard Time:20261013T090000",
  "DTEND;TZID=Pacific Standard Time:20261013T100000",
  "CLASS:PUBLIC",
  "PRIORITY:5",
  "DTSTAMP:20261030T000000Z",
  "TRANSP:OPAQUE",
  "STATUS:CONFIRMED",
  "SEQUENCE:0",
  "LOCATION;LANGUAGE=en-US:Board room",
  "X-MICROSOFT-CDO-APPT-SEQUENCE:0",
  "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
  "X-MICROSOFT-CDO-ALLDAYEVENT:FALSE",
  "X-MICROSOFT-CDO-INSTTYPE:1",
  "BEGIN:VALARM",
  "DESCRIPTION:REMINDER",
  "TRIGGER;RELATED=START:-PT15M",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
);

const APPLE = file(
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 15.0//EN",
  "CALSCALE:GREGORIAN",
  "X-WR-CALNAME:Home",
  "X-APPLE-CALENDAR-COLOR:#34AADC",
  "BEGIN:VEVENT",
  "CREATED:20261001T080000Z",
  "DTEND;TZID=Europe/Berlin:20261101T130000",
  "DTSTAMP:20261001T080000Z",
  "DTSTART;TZID=Europe/Berlin:20261101T120000",
  "LAST-MODIFIED:20261001T080000Z",
  "LOCATION:Café Einstein\\nUnter den Linden 42",
  "SEQUENCE:0",
  "SUMMARY:Brunch 🥐 mit Freunden aus der Schulzeit und ihren Familien am Sonntag",
  "UID:5F0E6B2C-1C0A-4E7A-9D1B-6B3C2F9E1A11",
  'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Unter den Linden 42, Berlin";X-TITLE="Café Einstein":geo:52.517,13.389',
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:Reminder",
  "TRIGGER:-PT30M",
  "UID:1E2D3C4B-0000-4000-8000-000000000001",
  "X-WR-ALARMUID:1E2D3C4B-0000-4000-8000-000000000001",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:19900315",
  "DTEND;VALUE=DATE:19900316",
  "RRULE:FREQ=YEARLY",
  "DTSTAMP:20261001T080000Z",
  "UID:birthday-mina@example.com",
  "SUMMARY:Mina's birthday",
  "END:VEVENT",
  "END:VCALENDAR",
);

const read = (text: string) => buildModel(parse(text), SEOUL, "file");
const shown = (text: string, from: string, to: string) =>
  occurrences(read(text), at(from), at(to)).map(label);
const write = (doc: ReturnType<typeof parse>) => doc.calendars.map(formatComponent).join("");
const context = { now: at("2026-10-31T00:00:00Z"), uid: () => "new@endue.ai", display: SEOUL };

/** Retitle the first occurrence of an id and say which physical lines it added and removed. */
function retitle(text: string, id: string, title: string) {
  const doc = parse(text);
  const occ = occurrences(
    buildModel(doc, SEOUL, "file"),
    at("2026-10-01T00:00:00Z"),
    at("2027-12-31T00:00:00Z"),
  ).find((o) => o.id === id);
  if (!occ) throw new Error(`no ${id}`);
  const fields = fieldsOf(occ, SEOUL);
  const out = write(updateEvent(doc, occ, { ...fields, title }, "all", context));
  // Lines as multisets: two events may share a line (the same DTSTAMP).
  const count = (lines: string[]) => {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const before = count(text.split("\r\n"));
  const after = count(out.split("\r\n"));
  const minus = (a: Map<string, number>, b: Map<string, number>) =>
    [...a].flatMap(
      ([line, n]) => Array(Math.max(0, n - (b.get(line) ?? 0))).fill(line) as string[],
    );
  return { added: minus(after, before), removed: minus(before, after) };
}

describe.each([
  ["Google", GOOGLE],
  ["Outlook", OUTLOOK],
  ["Apple", APPLE],
])("%s", (_, text) => {
  it("reads without problems and writes back byte for byte", () => {
    const doc = parse(text);
    expect(doc.problems).toEqual([]);
    expect(read(text).problems).toEqual([]);
    expect(write(doc)).toBe(text);
  });
});

describe("what each app's file shows", () => {
  it("Google: a weekly series with an EXDATE and a moved instance, and a free holiday", () => {
    expect(shown(GOOGLE, "2026-10-26T00:00:00+09:00", "2026-11-10T00:00:00+09:00")).toEqual([
      "2026-10-26 10:00 Team sync",
      "2026-11-02 10:00 Team sync",
      "2026-11-04 11:00 Team sync (at 11)",
      "2026-11-09 all-day Holiday",
      "2026-11-09 10:00 Team sync",
    ]);
    const model = read(GOOGLE);
    expect(model.name).toBe("Team");
    const [first] = occurrences(
      model,
      at("2026-10-26T00:00:00+09:00"),
      at("2026-10-27T00:00:00+09:00"),
    );
    expect(first && reminderOf(first.event.component)).toBe(10);
  });

  it("Outlook: a Windows zone name, the second Tuesday, until the end of 2026", () => {
    expect(shown(OUTLOOK, "2026-10-01T00:00:00Z", "2027-03-01T00:00:00Z")).toEqual([
      "2026-10-14 01:00 Board meeting",
      "2026-11-11 02:00 Board meeting",
      "2026-12-09 02:00 Board meeting",
    ]);
  });

  it("Apple: a zone without VTIMEZONE, a long folded title, a yearly birthday since 1990", () => {
    const model = read(APPLE);
    expect(model).toMatchObject({ name: "Home", color: "#34AADC" });
    expect(shown(APPLE, "2026-11-01T00:00:00+09:00", "2026-11-02T00:00:00+09:00")).toEqual([
      "2026-11-01 20:00 Brunch 🥐 mit Freunden aus der Schulzeit und ihren Familien am Sonntag",
    ]);
    expect(shown(APPLE, "2027-03-15T00:00:00+09:00", "2027-03-16T00:00:00+09:00")).toEqual([
      "2027-03-15 all-day Mina's birthday",
    ]);
  });
});

describe("an edit changes only what was edited", () => {
  it("Outlook: the title, the stamps and nothing else; the Windows TZID stays", () => {
    const id =
      "040000008200E00074C5B7101A82E00800000000B0C2E2A3B54ADA01000000000000000010000000D7E4F5A1B2C3D4E5F60718293A4B5C6D@20261013T160000Z";
    const { added, removed } = retitle(OUTLOOK, id, "Board meeting (Q4)");
    expect(removed).toEqual(["SUMMARY;LANGUAGE=en-US:Board meeting", "DTSTAMP:20261030T000000Z"]);
    expect(added).toEqual([
      "SUMMARY:Board meeting (Q4)",
      "DTSTAMP:20261031T000000Z",
      "LAST-MODIFIED:20261031T000000Z",
    ]);
  });

  it("Apple: the alarm with its UID, the structured location and the emoji stay", () => {
    const { added, removed } = retitle(APPLE, "5F0E6B2C-1C0A-4E7A-9D1B-6B3C2F9E1A11", "Brunch");
    expect(removed.filter((l) => !l.startsWith(" "))).toEqual([
      "DTSTAMP:20261001T080000Z",
      "LAST-MODIFIED:20261001T080000Z",
      expect.stringMatching(/^SUMMARY:Brunch 🥐/),
    ]);
    // The file named Europe/Berlin without defining it; RFC 5545 §3.6.5 asks for a VTIMEZONE.
    const zone = added.slice(added.indexOf("BEGIN:VTIMEZONE"), added.indexOf("END:VTIMEZONE") + 1);
    expect(zone.slice(0, 2)).toEqual(["BEGIN:VTIMEZONE", "TZID:Europe/Berlin"]);
    expect(added.filter((l) => !zone.includes(l))).toEqual([
      "DTSTAMP:20261031T000000Z",
      "LAST-MODIFIED:20261031T000000Z",
      "SUMMARY:Brunch",
    ]);
  });
});
