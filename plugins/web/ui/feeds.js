// Feeds as entries: RSS 0.9x, 1.0 (RDF) and 2.0, and Atom. Each entry's content becomes a page,
// sanitized and drawn like any other; its images are remote and left out. OPML as a tree.
import { isoDate } from "./mime.js";

/**
 * @typedef {import("./formats.js").Entry} Entry
 * @typedef {import("./formats.js").Outline} Outline
 * @typedef {import("./formats.js").Resolver} Resolver
 */

const ATOM = "http://www.w3.org/2005/Atom";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";
const DC = "http://purl.org/dc/elements/1.1/";

/** HTML named entities old feeds use without declaring them. */
const HTML_ENTITIES = /** @type {Record<string, number>} */ ({
  nbsp: 160,
  copy: 169,
  reg: 174,
  trade: 8482,
  mdash: 8212,
  ndash: 8211,
  hellip: 8230,
  lsquo: 8216,
  rsquo: 8217,
  ldquo: 8220,
  rdquo: 8221,
  laquo: 171,
  raquo: 187,
  middot: 183,
  bull: 8226,
  deg: 176,
  euro: 8364,
  pound: 163,
  yen: 165,
  eacute: 233,
  egrave: 232,
  agrave: 224,
  ccedil: 231,
  ouml: 246,
  uuml: 252,
  auml: 228,
  szlig: 223,
});

/** Parse XML; on a parse error, try once more with HTML entities spelled as numbers. */
export function parseXml(/** @type {string} */ text) {
  const parse = (/** @type {string} */ source) => {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
  };
  const doc =
    parse(text) ??
    parse(
      text.replace(/&([a-z]+);/gi, (whole, name) =>
        HTML_ENTITIES[name] ? `&#${HTML_ENTITIES[name]};` : whole,
      ),
    );
  if (!doc) throw new Error("The file is not well-formed XML.");
  return doc;
}

/** The direct children of an element with a local name, in a namespace when one is given. */
const children = (
  /** @type {Element} */ parent,
  /** @type {string} */ name,
  /** @type {string | null} */ ns = null,
) =>
  [...parent.children].filter(
    (el) => el.localName === name && (ns === null || el.namespaceURI === ns),
  );
const first = (
  /** @type {Element} */ parent,
  /** @type {string} */ name,
  /** @type {string | null} */ ns = null,
) => children(parent, name, ns)[0];
const text = (/** @type {Element | undefined} */ el) => el?.textContent?.trim() || undefined;

const escapeHtml = (/** @type {string} */ value) =>
  value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The words of an HTML fragment, for titles marked type="html". */
const words = (/** @type {string} */ html) =>
  new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";

/** @param {string} html @param {string | undefined} link @returns {import("./formats.js").PageInput} */
const pageOf = (html, link) => {
  /** @type {Resolver} */
  const resolver = {
    base: link && /^https?:/i.test(link) ? link : "about:blank",
    load: async (url) => (/^(https?|ftp):/i.test(url) ? "remote" : "missing"),
  };
  return { text: html, mime: "text/html", resolver };
};

/** RSS 0.9x, 1.0 and 2.0: items under the channel (2.0) or next to it (1.0). */
function rss(/** @type {Document} */ doc) {
  const root = doc.documentElement;
  const channel = [...root.children].find((el) => el.localName === "channel");
  const items = [...(channel ? children(channel, "item") : []), ...children(root, "item")];
  /** @type {Entry[]} */
  const entries = items.map((item) => {
    const link = text(first(item, "link"));
    const encoded = text(first(item, "encoded", CONTENT));
    const description = text(first(item, "description"));
    return {
      title: text(first(item, "title")) ?? "(untitled)",
      date: isoDate(text(first(item, "pubDate")) ?? text(first(item, "date", DC))),
      author: text(first(item, "creator", DC)) ?? text(first(item, "author")),
      link,
      page: pageOf(encoded ?? description ?? "", link),
    };
  });
  return { title: (channel && text(first(channel, "title"))) || undefined, entries };
}

/** An Atom text construct as HTML: text escaped, html as it is, xhtml serialized. */
function atomHtml(/** @type {Element | undefined} */ el) {
  if (!el) return "";
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  if (type === "html" || type === "text/html") return el.textContent ?? "";
  if (type === "xhtml") {
    const div = [...el.children].find((child) => child.localName === "div") ?? el;
    const serializer = new XMLSerializer();
    return [...div.childNodes].map((node) => serializer.serializeToString(node)).join("");
  }
  return `<pre style="white-space: pre-wrap">${escapeHtml(el.textContent ?? "")}</pre>`;
}

/** An Atom text construct as plain words. */
const atomText = (/** @type {Element | undefined} */ el) => {
  if (!el) return undefined;
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  return (type === "text" ? text(el) : words(atomHtml(el))) || undefined;
};

function atom(/** @type {Document} */ doc) {
  const feed = doc.documentElement;
  /** @type {Entry[]} */
  const entries = children(feed, "entry", ATOM).map((entry) => {
    const links = children(entry, "link", ATOM);
    const alternate = links.find((l) => (l.getAttribute("rel") ?? "alternate") === "alternate");
    const link = alternate?.getAttribute("href") ?? undefined;
    const author = first(entry, "author", ATOM);
    return {
      title: atomText(first(entry, "title", ATOM)) ?? "(untitled)",
      date: isoDate(text(first(entry, "published", ATOM)) ?? text(first(entry, "updated", ATOM))),
      author: author ? text(first(author, "name", ATOM)) : undefined,
      link,
      page: pageOf(atomHtml(first(entry, "content", ATOM) ?? first(entry, "summary", ATOM)), link),
    };
  });
  return { title: atomText(first(feed, "title", ATOM)), entries };
}

/** RSS or Atom, by the root element. */
export function readFeed(/** @type {string} */ source) {
  const doc = parseXml(source);
  const root = doc.documentElement.localName;
  if (root === "feed") return atom(doc);
  if (root === "rss" || root === "RDF") return rss(doc);
  throw new Error(`The feed's root element is <${root}>, not <rss> or <feed>.`);
}

/** OPML: the body's outlines, nested, with their feed (xmlUrl) and page (htmlUrl, url) addresses. */
export function readOpml(/** @type {string} */ source) {
  const doc = parseXml(source);
  if (doc.documentElement.localName !== "opml") throw new Error("The file is not an OPML outline.");
  const head = first(doc.documentElement, "head");
  const body = first(doc.documentElement, "body");
  /** @returns {Outline[]} */
  const outlines = (/** @type {Element | undefined} */ parent) =>
    (parent ? children(parent, "outline") : []).map((el) => {
      const attr = (/** @type {string} */ name) => el.getAttribute(name) || undefined;
      const feed = attr("xmlUrl");
      const page = attr("htmlUrl") ?? attr("url");
      return {
        text: attr("text") ?? attr("title") ?? "(untitled)",
        ...(feed ? { feed } : {}),
        ...(page ? { page } : {}),
        children: outlines(el),
      };
    });
  return { title: head ? text(first(head, "title")) : undefined, outlines: outlines(body) };
}
