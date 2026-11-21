// What Eris reads through Sheets (ADR 0088): a range of the spreadsheet on screen as cell text, the
// sheets it holds, its formulas when asked, and a sentence when there is none to read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { rangeOf } from "../ui/agent.js";
import { disk, file, mount } from "./harness";

const A = file("~/Documents/cities.csv");
const csv = new TextEncoder().encode("city,people\nSeoul,9.4\nBusan,3.3\nDaegu,2.4\n");

describe("endue.sheets.read", () => {
  it("reads the filled part, a range, and says when the sheet goes on", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: csv }) });
    await expect(host.command("endue.sheets.read")).rejects.toThrow(/No spreadsheet is open/);
    await host.command("desk.files.visit", A);
    const all = (await host.command("endue.sheets.read")) as Record<string, unknown>;
    expect(all).toMatchObject({
      path: A.path,
      range: "A1:B4",
      values: [
        ["city", "people"],
        ["Seoul", "9.4"],
        ["Busan", "3.3"],
        ["Daegu", "2.4"],
      ],
      more: false,
      unsaved: false,
    });
    expect(all.sheets).toEqual([{ name: expect.any(String), rows: 4, cols: 2 }]);
    const part = await host.command("endue.sheets.read", { range: "A2:A3" });
    expect(part).toMatchObject({ range: "A2:A3", values: [["Seoul"], ["Busan"]], more: false });
    const past = await host.command("endue.sheets.read", { range: "B3:F9" });
    expect(past).toMatchObject({ range: "B3:B4", values: [["3.3"], ["2.4"]], more: false });
    await expect(host.command("endue.sheets.read", { sheet: "Nope" })).rejects.toThrow(
      /Nope is not a sheet/,
    );
  });

  it("reads A1 ranges, either way round, and refuses what is not one", () => {
    expect(rangeOf("B2:A1")).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(rangeOf("AA10")).toEqual({ r0: 9, c0: 26, r1: 9, c1: 26 });
    expect(() => rangeOf("row 3")).toThrow(/not a range/);
  });

  it("is offered to agents as a read", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    const read = manifest.contributes?.commands?.find((c) => c.id === "endue.sheets.read");
    expect(read).toMatchObject({
      agent: true,
      readOnly: true,
      args: { additionalProperties: false },
    });
  });
});
