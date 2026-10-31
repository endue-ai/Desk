// @vitest-environment jsdom
// Files made by real tools (fixtures/make.sh): LibreOffice writes rich.fodt out as Word, Word 97,
// OpenDocument and RTF, AbiWord writes it as .abw. Each reads back to the same document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocModel, TextRun } from "../ui/model.js";
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
  for (const name of ["rich.docx", "rich.doc", "rich.odt", "rich.rtf", "rich.fodt", "rich.abw"])
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

  it("rich.doc gives the model rich.docx gives: headings, runs, lists and the table", async () => {
    const [binary, xml] = await Promise.all([open("rich.doc"), open("rich.docx")]);
    expect(binary.textOnly).toBe(false);
    expect(shape(binary)).toEqual(shape(xml));
  });
});

/** What a Word 97 file and its OOXML copy must agree on, adjacent runs of one look joined. */
function shape(doc: DocModel) {
  const look = (r: TextRun) =>
    JSON.stringify([r.bold, r.italic, r.underline, r.strike, r.size, r.color, r.highlight]).concat(
      JSON.stringify([r.script, r.link, r.comments, r.font?.split(",")[0]]),
    );
  return {
    headings: headings(doc),
    runs: paragraphs(doc).map((p) =>
      p.inlines.reduce<Array<{ look: string; text: string }>>((out, i) => {
        if (i.type !== "text") return out;
        const last = out.at(-1);
        if (last?.look === look(i)) last.text += i.text;
        else out.push({ look: look(i), text: i.text });
        return out;
      }, []),
    ),
    lists: paragraphs(doc).flatMap((p) => (p.marker ? [[p.marker, p.indent, textOf(p)]] : [])),
    tables: tables(doc).map((t) => ({
      borders: t.borders,
      columns: t.columns,
      rows: t.rows.map((r) =>
        r.cells.map((c) => [c.blocks.map(textOf).join(" "), c.colSpan, c.rowSpan, c.fill, c.width]),
      ),
    })),
  };
}
