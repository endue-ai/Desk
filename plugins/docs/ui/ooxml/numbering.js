// OOXML numbering: abstract numbering definitions, their instances (w:num with level overrides),
// counters shared by every instance of one definition as Word keeps them, and the marker text
// ("1.", "a.", "1.2.", a bullet) each numbered paragraph gets.
import { bullet, formatNumber } from "../numbers.js";
import { attr, kid, kids, num } from "../xml.js";
import { paraProps, runProps } from "./styles.js";

/**
 * @typedef {{ start: number, format: string, text: string, legal: boolean, pPr: import("./styles.js").ParaProps, rPr: import("./styles.js").RunProps, suffix: string }} Level
 * @typedef {{ abstract: string, starts: Map<number, number>, levels: Map<number, Level> }} Instance
 */

/**
 * @param {Element} el a w:lvl
 * @param {import("./styles.js").ThemeFonts} theme
 * @returns {Level}
 */
const levelOf = (el, theme) => ({
  start: num(kid(el, "start"), "val") ?? 1,
  format: attr(kid(el, "numFmt"), "val") ?? "decimal",
  text: attr(kid(el, "lvlText"), "val") ?? "",
  legal: kid(el, "isLgl") !== null,
  pPr: paraProps(kid(el, "pPr")),
  rPr: runProps(kid(el, "rPr"), theme),
  suffix: attr(kid(el, "suff"), "val") ?? "tab",
});

/**
 * @param {Document | undefined} doc numbering.xml
 * @param {import("./styles.js").Styles} styles
 */
export function createNumbering(doc, styles) {
  const root = doc?.documentElement;
  /** @type {Map<string, Map<number, Level>>} */
  const abstracts = new Map();
  /** @type {Map<string, string>} abstract id -> the numbering style it links to */
  const links = new Map();
  for (const el of kids(root, "abstractNum")) {
    const id = attr(el, "abstractNumId") ?? "";
    const levels = new Map();
    for (const lvl of kids(el, "lvl"))
      levels.set(num(lvl, "ilvl") ?? 0, levelOf(lvl, styles.theme));
    abstracts.set(id, levels);
    const link = attr(kid(el, "numStyleLink"), "val");
    if (link) links.set(id, link);
  }
  /** @type {Map<string, Instance>} */
  const instances = new Map();
  for (const el of kids(root, "num")) {
    const id = attr(el, "numId") ?? "";
    /** @type {Instance} */
    const instance = {
      abstract: attr(kid(el, "abstractNumId"), "val") ?? "",
      starts: new Map(),
      levels: new Map(),
    };
    for (const over of kids(el, "lvlOverride")) {
      const ilvl = num(over, "ilvl") ?? 0;
      const start = num(kid(over, "startOverride"), "val");
      if (start !== undefined) instance.starts.set(ilvl, start);
      const lvl = kid(over, "lvl");
      if (lvl) instance.levels.set(ilvl, levelOf(lvl, styles.theme));
    }
    instances.set(id, instance);
  }

  /** A definition that only links to a numbering style uses that style's numbering. */
  const levelsOf = (/** @type {string} */ abstract, depth = 0) => {
    const link = links.get(abstract);
    if (link && depth < 4) {
      const numId = styles.paragraph(link)?.pPr.numId;
      const target = numId ? instances.get(numId)?.abstract : undefined;
      if (target && target !== abstract) return levelsOf(target, depth + 1);
    }
    return abstracts.get(abstract);
  };

  /** Counters per abstract definition; instances that restart do so on first use. */
  /** @type {Map<string, Array<number | undefined>>} */
  const counters = new Map();
  /** @type {Set<string>} */
  const restarted = new Set();

  /**
   * The marker of the next paragraph numbered (numId, ilvl), counting it.
   * @param {string} numId
   * @param {number} ilvl
   * @returns {{ text: string, level: Level } | undefined}
   */
  const next = (numId, ilvl) => {
    const instance = instances.get(numId);
    if (!instance || numId === "0") return undefined;
    const base = levelsOf(instance.abstract);
    const levelAt = (/** @type {number} */ i) => instance.levels.get(i) ?? base?.get(i);
    const level = levelAt(ilvl);
    if (!level) return undefined;
    const key = instance.abstract || `num:${numId}`;
    const counts = counters.get(key) ?? [];
    counters.set(key, counts);
    if (instance.starts.size > 0 && !restarted.has(numId)) {
      restarted.add(numId);
      for (const [i, start] of instance.starts) counts[i] = start - 1;
    }
    const startOf = (/** @type {number} */ i) => instance.starts.get(i) ?? levelAt(i)?.start ?? 1;
    counts[ilvl] = (counts[ilvl] ?? startOf(ilvl) - 1) + 1;
    for (let i = ilvl + 1; i < 9; i++) counts[i] = undefined;
    if (level.format === "bullet") return { text: bullet(level.text, level.rPr.font), level };
    const text = level.text.replace(/%([1-9])/g, (_, d) => {
      const i = Number(d) - 1;
      const at = levelAt(i);
      const value = counts[i] ?? startOf(i);
      return formatNumber(value, level.legal || !at ? "decimal" : at.format);
    });
    return { text, level };
  };

  return { next };
}
