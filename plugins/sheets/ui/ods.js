// What SheetJS leaves out of an OpenDocument spreadsheet: column widths, row heights, hidden rows,
// columns and sheets (content.xml and its automatic styles) and frozen panes (settings.xml). A scan
// of start tags, not a DOM, so a large content.xml costs one pass.

/**
 * @typedef {import("./model.js").Frozen} Frozen
 * @typedef {{
 *   widths: number[], heights: number[], hiddenRows: Set<number>, hiddenCols: Set<number>,
 *   frozen?: Frozen,
 * }} Layout
 */

/** Pixels per unit, at 96 pixels to the inch. */
const UNITS = /** @type {Record<string, number>} */ ({
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 4 / 3,
  pc: 16,
  px: 1,
});
/** Longer runs are the filler a writer repeats to the sheet's edge: they keep the default size. */
const MAX_RUN = 100_000;

const pixels = (/** @type {string | undefined} */ length) => {
  const match = /^([\d.]+)([a-z]+)$/u.exec(length ?? "");
  const unit = match?.[2] ? UNITS[match[2]] : undefined;
  return match && unit ? Math.round(Number(match[1]) * unit) : undefined;
};

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
});
const unescapeXml = (/** @type {string} */ text) =>
  text.replace(/&(amp|lt|gt|quot|apos);/gu, (_, name) => ENTITIES[name] ?? "");

/** The value of one attribute in a start tag. */
const attr = (/** @type {string} */ tag, /** @type {string} */ name) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag);
  return match?.[1] === undefined ? undefined : unescapeXml(match[1]);
};

/** Automatic styles by name: a column's width, a row's height, a table's display. */
function automaticStyles(/** @type {string} */ xml) {
  /** @type {Map<string, { width?: number, height?: number, hidden?: boolean }>} */
  const styles = new Map();
  const pattern = /<style:style\s([^>]*?)(?:\/>|>([\s\S]*?)<\/style:style>)/gu;
  for (const [, head = "", body = ""] of xml.matchAll(pattern)) {
    const name = attr(` ${head}`, "style:name");
    if (!name) continue;
    styles.set(name, {
      width: pixels(attr(body, "style:column-width")),
      height: pixels(attr(body, "style:row-height")),
      hidden: attr(body, "table:display") === "false",
    });
  }
  return styles;
}

/** The frozen panes of each sheet, from the view settings LibreOffice writes. */
function frozenPanes(/** @type {string} */ settings) {
  /** @type {Map<string, Frozen>} */
  const panes = new Map();
  const start = settings.indexOf('config:name="Tables"');
  if (start < 0) return panes;
  const end = settings.indexOf("</config:config-item-map-named>", start);
  const tables = settings.slice(start, end < 0 ? undefined : end);
  const entry =
    /<config:config-item-map-entry config:name="([^"]*)">([\s\S]*?)<\/config:config-item-map-entry>/gu;
  const item = (/** @type {string} */ body, /** @type {string} */ name) =>
    Number(new RegExp(`config:name="${name}"[^>]*>(\\d+)<`, "u").exec(body)?.[1] ?? 0);
  for (const [, name = "", body = ""] of tables.matchAll(entry)) {
    const cols =
      item(body, "HorizontalSplitMode") === 2 ? item(body, "HorizontalSplitPosition") : 0;
    const rows = item(body, "VerticalSplitMode") === 2 ? item(body, "VerticalSplitPosition") : 0;
    if (rows || cols) panes.set(unescapeXml(name), { rows, cols });
  }
  return panes;
}

/**
 * The layout of every sheet in content.xml, by sheet name, and the names of hidden sheets.
 * @param {string} content content.xml, or a whole .fods
 * @param {string} [settings] settings.xml (a .fods holds both in one file)
 */
export function odsLayout(content, settings = content) {
  const styles = automaticStyles(content);
  const panes = frozenPanes(settings);
  /** @type {Map<string, Layout>} */
  const sheets = new Map();
  /** @type {Set<string>} */
  const hidden = new Set();
  /** @type {Layout | undefined} */
  let layout;
  let row = 0;
  let col = 0;
  const tags = /<table:(table|table-column|table-row)(?=[\s/>])([^>]*)>/gu;
  for (const [, kind, tag = ""] of content.matchAll(tags)) {
    if (kind === "table") {
      const name = attr(tag, "table:name") ?? "";
      if (styles.get(attr(tag, "table:style-name") ?? "")?.hidden) hidden.add(name);
      layout = { widths: [], heights: [], hiddenRows: new Set(), hiddenCols: new Set() };
      const frozen = panes.get(name);
      if (frozen) layout.frozen = frozen;
      sheets.set(name, layout);
      row = 0;
      col = 0;
      continue;
    }
    if (!layout) continue;
    const isRow = kind === "table-row";
    const repeat = Number(
      attr(tag, isRow ? "table:number-rows-repeated" : "table:number-columns-repeated") ?? 1,
    );
    const style = styles.get(attr(tag, "table:style-name") ?? "");
    const size = isRow ? style?.height : style?.width;
    const collapsed = attr(tag, "table:visibility");
    const start = isRow ? row : col;
    if (repeat <= MAX_RUN) {
      for (let i = start; i < start + repeat; i++) {
        if (size !== undefined) (isRow ? layout.heights : layout.widths)[i] = size;
        if (collapsed === "collapse" || collapsed === "filter")
          (isRow ? layout.hiddenRows : layout.hiddenCols).add(i);
      }
    }
    if (isRow) row += repeat;
    else col += repeat;
  }
  return { sheets, hidden };
}
