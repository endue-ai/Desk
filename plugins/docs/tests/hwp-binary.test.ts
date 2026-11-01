import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeHwp } from "./hwp";
import { asDocument, headings, tableTexts, texts } from "./model";
import { PNG } from "./zip";

describe("Hangul HWP 5.0 (.hwp)", () => {
  it("the deflated BodyText sections give the full document, not text only", async () => {
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
    expect(doc).toMatchObject({
      format: "hwp",
      formatName: "Hangul document (HWP 5.0)",
      textOnly: false,
    });
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

  it("a distribution document opens the details view with its first-page preview", async () => {
    const bytes = await makeHwp([{ text: "배포용 문서" }], { distribution: true, preview: PNG });
    const opened = await openDocument(bytes, "~/Documents/공고.hwp");
    expect(opened).toMatchObject({
      kind: "details",
      format: "hwp",
      reason: "This Hangul document is a distribution copy, whose text is encrypted.",
    });
    expect(opened.kind === "details" && opened.preview?.src).toMatch(/^data:image\/png;base64,/);
  });

  it("a distribution document without a preview still says why", async () => {
    const opened = await openDocument(
      await makeHwp([{ text: "배포용 문서" }], { distribution: true }),
      "~/Documents/공고.hwp",
    );
    expect(opened).toMatchObject({
      kind: "details",
      reason: expect.stringMatching(/distribution/),
    });
    expect(opened.kind === "details" && opened.preview).toBeUndefined();
  });
});
