import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { asDocument, tableTexts, texts } from "./model";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

describe("Word 97-2003 (.doc)", () => {
  it("the piece table gives the paragraphs and the table cells, as text only", async () => {
    const doc = asDocument(await openDocument(fixture("report.doc"), "~/Documents/report.doc"));
    expect(doc).toMatchObject({ format: "doc", textOnly: true });
    expect(texts(doc)).toEqual([
      "Annual report",
      "Sales rose sharply this year.",
      "Region",
      "Total",
      "North",
      "42",
      "연간 보고서의 한글 문단.",
    ]);
    expect(tableTexts(doc)).toEqual([
      [
        ["Region", "Total"],
        ["North", "42"],
      ],
    ]);
  });

  it("a .dot template reads the same way", async () => {
    const doc = asDocument(await openDocument(fixture("report.doc"), "~/Documents/report.dot"));
    expect(doc).toMatchObject({ format: "dot", textOnly: true });
  });
});
