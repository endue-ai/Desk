// A selection's totals and a chart's aggregates on exact decimal text (PG-44, ui/chart/decimal.js,
// ui/chart/aggregate.js): sums of values past 2^53 and of decimals that floating point rounds, an
// average by decimal division, minimum and maximum across scales and exponents, distinct values by
// their number, NULLs counted apart, PostgreSQL's NaN and infinities, and text that only counts.
import { describe, expect, it } from "vitest";
import { totalsOf } from "../ui/chart/aggregate.js";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  parseDecimal,
} from "../ui/chart/decimal.js";

const d = (text: string) => {
  const parsed = parseDecimal(text);
  if (!parsed) throw new Error(`not a number: ${text}`);
  return parsed;
};

describe("exact decimals", () => {
  it("add values past 2^53 and decimals floating point rounds, keeping the larger scale", () => {
    expect(formatDecimal(addDecimal(d("9007199254740993"), d("9007199254740993")))).toBe(
      "18014398509481986",
    );
    expect(formatDecimal(addDecimal(d("0.1"), d("0.2")))).toBe("0.3");
    expect(formatDecimal(addDecimal(d("1.50"), d("2")))).toBe("3.50");
    expect(formatDecimal(addDecimal(d("123456789012345678901234567890.123"), d("0.877")))).toBe(
      "123456789012345678901234567891.000",
    );
    expect(formatDecimal(addDecimal(d("-1e-3"), d("1.5E+2")))).toBe("149.999");
    expect(formatDecimal(addDecimal(d("-0.5"), d("0.25")))).toBe("-0.25");
  });

  it("read the text a server prints, and nothing else", () => {
    expect(formatDecimal(d("1.5e+20"))).toBe("150000000000000000000");
    expect(formatDecimal(d("-1.2345678901234567e-05"))).toBe("-0.000012345678901234567");
    expect(formatDecimal(d("+.5"))).toBe("0.5");
    for (const text of ["", "-", ".", "1.2.3", "12abc", "0x10", "1e", "--1"])
      expect(parseDecimal(text), text).toBeNull();
  });

  it("divide by a count, half away from zero, six places past the scale", () => {
    expect(formatDecimal(divideDecimal(d("5"), 2n))).toBe("2.5");
    expect(formatDecimal(divideDecimal(d("5"), 3n))).toBe("1.666667");
    expect(formatDecimal(divideDecimal(d("-5"), 3n))).toBe("-1.666667");
    expect(formatDecimal(divideDecimal(d("0.30"), 2n))).toBe("0.15");
    expect(formatDecimal(divideDecimal(d("18014398509481987"), 2n))).toBe("9007199254740993.5");
  });

  it("compare across scales and exponents", () => {
    expect(compareDecimal(d("10"), d("1e1"))).toBe(0);
    expect(compareDecimal(d("9.99"), d("10"))).toBe(-1);
    expect(compareDecimal(d("-3"), d("-2.5"))).toBe(-1);
    expect(compareDecimal(d("9007199254740993"), d("9007199254740992"))).toBe(1);
    // PostgreSQL orders NaN above every number and the infinities at the ends.
    expect(compareDecimal(d("NaN"), d("Infinity"))).toBe(1);
    expect(compareDecimal(d("-Infinity"), d("-1e300"))).toBe(-1);
  });
});

describe("a selection's totals", () => {
  it("count, distinct, sum, average, minimum and maximum of numbers, exactly", () => {
    expect(totalsOf(["9007199254740993", "1", null, "0.1", "0.2"])).toEqual({
      count: 4,
      nulls: 1,
      distinct: 4,
      numeric: true,
      sum: "9007199254740994.3",
      average: "2251799813685248.575",
      min: "0.1",
      max: "9007199254740993",
    });
  });

  it("count distinct numbers by value, and keep the text of the first minimum and maximum", () => {
    const totals = totalsOf(["1", "1.0", "1.00", "10", "1e1", "-3"]);
    expect(totals).toMatchObject({ count: 6, distinct: 3, min: "-3", max: "10", sum: "20.00" });
  });

  it("follow PostgreSQL for NaN and the infinities", () => {
    expect(totalsOf(["1", "Infinity"])).toMatchObject({ sum: "Infinity", max: "Infinity" });
    expect(totalsOf(["Infinity", "-Infinity"])).toMatchObject({ sum: "NaN", average: "NaN" });
    expect(totalsOf(["NaN", "1"])).toMatchObject({ max: "NaN", min: "1", sum: "NaN" });
  });

  it("count text, distinct text and its minimum and maximum, without a sum", () => {
    expect(totalsOf(["b", "a", null, "b", "10"])).toEqual({
      count: 4,
      nulls: 1,
      distinct: 3,
      numeric: false,
      sum: null,
      average: null,
      min: "10",
      max: "b",
    });
  });

  it("sum a hundred thousand decimals as their text says", () => {
    const values = Array.from({ length: 100_000 }, () => "0.01");
    expect(totalsOf(values)).toMatchObject({ count: 100_000, sum: "1000.00", average: "0.01" });
  });

  it("say nothing of numbers for no value", () => {
    expect(totalsOf([null, null])).toEqual({
      count: 0,
      nulls: 2,
      distinct: 0,
      numeric: false,
      sum: null,
      average: null,
      min: null,
      max: null,
    });
  });
});
