// Where a slide's links go. The PowerPoint and OpenDocument readers keep only a link's look (the
// theme's hyperlink colour, the span's style), so this reads the targets beside them and sets them
// on the deck: `link` on a run (a:hlinkClick in a:rPr, text:a) or on a shape or picture
// (a:hlinkClick in p:cNvPr). A link is an http, https or mailto URL, or "#slide-N" for a jump to
// slide N (a slide's relationship, or next, previous, first and last). A run is found again by its
// paragraph: the same run texts, line breaks and fields in the same order.
import { attr, kid, kids, parseXml, relAttr } from "../xml.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Run} Run
 * @typedef {{ text: string | null, lineBreak: boolean, link?: string }} Mark
 *   text null: a field, whose text the reader fills in.
 */

const SAFE = /^(https?:|mailto:)/i;

/** A relationship target as a part name: "../slides/slide2.xml" from ppt/slides/ is ppt/slides/slide2.xml. */
function resolve(/** @type {string} */ from, /** @type {string} */ target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/** A part's relationships by id. @param {import("../zip.js").Zip} zip @param {string} name */
async function relsOf(zip, name) {
  const slash = name.lastIndexOf("/");
  const rels = `${name.slice(0, slash + 1)}_rels/${name.slice(slash + 1)}.rels`;
  /** @type {Map<string, { target: string, external: boolean }>} */
  const out = new Map();
  if (!zip.has(rels)) return out;
  for (const rel of kids(parseXml(await zip.text(rels)), "Relationship")) {
    const external = attr(rel, "TargetMode") === "External";
    const target = attr(rel, "Target") ?? "";
    out.set(attr(rel, "Id") ?? "", { external, target: external ? target : resolve(name, target) });
  }
  return out;
}

/** Every run of the deck's paragraphs, and every shape, in drawing order. @param {SlideElement[]} elements */
function* paragraphsOf(elements) {
  for (const el of elements) {
    if (el.type === "shape" && el.text) yield* el.text.paragraphs;
    else if (el.type === "table")
      for (const row of el.rows) for (const cell of row.cells) yield* cell.text.paragraphs;
    else if (el.type === "group") yield* paragraphsOf(el.children);
  }
}
/** @param {SlideElement[]} elements @returns {Generator<SlideElement>} */
function* elementsOf(elements) {
  for (const el of elements) {
    yield el;
    if (el.type === "group") yield* elementsOf(el.children);
  }
}

/** Whether a deck paragraph's runs are the marks of a file's paragraph. @param {Run[]} runs @param {Mark[]} marks */
const same = (runs, marks) =>
  runs.length === marks.length &&
  marks.every((m, i) => {
    const run = /** @type {Run} */ (runs[i]);
    if (m.lineBreak) return Boolean(run.lineBreak);
    return (
      !run.lineBreak &&
      (m.text === null || run.text === m.text || run.text === m.text.toUpperCase())
    );
  });

/** Set the links of `paragraphs` (each a list of marks) on the slide's matching paragraphs. */
function setRuns(/** @type {SlideElement[]} */ elements, /** @type {Mark[][]} */ paragraphs) {
  const used = new Set();
  const runs = [...paragraphsOf(elements)].map((p) => p.runs);
  for (const marks of paragraphs) {
    const found = runs.find((r) => !used.has(r) && same(r, marks));
    if (!found) continue;
    used.add(found);
    marks.forEach((m, i) => {
      if (m.link) /** @type {Run & { link?: string }} */ (found[i]).link = m.link;
    });
  }
}

/**
 * The links of a PowerPoint package's slides, set on `deck` (whose slides are the presentation's,
 * in order). A template shown by its layouts has none.
 * @param {import("../zip.js").Zip} zip @param {Deck} deck
 */
export async function linkPptx(zip, deck) {
  const root = await relsOf(zip, "");
  const main =
    [...root.values()].find((r) => r.target.endsWith("presentation.xml"))?.target ??
    "ppt/presentation.xml";
  if (!zip.has(main)) return;
  const pres = parseXml(await zip.text(main));
  const presRels = await relsOf(zip, main);
  const names = kids(kid(pres, "sldIdLst"), "sldId")
    .map((s) => presRels.get(relAttr(s, "id") ?? ""))
    .filter((r) => r && !r.external && zip.has(r.target))
    .map((r) => r?.target ?? "");
  if (names.length !== deck.slides.length) return;
  for (const [i, name] of names.entries()) {
    const slide = deck.slides[i];
    const xml = await zip.text(name);
    if (!slide || !xml.includes("hlinkClick")) continue;
    const rels = await relsOf(zip, name);
    const target = (/** @type {Element | null} */ click) => {
      if (!click) return undefined;
      const action = attr(click, "action") ?? "";
      const rel = rels.get(relAttr(click, "id") ?? "");
      const jump = /jump=(\w+)/.exec(action)?.[1];
      const to = { nextslide: i + 2, previousslide: i, firstslide: 1, lastslide: names.length };
      if (jump)
        return jump in to ? `#slide-${to[/** @type {keyof typeof to} */ (jump)]}` : undefined;
      if (action.includes("hlinksldjump") && rel) {
        const at = names.indexOf(rel.target);
        return at < 0 ? undefined : `#slide-${at + 1}`;
      }
      return !action && rel?.external && SAFE.test(rel.target) ? rel.target : undefined;
    };
    const tree = parseXml(xml);
    const shapes = new Map();
    for (const cNvPr of tree.getElementsByTagNameNS("*", "cNvPr")) {
      const link = target(kid(cNvPr, "hlinkClick"));
      if (link) shapes.set(attr(cNvPr, "name") ?? "", link);
    }
    for (const el of elementsOf(slide.elements))
      if (shapes.has(el.name) && el.type !== "group")
        /** @type {SlideElement & { link?: string }} */ (el).link = shapes.get(el.name);
    /** @type {Mark[][]} */
    const paragraphs = [];
    for (const p of tree.getElementsByTagNameNS("*", "p")) {
      const marks = kids(p, "r", "br", "fld").map((r) => ({
        text: r.localName === "fld" ? null : (kid(r, "t")?.textContent ?? ""),
        lineBreak: r.localName === "br",
        link: target(kid(kid(r, "rPr"), "hlinkClick")),
      }));
      if (marks.some((m) => m.link)) paragraphs.push(marks);
    }
    setRuns(slide.elements, paragraphs);
  }
}

/** The runs an ODF paragraph gives, as the reader walks it, with the links of its text:a. */
function odfMarks(/** @type {Element} */ p) {
  /** @type {Mark[]} */
  const out = [];
  const SKIP = ["frame", "annotation", "bookmark", "bookmark-start", "bookmark-end"];
  const walk = (/** @type {Element} */ el, /** @type {string | undefined} */ link) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ");
        if (text) out.push({ text, lineBreak: false, link });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = /** @type {Element} */ (node);
      const name = child.localName;
      if (name === "s")
        out.push({
          text: " ".repeat(Math.max(1, Number(attr(child, "c")) || 1)),
          lineBreak: false,
          link,
        });
      else if (name === "tab") out.push({ text: "\t", lineBreak: false, link });
      else if (name === "line-break") out.push({ text: "", lineBreak: true, link });
      else if (name === "a") {
        const href = attr(child, "href") ?? "";
        walk(child, SAFE.test(href) ? href : link);
      } else if (![...SKIP, "soft-page-break", "change"].includes(name)) walk(child, link);
    }
  };
  walk(p, undefined);
  return out;
}

/**
 * The links of an OpenDocument presentation's text (text:a), set on `deck`, whose slides are the
 * content's draw:page elements in order.
 * @param {Element} content the office:document-content (or a flat document's root) @param {Deck} deck
 */
export function linkOdp(content, deck) {
  const pages = kids(kid(kid(content, "body"), "presentation"), "page");
  for (const [i, page] of pages.entries()) {
    const slide = deck.slides[i];
    if (!slide || page.getElementsByTagNameNS("*", "a").length === 0) continue;
    const paragraphs = [
      ...page.getElementsByTagNameNS("*", "p"),
      ...page.getElementsByTagNameNS("*", "h"),
    ]
      .map(odfMarks)
      .filter((marks) => marks.some((m) => m.link));
    setRuns(slide.elements, paragraphs);
  }
}
