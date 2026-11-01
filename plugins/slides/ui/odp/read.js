// An ODF presentation (.odp, .otp, or a flat .fodp) as a deck: the page size from the first master's
// page layout, each draw:page with its master page's background and shapes, notes, hidden pages.
import { fromBase64, imageUrl } from "../bytes.js";
import { imageCache, NO_FILL, plainText } from "../deck.js";
import { attr, kid, kids, parseXml } from "../xml.js";
import { readOdpShapes } from "./shapes.js";
import { chainOf, fillFrom, length, propsOf, styleIndex } from "./style.js";
import { readParagraphs, textOfParagraphs } from "./text.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Slide} Slide
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../zip.js").Zip} Zip
 */

/** @param {Zip} zip @param {string} format */
export async function readOdpZip(zip, format) {
  const content = parseXml(await zip.text("content.xml"));
  const styles = zip.has("styles.xml") ? parseXml(await zip.text("styles.xml")) : null;
  return readOdp({ content, styles, files: zip }, format);
}

/**
 * @param {{ content: Element, styles: Element | null, files: Zip | null }} doc
 * @param {string} format
 * @returns {Promise<Deck>}
 */
export async function readOdp({ content, styles, files }, format) {
  /** Pictures inside a flat document, by id. @type {Map<string, string>} */
  const binary = new Map();
  const imageOf = (/** @type {Element} */ holder) => {
    const data = kid(holder, "binary-data");
    if (data) {
      const id = `binary:${binary.size + 1}`;
      binary.set(id, data.textContent ?? "");
      return id;
    }
    const href = (attr(holder, "href") ?? "").replace(/^\.\//, "");
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    return files?.has(href) ? href : null;
  };
  const roots = styles && styles !== content ? [content, styles] : [content];
  const index = styleIndex(roots, imageOf);
  const masterIndex = styleIndex(
    styles && styles !== content ? [styles, content] : [content],
    imageOf,
  );

  const masterPages = kids(kids(styles ?? content, "master-styles")[0], "master-page");
  /** @type {Map<string, { el: Element, background: import("../deck.js").Fill | undefined, shapes: SlideElement[] }>} */
  const masters = new Map();
  for (const m of masterPages) {
    const props = propsOf(
      chainOf(masterIndex, "drawing-page", attr(m, "style-name")),
      "drawing-page-properties",
    );
    masters.set(attr(m, "name") ?? "", {
      el: m,
      background: fillFrom(props, masterIndex),
      shapes: readOdpShapes(m, { index: masterIndex, master: true }),
    });
  }
  const first = masterPages[0];
  const layout = findLayout(masterIndex, roots, attr(first, "page-layout-name"));
  const layoutProps = propsOf(layout ? [layout] : [], "page-layout-properties");
  const size = {
    width: length(layoutProps["page-width"], 793.7),
    height: length(layoutProps["page-height"], 595.3),
  };

  const body = kid(kid(content, "body"), "presentation");
  /** @type {Slide[]} */
  const slides = kids(body, "page").map((page, i) => {
    const master =
      masters.get(attr(page, "master-page-name") ?? "") ?? masters.values().next().value;
    const props = propsOf(
      chainOf(index, "drawing-page", attr(page, "style-name")),
      "drawing-page-properties",
    );
    const own = props.fill && props.fill !== "none" ? fillFrom(props, index) : undefined;
    const background = own ??
      (master?.background && master.background.type !== "none" ? master.background : undefined) ?? {
        type: "solid",
        color: "#ffffff",
      };
    /** @type {SlideElement[]} */
    const elements = [];
    if (master && props["background-objects-visible"] !== "false") elements.push(...master.shapes);
    elements.push(...readOdpShapes(page, { index }));
    const notesFrame = kids(kid(page, "notes"), "frame").find((f) => attr(f, "class") === "notes");
    const notes = textOfParagraphs(
      readParagraphs(kid(notesFrame, "text-box"), { index, frame: [], listStyle: null }),
    );
    const heading = elements.find((e) => e.type === "shape" && e.placeholder === "title");
    return {
      number: i + 1,
      title:
        heading?.type === "shape"
          ? plainText(heading.text).replace(/\s+/g, " ").trim()
          : (attr(page, "name") ?? ""),
      hidden: props.visibility === "hidden",
      background: background ?? NO_FILL,
      elements,
      notes,
    };
  });

  const image = imageCache(async (id) => {
    const data = binary.get(id);
    if (data !== undefined) return imageUrl(fromBase64(data));
    return files ? imageUrl(await files.bytes(id)) : null;
  });
  return { format, size, slides, textOnly: false, image };
}

/** A style:page-layout by name, in any of the roots' automatic styles. */
function findLayout(
  /** @type {import("./style.js").Styles} */ index,
  /** @type {Element[]} */ roots,
  /** @type {string | null} */ name,
) {
  const named = index.named("page-layout", name);
  if (named) return named;
  for (const root of roots)
    for (const block of kids(root, "automatic-styles"))
      for (const el of kids(block, "page-layout"))
        if (!name || attr(el, "name") === name) return el;
  return null;
}
