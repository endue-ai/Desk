// Hangul HWP 5.0 (.hwp), text only: the compound file's FileHeader (version, compression, password),
// DocInfo's paragraph shapes for outline levels, and each BodyText section's records (raw deflate
// when compressed): paragraphs, tables by cell address and span, headers, footers and notes.
import { inflate, Reader, startsWithText } from "../bytes.js";
import { DocError, documentOf, ENCRYPTED, paragraph, pt, text as run, section } from "../model.js";

/**
 * @typedef {{ tag: number, level: number, data: Uint8Array }} Rec
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {{ shapes: number[], notes: import("../model.js").Note[], header: Block[], footer: Block[], page?: Uint8Array }} Ctx
 */

const TAG = {
  PARA_SHAPE: 25,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  PAGE_DEF: 73,
  TABLE: 77,
};
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
const INLINE = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

/** A control's four-letter id, as stored: first letter in the high byte. */
const ctrlName = (/** @type {number} */ id) =>
  String.fromCharCode((id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff);

/** @param {Uint8Array} bytes @returns {Rec[]} */
export function records(bytes) {
  const r = new Reader(bytes);
  /** @type {Rec[]} */
  const out = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const head = r.u32(at);
    let size = head >>> 20;
    at += 4;
    if (size === 0xfff) {
      size = r.u32(at);
      at += 4;
    }
    out.push({
      tag: head & 0x3ff,
      level: (head >>> 10) & 0x3ff,
      data: bytes.subarray(at, at + size),
    });
    at += size;
  }
  return out;
}

/** @param {import("../cfb.js").Cfb} cfb */
export async function readHwp(cfb) {
  const header = cfb.read("FileHeader");
  if (!header || !startsWithText(header, "HWP Document File"))
    throw new DocError("This file is damaged: its HWP file header is missing.");
  const hr = new Reader(header);
  const props = hr.u32(36);
  if (props & 2) throw new DocError(ENCRYPTED);
  if (props & 4)
    throw new DocError("This Hangul document is a distribution copy, whose text is encrypted.");
  const compressed = (props & 1) !== 0;
  // Hancom ends each deflated stream with a gzip-style trailer (CRC and size) that a strict
  // inflater calls junk: without it on a second try.
  const unpack = async (/** @type {Uint8Array} */ bytes) =>
    compressed
      ? inflate(bytes)
          .catch(() => inflate(bytes.subarray(0, Math.max(0, bytes.length - 8))))
          .catch(() => {
            throw new DocError("This file is damaged: a section does not decompress.");
          })
      : bytes;
  const docInfo = cfb.read("DocInfo");
  /** @type {Ctx} */
  const ctx = { shapes: [], notes: [], header: [], footer: [] };
  if (docInfo)
    for (const rec of records(await unpack(docInfo)))
      if (rec.tag === TAG.PARA_SHAPE) ctx.shapes.push(new Reader(rec.data).u32(0));
  const paths = cfb
    .list()
    .filter((p) => /^BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => Number(/\d+$/.exec(a)?.[0]) - Number(/\d+$/.exec(b)?.[0]));
  if (paths.length === 0) throw new DocError("This file is damaged: it has no BodyText sections.");
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  for (const path of paths) {
    const bytes = cfb.read(path);
    if (!bytes) continue;
    const recs = records(await unpack(bytes));
    ctx.page = undefined;
    const { blocks } = list(recs, 0, recs[0]?.level ?? 0, recs.length, ctx);
    sections.push(sectionOf(ctx, blocks));
  }
  return documentOf({
    format: "hwp",
    formatName: "Hangul document (HWP 5.0)",
    textOnly: true,
    sections,
    notes: ctx.notes,
  });
}

/** The page a section's PAGE_DEF gives; Hangul puts the header area below the top margin. */
function sectionOf(/** @type {Ctx} */ ctx, /** @type {Block[]} */ blocks) {
  if (!ctx.page) return section({ blocks, header: ctx.header, footer: ctx.footer });
  const r = new Reader(ctx.page);
  const v = (/** @type {number} */ i) => pt(r.u32(i * 4) / 100);
  let [width, height] = [v(0), v(1)];
  if (r.u32(36) & 1 && width < height) [width, height] = [height, width];
  return section({
    width,
    height,
    margins: {
      left: v(2),
      right: v(3),
      top: pt(v(4) + v(6)),
      bottom: pt(v(5) + v(7)),
      header: v(4),
      footer: v(5),
    },
    header: ctx.header,
    footer: ctx.footer,
    blocks,
  });
}

/**
 * Paragraphs at `level` from `at`, until a record above that level or `end`.
 * @param {Rec[]} recs
 * @param {number} at
 * @param {number} level
 * @param {number} end
 * @param {Ctx} ctx
 * @param {number} [count] stop after this many paragraphs (a cell's or a note's list)
 */
function list(recs, at, level, end, ctx, count = Number.POSITIVE_INFINITY) {
  /** @type {Block[]} */
  const blocks = [];
  let i = at;
  let n = 0;
  while (i < end && n < count) {
    const rec = recs[i];
    if (!rec || rec.level < level) break;
    if (rec.tag !== TAG.PARA_HEADER || rec.level !== level) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < end && (recs[j]?.level ?? 0) > level) j++;
    blocks.push(...paragraphOf(recs, i, j, ctx));
    n++;
    i = j;
  }
  return { blocks, next: i };
}

/** One paragraph (records i..j): its text, then what its controls hold. */
function paragraphOf(
  /** @type {Rec[]} */ recs,
  /** @type {number} */ i,
  /** @type {number} */ j,
  /** @type {Ctx} */ ctx,
) {
  const head = /** @type {Rec} */ (recs[i]);
  const hr = new Reader(head.data);
  const level = head.level;
  const shape = ctx.shapes[hr.u16(8)] ?? 0;
  /** @type {Block[]} */
  const out = [];
  if (hr.u8(11) & 0x04) out.push({ type: "pagebreak" });
  /** @type {Inline[]} */
  const inlines = [];
  /** @type {Block[]} */
  const after = [];
  for (let k = i + 1; k < j; k++) {
    const rec = /** @type {Rec} */ (recs[k]);
    if (rec.level !== level + 1) continue;
    if (rec.tag === TAG.PARA_TEXT) inlines.push(...textOf(rec.data));
    else if (rec.tag === TAG.CTRL_HEADER) {
      let end = k + 1;
      while (end < j && (recs[end]?.level ?? 0) > rec.level) end++;
      control(recs, k, end, ctx, inlines, after);
    }
  }
  /** @type {Partial<import("../model.js").Paragraph>} */
  const props = {};
  const kind = (shape >>> 23) & 3;
  const outline = (shape >>> 25) & 7;
  if (kind === 1 && outline < 6) props.level = outline + 1;
  if (inlines.length || after.length === 0) out.push(paragraph(inlines, props));
  out.push(...after);
  return out;
}

/** The text of a PARA_TEXT record, its control characters as tabs, breaks or nothing. */
function textOf(/** @type {Uint8Array} */ data) {
  const r = new Reader(data);
  /** @type {Inline[]} */
  const out = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(run(buffer));
    buffer = "";
  };
  for (let i = 0; i + 1 < data.length; ) {
    const c = r.u16(i);
    if (c >= 32) {
      buffer += String.fromCharCode(c);
      i += 2;
    } else if (EXTENDED.has(c) || INLINE.has(c)) {
      if (c === 9) {
        flush();
        out.push({ type: "tab" });
      }
      i += 16;
    } else {
      if (c === 10) {
        flush();
        out.push({ type: "linebreak" });
      } else if (c === 13) break;
      else if (c === 24) buffer += "-";
      else if (c === 30) buffer += " ";
      else if (c === 31) buffer += " ";
      i += 2;
    }
  }
  flush();
  return out;
}

/** A control's records (k..end): tables, headers and footers, notes, text boxes, the page. */
function control(
  /** @type {Rec[]} */ recs,
  /** @type {number} */ k,
  /** @type {number} */ end,
  /** @type {Ctx} */ ctx,
  /** @type {Inline[]} */ inlines,
  /** @type {Block[]} */ after,
) {
  const rec = /** @type {Rec} */ (recs[k]);
  const id = ctrlName(new Reader(rec.data).u32(0));
  const lists = () => {
    /** @type {Block[]} */
    const out = [];
    for (let m = k + 1; m < end; m++) {
      const item = recs[m];
      if (item?.tag !== TAG.LIST_HEADER) continue;
      const paras = new Reader(item.data).u16(0);
      const { blocks, next } = list(recs, m + 1, item.level, end, ctx, paras);
      out.push(...blocks);
      m = next - 1;
    }
    return out;
  };
  if (id === "secd") {
    for (let m = k + 1; m < end; m++) if (recs[m]?.tag === TAG.PAGE_DEF) ctx.page = recs[m]?.data;
  } else if (id === "tbl ") {
    // A caption's list comes before the TABLE record; the cells' lists after it.
    let at = k + 1;
    while (at < end && recs[at]?.tag !== TAG.TABLE) at++;
    if (at < end) {
      for (let m = k + 1; m < at; m++) {
        const item = recs[m];
        if (item?.tag !== TAG.LIST_HEADER) continue;
        const { blocks, next } = list(
          recs,
          m + 1,
          item.level,
          at,
          ctx,
          new Reader(item.data).u16(0),
        );
        after.push(...blocks);
        m = next - 1;
      }
      after.push(table(recs, at, end, ctx, rec.level));
    }
  } else if (id === "head") ctx.header = lists();
  else if (id === "foot") ctx.footer = lists();
  else if (id === "fn  " || id === "en  ") {
    const kind = id === "fn  " ? "footnote" : "endnote";
    const label = String(ctx.notes.filter((n) => n.kind === kind).length + 1);
    const note = `n${ctx.notes.length + 1}`;
    ctx.notes.push({ id: note, kind, label, blocks: lists() });
    inlines.push({ type: "noteref", note, label });
  } else if (id === "gso ") after.push(...lists());
}

/** A table: after its TABLE record, each LIST_HEADER is a cell with its address and span. */
function table(
  /** @type {Rec[]} */ recs,
  /** @type {number} */ k,
  /** @type {number} */ end,
  /** @type {Ctx} */ ctx,
  /** @type {number} */ level,
) {
  /** @type {Map<number, Array<import("../model.js").Cell & { col: number }>>} */
  const rows = new Map();
  for (let m = k + 1; m < end; m++) {
    const item = recs[m];
    if (item?.tag !== TAG.LIST_HEADER || item.level !== level + 1) continue;
    const r = new Reader(item.data);
    const { blocks, next } = list(recs, m + 1, item.level, end, ctx, r.u16(0));
    const row = r.u16(10);
    const cells = rows.get(row) ?? [];
    rows.set(row, cells);
    cells.push({
      col: r.u16(8),
      blocks,
      colSpan: Math.max(1, r.u16(12)),
      rowSpan: Math.max(1, r.u16(14)),
      width: pt(r.u32(16) / 100) || undefined,
    });
    m = next - 1;
  }
  return {
    type: "table",
    borders: true,
    rows: [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, cells]) => ({
        cells: cells.sort((a, b) => a.col - b.col).map(({ col: _, ...cell }) => cell),
      })),
  };
}
