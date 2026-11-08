// OpenDocument text (.odt, .ott, .fodt) and OpenOffice.org 1.0 Writer (.sxw): content and styles,
// the pictures the content names, master pages as sections with their headers and footers.
import { pictureUrl } from "../bytes.js";
import { formatName } from "../formats.js";
import { A4, DocError, documentOf, ENCRYPTED, length, section } from "../model.js";
import { attr, find, findAll, kid, parseXml } from "../xml.js";
import { blocks } from "./body.js";
import { createOdfStyles } from "./styles.js";

/**
 * @param {import("../zip.js").Zip} zip
 * @param {string} format
 */
export async function readOdfPackage(zip, format) {
  const manifest = await zip.text("META-INF/manifest.xml");
  if (manifest && /encryption-data/.test(manifest)) throw new DocError(ENCRYPTED);
  const content = await zip.text("content.xml");
  if (content === undefined) throw new DocError("This file is damaged: it has no content.xml.");
  const docs = [parseXml(content, "content.xml")];
  const styles = await zip.text("styles.xml");
  if (styles) docs.push(parseXml(styles, "styles.xml"));
  /** @type {Map<string, string | null>} */
  const images = new Map();
  for (const doc of docs)
    for (const image of findAll(doc, "image")) {
      const href = (attr(image, "href") ?? "").replace(/^#/, "").replace(/^\.\//, "");
      if (!href || images.has(href) || /^[a-z]+:/i.test(href)) continue;
      const bytes = await zip.read(href).catch(() => undefined);
      images.set(href, bytes ? pictureUrl(bytes) : null);
    }
  const meta = await zip.text("meta.xml").catch(() => undefined);
  const title = meta ? (find(parseXml(meta, "meta.xml"), "title")?.textContent ?? "") : "";
  return build(docs, images, format, title);
}

/**
 * Flat ODF: one XML document with styles, content and pictures as office:binary-data.
 * @param {string} text
 * @param {string} format
 */
export function readOdfFlat(text, format) {
  const doc = parseXml(text, "the document");
  const title = find(find(doc, "meta"), "title")?.textContent ?? "";
  return build([doc], new Map(), format, title);
}

/**
 * @param {Document[]} docs
 * @param {Map<string, string | null>} images
 * @param {string} format
 * @param {string} title
 */
function build(docs, images, format, title) {
  const styles = createOdfStyles(docs);
  const body = find(docs[0], "text") ?? find(docs[0], "body");
  if (!body) throw new DocError("This file is damaged: it has no text body.");
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  /** @type {import("./body.js").OdfCtx} */
  const ctx = {
    styles,
    images,
    notes: [],
    comments: [],
    open: new Map(),
    counters: new Map(),
    pending: [],
  };
  let current = sectionFor(styles, undefined, ctx);
  ctx.onMaster = (name, before) => {
    if (before.length > 0 || sections.length > 0) {
      current.blocks = before;
      sections.push(current);
    }
    current = sectionFor(styles, name, ctx);
    return [];
  };
  current.blocks = blocks(body, ctx);
  sections.push(current);
  return documentOf({
    format,
    formatName: formatName(format),
    title: title.trim(),
    sections,
    notes: ctx.notes,
    comments: ctx.comments,
  });
}

/** A section for a master page: its layout's paper and margins, its header and footer. */
function sectionFor(
  /** @type {import("./styles.js").OdfStyles} */ styles,
  /** @type {string | undefined} */ name,
  /** @type {import("./body.js").OdfCtx} */ ctx,
) {
  const { master, layout } = styles.page(name);
  const size = (/** @type {string} */ key, /** @type {number} */ fallback) =>
    length(attr(layout, key)) ?? fallback;
  const margin = (/** @type {string} */ side) => size(`margin-${side}`, 56.7);
  const part = (/** @type {string} */ which) => {
    const el = kid(master ?? null, which);
    return el && attr(el, "display") !== "false"
      ? blocks(el, { ...ctx, open: new Map(), pending: [] })
      : [];
  };
  const header = part("header");
  const footer = part("footer");
  const top = margin("top");
  const bottom = margin("bottom");
  return section({
    width: size("page-width", A4.width),
    height: size("page-height", A4.height),
    margins: {
      top: header.length ? top + 28 : top,
      right: margin("right"),
      bottom: footer.length ? bottom + 28 : bottom,
      left: margin("left"),
      header: top,
      footer: bottom,
    },
    header,
    footer,
  });
}
