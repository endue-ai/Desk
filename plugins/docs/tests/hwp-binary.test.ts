import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeHwp } from "./hwp";
import { asDocument, headings, tableTexts, texts } from "./model";

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
