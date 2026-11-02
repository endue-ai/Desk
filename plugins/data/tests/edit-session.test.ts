// The edit tier of each file (ADR 0071) and the text tier's edits: YAML and TOML values spliced into
// the text, kept only when every other value still reads the same.
import { describe, expect, it } from "vitest";
import { assertMinimalEdit } from "../../../packages/plugin-sdk/src/testing/round-trip";
import { createSession, MAX_EDIT, tierOf } from "../ui/edit/session.js";
import { openFile } from "../ui/formats.js";
import { childrenOf, plainOf, resolve } from "../ui/tree.js";
import { textFixtures } from "./edit-fixtures.mjs";
import { bytesOf } from "./harness";

const fixture = (name: string) => {
  const found = textFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return bytesOf(found.text);
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function pathOf(session: ReturnType<typeof createSession>, pointer: string): number[] {
  const root = session.opened.doc?.roots[0];
  const chain = root ? resolve(root, pointer) : undefined;
  if (!root || !chain) throw new Error(`no node at ${pointer}`);
  return [0, ...chain.slice(1).map((node, i) => childrenOf(chain[i] as never).indexOf(node))];
}

const open = (name: string, content: string | Uint8Array) => {
  const bytes = typeof content === "string" ? bytesOf(content) : content;
  return createSession(name, bytes);
};

describe("the edit tier of each file", () => {
  it.each([
    ["a.json", '{"a": 1}', "lossless"],
    ["tsconfig.json", '{ // comments\n "a": 1, }', "lossless"],
    ["settings.jsonc", "{ /* c */ }", "lossless"],
    ["a.yaml", "a: 1\n", "text"],
    ["a.yml", "a: 1\n", "text"],
    ["Cargo.toml", 'name = "x"\n', "text"],
    ["a.json5", "{a: 1}", "read-only"],
    ["a.jsonl", '{"a":1}\n{"a":2}\n', "read-only"],
    ["a.ndjson", '{"a":1}\n', "read-only"],
    ["feed.xml", "<a>1</a>", "read-only"],
    ["php.ini", "[a]\nb=1\n", "read-only"],
    ["broken.json", '{"a": }', "read-only"],
    ["broken.yaml", "a: [1\n", "read-only"],
  ])("%s is %s", (name, content, tier) => {
    expect(open(name, content).tier).toBe(tier);
  });

  it("a file that is not UTF-8 is read-only, and says why", () => {
    const latin = open(
      "latin.json",
      new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe9, 0x22, 0x7d]),
    );
    expect(latin.tier).toBe("read-only");
    expect(latin.why).toBe("the file is not UTF-8");
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...new Uint8Array(new Uint16Array([0x7b, 0x7d]).buffer),
    ]);
    expect(open("wide.json", utf16).tier).toBe("read-only");
  });

  it("a file over 64 MiB is read-only", () => {
    const bytes = bytesOf('{"a": 1}');
    const opened = openFile("a.json", bytes);
    expect(MAX_EDIT).toBe(64 * 1024 * 1024);
    expect(tierOf(opened, bytes, MAX_EDIT)).toEqual({ tier: "lossless" });
    expect(tierOf(opened, bytes, MAX_EDIT + 1)).toEqual({
      tier: "read-only",
      why: "the file is larger than 64 MiB",
    });
  });

  it("says why other formats and broken files are read-only", () => {
    expect(open("feed.xml", "<a/>").why).toBe("XML files are not edited here");
    expect(open("broken.json", "{").why).toBe("the file does not parse");
  });

  it("refuses an edit in a read-only file in words", () => {
    const session = open("feed.xml", "<a>1</a>");
    expect(() => session.edit([0, 0], "2")).toThrow("XML files are not edited here.");
  });
});

describe("YAML, the text tier", () => {
  const yaml = () => createSession("service.yaml", fixture("service.yaml"));

  it.each([
    ["a plain string", "/name", "desk-demo", "desk-sample", "desk-demo"],
    ["a plain string that needs quotes", "/name", "a: b", "desk-sample", '"a: b"'],
    ["a number", "/port", "9090", "8080", "9090"],
    ["a boolean", "/debug", "true", "false", "true"],
    ["a double-quoted string", "/greeting", "Hi, all", '"Hello, world"', '"Hi, all"'],
    ["a single-quoted string", "/motto", "isn't it", "'it''s fine'", "'isn''t it'"],
    ["an item with a comment after it", "/tags/1", "gamma", "beta", "gamma"],
  ])("changes only %s, comments kept", (_, pointer, typed, find, written) => {
    const session = yaml();
    const before = session.bytes;
    expect(session.edit(pathOf(session, pointer), typed)).toEqual({ changed: true });
    assertMinimalEdit(before, session.bytes, { find, bytes: written });
    expect(decode(session.bytes)).toContain("# the service name");
  });

  it("rewrites a block scalar as a double-quoted string, and every other value stays", () => {
    const session = yaml();
    const before = plainOf(session.opened.doc?.roots[0] as never) as Record<string, unknown>;
    session.edit(pathOf(session, "/script"), "echo three\n");
    expect(decode(session.bytes)).toContain('script: "echo three\\n"\ntags:');
    const after = plainOf(session.opened.doc?.roots[0] as never) as Record<string, unknown>;
    expect(after).toEqual({ ...before, script: "echo three\n" });
  });

  it("refuses an alias and an anchored value its alias would follow", () => {
    const session = yaml();
    const before = session.bytes;
    expect(() => session.edit(pathOf(session, "/copy"), "6")).toThrow(/alias/);
    expect(() => session.edit(pathOf(session, "/base"), "6")).toThrow(/other values/);
    expect(session.bytes).toEqual(before);
  });

  it("takes a YAML value for a non-string, and refuses more than one", () => {
    const session = yaml();
    session.edit(pathOf(session, "/port"), "'8081'");
    expect(plainOf(session.opened.doc?.roots[0] as never)).toMatchObject({ port: "8081" });
    expect(() => session.edit(pathOf(session, "/debug"), "a: 1")).toThrow(/one YAML value/);
  });
});

describe("TOML, the text tier", () => {
  const toml = () => createSession("app.toml", fixture("app.toml"));

  it.each([
    ["a basic string", "/title", "Demo", '"Sample"', '"Demo"'],
    ["a literal string", "/server/path", "D:\\data", "'C:\\data'", "'D:\\data'"],
    ["a literal string that needs escapes", "/server/path", "it's", "'C:\\data'", '"it\'s"'],
    ["an integer", "/server/port", "9090", "8080", "9090"],
    ["a float", "/server/ratio", "0.75", "0.5", "0.75"],
    ["an array item", "/server/hosts/0", "three.invalid", '"one.invalid"', '"three.invalid"'],
  ])("changes only %s, comments kept", (_, pointer, typed, find, written) => {
    const session = toml();
    const before = session.bytes;
    expect(session.edit(pathOf(session, pointer), typed)).toEqual({ changed: true });
    assertMinimalEdit(before, session.bytes, { find, bytes: written });
    expect(decode(session.bytes)).toContain("# the title");
  });

  it("refuses text that is not a TOML value, and dates", () => {
    const session = toml();
    expect(() => session.edit(pathOf(session, "/server/port"), "eighty")).toThrow(
      /not a TOML value/,
    );
    expect(() => session.edit(pathOf(session, "/server/started"), "2026-12-01")).toThrow(/dates/i);
  });
});
