// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openDocument } from "../ui/open.js";
import { asDocument, headings, images, paragraphs, runs, tables, textOf, texts } from "./model";
import { makeDocx } from "./ooxml-fixture";

const open = async () =>
  asDocument(await openDocument(await makeDocx(), "~/Documents/Report.docx"));

describe("Word (OOXML)", () => {
  it("is a full Word document, not text only", async () => {
    const doc = await open();
    expect(doc).toMatchObject({ kind: "document", format: "docx", textOnly: false });
  });

  it("styles inherit: Heading 1 is bold and level 1, Heading 2 keeps the bold", async () => {
    const doc = await open();
    expect(headings(doc)).toEqual([
      { level: 1, text: "Introduction" },
      { level: 2, text: "Details" },
    ]);
    const intro = runs(doc).find((r) => r.text === "Introduction");
    expect(intro).toMatchObject({ bold: true, size: 16, color: "#2F5496", font: "Calibri" });
    expect(runs(doc).find((r) => r.text === "Details")).toMatchObject({ bold: true, size: 13 });
    expect(runs(doc).find((r) => r.text === "strong text")).toMatchObject({ bold: true });
    expect(runs(doc).find((r) => r.text.startsWith("Plain"))?.bold).toBeFalsy();
  });

  it("numbering gives 1. and a. markers", async () => {
    const doc = await open();
    const items = paragraphs(doc).filter((p) => p.marker !== undefined);
    expect(items.map((p) => [p.marker, textOf(p)])).toEqual([
      ["1.", "First"],
      ["2.", "Second"],
      ["a.", "Nested"],
    ]);
    expect(items[2]?.indent).toMatchObject({ left: 72, first: -18 });
  });

  it("a table keeps its merged cells", async () => {
    const doc = await open();
    const [table] = tables(doc);
    expect(table?.borders).toBe(true);
    expect(
      table?.rows.map((r) => r.cells.map((c) => [textOf(c.blocks[0]), c.colSpan, c.rowSpan])),
    ).toEqual([
      [["Both columns", 2, 1]],
      [
        ["Tall", 1, 2],
        ["B2", 1, 1],
      ],
      [["B3", 1, 1]],
    ]);
  });

  it("an image becomes an image with its size and description", async () => {
    const doc = await open();
    const [image] = images(doc);
    expect(image?.src).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(image).toMatchObject({ width: 72, height: 36, alt: "A chart" });
  });

  it("a comment is anchored to its range", async () => {
    const doc = await open();
    expect(doc.comments).toHaveLength(1);
    const [comment] = doc.comments;
    expect(comment).toMatchObject({ author: "Ana Lee", date: "2026-10-01T09:00:00Z" });
    expect(comment?.blocks.map(textOf)).toEqual(["Check this number."]);
    const anchored = runs(doc).filter((r) => r.comments?.includes(comment?.id ?? "?"));
    expect(anchored.map((r) => r.text)).toEqual(["reviewed"]);
  });

  it("a tracked insertion shows and a deletion does not", async () => {
    const doc = await open();
    const all = texts(doc).join("\n");
    expect(all).toContain("Text added here.");
    expect(all).not.toContain("removed");
  });

  it("links, footnotes, the header and the page break come through", async () => {
    const doc = await open();
    expect(runs(doc).find((r) => r.text === "a link")?.link).toBe("https://example.com/report");
    expect(doc.notes).toEqual([expect.objectContaining({ kind: "footnote", label: "1" })]);
    expect(doc.notes[0]?.blocks.map(textOf).join("").trim()).toBe("A footnote.");
    const [section] = doc.sections;
    expect(section).toMatchObject({ width: 595.3, height: 841.9 });
    expect(section?.margins).toMatchObject({ top: 72, left: 72, header: 35.4 });
    expect(section?.header.map(textOf)).toEqual(["Company confidential"]);
    const kinds = section?.blocks.map((b) => b.type);
    expect(kinds?.filter((k) => k === "pagebreak")).toHaveLength(1);
    expect(textOf(section?.blocks.at(-1))).toBe("Second page");
  });
});
