// The examples of YAML 1.2.2, chapter 2 (https://yaml.org/spec/1.2.2/#chapter-2-language-overview):
// scalar styles, anchors, aliases and tags, read as the core schema does, plus timestamps as dates.
import { describe, expect, it } from "vitest";
import { childrenOf, plainOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, where } from "./nodes";
import { one, values } from "./yaml";

describe("scalar styles", () => {
  it("2.13 literal and 2.14 folded block scalars", () => {
    expect(values("# ASCII Art\n--- |\n  \\//||\\/||\n  // ||  ||__\n")).toEqual([
      "\\//||\\/||\n// ||  ||__\n",
    ]);
    expect(values("--- >\n  Mark McGwire's\n  year was crippled\n  by a knee injury.\n")).toEqual([
      "Mark McGwire's year was crippled by a knee injury.\n",
    ]);
  });

  it("2.15 folding keeps more indented and blank lines", () => {
    expect(
      values(`--- >
 Sammy Sosa completed another
 fine season with great stats.

   63 Home Runs
   0.288 Batting Average

 What a year!
`),
    ).toEqual([
      "Sammy Sosa completed another fine season with great stats.\n\n  63 Home Runs\n  0.288 Batting Average\n\nWhat a year!\n",
    ]);
  });

  it("2.16 indentation decides the scope of block scalars", () => {
    expect(
      values(`name: Mark McGwire
accomplishment: >
  Mark set a major league
  home run record in 1998.
stats: |
  65 Home Runs
  0.278 Batting Average
`),
    ).toEqual([
      {
        name: "Mark McGwire",
        accomplishment: "Mark set a major league home run record in 1998.\n",
        stats: "65 Home Runs\n0.278 Batting Average\n",
      },
    ]);
  });

  it("chomping: strip, clip and keep", () => {
    expect(
      values(
        "strip: |-\n  text\nclip: |\n  text\nkeep: |+\n  text\n\nfold: >-\n  a\n  b\nend: 1\n",
      ),
    ).toEqual([{ strip: "text", clip: "text\n", keep: "text\n\n", fold: "a b", end: 1 }]);
    expect(values("indented: |2\n    two more\n  base\n")).toEqual([
      { indented: "  two more\nbase\n" },
    ]);
  });

  it("2.17 quoted scalars and their escapes", () => {
    const text = `unicode: "Sosa did fine.\\u263A"
control: "\\b1998\\t1999\\t2000\\n"
hex esc: "\\x0d\\x0a is \\r\\n"

single: '"Howdy!" he cried.'
quoted: ' # Not a ''comment''.'
tie-fighter: '|\\-*-/|'
`;
    expect(values(text)).toEqual([
      {
        unicode: "Sosa did fine.☺",
        control: "\b1998\t1999\t2000\n",
        "hex esc": "\r\n is \r\n",
        single: '"Howdy!" he cried.',
        quoted: " # Not a 'comment'.",
        "tie-fighter": "|\\-*-/|",
      },
    ]);
  });

  it("2.18 multi-line flow scalars", () => {
    expect(
      values(`plain:
  This unquoted scalar
  spans many lines.

quoted: "So does this
  quoted scalar.\\n"
`),
    ).toEqual([
      { plain: "This unquoted scalar spans many lines.", quoted: "So does this quoted scalar.\n" },
    ]);
  });
});

describe("anchors, aliases and tags", () => {
  it("2.10 an alias shows the node it points to", () => {
    const root = one(`---
hr:
  - Mark McGwire
  # Following node labeled SS
  - &SS Sammy Sosa
rbi:
  - *SS # Subsequent occurrence
  - Ken Griffey
`);
    expect(plainOf(root)).toEqual({
      hr: ["Mark McGwire", "Sammy Sosa"],
      rbi: ["Sammy Sosa", "Ken Griffey"],
    });
    expect(kid(root, "hr", 1).anchor).toBe("SS");
    expect(kid(root, "rbi", 0)).toMatchObject({ kind: "string", value: "Sammy Sosa", alias: "SS" });
  });

  it("2.27 the invoice: a mapping alias and a typed document", () => {
    const text = `--- !<tag:clarkevans.com,2002:invoice>
invoice: 34843
date   : 2001-01-23
bill-to: &id001
    given  : Chris
    family : Dumars
    address:
        lines: |
            458 Walkman Dr.
            Suite #292
        city    : Royal Oak
        state   : MI
        postal  : 48046
ship-to: *id001
product:
    - sku         : BL394D
      quantity    : 4
      description : Basketball
      price       : 450.00
    - sku         : BL4438H
      quantity    : 1
      description : Super Hoop
      price       : 2392.00
tax  : 251.42
total: 4443.52
comments:
    Late afternoon is best.
    Backup contact is Nancy
    Billsmer @ 338-4338.
`;
    const root = one(text);
    const bill = {
      given: "Chris",
      family: "Dumars",
      address: {
        lines: "458 Walkman Dr.\nSuite #292\n",
        city: "Royal Oak",
        state: "MI",
        postal: 48046,
      },
    };
    expect(plainOf(root)).toEqual({
      invoice: 34843,
      date: "2001-01-23",
      "bill-to": bill,
      "ship-to": bill,
      product: [
        { sku: "BL394D", quantity: 4, description: "Basketball", price: 450 },
        { sku: "BL4438H", quantity: 1, description: "Super Hoop", price: 2392 },
      ],
      tax: 251.42,
      total: 4443.52,
      comments: "Late afternoon is best. Backup contact is Nancy Billsmer @ 338-4338.",
    });
    expect(root.tag).toBe("!<tag:clarkevans.com,2002:invoice>");
    expect(kid(root, "bill-to").anchor).toBe("id001");
    expect(kid(root, "ship-to")).toMatchObject({ kind: "object", alias: "id001" });
    expect(where(kid(root, "ship-to"))).toEqual(at(text, "ship-to"));
    expect(kid(root, "date").kind).toBe("date");
  });

  it("2.23 explicit tags: !!str, !!binary and an application tag", () => {
    const root = one(`---
not-date: !!str 2002-04-28

picture: !!binary |
 R0lGODlhDAAMAIQAAP//9/X
 17unp5WZmZgAAAOfn515eXv
 Pz7Y6OjuDg4J+fn5OTk6enp
 56enmleECcgggoBADs=

application specific tag: !something |
 The semantics of the tag
 above may be different for
 different documents.
`);
    expect(kid(root, "not-date")).toMatchObject({
      kind: "string",
      value: "2002-04-28",
      tag: "!!str",
    });
    const picture = kid(root, "picture");
    expect(picture).toMatchObject({ kind: "binary", tag: "!!binary" });
    expect((picture.value as Uint8Array).slice(0, 6)).toEqual(
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    );
    expect(kid(root, "application specific tag")).toMatchObject({
      kind: "string",
      tag: "!something",
      value: "The semantics of the tag\nabove may be different for\ndifferent documents.\n",
    });
  });

  it("2.24 global tags, 2.25 sets and 2.26 ordered maps", () => {
    const shapes = one(`%TAG ! tag:clarkevans.com,2002:
--- !shape
  # Use the ! handle for presenting
  # tag:clarkevans.com,2002:circle
- !circle
  center: &ORIGIN {x: 73, y: 129}
  radius: 7
- !line
  start: *ORIGIN
  finish: { x: 89, y: 102 }
- !label
  start: *ORIGIN
  color: 0xFFEEBB
  text: Pretty vector drawing.
`);
    expect(shapes.tag).toBe("!shape");
    expect(childrenOf(shapes).map((n) => n.tag)).toEqual(["!circle", "!line", "!label"]);
    expect(plainOf(shapes)).toEqual([
      { center: { x: 73, y: 129 }, radius: 7 },
      { start: { x: 73, y: 129 }, finish: { x: 89, y: 102 } },
      { start: { x: 73, y: 129 }, color: 0xffeebb, text: "Pretty vector drawing." },
    ]);
    const set = one(`# Sets are represented as a
# Mapping where each key is
# associated with a null value
--- !!set
? Mark McGwire
? Sammy Sosa
? Ken Griff
`);
    expect(set.tag).toBe("!!set");
    expect(plainOf(set)).toEqual({ "Mark McGwire": null, "Sammy Sosa": null, "Ken Griff": null });
    const omap = one(`--- !!omap
- Mark McGwire: 65
- Sammy Sosa: 63
- Ken Griffy: 58
`);
    expect(plainOf(omap)).toEqual([
      { "Mark McGwire": 65 },
      { "Sammy Sosa": 63 },
      { "Ken Griffy": 58 },
    ]);
  });
});

describe("the core schema", () => {
  it("2.19 integers, 2.20 floats and 2.21 null, booleans and strings", () => {
    const ints = one("canonical: 12345\ndecimal: +12345\noctal: 0o14\nhexadecimal: 0xC\n");
    expect(plainOf(ints)).toEqual({ canonical: 12345, decimal: 12345, octal: 12, hexadecimal: 12 });
    expect(kid(ints, "octal")).toMatchObject({ kind: "number", value: "0o14" });
    const floats = one(
      "canonical: 1.23015e+3\nexponential: 12.3015e+02\nfixed: 1230.15\nnegative infinity: -.inf\nnot a number: .nan\n",
    );
    const f = plainOf(floats) as Record<string, number>;
    expect(f.canonical).toBe(1230.15);
    expect(f.exponential).toBe(1230.15);
    expect(f["negative infinity"]).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(f["not a number"])).toBe(true);
    const misc = one("null:\nbooleans: [ true, false ]\nstring: '012345'\n");
    expect(plainOf(misc)).toEqual({ null: null, booleans: [true, false], string: "012345" });
    expect(kid(misc, "null").kind).toBe("null");
  });

  it("resolves every core form and leaves the rest as strings", () => {
    const root = one(
      "[null, Null, NULL, ~, true, True, FALSE, 0o17, 0x1F, -12, 1.5e3, .inf, -.Inf, .NaN, '1', \"true\", 12abc, yes, 1_000]",
    );
    expect(childrenOf(root).map((n) => n.kind)).toEqual([
      "null",
      "null",
      "null",
      "null",
      "boolean",
      "boolean",
      "boolean",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "string",
      "string",
      "string",
      "string",
      "string",
    ]);
  });

  it("2.22 timestamps are dates", () => {
    const root = one(`canonical: 2001-12-15T02:59:43.1Z
iso8601: 2001-12-14t21:59:43.10-05:00
spaced: 2001-12-14 21:59:43.10 -5
date: 2002-12-14
`);
    expect(childrenOf(root).map((n) => n.kind)).toEqual(["date", "date", "date", "date"]);
    expect(kid(root, "spaced").value).toBe("2001-12-14 21:59:43.10 -5");
  });
});
