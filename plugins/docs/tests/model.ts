// Questions the tests ask of a document model, so each reader's test reads the same way.
import type { Block, DocModel, Image, Opened, Paragraph, Table, TextRun } from "../ui/model.js";

export function asDocument(opened: Opened): DocModel {
  if (opened.kind !== "document") throw new Error(`not a document: ${opened.reason}`);
  return opened;
}

/** Every block of the body, table cells included, in reading order. */
export function allBlocks(model: DocModel): Block[] {
  const out: Block[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      out.push(block);
      if (block.type === "table")
        for (const row of block.rows) for (const cell of row.cells) walk(cell.blocks);
    }
  };
  for (const section of model.sections) walk(section.blocks);
  return out;
}

export const paragraphs = (model: DocModel) =>
  allBlocks(model).filter((b): b is Paragraph => b.type === "paragraph");

export const textOf = (block: Block | undefined): string => {
  if (!block) return "";
  if (block.type === "paragraph")
    return block.inlines
      .map((i) => (i.type === "text" ? i.text : i.type === "tab" ? "\t" : ""))
      .join("");
  if (block.type === "table")
    return block.rows
      .map((r) => r.cells.map((c) => c.blocks.map(textOf).join("\n")).join("\t"))
      .join("\n");
  return "";
};

export const texts = (model: DocModel) =>
  paragraphs(model)
    .map(textOf)
    .filter((t) => t !== "");

export const headings = (model: DocModel) =>
  paragraphs(model)
    .filter((p) => p.level !== undefined)
    .map((p) => ({ level: p.level, text: textOf(p).trim() }));

export const runs = (model: DocModel) =>
  paragraphs(model).flatMap((p) => p.inlines.filter((i): i is TextRun => i.type === "text"));

export const tables = (model: DocModel) =>
  allBlocks(model).filter((b): b is Table => b.type === "table");

/** Each table as rows of cell texts. */
export const tableTexts = (model: DocModel) =>
  tables(model).map((t) =>
    t.rows.map((r) => r.cells.map((c) => c.blocks.map(textOf).join(" ").trim())),
  );

export const images = (model: DocModel): Image[] => [
  ...allBlocks(model).filter((b): b is Image => b.type === "image"),
  ...paragraphs(model).flatMap((p) => p.inlines.filter((i): i is Image => i.type === "image")),
];

/** What the "same small document" tests compare across formats. */
export function summary(model: DocModel) {
  return {
    headings: headings(model),
    bold: runs(model)
      .filter((r) => r.bold && textOf({ type: "paragraph", inlines: [r] }).trim() !== "")
      .map((r) => r.text.trim())
      .filter((t) => !headings(model).some((h) => h.text === t)),
    tables: tableTexts(model),
    images: images(model).filter((i) => i.src?.startsWith("data:image/")).length,
  };
}

/** The summary every format's copy of the small document gives. */
export const SAME = {
  headings: [{ level: 1, text: "Annual report" }],
  bold: ["sharply"],
  tables: [
    [
      ["Region", "Total"],
      ["North", "42"],
    ],
  ],
  images: 1,
};

/** A file's bytes as fs.read's base64 answer carries them. */
export const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
};
