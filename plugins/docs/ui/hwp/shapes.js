// Drawing objects ("gso " controls): the common object properties (treat as a character, size,
// description), a caption, and the shape components under them: pictures from BinData, text
// boxes' paragraphs, groups of both, OLE objects and video as labelled placeholders. A picture set
// as a character stays in its line; a floating one, and a text box, follow the paragraph.
import { Reader } from "../bytes.js";
import { pt } from "../model.js";
import { ctrlId, listAfter, TAG, wstr } from "./records.js";

/**
 * @typedef {import("./records.js").Rec} Rec
 * @typedef {import("./paragraph.js").Ctx} Ctx
 * @typedef {import("./paragraph.js").Sink} Sink
 * @typedef {import("../model.js").Image} Image
 * @typedef {{ inline: boolean, width?: number, height?: number, alt: string }} Common
 */

const size = (/** @type {number} */ hwpunit) => (hwpunit > 0 ? pt(hwpunit / 100) : undefined);

/** The properties every object control starts with (HWP 5.0, "개체 공통 속성"). */
export function commonOf(/** @type {Uint8Array} */ data) {
  const r = new Reader(data);
  const description = data.length >= 46 ? wstr(r, 44).text : "";
  return {
    inline: (r.u32(4) & 1) !== 0,
    width: size(r.u32(16)),
    height: size(r.u32(20)),
    alt: description.split(/\r?\n/)[0]?.trim() ?? "",
  };
}

/**
 * @param {Rec} ctrl a "gso " CTRL_HEADER
 * @param {Ctx} ctx
 * @param {Sink} sink
 */
export function shapeObject(ctrl, ctx, sink) {
  const common = commonOf(ctrl.data);
  /** @type {Array<Image | import("../model.js").Block>} */
  const found = [];
  const top = ctrl.kids.find((k) => k.tag === TAG.SHAPE_COMPONENT);
  if (top) component(top, common, ctx, sink, found, true);
  // A caption's list sits beside the component, directly under the control; bits 0-1 place it.
  const head = ctrl.kids.find((k) => k.tag === TAG.LIST_HEADER);
  const above = head ? (new Reader(head.data).u32(8) & 3) === 2 : false;
  const caption = sink.list(ctrl.kids);
  if (above) for (const block of caption) sink.block(block);
  for (const item of found) {
    if (item.type === "image" && common.inline) sink.inline(item);
    else sink.block(item);
  }
  if (!above) for (const block of caption) sink.block(block);
}

/**
 * A shape component: its picture, its text box, or the components of a group.
 * @param {Rec} rec a SHAPE_COMPONENT record
 * @param {Common} common the object's size and description (for the outermost component)
 * @param {Ctx} ctx
 * @param {Sink} sink
 * @param {Array<Image | import("../model.js").Block>} out
 * @param {boolean} outer
 */
function component(rec, common, ctx, sink, out, outer) {
  const r = new Reader(rec.data);
  const id = ctrlId(rec.data);
  // The outermost component writes its id twice; the current size follows the original size.
  const base = r.u32(0) === r.u32(4) ? 8 : 4;
  const width = outer ? common.width : size(r.u32(base + 20));
  const height = outer ? common.height : size(r.u32(base + 24));
  const alt = outer ? common.alt : "";
  const kids = rec.kids;
  if (id === "$pic") {
    const pic = kids.find((k) => k.tag === TAG.SHAPE_PICTURE);
    const item = pic ? ctx.pictures.get(new Reader(pic.data).u16(71)) : undefined;
    const src = item?.src ?? null;
    const shown = src ? alt || "Picture" : `Picture (${item?.kind ?? "missing"}, not shown)`;
    out.push({ type: "image", src, width, height, alt: shown });
  } else if (id === "$ole" || kids.some((k) => k.tag === TAG.SHAPE_OLE)) {
    out.push({
      type: "image",
      src: null,
      width,
      height,
      alt: alt || "Embedded object (not shown)",
    });
  } else if (kids.some((k) => k.tag === TAG.VIDEO_DATA)) {
    out.push({ type: "image", src: null, width, height, alt: alt || "Video (not shown)" });
  }
  // A text box's list, or a group's components, in the order Hangul keeps them.
  kids.forEach((kid, i) => {
    if (kid.tag === TAG.LIST_HEADER) out.push(...sink.list([kid, ...listAfter(kids, i)]));
    else if (kid.tag === TAG.SHAPE_COMPONENT) component(kid, common, ctx, sink, out, false);
    else if (kid.tag === TAG.SHAPE_TEXTART) {
      const text = textArt(kid.data);
      if (text) out.push({ type: "paragraph", inlines: [{ type: "text", bold: true, text }] });
    }
  });
}

/** Text art keeps its text first, as a WORD-counted string; anything else is left out. */
function textArt(/** @type {Uint8Array} */ data) {
  const { text, end } = wstr(new Reader(data), 0);
  const printable = [...text].every((c) => c.charCodeAt(0) >= 32);
  return end <= data.length && text && printable ? text : "";
}
