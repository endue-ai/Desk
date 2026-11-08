// Paragraphs: the PARA_HEADER, its text (WCHARs with 1-unit and 8-unit control characters), the
// character-shape runs by position, highlighter range tags, and the line segments, whose vertical
// positions start again at 0 on each new page: there the paragraph gets the page break Hangul drew.
import { Reader } from "../bytes.js";
import { paragraph } from "../model.js";
import { control } from "./controls.js";
import { bulletMarker } from "./numbering.js";
import { colorref, ctrlId, listAfter, TAG } from "./records.js";

/**
 * @typedef {import("./records.js").Rec} Rec
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("../model.js").TextRun} TextRun
 * @typedef {object} Ctx
 * @property {import("./docinfo.js").Info} info
 * @property {(id: number, level: number) => string | undefined} number
 * @property {Map<number, { src: string | null, kind: string }>} pictures by BinData id
 * @property {import("../model.js").Note[]} notes
 * @property {{ header: Block[], footer: Block[] }} headers
 * @property {Uint8Array | undefined} page the section's PAGE_DEF
 * @property {{ top: boolean, align: import("../model.js").Align, prefix: string, suffix: string } | undefined} pageNumber
 * @property {number} outline the numbering of the section's outline paragraphs
 * @property {number} columns
 * @property {string | undefined} link the hyperlink a field opened
 * @property {boolean} inNote
 * @property {number} vpos the last body line's vertical position, -1 at a section start
 * @typedef {{ inline(item: Inline): void, block(item: Block): void, props(): Partial<TextRun>, list(kids: Rec[], inNote?: boolean): Block[] }} Sink
 */

/** Control characters of eight code units: extended (a control record follows) and inline. */
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
const INLINE = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

/** The language whose relative size a run takes: 0 Hangul, 1 Latin, 2 Hanja, 3 Japanese. */
function langOf(/** @type {string} */ text) {
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text)) return 0;
  if (/[\u3040-\u30ff]/.test(text)) return 3;
  if (/[\u4e00-\u9fff]/.test(text)) return 2;
  return 1;
}

/**
 * The blocks of the paragraph lists after each LIST_HEADER among `kids`.
 * @param {Rec[]} kids
 * @param {Ctx} ctx
 */
export function listBlocks(kids, ctx) {
  /** @type {Block[]} */
  const out = [];
  kids.forEach((kid, i) => {
    if (kid.tag !== TAG.LIST_HEADER) return;
    for (const para of listAfter(kids, i)) out.push(...paragraphBlocks(para, ctx, false));
  });
  return out;
}

/**
 * One paragraph and what its controls hold: page breaks, the paragraph, then the tables, floating
 * pictures and text boxes anchored in it.
 * @param {Rec} node a PARA_HEADER record
 * @param {Ctx} ctx
 * @param {boolean} body a section's own paragraph, whose line segments place page breaks
 * @returns {Block[]}
 */
export function paragraphBlocks(node, ctx, body) {
  const head = new Reader(node.data);
  const { info } = ctx;
  const kid = (/** @type {number} */ tag) => node.kids.find((k) => k.tag === tag)?.data;
  const text = new Reader(kid(TAG.PARA_TEXT) ?? new Uint8Array(0));
  const shapes = entries(kid(TAG.PARA_CHAR_SHAPE), 8);
  const runs = shapes.at.map((at) => [shapes.r.u32(at), shapes.r.u32(at + 4)]);
  // Range tags of kind 2 are the highlighter; the low 24 bits its colour.
  const tags = entries(kid(TAG.PARA_RANGE_TAG), 12);
  const marks = tags.at
    .filter((at) => tags.r.u32(at + 8) >>> 24 === 2)
    .map((at) => ({
      from: tags.r.u32(at),
      to: tags.r.u32(at + 4),
      color: colorref(tags.r.u32(at + 8) & 0xffffff),
    }));
  const ctrls = node.kids.filter((k) => k.tag === TAG.CTRL_HEADER);

  // Page breaks where Hangul's layout began a new page: before the paragraph or inside it.
  let breakBefore = (head.u8(11) & 0x04) !== 0;
  /** @type {Set<number>} */
  const splits = new Set();
  if (body) {
    const segs = entries(kid(TAG.PARA_LINE_SEG), 36);
    for (const [k, at] of segs.at.entries()) {
      const start = segs.r.u32(at);
      const vpos = segs.r.i32(at + 4);
      if (ctx.columns <= 1 && ctx.vpos >= 0 && vpos < ctx.vpos) {
        if (k === 0) breakBefore = true;
        else splits.add(start);
      }
      ctx.vpos = vpos;
    }
  }

  /** @type {Inline[][]} */
  const parts = [[]];
  /** @type {Block[]} */
  const after = [];
  let buffer = "";
  let style = "";
  let shape = 0;
  let run = 0;
  /** @type {string | undefined} */
  let mark;
  const props = () => {
    const char = info.chars[shape];
    /** @type {Partial<TextRun>} */
    const out = { ...char?.props, size: char?.sizes[langOf(buffer)] };
    if (!out.size) delete out.size;
    if (mark) out.highlight = mark;
    if (ctx.link) out.link = ctx.link;
    return out;
  };
  const flush = () => {
    if (buffer) push({ type: "text", ...props(), text: buffer });
    buffer = "";
  };
  /** A run joins the run before it when they look the same. */
  const push = (/** @type {Inline} */ item) => {
    const line = /** @type {Inline[]} */ (parts.at(-1));
    const last = line.at(-1);
    if (item.type === "text" && last?.type === "text" && same(last, item)) last.text += item.text;
    else line.push(item);
  };
  /** @type {Sink} */
  const sink = {
    inline: push,
    block: (item) => after.push(item),
    props,
    list: (kids, inNote = false) => listBlocks(kids, { ...ctx, inNote, link: undefined }),
  };
  let next = 0;
  const units = text.bytes.length >> 1;
  for (let i = 0; i < units; ) {
    let nextShape = shape;
    while (run < runs.length && (runs[run]?.[0] ?? 0) <= i) nextShape = runs[run++]?.[1] ?? 0;
    const nextMark = marks.find((m) => m.from <= i && i < m.to)?.color;
    const now = `${nextShape}|${nextMark}|${ctx.link}`;
    if (now !== style) {
      flush();
      style = now;
    }
    shape = nextShape;
    mark = nextMark;
    if (splits.has(i)) {
      flush();
      parts.push([]);
    }
    const c = text.u16(i * 2);
    if (c >= 32) {
      buffer += String.fromCharCode(c);
      i++;
    } else if (EXTENDED.has(c)) {
      flush();
      const id = ctrlId(text.bytes.subarray(i * 2 + 2, i * 2 + 6));
      const found = ctrls.findIndex((r, k) => k >= next && ctrlId(r.data) === id);
      const rec = ctrls[found >= 0 ? found : next];
      next = (found >= 0 ? found : next) + 1;
      if (rec) control(rec, ctx, sink);
      style = "";
      i += 8;
    } else if (INLINE.has(c)) {
      flush();
      if (c === 9) push({ type: "tab" });
      else if (c === 4) ctx.link = undefined;
      style = "";
      i += 8;
    } else if (c === 13) break;
    else {
      if (c === 10) {
        flush();
        push({ type: "linebreak" });
      } else if (c === 24) buffer += "-";
      else if (c === 30) buffer += "\u00a0";
      else if (c === 31) buffer += " ";
      i++;
    }
  }
  flush();
  return assemble(node, ctx, { parts, after, breakBefore: body && breakBefore }, body);
}

/** Whether two runs differ only in their text. */
function same(/** @type {TextRun} */ a, /** @type {TextRun} */ b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("text");
  for (const key of keys)
    if (a[/** @type {keyof TextRun} */ (key)] !== b[/** @type {keyof TextRun} */ (key)])
      return false;
  return true;
}

/** The paragraph's properties and marker, its parts as paragraphs between page breaks (which only
 * a section's own paragraphs get: the page view breaks pages nowhere else). */
function assemble(
  /** @type {Rec} */ node,
  /** @type {Ctx} */ ctx,
  /** @type {{ parts: Inline[][], after: Block[], breakBefore: boolean }} */ found,
  /** @type {boolean} */ body,
) {
  const head = new Reader(node.data);
  const { info } = ctx;
  const style = info.styles[head.u8(10)];
  const shape = info.paras[head.u16(8)];
  /** @type {Partial<import("../model.js").Paragraph>} */
  const props = {};
  if (style?.name && !/^(바탕글|Normal)$/.test(style.name)) props.style = style.name;
  if (shape?.align) props.align = shape.align;
  if (shape?.indent) props.indent = shape.indent;
  if (shape?.spacing) props.spacing = shape.spacing;
  if (shape?.head === 1 && shape.level < 6) props.level = shape.level + 1;
  const marker =
    shape?.head === 1
      ? ctx.number(ctx.outline || shape.numbering, shape.level)
      : shape?.head === 2
        ? ctx.number(shape.numbering, shape.level)
        : shape?.head === 3
          ? bulletMarker(info.bullets[shape.numbering - 1])
          : undefined;
  if (marker) props.marker = marker;
  /** @type {Block[]} */
  const out = [];
  if (found.breakBefore || (body && shape?.breakBefore)) out.push({ type: "pagebreak" });
  const { parts, after } = found;
  const [first = [], ...rest] = parts;
  if (first.length || after.length === 0 || rest.length) out.push(paragraph(first, props));
  // The rest of a paragraph a page break cut keeps no marker and no first-line indent.
  const { marker: _, indent, ...more } = props;
  for (const inlines of rest)
    out.push(
      { type: "pagebreak" },
      paragraph(inlines, indent ? { ...more, indent: { ...indent, first: 0 } } : more),
    );
  out.push(...after);
  return out;
}

/** The offsets of a record's fixed-size entries, and a reader over it. */
function entries(/** @type {Uint8Array | undefined} */ data, /** @type {number} */ size) {
  const r = new Reader(data ?? new Uint8Array(0));
  /** @type {number[]} */
  const at = [];
  for (let o = 0; o + size <= r.bytes.length; o += size) at.push(o);
  return { r, at };
}
