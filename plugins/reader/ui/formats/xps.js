// XPS and OXPS documents: the package's FixedDocumentSequence (its relationship, or any .fdseq),
// each FixedDocument's PageContent in order, and every FixedPage drawn as SVG (xps-svg.js) with the
// images and fonts it uses read first: obfuscated .odttf fonts de-obfuscated by their GUID.
import { dataUrl, mimeOf } from "./bytes.js";
import { Unreadable } from "./errors.js";
import { imageSize } from "./imagesize.js";
import { imageType } from "./mobi.js";
import { deobfuscate } from "./odttf.js";
import { resolvePath } from "./paths.js";
import { pageToSvg } from "./xps-svg.js";

/**
 * @typedef {import("./zip.js").Zip} Zip
 * @typedef {{ svg: string, text: string, fonts: Array<{ family: string, bytes: Uint8Array }> }} XpsPage
 */

const xml = (/** @type {string} */ text) => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Unreadable("The XPS document is damaged: a part does not parse.", { format: "XPS" });
  return doc;
};
const all = (/** @type {Document | Element} */ node, /** @type {string} */ name) => [
  ...node.getElementsByTagNameNS("*", name),
];
const part = (/** @type {string} */ base, /** @type {string} */ href) =>
  resolvePath(base, href).path;

/** Fonts get one family name per document, so a page drawn twice reuses its face. */
let families = 0;

/** @param {Zip} zip */
export async function readXps(zip) {
  let sequence = "";
  if (zip.has("_rels/.rels")) {
    const rel = all(xml(await zip.text("_rels/.rels")), "Relationship").find((r) =>
      /fixedrepresentation$/i.test(r.getAttribute("Type") ?? ""),
    );
    sequence = part("", rel?.getAttribute("Target") ?? "");
  }
  if (!zip.has(sequence)) sequence = zip.names.find((n) => /\.fdseq$/i.test(n)) ?? "";
  if (!zip.has(sequence))
    throw new Unreadable("The XPS document is damaged: it has no FixedDocumentSequence.", {
      format: "XPS",
    });
  const oxps = (await zip.text(sequence)).includes("openxps.org");
  const format = oxps ? "OXPS" : "XPS";
  /** @type {Array<{ path: string, width?: number, height?: number }>} */
  const contents = [];
  for (const ref of all(xml(await zip.text(sequence)), "DocumentReference")) {
    const doc = part(sequence, ref.getAttribute("Source") ?? "");
    if (!zip.has(doc)) continue;
    for (const page of all(xml(await zip.text(doc)), "PageContent")) {
      const width = Number(page.getAttribute("Width"));
      const height = Number(page.getAttribute("Height"));
      contents.push({
        path: part(doc, page.getAttribute("Source") ?? ""),
        ...(width && height ? { width, height } : {}),
      });
    }
  }
  const present = contents.filter((c) => zip.has(c.path));
  if (present.length === 0) throw new Unreadable("The XPS document has no pages.", { format });

  /** @type {Map<number, Element>} */
  const parsed = new Map();
  const fixedPage = async (/** @type {number} */ i) => {
    let found = parsed.get(i);
    if (!found) {
      const root = xml(await zip.text(present[i]?.path ?? "")).documentElement;
      if (root?.localName !== "FixedPage")
        throw new Unreadable("The XPS document is damaged: a page is not a FixedPage.", { format });
      parsed.set(i, root);
      found = root;
    }
    return found;
  };
  const first = present[0] ?? { path: "" };
  const firstSize = first.width
    ? { width: first.width, height: first.height ?? 1056 }
    : await fixedPage(0).then((p) => ({
        width: Number(p.getAttribute("Width") ?? 816),
        height: Number(p.getAttribute("Height") ?? 1056),
      }));
  const pages = present.map((c) =>
    c.width && c.height ? { width: c.width, height: c.height } : { ...firstSize },
  );

  /** @type {Map<string, { href: string, width: number, height: number } | undefined>} */
  const images = new Map();
  /** @type {Map<string, { family: string, bytes: Uint8Array }>} */
  const fonts = new Map();
  /** @type {Map<string, Element | undefined>} */
  const dictionaries = new Map();

  /** Read what a page refers to (images, fonts, remote dictionaries) before it is drawn. */
  const preload = async (/** @type {Element} */ page, /** @type {string} */ base) => {
    for (const dict of all(page, "ResourceDictionary")) {
      const source = dict.getAttribute("Source");
      if (!source) continue;
      const path = part(base, source);
      if (!dictionaries.has(path))
        dictionaries.set(
          path,
          zip.has(path) ? (xml(await zip.text(path)).documentElement ?? undefined) : undefined,
        );
    }
    for (const brush of all(page, "ImageBrush")) {
      const path = part(
        base,
        (brush.getAttribute("ImageSource") ?? "").replace(
          /^\{ColorConvertedBitmap\s+([^\s}]+).*$/,
          "$1",
        ),
      );
      if (images.has(path) || !zip.has(path)) continue;
      const bytes = await zip.read(path).catch(() => undefined);
      const size = bytes && imageSize(bytes);
      const mime = bytes && (imageType(bytes) ?? mimeOf(path));
      images.set(
        path,
        bytes && mime
          ? { href: dataUrl(mime, bytes), width: size?.width ?? 1, height: size?.height ?? 1 }
          : undefined,
      );
    }
    for (const glyphs of all(page, "Glyphs")) {
      const path = part(base, (glyphs.getAttribute("FontUri") ?? "").split("#")[0] ?? "");
      if (fonts.has(path) || !zip.has(path)) continue;
      const raw = await zip.read(path).catch(() => undefined);
      if (!raw) continue;
      const bytes =
        /\.odttf$/i.test(path) || (raw[0] !== 0 && raw[0] !== 0x4f && raw[0] !== 0x74)
          ? deobfuscate(raw, path)
          : raw;
      fonts.set(path, { family: `xps-font-${families++}`, bytes });
    }
  };

  /** @type {Map<number, Promise<XpsPage>>} */
  const drawn = new Map();
  const page = (/** @type {number} */ i) => {
    let found = drawn.get(i);
    if (!found) {
      found = (async () => {
        const root = await fixedPage(i);
        const base = present[i]?.path ?? "";
        await preload(root, base);
        /** @type {Set<{ family: string, bytes: Uint8Array }>} */
        const used = new Set();
        const { svg, text } = pageToSvg(root, {
          image: (source) =>
            images.get(part(base, source.replace(/^\{ColorConvertedBitmap\s+([^\s}]+).*$/, "$1"))),
          font: (uri) => {
            const font = fonts.get(part(base, uri.split("#")[0] ?? ""));
            if (font) used.add(font);
            return font?.family;
          },
          dictionary: (source) => dictionaries.get(part(base, source)),
        });
        return { svg, text, fonts: [...used] };
      })();
      drawn.set(i, found);
    }
    return found;
  };

  return {
    kind: /** @type {const} */ ("pages"),
    format,
    title: "",
    pages,
    toc: [],
    page,
    text: async (/** @type {number} */ i) => (await page(i)).text,
    measure: async (/** @type {number} */ i) => {
      const root = await fixedPage(i);
      const size = {
        width: Number(root.getAttribute("Width") ?? pages[i]?.width ?? 816),
        height: Number(root.getAttribute("Height") ?? pages[i]?.height ?? 1056),
      };
      pages[i] = size;
      return size;
    },
  };
}
