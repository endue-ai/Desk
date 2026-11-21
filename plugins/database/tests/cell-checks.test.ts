// Typed cell editors (PG-40, #467): what each kind of editor takes and what it refuses, with the
// reason, before the value becomes a pending change. Accepted text becomes the value as the server
// writes it where the editor can tell (t and f for booleans), and stays as typed otherwise.
import { describe, expect, it } from "vitest";
import { formatJson, sameJson } from "../ui/cell-editors/json-text.js";
import { formatArray, parseArray } from "../ui/cell-editors/pg-array.js";
import { editorOf } from "../ui/cell-editors/resolve.js";
import { checkValue } from "../ui/cell-editors/values.js";

const pg = (type: string, labels?: string[]) => {
  const made = editorOf(
    "postgresql",
    { name: "c", type, nullable: true, default: null },
    undefined,
  );
  return labels ? { ...made, labels } : made;
};
const value = (type: string, text: string) => {
  const done = checkValue(pg(type), text);
  if ("error" in done) throw new Error(`${type} refused ${text}: ${done.error}`);
  return done.value;
};
const refusal = (type: string, text: string, labels?: string[]) => {
  const done = checkValue(pg(type, labels), text);
  return "error" in done ? done.error : `accepted as ${done.value}`;
};

describe("refuses what the column's type refuses, with a reason", () => {
  it("booleans: PostgreSQL's words for true and false, written as t and f", () => {
    for (const yes of ["t", "true", "TRUE", " yes", "on", "1", "y"])
      expect(value("boolean", yes)).toBe("t");
    for (const no of ["f", "false", "No", "off", "0", "n"]) expect(value("boolean", no)).toBe("f");
    expect(refusal("boolean", "maybe")).toMatch(/true or false/u);
  });

  it("enums: one of the labels, exactly", () => {
    const labels = ["sad", "ok", "so so"];
    expect(checkValue(pg("mood", labels), "so so")).toEqual({ value: "so so" });
    expect(refusal("mood", "OK", labels)).toMatch(/one of sad, ok, so so/u);
  });

  it("numbers: whole numbers in the type's range, decimals as PostgreSQL reads them", () => {
    expect(value("integer", " 42 ")).toBe("42");
    expect(value("bigint", "-9223372036854775808")).toBe("-9223372036854775808");
    expect(refusal("bigint", "9223372036854775808")).toMatch(
      /-9223372036854775808 to 9223372036854775807/u,
    );
    expect(refusal("smallint", "40000")).toMatch(/-32768 to 32767/u);
    expect(refusal("integer", "1.5")).toMatch(/whole number/u);
    expect(refusal("integer", "abc")).toMatch(/whole number/u);
    for (const ok of ["1.5", "-.5", "2.", "1e10", "+3", "NaN", "Infinity", "-infinity"])
      expect(value("numeric(8,2)", ok)).toBe(ok);
    expect(refusal("double precision", "1,5")).toMatch(/not a number/u);
  });

  it("dates: ISO days that exist, and PostgreSQL's special words", () => {
    for (const ok of [
      "2026-11-21",
      "2024-02-29",
      "0044-03-15 BC",
      "infinity",
      "-infinity",
      "today",
    ])
      expect(value("date", ok)).toBe(ok);
    expect(refusal("date", "2025-02-29")).toMatch(/February 2025 has 28 days/u);
    expect(refusal("date", "2026-13-01")).toMatch(/month/u);
    expect(refusal("date", "21/11/2026")).toMatch(/YYYY-MM-DD/u);
  });

  it("times: hours, minutes and seconds, with an offset only where the type keeps one", () => {
    for (const ok of ["10:00", "10:00:00", "23:59:59.999999", "24:00:00", "allballs"])
      expect(value("time without time zone", ok)).toBe(ok);
    expect(value("time with time zone", "10:00:00+09")).toBe("10:00:00+09");
    expect(value("time with time zone", "10:00:00-03:30")).toBe("10:00:00-03:30");
    expect(refusal("time without time zone", "25:00")).toMatch(/hour/u);
    expect(refusal("time without time zone", "10:61")).toMatch(/minute/u);
    expect(refusal("time without time zone", "10:00+09")).toMatch(/keeps no offset/u);
    expect(refusal("time without time zone", "ten")).toMatch(/HH:MM/u);
  });

  it("timestamps: a day and a time, the zone where the type keeps it", () => {
    expect(value("timestamp without time zone", "2026-11-21 10:00:00")).toBe("2026-11-21 10:00:00");
    expect(value("timestamp without time zone", "2026-11-21T10:00")).toBe("2026-11-21T10:00");
    expect(value("timestamp without time zone", "2026-11-21")).toBe("2026-11-21");
    expect(value("timestamp with time zone", "2026-11-21 10:00:00.5+09")).toBe(
      "2026-11-21 10:00:00.5+09",
    );
    expect(value("timestamp with time zone", "2026-11-21 10:00:00Z")).toBe("2026-11-21 10:00:00Z");
    expect(value("timestamp with time zone", "2026-11-21 10:00 Asia/Seoul")).toBe(
      "2026-11-21 10:00 Asia/Seoul",
    );
    expect(value("timestamp with time zone", "now")).toBe("now");
    expect(refusal("timestamp without time zone", "2026-11-21 10:00+09")).toMatch(
      /keeps no offset/u,
    );
    expect(refusal("timestamp with time zone", "2026-04-31 10:00")).toMatch(
      /April 2026 has 30 days/u,
    );
    expect(refusal("timestamp with time zone", "yesterday-ish")).toMatch(/YYYY-MM-DD HH:MM/u);
  });

  it("intervals: PostgreSQL's units, a time, and the ISO 8601 form", () => {
    for (const ok of [
      "1 day 02:00:00",
      "3 hours",
      "-1 day +02:03:04",
      "1 year 2 mons",
      "@ 1 minute ago",
      "1.5 weeks",
      "02:00",
      "P1Y2M3DT4H5M6S",
      "PT0.5S",
    ])
      expect(value("interval", ok)).toBe(ok);
    expect(refusal("interval", "3 fortnights")).toMatch(/fortnights/u);
    expect(refusal("interval", "P1X")).toMatch(/interval/u);
    expect(refusal("interval", "")).toMatch(/interval/u);
  });

  it("JSON: strict JSON, with the line and column of what is wrong", () => {
    expect(value("jsonb", ' {"a": [1, 2.0, 12345678901234567890]} ')).toBe(
      '{"a": [1, 2.0, 12345678901234567890]}',
    );
    expect(value("json", '"text"')).toBe('"text"');
    expect(refusal("json", '{"a": }')).toMatch(/line 1, column 7/u);
    expect(refusal("json", '{\n  "a": 1,\n}')).toMatch(/line 3, column 1/u);
    expect(refusal("json", "{'a': 1}")).toMatch(/line 1, column 2/u);
    expect(refusal("json", "[1] 2")).toMatch(/after the value/u);
  });

  it("lays JSON out by its tokens, never through JavaScript numbers", () => {
    expect(formatJson('{"a":[1,2.0,{"b":12345678901234567890}],"c":{},"d":[]}')).toBe(
      '{\n  "a": [\n    1,\n    2.0,\n    {\n      "b": 12345678901234567890\n    }\n  ],\n  "c": {},\n  "d": []\n}',
    );
    expect(sameJson('{"a": 1}', '{\n  "a": 1\n}')).toBe(true);
    expect(sameJson('{"a": 1}', '{"a": 1.0}')).toBe(false);
  });

  it("arrays: elements by the element's type, written back as PostgreSQL's array text", () => {
    expect(parseArray('{1,"b c",NULL,"NULL","q\\"x",""}')).toEqual({
      elements: ["1", "b c", null, "NULL", 'q"x', ""],
    });
    expect(parseArray("{{1,2},{3,4}}")).toEqual({ nested: true });
    expect(parseArray("{}")).toEqual({ elements: [] });
    expect(formatArray(["1", "b c", null, "NULL", 'q"x', "", "a,b", "\\"])).toBe(
      '{1,"b c",NULL,"NULL","q\\"x","","a,b","\\\\"}',
    );
    expect(value("integer[]", "{1, 2,3}")).toBe("{1,2,3}");
    expect(refusal("integer[]", "{1,x}")).toMatch(/element 2: .*whole number/u);
    expect(refusal("integer[]", "{1,2")).toMatch(/\{ and \}/u);
    expect(value("integer[]", "{{1,2},{3,4}}")).toBe("{{1,2},{3,4}}");
    expect(refusal("integer[]", "{{1,2},{3,4}")).toMatch(/braces/u);
    expect(value("text[]", '{"a b",c}')).toBe('{"a b",c}');
  });

  it("bytes: \\x and two hex digits a byte", () => {
    expect(value("bytea", "\\x0102FF")).toBe("\\x0102ff");
    expect(value("bytea", "\\x")).toBe("\\x");
    expect(refusal("bytea", "\\x012")).toMatch(/two hex digits a byte/u);
    expect(refusal("bytea", "hello")).toMatch(/\\x/u);
  });

  it("UUIDs: the forms PostgreSQL reads", () => {
    for (const ok of [
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11",
      "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}",
      "a0eebc999c0b4ef8bb6d6bb9bd380a11",
      "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11",
    ])
      expect(value("uuid", ok)).toBe(ok);
    expect(refusal("uuid", "a0eebc99-9c0b-4ef8-bb6d")).toMatch(/32 hex digits/u);
  });

  it("text takes anything", () => {
    expect(value("text", "  anything, even 'quotes'  ")).toBe("  anything, even 'quotes'  ");
  });
});
