// @vitest-environment jsdom
// A whole export's .xlsx (PG-64): the sheet streamed in batches through a zip with a data descriptor
// reads back as the workbook the result's export writes at once, its cells typed alike, and past a
// sheet's 1,048,576 rows it stops with a sentence.
import { describe, expect, it } from "vitest";
import { optionsOf } from "../ui/export/options.js";
import { createPipe } from "../ui/export/pipe.js";
import { xlsxOf } from "../ui/export/xlsx.js";
import { xlsxWriter } from "../ui/export/xlsx-stream.js";
import { readXlsx, unzip } from "./export-reader";

const META = {
  columns: ["id", "at", "name"],
  oids: [20, 1114, 25],
  types: ["bigint", "timestamp without time zone", "text"],
};
const rows = Array.from({ length: 250 }, (_, i) => [
  String(i + 1),
  `2026-11-${String((i % 28) + 1).padStart(2, "0")} 09:00:00`,
  i % 9 === 0 ? null : `name ${i} <&>`,
]);
const copyText = rows.map((r) => `${r.map((v) => v ?? "\\N").join("\t")}\n`).join("");
const join = (outs: { content: string; encoding: string }[]) =>
  new Uint8Array(
    Buffer.concat(
      outs.map((o) => Buffer.from(o.content, o.encoding === "base64" ? "base64" : "utf8")),
    ),
  );

describe("a streamed workbook", () => {
  it("a streamed workbook reads back as the whole one", async () => {
    const options = optionsOf("xlsx", { null: "" });
    const pipe = createPipe({ format: "xlsx", options, meta: META, sheet: "items" });
    const outs = [];
    for (let at = 0; at < copyText.length; at += 997)
      outs.push(...(await pipe.push({ data: copyText.slice(at, at + 997) })));
    outs.push(...(await pipe.end()));
    const streamed = join(outs);
    const whole = await xlsxOf(
      [{ name: "items", columns: META.columns, rows, oids: META.oids, types: META.types }],
      options,
    );
    const [a] = readXlsx(streamed);
    const [b] = readXlsx(whole);
    expect(a?.name).toBe("items");
    expect(a?.frozen).toBe(true);
    expect([...(a?.cells ?? [])]).toEqual([...(b?.cells ?? [])]);
    expect(new TextDecoder().decode(unzip(streamed).get("xl/worksheets/sheet1.xml")?.data)).toBe(
      new TextDecoder().decode(unzip(whole).get("xl/worksheets/sheet1.xml")?.data),
    );
    expect(pipe.rows()).toBe(250);
  });

  it("past 1,048,576 rows it refuses", async () => {
    const w = xlsxWriter(META, { header: true, null: "" }, "big");
    await w.head();
    const batch = Array.from({ length: 100_000 }, () => ["1", null, "x"]);
    let failed = "";
    try {
      for (let i = 0; i < 11; i++) await w.rows(batch);
    } catch (error) {
      failed = (error as Error).message;
    }
    expect(failed).toBe(
      "Export: big has more than 1,048,576 rows, as many as a sheet holds. Export as CSV instead.",
    );
  }, 60_000);
});
