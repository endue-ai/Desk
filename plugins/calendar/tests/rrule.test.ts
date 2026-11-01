// RECUR values (RFC 5545 §3.3.10): what parseRule reads and refuses, and the bounds that keep an
// expansion finite: periods skipped before the window, and a rule that never matches.
import { describe, expect, it } from "vitest";
import { expand } from "../ui/ical/recur.js";
import { parseRule } from "../ui/ical/rrule.js";
import { parseTime, wallOf } from "../ui/ical/values.js";

describe("expansion limits", () => {
  it("skips whole periods before `from` without COUNT, and yields the same starts", () => {
    const rule = parseRule("FREQ=MINUTELY;INTERVAL=7");
    if ("error" in rule) throw new Error(rule.error);
    const start = wallOf(parseTime("19900101T000000") as never);
    const from = wallOf(parseTime("20260101T000000") as never);
    const end = from + 3_600_000;
    const got = [...expand(rule.rule, start, { from, end })].filter((w) => w >= from);
    const step = 7 * 60_000;
    const expected: number[] = [];
    for (let w = start + Math.ceil((from - start) / step) * step; w <= end; w += step)
      expected.push(w);
    expect(expected.length).toBeGreaterThan(7);
    expect(got).toEqual(expected);
  });

  it("a rule that never matches ends at `end`", () => {
    const rule = parseRule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30");
    if ("error" in rule) throw new Error(rule.error);
    const start = wallOf(parseTime("20000101T090000") as never);
    expect([...expand(rule.rule, start, { end: wallOf(parseTime("29990101") as never) })]).toEqual([
      start,
    ]);
  });
});

describe("parseRule", () => {
  it("reads every part and writes them back in order", () => {
    const parsed = parseRule("freq=monthly;bysetpos=-1;byday=MO,-1FR;interval=2;wkst=su;count=3");
    expect(parsed).toEqual({
      rule: {
        freq: "MONTHLY",
        interval: 2,
        count: 3,
        bysetpos: [-1],
        byday: [
          { n: 0, wd: 1 },
          { n: -1, wd: 5 },
        ],
        wkst: 0,
      },
    });
  });

  it.each([
    ["", "FREQ is missing"],
    ["FREQ=FORTNIGHTLY", "FREQ=FORTNIGHTLY is unknown"],
    ["FREQ=DAILY;COUNT=2;UNTIL=20260101", "COUNT and UNTIL are both given"],
    ["FREQ=WEEKLY;BYDAY=1MO", "a numbered BYDAY needs FREQ=MONTHLY or YEARLY, not WEEKLY"],
    ["FREQ=MONTHLY;BYWEEKNO=3", "BYWEEKNO needs FREQ=YEARLY"],
    ["FREQ=WEEKLY;BYMONTHDAY=3", "BYMONTHDAY does not go with FREQ=WEEKLY"],
    ["FREQ=DAILY;BYYEARDAY=3", "BYYEARDAY does not go with FREQ=DAILY"],
    ["FREQ=DAILY;BYHOUR=24", "24 is out of range"],
    ["FREQ=DAILY;BYMONTH=0", "0 is out of range"],
    ["FREQ=DAILY;RSCALE=GREGORIAN", "RSCALE is not supported"],
    ["FREQ=DAILY;FREQ=WEEKLY", "FREQ appears twice"],
  ])("refuses %j: %s", (text, error) => {
    expect(parseRule(text)).toEqual({ error });
  });
});
