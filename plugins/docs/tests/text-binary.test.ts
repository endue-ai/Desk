import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { makeWpd, makeWps } from "./fixtures";
import { asDocument, texts } from "./model";

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
