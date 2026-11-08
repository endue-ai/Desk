// @vitest-environment jsdom
// Word 97-2003 with its formatting, from files real tools wrote (fixtures/doc/make.sh): LibreOffice
// turns format.fodt into format.doc, .dot and .docx; textutil turns textutil.html into
// textutil.doc and .docx. The .docx copies are the reference the binary reader is held to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocModel, Paragraph, TextRun } from "../ui/model.js";
import { plainText } from "../ui/model.js";
import { openDocument } from "../ui/open.js";
import { asDocument, headings, images, paragraphs, runs, tables, textOf, texts } from "./model";

const open = async (name: string) =>
  asDocument(
    await openDocument(
      new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "doc", name))),
      `~/Documents/${name}`,
    ),
  );

const run = (doc: DocModel, text: string) => runs(doc).find((r) => r.text === text);
const para = (doc: DocModel, start: string) =>
  paragraphs(doc).find((p) => textOf(p).startsWith(start)) as Paragraph;
const first = (font: string | undefined) => font?.split(",")[0]?.trim();

/**
 * The look of each run that has text in reading order, adjacent runs of one look joined, also
 * across paragraphs: the Word 97 reader joins paragraphs whose mark was deleted, the OOXML reader
 * does not.
 */
const looks = (doc: DocModel) => {
  const out: Array<Record<string, unknown>> = [];
  for (const i of paragraphs(doc).flatMap((p) => p.inlines)) {
    if (i.type !== "text") continue;
    const look = {
      bold: i.bold || undefined,
      italic: i.italic || undefined,
      underline: i.underline || undefined,
      strike: i.strike || undefined,
      size: i.size,
      color: i.color,
      script: i.script,
      link: i.link,
      font: first(i.font),
    };
    const last = out.at(-1);
    if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...look, text: "" }))
      last.text += i.text;
    else out.push({ ...look, text: i.text });
  }
  return out;
};

describe("Word 97-2003 from LibreOffice", () => {
  it("is a full document with its title", async () => {
    const doc = await open("format.doc");
    expect(doc).toMatchObject({ format: "doc", textOnly: false, title: "Format check" });
  });

  it("headings carry their outline levels", async () => {
    expect(headings(await open("format.doc"))).toEqual([
      { level: 1, text: "Format check" },
      { level: 2, text: "Lists" },
      { level: 3, text: "Table" },
    ]);
  });

  it("runs keep bold, colour, size, italic, underline, highlight, strike, scripts and fonts", async () => {
    const doc = await open("format.doc");
    expect(run(doc, "a bold red 14 pt run")).toMatchObject({
      bold: true,
      color: "#FF0000",
      size: 14,
    });
    expect(run(doc, "italic underlined words")).toMatchObject({ italic: true, underline: true });
    expect(run(doc, "a highlight")).toMatchObject({ highlight: "#FFFF00" });
    expect(run(doc, "struck text")).toMatchObject({ strike: true });
    expect(run(doc, "2")).toMatchObject({ script: "super" });
    expect(
      runs(doc)
        .filter((r) => r.text === "2")
        .map((r) => r.script),
    ).toEqual(["super", "sub"]);
    expect(run(doc, "small caps")).toMatchObject({ caps: true });
    const mono = run(doc, "mono blue") as TextRun;
    expect([first(mono.font), mono.color]).toEqual(["Liberation Mono", "#2E75B6"]);
    expect(run(doc, "Format check")).toMatchObject({ bold: true, size: 18, color: "#1F3864" });
    expect(first(run(doc, "Format check")?.font)).toBe("Liberation Sans");
  });

  it("paragraphs keep their alignment, indents and spacing", async () => {
    const doc = await open("format.doc");
    expect(para(doc, "A centred paragraph").align).toBe("center");
    expect(para(doc, "A paragraph on the right").align).toBe("right");
    expect(para(doc, "A quoted paragraph")).toMatchObject({
      style: "Quote",
      align: "justify",
      indent: { left: 36, right: 36, first: 18 },
      spacing: { line: 1.5 },
    });
    expect(para(doc, "Exact spacing").spacing).toEqual({
      before: 18,
      after: 18,
      line: 21.6,
      exact: true,
    });
  });

  it("a numbered and a bulleted list keep their markers and indents", async () => {
    const items = paragraphs(await open("format.doc")).filter((p) => p.marker);
    expect(items.map((p) => [p.marker, textOf(p), p.indent?.left])).toEqual([
      ["1.", "First step", 36],
      ["2.", "Second step", 36],
      ["a.", "Inner one", 54],
      ["b.", "Inner two", 54],
      ["3.", "Third step", 36],
      ["•", "A bullet", 36],
      ["•", "Another bullet", 36],
    ]);
    expect(items[0]?.indent?.first).toBe(-18);
  });

  it("a table keeps its merged cells, shading, widths and borders", async () => {
    const [table] = tables(await open("format.doc"));
    expect(table?.borders).toBe(true);
    expect(table?.columns).toEqual([233.9, 117, 117]);
    expect(
      table?.rows.map((r) =>
        r.cells.map((c) => [textOf(c.blocks[0]), c.colSpan, c.rowSpan, c.fill]),
      ),
    ).toEqual([
      [["Counts by site", 3, 1, "#DDE4F0"]],
      [
        ["Site", 1, 1, "#DDE4F0"],
        ["Morning", 1, 1, "#DDE4F0"],
        ["Evening", 1, 1, "#DDE4F0"],
      ],
      [
        ["East", 1, 2, undefined],
        ["12", 1, 1, undefined],
        ["9", 1, 1, undefined],
      ],
      [
        ["14", 1, 1, undefined],
        ["11", 1, 1, undefined],
      ],
    ]);
  });

  it("sections keep A4 and Letter pages, their margins, headers and footers", async () => {
    const doc = await open("format.doc");
    expect(doc.sections.map((s) => [s.width, s.height, s.continuous])).toEqual([
      [595.3, 841.9, false],
      [612, 792, false],
      [612, 792, true],
      [612, 792, true],
    ]);
    expect(doc.sections[0]?.margins).toMatchObject({ top: 86.1, left: 70.9, right: 56.7 });
    expect(plainText(doc.sections[0]?.header ?? [])).toBe("Format check · header");
    const footer = doc.sections[0]?.footer[0] as Paragraph;
    expect(
      footer.inlines.map((i) =>
        i.type === "text" ? i.text : i.type === "field" ? `<${i.field}>` : "",
      ),
    ).toEqual(["Page ", "<page>", " of ", "<pages>"]);
    expect(plainText(doc.sections[1]?.header ?? [])).toBe("Letter pages");
    expect(plainText(doc.sections[3]?.footer ?? [])).toBe("Format check · footer");
    expect(doc.sections[0]?.blocks.filter((b) => b.type === "pagebreak")).toHaveLength(1);
  });

  it("a footnote and an endnote are numbered where their references are", async () => {
    const doc = await open("format.doc");
    expect(doc.notes.map((n) => [n.kind, n.label, plainText(n.blocks).trim()])).toEqual([
      ["footnote", "1", "A footnote about the format."],
      ["endnote", "i", "An endnote at the end."],
    ]);
    const refs = paragraphs(doc).flatMap((p) => p.inlines.filter((i) => i.type === "noteref"));
    expect(refs.map((r) => r.type === "noteref" && [r.note, r.label])).toEqual(
      doc.notes.map((n) => [n.id, n.label]),
    );
  });

  it("a comment keeps its author, date, text and range", async () => {
    const doc = await open("format.doc");
    expect(doc.comments).toHaveLength(1);
    const [comment] = doc.comments;
    expect([comment?.author, plainText(comment?.blocks ?? [])]).toEqual([
      "Mina Park",
      "Check the totals.",
    ]);
    expect(comment?.date).toMatch(/^2026-10-20T10:30/);
    expect(run(doc, "reviewed numbers")?.comments).toEqual([comment?.id]);
  });

  it("hyperlinks show their result and keep http and mailto targets", async () => {
    const doc = await open("format.doc");
    expect(run(doc, "the format page")?.link).toBe("https://example.com/format");
    expect(run(doc, "the desk")?.link).toBe("mailto:desk@example.com");
    expect(texts(doc).some((t) => t.includes("HYPERLINK"))).toBe(false);
  });

  it("pictures: PNG and JPEG with their size, a WMF as a placeholder that says so", async () => {
    const shown = images(await open("format.doc"));
    expect(shown.map((i) => [i.src?.slice(0, 22) ?? null, i.width, i.height])).toEqual([
      ["data:image/png;base64,", 90, 45],
      ["data:image/jpeg;base64", 64.1, 31.7],
      [null, 100.1, 49.7],
    ]);
    expect(shown[2]?.alt).toMatch(/WMF, not shown/);
  });

  it("a tracked deletion is left out, an insertion kept, a text box follows its anchor", async () => {
    const doc = await open("format.doc");
    const all = texts(doc);
    expect(all).toContain("Kept text stays, and inserted words show.");
    expect(all).toContain("Joined: first half and second half.");
    expect(all.join("\n")).not.toMatch(/removed words|was cut here|Removed lead-in/);
    const box = all.indexOf("Boxed note text.");
    expect(all[box - 1]).toBe("A text box follows this paragraph.");
  });

  it("a .dot template reads as a template, with the same content", async () => {
    const dot = await open("format.dot");
    expect(dot).toMatchObject({
      format: "dot",
      formatName: "Word 97-2003 template",
      textOnly: false,
    });
    expect(looks(dot)).toEqual(looks(await open("format.doc")));
  });

  it("the runs are the ones the same document's .docx gives", async () => {
    expect(looks(await open("format.doc"))).toEqual(looks(await open("format.docx")));
  });
});

describe("Word 97-2003 from textutil", () => {
  it("runs, alignment and the merged and shaded table", async () => {
    const doc = await open("textutil.doc");
    expect(doc.textOnly).toBe(false);
    expect(run(doc, "a bold red 14 pt run")).toMatchObject({ bold: true, color: "#FB0007" });
    // textutil keeps a link's look, not its target.
    expect(run(doc, "the format page")).toMatchObject({ underline: true, color: "#0000E9" });
    expect(para(doc, "A centred paragraph").align).toBe("center");
    const [table] = tables(doc);
    expect(
      table?.rows.map((r) => r.cells.map((c) => [textOf(c.blocks[0]), c.colSpan, c.rowSpan])),
    ).toEqual([
      [["Counts by site", 3, 1]],
      [
        ["Site", 1, 1],
        ["Morning", 1, 1],
        ["Evening", 1, 1],
      ],
      [
        ["East", 1, 2],
        ["12", 1, 1],
        ["9", 1, 1],
      ],
      [
        ["14", 1, 1],
        ["11", 1, 1],
      ],
    ]);
    expect(table?.rows[0]?.cells[0]?.fill).toMatch(/^#[0-9A-F]{6}$/);
    expect(texts(doc)).toContain("한글 문단: 두 번째 페이지가 여기서 시작한다.");
  });

  it("the runs are the ones textutil's .docx gives", async () => {
    expect(looks(await open("textutil.doc"))).toEqual(looks(await open("textutil.docx")));
  });
});
