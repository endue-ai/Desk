import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertMinimalEdit, assertRoundTrip } from "./round-trip";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
// What the tests parse: the text, BOM and all (ignoreBOM keeps it), so a lossless serializer is
// `encode` and a lossy one is easy to write.
const keepBom = new TextDecoder("utf-8", { ignoreBOM: true });
const parse = (bytes: Uint8Array) => keepBom.decode(bytes);

/** The error `run` throws. */
function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("it did not throw");
}

const CSV = 'id,city,pop\r\n1,Seoul,9.7\r\n2,"Busan",3.4\r\n';

describe("assertRoundTrip", () => {
  it("passes a byte-identical round trip and returns the model", () => {
    const seen: unknown[] = [];
    const parseSeen = (bytes: Uint8Array) => {
      seen.push(bytes);
      return parse(bytes);
    };
    expect(assertRoundTrip(CSV, parseSeen, encode)).toBe(CSV);
    expect(assertRoundTrip(encode("﻿name\n"), parseSeen, encode)).toBe("﻿name\n");
    expect(assertRoundTrip(encode("x").buffer, parseSeen, (text) => encode(text).buffer)).toBe("x");
    expect(assertRoundTrip(new Uint8Array(), parseSeen, () => "")).toBe("");
    // parse always gets bytes, whatever came in.
    for (const bytes of seen) expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("names the first differing byte with hex and text windows", () => {
    const lf = thrown(() =>
      assertRoundTrip("a,b\r\nc,d\r\n", parse, (text) => text.replaceAll("\r\n", "\n")),
    );
    expect(lf.name).toBe("AssertionError");
    expect(lf.message).toContain("assertRoundTrip");
    expect(lf.message).toContain("10 bytes in, 8 out");
    expect(lf.message).toMatch(/first difference at byte 3 \(line 1, column 4\)/);
    expect(lf.message).toMatch(/bytes +@0 +61 2c 62 \[0d\] 0a 63/);
    expect(lf.message).toMatch(/result +@0 +61 2c 62 \[0a\] 63/);
    expect(lf.message).toContain('"a,b\\r\\nc,d\\r\\n"');
    expect(lf.message).toContain('"a,b\\nc,d\\n"');
    // Each change, by its offsets on both sides.
    expect(lf.message).toContain('bytes[3..4) "\\r" → result[3..3) ""');
    expect(lf.message).toContain('bytes[8..9) "\\r" → result[7..7) ""');

    // A decoder that drops the BOM: the first three bytes are gone.
    const bom = thrown(() => assertRoundTrip("﻿name,age\n", (bytes) => decode(bytes), encode));
    expect(bom.message).toMatch(/first difference at byte 0 \(line 1, column 1\)/);
    expect(bom.message).toMatch(/bytes +@0 +\[ef\] bb bf 6e/);
    expect(bom.message).toMatch(/result +@0 +\[6e\] 61 6d 65/);
    expect(bom.message).toContain('"\\ufeffname,age\\n"');
    expect(bom.message).toContain("bytes[0..3)");
  });

  it("shows the window around a difference deep in the file, and its line", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `row ${i},value ${i}\n`).join("");
    const error = thrown(() =>
      assertRoundTrip(lines, parse, (text) => text.replace("row 30,value 30", "row 30;value 30")),
    );
    const at = lines.indexOf("row 30,") + "row 30".length;
    expect(error.message).toContain(`first difference at byte ${at} (line 31, column 7)`);
    expect(error.message).toMatch(new RegExp(`bytes +@${at - 6} .*\\[2c\\]`));
    expect(error.message).toMatch(new RegExp(`result +@${at - 6} .*\\[3b\\]`));
    expect(error.message).toContain(`bytes[${at}..${at + 1}) "," → result[${at}..${at + 1}) ";"`);
  });

  it("says when the result only ends early or runs on", () => {
    const short = thrown(() => assertRoundTrip("abc\n", parse, (text) => text.trimEnd()));
    expect(short.message).toContain("4 bytes in, 3 out");
    expect(short.message).toMatch(/first difference at byte 3/);
    expect(short.message).toMatch(/result +@0 +61 62 63 \[end\]/);
  });

  it("lists the first changes and counts the rest, and stays quick on a large file", () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => `${i},city ${i}\r\n`).join("");
    const started = performance.now();
    const error = thrown(() =>
      assertRoundTrip(rows, parse, (text) => text.replaceAll("\r\n", "\n")),
    );
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(error.message).toMatch(/first difference at byte 8 \(line 1, column 9\)/);
    expect(error.message).toMatch(/too many changes to list one by one/);
  });

  it("awaits an async parse or serialize, and only then returns a promise", async () => {
    const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value)));
    await expect(assertRoundTrip(CSV, (bytes) => later(parse(bytes)), encode)).resolves.toBe(CSV);
    await expect(assertRoundTrip(CSV, parse, (text) => later(encode(text)))).resolves.toBe(CSV);
    await expect(
      assertRoundTrip(
        CSV,
        (bytes) => later(parse(bytes)),
        (text) => later(text.toUpperCase()),
      ),
    ).rejects.toThrow(/first difference at byte 0/);
    expect(assertRoundTrip(CSV, parse, encode)).not.toBeInstanceOf(Promise);
  });

  it("refuses a serializer that returns no bytes", () => {
    expect(() => assertRoundTrip("a", parse, () => undefined as unknown as string)).toThrow(
      TypeError,
    );
  });
});

describe("assertMinimalEdit", () => {
  const seoul = CSV.indexOf("Seoul");
  const edited = CSV.replace("Seoul", "Incheon");

  it("passes when only the allowed span changed", () => {
    // Replace: by offset, by find, and with what the span must become.
    assertMinimalEdit(CSV, edited, { offset: seoul, length: 5 });
    assertMinimalEdit(CSV, edited, { find: "Seoul" });
    assertMinimalEdit(encode(CSV), encode(edited).buffer, {
      find: encode("Seoul"),
      bytes: "Incheon",
    });
    // An unchanged file passes any span; a span may become nothing.
    assertMinimalEdit(CSV, CSV, { find: "Seoul" });
    assertMinimalEdit(CSV, CSV.replace("Seoul", ""), { find: "Seoul", bytes: "" });
    // Insert a row at the end, delete the first row.
    const row = "1,Seoul,9.7\r\n";
    assertMinimalEdit(CSV, `${CSV}3,Daegu,2.4\r\n`, { offset: CSV.length, length: 0 });
    assertMinimalEdit(CSV, CSV.replace(row, ""), { offset: CSV.indexOf(row), length: row.length });
    // Several spans at once, in any order.
    const two = edited.replace("3.4", "3.3");
    assertMinimalEdit(CSV, two, [{ find: "3.4", bytes: "3.3" }, { find: "Seoul" }]);
    // Offsets count bytes, not characters.
    assertMinimalEdit("도시,서울\n", "도시,부산\n", { offset: 7, length: 6, bytes: "부산" });
  });

  it("lists the ranges that changed outside the allowed span", () => {
    // The serializer also drops the quotes around another field.
    const requoted = edited.replace('"Busan"', "Busan");
    const error = thrown(() => assertMinimalEdit(CSV, requoted, { find: "Seoul" }));
    expect(error.name).toBe("AssertionError");
    expect(error.message).toContain("assertMinimalEdit");
    expect(error.message).toContain(`allowed: before[${seoul}..${seoul + 5}) "Seoul" → any bytes`);
    expect(error.message).toMatch(/first change outside it at before byte 28 \(line 3, column 3\)/);
    expect(error.message).toMatch(/before +@22 .*\[22\]/);
    expect(error.message).toContain('before[28..29) "\\"" → after[30..30) ""');
    expect(error.message).toContain('before[34..35) "\\"" → after[35..35) ""');
    // The span's own changes are not listed: only the two quotes.
    expect(error.message.match(/→ after\[/g)).toHaveLength(2);

    // Line endings rewritten everywhere: every CR is a change outside the span.
    const lf = thrown(() =>
      assertMinimalEdit(CSV, edited.replaceAll("\r\n", "\n"), { find: "Seoul", bytes: "Incheon" }),
    );
    expect(lf.message).toContain('allowed: before[15..20) "Seoul" → "Incheon"');
    expect(lf.message).toMatch(/first change outside it at before byte 11 \(line 1, column 12\)/);
    expect(lf.message).toContain('before[11..12) "\\r" → after[11..11) ""');
    expect(lf.message).toContain("before[24..25)");
    expect(lf.message).toContain("before[39..40)");
  });

  it("caps the list and counts the rest", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `${i},x\r\n`).join("");
    const after = rows.replace("0,x", "0,y").replaceAll("\r\n", "\n");
    const error = thrown(() => assertMinimalEdit(rows, after, { offset: 2, length: 1 }));
    expect(error.message).toContain("and 22 more");
  });

  it("says what a span became when it is not its bytes", () => {
    const error = thrown(() =>
      assertMinimalEdit(CSV, CSV.replace("Seoul", "Inchon"), { find: "Seoul", bytes: "Incheon" }),
    );
    expect(error.name).toBe("AssertionError");
    expect(error.message).toContain('before[15..20) became "Inchon", not "Incheon"');
  });

  it("refuses a span it cannot place", () => {
    expect(() => assertMinimalEdit(CSV, CSV, { offset: CSV.length, length: 1 })).toThrow(
      /outside before/,
    );
    expect(() => assertMinimalEdit(CSV, CSV, { offset: -1, length: 1 })).toThrow(/outside before/);
    expect(() =>
      assertMinimalEdit(CSV, CSV, [
        { offset: 0, length: 5 },
        { offset: 3, length: 4 },
      ]),
    ).toThrow(/overlap/);
    expect(() => assertMinimalEdit(CSV, CSV, { find: "Daegu" })).toThrow(/does not occur/);
    expect(() => assertMinimalEdit(CSV, CSV, { find: "," })).toThrow(/occurs 6 times/);
    expect(() => assertMinimalEdit(CSV, CSV, { find: "" })).toThrow(/empty/);
  });
});

describe("round-trip.ts", () => {
  it("loads in plain Node, without vitest or a bundler", () => {
    const url = new URL("./round-trip.ts", import.meta.url).href;
    const script = `
      import { assertRoundTrip, assertMinimalEdit } from ${JSON.stringify(url)};
      const text = new TextDecoder();
      const model = assertRoundTrip("a,b\\r\\n", (bytes) => text.decode(bytes), (s) => s);
      assertMinimalEdit("a,b\\r\\n", "a,c\\r\\n", { find: "b" });
      try {
        assertMinimalEdit("a,b\\r\\n", "a,c\\n", { find: "b" });
      } catch (error) {
        console.log(model, error.name);
      }`;
    const output = execFileSync(
      process.execPath,
      ["--no-warnings", "--input-type=module", "-e", script],
      { encoding: "utf8", cwd: fileURLToPath(new URL(".", import.meta.url)) },
    );
    expect(output.trim()).toBe("a,b\r\n AssertionError");
  });
});
