import { describe, expect, it } from "vitest";
import { parseToml } from "../ui/parse/toml.js";
import { childrenOf, plainOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, rootOf, where } from "./nodes";

const EXAMPLE = `# This is a TOML document

title = "TOML Example"

[owner]
name = "Tom Preston-Werner"
dob = 1979-05-27T07:32:00-08:00

[database]
enabled = true
ports = [ 8000, 8001, 8002 ]
data = [ ["delta", "phi"], [3.14] ]
temp_targets = { cpu = 79.5, case = 72.0 }

[servers]

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"
`;

describe("TOML 1.0", () => {
  it("reads the example from toml.io into the typed tree with positions", () => {
    const doc = parseToml(EXAMPLE);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toEqual({
      title: "TOML Example",
      owner: { name: "Tom Preston-Werner", dob: "1979-05-27T07:32:00-08:00" },
      database: {
        enabled: true,
        ports: [8000, 8001, 8002],
        data: [["delta", "phi"], [3.14]],
        temp_targets: { cpu: 79.5, case: 72 },
      },
      servers: {
        alpha: { ip: "10.0.0.1", role: "frontend" },
        beta: { ip: "10.0.0.2", role: "backend" },
      },
    });
    expect(kid(root, "owner", "dob")).toMatchObject({ kind: "date", tag: "offset date-time" });
    expect(where(kid(root, "owner"))).toEqual(at(EXAMPLE, "[owner]"));
    expect(where(kid(root, "database", "ports", 1))).toEqual(at(EXAMPLE, "8001"));
    expect(where(kid(root, "servers", "beta", "role"))).toEqual(at(EXAMPLE, 'role = "backend"'));
  });

  it("arrays of tables, dotted keys and inline tables", () => {
    const text = `[[products]]
name = "Hammer"
sku = 738594937

[[products]]  # empty table within the array

[[products]]
name = "Nail"
sku = 284758393
color = "gray"

[fruit]
physical.color = "orange"
physical.shape = "round"
site."google.com" = true
point = { x = 1, y.z = 2 }

[[fruit.varieties]]
name = "red delicious"

[fruit.varieties.taste]
sweet = true
`;
    const doc = parseToml(text);
    expect(doc.errors).toEqual([]);
    expect(plainOf(rootOf(doc))).toEqual({
      products: [
        { name: "Hammer", sku: 738594937 },
        {},
        { name: "Nail", sku: 284758393, color: "gray" },
      ],
      fruit: {
        physical: { color: "orange", shape: "round" },
        site: { "google.com": true },
        point: { x: 1, y: { z: 2 } },
        varieties: [{ name: "red delicious", taste: { sweet: true } }],
      },
    });
    expect(where(kid(rootOf(doc), "products", 2))).toEqual(at(text, '[[products]]\nname = "Nail"'));
  });

  it("every kind of string", () => {
    const text = `basic = "tab\\tquote\\" \\u00E9 \\U0001F600"
multi = """
Roses are red
Violets are blue"""
trimmed = """\\
  The quick brown \\
  fox."""
literal = 'C:\\Users\\nodejs'
multiliteral = '''
The first newline is
trimmed in raw strings.
   All other whitespace
   is preserved.
'''
`;
    const doc = parseToml(text);
    expect(doc.errors).toEqual([]);
    expect(plainOf(rootOf(doc))).toEqual({
      basic: 'tab\tquote" é 😀',
      multi: "Roses are red\nViolets are blue",
      trimmed: "The quick brown fox.",
      literal: "C:\\Users\\nodejs",
      multiliteral:
        "The first newline is\ntrimmed in raw strings.\n   All other whitespace\n   is preserved.\n",
    });
  });

  it("integers, floats and booleans keep how they were written", () => {
    const text =
      "a = +99\nb = -17\nc = 1_000\nd = 0xDEAD_beef\ne = 0o755\nf = 0b11010110\ng = 6.626e-34\nh = inf\ni = -nan\nj = 9007199254740993\nk = false\n";
    const root = rootOf(parseToml(text));
    expect(plainOf(root)).toMatchObject({
      a: 99,
      b: -17,
      c: 1000,
      d: 0xdeadbeef,
      e: 0o755,
      f: 0b11010110,
      g: 6.626e-34,
      h: Number.POSITIVE_INFINITY,
      k: false,
    });
    expect(kid(root, "c").value).toBe("1_000");
    expect(kid(root, "j").value).toBe("9007199254740993");
    expect(childrenOf(root).map((n) => n.kind)).toEqual([...Array(10).fill("number"), "boolean"]);
  });

  it("offset and local dates and times", () => {
    const root = rootOf(
      parseToml(
        "odt1 = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27 07:32:00.999-07:00\nldt = 1979-05-27T07:32:00\nld = 1979-05-27\nlt = 07:32:00.5\n",
      ),
    );
    expect(childrenOf(root).map((n) => [n.kind, n.tag])).toEqual([
      ["date", "offset date-time"],
      ["date", "offset date-time"],
      ["date", "local date-time"],
      ["date", "local date"],
      ["date", "local time"],
    ]);
    expect(kid(root, "odt2").value).toBe("1979-05-27 07:32:00.999-07:00");
  });

  it("a key defined twice is an error at its line, after what parsed", () => {
    const text = 'name = "a"\n[t]\nx = 1\nx = 2\ny = 3\n';
    const doc = parseToml(text);
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]).toMatchObject({ line: 4, col: 1 });
    expect(plainOf(rootOf(doc))).toEqual({ name: "a", t: { x: 1 } });
  });

  it("a bad value is an error at its column", () => {
    const doc = parseToml("ok = 1\nbad = [1, 2\n");
    expect(doc.errors[0]?.line).toBeGreaterThanOrEqual(2);
    expect(plainOf(rootOf(doc))).toMatchObject({ ok: 1 });
    expect(parseToml("a = 1979-13-45\n").errors).toHaveLength(1);
    expect(parseToml("a = 'unterminated\n").errors[0]).toMatchObject({ line: 1 });
  });
});
