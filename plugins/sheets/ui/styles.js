// The plugin's own small reader of OOXML cell formats (SheetJS Community Edition keeps none):
// xl/styles.xml gives each cell format's font, fill and alignment, the theme gives the colours a
// format names by number, and a sheet part gives each cell's format and the frozen panes.

/** @typedef {import("./model.js").CellStyle} CellStyle */

/** Excel's 64 indexed colours (64 and 65 are the system's text and window colours). */
const INDEXED = `000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF
  000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080
  C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF
  800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC
  99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333`
  .split(/\s+/u)
  .map((hex) => `#${hex}`);

/** The theme's colour for each theme index: Excel swaps the first two pairs of the scheme. */
const THEME_ORDER = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];

/** @param {string} xml */
const parse = (xml) =>
  typeof DOMParser === "undefined" || !xml
    ? undefined
    : new DOMParser().parseFromString(xml, "application/xml");

/** Child elements of `node` by local name, whatever their prefix. */
const children = (/** @type {Element | undefined} */ node, /** @type {string} */ name) =>
  node ? [...node.children].filter((child) => child.localName === name) : [];
const child = (/** @type {Element | undefined} */ node, /** @type {string} */ name) =>
  children(node, name)[0];
const flag = (/** @type {Element | undefined} */ node) => {
  if (!node) return false;
  const val = node.getAttribute("val");
  return val === null || (val !== "0" && val !== "false" && val !== "none");
};

/** Apply an OOXML tint to a #RRGGBB colour: lighter towards 1, darker towards -1, in HSL. */
export function tint(/** @type {string} */ hex, /** @type {number} */ amount) {
  if (!amount) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const min = Math.min(r ?? 0, g ?? 0, b ?? 0);
  let l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g ?? 0) - (b ?? 0)) / d) % 6;
    else if (max === g) h = ((b ?? 0) - (r ?? 0)) / d + 2;
    else h = ((r ?? 0) - (g ?? 0)) / d + 4;
  }
  l = amount < 0 ? l * (1 + amount) : l * (1 - amount) + amount;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((((h % 2) + 2) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(((h % 6) + 6) % 6);
  const [rr, gg, bb] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] ?? [0, 0, 0];
  const out = [rr, gg, bb].map((v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${out.join("")}`.toUpperCase();
}

/** The theme's scheme colours, in the order of the file. */
function themeColors(/** @type {string} */ themeXml) {
  const scheme = parse(themeXml)?.getElementsByTagNameNS("*", "clrScheme")[0];
  return [...(scheme?.children ?? [])].map((slot) => {
    const value = slot.children[0];
    const hex = value?.getAttribute("lastClr") ?? value?.getAttribute("val") ?? "";
    return /^[0-9a-f]{6}$/iu.test(hex) ? `#${hex.toUpperCase()}` : undefined;
  });
}

/**
 * @param {Element | undefined} node a color, fgColor or bgColor element
 * @param {(string | undefined)[]} theme
 * @param {string[]} indexed
 */
function colorOf(node, theme, indexed) {
  if (!node || node.getAttribute("auto") === "1") return undefined;
  const rgb = node.getAttribute("rgb");
  const index = node.getAttribute("indexed");
  const scheme = node.getAttribute("theme");
  let hex;
  if (rgb && /^[0-9a-f]{6,8}$/iu.test(rgb)) hex = `#${rgb.slice(-6).toUpperCase()}`;
  else if (index !== null) hex = indexed[Number(index)];
  else if (scheme !== null) hex = theme[THEME_ORDER[Number(scheme)] ?? Number(scheme)];
  return hex ? tint(hex, Number(node.getAttribute("tint") ?? 0)) : undefined;
}

const ALIGN = /** @type {Record<string, string>} */ ({
  left: "left",
  center: "center",
  centerContinuous: "center",
  distributed: "center",
  right: "right",
  justify: "justify",
  fill: "left",
});

/**
 * Each cell format of xl/styles.xml (cellXfs, by index) as the grid draws it; undefined for a
 * format that looks like the grid's own cells. Without a DOMParser there are no styles.
 * @param {string} stylesXml
 * @param {string} [themeXml]
 * @returns {(CellStyle | undefined)[]}
 */
export function parseStyles(stylesXml, themeXml = "") {
  const root = parse(stylesXml)?.documentElement;
  if (root?.localName !== "styleSheet") return [];
  const theme = themeColors(themeXml);
  const custom = children(child(child(root, "colors"), "indexedColors"), "rgbColor");
  const indexed = custom.length
    ? custom.map((node) => colorOf(node, theme, INDEXED) ?? "#000000")
    : INDEXED;

  const fonts = children(child(root, "fonts"), "font").map((font) => {
    /** @type {CellStyle} */
    const style = {};
    if (flag(child(font, "b"))) style.bold = true;
    if (flag(child(font, "i"))) style.italic = true;
    if (flag(child(font, "u"))) style.underline = true;
    if (flag(child(font, "strike"))) style.strike = true;
    const color = colorOf(child(font, "color"), theme, indexed);
    // Black is the automatic text colour: the grid's own text colour shows instead.
    if (color && color !== "#000000") style.color = color;
    return style;
  });
  const fills = children(child(root, "fills"), "fill").map((fill) => {
    const pattern = child(fill, "patternFill");
    const type = pattern?.getAttribute("patternType") ?? "none";
    if (!pattern || type === "none") return undefined;
    return colorOf(child(pattern, "fgColor"), theme, indexed);
  });

  return children(child(root, "cellXfs"), "xf").map((xf) => {
    /** @type {CellStyle} */
    const style = { ...fonts[Number(xf.getAttribute("fontId") ?? 0)] };
    const fill = fills[Number(xf.getAttribute("fillId") ?? 0)];
    if (fill) style.fill = fill;
    const alignment = child(xf, "alignment");
    const align = ALIGN[alignment?.getAttribute("horizontal") ?? ""];
    if (align) style.align = align;
    const wrap = alignment?.getAttribute("wrapText");
    if (wrap === "1" || wrap === "true") style.wrap = true;
    return Object.keys(style).length ? style : undefined;
  });
}

/** Row and column of an A1 reference. */
function cellRef(/** @type {string} */ ref) {
  let c = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    c = c * 26 + code - 64;
  }
  return { r: Number(ref.slice(i)) - 1, c: c - 1 };
}

const attr = (/** @type {string} */ tag, /** @type {string} */ name) => {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return undefined;
  const start = at + name.length + 3;
  return tag.slice(start, tag.indexOf('"', start));
};

/**
 * Each cell's format index, and the frozen panes, from a worksheet part. Cells without a format
 * of their own take their row's (customFormat) or their column's.
 * @param {string} sheetXml
 */
export function scanSheet(sheetXml) {
  /** @type {number[][]} */
  const cells = [];
  /** @type {number[]} */
  const rowFormats = [];
  /** @type {{ min: number, max: number, style: number }[]} */
  const colFormats = [];
  const data = sheetXml.search(/<(?:\w+:)?sheetData[\s>]/u);
  const head = data < 0 ? sheetXml : sheetXml.slice(0, data);
  const pane = /<(?:\w+:)?pane\s[^>]*>/u.exec(head)?.[0] ?? "";
  const state = attr(pane, "state");
  const frozen =
    state === "frozen" || state === "frozenSplit"
      ? { rows: Number(attr(pane, "ySplit") ?? 0), cols: Number(attr(pane, "xSplit") ?? 0) }
      : undefined;
  for (const [tag, name] of head.matchAll(/<(?:\w+:)?(col)\s[^>]*>/gu)) {
    const style = Number(attr(tag, "style") ?? 0);
    if (name && style > 0) {
      const min = Number(attr(tag, "min")) - 1;
      colFormats.push({ min, max: Number(attr(tag, "max") ?? min + 1) - 1, style });
    }
  }
  const tags = /<(?:\w+:)?(c|row)\s[^>]*>/gu;
  tags.lastIndex = Math.max(0, data);
  for (let match = tags.exec(sheetXml); match; match = tags.exec(sheetXml)) {
    const tag = match[0];
    const format = attr(tag, "s");
    if (format === undefined || format === "0") continue;
    if (match[1] === "row") {
      const r = Number(attr(tag, "r")) - 1;
      const custom = attr(tag, "customFormat");
      if (r >= 0 && (custom === "1" || custom === "true")) rowFormats[r] = Number(format);
      continue;
    }
    const ref = attr(tag, "r");
    if (!ref) continue;
    const { r, c } = cellRef(ref);
    const row = cells[r] ?? [];
    row[c] = Number(format);
    cells[r] = row;
  }
  return {
    frozen,
    /** @param {number} r @param {number} c */
    format: (r, c) =>
      cells[r]?.[c] ??
      rowFormats[r] ??
      colFormats.find((col) => c >= col.min && c <= col.max)?.style,
  };
}
