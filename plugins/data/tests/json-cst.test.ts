// The lossless JSON model (ADR 0071): every fixture round-trips byte for byte, its tokens carry every
// byte once, and an edit of one scalar changes only that scalar's bytes, in the token's own style.
import { describe, expect, it } from "vitest";
import {
  assertMinimalEdit,
  assertRoundTrip,
} from "../../../packages/plugin-sdk/src/testing/round-trip";
import { parseCst, serialize } from "../ui/edit/cst.js";
import { createSession } from "../ui/edit/session.js";
import { childrenOf, resolve } from "../ui/tree.js";
import { jsonFixtures } from "./edit-fixtures.mjs";

const fixtures = jsonFixtures();
const fixture = (name: string) => {
  const found = fixtures.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.bytes;
};
const dialectOf = (name: string) => (name.endsWith(".jsonc") ? "jsonc" : "json");
// Keeps a BOM, so the BOM token reads as one.
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/** The child-index path of the node a JSON Pointer names in the session's current tree. */
function pathOf(session: ReturnType<typeof createSession>, pointer: string | number[]): number[] {
  if (Array.isArray(pointer)) return pointer;
  const root = session.opened.doc?.roots[0];
  const chain = root ? resolve(root, pointer) : undefined;
  if (!root || !chain) throw new Error(`no node at ${pointer}`);
  return [0, ...chain.slice(1).map((node, i) => childrenOf(chain[i] as never).indexOf(node))];
}

/** Open `name`, set the value at `pointer` to `typed` and return the bytes before and after. */
function edited(name: string, pointer: string | number[], typed: string) {
  const before = fixture(name);
  const session = createSession(name, before.slice());
  expect(session.tier).toBe("lossless");
  expect(session.edit(pathOf(session, pointer), typed)).toEqual({ changed: true });
  return { before, after: session.bytes, session };
}

describe("the JSON syntax model", () => {
  it.each(fixtures.map((f) => [f.name]))("%s round-trips byte for byte", (name) => {
    const bytes = fixture(name);
    const cst = assertRoundTrip(bytes, (b) => parseCst(b, dialectOf(name)), serialize);
    expect(cst.root.start).toBeGreaterThanOrEqual(0);
  });

  it.each(fixtures.map((f) => [f.name]))("%s: the tokens carry every byte once", (name) => {
    const bytes = fixture(name);
    const tokens = [...parseCst(bytes, dialectOf(name)).tokens()];
    let at = 0;
    for (const token of tokens) {
      expect(token.start, `${token.kind} at ${token.start}`).toBe(at);
      expect(token.end).toBeGreaterThan(token.start);
      at = token.end;
    }
    expect(at).toBe(bytes.length);
  });

  it("keeps a BOM, whitespace, comments, number spellings and escapes as tokens", () => {
    const raw = (name: string) => {
      const bytes = fixture(name);
      return [...parseCst(bytes, dialectOf(name)).tokens()].map((t) => ({
        kind: t.kind,
        raw: text(bytes.subarray(t.start, t.end)),
      }));
    };
    const pretty = raw("pretty.json");
    for (const number of ["1.50", "-0", "12345678901234567890", "1E+2", "0.1e-7"])
      expect(pretty).toContainEqual({ kind: "number", raw: number });
    expect(pretty).toContainEqual({ kind: "string", raw: '"https:\\/\\/example.invalid\\/a"' });
    expect(pretty).toContainEqual({ kind: "string", raw: '"\\ud83d\\ude00 😀"' });
    expect(raw("bom-crlf.json")[0]).toEqual({ kind: "bom", raw: "﻿" });
    expect(raw("bom-crlf.json")).toContainEqual({ kind: "space", raw: "\r\n\t" });
    const jsonc = raw("settings.jsonc");
    expect(jsonc).toContainEqual({ kind: "comment", raw: "// Editor settings (made-up values)" });
    expect(jsonc).toContainEqual({ kind: "comment", raw: "/* a block\r\n     comment */" });
    expect(jsonc).toContainEqual({
      kind: "string",
      raw: '"http://example.invalid/not // a comment"',
    });
  });

  it("finds a value by its path, duplicate keys and deep nesting included", () => {
    const bytes = fixture("pretty.json");
    const cst = parseCst(bytes, "json");
    const span = (path: number[]) => {
      const value = cst.valueAt(path);
      return value && text(bytes.subarray(value.start, value.end));
    };
    expect(span([0, 2])).toBe("1.50");
    expect(span([0, 17])).toBe('"Duplicate key, kept as written"');
    expect(span([0, 16, 0, 1, 0])).toBe("2");
    expect(span([0, 99])).toBeUndefined();
    const deep = parseCst(fixture("deep.json"), "json");
    const leaf = deep.valueAt([0, ...Array(120).fill(0), 0]);
    expect(leaf && text(fixture("deep.json").subarray(leaf.start, leaf.end))).toBe("1");
  });

  it("refuses bytes that are not JSON of its dialect", () => {
    expect(() => parseCst(new TextEncoder().encode('{"a": 1,}'), "json")).toThrow(/comma/i);
    expect(() => parseCst(new TextEncoder().encode("// c\n{}"), "json")).toThrow();
    expect(parseCst(new TextEncoder().encode("// c\n{}"), "jsonc").root.kind).toBe("object");
  });
});

describe("editing one value", () => {
  it.each([
    ["a string", "pretty.json", "/version", "2.0.0", '"2.0.0"'],
    ["a number", "pretty.json", "/price", "2.75", "2.75"],
    ["a boolean", "pretty.json", "/enabled", "false", "false"],
    ["a null", "pretty.json", "/owner", '"Team"', '"Team"'],
    ["a number into null", "pretty.json", "/zero", "null", "null"],
    ["a value in CRLF with a BOM", "bom-crlf.json", "/count", "43", "43"],
    ["a value in a minified file", "minified.json", "/c/d", "f", '"f"'],
    ["a value with comments around", "settings.jsonc", "/theme", "dark", '"dark"'],
    ["a value before a trailing comma", "settings.jsonc", "/list/2", "4", "4"],
  ])("changes only %s's bytes", (_, name, pointer, typed, written) => {
    const { before, after, session } = edited(name, pointer, typed);
    const cst = parseCst(before, dialectOf(name));
    const value = cst.valueAt(pathOf(createSession(name, before.slice()), pointer));
    if (!value) throw new Error("no value");
    assertMinimalEdit(before, after, {
      offset: value.start,
      length: value.end - value.start,
      bytes: written,
    });
    expect(session.opened.doc?.errors).toEqual([]);
  });

  it("the duplicate key's first value stays when the second changes", () => {
    const { before, after } = edited("pretty.json", [0, 17], "Renamed");
    assertMinimalEdit(before, after, {
      find: '"Duplicate key, kept as written"',
      bytes: '"Renamed"',
    });
    expect(text(after)).toContain('"name": "Sample service"');
    expect(text(after)).toContain('"name": "Renamed"');
  });

  it("writes a string in its token's style: \\u for non-ASCII and \\/ where it was so", () => {
    const word = edited("ascii.json", "/word", "naïve");
    assertMinimalEdit(word.before, word.after, { find: '"caf\\u00E9"', bytes: '"na\\u00EFve"' });
    const path = edited("ascii.json", "/path", "c/d");
    assertMinimalEdit(path.before, path.after, { find: '"a\\/b"', bytes: '"c\\/d"' });
    const plain = edited("ascii.json", "/plain", 'tab\there "q" é');
    assertMinimalEdit(plain.before, plain.after, {
      find: '"abc"',
      bytes: '"tab\\there \\"q\\" é"',
    });
  });

  it("the whole tree after an edit shows the new value", () => {
    const { session } = edited("pretty.json", "/nested/list/1/id", "20");
    const root = session.opened.doc?.roots[0];
    const node = root && resolve(root, "/nested/list/1/id")?.at(-1);
    expect(node).toMatchObject({ kind: "number", value: "20" });
  });

  it("the same value again changes nothing", () => {
    const before = fixture("pretty.json");
    const session = createSession("pretty.json", before.slice());
    expect(session.edit(pathOf(session, "/price"), "1.50")).toEqual({ changed: false });
    expect(session.edit(pathOf(session, "/version"), "1.0.0")).toEqual({ changed: false });
    expect(session.bytes).toEqual(before);
  });

  it("refuses text that is not a JSON value, and containers, in words", () => {
    const session = createSession("pretty.json", fixture("pretty.json").slice());
    expect(() => session.edit(pathOf(session, "/price"), "1,5")).toThrow(
      "1,5 is not a JSON value: write a number, true, false, null or a string in double quotes.",
    );
    expect(() => session.edit(pathOf(session, "/price"), "01")).toThrow(/not a JSON value/);
    expect(() => session.edit(pathOf(session, "/owner"), "'single'")).toThrow(/not a JSON value/);
    expect(() => session.edit(pathOf(session, "/nested"), "{}")).toThrow(
      /only strings, numbers, true, false and null/i,
    );
    expect(session.bytes).toEqual(fixture("pretty.json"));
  });

  it("gives the editor a string's value and other values as written", () => {
    const session = createSession("pretty.json", fixture("pretty.json").slice());
    expect(session.valueOf(pathOf(session, "/quote"))).toEqual({ text: 'She said "hi" \\ bye' });
    expect(session.valueOf(pathOf(session, "/exp"))).toEqual({ text: "1E+2" });
    expect(session.valueOf(pathOf(session, "/owner"))).toEqual({ text: "null" });
  });
});
