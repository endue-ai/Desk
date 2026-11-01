import { existsSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { openBook } from "../ui/book.js";
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
    const messages: any[] = [];
    const transferred: ArrayBuffer[] = [];
    try {
      const complete = new Promise<void>((resolve) => {
        port1.on("message", (message) => {
          messages.push(message);
          if (message.type === "done") resolve();
        });
      });
      handleOpen({ bytes: fixture(name), name }, (message: any, buffers: ArrayBuffer[] = []) => {
        port2.postMessage(message, buffers);
        transferred.push(...buffers);
      });
      await complete;
      expect(transferred.length).toBeGreaterThan(0);
      expect(transferred.every((buffer) => buffer.byteLength === 0)).toBe(true);
      const sheets = messages.filter((m) => m.type === "sheet").map((m) => unpackSheet(m.sheet));
      expect(sheets.map((s) => s.name)).toEqual(before.sheets.map((s) => s.name));
      expect(messages.at(-1)?.type).toBe("done");
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
