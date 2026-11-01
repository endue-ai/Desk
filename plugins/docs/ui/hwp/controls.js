// Extended controls, by their four-letter id: the section's page and columns, headers and footers,
// footnotes and endnotes, automatic numbers, the page number position, hyperlink fields,
// equations as their script, ruby and overlapped characters as text; tables and drawing objects
// have their own modules. Hidden comments, bookmarks and index marks show nothing, as in Hangul.
import { Reader } from "../bytes.js";
import { hwpNumber } from "./numbering.js";
import { ctrlId, TAG, wstr } from "./records.js";
import { shapeObject } from "./shapes.js";
import { tableBlocks } from "./table.js";

/**
 * @typedef {import("./records.js").Rec} Rec
 * @typedef {import("./paragraph.js").Ctx} Ctx
 * @typedef {import("./paragraph.js").Sink} Sink
 */

/** Where a page number position (bits 8-11) puts the number: top or bottom, and the side. */
const PAGE_NUMBER = /** @type {Record<number, [boolean, import("../model.js").Align]>} */ ({
  1: [true, "left"],
  2: [true, "center"],
  3: [true, "right"],
  4: [false, "left"],
  5: [false, "center"],
  6: [false, "right"],
  7: [true, "right"],
  8: [false, "right"],
  9: [true, "left"],
  10: [false, "left"],
});

/** A hyperlink field's target from its command ("http\://example.com;1;0;0;"). */
export function linkOf(/** @type {string} */ command) {
  const url = command.replace(/\\(.)/g, "$1").split(";")[0]?.trim() ?? "";
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}

const char = (/** @type {Reader} */ r, /** @type {number} */ at) => {
  const c = r.u16(at);
  return c >= 32 ? String.fromCharCode(c) : "";
};

/**
 * @param {Rec} rec a CTRL_HEADER record
 * @param {Ctx} ctx
 * @param {Sink} sink
 */
export function control(rec, ctx, sink) {
  const id = ctrlId(rec.data);
  const r = new Reader(rec.data);
  switch (id) {
    case "secd":
      ctx.page = rec.kids.find((k) => k.tag === TAG.PAGE_DEF)?.data ?? ctx.page;
      ctx.outline = r.u16(18);
      return;
    case "cold":
      ctx.columns = (r.u16(4) >>> 2) & 0xff || 1;
      return;
    case "head":
    case "foot":
      // Bits 0-1: both pages, even pages only, odd pages only. One header per section here.
      if ((r.u32(4) & 3) !== 1)
        ctx.headers = {
          ...ctx.headers,
          [id === "head" ? "header" : "footer"]: sink.list(rec.kids),
        };
      return;
    case "fn  ":
    case "en  ": {
      const kind = id === "fn  " ? "footnote" : "endnote";
      const count = ctx.notes.filter((n) => n.kind === kind).length + 1;
      // Number, decorations and shape follow the control id, as Hangul writes them.
      const label =
        rec.data.length >= 16
          ? `${char(r, 8)}${hwpNumber(r.u32(4) || count, r.u32(12) & 0xff)}${char(r, 10)}`
          : String(count);
      /** @type {import("../model.js").Note} */
      const note = { id: `n${ctx.notes.length + 1}`, kind, label, blocks: [] };
      ctx.notes.push(note);
      note.blocks = sink.list(rec.kids, true);
      sink.inline({ type: "noteref", note: note.id, label });
      return;
    }
    case "atno": {
      // Kinds: page, footnote, endnote, picture, table, equation; a note's own number is its label.
      const props = r.u32(4);
      const kind = props & 0xf;
      if (kind === 0) sink.inline({ type: "field", field: "page", text: "" });
      else if (!(ctx.inNote && (kind === 1 || kind === 2)))
        sink.inline({
          type: "text",
          ...sink.props(),
          text: hwpNumber(r.u16(8), (props >>> 4) & 0xff),
        });
      return;
    }
    case "pgnp": {
      const where = PAGE_NUMBER[(r.u32(4) >>> 8) & 0xf];
      ctx.pageNumber = where
        ? { top: where[0], align: where[1], prefix: char(r, 10), suffix: char(r, 12) }
        : undefined;
      return;
    }
    case "%hlk":
      ctx.link = linkOf(wstr(r, 9).text);
      return;
    case "eqed": {
      // The equation's script, in italics: the model has no mathematics.
      const eq = rec.kids.find((k) => k.tag === TAG.EQEDIT);
      const script = eq ? wstr(new Reader(eq.data), 4).text.trim() : "";
      if (script) sink.inline({ type: "text", ...sink.props(), italic: true, text: script });
      return;
    }
    case "tdut": {
      // Ruby: the main text, its annotation after it as superscript.
      const main = wstr(r, 4);
      const sub = wstr(r, main.end).text;
      if (main.text) sink.inline({ type: "text", ...sink.props(), text: main.text });
      if (sub) sink.inline({ type: "text", ...sink.props(), script: "super", text: sub });
      return;
    }
    case "tcps": {
      const text = wstr(r, 4).text;
      if (text) sink.inline({ type: "text", ...sink.props(), text });
      return;
    }
    case "tbl ":
      for (const block of tableBlocks(rec, ctx, sink)) sink.block(block);
      return;
    case "gso ":
      shapeObject(rec, ctx, sink);
      return;
  }
}
