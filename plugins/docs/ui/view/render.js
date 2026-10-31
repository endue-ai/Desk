// The one renderer: blocks and inlines of the document model as DOM elements. File text only ever
// reaches the page as text nodes; links are http(s) or mailto anchors that never navigate the frame.

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {{ doc: Document, page: number, pages: number, headings: Map<import("../model.js").Paragraph, string>, notes: Set<string> }} RenderCtx
 */

/** The desk's fonts, after a document's own: a font the system lacks falls back to these. */
export const FALLBACK =
  '-apple-system, "SUIT", "Inter", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

/** Only http(s) and mailto become anchors; anything else stays text. */
const safeLink = (/** @type {string | undefined} */ url) =>
  url && /^(https?:|mailto:)/i.test(url) ? url : undefined;

const quote = (/** @type {string} */ name) => `"${name.replace(/["\\]/g, "")}"`;
export const fontFamily = (/** @type {string} */ fonts) =>
  `${fonts
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map(quote)
    .join(", ")}, ${FALLBACK}`;

/** @param {Block[]} blocks @param {RenderCtx} ctx @param {Element} into */
export function renderBlocks(blocks, ctx, into) {
  for (const block of blocks) {
    const el = renderBlock(block, ctx);
    if (el) into.append(el);
  }
}

/** @param {Block} block @param {RenderCtx} ctx @returns {HTMLElement | null} */
export function renderBlock(block, ctx) {
  if (block.type === "paragraph") return renderParagraph(block, ctx);
  if (block.type === "table") return renderTable(block, ctx);
  if (block.type === "image") {
    const p = ctx.doc.createElement("p");
    p.className = "para";
    p.append(renderImage(block, ctx));
    return p;
  }
  return null;
}

/** @param {import("../model.js").Paragraph} block @param {RenderCtx} ctx */
function renderParagraph(block, ctx) {
  const { doc } = ctx;
  const p = doc.createElement("p");
  p.className = "para";
  const s = p.style;
  if (block.align) s.textAlign = block.align;
  const indent = block.indent ?? {};
  if (indent.left) s.marginLeft = `${indent.left}pt`;
  if (indent.right) s.marginRight = `${indent.right}pt`;
  if (indent.first) s.textIndent = `${indent.first}pt`;
  const spacing = block.spacing ?? {};
  if (spacing.before) s.marginTop = `${spacing.before}pt`;
  if (spacing.after) s.marginBottom = `${spacing.after}pt`;
  if (spacing.line)
    s.lineHeight = spacing.exact
      ? `${spacing.line}pt`
      : String(Math.round(spacing.line * 1.17 * 100) / 100);
  if (block.rtl) p.dir = "rtl";
  const id = ctx.headings.get(block);
  if (id) {
    p.id = id;
    p.setAttribute("role", "heading");
    p.setAttribute("aria-level", String(block.level ?? 1));
  }
  if (block.marker) {
    const marker = doc.createElement("span");
    marker.className = "marker";
    marker.textContent = block.marker;
    if ((indent.first ?? 0) < 0) marker.style.minWidth = `${-(indent.first ?? 0)}pt`;
    else marker.textContent += "\u00a0";
    const first = block.inlines.find((i) => i.type === "text");
    if (first?.type === "text")
      applyRun(marker, { ...first, underline: false, strike: false, highlight: undefined });
    p.append(marker);
  }
  for (const inline of block.inlines) {
    const el = renderInline(inline, ctx);
    if (el) p.append(el);
  }
  if (!p.textContent && !p.querySelector("img, .image-missing")) p.append(doc.createElement("br"));
  return p;
}

/** @param {HTMLElement} el @param {import("../model.js").TextRun} run */
function applyRun(el, run) {
  const s = el.style;
  if (run.bold) s.fontWeight = "700";
  if (run.italic) s.fontStyle = "italic";
  const lines = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(
    Boolean,
  );
  if (lines.length) s.textDecoration = lines.join(" ");
  if (run.size) s.fontSize = `${run.script ? run.size * 0.65 : run.size}pt`;
  else if (run.script) s.fontSize = "0.65em";
  if (run.script) s.verticalAlign = run.script === "super" ? "super" : "sub";
  if (run.color) s.color = run.color;
  if (run.highlight) s.backgroundColor = run.highlight;
  if (run.font) s.fontFamily = fontFamily(run.font);
  if (run.caps) s.textTransform = "uppercase";
}

/** @param {Inline} inline @param {RenderCtx} ctx @returns {Node | null} */
function renderInline(inline, ctx) {
  const { doc } = ctx;
  switch (inline.type) {
    case "text": {
      const link = safeLink(inline.link);
      const el = doc.createElement(link ? "a" : "span");
      if (link) {
        el.setAttribute("href", link);
        el.setAttribute("title", link);
        el.className = "link";
      }
      applyRun(el, inline);
      el.textContent = inline.text;
      if (inline.comments?.length) {
        el.dataset.comments = inline.comments.join(" ");
        el.classList.add("commented");
      }
      return el;
    }
    case "tab":
      return doc.createTextNode("\t");
    case "linebreak":
      return doc.createElement("br");
    case "image":
      return renderImage(inline, ctx);
    case "noteref": {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "noteref";
      button.dataset.note = inline.note;
      button.textContent = inline.label;
      button.setAttribute("aria-label", `Note ${inline.label}`);
      ctx.notes.add(inline.note);
      return button;
    }
    case "field":
      return doc.createTextNode(inline.field === "page" ? String(ctx.page) : String(ctx.pages));
    case "anchor": {
      const mark = doc.createElement("span");
      mark.className = "comment-point";
      mark.dataset.comments = inline.comments.join(" ");
      mark.setAttribute("aria-hidden", "true");
      return mark;
    }
  }
  return null;
}

/** @param {import("../model.js").Image} image @param {RenderCtx} ctx */
function renderImage(image, ctx) {
  const { doc } = ctx;
  if (image.src?.startsWith("data:image/")) {
    const img = doc.createElement("img");
    img.src = image.src;
    img.alt = image.alt;
    img.decoding = "async";
    img.loading = "lazy";
    if (image.width) img.style.width = `${image.width}pt`;
    if (image.height) img.style.height = `${image.height}pt`;
    return img;
  }
  const box = doc.createElement("span");
  box.className = "image-missing";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", image.alt);
  box.textContent = image.alt;
  if (image.width) box.style.width = `${Math.min(image.width, 400)}pt`;
  if (image.height) box.style.minHeight = `${Math.min(image.height, 300)}pt`;
  return box;
}

/** @param {import("../model.js").Table} table @param {RenderCtx} ctx */
function renderTable(table, ctx) {
  const { doc } = ctx;
  const wrap = doc.createElement("div");
  wrap.className = "table-wrap";
  const el = doc.createElement("table");
  el.className = table.borders ? "table bordered" : "table";
  if (table.columns?.length) {
    const group = doc.createElement("colgroup");
    for (const width of table.columns) {
      const col = doc.createElement("col");
      if (width) col.style.width = `${width}pt`;
      group.append(col);
    }
    el.append(group);
  }
  const body = doc.createElement("tbody");
  for (const row of table.rows) {
    const tr = doc.createElement("tr");
    for (const cell of row.cells) {
      const td = doc.createElement("td");
      if (cell.colSpan > 1) td.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      if (cell.width && !table.columns?.length) td.style.width = `${cell.width}pt`;
      if (cell.fill) td.style.backgroundColor = cell.fill;
      renderBlocks(cell.blocks, ctx, td);
      tr.append(td);
    }
    body.append(tr);
  }
  el.append(body);
  wrap.append(el);
  return wrap;
}
