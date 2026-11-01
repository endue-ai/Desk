// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeHwpx } from "./hwp";
import { asDocument, SAME, summary } from "./model";

describe("Hangul HWPX (OWPML)", () => {
  it("gives the same model as every other format", async () => {
    const doc = asDocument(await openDocument(await makeHwpx(), "~/Documents/보고서.hwpx"));
    expect(doc).toMatchObject({ format: "hwpx", textOnly: false });
    expect(summary(doc)).toEqual(SAME);
  });

  it("character shapes give sizes and colours, the section its A4 page", async () => {
    const doc = asDocument(await openDocument(await makeHwpx(), "~/Documents/보고서.hwpx"));
    const [section] = doc.sections;
    expect(section).toMatchObject({ width: 595.3, height: 841.9 });
    expect(section?.margins).toMatchObject({ left: 85, right: 85 });
    const heading = section?.blocks[0];
    expect(heading).toMatchObject({ type: "paragraph", level: 1, align: "left" });
    expect(heading?.type === "paragraph" && heading.inlines[0]).toMatchObject({
      text: "Annual report",
      size: 16,
      color: "#1F3864",
    });
  });
});
