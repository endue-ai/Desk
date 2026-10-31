// ODF styles: default, named and automatic styles of each family resolved through their parents,
// font face declarations, list styles, page layouts and master pages. OpenOffice.org 1.0 keeps
// every property on one style:properties element; ODF splits them, and both are read.
import { color, length } from "../model.js";
import { attr, findAll, kid, kids } from "../xml.js";

/**
 * @typedef {import("../ooxml/styles.js").RunProps} RunProps
 * @typedef {import("../ooxml/styles.js").ParaProps & { breakBefore?: boolean, breakAfter?: boolean, outline?: number, list?: string, master?: string }} ParaProps
 * @typedef {{ name: string, display: string, para: ParaProps, run: RunProps & { relative?: number }, fill?: string, border?: boolean, column?: number }} OdfStyle
 * @typedef {{ format: string, prefix: string, suffix: string, display: number, start: number, bullet?: string, indent?: import("../model.js").Indent }} ListLevel
 */

const ALIGN = /** @type {Record<string, import("../model.js").Align>} */ ({
  start: "left",
  left: "left",
  center: "center",
  end: "right",
  right: "right",
  justify: "justify",
});

/** The properties element of a style: ODF's per-kind one, or OpenOffice 1.0's single one. */
const props = (/** @type {Element | null} */ style, /** @type {string} */ kind) =>
  kid(style, `${kind}-properties`) ?? kid(style, "properties");

/**
 * @param {Element | null} el
 * @param {Map<string, string>} fonts
 * @returns {RunProps & { relative?: number }}
 */
function textProps(el, fonts) {
  /** @type {RunProps & { relative?: number }} */
  const out = {};
  if (!el) return out;
  const weight = attr(el, "font-weight");
  if (weight) out.bold = weight === "bold" || Number(weight) >= 600;
  const style = attr(el, "font-style");
  if (style) out.italic = style === "italic" || style === "oblique";
  const underline = attr(el, "text-underline-style") ?? attr(el, "text-underline");
  if (underline) out.underline = underline !== "none";
  const strike = attr(el, "text-line-through-style") ?? attr(el, "text-crossing-out");
  if (strike) out.strike = strike !== "none";
  const size = attr(el, "font-size");
  if (size?.endsWith("%")) out.relative = Number.parseFloat(size) / 100;
  else if (size) {
    const value = length(size);
    if (value) out.size = value;
  }
  const colour = color(attr(el, "color"));
  if (colour) out.color = colour;
  const background = color(attr(el, "background-color"));
  if (background) out.highlight = background;
  const position = attr(el, "text-position") ?? "";
  if (/^super|^[1-9]/.test(position)) out.script = "super";
  else if (/^sub|^-/.test(position)) out.script = "sub";
  if (attr(el, "font-variant") === "small-caps" || attr(el, "text-transform") === "uppercase")
    out.caps = true;
  if (attr(el, "display") === "none") out.hidden = true;
  const names = [
    attr(el, "font-name") ?? attr(el, "font-family"),
    attr(el, "font-name-asian") ?? attr(el, "font-family-asian"),
  ]
    .filter((n) => typeof n === "string" && n !== "")
    .map((n) => (fonts.get(n) ?? n).replace(/^['"]|['"]$/g, ""));
  if (names.length > 0) out.font = [...new Set(names)].join(", ");
  return out;
}

/** @param {Element | null} el @returns {ParaProps} */
function paraProps(el) {
  /** @type {ParaProps} */
  const out = {};
  if (!el) return out;
  const align = ALIGN[attr(el, "text-align") ?? ""];
  if (align) out.align = align;
  /** @type {import("../model.js").Indent} */
  const indent = {};
  const left = length(attr(el, "margin-left"));
  const right = length(attr(el, "margin-right"));
  const first = length(attr(el, "text-indent"));
  if (left !== undefined) indent.left = left;
  if (right !== undefined) indent.right = right;
  if (first !== undefined) indent.first = first;
  if (Object.keys(indent).length) out.indent = indent;
  /** @type {import("../model.js").Spacing} */
  const spacing = {};
  const before = length(attr(el, "margin-top"));
  const after = length(attr(el, "margin-bottom"));
  if (before !== undefined) spacing.before = before;
  if (after !== undefined) spacing.after = after;
  const line = attr(el, "line-height") ?? "";
  if (line.endsWith("%")) spacing.line = Number.parseFloat(line) / 100;
  else if (length(line)) Object.assign(spacing, { line: length(line), exact: true });
  if (Object.keys(spacing).length) out.spacing = spacing;
  if (attr(el, "break-before") === "page") out.breakBefore = true;
  if (attr(el, "break-after") === "page") out.breakAfter = true;
  if (attr(el, "writing-mode")?.startsWith("rl")) out.rtl = true;
  return out;
}

/**
 * @param {Document[]} docs content.xml and styles.xml (or one flat document)
 */
export function createOdfStyles(docs) {
  /** @type {Map<string, string>} */
  const fonts = new Map();
  for (const doc of docs)
    for (const face of findAll(doc, "font-face").concat(findAll(doc, "font-decl")))
      fonts.set(attr(face, "name") ?? "", attr(face, "font-family") ?? attr(face, "name") ?? "");
  /** @type {Map<string, Element>} */
  const raw = new Map();
  /** @type {Map<string, Element>} */
  const defaults = new Map();
  /** @type {Map<string, Element>} */
  const lists = new Map();
  /** @type {Map<string, Element>} */
  const layouts = new Map();
  /** @type {Map<string, Element>} */
  const masters = new Map();
  for (const doc of docs) {
    for (const el of findAll(doc, "style"))
      raw.set(`${attr(el, "family")}:${attr(el, "name")}`, el);
    for (const el of findAll(doc, "default-style")) defaults.set(attr(el, "family") ?? "", el);
    for (const el of findAll(doc, "list-style")) lists.set(attr(el, "name") ?? "", el);
    for (const el of [...findAll(doc, "page-layout"), ...findAll(doc, "page-master")])
      layouts.set(attr(el, "name") ?? "", el);
    for (const el of findAll(doc, "master-page")) masters.set(attr(el, "name") ?? "", el);
  }
  const outlineStyle = docs.map((d) => findAll(d, "outline-style")[0]).find(Boolean);

  /** @type {Map<string, OdfStyle>} */
  const resolved = new Map();
  /** @returns {OdfStyle} */
  const get = (/** @type {string} */ family, /** @type {string | null} */ name, depth = 0) => {
    const key = `${family}:${name ?? ""}`;
    const done = resolved.get(key);
    if (done) return done;
    const el = name ? raw.get(key) : undefined;
    const parent =
      el && depth < 20
        ? get(family, attr(el, "parent-style-name"), depth + 1)
        : base(defaults.get(family) ?? null);
    if (!el) return parent;
    const own = paraProps(props(el, "paragraph"));
    const run = textProps(props(el, "text"), fonts);
    const cell = props(el, "table-cell");
    /** @type {OdfStyle} */
    const style = {
      name: name ?? "",
      display: attr(el, "display-name") ?? name ?? "",
      para: {
        ...parent.para,
        ...own,
        indent: { ...parent.para.indent, ...own.indent },
        spacing: { ...parent.para.spacing, ...own.spacing },
      },
      run: merge(parent.run, run),
    };
    const outline = attr(el, "default-outline-level");
    if (outline) style.para.outline = Number(outline);
    else if (parent.para.outline) style.para.outline = parent.para.outline;
    const list = attr(el, "list-style-name");
    if (list) style.para.list = list;
    const master = attr(el, "master-page-name");
    style.para.master = master || undefined;
    const column = length(attr(props(el, "table-column"), "column-width"));
    if (column) style.column = column;
    const fill = color(attr(cell, "background-color"));
    if (fill) style.fill = fill;
    const border = attr(cell, "border") ?? attr(cell, "border-top") ?? attr(cell, "border-left");
    if (border) style.border = border !== "none";
    resolved.set(key, style);
    return style;
  };
  const base = (/** @type {Element | null} */ el) => ({
    name: "",
    display: "",
    para: paraProps(props(el, "paragraph")),
    run: textProps(props(el, "text"), fonts),
  });

  /**
   * The levels of a list style (or the outline style for headings), 1-based.
   * @param {string | undefined} name
   * @returns {Map<number, ListLevel>}
   */
  const listLevels = (name) => {
    const el = name === "#outline" ? outlineStyle : name ? lists.get(name) : undefined;
    /** @type {Map<number, ListLevel>} */
    const out = new Map();
    for (const level of kids(el)) {
      const n = Number(attr(level, "level") ?? 1);
      const lp = props(level, "list-level");
      const align = kid(lp, "list-level-label-alignment");
      let left;
      let first;
      if (align) {
        left = length(attr(align, "margin-left"));
        first = length(attr(align, "text-indent"));
      } else {
        const before = length(attr(lp, "space-before")) ?? 0;
        const width = length(attr(lp, "min-label-width")) ?? 0;
        if (before || width) {
          left = before + width;
          first = -width;
        }
      }
      /** @type {ListLevel} */
      const item = {
        format: level.localName.endsWith("bullet") ? "bullet" : (attr(level, "num-format") ?? ""),
        prefix: attr(level, "num-prefix") ?? "",
        suffix: attr(level, "num-suffix") ?? "",
        display: Number(attr(level, "display-levels") ?? 1),
        start: Number(attr(level, "start-value") ?? 1),
      };
      if (item.format === "bullet") item.bullet = attr(level, "bullet-char") ?? "•";
      if (left !== undefined || first !== undefined) item.indent = { left, first };
      out.set(n, item);
    }
    return out;
  };

  /** A master page: its paper, margins, and header and footer elements. */
  const page = (/** @type {string | undefined} */ name) => {
    const master =
      masters.get(name ?? "") ??
      masters.get("Standard") ??
      masters.get("Default") ??
      [...masters.values()][0];
    const layout = layouts.get(
      attr(master, "page-layout-name") ?? attr(master, "page-master-name") ?? "",
    );
    return { master, layout: props(layout ?? null, "page-layout") };
  };

  return { get, listLevels, page };
}

/** Text properties over a parent's, a relative font size taken against the parent's size. */
export function merge(
  /** @type {RunProps & { relative?: number }} */ parent,
  /** @type {RunProps & { relative?: number }} */ own,
) {
  const { relative, ...rest } = own;
  const out = { ...parent, ...rest };
  delete out.relative;
  if (relative && (parent.size ?? 0) > 0)
    out.size = Math.round((parent.size ?? 12) * relative * 10) / 10;
  return out;
}

/** @typedef {ReturnType<typeof createOdfStyles>} OdfStyles */
