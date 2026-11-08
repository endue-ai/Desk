import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeKoreanRtf, makeRtf } from "./fixtures";
import { asDocument, SAME, summary, texts } from "./model";

describe("RTF", () => {
  it("gives the same model as every other format", async () => {
    const doc = asDocument(await openDocument(makeRtf(), "~/Documents/report.rtf"));
    expect(doc).toMatchObject({ format: "rtf", textOnly: false });
    expect(summary(doc)).toEqual(SAME);
    expect(doc.sections[0]).toMatchObject({ width: 595.3, height: 841.9 });
    expect(doc.sections[0]?.margins).toMatchObject({ top: 56.7, left: 56.7 });
  });

  it("\\ansicpg949 bytes and \\uN give Korean text", async () => {
    const doc = asDocument(await openDocument(makeKoreanRtf(), "~/Documents/korean.rtf"));
    expect(texts(doc)).toEqual(["한글 문서", "한글"]);
  });

  it("is found by its first bytes whatever the name says", async () => {
    const doc = asDocument(await openDocument(makeRtf(), "~/Documents/report.doc"));
    expect(doc.format).toBe("rtf");
  });
});
