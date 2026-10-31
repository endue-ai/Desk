// The allowlist sanitizer (ADR 0044). It walks a tree parsed into an inert document (DOMParser) and
// builds a new one in the plugin's document from fresh elements: only allowed elements and
// attributes are copied, every URL passes the policy, and nothing is ever parsed from markup into
// the live document. What is built is what is drawn, so markup that re-parses differently cannot
// change it afterwards.
import {
  DROP,
  GLOBAL,
  HTML,
  HTML_ATTRS,
  HTML_NS,
  INPUT_TYPES,
  MATHML,
  MATHML_ATTRS,
  MATHML_NS,
  RENAME,
  SVG,
  SVG_ATTRS,
  SVG_NS,
  XLINK_NS,
  XML_NS,
} from "./allow.js";
import { isImageData } from "./bytes.js";
import { cleanStyle } from "./css.js";

/**
 * What the sanitizer asks about URLs and styles. Each answer is the value to keep, or null.
 * @typedef {{
 *   link(value: string): string | null,
 *   image(element: Element, attribute: string): string | null,
 *   style(element: Element, value: string): string | null,
 * }} Policy
 */

/** Link schemes a page may keep; clicks on them are the view's, never the browser's. */
const LINKS = new Set(["http:", "https:", "mailto:", "file:"]);

/** The default policy: links resolved against `base`, images only as data: URLs already there. */
export function basePolicy(base = "about:blank") {
  /** @type {Policy} */
  const policy = {
    link: (value) => {
      const trimmed = value.trim();
      if (trimmed.startsWith("#")) return trimmed;
      try {
        const url = new URL(trimmed, base);
        return LINKS.has(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    },
    image: (element, attribute) => {
      const value = (element.getAttribute(attribute) ?? "").trim();
      return isImageData(value) ? value : null;
    },
    style: (_element, value) =>
      cleanStyle(value, {
        url: (ref) => (ref.trim().startsWith("#") || isImageData(ref.trim()) ? ref.trim() : null),
      }) || null,
  };
  return policy;
}

/** Whether every url() in a presentation attribute is a reference inside the page (#id). */
const localUrls = (/** @type {string} */ value) => {
  if (value.includes("\\")) return false;
  const all = value.match(/url\s*\(/gi)?.length ?? 0;
  return all === [...value.matchAll(/url\s*\(\s*(['"]?)#[^)'"]*\1\s*\)/gi)].length;
};

/** A frame is never drawn: a box says so, and links to what it would have shown. */
function framePlaceholder(
  /** @type {Element} */ frame,
  /** @type {Document} */ target,
  /** @type {Policy} */ policy,
) {
  const src = frame.getAttribute("src")?.trim();
  const link = src ? policy.link(src) : null;
  const box = target.createElement(link ? "a" : "span");
  box.className = "web-frame";
  if (link) box.setAttribute("href", link);
  box.textContent = src ? `Frame not drawn: ${src}` : "Embedded frame not drawn";
  return box;
}

/** @param {Element} element */
const spaceOf = (element) =>
  element.namespaceURI === SVG_NS
    ? "svg"
    : element.namespaceURI === MATHML_NS
      ? "math"
      : element.namespaceURI === HTML_NS
        ? "html"
        : "other";

/**
 * The copy of one attribute, or null to leave it out.
 * @param {Element} element @param {Attr} attr @param {"html" | "svg" | "math"} space @param {Policy} policy
 * @returns {[string, string] | null}
 */
function attribute(element, attr, space, policy) {
  const tag = element.localName.toLowerCase();
  let name = attr.localName;
  if (attr.namespaceURI === XLINK_NS && name === "href") name = "href";
  else if (attr.namespaceURI === XML_NS && name === "lang") name = "lang";
  else if (attr.namespaceURI !== null) return null;
  if (space === "html") name = name.toLowerCase();
  if (/^on/i.test(name) || !/^[A-Za-z][\w.-]*$/.test(name)) return null;
  const value = attr.value;
  const allowed =
    space === "html"
      ? GLOBAL.has(name) || /^(aria|data)-[\w.-]+$/.test(name) || HTML_ATTRS[tag]?.has(name)
      : space === "svg"
        ? SVG_ATTRS.has(name) || /^aria-[\w-]+$/.test(name)
        : MATHML_ATTRS.has(name);
  if (!allowed) return null;
  if (name === "style") {
    const style = policy.style(element, value);
    return style ? [name, style] : null;
  }
  if (name === "tabindex") return [name, Number(value) < 0 ? "-1" : "0"];
  if (space === "svg") {
    if (name === "href") {
      if (tag === "image") {
        const image = policy.image(element, attr.name);
        return image ? [name, image] : null;
      }
      return value.trim().startsWith("#") ? [name, value.trim()] : null;
    }
    return /url\s*\(/i.test(value) && !localUrls(value) ? null : [name, value];
  }
  if (name === "href") {
    const link = policy.link(value);
    return link ? [name, link] : null;
  }
  if (name === "src" || name === "poster" || name === "background") {
    if (tag === "input" && (element.getAttribute("type") ?? "").toLowerCase() !== "image")
      return null;
    const image = policy.image(element, name);
    return image ? [name, image] : null;
  }
  if (name === "type" && tag === "input" && !INPUT_TYPES.has(value.trim().toLowerCase()))
    return null;
  return [name, value];
}

/**
 * Copy `source`'s children into `into`, sanitized, as nodes of `target`.
 * @param {{ childNodes: ArrayLike<Node> }} source a node of an inert document, or its children
 * @param {Document} target the document the copy is drawn in
 * @param {Node} into
 * @param {Policy} policy
 */
export function sanitizeInto(source, target, into, policy) {
  /** @type {Array<[Node, Node]>} */
  const stack = [...source.childNodes]
    .reverse()
    .map((node) => /** @type {[Node, Node]} */ ([node, into]));
  while (stack.length > 0) {
    const [node, parent] = /** @type {[Node, Node]} */ (stack.pop());
    if (node.nodeType === 3 || node.nodeType === 4) {
      parent.appendChild(target.createTextNode(/** @type {CharacterData} */ (node).data));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = /** @type {Element} */ (node);
    const space = spaceOf(element);
    const tag = element.localName.toLowerCase();
    if (space === "html" && (tag === "iframe" || tag === "frame")) {
      parent.appendChild(framePlaceholder(element, target, policy));
      continue;
    }
    if (DROP.has(tag)) continue;
    const descend = (/** @type {Node} */ copy) => {
      for (let i = element.childNodes.length - 1; i >= 0; i--) {
        const child = element.childNodes[i];
        if (child) stack.push([child, copy]);
      }
    };
    const kept =
      space === "html"
        ? HTML.has(tag) || tag in RENAME
        : space === "svg"
          ? SVG.has(element.localName)
          : space === "math" && MATHML.has(tag);
    if (
      !kept ||
      (tag === "input" &&
        !INPUT_TYPES.has((element.getAttribute("type") ?? "text").trim().toLowerCase()))
    ) {
      if (tag !== "input" && tag !== "video") descend(parent);
      continue;
    }
    const copy =
      space === "html"
        ? target.createElement(RENAME[tag] ?? tag)
        : target.createElementNS(space === "svg" ? SVG_NS : MATHML_NS, element.localName);
    for (const attr of element.attributes) {
      const copied = attribute(
        element,
        attr,
        /** @type {"html" | "svg" | "math"} */ (space),
        policy,
      );
      if (copied) copy.setAttribute(copied[0], copied[1]);
    }
    parent.appendChild(copy);
    if (tag !== "video") descend(copy);
  }
}

/**
 * Sanitize an HTML fragment into a DocumentFragment of `target`. Style sheets are left out here:
 * a page's sheets are cleaned and placed by page.js.
 * @param {string} html @param {Document} target @param {Policy} [policy]
 */
export function sanitizeHtml(html, target, policy = basePolicy()) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = target.createDocumentFragment();
  sanitizeInto(doc.body, target, fragment, policy);
  return fragment;
}
