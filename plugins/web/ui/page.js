// A page drawn safely: parsed into an inert document, its resources gathered, sanitized into fresh
// nodes of the plugin's document under <web-html> and <web-body>, with its cleaned sheets first.
// The view puts the result in a shadow root; nothing on the page runs or reaches the network.
import { isImageData } from "./bytes.js";
import { BUDGET, collect } from "./resources.js";
import { basePolicy, sanitizeInto } from "./sanitize.js";

export { BUDGET };

/**
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./resources.js").Left} Left
 * @typedef {{ root: DocumentFragment, title: string, left: Left, empty: boolean }} PreparedPage
 */

/** The browser's defaults the page builds on, for the wrappers that stand in for html and body. */
const BASE_CSS = `web-html { display: block; min-height: 100%; background: #fff; color: #000;
  color-scheme: light; font: 16px "Times New Roman", Times, serif; text-align: start; }
web-body { display: block; margin: 8px; }
.web-frame { display: block; margin: 4px 0; padding: 8px; border: 1px dashed #888; color: #555;
  font: 13px system-ui, sans-serif; }`;

/** Parse as the page says: XHTML as XML (HTML when it is not well-formed), the rest as HTML. */
export function parse(/** @type {string} */ text, /** @type {string} */ mime) {
  const parser = new DOMParser();
  if (mime === "application/xhtml+xml") {
    const doc = parser.parseFromString(text, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length === 0 && doc.documentElement) return doc;
  }
  return parser.parseFromString(text, "text/html");
}

/** The colour a legacy attribute (bgcolor, text) names, when it is only a colour. */
const colour = (/** @type {string | null} */ value) =>
  value && /^#?[0-9a-z]{1,20}$/i.test(value.trim()) ? value.trim() : undefined;

/**
 * @param {PageInput} input
 * @param {Document} target the plugin's document
 * @param {{ budget?: number }} [options]
 * @returns {Promise<PreparedPage>}
 */
export async function preparePage(input, target, options = {}) {
  const doc = parse(input.text, input.mime);
  const collected = await collect(doc, input.resolver, options.budget);
  const links = basePolicy(input.resolver.base);
  /** @type {import("./sanitize.js").Policy} */
  const policy = {
    link: links.link,
    image: (element, attribute) => {
      const own = (element.getAttribute(attribute) ?? "").trim();
      return collected.picture(element) ?? (isImageData(own) ? own : null);
    },
    style: (element) => collected.style(element) || null,
  };

  const root = target.createDocumentFragment();
  for (const css of [BASE_CSS, ...collected.sheets]) {
    const style = target.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  const html = target.createElement("web-html");
  const body = target.createElement("web-body");
  const wrap = (/** @type {Element | null} */ from, /** @type {Element} */ to) => {
    if (!from) return;
    for (const name of ["id", "class", "lang", "dir"]) {
      const value = from.getAttribute(name);
      if (value !== null) to.setAttribute(name, value);
    }
    const lang = from.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang");
    if (lang && !to.hasAttribute("lang")) to.setAttribute("lang", lang);
    const legacy = [
      colour(from.getAttribute("bgcolor")) &&
        `background-color: ${colour(from.getAttribute("bgcolor"))}`,
      colour(from.getAttribute("text")) && `color: ${colour(from.getAttribute("text"))}`,
      from.hasAttribute("background") &&
        policy.image(from, "background") &&
        `background-image: url("${policy.image(from, "background")}")`,
      policy.style(from, from.getAttribute("style") ?? ""),
    ].filter(Boolean);
    if (legacy.length) to.setAttribute("style", legacy.join("; "));
  };
  const content = doc.body ?? doc.documentElement;
  wrap(doc.documentElement, html);
  if (doc.body && doc.body !== doc.documentElement) wrap(doc.body, body);
  html.append(body);
  root.append(html);
  if (content === doc.documentElement && !doc.body)
    sanitizeInto({ childNodes: [content] }, target, body, policy);
  else sanitizeInto(content, target, body, policy);
  const empty =
    !body.textContent?.trim() &&
    !body.querySelector("img, svg, input, button, select, textarea, video, hr, table");
  return { root, title: doc.title?.trim() ?? "", left: collected.left, empty };
}
