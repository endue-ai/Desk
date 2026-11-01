// The one document model every reader produces and the one renderer draws. Lengths are points
// (1/72 inch), rounded to tenths; colours are "#RRGGBB". A reader that cannot show a file returns
// Details instead, with one sentence saying why.

/**
 * @typedef {{ top: number, right: number, bottom: number, left: number, header?: number, footer?: number }} Margins
 * @typedef {{ width: number, height: number, margins: Margins, header: Block[], footer: Block[], blocks: Block[], continuous?: boolean }} Section
 * @typedef {"left" | "center" | "right" | "justify"} Align
 * @typedef {{ left?: number, right?: number, first?: number }} Indent
 * @typedef {{ before?: number, after?: number, line?: number, exact?: boolean }} Spacing
 *   line: a multiple of single spacing, or points when exact is true.
 * @typedef {{ type: "paragraph", inlines: Inline[], style?: string, level?: number, align?: Align, indent?: Indent, spacing?: Spacing, marker?: string, rtl?: boolean }} Paragraph
 *   level: the outline level, 1 to 6, for headings only.
 * @typedef {{ type: "text", text: string, bold?: boolean, italic?: boolean, underline?: boolean, strike?: boolean, size?: number, color?: string, highlight?: string, font?: string, link?: string, script?: "super" | "sub", caps?: boolean, comments?: string[] }} TextRun
 * @typedef {{ type: "image", src: string | null, width?: number, height?: number, alt: string }} Image
 *   src: a data: URL, or null when the picture's format cannot be shown (alt says which).
 * @typedef {{ type: "tab" }} Tab
 * @typedef {{ type: "linebreak" }} LineBreak
 * @typedef {{ type: "noteref", note: string, label: string }} NoteRef
 * @typedef {{ type: "field", field: "page" | "pages", text: string }} Field
 * @typedef {{ type: "anchor", comments: string[] }} Anchor  A comment on a point, not a range.
 * @typedef {TextRun | Image | Tab | LineBreak | NoteRef | Field | Anchor} Inline
 * @typedef {{ blocks: Block[], colSpan: number, rowSpan: number, width?: number, fill?: string }} Cell
 * @typedef {{ cells: Cell[], header?: boolean }} Row
 * @typedef {{ type: "table", rows: Row[], columns?: number[], borders: boolean, relative?: boolean }} Table
 *   relative: the columns are proportions of the text width, not points.
 *   Covered cells of a merge are left out, as in HTML.
 * @typedef {{ type: "pagebreak" }} PageBreak
 * @typedef {Paragraph | Table | Image | PageBreak} Block
 * @typedef {{ id: string, kind: "footnote" | "endnote", label: string, blocks: Block[] }} Note
 * @typedef {{ id: string, author: string, date: string, blocks: Block[] }} Comment
 * @typedef {{ kind: "document", format: string, formatName: string, textOnly: boolean, title: string, sections: Section[], notes: Note[], comments: Comment[] }} DocModel
 * @typedef {{ kind: "details", format: string, formatName: string, reason: string, preview?: { src: string, alt: string }, url?: string }} Details
 * @typedef {DocModel | Details} Opened
 */

/** Letter, the paper a document gets when it does not say. */
export const LETTER = { width: 612, height: 792 };
export const A4 = { width: 595.3, height: 841.9 };

/** Round to tenths of a point. */
export const pt = (/** @type {number} */ value) => Math.round(value * 10) / 10;
export const twips = (/** @type {number} */ value) => pt(value / 20);
export const emu = (/** @type {number} */ value) => pt(value / 12700);

/**
 * A CSS-like length ("2.54cm", "1in", "12pt", "10mm", "0.5\"", "16px", "1inch") in points.
 * @param {string | null | undefined} text
 * @returns {number | undefined}
 */
export function length(text) {
  const match = /^\s*(-?[\d.]+)\s*(cm|mm|in|inch|pt|pc|px|"|)\s*$/i.exec(text ?? "");
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = (match[2] ?? "").toLowerCase();
  const factor =
    { cm: 72 / 2.54, mm: 72 / 25.4, in: 72, inch: 72, '"': 72, pt: 1, pc: 12, px: 0.75 }[unit] ?? 1;
  return pt(value * factor);
}

/** A colour as "#RRGGBB" from "FF0000", "#ff0000" or "#f00"; undefined for auto or nonsense. */
export function color(/** @type {string | null | undefined} */ text) {
  const value = (text ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(value))
    return `#${[...value].map((c) => c + c).join("")}`.toUpperCase();
  return undefined;
}

/** @param {Inline[]} inlines @param {Partial<Paragraph>} [props] @returns {Paragraph} */
export const paragraph = (inlines, props = {}) => ({ type: "paragraph", ...props, inlines });

/** @param {string} text @param {Partial<TextRun>} [props] @returns {TextRun} */
export const text = (text, props = {}) => ({ type: "text", ...props, text });

/** @param {Partial<Section>} [props] @returns {Section} */
export const section = (props = {}) => ({
  width: LETTER.width,
  height: LETTER.height,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: [],
  footer: [],
  blocks: [],
  ...props,
});

/**
 * A document from what a reader found; empty sections become one empty page.
 * @param {{ format: string, formatName: string, textOnly?: boolean, title?: string, sections: Section[], notes?: Note[], comments?: Comment[] }} parts
 * @returns {DocModel}
 */
export function documentOf(parts) {
  const sections = parts.sections.length > 0 ? parts.sections : [section()];
  return {
    kind: "document",
    format: parts.format,
    formatName: parts.formatName,
    textOnly: parts.textOnly ?? false,
    title: parts.title ?? "",
    sections,
    notes: parts.notes ?? [],
    comments: parts.comments ?? [],
  };
}

/** The plain text of some blocks, one line per paragraph. */
export function plainText(/** @type {Block[]} */ blocks) {
  /** @type {string[]} */
  const lines = [];
  for (const block of blocks) {
    if (block.type === "paragraph")
      lines.push(
        block.inlines
          .map((i) => (i.type === "text" ? i.text : i.type === "tab" ? "\t" : ""))
          .join(""),
      );
    else if (block.type === "table")
      for (const row of block.rows)
        for (const cell of row.cells) lines.push(plainText(cell.blocks));
  }
  return lines.join("\n");
}

/**
 * Plain text as paragraphs, for the text-only readers: one paragraph per line, tabs kept.
 * @param {string} text
 * @returns {Paragraph[]}
 */
export function paragraphsOf(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => paragraph(tabbed(line)));
}

/** @param {string} line @param {Partial<TextRun>} [props] @returns {Inline[]} */
export function tabbed(line, props = {}) {
  /** @type {Inline[]} */
  const out = [];
  line.split("\t").forEach((part, i) => {
    if (i > 0) out.push({ type: "tab" });
    if (part !== "") out.push(text(part, props));
  });
  return out;
}

/** A reader's refusal: the sentence the details view shows. */
export class DocError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = "DocError";
  }
}

export const ENCRYPTED = "This document is encrypted.";
