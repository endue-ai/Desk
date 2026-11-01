// A story's blocks ([MS-DOC] 2.4): paragraphs found by their marks, each with its style, list and
// direct properties; runs cut where the look, a link or a comment changes; fields shown by their
// result; tables nested by depth; pictures, note references, comment points and text boxes in
// place. Tracked deletions and hidden text are left out; a deleted paragraph mark joins two
// paragraphs, as the final text has them.
import { paragraph } from "../model.js";
import { bullet } from "../numbers.js";
import { inlinePicture } from "./pictures.js";
import { applyChp, applyPap, depthOf } from "./props.js";
import { commentTracker, fieldOf, lookOf, paragraphShape } from "./shape.js";
import { applyTap, buildTable, emptyTap } from "./tables.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("../model.js").TextRun} TextRun
 * @typedef {import("./props.js").Chp} Chp
 * @typedef {{ instr: string, phase: "instr" | "result" | "skip", link?: string, drawn?: boolean }} Field
 *   drawn: a drawing in the result showed a picture or a text box, so the result's old-style
 *   copy (a SHAPE field's 0x01 picture, for readers before Word 2000) is left out.
 * @typedef {{ rows: import("./tables.js").RowIn[], cells: Block[][], cell: Block[], styleBorders: boolean }} TableIn
 * @typedef {"main" | "note" | "header" | "comment" | "box"} Kind
 * @typedef {{
 *   text: ReturnType<typeof import("./text.js").readText>,
 *   styles: import("./styles.js").Styles,
 *   lists: import("./lists.js").Lists,
 *   fonts: string[],
 *   data: Uint8Array | undefined,
 *   ranges: Array<{ id: string, start: number, end: number }>,
 *   sectionEnds: Set<number>,
 *   noteRef(cp: number, label?: string): Inline | undefined,
 *   customNote(cp: number): boolean,
 *   commentPoint(cp: number): string | undefined,
 *   shapes(cp: number, kind: Kind): { images: Inline[], blocks: Block[] },
 * }} DocCtx
 */

/**
 * The blocks of the story [from, to); `onSection` gets the blocks of each section of the main
 * document as its end is reached.
 * @param {DocCtx} doc
 * @param {number} from
 * @param {number} to
 * @param {Kind} kind
 * @param {(blocks: Block[]) => void} [onSection]
 * @returns {Block[]}
 */
export function walk(doc, from, to, kind, onSection) {
  const text = doc.text.chars(from, to);
  const segments = doc.text.segments(from, to);
  const comments = kind === "main" ? commentTracker(doc.ranges) : () => undefined;
  /** @type {Map<number, Chp>} */
  const cache = new Map();
  let seg = 0;
  /** @type {Block[]} */
  let out = [];
  /** @type {TableIn[]} */
  const tables = [];
  /** @type {Field[]} */
  const fields = [];
  /** @type {Inline[]} */
  let carry = [];
  /** @type {Block[]} */
  const pending = [];
  /** What each run was made from, so the next text of the same look, link and comments joins it. */
  /** @type {WeakMap<TextRun, unknown[]>} */
  const sigs = new WeakMap();

  /** The character properties at `cp` in a paragraph of style `istd`. */
  const chpAt = (/** @type {number} */ cp, /** @type {number} */ istd) => {
    while (seg + 1 < segments.length && (segments[seg]?.end ?? 0) <= cp) seg++;
    const key = seg * 4096 + (istd & 4095);
    const done = cache.get(key);
    if (done) return done;
    const plain = doc.styles.style(istd).chp;
    const chp = { ...plain };
    const env = {
      style: plain,
      plain,
      charStyle: (/** @type {number} */ c) => doc.styles.charStyle(istd, c),
    };
    applyChp(chp, segments[seg]?.chpx ?? null, env);
    applyChp(chp, segments[seg]?.prm ?? null, env);
    cache.set(key, chp);
    return chp;
  };

  /** Close the tables deeper than `depth` into their parent; open new ones up to it. */
  const sync = (/** @type {number} */ depth) => {
    while (tables.length > depth) {
      const t = /** @type {TableIn} */ (tables.pop());
      if (t.cell.length) t.cells.push(t.cell);
      if (t.cells.length) t.rows.push({ tap: emptyTap(), cells: t.cells });
      if (t.rows.length) (tables.at(-1)?.cell ?? out).push(buildTable(t.rows, t.styleBorders));
    }
    while (tables.length < depth)
      tables.push({ rows: [], cells: [], cell: [], styleBorders: false });
  };

  /** The inlines of [i, j), split where page breaks are. */
  const inlinesOf = (
    /** @type {number} */ i,
    /** @type {number} */ j,
    /** @type {number} */ istd,
  ) => {
    /** @type {Inline[][]} */
    const parts = [carry];
    carry = [];
    const last = () => /** @type {Inline[]} */ (parts.at(-1));
    const push = (/** @type {Inline} */ inline) => {
      last().push(inline);
    };
    const say = (/** @type {string} */ value, /** @type {Chp} */ chp, /** @type {number} */ cp) => {
      const look = lookOf(chp, doc.fonts);
      const link = fields.findLast((f) => f.phase === "result" && f.link)?.link;
      const notes = comments(cp);
      const prev = last().at(-1);
      const sig = prev?.type === "text" ? sigs.get(prev) : undefined;
      if (prev?.type === "text" && sig?.[0] === look && sig[1] === link && sig[2] === notes) {
        prev.text += value;
        return;
      }
      /** @type {TextRun} */
      const next = { type: "text", ...look, text: value };
      if (link) next.link = link;
      if (notes) next.comments = [...notes];
      last().push(next);
      sigs.set(next, [look, link, notes]);
    };
    const shown = (/** @type {Field[]} */ list) => list.every((f) => f.phase === "result");
    for (let k = i; k < j; k++) {
      const cp = from + k;
      const code = text.charCodeAt(k);
      if (code === 0x13) {
        fields.push({ instr: "", phase: "instr" });
        continue;
      }
      if (code === 0x14 || code === 0x15) {
        const top = code === 0x15 ? fields.pop() : fields.at(-1);
        if (top?.phase === "instr") {
          const field = fieldOf(top.instr);
          if (field.page && shown(code === 0x15 ? fields : fields.slice(0, -1)))
            push({ type: "field", field: field.page, text: "" });
          top.phase = field.page ? "skip" : "result";
          if (field.link) top.link = field.link;
        }
        continue;
      }
      if (!shown(fields)) {
        const top = fields.at(-1);
        if (top?.phase === "instr") top.instr += text[k];
        continue;
      }
      const chp = chpAt(cp, istd);
      if (chp.deleted || chp.vanish) continue;
      if (kind === "main" && doc.customNote(cp)) {
        const ref = doc.noteRef(cp, text[k]);
        if (ref) push(ref);
        continue;
      }
      if (chp.spec) {
        if (code === 0x01) {
          if (!chp.data && !fields.at(-1)?.drawn) push(inlinePicture(doc.data, chp.pic));
          continue;
        }
        if (code === 0x02) {
          const ref = kind === "main" ? doc.noteRef(cp) : undefined;
          if (ref) push(ref);
          continue;
        }
        if (code === 0x05) {
          const id = kind === "main" ? doc.commentPoint(cp) : undefined;
          if (id) push({ type: "anchor", comments: [id] });
          continue;
        }
        if (code === 0x08) {
          const found = doc.shapes(cp, kind);
          const field = fields.at(-1);
          if (field && (found.images.length || found.blocks.length)) field.drawn = true;
          for (const image of found.images) push(image);
          pending.push(...found.blocks);
          continue;
        }
        if (code === 0x28 && chp.symbol) {
          const font = doc.fonts[chp.symbol.ftc] ?? "";
          say(bullet(String.fromCharCode(chp.symbol.char), font), chp, cp);
          continue;
        }
        if (code < 0x20 || code === 0x3c || code === 0x3e) continue;
      }
      if (code === 0x09) push({ type: "tab" });
      else if (code === 0x0b || code === 0x0e) push({ type: "linebreak" });
      else if (code === 0x0c) parts.push([]);
      else if (code === 0x1e) say("‑", chp, cp);
      else if (code === 0x1f) say("­", chp, cp);
      else if (code >= 0x20) say(text[k] ?? "", chp, cp);
    }
    return parts;
  };

  const isMark = (/** @type {number} */ k) => {
    const code = text.charCodeAt(k);
    return (
      code === 0x0d ||
      code === 0x07 ||
      (code === 0x0c && doc.sectionEnds.has(from + k) && kind === "main")
    );
  };

  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && !isMark(j)) j++;
    const cp = from + Math.min(j, text.length - 1);
    const papx = doc.text.papxAt(cp);
    const style = doc.styles.style(papx.istd);
    let pap = { ...style.pap };
    applyPap(pap, papx.grpprl, doc.data);
    applyPap(pap, papx.prm, doc.data);
    let marker = "";
    if (pap.ilfo > 0) {
      const item = doc.lists.next(pap.ilfo, pap.ilvl);
      if (item) {
        const listed = { ...style.pap };
        applyPap(listed, item.papx, doc.data);
        applyPap(listed, papx.grpprl, doc.data);
        applyPap(listed, papx.prm, doc.data);
        pap = listed;
        marker = item.text;
      }
    }
    const parts = inlinesOf(i, Math.min(j, text.length), papx.istd);
    const code = text.charCodeAt(j);
    const mark = j < text.length ? chpAt(cp, papx.istd) : undefined;
    const depth = depthOf(pap);
    const rowEnd = depth > 0 && (depth === 1 ? pap.ttp : pap.innerTtp);
    const cellEnd = depth > 0 && !rowEnd && (depth === 1 ? code === 0x07 : pap.innerCell);
    const sectionEnd = kind === "main" && doc.sectionEnds.has(cp);
    sync(depth);
    const t = tables[depth - 1];
    if (rowEnd && t) {
      const tap = emptyTap();
      applyTap(tap, papx.grpprl);
      applyTap(tap, papx.prm);
      if (tap.istd >= 0) {
        const styled = emptyTap();
        for (const g of doc.styles.style(tap.istd).tapx) applyTap(styled, g);
        if (styled.borders || styled.cells.some((c) => c.border)) t.styleBorders = true;
      }
      if (t.cell.length) t.cells.push(t.cell);
      if (!mark?.deleted) t.rows.push({ tap, cells: t.cells });
      t.cells = [];
      t.cell = [];
    } else if (
      mark?.deleted &&
      code === 0x0d &&
      depth === 0 &&
      !sectionEnd &&
      j + 1 < text.length
    ) {
      carry = parts.flat();
    } else {
      const shape = paragraphShape(pap, style);
      /** @type {Block[]} */
      const blocks = [];
      // A break before the first paragraph of a section would only leave an empty page.
      if (pap.breakBefore && depth === 0 && kind === "main" && out.length > 0)
        blocks.push({ type: "pagebreak" });
      let first = true;
      parts.forEach((items, n) => {
        if (n > 0) blocks.push({ type: "pagebreak" });
        if (items.length === 0 && parts.length > 1) return;
        if (first) blocks.push(paragraph(items, marker ? { ...shape, marker } : shape));
        else blocks.push(paragraph(items, { ...shape, indent: { ...shape.indent, first: 0 } }));
        first = false;
      });
      const into = t ? t.cell : out;
      into.push(...blocks, ...pending.splice(0));
      if (cellEnd && t) {
        t.cells.push(t.cell);
        t.cell = [];
      }
    }
    if (sectionEnd && onSection) {
      sync(0);
      onSection(out);
      out = [];
    }
    i = j + 1;
  }
  sync(0);
  if (carry.length) out.push(paragraph(carry));
  out.push(...pending.splice(0));
  return out;
}
