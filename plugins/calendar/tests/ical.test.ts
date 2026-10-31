// Content lines, components and value types (RFC 5545 §3.1-§3.4, RFC 6868).
import { describe, expect, it } from "vitest";
import { formatComponent, parse, setProp, text } from "../ui/ical/component.js";
import {
  escapeText,
  fold,
  formatLine,
  parseLine,
  splitList,
  unescapeText,
  unfold,
} from "../ui/ical/lines.js";
import {
  formatDuration,
  formatOffset,
  formatTime,
  parseDuration,
  parseOffset,
  parseTime,
  rfc3339,
} from "../ui/ical/values.js";

const octets = (line: string) => new TextEncoder().encode(line).length;

describe("content lines", () => {
  it("unfolds CRLF, LF and CR line ends and continuation lines", () => {
    const lines = unfold("BEGIN:VEVENT\r\nSUMMARY:Lo\r\n ng\n\tday\rEND:VEVENT\r\n");
    expect(lines).toEqual([
      { text: "BEGIN:VEVENT", line: 1 },
      { text: "SUMMARY:Longday", line: 2 },
      { text: "END:VEVENT", line: 5 },
    ]);
  });

  it("folds at 75 octets without splitting a UTF-8 character, and unfolds back", () => {
    const line = `DESCRIPTION:${"회의 준비 ".repeat(30)}`;
    const folded = fold(line);
    const physical = folded.split("\r\n").filter(Boolean);
    expect(physical.length).toBeGreaterThan(3);
    for (const part of physical) expect(octets(part)).toBeLessThanOrEqual(75);
    expect(physical.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(unfold(folded)[0]?.text).toBe(line);
    expect(fold("SUMMARY:short")).toBe("SUMMARY:short\r\n");
  });

  it("reads names and parameters, quoted values, lists and RFC 6868 carets", () => {
    expect(
      parseLine(
        'attendee;cn="Doe, Jane";ROLE=REQ-PARTICIPANT;DELEGATED-FROM="mailto:a@x","mailto:b@x";X-NOTE=say ^\'hi^\'^nbye:mailto:jane@example.com',
      ),
    ).toMatchObject({
      name: "ATTENDEE",
      params: {
        CN: ["Doe, Jane"],
        ROLE: ["REQ-PARTICIPANT"],
        "DELEGATED-FROM": ["mailto:a@x", "mailto:b@x"],
        "X-NOTE": ['say "hi"\nbye'],
      },
      value: "mailto:jane@example.com",
    });
    expect(parseLine("DTSTART;TZID=America/New_York:19970902T090000")).toMatchObject({
      params: { TZID: ["America/New_York"] },
      value: "19970902T090000",
    });
    const quoted = { name: "X", params: { P: ['a "b"\nc', "d;e"] }, value: "v" };
    expect(formatLine(quoted)).toBe("X;P=a ^'b^'^nc,\"d;e\":v\r\n");
    expect(parseLine(formatLine(quoted).trimEnd())).toMatchObject(quoted);
    expect(parseLine("no colon here")).toBeUndefined();
    expect(parseLine('X;P="open:value')).toBeUndefined();
  });

  it("escapes and unescapes TEXT, and splits lists on unescaped commas", () => {
    const raw = "Line one\nback\\slash; semi, comma";
    expect(escapeText(raw)).toBe("Line one\\nback\\\\slash\\; semi\\, comma");
    expect(unescapeText(escapeText(raw))).toBe(raw);
    expect(unescapeText("A\\NB")).toBe("A\nB");
    expect(splitList("a\\,b,c,,d")).toEqual(["a\\,b", "c", "", "d"]);
  });
});

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//EN",
  "X-WR-CALNAME:Team",
  "BEGIN:VEVENT",
  "UID:1@example.com",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Asia/Seoul:20261030T100000",
  "SUMMARY:Planning\\, Q4",
  'X-CUSTOM;X-PARAM="a:b":kept as is',
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VTODO",
  "UID:todo@example.com",
  "SUMMARY:Not an event",
  "END:VTODO",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("components", () => {
  it("nest BEGIN and END and keep every property in order", () => {
    const { calendars, problems } = parse(SAMPLE);
    expect(problems).toEqual([]);
    const [calendar] = calendars;
    expect(calendar?.components.map((c) => c.name)).toEqual(["VEVENT", "VTODO"]);
    const event = calendar?.components[0];
    expect(event?.props.map((p) => p.name)).toEqual([
      "UID",
      "DTSTAMP",
      "DTSTART",
      "SUMMARY",
      "X-CUSTOM",
    ]);
    expect(event && text(event, "SUMMARY")).toBe("Planning, Q4");
    expect(event?.components[0]?.name).toBe("VALARM");
  });

  it("write back what they read, byte for byte for a folded CRLF file", () => {
    const { calendars } = parse(SAMPLE);
    expect(calendars.map(formatComponent).join("")).toBe(SAMPLE);
  });

  it("keep a line that does not parse, and say where it was", () => {
    const broken = SAMPLE.replace("SUMMARY:Planning\\, Q4", "this is not a property");
    const { calendars, problems } = parse(broken);
    expect(problems).toEqual([{ line: 9, message: "Line 9 is not a property and is kept as is." }]);
    expect(calendars.map(formatComponent).join("")).toBe(broken);
  });

  it("say what was left open or closed twice, and what lies outside VCALENDAR", () => {
    const { calendars, problems } = parse(
      "X-STRAY:1\nBEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nEND:VALARM\nEND:VCALENDAR\n",
    );
    expect(calendars).toHaveLength(1);
    expect(problems.map((p) => p.message)).toEqual([
      "X-STRAY outside VCALENDAR is ignored.",
      "END:VALARM has no BEGIN.",
      "VEVENT was not closed.",
    ]);
    expect(parse("hello").problems.at(-1)?.message).toBe("The file holds no VCALENDAR.");
    expect(parse("").problems).toEqual([]);
  });

  it("read every VCALENDAR of a stream", () => {
    expect(parse(`${SAMPLE}${SAMPLE}`).calendars).toHaveLength(2);
  });

  it("replace a property where it stood, or add it at the end", () => {
    const event = parse(SAMPLE).calendars[0]?.components[0];
    if (!event) throw new Error("no event");
    setProp(event, "SUMMARY", { name: "SUMMARY", params: {}, value: "Renamed" });
    setProp(event, "LOCATION", { name: "LOCATION", params: {}, value: "Room 1" });
    setProp(event, "X-CUSTOM", undefined);
    expect(event.props.map((p) => p.name)).toEqual([
      "UID",
      "DTSTAMP",
      "DTSTART",
      "SUMMARY",
      "LOCATION",
    ]);
  });
});

describe("value types", () => {
  it("reads DATE and DATE-TIME in UTC, with a TZID, and floating", () => {
    expect(parseTime("20261030")).toEqual({ date: true, y: 2026, m: 10, d: 30 });
    expect(parseTime("20261030T090000Z", "Asia/Seoul")).toEqual({
      date: false,
      y: 2026,
      m: 10,
      d: 30,
      h: 9,
      mi: 0,
      s: 0,
      utc: true,
    });
    expect(parseTime("20261030T090000", "Asia/Seoul")).toMatchObject({
      utc: false,
      tzid: "Asia/Seoul",
    });
    expect(parseTime("20260230")).toBeUndefined();
    expect(parseTime("20261030T250000")).toBeUndefined();
    expect(parseTime("2026-10-30")).toBeUndefined();
    const value = parseTime("19970714T133000Z");
    expect(value && formatTime(value)).toBe("19970714T133000Z");
  });

  it("reads and writes durations", () => {
    expect(parseDuration("P15DT5H0M20S")).toEqual({
      sign: 1,
      weeks: 0,
      days: 15,
      hours: 5,
      minutes: 0,
      seconds: 20,
    });
    expect(parseDuration("-PT15M")).toMatchObject({ sign: -1, minutes: 15 });
    expect(parseDuration("P7W")).toMatchObject({ weeks: 7 });
    for (const bad of ["P", "PT", "15M", "P1H"]) expect(parseDuration(bad)).toBeUndefined();
    for (const text of ["P2W", "-PT15M", "P1DT2H", "PT0S", "PT1H30M"])
      expect(formatDuration(parseDuration(text) as never)).toBe(text);
  });

  it("reads and writes UTC offsets and RFC 3339 times", () => {
    expect(parseOffset("+0530")).toBe(19_800_000);
    expect(parseOffset("-080000")).toBe(-28_800_000);
    expect(parseOffset("0800")).toBeUndefined();
    expect(formatOffset(-18_000_000)).toBe("-0500");
    expect(formatOffset(0)).toBe("+0000");
    const utc = Date.UTC(2026, 9, 30, 0, 0, 0);
    expect(rfc3339(utc, 9 * 3_600_000)).toBe("2026-10-30T09:00:00+09:00");
    expect(rfc3339(utc, 0)).toBe("2026-10-30T00:00:00Z");
    expect(rfc3339(utc, -5.5 * 3_600_000)).toBe("2026-10-29T18:30:00-05:30");
  });
});
