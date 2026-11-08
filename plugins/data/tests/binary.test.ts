import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { parseBson } from "../ui/parse/bson.js";
import { parseCbor } from "../ui/parse/cbor.js";
import { parseMsgpack } from "../ui/parse/msgpack.js";
import { rawLines } from "../ui/raw.js";
import { childrenOf, plainOf } from "../ui/tree.js";
import { kid, rootOf } from "./nodes";

const bytes = (...parts: Array<number | number[] | string>) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else if (typeof part === "string") out.push(...new TextEncoder().encode(part));
    else out.push(...part);
  }
  return new Uint8Array(out);
};
const f64 = (n: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  return [...new Uint8Array(view.buffer)];
};
const le = (n: number | bigint, size: number) => {
  const view = new DataView(new ArrayBuffer(size));
  if (size === 4) view.setInt32(0, Number(n), true);
  else view.setBigInt64(0, BigInt(n), true);
  return [...new Uint8Array(view.buffer)];
};
const leF64 = (n: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n, true);
  return [...new Uint8Array(view.buffer)];
};

describe("MessagePack", () => {
  it("maps, arrays, strings, integers, floats, booleans, nil, bin and the timestamp ext", () => {
    const data = bytes(
      0x8a, // fixmap of 10
      0xa4,
      "name",
      0xa4,
      "desk",
      0xa1,
      "n",
      0x01,
      0xa3,
      "neg",
      0xfb,
      0xa1,
      "f",
      0xcb,
      f64(1.5),
      0xa2,
      "ok",
      0xc3,
      0xa3,
      "nil",
      0xc0,
      0xa3,
      "bin",
      0xc4,
      0x03,
      [1, 2, 3],
      0xa3,
      "arr",
      0x92,
      0x01,
      0xa1,
      "x",
      0xa3,
      "big",
      0xcf,
      [0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      0xa4,
      "when",
      0xd6,
      0xff,
      [0x00, 0x00, 0x00, 0x00],
    );
    const doc = parseMsgpack(data);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toMatchObject({
      name: "desk",
      n: 1,
      neg: -5,
      f: 1.5,
      ok: true,
      nil: null,
      bin: new Uint8Array([1, 2, 3]),
      arr: [1, "x"],
      when: "1970-01-01T00:00:00Z",
    });
    expect(kid(root, "big")).toMatchObject({ kind: "number", value: "9223372036854775807" });
    expect(kid(root, "when").kind).toBe("date");
    expect(kid(root, "name").offset).toBe(1);
  });

  it("a cut value is an error that keeps what decoded", () => {
    const doc = parseMsgpack(bytes(0x92, 0x01, 0xa5, "ab"));
    expect(doc.errors).toHaveLength(1);
    expect(plainOf(rootOf(doc))).toEqual([1]);
  });
});

describe("CBOR (RFC 8949)", () => {
  it("tags, indefinite lengths and half floats", () => {
    const data = bytes(
      0xa7, // map of 7
      0x64,
      "half",
      0xf9,
      [0x3e, 0x00], // 1.5
      0x63,
      "inf",
      0xf9,
      [0x7c, 0x00],
      0x64,
      "list",
      0x9f,
      0x01,
      0x02,
      0x03,
      0xff, // indefinite array
      0x64,
      "text",
      0x7f,
      0x62,
      "ab",
      0x61,
      "c",
      0xff, // indefinite text
      0x64,
      "when",
      0xc1,
      0x1a,
      [0x00, 0x00, 0x00, 0x3c], // tag 1, 60 s
      0x63,
      "big",
      0xc2,
      0x49,
      [0x01, 0, 0, 0, 0, 0, 0, 0, 0], // tag 2, 2^64
      0x64,
      "undf",
      0xf7,
    );
    const doc = parseCbor(data);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(plainOf(root)).toMatchObject({
      half: 1.5,
      inf: Number.POSITIVE_INFINITY,
      list: [1, 2, 3],
      text: "abc",
      when: "1970-01-01T00:01:00Z",
      undf: null,
    });
    expect(kid(root, "when")).toMatchObject({ kind: "date", tag: "tag 1" });
    expect(kid(root, "big")).toMatchObject({
      kind: "number",
      value: "18446744073709551616",
      tag: "tag 2",
    });
    expect(kid(root, "undf").tag).toBe("undefined");
    const tagged = rootOf(parseCbor(bytes(0xd8, 0x20, 0x63, "a:b")));
    expect(tagged).toMatchObject({ kind: "string", value: "a:b", tag: "tag 32" });
    expect(parseCbor(bytes(0x9f, 0x01)).errors).toHaveLength(1);
  });
});

describe("BSON", () => {
  it("documents, arrays and the common element types", () => {
    const element = (type: number, name: string, ...value: Array<number | number[] | string>) =>
      bytes(type, name, 0x00, ...value);
    const cstr = (s: string) => [...new TextEncoder().encode(s), 0];
    const str = (s: string) => [...le(s.length + 1, 4), ...cstr(s)];
    const doc = (...elements: Uint8Array[]) => {
      const body = elements.flatMap((e) => [...e]);
      return [...le(body.length + 5, 4), ...body, 0];
    };
    const data = new Uint8Array(
      doc(
        element(0x02, "name", str("desk")),
        element(0x10, "n", le(7, 4)),
        element(0x12, "big", le(9007199254740993n, 8)),
        element(0x01, "d", leF64(1.5)),
        element(0x08, "ok", 0x01),
        element(0x0a, "nil"),
        element(0x09, "when", le(1000, 8)),
        element(0x07, "id", [0x65, 0x43, 0x21, 0x00, 0, 0, 0, 0, 0, 0, 0, 1]),
        element(0x05, "bin", le(2, 4), 0x00, [0xca, 0xfe]),
        element(0x04, "arr", doc(element(0x10, "0", le(1, 4)), element(0x02, "1", str("x")))),
        element(0x03, "sub", doc(element(0x02, "k", str("v")))),
      ),
    );
    const parsed = parseBson(data);
    expect(parsed.errors).toEqual([]);
    const root = rootOf(parsed);
    expect(plainOf(root)).toMatchObject({
      name: "desk",
      n: 7,
      d: 1.5,
      ok: true,
      nil: null,
      when: "1970-01-01T00:00:01Z",
      id: "654321000000000000000001",
      bin: new Uint8Array([0xca, 0xfe]),
      arr: [1, "x"],
      sub: { k: "v" },
    });
    expect(kid(root, "big").value).toBe("9007199254740993");
    expect(kid(root, "id").tag).toBe("ObjectId");
    expect(kid(root, "arr").kind).toBe("array");
    expect(childrenOf(kid(root, "arr")).map((n) => n.key)).toEqual([0, 1]);
  });
});

describe("the raw view of binary data", () => {
  it("is a hex dump with offsets", () => {
    const opened = openFile("dump.msgpack", bytes(0x82, 0xa1, "a", 0x01, 0xa1, "b", 0xc3));
    expect(opened.format).toBe("msgpack");
    const raw = rawLines(opened);
    expect(raw.count).toBe(1);
    expect(raw.text(1)).toBe(`00000000  ${"82 a1 61 01 a1 62 c3".padEnd(47)}  |..a..b.|`);
    const long = rawLines(openFile("x.cbor", new Uint8Array(40).fill(0x41)));
    expect(long.count).toBe(3);
    expect(long.text(3)).toBe(`00000020  ${"41 41 41 41 41 41 41 41".padEnd(47)}  |AAAAAAAA|`);
  });
});
