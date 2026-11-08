// Time zones: IANA through Intl, Windows names, VTIMEZONE rules, and RFC 5545 §3.3.5 for local
// times a change skips or repeats.
import { describe, expect, it } from "vitest";
import { parse } from "../ui/ical/component.js";
import { wallOf } from "../ui/ical/values.js";
import { WINDOWS_ZONES } from "../ui/ical/windows-zones.js";
import { calendarZones, displayZone, ianaZone, UTC, vtimezoneZone } from "../ui/ical/zones.js";

const H = 3_600_000;
const wall = (y: number, m: number, d: number, h = 0, mi = 0) =>
  wallOf({ date: false, y, m, d, h, mi, s: 0, utc: false });

const NY = ianaZone("America/New_York");
if (!NY) throw new Error("the platform lacks America/New_York");

describe("IANA zones", () => {
  it("convert wall times to instants on either side of a change", () => {
    expect(NY.toUtc(wall(2026, 7, 1, 9))).toBe(Date.UTC(2026, 6, 1, 13));
    expect(NY.toUtc(wall(2026, 12, 1, 9))).toBe(Date.UTC(2026, 11, 1, 14));
    expect(NY.offset(Date.UTC(2026, 6, 1))).toBe(-4 * H);
  });

  it("read a skipped local time with the offset before the change (§3.3.5)", () => {
    // 2026-03-08 02:30 does not exist in New York; it is read as 03:30 EDT, 07:30Z.
    expect(NY.toUtc(wall(2026, 3, 8, 2, 30))).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it("read a repeated local time as its first occurrence (§3.3.5)", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT, 05:30Z.
    expect(NY.toUtc(wall(2026, 11, 1, 1, 30))).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it("are undefined for names Intl does not know", () => {
    expect(ianaZone("Mars/Olympus_Mons")).toBeUndefined();
    expect(UTC.toUtc(wall(2026, 1, 1))).toBe(Date.UTC(2026, 0, 1));
  });

  it("the display zone is the setting's, else the platform's", () => {
    expect(displayZone("Asia/Seoul").id).toBe("Asia/Seoul");
    expect(displayZone("Nowhere/Land").id).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

it("every Windows zone name maps to a zone the platform knows", () => {
  const missing = Object.entries(WINDOWS_ZONES).filter(([, iana]) => !ianaZone(iana));
  expect(missing).toEqual([]);
});

/** Outlook writes Windows names with a VTIMEZONE that starts in 1601. */
const OUTLOOK = `BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Pacific Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VTIMEZONE
TZID:Custom Zone
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
X-WR-TIMEZONE:Asia/Tokyo
END:VCALENDAR
`;

describe("calendar zones", () => {
  const calendar = parse(OUTLOOK).calendars[0];
  if (!calendar) throw new Error("no calendar");

  it("a VTIMEZONE's rules give the offsets the tz database gives", () => {
    const vtimezone = calendar.components[1];
    const custom = vtimezone && vtimezoneZone(vtimezone, "Custom Zone");
    const berlin = ianaZone("Europe/Berlin");
    if (!custom || !berlin) throw new Error("no zone");
    for (const month of [1, 3, 4, 7, 10, 11, 12]) {
      for (const year of [1999, 2026, 2031]) {
        const at = Date.UTC(year, month - 1, 28, 12);
        expect(custom.offset(at), `${year}-${month}`).toBe(berlin.offset(at));
      }
    }
    // At the change itself: the last Sunday of March 2026 is the 29th, 01:00Z.
    expect(custom.offset(Date.UTC(2026, 2, 29, 0, 59))).toBe(H);
    expect(custom.offset(Date.UTC(2026, 2, 29, 1, 0))).toBe(2 * H);
    expect(custom.toUtc(wall(2026, 3, 29, 2, 30))).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  it("a Windows name reads as its IANA zone, a prefixed IANA name as itself", () => {
    const zones = calendarZones(calendar, UTC);
    expect(zones.get("Pacific Standard Time").id).toBe("America/Los_Angeles");
    expect(zones.get("/mozilla.org/20050126_1/America/New_York").id).toBe("America/New_York");
    expect(zones.get("Custom Zone").id).toBe("Custom Zone");
    expect(zones.unknown.size).toBe(0);
  });

  it("an unknown TZID reads as floating, in X-WR-TIMEZONE when the calendar names one", () => {
    const zones = calendarZones(calendar, UTC);
    expect(zones.floating.id).toBe("Asia/Tokyo");
    expect(zones.get("Somewhere Else").id).toBe("Asia/Tokyo");
    expect([...zones.unknown]).toEqual(["Somewhere Else"]);
    expect(zones.get(undefined).id).toBe("Asia/Tokyo");
  });
});
