import { describe, expect, it } from "vitest";
import { parseJson } from "../ui/parse/json.js";
import { parseJsonLines } from "../ui/parse/jsonl.js";
import { childrenOf, countOf, numberOf, plainOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, nth, nthRoot, rootOf, where } from "./nodes";

const STRICT = `{
  "name": "desk",
  "list": [1, 2.5, -3e2, "x"],
  "nested": { "ok": true, "none": null },
  "escapes": "tab\\tquote\\" \\u00e9 \\ud83d\\ude00"
}
`;

describe("JSON", () => {
  it("parses strict JSON into the typed tree with each node's line and column", () => {
    const doc = parseJson(STRICT, "json");
    expect(doc.errors).toEqual([]);
    expect(doc.roots).toHaveLength(1);
    const root = rootOf(doc);
    expect(root?.kind).toBe("object");
    expect(where(root)).toEqual({ line: 1, col: 1 });
    expect(plainOf(root)).toEqual({
      name: "desk",
      list: [1, 2.5, -300, "x"],
      nested: { ok: true, none: null },
      escapes: 'tab\tquote" é 😀',
    });
    expect(where(kid(root, "name"))).toEqual(at(STRICT, '"name"'));
    expect(where(kid(root, "list", 3))).toEqual(at(STRICT, '"x"'));
    expect(where(kid(root, "nested", "none"))).toEqual(at(STRICT, '"none"'));
    expect(kid(root, "list").kind).toBe("array");
    expect(childrenOf(kid(root, "list")).map((n) => n.kind)).toEqual([
      "number",
      "number",
      "number",
      "string",
    ]);
    expect(kid(root, "nested", "ok").kind).toBe("boolean");
    expect(kid(root, "nested", "none").kind).toBe("null");
  });

  it("builds children only when they are asked for, and knows their count before", () => {
    const root = rootOf(parseJson('{ "a": [1, 2, 3], "b": {} }', "json"));
    expect(root?.children).toBeUndefined();
    expect(countOf(root)).toBe(2);
    const a = nth(root, 0);
    expect(a.children).toBeUndefined();
    expect(countOf(a)).toBe(3);
    expect(childrenOf(a)).toHaveLength(3);
    expect(root?.children).toHaveLength(2);
  });

  it("keeps numbers as written, so integers past 2^53 lose nothing", () => {
    const root = rootOf(parseJson('{ "big": 9007199254740993, "exp": 1.50e+3 }', "json"));
    expect(kid(root, "big")).toMatchObject({ kind: "number", value: "9007199254740993" });
    expect(kid(root, "exp")).toMatchObject({ kind: "number", value: "1.50e+3" });
    expect(numberOf(kid(root, "exp"))).toBe(1500);
  });

  it("an error says its line and column, and the tree keeps what parsed before it", () => {
    const text = '{\n  "a": 1,\n  "b": [1, 2,,3],\n  "c": 3\n}';
    const doc = parseJson(text, "json");
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]?.line).toBe(3);
    expect(doc.errors[0]?.col).toBe(at(text, ",,").col + 1);
    expect(doc.errors[0]?.message).toMatch(/,/);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual({ a: 1, b: [1, 2] });
  });

  it("reports an unterminated document at its end", () => {
    const doc = parseJson('{ "a": [1, 2', "json");
    expect(doc.errors[0]).toMatchObject({ line: 1, col: 13 });
    expect(plainOf(rootOf(doc))).toEqual({ a: [1, 2] });
  });

  it("flags a duplicate key", () => {
    const text = '{\n  "a": 1,\n  "a": 2\n}';
    const doc = parseJson(text, "json");
    expect(doc.errors).toEqual([]);
    const [first, second] = childrenOf(rootOf(doc));
    expect(first?.duplicate).toBeFalsy();
    expect(second?.duplicate).toBe(true);
    expect(doc.warnings).toEqual([{ message: 'Duplicate key "a".', line: 3, col: 3 }]);
  });

  it("strict JSON refuses comments and trailing commas", () => {
    expect(parseJson('{ "a": 1 // no\n}', "json").errors).toHaveLength(1);
    expect(parseJson('{ "a": 1, }', "json").errors).toHaveLength(1);
    expect(parseJson("[1, 2,]", "json").errors).toHaveLength(1);
    expect(parseJson("{ a: 1 }", "json").errors).toHaveLength(1);
    expect(parseJson("[01]", "json").errors).toHaveLength(1);
    expect(parseJson('["\t"]', "json").errors).toHaveLength(1);
  });
});

describe("JSONC", () => {
  it("allows comments and trailing commas", () => {
    const text = `// settings
{
  /* the editor */
  "editor.fontSize": 13, // points
  "files.exclude": { "**/.git": true, },
  "list": [1, 2,],
}
`;
    const doc = parseJson(text, "jsonc");
    expect(doc.errors).toEqual([]);
    expect(plainOf(rootOf(doc))).toEqual({
      "editor.fontSize": 13,
      "files.exclude": { "**/.git": true },
      list: [1, 2],
    });
    expect(where(kid(rootOf(doc), "list"))).toEqual(at(text, '"list"'));
  });
});

describe("JSON5", () => {
  it("reads the json5.org example", () => {
    const text = `// comments
{
  unquoted: 'and you can quote me on that',
  singleQuotes: 'I can use "double quotes" here',
  lineBreaks: "Look, Mom! \\
No \\\\n's!",
  hexadecimal: 0xdecaf,
  leadingDecimalPoint: .8675309, andTrailing: 8675309.,
  positiveSign: +1,
  trailingComma: 'in objects', andIn: ['arrays',],
  "backwardsCompatible": "with JSON",
  infinite: -Infinity,
  notANumber: NaN,
}
`;
    const doc = parseJson(text, "json5");
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toMatchObject({
      unquoted: "and you can quote me on that",
      singleQuotes: 'I can use "double quotes" here',
      lineBreaks: "Look, Mom! No \\n's!",
      hexadecimal: 912559,
      leadingDecimalPoint: 0.8675309,
      andTrailing: 8675309,
      positiveSign: 1,
      trailingComma: "in objects",
      andIn: ["arrays"],
      backwardsCompatible: "with JSON",
      infinite: Number.NEGATIVE_INFINITY,
    });
    expect(Number.isNaN(numberOf(kid(root, "notANumber")))).toBe(true);
    expect(kid(root, "hexadecimal").value).toBe("0xdecaf");
    expect(where(kid(root, "andTrailing"))).toEqual(at(text, "andTrailing"));
  });
});

describe("JSON Lines and NDJSON", () => {
  it("gives one root per line and flags a bad line on its own", () => {
    const text = '{"id": 1}\n{"id": 2,\n\n["three", 3]\n';
    const doc = parseJsonLines(text);
    expect(doc.roots).toHaveLength(3);
    expect(doc.roots.map((root) => root.line)).toEqual([1, 2, 4]);
    expect(plainOf(rootOf(doc))).toEqual({ id: 1 });
    expect(doc.roots[1]?.error).toMatch(/end/i);
    expect(plainOf(nthRoot(doc, 2))).toEqual(["three", 3]);
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]).toMatchObject({ line: 2 });
    expect(where(kid(nthRoot(doc, 2), 1))).toEqual(at(text, "3]"));
  });
});

describe("a 50 MB document", () => {
  it("parses in linear time and builds only what is opened", () => {
    const row = (i: number) =>
      `{"id":${i},"name":"item ${i}","tags":["a","b","c"],"score":${i / 7},"ok":${i % 2 === 0}}`;
    const parts: string[] = [];
    let size = 2;
    for (let i = 0; size < 50 * 1024 * 1024; i++) {
      const next = row(i);
      parts.push(next);
      size += next.length + 2;
    }
    const text = `[\n${parts.join(",\n")}\n]`;
    const started = performance.now();
    const doc = parseJson(text, "json");
    const root = rootOf(doc);
    const first = childrenOf(root);
    const took = performance.now() - started;
    expect(doc.errors).toEqual([]);
    expect(countOf(root)).toBe(parts.length);
    expect(first[0]?.children).toBeUndefined();
    expect(plainOf(nth(root, 1))).toMatchObject({ id: 1, name: "item 1" });
    expect(where(nth(root, -1))).toEqual({ line: parts.length + 1, col: 1 });
    console.info(`50 MB JSON: ${parts.length} rows parsed and listed in ${Math.round(took)} ms`);
    expect(took).toBeLessThan(20_000);
  }, 60_000);
});
