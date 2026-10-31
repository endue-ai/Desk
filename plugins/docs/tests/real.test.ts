// @vitest-environment jsdom
// Files made by real tools (fixtures/make.sh): LibreOffice writes rich.fodt out as Word, Word 97,
// OpenDocument and RTF, AbiWord writes it as .abw. Each reads back to the same document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plainText } from "../ui/model.js";
import { openDocument } from "../ui/open.js";
import { asDocument, headings, images, paragraphs, tables, textOf, texts } from "./model";

const open = async (name: string) =>
  asDocument(
    await openDocument(
      new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name))),
      `~/Documents/${name}`,
    ),
  );

const HEADINGS = [
  { level: 1, text: "Field notes" },
  { level: 2, text: "Steps" },
  { level: 2, text: "Results" },
];

describe("documents written by LibreOffice and AbiWord", () => {
  for (const name of ["rich.docx", "rich.odt", "rich.rtf", "rich.fodt", "rich.abw"])
    it(`${name}: headings, lists, a merged table, the picture, the comment and the footnote`, async () => {
      const doc = await open(name);
      expect(doc.textOnly).toBe(false);
      expect(headings(doc)).toEqual(HEADINGS);
      expect(texts(doc)).toContain("현장 기록: 북부 지역의 아침 집계가 가장 많았다.");
      const [table] = tables(doc);
      expect(textOf(table?.rows[0]?.cells[0]?.blocks[0])).toBe("Counts by region");
      expect(table?.rows[0]?.cells[0]?.colSpan).toBe(3);
      expect(table?.rows[2]?.cells[0]).toMatchObject({ rowSpan: 2 });
      expect(images(doc).filter((i) => i.src?.startsWith("data:image/png"))).toHaveLength(1);
      expect(doc.comments.map((c) => [c.author, plainText(c.blocks)])).toEqual([
        ["Mina Park", "Check against the raw counts."],
      ]);
      expect(doc.notes.map((n) => plainText(n.blocks).trim())).toEqual([
        "Counted from the first visit.",
      ]);
      expect(doc.sections[0]?.blocks.filter((b) => b.type === "pagebreak")).toHaveLength(1);
      if (name !== "rich.abw") {
        expect(paragraphs(doc).flatMap((p) => (p.marker ? [p.marker] : []))).toEqual([
          "1.",
          "2.",
          "a.",
          "b.",
          "3.",
          "•",
          "•",
        ]);
        expect(plainText(doc.sections[0]?.header ?? [])).toBe("Field notes · internal draft");
      }
    });

  it("rich.doc gives the same text, headings and table, as text only", async () => {
    const doc = await open("rich.doc");
    expect(doc.textOnly).toBe(true);
    expect(headings(doc)).toEqual(HEADINGS);
    expect(texts(doc)).toContain(
      "The survey covered three regions over six weeks. Details are on the project page.",
    );
    expect(tables(doc)[0]?.rows.map((r) => r.cells.length)).toEqual([1, 3, 3, 3, 3]);
    expect(doc.sections[0]?.blocks.filter((b) => b.type === "pagebreak")).toHaveLength(1);
  });
});
