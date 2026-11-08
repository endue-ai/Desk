// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Details, Opened } from "../ui/model.js";
import { openDocument } from "../ui/open.js";
import { makeEncryptedDocx, makeEncryptedOdt, makeGdoc, makePages } from "./fixtures";
import { makeHwp } from "./hwp";
import { makeDocx } from "./ooxml-fixture";
import { PNG } from "./zip";

const details = (opened: Opened): Details => {
  if (opened.kind !== "details") throw new Error("expected the details view");
  return opened;
};
const JPEG_BIG = Uint8Array.from({ length: 400 }, (_, i) =>
  i < 3 ? ([0xff, 0xd8, 0xff][i] ?? 0) : i % 251,
);
const JPEG_SMALL = Uint8Array.from({ length: 40 }, (_, i) =>
  i < 3 ? ([0xff, 0xd8, 0xff][i] ?? 0) : 1,
);

describe("files the page view cannot show", () => {
  it("a damaged Word file opens as details with a reason", async () => {
    const whole = await makeDocx();
    const opened = details(await openDocument(whole.slice(0, 300), "~/Documents/broken.docx"));
    expect(opened).toMatchObject({ format: "docx", formatName: "Word document" });
    expect(opened.reason).toMatch(/damaged/);
  });

  it("bytes that are no document at all say so", async () => {
    const opened = details(await openDocument(PNG, "~/Documents/photo.docx"));
    expect(opened.reason).toBe("This file is not a Word document: it looks like a PNG image.");
  });

  it("an encrypted Word document says it is encrypted", async () => {
    const opened = details(await openDocument(makeEncryptedDocx(), "~/Documents/secret.docx"));
    expect(opened.reason).toBe("This document is encrypted.");
  });

  it("an encrypted OpenDocument file says it is encrypted", async () => {
    const opened = details(await openDocument(await makeEncryptedOdt(), "~/Documents/secret.odt"));
    expect(opened.reason).toBe("This document is encrypted.");
  });

  it("a Hangul document with a password says it is encrypted", async () => {
    const bytes = await makeHwp([{ text: "비밀" }], { password: true });
    const opened = details(await openDocument(bytes, "~/Documents/secret.hwp"));
    expect(opened.reason).toBe("This document is encrypted.");
  });

  it("a .pages package shows its largest preview image", async () => {
    const bytes = await makePages(JPEG_BIG, JPEG_SMALL);
    const opened = details(await openDocument(bytes, "~/Documents/letter.pages"));
    expect(opened).toMatchObject({
      format: "pages",
      reason: "Pages documents show their preview image.",
    });
    expect(opened.preview?.src).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(atob(opened.preview?.src.split(",")[1] ?? "")).toHaveLength(400);
  });

  it("a .gdoc shortcut is a card with the document's address", async () => {
    const opened = details(await openDocument(makeGdoc(), "~/Drive/Plan.gdoc"));
    expect(opened).toMatchObject({
      format: "gdoc",
      url: "https://docs.google.com/document/d/1AbCdEf/edit",
    });
    expect(opened.reason).toBe(
      "This is a Google Drive shortcut: the document itself lives in Google Docs.",
    );
  });
});
