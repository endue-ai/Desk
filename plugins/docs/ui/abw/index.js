// AbiWord (.abw, plain or gzipped XML): styles with basedon, "key:value" property strings on
// sections, paragraphs and spans, lists, tables placed by their attach values, images from the
// data section, footnotes and endnotes, headers and footers from their own sections.
import { fromBase64, pictureUrl } from "../bytes.js";
import { color, documentOf, length, paragraph, text as run, section } from "../model.js";
import { formatNumber } from "../numbers.js";
import { safeLink } from "../ooxml/inline.js";
import { attr, find, findAll, kids, parseXml } from "../xml.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("../ooxml/styles.js").RunProps} RunProps
 */

/** "font-weight:bold; font-size:12pt" as a map. */
const parseProps = (/** @type {string | null} */ text) => {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const part of (text ?? "").split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return out;
};

/** @param {Map<string, string>} p @returns {RunProps} */
function runOf(p) {
  /** @type {RunProps} */
  const out = {};
  if (p.has("font-weight")) out.bold = p.get("font-weight") === "bold";
  if (p.has("font-style")) out.italic = p.get("font-style") === "italic";
  const decoration = p.get("text-decoration");
  if (decoration) {
    out.underline = decoration.includes("underline");
    out.strike = decoration.includes("line-through");
  }
  const size = length(p.get("font-size"));
  if (size) out.size = size;
  const fg = color(p.get("color"));
  if (fg) out.color = fg;
  const bg = color(p.get("bgcolor"));
  if (bg) out.highlight = bg;
  const font = p.get("font-family");
  if (font) out.font = font;
  const position = p.get("text-position");
  if (position === "superscript") out.script = "super";
  else if (position === "subscript") out.script = "sub";
  if (p.get("display") === "none") out.hidden = true;
  return out;
}

/**
 * AbiWord writes attributes with prefixes it never declares (text:note-citation): a namespace
 * error to an XML parser. Those attributes are dropped and the document read again.
 * @param {string} text
 */
function parseAbw(text) {
  try {
    return parseXml(text, "the AbiWord document");
  } catch {
    const declared = new Set([...text.matchAll(/xmlns:([\w.-]+)=/g)].map((m) => m[1]));
    const fixed = text.replace(/\s([A-Za-z_][\w.-]*):[\w.-]+="[^"]*"/g, (attr, prefix) =>
      prefix === "xmlns" || prefix === "xml" || declared.has(prefix) ? attr : "",
    );
    return parseXml(fixed, "the AbiWord document");
  }
}

/** AbiWord's list styles by name, as its list types number them (5 and up are bullets). */
const LIST_STYLES = /** @type {Record<string, number>} */ ({
  "Numbered List": 0,
  "Lower Case List": 1,
  "Upper Case List": 2,
  "Lower Roman List": 3,
  "Upper Roman List": 4,
  "Bullet List": 5,
  "Dashed List": 6,
  "Square List": 7,
  "Triangle List": 8,
  "Diamond List": 9,
  "Star List": 10,
  "Implies List": 11,
  "Tick List": 12,
  "Box List": 13,
  "Hand List": 14,
  "Heart List": 15,
});
const BULLETS = ["", "", "", "", "", "•", "–", "▪", "▸", "◆", "★", "⇒", "✓", "☐", "☞", "♥"];

const ALIGN = /** @type {Record<string, import("../model.js").Align>} */ ({
  left: "left",
  center: "center",
  right: "right",
  justify: "justify",
});

/** @param {string} text */
export function readAbw(text) {
  const doc = parseAbw(text);
  const root = doc.documentElement;
  /** @type {Map<string, Element>} */
  const styleEls = new Map(
    findAll(find(root, "styles"), "s").map((s) => [attr(s, "name") ?? "", s]),
  );
  /** @type {Map<string, Map<string, string>>} */
  const resolved = new Map();
  const style = (/** @type {string} */ name, depth = 0) => {
    const done = resolved.get(name);
    if (done) return done;
    const el = styleEls.get(name);
    if (!el || depth > 20) return new Map();
    const base = style(attr(el, "basedon") ?? "", depth + 1);
    const merged = new Map([...base, ...parseProps(attr(el, "props"))]);
    resolved.set(name, merged);
    return merged;
  };
  /** @type {Map<string, string | null>} */
  const data = new Map();
  for (const d of findAll(find(root, "data"), "d")) {
    const raw = (d.textContent ?? "").replace(/\s+/g, "");
    let src = null;
    try {
      src = attr(d, "base64") === "no" ? null : pictureUrl(fromBase64(raw));
    } catch {
      src = null;
    }
    data.set(attr(d, "name") ?? "", src);
  }
  /** @type {Map<string, Element>} */
  const lists = new Map(findAll(find(root, "lists"), "l").map((l) => [attr(l, "id") ?? "", l]));
  /** @type {Map<string, number[]>} */
  const counters = new Map();
  /** @type {import("../model.js").Note[]} */
  const notes = [];
  /** @type {import("../model.js").Comment[]} */
  const comments = [];

  const marker = (/** @type {Element} */ p, /** @type {Map<string, string>} */ props) => {
    const id = attr(p, "listid");
    if (!id || id === "0") return undefined;
    const list = lists.get(id);
    const style = props.get("list-style") ?? "";
    const type = list ? Number(attr(list, "type") ?? 0) : (LIST_STYLES[style] ?? -1);
    if (type < 0) return undefined;
    if (type >= 5) return BULLETS[type] ?? "•";
    const _level = Math.max(1, Number(attr(p, "level") ?? 1));
    const counts = counters.get(id) ?? [];
    counters.set(id, counts);
    const start = Number(attr(list, "start-value") ?? props.get("start-value") ?? 1);
    counts[0] = (counts[0] ?? start - 1) + 1;
    const delim = attr(list, "list-delim") ?? props.get("list-delim") ?? "%L.";
    return delim.replace("%L", formatNumber(counts[0], ["1", "a", "A", "i", "I"][type] ?? "1"));
  };

  /** @param {Element} parent @returns {Block[]} */
  const blocks = (parent) => {
    /** @type {Block[]} */
    const out = [];
    for (const el of kids(parent)) {
      const name = el.localName;
      if (name === "p") out.push(...para(el));
      else if (name === "table") out.push(table(el));
      else if (["frame", "textbox", "toc"].includes(name)) out.push(...blocks(el));
    }
    return out;
  };

  /** @param {Element} p @returns {Block[]} */
  const para = (p) => {
    const styleName = attr(p, "style") ?? "Normal";
    const props = new Map([...style(styleName), ...parseProps(attr(p, "props"))]);
    /** @type {Partial<import("../model.js").Paragraph>} */
    const shape = {};
    if (styleName !== "Normal") shape.style = styleName;
    const heading = /heading ([1-6])$/i.exec(styleName);
    if (heading) shape.level = Number(heading[1]);
    const align = ALIGN[props.get("text-align") ?? ""];
    if (align) shape.align = align;
    const left = length(props.get("margin-left"));
    const right = length(props.get("margin-right"));
    const first = length(props.get("text-indent"));
    if (left || right || first) shape.indent = { left, right, first };
    const before = length(props.get("margin-top"));
    const after = length(props.get("margin-bottom"));
    const lineText = props.get("line-height") ?? "";
    const line = /^[\d.]+$/.test(lineText) ? Number(lineText) : undefined;
    if (before || after || line) shape.spacing = { before, after, line };
    if (props.get("dom-dir") === "rtl") shape.rtl = true;
    const mark = marker(p, props);
    if (mark) shape.marker = mark;
    /** @type {Block[]} */
    const out = [];
    let items = /** @type {Inline[]} */ ([]);
    const emit = () => out.push(paragraph(items, { ...shape }));
    const all = inlines(p, runOf(props), undefined);
    // A list label or note anchor field is followed by a tab that only spaced the label.
    const lead = all[0];
    if (
      lead &&
      lead !== "pagebreak" &&
      lead.type === "text" &&
      (mark || p.closest("foot, endnote"))
    )
      lead.text = lead.text.replace(/^\t+/, "");
    if (lead && lead !== "pagebreak" && lead.type === "tab" && (mark || p.closest("foot, endnote")))
      all.shift();
    for (const item of all) {
      if (item === "pagebreak") {
        if (items.length) emit();
        out.push({ type: "pagebreak" });
        items = [];
        delete shape.marker;
      } else items.push(item);
    }
    if (items.length || out.length === 0) emit();
    return out;
  };

  /**
   * @param {Element} parent
   * @param {RunProps} base
   * @param {string | undefined} link
   * @returns {Array<Inline | "pagebreak">}
   */
  const inlines = (parent, base, link) => {
    /** @type {Array<Inline | "pagebreak">} */
    const out = [];
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        const value = node.nodeValue ?? "";
        if (value && !base.hidden) {
          const { hidden: _, ...shown } = base;
          out.push(run(value, link ? { ...shown, link } : shown));
        }
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = /** @type {Element} */ (node);
      const name = el.localName;
      if (name === "c") {
        const props = new Map([
          ...style(attr(el, "style") ?? ""),
          ...parseProps(attr(el, "props")),
        ]);
        out.push(...inlines(el, { ...base, ...runOf(props) }, link));
      } else if (name === "a") out.push(...inlines(el, base, safeLink(attr(el, "href")) ?? link));
      else if (name === "br") out.push({ type: "linebreak" });
      else if (name === "pbr") out.push("pagebreak");
      else if (name === "tab") out.push({ type: "tab" });
      else if (name === "image") {
        const props = parseProps(attr(el, "props"));
        const src = data.get(attr(el, "dataid") ?? "") ?? null;
        out.push({
          type: "image",
          src,
          width: length(props.get("width")),
          height: length(props.get("height")),
          alt: attr(el, "alt") || attr(el, "title") || (src ? "Picture" : "Picture (not shown)"),
        });
      } else if (name === "field") {
        const type = attr(el, "type");
        if (type === "page_number") out.push({ type: "field", field: "page", text: "" });
        else if (type === "page_count") out.push({ type: "field", field: "pages", text: "" });
      } else if (name === "foot" || name === "endnote") {
        const kind = name === "foot" ? "footnote" : "endnote";
        const label = String(notes.filter((n) => n.kind === kind).length + 1);
        const id = `n${notes.length + 1}`;
        notes.push({ id, kind, label, blocks: blocks(el) });
        out.push({ type: "noteref", note: id, label });
      } else if (name === "annotate" && parent.localName === "ann") {
        // The comment of the <ann> around it, read there.
      } else if (name === "ann" || name === "annotate") {
        // <ann> wraps the commented text; its <annotate> child holds the comment itself.
        const note = name === "annotate" ? el : findAll(el, "annotate")[0];
        const props = parseProps(attr(note ?? null, "props"));
        const id = `a${comments.length + 1}`;
        comments.push({
          id,
          author: props.get("annotation-author") ?? "",
          date: props.get("annotation-date") ?? "",
          blocks: note ? blocks(note) : [],
        });
        if (name === "annotate") out.push({ type: "anchor", comments: [id] });
        else
          for (const item of inlines(el, base, link)) {
            if (item !== "pagebreak" && item.type === "text")
              item.comments = [...(item.comments ?? []), id];
            out.push(item);
          }
      } else if (
        !["cbr", "bookmark", "textbox", "frame", "math", "embed", "annotate"].includes(name)
      )
        out.push(...inlines(el, base, link));
    }
    return out;
  };

  /** @param {Element} el @returns {import("../model.js").Table} */
  const table = (el) => {
    /** @type {Map<number, import("../model.js").Cell[]>} */
    const rows = new Map();
    let borders = false;
    for (const cell of kids(el, "cell")) {
      const p = parseProps(attr(cell, "props"));
      const left = Number(p.get("left-attach") ?? 0);
      const top = Number(p.get("top-attach") ?? 0);
      const cells = rows.get(top) ?? [];
      rows.set(top, cells);
      /** @type {import("../model.js").Cell & { at: number }} */
      const out = {
        at: left,
        blocks: blocks(cell),
        colSpan: Math.max(1, Number(p.get("right-attach") ?? left + 1) - left),
        rowSpan: Math.max(1, Number(p.get("bot-attach") ?? top + 1) - top),
      };
      const fill = color(p.get("background-color"));
      if (fill) out.fill = fill;
      if (p.get("top-style") !== "0" || p.get("left-style") !== "0") borders = true;
      cells.push(out);
    }
    const ordered = [...rows.entries()].sort(([a], [b]) => a - b);
    const columns = (parseProps(attr(el, "props")).get("table-column-props") ?? "")
      .split("/")
      .map((w) => length(w) ?? 0)
      .filter((w) => w > 0);
    /** @type {import("../model.js").Table} */
    const out = {
      type: "table",
      borders,
      rows: ordered.map(([, cells]) => ({
        cells: cells
          .sort(
            (a, b) => /** @type {{ at: number }} */ (a).at - /** @type {{ at: number }} */ (b).at,
          )
          .map(({ at: _, ...cell }) => /** @type {import("../model.js").Cell} */ (cell)),
      })),
    };
    if (columns.length) out.columns = columns;
    return out;
  };

  const sectionEls = kids(root, "section");
  /** @type {Map<string, Element>} */
  const parts = new Map(
    sectionEls.filter((s) => attr(s, "type")).map((s) => [attr(s, "id") ?? "", s]),
  );
  const pageSize = find(root, "pagesize");
  const units = attr(pageSize, "units") ?? "in";
  const dim = (/** @type {string} */ key, /** @type {number} */ fallback) =>
    length(`${attr(pageSize, key) ?? ""}${units === "inch" ? "in" : units}`) ?? fallback;
  const sections = sectionEls
    .filter((s) => !attr(s, "type"))
    .map((s) => {
      const p = parseProps(attr(s, "props"));
      const margin = (/** @type {string} */ side) => length(p.get(`page-margin-${side}`)) ?? 72;
      const part = (/** @type {string} */ which) => {
        const el = parts.get(attr(s, which) ?? "");
        return el ? blocks(el) : [];
      };
      return section({
        width: dim("width", 612),
        height: dim("height", 792),
        margins: {
          top: margin("top"),
          right: margin("right"),
          bottom: margin("bottom"),
          left: margin("left"),
          header: length(p.get("page-margin-header")) ?? 36,
          footer: length(p.get("page-margin-footer")) ?? 36,
        },
        header: part("header"),
        footer: part("footer"),
        blocks: blocks(s),
      });
    });
  const title =
    findAll(find(root, "metadata"), "m").find((m) => attr(m, "key") === "dc.title")?.textContent ??
    "";
  return documentOf({
    format: "abw",
    formatName: "AbiWord document",
    title,
    sections,
    notes,
    comments,
  });
}
