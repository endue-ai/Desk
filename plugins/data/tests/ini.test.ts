import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { parseEnv } from "../ui/parse/env.js";
import { parseIni, parseProperties } from "../ui/parse/ini.js";
import { childrenOf, plainOf } from "../ui/tree.js";
import { at, bytesOf } from "./harness";
import { kid, rootOf, where } from "./nodes";

const INI = `; global comment
name = top

[server]
host = example.org
port: 8080
# a hash comment
path = "/var/data"
flag

[remote "origin"]
url = https://example.invalid/repo.git
`;

describe("INI, CFG and CONF", () => {
  it("sections, keys and comments, with positions", () => {
    const doc = parseIni(INI);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual({
      name: "top",
      server: { host: "example.org", port: "8080", path: "/var/data", flag: null },
      'remote "origin"': { url: "https://example.invalid/repo.git" },
    });
    expect(where(kid(root, "server"))).toEqual(at(INI, "[server]"));
    expect(where(kid(root, "server", "port"))).toEqual(at(INI, "port"));
  });

  it("a .cfg or .conf that does not read as INI opens raw with a note", () => {
    const nginx = "server {\n  listen 80;\n  root /var/www;\n}\n";
    const opened = openFile("nginx.conf", bytesOf(nginx));
    expect(opened.doc).toBeUndefined();
    expect(opened.text).toBe(nginx);
    expect(opened.note).toMatch(/does not read as INI/);
    const setup = openFile("setup.cfg", bytesOf("[metadata]\nname = desk\n"));
    expect(plainOf(rootOf(setup.doc))).toEqual({ metadata: { name: "desk" } });
  });

  it("an .ini with a line it cannot read is an error at that line", () => {
    const opened = openFile("bad.ini", bytesOf("[a]\nx = 1\nthis is not a key\n"));
    expect(opened.doc?.errors[0]).toMatchObject({ line: 3 });
    expect(plainOf(rootOf(opened.doc))).toEqual({ a: { x: "1" } });
  });
});

describe("Java properties", () => {
  it("escapes, continuation lines, \\uXXXX and every separator", () => {
    const text = `# comment
! also a comment
app.name = Desk
app.greeting=Hello\\tWorld
key\\ with\\ spaces : value
multi = first \\
        second
unicode = caf\\u00e9
spaced value here
empty
path=c:\\\\temp
`;
    const doc = parseProperties(text);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual({
      "app.name": "Desk",
      "app.greeting": "Hello\tWorld",
      "key with spaces": "value",
      multi: "first second",
      unicode: "café",
      spaced: "value here",
      empty: "",
      path: "c:\\temp",
    });
    expect(where(kid(root, "multi"))).toEqual(at(text, "multi"));
  });
});

describe("dotenv", () => {
  it("export, quotes and comments; every value is a secret", () => {
    const text = `# comment
export NAME=desk
QUOTED="hello\\nworld"
SINGLE='raw \\n text'
EMPTY=
INLINE=value # a comment
HASH=abc#def
MULTI="line one
line two"
`;
    const doc = parseEnv(text);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual({
      NAME: "desk",
      QUOTED: "hello\nworld",
      SINGLE: "raw \\n text",
      EMPTY: "",
      INLINE: "value",
      HASH: "abc#def",
      MULTI: "line one\nline two",
    });
    expect(childrenOf(root).every((n) => n.secret === true)).toBe(true);
    expect(where(kid(root, "NAME"))).toEqual(at(text, "NAME"));
  });

  it("a line it cannot read is an error at that line", () => {
    const doc = parseEnv("A=1\n=nothing\n");
    expect(doc.errors[0]).toMatchObject({ line: 2 });
  });
});
