// HWP 5.0 with its formatting: a document built record by record (tests/hwp.ts) and real samples
// written by Hangul (fixtures/hwp, Apache-2.0, see the NOTICE there).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocModel, Paragraph, TextRun } from "../ui/model.js";
import { plainText } from "../ui/model.js";
import { openDocument } from "../ui/open.js";
import { buildHwp, type Doc } from "./hwp";
import {
  asDocument,
  headings,
  images,
  paragraphs,
  runs,
  tables,
  tableTexts,
  textOf,
} from "./model";
import { PNG } from "./zip";

const RICH: Doc = {
  bins: [PNG],
  sections: [
    {
      paras: [
        { para: 1, parts: [{ header: "보고서 머리말" }, { text: "연간 보고서", char: 2 }] },
        {
          parts: [
            "매출이 ",
            { text: "크게", char: 1 },
            { text: " 늘었다", char: 3 },
            { footnote: "출처: 내부 집계" },
            ".",
          ],
        },
        { para: 2, parts: ["가운데 정렬"] },
        { para: 3, parts: ["첫째 항목"] },
        { para: 3, parts: ["둘째 항목"] },
        { para: 4, parts: ["글머리 항목"] },
        {
          parts: [
            {
              fill: 2,
              table: [
                { text: "지역별 합계", col: 0, row: 0, span: 2, width: 200, fill: 3 },
                { text: "비고", col: 2, row: 0, width: 100 },
                { text: "북부", col: 0, row: 1, width: 100 },
                { text: "42", col: 1, row: 1, width: 100 },
                { text: "-", col: 2, row: 1, width: 100 },
              ],
            },
          ],
        },
        { parts: [{ picture: 1, width: 72, height: 36, alt: "로고" }] },
        { parts: ["누리집: ", { text: "example.com", link: "https://example.com/" }] },
        { para: 5, parts: ["오른쪽", { tab: true }, "끝"] },
        { parts: ["첫 쪽의 끝"], lines: [60000] },
        { parts: ["둘째 쪽"], lines: [0] },
      ],
    },
    { landscape: true, paras: [{ parts: ["가로 쪽"] }] },
  ],
};

const rich = async () =>
  asDocument(await openDocument(await buildHwp(RICH), "~/Documents/보고서.hwp"));
const sample = async (name: string) =>
  asDocument(
    await openDocument(
      new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "hwp", name))),
      `~/Documents/${name}`,
    ),
  );
const byText = (doc: DocModel, text: string) =>
  paragraphs(doc).find((p) => textOf(p).includes(text)) as Paragraph;
const run = (doc: DocModel, text: string) => runs(doc).find((r) => r.text === text) as TextRun;

describe("HWP 5.0 built record by record", () => {
  it("headings and runs keep their character shapes: bold, colour, font and size", async () => {
    const doc = await rich();
    expect(doc.textOnly).toBe(false);
    expect(headings(doc)).toEqual([{ level: 1, text: "연간 보고서" }]);
    expect(byText(doc, "연간 보고서")).toMatchObject({ level: 1, align: "left", marker: "1." });
    expect(run(doc, "연간 보고서")).toMatchObject({ bold: true, size: 16, color: "#1F3864" });
    expect(run(doc, "연간 보고서").font).toContain("맑은 고딕");
    expect(run(doc, "매출이 ")).toMatchObject({ size: 10 });
    expect(run(doc, "매출이 ").font).toContain("함초롬바탕");
    expect(run(doc, "크게")).toMatchObject({ bold: true, size: 10 });
    expect(run(doc, " 늘었다")).toMatchObject({ color: "#C00000" });
    expect(run(doc, " 늘었다").bold).toBeUndefined();
  });

  it("paragraph shapes give alignment, indents, line spacing and list markers", async () => {
    const doc = await rich();
    expect(byText(doc, "가운데 정렬")).toMatchObject({ align: "center", spacing: { line: 1.37 } });
    expect(byText(doc, "오른쪽")).toMatchObject({ align: "right", indent: { left: 30 } });
    expect(byText(doc, "오른쪽").inlines.map((i) => i.type)).toEqual(["text", "tab", "text"]);
    expect(byText(doc, "첫째 항목")).toMatchObject({
      marker: "1)",
      indent: { left: 20, first: -10 },
    });
    expect(byText(doc, "둘째 항목").marker).toBe("2)");
    expect(byText(doc, "글머리 항목").marker).toBe("●");
  });

  it("a table keeps its merged cell, column widths and border fills", async () => {
    const doc = await rich();
    const [table] = tables(doc);
    expect(table).toMatchObject({ borders: true, columns: [100, 100, 100] });
    expect(table?.rows[0]?.cells[0]).toMatchObject({ colSpan: 2, fill: "#FFF2CC" });
    expect(tableTexts(doc)[0]).toEqual([
      ["지역별 합계", "비고"],
      ["북부", "42", "-"],
    ]);
  });

  it("a picture, a header, a footnote and a hyperlink", async () => {
    const doc = await rich();
    expect(images(doc)).toEqual([
      expect.objectContaining({
        width: 72,
        height: 36,
        alt: "로고",
        src: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    ]);
    expect(plainText(doc.sections[0]?.header ?? [])).toBe("보고서 머리말");
    expect(doc.notes.map((n) => [n.kind, n.label, plainText(n.blocks)])).toEqual([
      ["footnote", "1)", "출처: 내부 집계"],
    ]);
    expect(byText(doc, "매출이").inlines).toContainEqual({
      type: "noteref",
      note: "n1",
      label: "1)",
    });
    expect(run(doc, "example.com").link).toBe("https://example.com/");
  });

  it("an A4 portrait and an A4 landscape section, and a page break where the layout turned the page", async () => {
    const doc = await rich();
    expect(doc.sections.map((s) => [s.width, s.height])).toEqual([
      [595.3, 841.9],
      [841.9, 595.3],
    ]);
    expect(doc.sections[0]?.margins).toMatchObject({
      left: 85,
      right: 85,
      top: 99.2,
      header: 56.7,
    });
    const blocks = doc.sections[0]?.blocks ?? [];
    const second = blocks.findIndex((b) => textOf(b) === "둘째 쪽");
    expect(blocks[second - 1]).toEqual({ type: "pagebreak" });
    expect(blocks.filter((b) => b.type === "pagebreak")).toHaveLength(1);
  });
});

describe("HWP 5.0 samples written by Hangul", () => {
  it("table.hwp: a bordered table and its numbered caption", async () => {
    const doc = await sample("table.hwp");
    expect(tables(doc)[0]).toMatchObject({ borders: true, columns: [139.8, 139.8, 139.8] });
    expect(tableTexts(doc)[0]).toEqual([
      ["ABC 123", "DEF", "GHI"],
      ["LMN", "OPQ", "STR"],
      ["UVM", "123", "456"],
    ]);
    expect(textOf(byText(doc, "표"))).toBe("표 1 ");
  });

  it("picture.hwp: four pictures from BinData at their size", async () => {
    const doc = await sample("picture.hwp");
    expect(images(doc)).toHaveLength(4);
    for (const image of images(doc))
      expect(image).toMatchObject({
        width: 74.6,
        height: 88.5,
        alt: "그림입니다.",
        src: expect.stringMatching(/^data:image\/png/),
      });
  });

  it("notes.hwp: footnotes and an endnote with Hangul's labels", async () => {
    const doc = await sample("notes.hwp");
    expect(doc.notes.map((n) => [n.kind, n.label])).toEqual([
      ["footnote", "<I>"],
      ["footnote", "<II>"],
      ["endnote", "1)"],
    ]);
    expect(plainText(doc.notes[2]?.blocks ?? []).trim()).toBe("sssd");
  });

  it("header.hwp: the header and outline headings numbered 1., 가., 나.", async () => {
    const doc = await sample("header.hwp");
    expect(plainText(doc.sections[0]?.header ?? [])).toBe("개요1");
    expect(headings(doc).slice(0, 3)).toEqual([
      { level: 1, text: "aaa" },
      { level: 2, text: "2233" },
      { level: 2, text: "596687" },
    ]);
    expect(
      paragraphs(doc)
        .slice(0, 3)
        .map((p) => [p.marker, p.indent?.left]),
    ).toEqual([
      ["1.", 10],
      ["가.", 20],
      ["나.", 20],
    ]);
  });

  it("numbering.hwp: alignments, a numbered list and bullets", async () => {
    const doc = await sample("numbering.hwp");
    const shown = paragraphs(doc).filter((p) => textOf(p) !== "");
    expect(shown.map((p) => p.align).slice(0, 4)).toEqual(["justify", "left", "center", "right"]);
    expect(shown.flatMap((p) => (p.marker ? [p.marker] : []))).toEqual([
      "1.",
      "2.",
      "3.",
      "•",
      "•",
    ]);
  });
});
