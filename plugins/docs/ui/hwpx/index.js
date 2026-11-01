// Hangul HWPX (OWPML, KS X 6101): the package manifest, header.xml's shapes, and each section's
// paragraphs, runs, tables with cell spans, pictures from BinData, headers, footers, footnotes,
// hyperlink fields and tracked changes shown as the final text.
import { pictureUrl } from "../bytes.js";
import { DocError, documentOf, ENCRYPTED, paragraph, pt, text as run, section } from "../model.js";
import { safeLink } from "../ooxml/inline.js";
import { attr, find, findAll, kid, kids, num, parseXml } from "../xml.js";
import { readHeader } from "./header.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {{ header: import("./header.js").Header, images: Map<string, string | null>, notes: import("../model.js").Note[], pending: Block[], link?: string, deleted: boolean, outline: string, page?: Element | null, headers: { header: Block[], footer: Block[] } }} Ctx
 */

const unit = (/** @type {number | undefined} */ v) => (v === undefined ? undefined : pt(v / 100));

/** @param {import("../zip.js").Zip} zip */
export async function readHwpx(zip) {
  const manifest = await zip.text("META-INF/manifest.xml");
  if (manifest && /encryption-data/.test(manifest)) throw new DocError(ENCRYPTED);
  const hpfPath = zip.names().find((n) => /content\.hpf$/i.test(n)) ?? "Contents/content.hpf";
  const hpfText = await zip.text(hpfPath);
  const hpf = hpfText ? parseXml(hpfText, "content.hpf") : undefined;
  /** @type {Map<string, string>} */
  const items = new Map(
    findAll(hpf, "item").map((i) => [attr(i, "id") ?? "", attr(i, "href") ?? ""]),
  );
  const spine = findAll(hpf, "itemref").map((r) => items.get(attr(r, "idref") ?? "") ?? "");
  const sectionPaths = spine.filter((p) => /section\d+\.xml$/i.test(p));
  if (sectionPaths.length === 0)
    sectionPaths.push(
      ...zip
        .names()
        .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => sectionNumber(a) - sectionNumber(b)),
    );
  if (sectionPaths.length === 0) throw new DocError("This file is damaged: it has no sections.");
  const headerText = await zip.text(items.get("header") ?? "Contents/header.xml");
  const header = readHeader(headerText ? parseXml(headerText, "header.xml") : undefined);
  /** @type {Map<string, string | null>} */
  const images = new Map();
  for (const [id, href] of items) {
    if (!/^BinData\//i.test(href)) continue;
    const bytes = await zip.read(href).catch(() => undefined);
    images.set(id, bytes ? pictureUrl(bytes) : null);
  }
  /** @type {Ctx} */
  const ctx = {
    header,
    images,
    notes: [],
    pending: [],
    deleted: false,
    outline: "1",
    headers: { header: [], footer: [] },
  };
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  for (const path of sectionPaths) {
    const text = await zip.text(path);
    if (!text) continue;
    const sec = parseXml(text, path).documentElement;
    ctx.page = find(sec, "pagePr");
    ctx.outline = attr(find(sec, "secPr"), "outlineShapeIDRef") ?? "1";
    const body = blocks(sec, ctx);
    sections.push(sectionOf(ctx, body));
  }
  const title = (find(hpf, "title")?.textContent ?? "").trim();
  return documentOf({
    format: "hwpx",
    formatName: "Hangul document (HWPX)",
    title,
    sections,
    notes: ctx.notes,
  });
}

const sectionNumber = (/** @type {string} */ p) => Number(/(\d+)\.xml$/i.exec(p)?.[1] ?? 0);

/** The section's paper: Hangul puts the header area below the top margin, the footer above the bottom. */
function sectionOf(/** @type {Ctx} */ ctx, /** @type {Block[]} */ body) {
  const page = ctx.page;
  const margin = kid(page ?? null, "margin");
  const m = (/** @type {string} */ side, /** @type {number} */ fallback) =>
    unit(num(margin, side)) ?? fallback;
  let width = unit(num(page, "width")) ?? 595.3;
  let height = unit(num(page, "height")) ?? 841.9;
  if (attr(page, "landscape") === "NARROWLY" && width < height) [width, height] = [height, width];
  const top = m("top", 56.7);
  const bottom = m("bottom", 42.5);
  return section({
    width,
    height,
    margins: {
      top: pt(top + m("header", 42.5)),
      right: m("right", 85),
      bottom: pt(bottom + m("footer", 42.5)),
      left: m("left", 85),
      header: top,
      footer: bottom,
    },
    header: ctx.headers.header,
    footer: ctx.headers.footer,
    blocks: body,
  });
}

/** The paragraphs of a section or a sub-list, with tables and shapes' text in reading order. */
function blocks(/** @type {Element} */ parent, /** @type {Ctx} */ ctx) {
  /** @type {Block[]} */
  const out = [];
  for (const p of kids(parent, "p")) {
    out.push(...paragraphBlocks(p, ctx));
    out.push(...ctx.pending.splice(0));
  }
  return out;
}

/** @param {Element} p @param {Ctx} ctx @returns {Block[]} */
function paragraphBlocks(p, ctx) {
  const { header } = ctx;
  const style = header.styles.get(attr(p, "styleIDRef") ?? "");
  const shape = header.paras.get(attr(p, "paraPrIDRef") ?? style?.para ?? "") ?? {};
  /** @type {Partial<import("../model.js").Paragraph>} */
  const props = {};
  if (style?.name && !/^(바탕글|Normal)$/.test(style.name)) props.style = style.name;
  if (shape.align) props.align = shape.align;
  if (shape.indent) props.indent = shape.indent;
  if (shape.spacing) props.spacing = shape.spacing;
  const heading = shape.heading;
  if (heading?.type === "OUTLINE" && heading.level < 6) props.level = heading.level + 1;
  const marker =
    heading?.type === "BULLET"
      ? header.bullets.get(heading.id)
      : heading?.type === "OUTLINE"
        ? header.number(ctx.outline, heading.level + 1)
        : heading?.type === "NUMBER"
          ? header.number(heading.id, heading.level + 1)
          : undefined;
  if (marker) props.marker = marker;
  /** @type {Inline[]} */
  const items = [];
  /** @type {Block[]} */
  const after = [];
  for (const r of kids(p, "run")) {
    const base = header.chars.get(attr(r, "charPrIDRef") ?? "") ?? {};
    for (const el of kids(r)) {
      const name = el.localName;
      if (name === "t") items.push(...textOf(el, base, ctx));
      else if (name === "tbl") after.push(table(el, ctx));
      else if (name === "pic") items.push(picture(el, ctx));
      else if (name === "ctrl") control(el, ctx, items);
      else if (["rect", "ellipse", "polygon", "curve", "container", "arc"].includes(name))
        for (const list of findAll(el, "subList")) ctx.pending.push(...blocks(list, ctx));
      else if (name === "secPr") ctx.page = find(el, "pagePr") ?? ctx.page;
    }
  }
  /** @type {Block[]} */
  const out = [];
  if (attr(p, "pageBreak") === "1" || shape.breakBefore) out.push({ type: "pagebreak" });
  if (items.length || after.length === 0) out.push(paragraph(items, props));
  out.push(...after);
  return out;
}

/** The text of an hp:t: tabs, line breaks, spaces; deletions left out, highlights kept. */
function textOf(
  /** @type {Element} */ t,
  /** @type {import("../ooxml/styles.js").RunProps} */ base,
  /** @type {Ctx} */ ctx,
) {
  /** @type {Inline[]} */
  const out = [];
  let mark = "";
  const push = (/** @type {string} */ value) => {
    if (!value || ctx.deleted) return;
    const item = run(value, mark ? { ...base, highlight: mark } : base);
    if (ctx.link) item.link = ctx.link;
    out.push(item);
  };
  for (let node = t.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) {
      push(node.nodeValue ?? "");
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = /** @type {Element} */ (node);
    const name = el.localName;
    if (name === "tab" && !ctx.deleted) out.push({ type: "tab" });
    else if (name === "lineBreak" && !ctx.deleted) out.push({ type: "linebreak" });
    else if (name === "hyphen") push("-");
    else if (name === "nbSpace") push(" ");
    else if (name === "fwSpace") push("　");
    else if (name === "deleteBegin") ctx.deleted = true;
    else if (name === "deleteEnd") ctx.deleted = false;
    else if (name === "markpenBegin") mark = attr(el, "color") ?? "#FFFF00";
    else if (name === "markpenEnd") mark = "";
  }
  return out;
}

/** Controls inside a run: header and footer, notes, hyperlink fields, page numbers. */
function control(
  /** @type {Element} */ ctrl,
  /** @type {Ctx} */ ctx,
  /** @type {Inline[]} */ items,
) {
  for (const el of kids(ctrl)) {
    const name = el.localName;
    if (name === "header" || name === "footer") {
      if ((attr(el, "applyPageType") ?? "BOTH") !== "EVEN")
        ctx.headers = {
          ...ctx.headers,
          [name]: blocks(kid(el, "subList") ?? el, { ...ctx, pending: [] }),
        };
    } else if (name === "footNote" || name === "endNote") {
      const kind = name === "footNote" ? "footnote" : "endnote";
      const label = String(ctx.notes.filter((n) => n.kind === kind).length + 1);
      const id = `n${ctx.notes.length + 1}`;
      ctx.notes.push({
        id,
        kind,
        label,
        blocks: blocks(kid(el, "subList") ?? el, { ...ctx, pending: [] }),
      });
      items.push({ type: "noteref", note: id, label });
    } else if (name === "fieldBegin" && attr(el, "type") === "HYPERLINK") {
      const command =
        findAll(el, "stringParam").find((s) => attr(s, "name") === "Command")?.textContent ?? "";
      ctx.link = safeLink(command.replace(/\\(.)/g, "$1").split(";")[0]);
    } else if (name === "fieldEnd") ctx.link = undefined;
    else if (name === "autoNum" || name === "pageNum") {
      if ((attr(el, "numType") ?? "PAGE") === "PAGE")
        items.push({ type: "field", field: "page", text: "" });
    }
  }
}

/** @param {Element} el @param {Ctx} ctx @returns {Inline} */
function picture(el, ctx) {
  const id = attr(find(el, "img"), "binaryItemIDRef") ?? "";
  const src = ctx.images.get(id) ?? null;
  const size = kid(el, "sz") ?? kid(el, "curSz");
  const comment = (kid(el, "shapeComment")?.textContent ?? "").split("\n")[0]?.trim();
  return {
    type: "image",
    src,
    width: unit(num(size, "width")),
    height: unit(num(size, "height")),
    alt: comment || (src ? "Picture" : "Picture (not shown)"),
  };
}

/** @param {Element} tbl @param {Ctx} ctx @returns {import("../model.js").Table} */
function table(tbl, ctx) {
  let borders = false;
  const rows = kids(tbl, "tr").map((tr) => ({
    cells: kids(tr, "tc").map((tc) => {
      const span = kid(tc, "cellSpan");
      const fill = ctx.header.fills.get(attr(tc, "borderFillIDRef") ?? "");
      if (fill?.border !== false) borders = true;
      /** @type {import("../model.js").Cell} */
      const cell = {
        blocks: blocks(kid(tc, "subList") ?? tc, { ...ctx, pending: [] }),
        colSpan: num(span, "colSpan") ?? 1,
        rowSpan: num(span, "rowSpan") ?? 1,
      };
      const width = unit(num(kid(tc, "cellSz"), "width"));
      if (width) cell.width = width;
      if (fill?.fill) cell.fill = fill.fill;
      return cell;
    }),
  }));
  return { type: "table", rows, borders };
}
