// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeAbw } from "./fixtures";
import { asDocument, SAME, summary } from "./model";
import { gzip } from "./zip";

describe("AbiWord", () => {
  it("gives the same model as every other format", async () => {
    const doc = asDocument(await openDocument(makeAbw(), "~/Documents/report.abw"));
    expect(doc).toMatchObject({ format: "abw", textOnly: false });
    expect(summary(doc)).toEqual(SAME);
    expect(doc.sections[0]).toMatchObject({ width: 595.3, height: 841.9 });
    expect(doc.sections[0]?.margins).toMatchObject({ top: 72, left: 72 });
  });

  it("a gzip-compressed .abw reads the same", async () => {
    const doc = asDocument(await openDocument(await gzip(makeAbw()), "~/Documents/report.abw"));
    expect(summary(doc)).toEqual(SAME);
  });
});
