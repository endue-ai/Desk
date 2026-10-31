// The inside of an OOXML paragraph: runs and their formatting, hyperlinks, simple and complex
// fields (HYPERLINK, PAGE), tracked insertions shown and deletions left out, comment ranges, note
// references, breaks, symbols, and pictures (DrawingML and VML) as images.
import { emu, length, text as run } from "../model.js";
import { bullet } from "../numbers.js";
import { attr, find, findAll, kid, kids, num } from "../xml.js";
import { runProps } from "./styles.js";

/**
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("./styles.js").RunProps} RunProps
 * @typedef {{ instr: string, phase: "instr" | "result" | "skip" }} Field
 * @typedef {{
 *   styles: import("./styles.js").Styles,
 *   rels: Map<string, { type: string, target: string, external: boolean }>,
 *   media: Map<string, string | null>,
 *   fields: Field[],
 *   comments: Set<string>,
 *   ranged: Set<string>,
 *   known: Set<string>,
 *   noteRef(kind: "footnote" | "endnote", id: string): Inline | undefined,
 *   boxes(content: Element): Block[],
 *   pending: Block[],
 * }} Ctx
 */

const SKIP = new Set([
  "del",
  "moveFrom",
  "proofErr",
  "bookmarkStart",
  "bookmarkEnd",
  "permStart",
  "permEnd",
  "pPr",
  "rPr",
]);

/** A safe link target: http(s) and mailto only. */
export const safeLink = (/** @type {string | undefined | null} */ url) =>
  url && /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : undefined;

/**
 * The inlines of a paragraph (or of a hyperlink, insertion, smart tag... inside one).
 * @param {Element} parent
 * @param {RunProps} base the paragraph's run properties
 * @param {Ctx} ctx
 * @param {{ link?: string }} [scope]
 * @returns {Inline[]}
 */
export function inlines(parent, base, ctx, scope = {}) {
  /** @type {Inline[]} */
  const out = [];
  for (const el of kids(parent)) {
    const name = el.localName;
    if (SKIP.has(name)) continue;
    if (name === "r") out.push(...runInlines(el, base, ctx, scope));
    else if (name === "hyperlink") {
      const rel = ctx.rels.get(attr(el, "id") ?? "");
      const link = safeLink(rel?.external ? rel.target : undefined) ?? scope.link;
      out.push(...inlines(el, base, ctx, { ...scope, link }));
    } else if (name === "fldSimple") {
      const instr = (attr(el, "instr") ?? "").trim();
      const field = fieldKind(instr);
      if (field) out.push({ type: "field", field, text: el.textContent ?? "" });
      else
        out.push(...inlines(el, base, ctx, { ...scope, link: hyperlinkOf(instr) ?? scope.link }));
    } else if (["ins", "moveTo", "smartTag", "customXml", "dir", "bdo"].includes(name))
      out.push(...inlines(el, base, ctx, scope));
    else if (name === "sdt") out.push(...inlines(kid(el, "sdtContent") ?? el, base, ctx, scope));
    else if (name === "AlternateContent") {
      const choice = kid(el, "Choice") ?? kid(el, "Fallback");
      if (choice) out.push(...inlines(choice, base, ctx, scope));
    } else if (name === "commentRangeStart") {
      const id = attr(el, "id") ?? "";
      ctx.ranged.add(id);
      if (ctx.known.has(id)) ctx.comments.add(id);
    } else if (name === "commentRangeEnd") ctx.comments.delete(attr(el, "id") ?? "");
    else if (name === "oMath" || name === "oMathPara")
      out.push(
        run(
          findAll(el, "t")
            .map((t) => t.textContent)
            .join(""),
          { ...base, italic: true },
        ),
      );
  }
  return out;
}

const fieldKind = (/** @type {string} */ instr) => {
  const word = instr.split(/\s+/)[0]?.toUpperCase();
  return word === "PAGE" ? "page" : word === "NUMPAGES" ? "pages" : undefined;
};

const hyperlinkOf = (/** @type {string} */ instr) => {
  const match = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instr);
  return safeLink(match?.[1]);
};

/**
 * One w:r: its properties, then its text, tabs, breaks, pictures and references.
 * @param {Element} r
 * @param {RunProps} base
 * @param {Ctx} ctx
 * @param {{ link?: string }} scope
 * @returns {Inline[]}
 */
function runInlines(r, base, ctx, scope) {
  const rPr = kid(r, "rPr");
  const charStyle = ctx.styles.character(attr(kid(rPr, "rStyle"), "val"));
  const props = { ...base, ...charStyle?.rPr, ...runProps(rPr, ctx.styles.theme) };
  /** @type {Inline[]} */
  const out = [];
  const field = ctx.fields.at(-1);
  const linked = field?.phase === "result" ? (hyperlinkOf(field.instr) ?? scope.link) : scope.link;
  const push = (/** @type {string} */ value) => {
    if (value === "" || props.hidden) return;
    if (ctx.fields.some((f) => f.phase !== "result")) return;
    const last = out.at(-1);
    if (last?.type === "text") {
      last.text += value;
      return;
    }
    const { hidden: _, ...shown } = props;
    /** @type {import("../model.js").TextRun} */
    const textRun = run(value, shown);
    if (linked) textRun.link = linked;
    if (ctx.comments.size > 0) textRun.comments = [...ctx.comments];
    out.push(textRun);
  };
  const inline = (/** @type {Inline} */ item) => {
    if (ctx.fields.some((f) => f.phase !== "result")) return;
    out.push(item);
  };
  for (const el of kids(r)) {
    switch (el.localName) {
      case "t":
        push(el.textContent ?? "");
        break;
      case "tab":
      case "ptab":
        inline({ type: "tab" });
        break;
      case "br":
        if (attr(el, "type") === "page") inline({ type: "pagebreak" });
        else inline({ type: "linebreak" });
        break;
      case "cr":
        inline({ type: "linebreak" });
        break;
      case "noBreakHyphen":
        push("‑");
        break;
      case "softHyphen":
        push("­");
        break;
      case "sym": {
        const code = Number.parseInt(attr(el, "char") ?? "", 16);
        if (Number.isFinite(code)) push(bullet(String.fromCharCode(code), attr(el, "font") ?? ""));
        break;
      }
      case "fldChar": {
        const kind = attr(el, "fldCharType");
        if (kind === "begin") ctx.fields.push({ instr: "", phase: "instr" });
        else if (kind === "separate") {
          const top = ctx.fields.at(-1);
          if (top) {
            const fieldName = fieldKind(top.instr.trim());
            top.phase = "result";
            if (fieldName) {
              inline({ type: "field", field: fieldName, text: "" });
              top.phase = "skip";
            }
          }
        } else if (kind === "end") ctx.fields.pop();
        break;
      }
      case "instrText": {
        const top = ctx.fields.at(-1);
        if (top?.phase === "instr") top.instr += el.textContent ?? "";
        break;
      }
      case "footnoteReference":
      case "endnoteReference": {
        const ref = ctx.noteRef(
          el.localName === "footnoteReference" ? "footnote" : "endnote",
          attr(el, "id") ?? "",
        );
        if (ref) inline(ref);
        break;
      }
      case "commentReference": {
        const id = attr(el, "id") ?? "";
        if (ctx.known.has(id) && !ctx.ranged.has(id)) inline({ type: "anchor", comments: [id] });
        break;
      }
      case "drawing":
        for (const item of drawing(el, ctx)) inline(item);
        break;
      case "pict":
      case "object":
        for (const item of vml(el, ctx)) inline(item);
        break;
      case "AlternateContent": {
        const choice = kid(el, "Choice") ?? kid(el, "Fallback");
        if (choice) out.push(...runInlines(choice, base, ctx, scope));
        break;
      }
      case "ruby":
        push(kid(el, "rubyBase")?.textContent ?? "");
        break;
    }
  }
  return out;
}

/**
 * A DrawingML picture (inline or anchored, shown inline), a chart's placeholder, or a text box
 * whose paragraphs follow the current one.
 * @param {Element} el
 * @param {Ctx} ctx
 * @returns {Inline[]}
 */
function drawing(el, ctx) {
  const frame = kid(el, "inline") ?? kid(el, "anchor");
  const extent = kid(frame, "extent");
  const width = emu(num(extent, "cx") ?? 0) || undefined;
  const height = emu(num(extent, "cy") ?? 0) || undefined;
  const docPr = kid(frame, "docPr");
  const alt = attr(docPr, "descr") || attr(docPr, "title") || attr(docPr, "name") || "Picture";
  const blip = find(frame, "blip");
  if (blip) {
    const id = attr(blip, "embed") ?? "";
    const src = ctx.media.get(id) ?? null;
    return [{ type: "image", src, width, height, alt: src ? alt : `${alt} (not shown)` }];
  }
  const box = find(frame, "txbxContent");
  if (box) ctx.pending.push(...ctx.boxes(box));
  else if (find(frame, "chart"))
    return [{ type: "image", src: null, width, height, alt: "Chart (not shown)" }];
  return [];
}

/** A VML picture (w:pict, w:object) with its size from the shape's style. */
function vml(/** @type {Element} */ el, /** @type {Ctx} */ ctx) {
  const shape = find(el, "shape") ?? find(el, "rect");
  const style = attr(shape, "style") ?? "";
  const size = (/** @type {string} */ key) =>
    length(new RegExp(`${key}:\\s*([^;]+)`).exec(style)?.[1]);
  const data = find(el, "imagedata");
  /** @type {Inline[]} */
  const out = [];
  if (data) {
    const src = ctx.media.get(attr(data, "id") ?? "") ?? null;
    const alt = attr(data, "title") || attr(shape, "alt") || "Picture";
    out.push({
      type: "image",
      src,
      width: size("width"),
      height: size("height"),
      alt: src ? alt : `${alt} (not shown)`,
    });
  }
  const box = find(el, "txbxContent");
  if (box) ctx.pending.push(...ctx.boxes(box));
  return out;
}
