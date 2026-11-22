// @vitest-environment jsdom
// An .xlsx written by the plugin reads back (PG-61, ui/export/xlsx.js, cells.js, zip.js, file.js):
// unzipped (each entry's CRC-32 checked) and parsed again, one sheet per result named safely,
// numbers that survive a double exactly as number cells and the rest as text, dates and
// timestamps as date cells, text with control characters and NULL; stored and deflated; a large
// result written in the worker with the same bytes.
import { describe, expect, it } from "vitest";
import { exactNumber, kindsOf, serialOf } from "../ui/export/cells.js";
import { writeFile } from "../ui/export/client.js";
import { answerJob } from "../ui/export/file.js";
import { defaultsOf, optionsOf } from "../ui/export/options.js";
import { columnName, sheetNames, xlsxOf } from "../ui/export/xlsx.js";
import { isoOf, readXlsx, unzip } from "./export-reader";

const sheet = {
  name: "public.orders",
  columns: ["id", "price", "big", "day", "at", "zoned", "note"],
  rows: [
    [
      "1",
      "19.99",
      "9007199254740993",
      "2026-11-07",
      "2026-11-07 09:05:03",
      "2026-11-07 09:05:03+09",
      "plain",
    ],
    [
      "2",
      "-0.000125",
      "1234567890.12345",
      "1900-03-01",
      "2026-11-07 09:05:03.250",
      "x",
      "tab\there\nline",
    ],
    [
      "3",
      "1e20",
      "0.1",
      "1899-12-31",
      "2026-11-07 09:05:03.123456",
      null,
      "bell\u0007 _x0041_ <&>",
    ],
    [null, null, null, null, null, null, ""],
  ] as (string | null)[][],
};
const bytesOf = (content: string) => Uint8Array.from(atob(content), (c) => c.charCodeAt(0));

describe("an .xlsx file reads back", () => {
  it("types each cell: exact numbers, dates, timestamps, and text for the rest", async () => {
    const [read] = readXlsx(await xlsxOf([sheet], { header: true, null: "" }));
    const cell = (ref: string) => read?.cells.get(ref);
    expect(read?.name).toBe("public.orders");
    expect(read?.frozen).toBe(true);
    // The header row, bold.
    expect(cell("A1")).toEqual({ t: "s", v: "id", style: 4 });
    expect(cell("A2")).toEqual({ t: "n", v: "1", style: 0 });
    expect(cell("B2")).toEqual({ t: "n", v: "19.99", style: 0 });
    expect(cell("B3")?.v).toBe("-0.000125");
    expect(cell("B4")).toMatchObject({ t: "n", v: "1e20" });
    // Past 15 significant digits (and so past 2^53) a number is text, as it was sent.
    expect(cell("C2")).toEqual({ t: "s", v: "9007199254740993", style: 0 });
    expect(cell("C3")).toMatchObject({ t: "n", v: "1234567890.12345" });
    // Dates and timestamps: date cells whose serial gives back the same time.
    expect(cell("D2")).toMatchObject({ t: "d", style: 1 });
    expect(isoOf(cell("D2")?.v ?? "")).toBe("2026-11-07 00:00:00.000");
    expect(isoOf(cell("D3")?.v ?? "")).toBe("1900-03-01 00:00:00.000");
    expect(cell("D4")).toMatchObject({ t: "s", v: "1899-12-31" });
    expect(cell("E2")).toMatchObject({ t: "d", style: 2 });
    expect(isoOf(cell("E2")?.v ?? "")).toBe("2026-11-07 09:05:03.000");
    expect(cell("E3")).toMatchObject({ t: "d", style: 3 });
    expect(isoOf(cell("E3")?.v ?? "")).toBe("2026-11-07 09:05:03.250");
    // Microseconds and time zones stay text.
    expect(cell("E4")).toMatchObject({ t: "s", v: "2026-11-07 09:05:03.123456" });
    expect(cell("F2")).toMatchObject({ t: "s", v: "2026-11-07 09:05:03+09" });
    // Text as it was, control characters and a literal _x0041_ included; NULL an empty cell.
    expect(cell("G3")?.v).toBe("tab\there\nline");
    expect(cell("G4")?.v).toBe("bell\u0007 _x0041_ <&>");
    expect(cell("A5")).toBeUndefined();
    expect(cell("G5")).toEqual({ t: "s", v: "", style: 0 });
  });

  it("writes NULL as its text when one is given, and no header when asked", async () => {
    const [read] = readXlsx(await xlsxOf([sheet], { header: false, null: "NULL" }));
    expect(read?.frozen).toBe(false);
    expect(read?.cells.get("A1")).toMatchObject({ t: "n", v: "1" });
    expect(read?.cells.get("A4")).toMatchObject({ t: "s", v: "NULL" });
  });

  it("puts one sheet per result, each name safe and unique", async () => {
    const two = [
      { ...sheet, name: "a/b:c*?[d]" },
      { ...sheet, name: "A/B:C*?[D]" },
      { ...sheet, name: "" },
    ];
    const read = readXlsx(await xlsxOf(two, defaultsOf("xlsx")));
    expect(read.map((s) => s.name)).toEqual(["a b c   d", "A B C   D (2)", "Result 3"]);
    expect(sheetNames(["x".repeat(40), "x".repeat(40)])).toEqual([
      "x".repeat(31),
      `${"x".repeat(27)} (2)`,
    ]);
    expect([columnName(0), columnName(25), columnName(26), columnName(16383)]).toEqual([
      "A",
      "Z",
      "AA",
      "XFD",
    ]);
  });

  it("is a valid zip stored or deflated, the same cells either way", async () => {
    const stored = await xlsxOf([sheet], defaultsOf("xlsx"), { deflate: false });
    const packed = await xlsxOf([sheet], defaultsOf("xlsx"));
    expect([...unzip(stored).values()].every((f) => f.method === 0)).toBe(true);
    expect([...unzip(packed).values()].some((f) => f.method === 8)).toBe(true);
    expect(packed.length).toBeLessThan(stored.length);
    expect(readXlsx(packed)[0]?.cells).toEqual(readXlsx(stored)[0]?.cells);
    // The same files make the same bytes.
    expect(await xlsxOf([sheet], defaultsOf("xlsx"))).toEqual(packed);
  });

  it("takes each column's kind from its PostgreSQL type before its values", () => {
    const rows = [["007", "2026-01-01", "12"]];
    // text, date and numeric OIDs; then the declared names; then the values.
    expect(kindsOf(rows, 3, [25, 1082, 1700], [])).toEqual(["text", "date", "number"]);
    expect(kindsOf(rows, 3, [], ["character varying", "date", "bigint"])).toEqual([
      "text",
      "date",
      "number",
    ]);
    expect(
      kindsOf(
        [
          ["1", "x"],
          ["2.5", "3"],
        ],
        2,
        [],
        [],
      ),
    ).toEqual(["number", "text"]);
    expect([
      exactNumber("123456789012345"),
      exactNumber("1234567890123456"),
      exactNumber("0.000"),
    ]).toEqual([true, false, true]);
    expect([serialOf("2026-02-30"), serialOf("2026-11-07 24:00:00")]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("refuses past a cell's 32,767 characters with a sentence", async () => {
    const long = { ...sheet, rows: [["1", "1", "1", null, null, null, "y".repeat(32_768)]] };
    await expect(xlsxOf([long], defaultsOf("xlsx"))).rejects.toThrow(
      "Export: public.orders!G2 holds 32768 characters; a cell holds 32767. Export as CSV instead.",
    );
  });

  it("writes a large result in the worker, the same bytes as in the frame", async () => {
    const large = {
      columns: ["n", "label"],
      rows: Array.from({ length: 12_000 }, (_, i) => [String(i), `row ${i}`]),
      truncated: false,
      types: [23, 25],
    };
    const job = {
      format: "xlsx" as const,
      options: optionsOf("xlsx"),
      parts: [{ name: "big", set: large, base: {} }],
    };
    const started: string[] = [];
    const startWorker = (url: URL) => {
      started.push(url.pathname.split("/").at(-1) ?? "");
      const worker = {
        onmessage: null as null | ((e: { data: unknown }) => void),
        onerror: null,
        postMessage: (message: unknown) => {
          void answerJob(structuredClone(message) as never).then((data) =>
            worker.onmessage?.({ data }),
          );
        },
        terminate: () => started.push("ended"),
      };
      return worker as unknown as Worker;
    };
    const inWorker = await writeFile(job, startWorker);
    expect(started).toEqual(["worker.js", "ended"]);
    const inFrame = await writeFile(job);
    expect(inWorker).toEqual(inFrame);
    expect(inWorker).toMatchObject({ encoding: "base64", rows: 12_000 });
    const [read] = readXlsx(bytesOf(inWorker.content));
    expect(read?.cells.get("A12001")).toMatchObject({ t: "n", v: "11999" });
    expect(read?.cells.get("B2")).toMatchObject({ t: "s", v: "row 0" });
  });
});
