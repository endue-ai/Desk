// EPUB 2 and 3: container.xml to the package (OPF), its spine in order, the table of contents from
// nav.xhtml (EPUB 3) or toc.ncx (EPUB 2), and each chapter sanitized (sanitize.js) with the book's
// own CSS (css.js), images inlined as data: URLs and fonts handed to the FontFace API.
import { dataUrl, mimeOf } from "./bytes.js";
import { sanitizeCss } from "./css.js";
import { Unreadable } from "./errors.js";
import { folderOf, isExternal, resolvePath } from "./paths.js";
import { bodyOf, parseMarkup, sanitizeHtml, wrap } from "./sanitize.js";

/**
 * @typedef {import("./toc.js").Toc} Toc
 * @typedef {import("./zip.js").Zip} Zip
 * @typedef {{ html: string, css: string[], fonts: import("./css.js").Font[], text: string }} Chapter
 */

const OPS = "http://www.idpf.org/2007/ops";
const xml = (/** @type {string} */ text) =>
  new DOMParser().parseFromString(text, "application/xml");
const all = (/** @type {Document | Element} */ node, /** @type {string} */ name) => [
  ...node.getElementsByTagNameNS("*", name),
];
const first = (/** @type {Document | Element} */ node, /** @type {string} */ name) =>
  node.getElementsByTagNameNS("*", name)[0];
const clean = (/** @type {string | null | undefined} */ text) =>
  (text ?? "").replace(/\s+/g, " ").trim();

/** @param {Zip} zip */
export async function readEpub(zip) {
  if (zip.has("META-INF/rights.xml"))
    throw new Unreadable("This book is protected by DRM.", { format: "EPUB" });
  /** Fonts the book obfuscates (META-INF/encryption.xml): left to the desk's fonts. */
  const encrypted = new Set();
  if (zip.has("META-INF/encryption.xml")) {
    for (const ref of all(xml(await zip.text("META-INF/encryption.xml")), "CipherReference")) {
      const uri = resolvePath("", ref.getAttribute("URI") ?? "").path;
      if (!/\.(otf|ttf|woff2?)$/i.test(uri))
        throw new Unreadable("This book is protected by DRM.", { format: "EPUB" });
      encrypted.add(uri);
    }
  }
  if (!zip.has("META-INF/container.xml"))
    throw new Unreadable("The EPUB is damaged: it has no container.xml.", { format: "EPUB" });
  const container = xml(await zip.text("META-INF/container.xml"));
  const opfPath = first(container, "rootfile")?.getAttribute("full-path") ?? "";
  if (!zip.has(opfPath))
    throw new Unreadable("The EPUB is damaged: its package document is missing.", {
      format: "EPUB",
    });
  const opf = xml(await zip.text(opfPath));
  const pkg = first(opf, "package");
  const version = Number.parseInt(pkg?.getAttribute("version") ?? "2", 10) >= 3 ? 3 : 2;
  const format = `EPUB ${version}`;
  const title = clean(first(opf, "title")?.textContent);

  /** @type {Map<string, { path: string, type: string, properties: string }>} */
  const manifest = new Map();
  for (const item of all(opf, "item")) {
    const path = resolvePath(opfPath, item.getAttribute("href") ?? "").path;
    manifest.set(item.getAttribute("id") ?? path, {
      path,
      type: item.getAttribute("media-type") ?? mimeOf(path),
      properties: item.getAttribute("properties") ?? "",
    });
  }
  const spine = first(opf, "spine");
  const chapters = all(opf, "itemref")
    .map((ref) => manifest.get(ref.getAttribute("idref") ?? ""))
    .filter((item) => item && zip.has(item.path))
    .map((item) => ({ href: item?.path ?? "", title: "" }));
  if (chapters.length === 0)
    throw new Unreadable("The EPUB is damaged: its spine lists no chapters.", { format });
  const units = new Map(chapters.map((c, i) => [c.href, i]));

  /** An href (already resolved to a package path) as a unit and an anchor. */
  const targetOf = (/** @type {string} */ path, /** @type {string} */ fragment) => {
    const unit = units.get(path);
    if (unit === undefined) return undefined;
    return fragment ? { unit, anchor: fragment } : { unit };
  };

  /** @returns {Toc[]} */
  const navList = (/** @type {Element} */ list, /** @type {string} */ base) =>
    [...list.children]
      .filter((li) => li.localName === "li")
      .flatMap((li) => {
        const label = [...li.children].find((c) => c.localName === "a" || c.localName === "span");
        const sub = [...li.children].find((c) => c.localName === "ol" || c.localName === "ul");
        const children = sub ? navList(sub, base) : [];
        const { path, fragment } = resolvePath(base, label?.getAttribute("href") ?? "");
        const target = label?.getAttribute("href") ? targetOf(path, fragment) : undefined;
        const name = clean(label?.textContent) || "Untitled";
        return target ? [{ title: name, ...target, children }] : children;
      });

  /** @returns {Toc[]} */
  const ncxPoints = (/** @type {Element} */ parent, /** @type {string} */ base) =>
    [...parent.children]
      .filter((p) => p.localName === "navPoint")
      .flatMap((point) => {
        const children = ncxPoints(point, base);
        const { path, fragment } = resolvePath(
          base,
          first(point, "content")?.getAttribute("src") ?? "",
        );
        const target = targetOf(path, fragment);
        const name =
          clean(first(first(point, "navLabel") ?? point, "text")?.textContent) || "Untitled";
        return target ? [{ title: name, ...target, children }] : children;
      });

  /** @type {Toc[]} */
  let toc = [];
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  if (nav && zip.has(nav.path)) {
    const doc = parseMarkup(await zip.text(nav.path));
    const navs = all(doc, "nav");
    const tocNav =
      navs.find((n) =>
        (n.getAttributeNS(OPS, "type") ?? n.getAttribute("epub:type") ?? "")
          .split(/\s+/)
          .includes("toc"),
      ) ?? navs[0];
    const list =
      tocNav && [...tocNav.children].find((c) => c.localName === "ol" || c.localName === "ul");
    if (list) toc = navList(list, nav.path);
  }
  const ncx =
    manifest.get(spine?.getAttribute("toc") ?? "") ??
    [...manifest.values()].find((i) => i.type === "application/x-dtbncx+xml");
  if (toc.length === 0 && ncx && zip.has(ncx.path)) {
    const map = first(xml(await zip.text(ncx.path)), "navMap");
    if (map) toc = ncxPoints(map, ncx.path);
  }
  for (const entry of toc) {
    const chapter = chapters[entry.unit];
    if (chapter && !chapter.title) chapter.title = entry.title;
  }

  /** Every file a chapter or its CSS points at, read once. */
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  const load = async (/** @type {string} */ path) => {
    if (!files.has(path) && zip.has(path))
      files.set(path, await zip.read(path).catch(() => new Uint8Array()));
    return files.get(path);
  };
  const inline = (/** @type {string} */ path) => {
    const bytes = files.get(path);
    return bytes?.length ? dataUrl(manifestType(path), bytes) : undefined;
  };
  const manifestType = (/** @type {string} */ path) =>
    [...manifest.values()].find((i) => i.path === path)?.type ?? mimeOf(path);
  /** Read every package file these hrefs name, so the synchronous resolvers find them. */
  const preload = async (/** @type {string} */ base, /** @type {Iterable<string>} */ hrefs) => {
    for (const href of hrefs) if (!isExternal(href)) await load(resolvePath(base, href).path);
  };
  const cssResolver = (/** @type {string} */ base) => ({
    url: (/** @type {string} */ href) =>
      isExternal(href) ? undefined : inline(resolvePath(base, href).path),
    font: (/** @type {string} */ href) => {
      const path = resolvePath(base, href).path;
      return encrypted.has(path) ? undefined : files.get(path);
    },
  });
  const urlsIn = (/** @type {string} */ css) =>
    [...css.matchAll(/url\(\s*["']?([^"')]+)/gi)].map((m) => m[1] ?? "");

  /** @type {Map<number, Promise<Chapter>>} */
  const cache = new Map();
  /** @returns {Promise<Chapter>} */
  const build = async (/** @type {number} */ i) => {
    const href = chapters[i]?.href ?? "";
    const doc = parseMarkup(await zip.text(href));
    const css = [];
    const fonts = [];
    const sheets = all(doc, "link").filter((l) => /stylesheet/i.test(l.getAttribute("rel") ?? ""));
    const styles = [
      ...sheets.map((l) => ({
        base: resolvePath(href, l.getAttribute("href") ?? "").path,
        text: undefined,
      })),
      ...all(doc, "style").map((s) => ({ base: href, text: s.textContent ?? "" })),
    ];
    for (const sheet of styles) {
      const text =
        sheet.text ??
        (isExternal(sheet.base)
          ? ""
          : new TextDecoder().decode((await load(sheet.base)) ?? new Uint8Array()));
      await preload(sheet.base, urlsIn(text));
      const safe = sanitizeCss(text, cssResolver(sheet.base));
      css.push(safe.css);
      fonts.push(...safe.fonts);
    }
    const body = bodyOf(doc);
    const sources = [
      ...all(body, "img").map((img) => img.getAttribute("src") ?? ""),
      ...all(body, "image").map(
        (img) =>
          img.getAttribute("href") ??
          img.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
          "",
      ),
    ];
    const styled = [...body.querySelectorAll("[style]")].flatMap((el) =>
      urlsIn(el.getAttribute("style") ?? ""),
    );
    await preload(href, [...sources, ...styled]);
    const result = sanitizeHtml(body, {
      image: (src) => (isExternal(src) ? undefined : inline(resolvePath(href, src).path)),
      link: (link) => {
        if (isExternal(link)) return undefined;
        const { path, fragment } = resolvePath(href, link);
        return `${path}${fragment ? `#${fragment}` : ""}`;
      },
      style: cssResolver(href),
    });
    return { html: wrap(body, result.html), css, fonts, text: result.text };
  };
  const chapter = (/** @type {number} */ i) => {
    let found = cache.get(i);
    if (!found) {
      found = build(i);
      cache.set(i, found);
    }
    return found;
  };

  return {
    kind: /** @type {const} */ ("chapters"),
    format,
    title,
    chapters,
    toc: toc.length
      ? toc
      : chapters.map((c, unit) => ({
          title: c.title || `Chapter ${unit + 1}`,
          unit,
          children: [],
        })),
    chapter,
    /** Where an href in chapter `from` goes: its package path (or only a fragment) and anchor. */
    target: (/** @type {string} */ link, /** @type {number} */ from) => {
      if (link.startsWith("#")) return { unit: from, anchor: link.slice(1) };
      const hash = link.indexOf("#");
      return targetOf(hash < 0 ? link : link.slice(0, hash), hash < 0 ? "" : link.slice(hash + 1));
    },
    text: async (/** @type {number} */ i) => (await chapter(i)).text,
  };
}

export { folderOf };
