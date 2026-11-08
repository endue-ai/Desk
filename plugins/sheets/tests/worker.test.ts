import { existsSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { openBook } from "../ui/book.js";
import type { Reply } from "../ui/worker.js";
import { fixture } from "./harness";

// Exercise the worker's real message boundary, including transfer ownership, without a browser.
describe.each(["budget.xlsx", "budget.ods", "budget.csv"])("worker %s", (name) => {
  it("sends sheets in order as transferable cell data and preserves the workbook model", async () => {
    expect(
      existsSync(join(import.meta.dirname, "../ui/worker.js")),
      "a parsing worker is provided",
    ).toBe(true);
    const { handleOpen } = await import("../ui/worker.js");
    const { unpackSheet } = await import("../ui/wire.js");
    const before = openBook(fixture(name), { name });
    expect(before.kind).toBe("sheets");
    if (before.kind !== "sheets") return;
    const { port1, port2 } = new MessageChannel();
    const messages: Reply[] = [];
    const transferred: ArrayBuffer[] = [];
    try {
      const complete = new Promise<void>((resolve) => {
        port1.on("message", (message) => {
          messages.push(message);
          if (message.type === "done") resolve();
        });
      });
      handleOpen({ bytes: fixture(name), name }, (message: Reply, buffers: ArrayBuffer[] = []) => {
        port2.postMessage(message, buffers);
        transferred.push(...buffers);
      });
      await complete;
      expect(transferred.length).toBeGreaterThan(0);
      expect(transferred.every((buffer) => buffer.byteLength === 0)).toBe(true);
      const sheets = messages.filter((m) => m.type === "sheet").map((m) => unpackSheet(m.sheet));
      expect(sheets.map((s) => s.name)).toEqual(before.sheets.map((s) => s.name));
      expect(messages.at(-1)?.type).toBe("done");
      for (const sheet of sheets)
        for (const key of ["s", "r", "h"]) expect(sheet.cell(0, 0)).not.toHaveProperty(key);
      sheets.forEach((sheet, index) => {
        const old = before.sheets[index];
        if (!old) throw new Error("missing prior sheet");
        expect([sheet.rows, sheet.cols, sheet.merges, sheet.frozen]).toEqual([
          old.rows,
          old.cols,
          old.merges,
          old.frozen,
        ]);
        for (let r = 0; r < 10; r++)
          for (let c = 0; c < 6; c++) {
            expect([
              sheet.cell(r, c),
              sheet.text(r, c),
              sheet.input(r, c),
              sheet.style(r, c),
            ]).toEqual([old.cell(r, c), old.text(r, c), old.input(r, c), old.style(r, c)]);
            expect([
              sheet.height(r),
              sheet.width(c),
              sheet.hiddenRow(r),
              sheet.hiddenCol(c),
            ]).toEqual([old.height(r), old.width(c), old.hiddenRow(r), old.hiddenCol(c)]);
          }
      });
    } finally {
      port1.close();
      port2.close();
    }
  });
});

it("unique cell values do not create per-cell formatting objects in the transfer", async () => {
  const { createSheet } = await import("../ui/model.js");
  const { packSheet, unpackSheet } = await import("../ui/wire.js");
  const source = createSheet({
    name: "Many strings",
    rows: 2000,
    cols: 1,
    cellAt: (r, c) =>
      c
        ? undefined
        : {
            t: "s",
            v: `value ${r}`,
            w: `value ${r}`,
            z: "General",
            r: `<t>value ${r}</t>`,
            h: `value ${r}`,
          },
  });
  const packed = packSheet(source);
  expect(packed.metadata).toHaveLength(1);
  const result = unpackSheet(packed);
  expect(result.text(1999, 0)).toBe("value 1999");
  expect(result.cell(1999, 0)).toEqual({ t: "s", v: "value 1999", w: "value 1999", z: "General" });
});

it("preserves computed display text when the parser has no cached text", async () => {
  const { createSheet } = await import("../ui/model.js");
  const { packSheet, unpackSheet } = await import("../ui/wire.js");
  const source = createSheet({
    name: "Dates",
    rows: 1,
    cols: 1,
    cellAt: (r, c) => (r || c ? undefined : { t: "n", v: 45292, z: "yyyy-mm-dd" }),
    format: () => "2024-01-01",
  });
  const result = unpackSheet(packSheet(source));
  expect(result.cell(0, 0)).toEqual(source.cell(0, 0));
  expect(result.text(0, 0)).toBe("2024-01-01");
  expect(result.input(0, 0)).toBe("2024-01-01");
});
