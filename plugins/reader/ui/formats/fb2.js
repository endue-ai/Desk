// FictionBook 2: the main body's top-level sections are chapters (the notes and other bodies one
// each, a cover first when there is one), titles become headings, nested sections the contents
// panel's children, notes links jump, and <binary> images are inlined as data: URLs. The HTML is
// written here from FB2's own small vocabulary, escaped, so nothing from the file runs.
import { ascii } from "./bytes.js";
import { Unreadable } from "./errors.js";

/** @typedef {import("./toc.js").Toc} Toc */

const CSS = `.body { line-height: 1.6; }
.image { text-align: center; } .image img { max-width: 100%; }
.poem { margin: 1em 2em; } .stanza { margin: 0.8em 0; } .verse { margin: 0; }
.epigraph { margin: 1em 0 1em 30%; font-style: italic; } .author { text-align: right; font-style: italic; }
.subtitle { text-align: center; } .empty { margin: 0; height: 1em; }`;

const esc = (/** @type {string} */ s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (/** @type {string | null | undefined} */ s) => (s ?? "").replace(/\s+/g, " ").trim();
const kids = (/** @type {Element} */ el, /** @type {string} */ name) =>
  [...el.children].filter((c) => c.localName === name);
const hrefOf = (/** @type {Element} */ el) =>
  el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
  el.getAttribute("l:href") ??
  el.getAttribute("xlink:href") ??
  el.getAttribute("href") ??
  "";

/** A section without a title is named by its first paragraph, when that is short (as calibre writes). */
const lead = (/** @type {Element} */ section) => {
  const text = clean(kids(section, "p")[0]?.textContent);
  return text.length <= 80 ? text : "";
};

/** The text of an FB2 file in the encoding its XML declaration names (often windows-1251). */
function textOf(/** @type {Uint8Array} */ bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const declared = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(ascii(bytes, 0, 200))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** @param {Uint8Array} bytes */
export function readFb2(bytes) {
  const doc = new DOMParser().parseFromString(textOf(bytes), "application/xml");
  const root = doc.documentElement;
  if (root?.localName !== "FictionBook" || doc.getElementsByTagName("parsererror").length)
    throw new Unreadable("The FB2 file is damaged: its XML does not parse.", { format: "FB2" });
  const info = root.getElementsByTagNameNS("*", "title-info")[0];
  const title = clean(info?.getElementsByTagNameNS("*", "book-title")[0]?.textContent);
  /** @type {Map<string, string>} */
  const images = new Map();
  for (const binary of kids(root, "binary")) {
    const data = (binary.textContent ?? "").replace(/\s+/g, "");
    images.set(
      binary.getAttribute("id") ?? "",
      `data:${binary.getAttribute("content-type") ?? "image/jpeg"};base64,${data}`,
    );
  }
  /** id -> unit, for notes links and the contents panel. */
  /** @type {Map<string, number>} */
  const ids = new Map();
  let generated = 0;

  /** @param {Element} el @param {number} unit @param {number} depth @returns {string} */
  const html = (el, unit, depth) =>
    [...el.childNodes]
      .map((node) => {
        if (node.nodeType === 3 || node.nodeType === 4) return esc(node.nodeValue ?? "");
        if (node.nodeType !== 1) return "";
        const c = /** @type {Element} */ (node);
        const id = c.getAttribute("id");
        if (id) ids.set(id, unit);
        const idAttr = id ? ` id="${esc(id)}"` : "";
        const inner = () => html(c, unit, depth);
        switch (c.localName) {
          case "section": {
            const sid = id ?? `fb2-${++generated}`;
            ids.set(sid, unit);
            c.setAttribute("id", sid);
            return `<section id="${esc(sid)}">${html(c, unit, depth + 1)}</section>`;
          }
          case "title": {
            const level = Math.min(6, depth);
            return `<h${level}${idAttr}>${kids(c, "p")
              .map((p) => html(p, unit, depth))
              .join("<br>")}</h${level}>`;
          }
          case "p":
            return `<p${idAttr}>${inner()}</p>`;
          case "emphasis":
            return `<em>${inner()}</em>`;
          case "strong":
            return `<strong>${inner()}</strong>`;
          case "strikethrough":
            return `<s>${inner()}</s>`;
          case "sub":
          case "sup":
          case "code":
            return `<${c.localName}>${inner()}</${c.localName}>`;
          case "style":
            return `<span>${inner()}</span>`;
          case "a": {
            const href = hrefOf(c);
            const note = c.getAttribute("type") === "note" ? ' class="note"' : "";
            if (href.startsWith("#")) return `<a href="${esc(href)}"${note}>${inner()}</a>`;
            if (/^(https?|mailto):/i.test(href))
              return `<a class="external" title="${esc(href)}">${inner()}</a>`;
            return inner();
          }
          case "image": {
            const src = images.get(hrefOf(c).replace(/^#/, ""));
            if (!src) return "";
            const img = `<img src="${esc(src)}" alt="${esc(c.getAttribute("alt") ?? c.getAttribute("title") ?? "")}">`;
            return el.localName === "p" ? img : `<p class="image"${idAttr}>${img}</p>`;
          }
          case "empty-line":
            return '<p class="empty"></p>';
          case "poem":
          case "stanza":
            return `<div class="${c.localName}"${idAttr}>${inner()}</div>`;
          case "v":
            return `<p class="verse">${inner()}</p>`;
          case "epigraph":
          case "cite":
            return `<blockquote class="${c.localName}"${idAttr}>${inner()}</blockquote>`;
          case "text-author":
            return `<p class="author">${inner()}</p>`;
          case "subtitle":
            return `<p class="subtitle"><strong>${inner()}</strong></p>`;
          case "table":
          case "tr":
          case "td":
          case "th":
            return `<${c.localName}>${inner()}</${c.localName}>`;
          case "annotation":
            return `<div class="annotation">${inner()}</div>`;
          default:
            return inner();
        }
      })
      .join("");

  /** @returns {Toc[]} */
  const tocOf = (/** @type {Element} */ section, /** @type {number} */ unit) =>
    kids(section, "section").map((sub) => {
      const anchor = sub.getAttribute("id") ?? "";
      const name = clean(kids(sub, "title")[0]?.textContent) || "Untitled";
      return { title: name, unit, ...(anchor ? { anchor } : {}), children: tocOf(sub, unit) };
    });

  /** @type {Array<{ title: string, html: string, text: string, toc: Toc[] }>} */
  const parts = [];
  const cover = info
    ?.getElementsByTagNameNS("*", "coverpage")[0]
    ?.getElementsByTagNameNS("*", "image")[0];
  const coverSrc = cover && images.get(hrefOf(cover).replace(/^#/, ""));
  if (coverSrc)
    parts.push({
      title: "Cover",
      html: `<p class="image"><img src="${esc(coverSrc)}" alt="Cover"></p>`,
      text: "",
      toc: [],
    });
  const bodies = kids(root, "body");
  for (const [b, body] of bodies.entries()) {
    const sections = kids(body, "section");
    const named = b > 0 || body.getAttribute("name");
    if (sections.length === 0 || named) {
      const unit = parts.length;
      const name =
        clean(kids(body, "title")[0]?.textContent) ||
        (body.getAttribute("name") === "notes" ? "Notes" : title || "Text");
      const wrapper = body.ownerDocument.createElementNS(body.namespaceURI, "section");
      for (const child of [...body.childNodes])
        if (named || child.nodeName !== "title") wrapper.append(child.cloneNode(true));
      const markup = html(wrapper, unit, 1);
      parts.push({ title: name, html: markup, text: clean(wrapper.textContent), toc: [] });
      continue;
    }
    for (const section of sections) {
      const unit = parts.length;
      const markup = html(section, unit, 1);
      const name =
        clean(kids(section, "title")[0]?.textContent) || lead(section) || `Chapter ${unit + 1}`;
      parts.push({
        title: name,
        html: markup,
        text: clean(section.textContent),
        toc: tocOf(section, unit),
      });
    }
  }
  if (parts.length === 0) throw new Unreadable("The FB2 file has no text.", { format: "FB2" });

  return {
    kind: /** @type {const} */ ("chapters"),
    format: "FB2",
    title,
    chapters: parts.map((p) => ({ title: p.title })),
    toc: parts.map((p, unit) => ({ title: p.title, unit, children: p.toc })),
    chapter: async (/** @type {number} */ i) => ({
      html: `<div class="body">${parts[i]?.html ?? ""}</div>`,
      css: [CSS],
      fonts: [],
    }),
    target: (/** @type {string} */ href, /** @type {number} */ from) => {
      const anchor = href.replace(/^#/, "");
      const unit = ids.get(anchor);
      return unit === undefined
        ? href.startsWith("#")
          ? { unit: from, anchor }
          : undefined
        : { unit, anchor };
    },
    text: async (/** @type {number} */ i) => parts[i]?.text ?? "",
  };
}
