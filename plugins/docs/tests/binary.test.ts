import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeWpd, makeWps } from "./fixtures";
import { makeHwp } from "./hwp";
import { asDocument, headings, tableTexts, texts } from "./model";

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

describe("Hangul HWP 5.0 (.hwp)", () => {
  it("the deflated BodyText sections give paragraphs, headings and table cells", async () => {
    const bytes = await makeHwp([
      { text: "연간 보고서", shape: 1 },
      { text: "매출이 크게 늘었다." },
      {
        table: [
          ["지역", "합계"],
          ["북부", "42"],
        ],
      },
      { text: "끝." },
    ]);
    const doc = asDocument(await openDocument(bytes, "~/Documents/보고서.hwp"));
    expect(doc).toMatchObject({ format: "hwp", textOnly: true });
    expect(texts(doc)).toEqual([
      "연간 보고서",
      "매출이 크게 늘었다.",
      "지역",
      "합계",
      "북부",
      "42",
      "끝.",
    ]);
    expect(headings(doc)).toEqual([{ level: 1, text: "연간 보고서" }]);
    expect(tableTexts(doc)).toEqual([
      [
        ["지역", "합계"],
        ["북부", "42"],
      ],
    ]);
    expect(doc.sections[0]).toMatchObject({ width: 595.3, height: 841.9 });
  });
});

describe("best-effort text", () => {
  it("WordPerfect gives its text, marked text only", async () => {
    const doc = asDocument(await openDocument(makeWpd(), "~/Documents/letter.wpd"));
    expect(doc).toMatchObject({ format: "wpd", textOnly: true });
    expect(texts(doc)).toEqual(["First paragraph of WordPerfect text.", "Café second."]);
  });

  it("Works gives its text, marked text only", async () => {
    const doc = asDocument(await openDocument(makeWps(), "~/Documents/letter.wps"));
    expect(doc).toMatchObject({ format: "wps", textOnly: true });
    expect(texts(doc)).toEqual(["Works first line", "Works second line"]);
  });
});
