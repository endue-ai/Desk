import { describe, expect, it } from "vitest";
import { children, parse, prop, props, serialize, text } from "../ui/ical/component.js";
import { escapeText, fold, formatLine, parseLine, unescapeText, unfold } from "../ui/ical/lines.js";
import {
  formatTime,
  isZone,
  offsetAt,
  parseDuration,
  parseOffset,
  parseTime,
  resolveZone,
  rfc3339,
  toUtc,
  toWall,
  wallOf,
  whenOf,
} from "../ui/ical/values.js";

const H = 3_600_000;

describe("content lines (RFC 5545 §3.1)", () => {
  it("unfolds continuation lines whatever the line ends, and drops a byte order mark", () => {
    expect(unfold("﻿A:1\r\n b\n\tc\rD:2\r\n\r\nE:3")).toEqual(["A:1bc", "D:2", "E:3"]);
  });

  it("folds at 75 octets without cutting a UTF-8 sequence, and reads back the same", () => {
    const long = `DESCRIPTION:${"가".repeat(60)}`;
    const folded = fold(long);
    for (const physical of folded.split("\r\n").filter(Boolean))
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toEqual([long]);
    expect(fold("SHORT:x")).toBe("SHORT:x\r\n");
  });

  it("parses names, parameters (quoted, lists, RFC 6868) and keeps the value as written", () => {
    const line = parseLine(
      'ATTENDEE;cn="Park, Jun";ROLE=CHAIR;MEMBER="mailto:a@x.io","mailto:b@x.io";X-NOTE=line^none:mailto:jun@x.io',
    );
    expect(line).toEqual({
      name: "ATTENDEE",
      params: {
        CN: ["Park, Jun"],
        ROLE: ["CHAIR"],
        MEMBER: ["mailto:a@x.io", "mailto:b@x.io"],
        "X-NOTE": ["line\none"],
      },
      value: "mailto:jun@x.io",
    });
    expect(parseLine("no colon here")).toBeUndefined();
    expect(parseLine("X;BROKEN:v")).toBeUndefined();
    expect(parseLine(":v")).toBeUndefined();
  });

  it("writes a property back, quoting what must be quoted", () => {
    const line = formatLine({
      name: "ATTENDEE",
      params: { CN: ["Park, Jun"], RSVP: ["TRUE"] },
      value: "mailto:j@x.io",
    });
    expect(line).toBe('ATTENDEE;CN="Park, Jun";RSVP=TRUE:mailto:j@x.io\r\n');
    expect(parseLine(line.trim())?.params.CN).toEqual(["Park, Jun"]);
  });

  it("escapes and unescapes TEXT", () => {
    const BS = "\\";
    expect(unescapeText(`a${BS}, b${BS}; c${BS}${BS} d${BS}nE${BS}Nf`)).toBe(
      `a, b; c${BS} d\nE\nf`,
    );
    expect(escapeText(`a, b; c${BS} d\r\ne`)).toBe(`a${BS}, b${BS}; c${BS}${BS} d${BS}ne`);
    expect(unescapeText(escapeText(`x;y,z${BS}\nw`))).toBe(`x;y,z${BS}\nw`);
  });
});

describe("components", () => {
  const ICS = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:1",
    "SUMMARY:Hello\\, world",
    "this line is garbage",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "X-OUTSIDE:1",
  ].join("\r\n");

  it("parses a tree, keeps reading past a bad line, and names the problems", () => {
    const { calendars, problems } = parse(ICS);
    expect(calendars).toHaveLength(1);
    const [event] = children(calendars[0] as never, "VEVENT");
    expect(prop(event as never, "UID")?.value).toBe("1");
    expect(text(event as never, "SUMMARY")).toBe("Hello, world");
    expect(children(event as never, "VALARM")).toHaveLength(1);
    expect(problems.map((p) => p.message)).toEqual([
      "Line 6 is not a property.",
      "Line 12 is outside a component.",
    ]);
    expect(parse("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:2").problems.map((p) => p.message)).toEqual([
      "VCALENDAR is never ended.",
      "VEVENT is never ended.",
    ]);
    expect(parse("BEGIN:VEVENT\nEND:VEVENT").problems[0]?.message).toBe(
      "VEVENT is outside a VCALENDAR.",
    );
    expect(parse("BEGIN:VCALENDAR\nEND:VEVENT\nEND:VCALENDAR").problems[0]?.message).toBe(
      "END:VEVENT closes nothing.",
    );
  });

  it("serializes with CRLF and reads back to the same tree", () => {
    const { calendars } = parse(ICS.replace("this line is garbage\r\n", ""));
    const out = serialize(calendars[0] as never);
    expect(out.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(parse(out).calendars).toEqual(calendars);
    expect(props(calendars[0] as never, "VERSION")).toHaveLength(1);
  });
});

describe("values (RFC 5545 §3.3)", () => {
  it("parses DATE and DATE-TIME, refuses nonsense, and formats back", () => {
    expect(parseTime("20261103")).toEqual({ date: true, y: 2026, m: 11, d: 3 });
    expect(parseTime("20261103T160000", "Asia/Seoul")).toEqual({
      date: false,
      y: 2026,
      m: 11,
      d: 3,
      h: 16,
      mi: 0,
      s: 0,
      utc: false,
      tzid: "Asia/Seoul",
    });
    expect(parseTime("20261103T070000Z", "Asia/Seoul")).toMatchObject({ utc: true });
    expect(parseTime("20261103T070000Z")?.date).toBe(false);
    expect(parseTime("20261301")).toBeUndefined();
    expect(parseTime("20260230")).toBeUndefined();
    expect(parseTime("20261103T250000")).toBeUndefined();
    expect(parseTime("20261103T235960")).toMatchObject({ s: 59 });
    for (const v of ["20261103", "20261103T160000", "20261103T070000Z"])
      expect(formatTime(parseTime(v) as never)).toBe(v);
    expect(wallOf({ date: true, y: 1970, m: 1, d: 2 })).toBe(86_400_000);
  });

  it("parses DURATION and UTC-OFFSET", () => {
    expect(parseDuration("P1DT2H30M")).toBe(26.5 * H);
    expect(parseDuration("-PT15M")).toBe(-15 * 60_000);
    expect(parseDuration("P2W")).toBe(14 * 24 * H);
    expect(parseDuration("PT")).toBeUndefined();
    expect(parseDuration("1H")).toBeUndefined();
    expect(parseOffset("+0900")).toBe(9 * H);
    expect(parseOffset("-0530")).toBe(-5.5 * H);
    expect(parseOffset("+003000")).toBe(30 * 60_000);
    expect(parseOffset("0900")).toBeUndefined();
  });

  it("knows zones through Intl: offsets with daylight saving, gaps and overlaps", () => {
    expect(isZone("Asia/Seoul")).toBe(true);
    expect(isZone("Mars/Olympus")).toBe(false);
    const summer = Date.UTC(2026, 6, 1, 12);
    const winter = Date.UTC(2026, 0, 1, 12);
    expect(offsetAt("Europe/Berlin", summer)).toBe(2 * H);
    expect(offsetAt("Europe/Berlin", winter)).toBe(H);
    expect(offsetAt("Asia/Seoul", summer)).toBe(9 * H);
    // 16:00 in Seoul on 3 Nov 2026 is 07:00Z.
    const wall = wallOf({ date: false, y: 2026, m: 11, d: 3, h: 16, mi: 0, s: 0, utc: false });
    expect(toUtc(wall, "Asia/Seoul")).toBe(Date.UTC(2026, 10, 3, 7));
    expect(toWall(Date.UTC(2026, 10, 3, 7), "Asia/Seoul")).toBe(wall);
    // 02:30 on 29 March 2026 does not exist in Berlin: it is read after the gap, as 03:30 CEST.
    const gap = wallOf({ date: false, y: 2026, m: 3, d: 29, h: 2, mi: 30, s: 0, utc: false });
    expect(toUtc(gap, "Europe/Berlin")).toBe(Date.UTC(2026, 2, 29, 1, 30));
    // 02:30 on 25 October 2026 happens twice in Berlin: the earlier one (CEST) wins.
    const twice = wallOf({ date: false, y: 2026, m: 10, d: 25, h: 2, mi: 30, s: 0, utc: false });
    expect(toUtc(twice, "Europe/Berlin")).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it("resolves a TZID: IANA, an Olson path's tail, X-LIC-LOCATION, else a VTIMEZONE's standard offset", () => {
    expect(resolveZone("Europe/Berlin")).toEqual({ tz: "Europe/Berlin", approximate: false });
    expect(resolveZone("/mozilla.org/20050126_1/Europe/Berlin")).toEqual({
      tz: "Europe/Berlin",
      approximate: false,
    });
    expect(
      resolveZone("Romance Standard Time", [
        { tzid: "Romance Standard Time", location: "Europe/Paris" },
      ]),
    ).toEqual({
      tz: "Europe/Paris",
      approximate: false,
    });
    expect(resolveZone("Custom", [{ tzid: "Custom", standardOffset: -5 * H }])).toEqual({
      offset: -5 * H,
      approximate: true,
    });
    expect(resolveZone("Nowhere")).toBeUndefined();
  });

  it("places a value in time: a date, UTC, a zone, an approximate zone, a floating time", () => {
    const zoneOf = (tzid: string) =>
      resolveZone(tzid, [{ tzid: "Custom", standardOffset: -5 * H }]);
    const date = whenOf(parseTime("20261103") as never, zoneOf, "Asia/Seoul");
    expect(date).toMatchObject({ allDay: true, floating: false });
    expect(date.utc).toBeUndefined();
    const utc = whenOf(parseTime("20261103T070000Z") as never, zoneOf, "Asia/Seoul");
    expect(utc).toMatchObject({ utc: Date.UTC(2026, 10, 3, 7), zone: "UTC" });
    const seoul = whenOf(
      parseTime("20261103T160000", "Asia/Seoul") as never,
      zoneOf,
      "Europe/Berlin",
    );
    expect(seoul).toMatchObject({
      utc: Date.UTC(2026, 10, 3, 7),
      zone: "Asia/Seoul",
      approximate: false,
    });
    const custom = whenOf(parseTime("20261103T160000", "Custom") as never, zoneOf, "Europe/Berlin");
    expect(custom).toMatchObject({
      utc: Date.UTC(2026, 10, 3, 21),
      zone: "Custom",
      approximate: true,
    });
    const floating = whenOf(parseTime("20261103T160000") as never, zoneOf, "Asia/Seoul");
    expect(floating).toMatchObject({
      utc: Date.UTC(2026, 10, 3, 7),
      zone: "Asia/Seoul",
      floating: true,
    });
  });

  it("writes RFC 3339 with an offset", () => {
    expect(rfc3339(Date.UTC(2026, 10, 3, 7), 9 * H)).toBe("2026-11-03T16:00:00+09:00");
    expect(rfc3339(Date.UTC(2026, 10, 3, 7), 0)).toBe("2026-11-03T07:00:00Z");
    expect(rfc3339(Date.UTC(2026, 10, 3, 7), -5.5 * H)).toBe("2026-11-03T01:30:00-05:30");
  });
});
