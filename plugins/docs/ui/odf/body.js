// ODF text content: headings and paragraphs with their styles, lists with their list style's
// markers, tables with spans, frames as images, notes, annotations as comments anchored to a range,
// fields, and the page changes a paragraph's master page asks for.
import { fromBase64, pictureUrl } from "../bytes.js";
import { length, paragraph, text as run } from "../model.js";
import { bullet, formatNumber } from "../numbers.js";
import { safeLink } from "../ooxml/inline.js";
import { attr, kid, kids } from "../xml.js";
import { merge } from "./styles.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("../ooxml/styles.js").RunProps} RunProps
 * @typedef {{
 *   styles: import("./styles.js").OdfStyles,
 *   images: Map<string, string | null>,
 *   notes: import("../model.js").Note[],
 *   comments: import("../model.js").Comment[],
 *   open: Map<string, string>,
 *   counters: Map<string, number[]>,
 *   pending: Block[],
 *   onMaster?: (name: string, before: Block[]) => Block[],
 * }} OdfCtx
 */

const SKIP = new Set([
  "tracked-changes",
  "sequence-decls",
  "variable-decls",
  "user-field-decls",
  "dde-connection-decls",
  "forms",
  "soft-page-break",
  "table-of-content-source",
  "alphabetical-index-source",
  "illustration-index-source",
  "object-index-source",
  "user-index-source",
  "bibliography-source",
  "table-index-source",
  "bookmark",
  "bookmark-start",
  "bookmark-end",
  "reference-mark",
  "reference-mark-start",
  "reference-mark-end",
  "change",
  "change-start",
  "change-end",
  "toc-mark",
  "toc-mark-start",
  "toc-mark-end",
  "alphabetical-index-mark",
  "alphabetical-index-mark-start",
  "alphabetical-index-mark-end",
  "user-index-mark",
  "user-index-mark-start",
  "user-index-mark-end",
  "note-citation",
  "creator",
  "date-string",
  "event-listeners",
]);

/**
 * The blocks of a container: office:text, a cell, a note body, a header, an annotation.
 * @param {Element} container
 * @param {OdfCtx} ctx
 * @returns {Block[]}
 */
export function blocks(container, ctx) {
  /** @type {Block[]} */
  let out = [];
  const visit = (/** @type {Element} */ parent) => {
    for (const el of kids(parent)) {
      const name = el.localName;
      if (SKIP.has(name)) continue;
      if (name === "p" || name === "h") {
        const style = ctx.styles.get("paragraph", attr(el, "style-name"));
        if (style.para.master && ctx.onMaster) out = ctx.onMaster(style.para.master, out);
        out.push(...paragraphBlocks(el, ctx, name === "h"));
      } else if (["list", "ordered-list", "unordered-list"].includes(name))
        out.push(...list(el, ctx, 1, ""));
      else if (name === "table") out.push(table(el, ctx));
      else if (name === "frame" || name === "image")
        out.push(...frame(el, ctx).map((i) => paragraph([i])));
      else if (name !== "annotation" && name !== "annotation-end") visit(el);
      out.push(...ctx.pending.splice(0));
    }
  };
  visit(container);
  return out;
}

/**
 * A text:p or text:h, with page breaks before and after as its style says.
 * @param {Element} el
 * @param {OdfCtx} ctx
 * @param {boolean} heading
 * @param {{ marker?: string, indent?: import("../model.js").Indent }} [list]
 * @returns {Block[]}
 */
function paragraphBlocks(el, ctx, heading, list = {}) {
  const style = ctx.styles.get("paragraph", attr(el, "style-name"));
  const { para } = style;
  const items = trim(inlines(el, style.run, ctx, {}));
  /** @type {Partial<import("../model.js").Paragraph>} */
  const shape = {};
  if (style.display && !/^(Standard|Default|Text body|Body Text)$/i.test(style.display))
    shape.style = style.display;
  const level = heading
    ? Number(attr(el, "outline-level") ?? attr(el, "level") ?? para.outline ?? 1)
    : undefined;
  if (level && level >= 1 && level <= 6) shape.level = level;
  if (para.align) shape.align = para.align;
  const indent = { ...para.indent, ...list.indent };
  if (Object.keys(indent).length) shape.indent = indent;
  if (para.spacing && Object.keys(para.spacing).length) shape.spacing = para.spacing;
  if (para.rtl) shape.rtl = true;
  const marker = list.marker ?? (heading && level ? outlineMarker(level, ctx) : undefined);
  if (marker) shape.marker = marker;
  /** @type {Block[]} */
  const out = [];
  if (para.breakBefore) out.push({ type: "pagebreak" });
  out.push(paragraph(items, shape));
  if (para.breakAfter) out.push({ type: "pagebreak" });
  return out;
}

/** Heading numbers from the outline style ("1.", "1.2"), when it numbers headings at all. */
function outlineMarker(/** @type {number} */ level, /** @type {OdfCtx} */ ctx) {
  const levels = ctx.styles.listLevels("#outline");
  const lvl = levels.get(level);
  if (!lvl?.format || lvl.format === "bullet") return undefined;
  return count("#outline", level, levels, ctx);
}

/** Count one more item at `level` of the list `key`, and the marker it gets. */
function count(
  /** @type {string} */ key,
  /** @type {number} */ level,
  /** @type {Map<number, import("./styles.js").ListLevel>} */ levels,
  /** @type {OdfCtx} */ ctx,
  /** @type {number | undefined} */ start = undefined,
) {
  const counts = ctx.counters.get(key) ?? [];
  ctx.counters.set(key, counts);
  const lvl = levels.get(level);
  if (!lvl) return undefined;
  if (lvl.format === "bullet") return bullet(lvl.bullet ?? "•");
  if (!lvl.format) return undefined;
  counts[level - 1] = start ?? (counts[level - 1] ?? lvl.start - 1) + 1;
  counts.length = level;
  const shown = [];
  for (let i = Math.max(1, level - lvl.display + 1); i <= level; i++)
    shown.push(
      formatNumber(counts[i - 1] ?? levels.get(i)?.start ?? 1, levels.get(i)?.format ?? "1"),
    );
  return `${lvl.prefix}${shown.join(".")}${lvl.suffix}`;
}

/**
 * A list and the lists nested in it; each item's first paragraph gets the marker.
 * @param {Element} el
 * @param {OdfCtx} ctx
 * @param {number} depth
 * @param {string} inherited the enclosing list's style
 * @returns {Block[]}
 */
function list(el, ctx, depth, inherited) {
  const name = attr(el, "style-name") || inherited;
  const key = `list:${name}`;
  if (depth === 1 && attr(el, "continue-numbering") !== "true" && !attr(el, "continue-list"))
    ctx.counters.delete(key);
  const levels = ctx.styles.listLevels(name || undefined);
  /** @type {Block[]} */
  const out = [];
  for (const item of kids(el)) {
    if (item.localName !== "list-item" && item.localName !== "list-header") continue;
    let first = item.localName === "list-item";
    const startValue = attr(item, "start-value");
    for (const child of kids(item)) {
      const childName = child.localName;
      if (childName === "p" || childName === "h") {
        const own = levels.size
          ? levels
          : ctx.styles.listLevels(ctx.styles.get("paragraph", attr(child, "style-name")).para.list);
        const marker = first
          ? count(key, depth, own, ctx, startValue ? Number(startValue) : undefined)
          : undefined;
        const indent = own.get(depth)?.indent;
        out.push(
          ...paragraphBlocks(child, ctx, childName === "h", {
            marker,
            indent: indent ? clean(indent) : undefined,
          }),
        );
        first = false;
      } else if (["list", "ordered-list", "unordered-list"].includes(childName))
        out.push(...list(child, ctx, depth + 1, name));
      else out.push(...blocks(child, ctx));
    }
  }
  return out;
}

const clean = (/** @type {import("../model.js").Indent} */ i) =>
  Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));

/**
 * A table: rows from header rows, row groups and plain rows; covered cells left out.
 * @param {Element} el
 * @param {OdfCtx} ctx
 * @returns {import("../model.js").Table}
 */
function table(el, ctx) {
  /** @type {import("../model.js").Row[]} */
  const rows = [];
  /** @type {number[]} */
  const columns = [];
  let borders = false;
  const visit = (/** @type {Element} */ parent, /** @type {boolean} */ header) => {
    for (const child of kids(parent)) {
      const name = child.localName;
      if (name === "table-column") {
        const width = ctx.styles.get("table-column", attr(child, "style-name")).column ?? 0;
        const repeat = Math.min(64, Number(attr(child, "number-columns-repeated") ?? 1));
        for (let i = 0; i < repeat; i++) columns.push(width);
      } else if (
        name === "table-columns" ||
        name === "table-column-group" ||
        name === "table-header-columns"
      )
        visit(child, header);
      else if (name === "table-header-rows") visit(child, true);
      else if (name === "table-rows" || name === "table-row-group") visit(child, header);
      else if (name === "table-row") {
        /** @type {import("../model.js").Row} */
        const row = { cells: [] };
        if (header) row.header = true;
        for (const cell of kids(child, "table-cell")) {
          const style = ctx.styles.get("table-cell", attr(cell, "style-name"));
          if (style.border) borders = true;
          const content = blocks(cell, ctx);
          const repeat = content.length
            ? 1
            : Math.min(16, Number(attr(cell, "number-columns-repeated") ?? 1));
          for (let i = 0; i < repeat; i++) {
            /** @type {import("../model.js").Cell} */
            const out = {
              blocks: content,
              colSpan: Number(attr(cell, "number-columns-spanned") ?? 1),
              rowSpan: Number(attr(cell, "number-rows-spanned") ?? 1),
            };
            if (style.fill) out.fill = style.fill;
            row.cells.push(out);
          }
        }
        const repeat = Math.min(4, Number(attr(child, "number-rows-repeated") ?? 1));
        for (let i = 0; i < repeat; i++) rows.push(i === 0 ? row : { ...row });
      }
    }
  };
  visit(el, false);
  /** @type {import("../model.js").Table} */
  const out = { type: "table", rows, borders };
  if (columns.some((c) => c > 0)) out.columns = columns;
  return out;
}

/**
 * The inlines of a paragraph or span.
 * @param {Element} parent
 * @param {RunProps} base
 * @param {OdfCtx} ctx
 * @param {{ link?: string }} scope
 * @returns {Inline[]}
 */
function inlines(parent, base, ctx, scope) {
  /** @type {Inline[]} */
  const out = [];
  const push = (/** @type {string} */ value, /** @type {RunProps} */ props) => {
    if (!value || props.hidden) return;
    const { hidden: _, ...shown } = props;
    const item = run(value, shown);
    if (scope.link) item.link = scope.link;
    if (ctx.open.size) item.comments = [...ctx.open.values()];
    out.push(item);
  };
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) {
      push((node.nodeValue ?? "").replace(/[ \t\r\n]+/g, " "), base);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = /** @type {Element} */ (node);
    const name = el.localName;
    if (SKIP.has(name)) continue;
    if (name === "span")
      out.push(
        ...inlines(el, merge(base, ctx.styles.get("text", attr(el, "style-name")).run), ctx, scope),
      );
    else if (name === "a")
      out.push(...inlines(el, base, ctx, { link: safeLink(attr(el, "href")) ?? scope.link }));
    else if (name === "s") push(" ".repeat(Math.min(200, Number(attr(el, "c") ?? 1))), base);
    else if (name === "tab" || name === "tab-stop") out.push({ type: "tab" });
    else if (name === "line-break") out.push({ type: "linebreak" });
    else if (name === "page-number")
      out.push({ type: "field", field: "page", text: el.textContent ?? "" });
    else if (name === "page-count")
      out.push({ type: "field", field: "pages", text: el.textContent ?? "" });
    else if (name === "note" || name === "footnote" || name === "endnote") out.push(note(el, ctx));
    else if (name === "annotation") {
      const point = annotation(el, ctx);
      if (point) out.push(point);
    } else if (name === "annotation-end") ctx.open.delete(attr(el, "name") ?? "");
    else if (name === "frame" || name === "image") out.push(...frame(el, ctx));
    else if (name === "ruby") push(kid(el, "ruby-base")?.textContent ?? "", base);
    else out.push(...inlines(el, base, ctx, scope));
  }
  return out;
}

/** Leading and trailing white space of a paragraph is not shown (text:s carries real spaces). */
function trim(/** @type {Inline[]} */ items) {
  const first = items[0];
  if (first?.type === "text") first.text = first.text.replace(/^ +/, "");
  const last = items.at(-1);
  if (last?.type === "text") last.text = last.text.replace(/ +$/, "");
  return items.filter((i) => i.type !== "text" || i.text !== "");
}

/** @param {Element} el @param {OdfCtx} ctx @returns {Inline} */
function note(el, ctx) {
  const footnote =
    (attr(el, "note-class") ?? (el.localName === "endnote" ? "endnote" : "footnote")) !== "endnote";
  const kind = footnote ? "footnote" : "endnote";
  const label =
    (kid(el, "note-citation")?.textContent ?? "").trim() ||
    String(ctx.notes.filter((n) => n.kind === kind).length + 1);
  const id = `n${ctx.notes.length + 1}`;
  const body = kid(el, "note-body") ?? kid(el, "footnote-body") ?? kid(el, "endnote-body") ?? el;
  ctx.notes.push({ id, kind, label, blocks: blocks(body, ctx) });
  return { type: "noteref", note: id, label };
}

/** An annotation: a comment, its range open until its annotation-end, or a point. */
function annotation(/** @type {Element} */ el, /** @type {OdfCtx} */ ctx) {
  const id = `a${ctx.comments.length + 1}`;
  ctx.comments.push({
    id,
    author: kid(el, "creator")?.textContent ?? "",
    date: kid(el, "date")?.textContent ?? "",
    blocks: blocks(el, { ...ctx, open: new Map() }),
  });
  const name = attr(el, "name");
  if (name) {
    ctx.open.set(name, id);
    return undefined;
  }
  return /** @type {Inline} */ ({ type: "anchor", comments: [id] });
}

/**
 * A frame's picture (the first one the page view can show) or text box.
 * @param {Element} el
 * @param {OdfCtx} ctx
 * @returns {Inline[]}
 */
function frame(el, ctx) {
  const width = length(attr(el, "width"));
  const height = length(attr(el, "height"));
  const alt =
    kid(el, "desc")?.textContent || kid(el, "title")?.textContent || attr(el, "name") || "Picture";
  const images = el.localName === "image" ? [el] : kids(el, "image");
  for (const image of images) {
    const binary = kid(image, "binary-data");
    const href = (attr(image, "href") ?? "").replace(/^#/, "").replace(/^\.\//, "");
    const src = binary
      ? pictureUrl(fromBase64((binary.textContent ?? "").replace(/\s+/g, "")))
      : (ctx.images.get(href) ?? null);
    if (src) return [{ type: "image", src, width, height, alt }];
  }
  const box = kid(el, "text-box");
  if (box) ctx.pending.push(...blocks(box, ctx));
  else if (images.length || kid(el, "object"))
    return [{ type: "image", src: null, width, height, alt: `${alt} (not shown)` }];
  return [];
}
