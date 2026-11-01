// OOXML styles: document defaults, paragraph, character and table styles resolved through basedOn,
// theme fonts, and the property readers (w:pPr, w:rPr) the body uses for direct formatting too.
import { color, twips } from "../model.js";
import { attr, find, kid, kids, num, onOff } from "../xml.js";

/**
 * @typedef {{ bold?: boolean, italic?: boolean, underline?: boolean, strike?: boolean, size?: number, color?: string, highlight?: string, font?: string, script?: "super" | "sub", caps?: boolean, hidden?: boolean }} RunProps
 * @typedef {{ align?: import("../model.js").Align, indent?: import("../model.js").Indent, spacing?: import("../model.js").Spacing, level?: number, numId?: string, ilvl?: number, pageBreakBefore?: boolean, rtl?: boolean }} ParaProps
 * @typedef {{ id: string, type: string, name: string, basedOn: string, pPr: ParaProps, rPr: RunProps, borders?: boolean }} Style
 * @typedef {{ major: string[], minor: string[] }} ThemeFonts
 */

const HIGHLIGHTS = /** @type {Record<string, string>} */ ({
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#C0C0C0",
  black: "#000000",
  white: "#FFFFFF",
});

const ALIGN = /** @type {Record<string, import("../model.js").Align>} */ ({
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
  justify: "justify",
});

/** The theme's major and minor fonts: Latin first, then East Asian and Hangul. */
export function themeFonts(/** @type {Document | undefined} */ theme) {
  const pick = (/** @type {string} */ which) => {
    const el = find(theme, which);
    const names = [
      attr(kid(el, "latin"), "typeface"),
      attr(kid(el, "ea"), "typeface"),
      ...kids(el, "font")
        .filter((f) => ["Hang", "Jpan", "Hans", "Hant"].includes(attr(f, "script") ?? ""))
        .map((f) => attr(f, "typeface")),
    ];
    return [...new Set(names.filter((n) => typeof n === "string" && n !== ""))];
  };
  return { major: pick("majorFont"), minor: pick("minorFont") };
}

/**
 * Run properties from a w:rPr element; only what it says.
 * @param {Element | null} rPr
 * @param {ThemeFonts} theme
 * @returns {RunProps}
 */
export function runProps(rPr, theme) {
  /** @type {RunProps} */
  const out = {};
  if (!rPr) return out;
  const flag = (/** @type {string} */ local) => onOff(kid(rPr, local));
  const bold = flag("b");
  if (bold !== undefined) out.bold = bold;
  const italic = flag("i");
  if (italic !== undefined) out.italic = italic;
  const u = kid(rPr, "u");
  if (u) out.underline = (attr(u, "val") ?? "single") !== "none";
  const strike = flag("strike") ?? flag("dstrike");
  if (strike !== undefined) out.strike = strike;
  const caps = flag("caps") ?? flag("smallCaps");
  if (caps !== undefined) out.caps = caps;
  const hidden = flag("vanish");
  if (hidden !== undefined) out.hidden = hidden;
  const size = num(kid(rPr, "sz"), "val");
  if (size !== undefined) out.size = size / 2;
  const colour = color(attr(kid(rPr, "color"), "val"));
  if (colour) out.color = colour;
  const highlight = HIGHLIGHTS[attr(kid(rPr, "highlight"), "val") ?? ""];
  const shade = color(attr(kid(rPr, "shd"), "fill"));
  if (highlight ?? shade) out.highlight = highlight ?? shade;
  const vert = attr(kid(rPr, "vertAlign"), "val");
  if (vert === "superscript") out.script = "super";
  else if (vert === "subscript") out.script = "sub";
  const fonts = kid(rPr, "rFonts");
  if (fonts) {
    const themed = (/** @type {string} */ local) => {
      const ref = attr(fonts, local) ?? "";
      if (!ref) return [];
      const set = ref.startsWith("major") ? theme.major : theme.minor;
      return ref.endsWith("EastAsia") ? set.slice(1) : set;
    };
    const names = [
      attr(fonts, "ascii"),
      attr(fonts, "hAnsi"),
      ...themed("asciiTheme"),
      attr(fonts, "eastAsia"),
      ...themed("eastAsiaTheme"),
    ].filter((n) => typeof n === "string" && n !== "");
    if (names.length > 0) out.font = [...new Set(names)].join(", ");
  }
  return out;
}

/**
 * Paragraph properties from a w:pPr element; only what it says.
 * @param {Element | null} pPr
 * @returns {ParaProps}
 */
export function paraProps(pPr) {
  /** @type {ParaProps} */
  const out = {};
  if (!pPr) return out;
  const align = ALIGN[attr(kid(pPr, "jc"), "val") ?? ""];
  if (align) out.align = align;
  const ind = kid(pPr, "ind");
  if (ind) {
    /** @type {import("../model.js").Indent} */
    const indent = {};
    const left = num(ind, "left") ?? num(ind, "start");
    const right = num(ind, "right") ?? num(ind, "end");
    const first = num(ind, "firstLine");
    const hanging = num(ind, "hanging");
    if (left !== undefined) indent.left = twips(left);
    if (right !== undefined) indent.right = twips(right);
    if (hanging !== undefined) indent.first = -twips(hanging);
    else if (first !== undefined) indent.first = twips(first);
    out.indent = indent;
  }
  const sp = kid(pPr, "spacing");
  if (sp) {
    /** @type {import("../model.js").Spacing} */
    const spacing = {};
    const before = num(sp, "before");
    const after = num(sp, "after");
    if (before !== undefined) spacing.before = twips(before);
    if (after !== undefined) spacing.after = twips(after);
    if (attr(sp, "beforeAutospacing") === "1") spacing.before = 14;
    if (attr(sp, "afterAutospacing") === "1") spacing.after = 14;
    const line = num(sp, "line");
    const rule = attr(sp, "lineRule") ?? "auto";
    if (line !== undefined && line > 0)
      Object.assign(
        spacing,
        rule === "auto" ? { line: line / 240 } : { line: twips(line), exact: true },
      );
    out.spacing = spacing;
  }
  const level = num(kid(pPr, "outlineLvl"), "val");
  if (level !== undefined) out.level = level;
  const numPr = kid(pPr, "numPr");
  if (numPr) {
    const id = attr(kid(numPr, "numId"), "val");
    if (id !== null) out.numId = id;
    const ilvl = num(kid(numPr, "ilvl"), "val");
    if (ilvl !== undefined) out.ilvl = ilvl;
  }
  const breakBefore = onOff(kid(pPr, "pageBreakBefore"));
  if (breakBefore !== undefined) out.pageBreakBefore = breakBefore;
  const rtl = onOff(kid(pPr, "bidi"));
  if (rtl !== undefined) out.rtl = rtl;
  return out;
}

/** Later properties over earlier ones; indents and spacing merge field by field. */
export function mergePara(/** @type {ParaProps[]} */ ...layers) {
  /** @type {ParaProps} */
  const out = {};
  for (const layer of layers) {
    const { indent, spacing, ...rest } = layer;
    Object.assign(out, rest);
    if (indent) out.indent = { ...out.indent, ...indent };
    if (spacing) out.spacing = { ...out.spacing, ...spacing };
  }
  return out;
}

const hasBorders = (/** @type {Element | null} */ tblPr) => {
  const borders = kid(tblPr, "tblBorders");
  if (!borders) return undefined;
  return kids(borders).some((b) => !["nil", "none"].includes(attr(b, "val") ?? "none"));
};

/**
 * @param {Document | undefined} doc styles.xml
 * @param {ThemeFonts} theme
 */
export function createStyles(doc, theme) {
  const root = doc?.documentElement;
  const defaults = kid(root, "docDefaults");
  const baseRun = runProps(kid(kid(defaults, "rPrDefault"), "rPr"), theme);
  const basePara = paraProps(kid(kid(defaults, "pPrDefault"), "pPr"));
  /** @type {Map<string, Element>} */
  const raw = new Map();
  let defaultPara = "";
  let defaultTable = "";
  for (const el of kids(root, "style")) {
    const id = attr(el, "styleId") ?? "";
    raw.set(id, el);
    if (attr(el, "default") === "1" || attr(el, "default") === "true") {
      if (attr(el, "type") === "paragraph") defaultPara = id;
      if (attr(el, "type") === "table") defaultTable = id;
    }
  }
  /** @type {Map<string, Style>} */
  const resolved = new Map();
  /** @returns {Style | undefined} */
  const get = (/** @type {string} */ id, depth = 0) => {
    const done = resolved.get(id);
    if (done) return done;
    const el = raw.get(id);
    if (!el || depth > 20) return undefined;
    const parent = get(attr(kid(el, "basedOn"), "val") ?? "", depth + 1);
    const own = paraProps(kid(el, "pPr"));
    /** @type {Style} */
    const style = {
      id,
      type: attr(el, "type") ?? "paragraph",
      name: attr(kid(el, "name"), "val") ?? id,
      basedOn: parent?.id ?? "",
      pPr: mergePara(parent?.pPr ?? {}, own),
      rPr: { ...parent?.rPr, ...runProps(kid(el, "rPr"), theme) },
      borders: hasBorders(kid(el, "tblPr")) ?? parent?.borders,
    };
    resolved.set(id, style);
    return style;
  };
  return {
    baseRun,
    basePara,
    /** The paragraph style a paragraph uses: its own, or the document's default. */
    paragraph: (/** @type {string | null} */ id) => get(id || defaultPara) ?? get(defaultPara),
    character: (/** @type {string | null} */ id) => (id ? get(id) : undefined),
    /** Whether a table draws borders: its own w:tblBorders, else its style's. */
    tableBorders: (/** @type {Element | null} */ tblPr) =>
      hasBorders(tblPr) ??
      get(attr(kid(tblPr, "tblStyle"), "val") || defaultTable)?.borders ??
      false,
    theme,
  };
}

/** @typedef {ReturnType<typeof createStyles>} Styles */
