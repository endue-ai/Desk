// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeFodt, makeOdt, makeSxw } from "./fixtures";
import { asDocument, SAME, summary } from "./model";

describe("OpenDocument text", () => {
  it(".odt gives the same model as every other format", async () => {
    const doc = asDocument(await openDocument(await makeOdt(), "~/Documents/report.odt"));
    expect(doc).toMatchObject({ format: "odt", textOnly: false });
    expect(summary(doc)).toEqual(SAME);
    expect(doc.sections[0]).toMatchObject({ width: 595.3, height: 841.9 });
    expect(doc.sections[0]?.margins).toMatchObject({ top: 56.7, left: 56.7 });
  });

  it(".ott, a template, reads the same way", async () => {
    const bytes = await makeOdt("application/vnd.oasis.opendocument.text-template");
    const doc = asDocument(await openDocument(bytes, "~/Documents/report.ott"));
    expect(doc.format).toBe("ott");
    expect(summary(doc)).toEqual(SAME);
  });

  it(".fodt, flat XML with the image inline, gives the same model", async () => {
    const doc = asDocument(await openDocument(makeFodt(), "~/Documents/report.fodt"));
    expect(doc.format).toBe("fodt");
    expect(summary(doc)).toEqual(SAME);
  });

  it(".sxw, OpenOffice.org 1.0, gives the same model", async () => {
    const doc = asDocument(await openDocument(await makeSxw(), "~/Documents/report.sxw"));
    expect(doc.format).toBe("sxw");
    expect(summary(doc)).toEqual(SAME);
  });
});
