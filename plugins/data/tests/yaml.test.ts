// The examples of YAML 1.2.2, chapter 2 (https://yaml.org/spec/1.2.2/#chapter-2-language-overview):
// collections, several documents and errors. yaml-scalars.test.ts has the scalars, anchors, tags
// and the core schema.
import { describe, expect, it } from "vitest";
import { parseYaml } from "../ui/parse/yaml.js";
import { childrenOf, plainOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, nth, rootOf, where } from "./nodes";
import { one, values } from "./yaml";

describe("collections", () => {
  it("2.1 a sequence of scalars", () => {
    const text = "- Mark McGwire\n- Sammy Sosa\n- Ken Griffey\n";
    const root = one(text);
    expect(plainOf(root)).toEqual(["Mark McGwire", "Sammy Sosa", "Ken Griffey"]);
    expect(where(kid(root, 1))).toEqual(at(text, "Sammy"));
  });

  it("2.2 mapping scalars to scalars, with comments", () => {
    const text =
      "hr:  65    # Home runs\navg: 0.278 # Batting average\nrbi: 147   # Runs Batted In\n";
    const root = one(text);
    expect(plainOf(root)).toEqual({ hr: 65, avg: 0.278, rbi: 147 });
    expect(where(kid(root, "avg"))).toEqual(at(text, "avg"));
    expect(kid(root, "hr")).toMatchObject({ kind: "number", value: "65" });
  });

  it("2.3 mapping scalars to sequences", () => {
    const text = `american:
  - Boston Red Sox
  - Detroit Tigers
  - New York Yankees
national:
  - New York Mets
  - Chicago Cubs
  - Atlanta Braves
`;
    expect(plainOf(one(text))).toEqual({
      american: ["Boston Red Sox", "Detroit Tigers", "New York Yankees"],
      national: ["New York Mets", "Chicago Cubs", "Atlanta Braves"],
    });
  });

  it("2.4 a sequence of mappings", () => {
    const text = `-
  name: Mark McGwire
  hr:   65
  avg:  0.278
-
  name: Sammy Sosa
  hr:   63
  avg:  0.288
`;
    expect(plainOf(one(text))).toEqual([
      { name: "Mark McGwire", hr: 65, avg: 0.278 },
      { name: "Sammy Sosa", hr: 63, avg: 0.288 },
    ]);
  });

  it("2.5 a sequence of sequences", () => {
    const text = `- [name        , hr, avg  ]
- [Mark McGwire, 65, 0.278]
- [Sammy Sosa  , 63, 0.288]
`;
    expect(plainOf(one(text))).toEqual([
      ["name", "hr", "avg"],
      ["Mark McGwire", 65, 0.278],
      ["Sammy Sosa", 63, 0.288],
    ]);
  });

  it("2.6 a mapping of mappings, flow style over several lines", () => {
    const text = `Mark McGwire: {hr: 65, avg: 0.278}
Sammy Sosa: {
    hr: 63,
    avg: 0.288
  }
`;
    const root = one(text);
    expect(plainOf(root)).toEqual({
      "Mark McGwire": { hr: 65, avg: 0.278 },
      "Sammy Sosa": { hr: 63, avg: 0.288 },
    });
    expect(where(kid(root, "Sammy Sosa", "avg"))).toEqual(at(text, "avg: 0.288"));
  });

  it("2.9 comments, and 2.12 a compact nested mapping", () => {
    expect(
      values(`---
hr: # 1998 hr ranking
  - Mark McGwire
  - Sammy Sosa
rbi:
  # 1998 rbi ranking
  - Sammy Sosa
  - Ken Griffey
`),
    ).toEqual([{ hr: ["Mark McGwire", "Sammy Sosa"], rbi: ["Sammy Sosa", "Ken Griffey"] }]);
    expect(
      values(`---
# Products purchased
- item    : Super Hoop
  quantity: 1
- item    : Basketball
  quantity: 4
- item    : Big Shoes
  quantity: 1
`),
    ).toEqual([
      [
        { item: "Super Hoop", quantity: 1 },
        { item: "Basketball", quantity: 4 },
        { item: "Big Shoes", quantity: 1 },
      ],
    ]);
  });

  it("2.11 complex keys show as their text", () => {
    const root = one(`? - Detroit Tigers
  - Chicago cubs
: - 2001-07-23

? [ New York Yankees,
    Atlanta Braves ]
: [ 2001-07-02, 2001-08-12,
    2001-08-14 ]
`);
    expect(childrenOf(root).map((n) => n.key)).toEqual([
      "[Detroit Tigers, Chicago cubs]",
      "[New York Yankees, Atlanta Braves]",
    ]);
    expect(plainOf(nth(root, 1))).toEqual(["2001-07-02", "2001-08-12", "2001-08-14"]);
    expect(childrenOf(nth(root, 1))[0]?.kind).toBe("date");
  });
});

describe("several documents", () => {
  it("2.7 two documents in a stream", () => {
    const doc = parseYaml(`# Ranking of 1998 home runs
---
- Mark McGwire
- Sammy Sosa
- Ken Griffey

# Team ranking
---
- Chicago Cubs
- St Louis Cardinals
`);
    expect(doc.errors).toEqual([]);
    expect(doc.roots.map(plainOf)).toEqual([
      ["Mark McGwire", "Sammy Sosa", "Ken Griffey"],
      ["Chicago Cubs", "St Louis Cardinals"],
    ]);
    expect(doc.roots.map((root) => root.line)).toEqual([3, 9]);
  });

  it("2.8 documents ended with ..., and times stay strings in YAML 1.2", () => {
    expect(
      values(`---
time: 20:03:20
player: Sammy Sosa
action: strike (miss)
...
---
time: 20:03:47
player: Sammy Sosa
action: grand slam
...
`),
    ).toEqual([
      { time: "20:03:20", player: "Sammy Sosa", action: "strike (miss)" },
      { time: "20:03:47", player: "Sammy Sosa", action: "grand slam" },
    ]);
  });

  it("2.28 a log file of three documents", () => {
    const doc = parseYaml(`---
Time: 2001-11-23 15:01:42 -5
User: ed
Warning:
  This is an error message
  for the log file
---
Time: 2001-11-23 15:02:31 -5
User: ed
Warning:
  A slightly different error
  message.
---
Date: 2001-11-23 15:03:17 -5
User: ed
Fatal:
  Unknown variable "bar"
Stack:
  - file: TopClass.py
    line: 23
    code: |
      x = MoreObject("345\\n")
  - file: MoreClass.py
    line: 58
    code: |-
      foo = bar
`);
    expect(doc.errors).toEqual([]);
    expect(doc.roots.map(plainOf)).toEqual([
      {
        Time: "2001-11-23 15:01:42 -5",
        User: "ed",
        Warning: "This is an error message for the log file",
      },
      {
        Time: "2001-11-23 15:02:31 -5",
        User: "ed",
        Warning: "A slightly different error message.",
      },
      {
        Date: "2001-11-23 15:03:17 -5",
        User: "ed",
        Fatal: 'Unknown variable "bar"',
        Stack: [
          { file: "TopClass.py", line: 23, code: 'x = MoreObject("345\\n")\n' },
          { file: "MoreClass.py", line: 58, code: "foo = bar" },
        ],
      },
    ]);
    expect(kid(rootOf(doc), "Time").kind).toBe("date");
  });
});

describe("errors", () => {
  it("an error says its line, and the tree keeps what parsed before it", () => {
    const text = 'a: 1\nb: [1, 2\nc: "open\n';
    const doc = parseYaml(text);
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]?.line).toBeGreaterThanOrEqual(2);
    expect(plainOf(rootOf(doc))).toMatchObject({ a: 1 });
  });

  it("a bad indentation is an error at its line", () => {
    const doc = parseYaml("a:\n  b: 1\n c: 2\n");
    expect(doc.errors[0]?.line).toBe(3);
    expect(plainOf(rootOf(doc))).toEqual({ a: { b: 1 } });
  });

  it("an empty document is null, and merge keys stay keys", () => {
    expect(values("")).toEqual([]);
    expect(values("---\n...\n")).toEqual([null]);
    const root = one("base: &b {x: 1}\nuse:\n  <<: *b\n  y: 2\n");
    expect(plainOf(root)).toEqual({ base: { x: 1 }, use: { "<<": { x: 1 }, y: 2 } });
  });
});
