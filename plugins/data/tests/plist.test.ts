// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBplist } from "../ui/parse/bplist.js";
import { parsePlist } from "../ui/parse/plist.js";
import { plainOf, previewOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, rootOf, where } from "./nodes";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));
const XML = fixture("sample.plist").toString("utf8");
// Made from sample.plist with `plutil -convert binary1` (tests/make-fixtures.mjs).
const BINARY = new Uint8Array(fixture("sample.bplist"));

const EXPECTED = {
  CFBundleIdentifier: "ai.endue.sample",
  CFBundleName: "Desk Sample",
  CFBundleVersion: 42,
  Ratio: 1.5,
  Enabled: true,
  Disabled: false,
  Built: "2026-10-31T09:00:00Z",
  Icon: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
  Items: ["first", -3, "café & more"],
  Nested: { Password: "hunter2" },
};

describe("property lists", () => {
  it("an XML plist gives dict, array, string, integer, real, boolean, date and data", () => {
    const doc = parsePlist(XML);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual(EXPECTED);
    expect(kid(root, "CFBundleVersion")).toMatchObject({ kind: "number", value: "42" });
    expect(kid(root, "Built").kind).toBe("date");
    expect(kid(root, "Icon").kind).toBe("binary");
    expect(previewOf(kid(root, "Icon"))).toBe("10 bytes: 00 01 02 03 04 05 06 07 08 09");
    expect(where(kid(root, "Ratio"))).toEqual(at(XML, "<key>Ratio"));
    expect(where(kid(root, "Items", 1))).toEqual(at(XML, "<integer>-3"));
  });

  it("a binary plist made by plutil gives the same tree", () => {
    const doc = parseBplist(BINARY);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual(EXPECTED);
    expect(kid(root, "Built")).toMatchObject({ kind: "date", value: "2026-10-31T09:00:00Z" });
    expect(kid(root, "Items", 1)).toMatchObject({ kind: "number", value: "-3" });
    // Binary nodes know their byte offset: the hex dump's row and column.
    const ratio = kid(root, "Ratio");
    expect(ratio.offset).toBe(0x80);
    expect(where(ratio)).toEqual({ line: 9, col: 1 });
  });

  it("a damaged binary plist is an error, not a throw", () => {
    const cut = BINARY.slice(0, 120);
    const doc = parseBplist(cut);
    expect(doc.errors).toHaveLength(1);
    expect(doc.roots).toEqual([]);
    const bad = BINARY.slice();
    bad[bad.length - 1] = 0xff;
    expect(parseBplist(bad).errors[0]?.message).toMatch(/top object|offset|range/i);
  });

  it("an XML plist with a broken element is an error at its line", () => {
    const text = XML.replace("<real>1.5</real>", "<real>1.5</rael>");
    const doc = parsePlist(text);
    expect(doc.errors[0]?.line).toBe(at(text, "</rael>").line);
  });
});
