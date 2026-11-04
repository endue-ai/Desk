import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseYaml, resolveScalar, YamlError } from "./yaml";

/** Documents the reader must read exactly as the `yaml` package does. */
const SAME: Record<string, string> = {
  board: `# A board, as a server answers it
universal: v0
title: Launch tasks
updatedAt: 2026-11-04T08:00:00Z
map:
  group: column
  start: due
entries:
  - id: t1
    title: Write the spec   # done last week
    column: done
    due: 2026-11-02
    tags: [spec, "v0"]
  - id: t2
    title: "Build: the element"
    column: doing
    owner: { name: Mina, email: mina@example.com }
    estimate: 3.5
  -
    id: 003
    title: 'It''s shipping'
    done: false
    blocked: ~
`,
  "bare list": `- title: One
- title: Two
  text: |
    # Heading
    A paragraph with **bold**.

    - a list item
- title: Three
  text: >
    Folded lines
    join with spaces.

    A blank line keeps a break.
`,
  "same-indent sequence": `entries:
- a
- b
other:
  - [1, 2, {x: y}]
  - - nested
    - again
`,
  scalars: `ints: [0, -12, +5, 0o17, 0x1F]
floats: [1.5, -0.25, 1e3, .5, .inf, -.Inf]
bools: [true, False, TRUE]
nulls: [null, ~, Null]
strings: [yes, no, on, "12", '0x1F', 2026-11-04, a#b, "a # b"]
empty:
url: https://example.com/a?b=c#frag
time: 09:30
`,
  "block scalars": `keep: |+
  kept

strip: |-
  stripped
literal: |
  line one
    indented
  line three
folded: >-
  one
  two

  three
    more indented
  four
indicator: |2
    two extra spaces
last: done
`,
  "quoted and multi-line": `double: "tab\\tnewline\\nquote\\" unicode \\u00e9 \\x41"
single: 'no \\escapes here'
folded double: "a long
  line that folds"
plain multi: this plain
  scalar continues
  here
"quoted key": 1
'single key': 2
`,
  flow: `{ entries: [ { id: a, tags: [x, y] }, { id: b, title: "B, too" } ], title: Flow }`,
  json: `{"entries": [{"id": "j", "n": 1, "ok": true, "none": null}]}`,
  "document markers": `---
title: With markers
entries: []
...
`,
  "comments everywhere": `# leading
title: x # trailing

# between
entries:
  # inside
  - id: 1 # after
`,
  crlf: "title: dos\r\nentries:\r\n  - id: 1\r\n",
  "deeper nesting": `entries:
    - id: 1
      due date:    2026-11-05
      steps:
        - name: plan
          status: done
        - |
          a literal item
          with two lines
        - >-
          folded item
      empty list: []
      empty map: {}
      spread: [
        one,
        "two, three",
        { k: "v: w" }
      ]
    - id: 2
`,
  "trailing spaces": "text: |\n  keep these  \n  and these\t\nnext: x\n",
  empty: "",
};

/** Text the reader refuses, though some of it is YAML. */
const REFUSED: Record<string, string> = {
  anchors: "a: &x 1\nb: *x\n",
  tags: "a: !!str 1\n",
  "two documents": "a: 1\n---\nb: 2\n",
  directive: "%YAML 1.2\n---\na: 1\n",
  "complex key": "? a\n: b\n",
  "tab indent": "a:\n\t- 1\n",
  "bad indentation": "a: 1\n  b: 2\n",
  "nested compact mapping": "a: b: c\n",
  "unclosed flow": "a: [1, 2\n",
  "unclosed quote": 'a: "open\n',
};

describe("parseYaml", () => {
  for (const [name, text] of Object.entries(SAME)) {
    it(`reads ${name} as the yaml package does`, () => {
      expect(parseYaml(text)).toEqual(parse(text) ?? null);
    });
  }

  for (const [name, text] of Object.entries(REFUSED)) {
    it(`refuses ${name} with the line it stopped at`, () => {
      expect(() => parseYaml(text)).toThrow(YamlError);
    });
  }

  it("reads a large document and refuses a hostile one in linear time", () => {
    const words = "a quoted title with   several spaces and\\nescapes ".repeat(40);
    const rows = Array.from(
      { length: 2000 },
      (_, i) => `  - { id: ${i}, title: "${words}", tags: [x, y] }`,
    );
    let started = performance.now();
    const doc = parseYaml(`entries:\n${rows.join("\n")}\n`) as { entries: unknown[] };
    expect(doc.entries).toHaveLength(2000);
    const open = `entries: [\n${"  item,\n".repeat(100_000)}`;
    const quote = `text: "${"word \n".repeat(100_000)}`;
    expect(() => parseYaml(open)).toThrow(YamlError);
    expect(() => parseYaml(quote)).toThrow(YamlError);
    expect(performance.now() - started).toBeLessThan(4000);
    started = performance.now();
    expect((parseYaml(`${open}]\n`) as { entries: unknown[] }).entries).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(4000);
  }, 20_000);

  it("keeps __proto__ an own key, as JSON.parse does", () => {
    const value = parseYaml("__proto__: x\nsafe: 1\n") as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__", "safe"]);
  });

  it("resolves plain scalars under the core schema only", () => {
    expect(["", "~", "true", "07", "1_000", "2026-11-04", ".nan"].map(resolveScalar)).toEqual([
      null,
      null,
      true,
      7,
      "1_000",
      "2026-11-04",
      Number.NaN,
    ]);
  });
});
