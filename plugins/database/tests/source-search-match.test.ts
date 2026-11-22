// PG-82: the source search's matcher (ui/features/source-search/match.js), the part that runs in a
// worker for big texts: a text or a regular expression found line by line, with each line's number,
// its text and the ranges that matched, ignoring case only when asked, and matches inside SQL
// comments left out unless comments are searched.
import { describe, expect, it } from "vitest";
import {
  commentRanges,
  LINE_CAP,
  linesOf,
  matchTexts,
  testOf,
} from "../ui/features/source-search/match.js";

const BODY = [
  "CREATE FUNCTION f(customer integer) RETURNS int",
  "AS $$",
  "  -- the customer's total",
  "  SELECT 1 /* customer, /* nested */ still */ WHERE x = 'no -- customer comment here'",
  "  AND Customer = $1",
  "$$;",
].join("\n");

describe("the source search's matcher", () => {
  it("finds the lines of a text or a regular expression", () => {
    const found = linesOf(
      "one\ncustomer_id = 2\nCUSTOMER\nno",
      testOf({ text: "customer", regex: false, ignoreCase: false }),
      {
        comments: true,
      },
    );
    expect(found).toEqual({
      count: 1,
      lines: [{ line: 2, text: "customer_id = 2", ranges: [[0, 8]] }],
    });
    const any = linesOf("a.b\naxb", testOf({ text: "a.b", regex: false, ignoreCase: true }), {
      comments: true,
    });
    expect(any?.lines.map((l) => l.line)).toEqual([1]);
    const cased = linesOf(
      "x Customer y customer",
      testOf({ text: "customer", regex: false, ignoreCase: true }),
      {
        comments: true,
      },
    );
    expect(cased?.lines[0]?.ranges).toEqual([
      [2, 10],
      [13, 21],
    ]);
    const re = linesOf(
      "total_1\ntotal\ntotal_22",
      testOf({ text: "total_\\d+$", regex: true, ignoreCase: false }),
      {
        comments: true,
      },
    );
    expect(re?.lines.map((l) => [l.line, l.ranges])).toEqual([
      [1, [[0, 7]]],
      [3, [[0, 8]]],
    ]);
    expect(
      linesOf("nothing", testOf({ text: "x", regex: false, ignoreCase: false }), {
        comments: true,
      }),
    ).toBeNull();
    expect(() => testOf({ text: "(", regex: true, ignoreCase: false })).toThrow(
      /^Not a regular expression: /u,
    );
    expect(() => testOf({ text: "", regex: false, ignoreCase: false })).toThrow(
      "Type the text to find first.",
    );
    // An empty match never loops nor counts.
    expect(
      linesOf("abc", testOf({ text: "x*", regex: true, ignoreCase: false }), { comments: true }),
    ).toBeNull();
  });

  it("cuts a long line around its first match and caps the lines kept", () => {
    const long = `${"a".repeat(500)}customer${"b".repeat(500)}`;
    const found = linesOf(long, testOf({ text: "customer", regex: false, ignoreCase: false }), {
      comments: true,
    });
    const line = found?.lines[0];
    expect(line?.text.length).toBeLessThan(260);
    expect(line?.text.startsWith("…")).toBe(true);
    const [from, to] = line?.ranges[0] ?? [0, 0];
    expect(line?.text.slice(from, to)).toBe("customer");
    const many = Array.from({ length: LINE_CAP + 10 }, () => "customer").join("\n");
    const capped = linesOf(many, testOf({ text: "customer", regex: false, ignoreCase: false }), {
      comments: true,
    });
    expect(capped?.count).toBe(LINE_CAP + 10);
    expect(capped?.lines).toHaveLength(LINE_CAP);
  });

  it("leaves out matches in SQL comments unless comments are searched", () => {
    const ranges = commentRanges(BODY);
    const said = ranges.map(([a, b]) => BODY.slice(a, b));
    expect(said).toEqual(["-- the customer's total", "/* customer, /* nested */ still */"]);
    const test = testOf({ text: "customer", regex: false, ignoreCase: true });
    expect(linesOf(BODY, test, { comments: false })?.lines.map((l) => l.line)).toEqual([1, 4, 5]);
    // Line 4 still matches inside its string, not in its comment.
    expect(linesOf(BODY, test, { comments: false })?.lines[1]?.ranges).toHaveLength(1);
    expect(linesOf(BODY, test, { comments: true })?.lines.map((l) => l.line)).toEqual([1, 3, 4, 5]);
    expect(linesOf(BODY, test, { comments: true })?.lines[2]?.ranges).toHaveLength(2);
  });

  it("matches many texts at once, as the worker does", () => {
    const query = { text: "customer", regex: false, ignoreCase: false, comments: false };
    const found = matchTexts(["no", "a customer", "-- customer"], query);
    expect(found.map((f) => f?.count ?? 0)).toEqual([0, 1, 0]);
    expect(matchTexts(["-- customer"], { ...query, comments: true })[0]?.count).toBe(1);
  });
});
