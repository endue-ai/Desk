// A book's (X)HTML, rewritten from an allowlist before it reaches a chapter's shadow root: no
// scripts, no event handler attributes, no frames, forms or media, no remote URLs. Images come
// from the book as data: URLs; links inside the book keep their package path (the view follows
// them); links out of it lose their href and keep the address as a title. Unknown elements are
// unwrapped, so their text stays. The result is serialised here, escaped, as HTML.
import { sanitizeStyle } from "./css.js";

/**
 * @typedef {{ image(src: string): string | undefined, link(href: string): string | undefined,
 *   style: import("./css.js").CssResolver }} Resolver
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";

const words = (/** @type {string} */ list) => new Set(list.split(/\s+/).filter(Boolean));

/** Dropped with everything inside them. */
const DROP = words(`script style noscript template iframe frame frameset object embed applet form
  input button select textarea option optgroup datalist output link meta base title head audio video
  source track canvas param map area portal dialog slot`);

const HTML =
  words(`a abbr address article aside b bdi bdo big blockquote br caption center cite code
  col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header
  hgroup hr i img ins kbd label li main mark nav ol p pre q rb rp rt rtc ruby s samp section small span
  strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr`);

const SVG =
  words(`svg g path rect circle ellipse line polyline polygon text tspan textPath image defs
  linearGradient radialGradient stop title desc clipPath mask pattern symbol use`);

const MATH = words(`math mi mo mn ms mtext mspace mrow mfrac msqrt mroot msup msub msubsup munder
  mover munderover mtable mtr mtd mstyle mpadded mphantom menclose semantics mmultiscripts mprescripts none`);

const VOID = words("br col hr img wbr");

const ATTRIBUTES =
  words(`id class title lang dir colspan rowspan align valign width height alt start
  type reversed value datetime abbr scope headers span border cellpadding cellspacing color face size
  role summary nowrap`);

const SVG_ATTRIBUTES = words(`viewBox d fill stroke stroke-width stroke-linecap stroke-linejoin
  stroke-dasharray stroke-opacity fill-opacity fill-rule opacity transform x y x1 y1 x2 y2 cx cy r rx
  ry fx fy points width height preserveAspectRatio offset stop-color stop-opacity font-size font-family
  font-weight font-style text-anchor dominant-baseline gradientUnits gradientTransform patternUnits
  patternTransform clipPathUnits clip-rule dx dy version`);

const MATH_ATTRIBUTES = words(`display mathvariant mathsize mathcolor mathbackground displaystyle
  scriptlevel fence separator stretchy symmetric largeop movablelimits accent accentunder lspace
  rspace linethickness columnalign rowalign columnspan rowspan notation encoding`);

const BLOCK = words(
  "p div h1 h2 h3 h4 h5 h6 li dt dd blockquote pre tr section article br hr figcaption",
);

const escapeText = (/** @type {string} */ s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (/** @type {string} */ s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Only internal fragments: `url(#id)` keeps SVG paints and clips working, nothing else loads. */
const svgValue = (/** @type {string} */ value) =>
  /url\(\s*['"]?(?!#)/i.test(value) ? "none" : value;

/**
 * @param {Element} element
 * @param {"html" | "svg" | "math"} space
 * @param {Resolver} resolve
 * @returns {Array<[string, string]> | undefined} undefined drops the element
 */
function attributesOf(element, space, resolve) {
  const name = element.localName;
  /** @type {Array<[string, string]>} */
  const out = [];
  const classes = [];
  for (const attribute of element.attributes) {
    const key = attribute.name;
    const local = attribute.localName;
    const value = attribute.value;
    if (/^on/i.test(local) || /^\s*(javascript|vbscript):/i.test(value)) continue;
    if (local === "style") out.push(["style", sanitizeStyle(value, resolve.style)]);
    else if (key === "xml:lang") out.push(["lang", value]);
    else if (key === "epub:type" || (local === "type" && attribute.namespaceURI?.includes("idpf")))
      out.push(["data-epub-type", value]);
    else if (local === "class") classes.push(value);
    else if (local === "name" && name === "a") out.push(["id", value]);
    else if (local === "aid") out.push(["data-aid", value]);
    else if (local === "href" || local === "src") continue;
    else if (space === "html" && (ATTRIBUTES.has(local) || local.startsWith("aria-")))
      out.push([local, value]);
    else if (space === "svg" && SVG_ATTRIBUTES.has(local)) out.push([local, svgValue(value)]);
    else if (space === "math" && MATH_ATTRIBUTES.has(local)) out.push([local, value]);
  }
  const href =
    element.getAttribute("href") ?? element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  if (name === "img" || (space === "svg" && name === "image")) {
    const src = resolve.image((name === "img" ? element.getAttribute("src") : href) ?? "");
    if (!src) return undefined;
    out.push([name === "img" ? "src" : "href", src]);
  } else if (name === "a" && href) {
    const inside = resolve.link(href);
    if (inside !== undefined) out.push(["href", inside]);
    else if (/^(https?|mailto|ftp):/i.test(href.trim())) {
      out.push(["title", href.trim()]);
      classes.push("external");
    }
  } else if (space === "svg" && name === "use") {
    if (!href?.startsWith("#")) return undefined;
    out.push(["href", href]);
  }
  if (classes.length) out.push(["class", classes.join(" ")]);
  return out;
}

/**
 * @param {Element} root The <body> (or any element) whose contents become the chapter.
 * @param {Resolver} resolve
 * @returns {{ html: string, text: string }}
 */
export function sanitizeHtml(root, resolve) {
  const html = [];
  const text = [];
  /** @param {Node} node @param {"html" | "svg" | "math"} space */
  const walk = (node, space) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const value = child.nodeValue ?? "";
        html.push(escapeText(value));
        text.push(value);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = /** @type {Element} */ (child);
      const ns = element.namespaceURI;
      const local = element.localName;
      const lower = local.toLowerCase();
      const inner =
        ns === SVG_NS || (space === "html" && lower === "svg")
          ? "svg"
          : ns === MATH_NS || lower === "math"
            ? "math"
            : "html";
      const allowed =
        inner === "svg" ? SVG.has(local) : inner === "math" ? MATH.has(lower) : HTML.has(lower);
      if (DROP.has(lower) && !(inner === "svg" && lower === "title")) continue;
      if (!allowed) {
        walk(element, space);
        continue;
      }
      const attributes = attributesOf(element, inner, resolve);
      if (!attributes) continue;
      const tag = inner === "html" ? lower : local;
      const attrs = attributes.map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join("");
      html.push(`<${tag}${attrs}>`);
      if (inner === "html" && VOID.has(lower)) {
        if (lower === "br") text.push("\n");
        continue;
      }
      walk(element, inner);
      html.push(`</${tag}>`);
      if (BLOCK.has(lower)) text.push("\n");
    }
  };
  walk(root, "html");
  return {
    html: html.join(""),
    text: text
      .join("")
      .replace(/[ \t\r\f]+/g, " ")
      .replace(/\n\s*/g, "\n")
      .trim(),
  };
}

/** Parse a book's chapter: as XHTML first, as HTML when it is not well-formed. */
export function parseMarkup(/** @type {string} */ markup) {
  const xml = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  if (!xml.getElementsByTagName("parsererror").length && xml.documentElement) return xml;
  return new DOMParser().parseFromString(markup, "text/html");
}

/** The element a chapter's content is in: its body, or the whole document when it has none. */
export const bodyOf = (/** @type {Document} */ doc) =>
  doc.getElementsByTagNameNS("*", "body")[0] ?? doc.querySelector("body") ?? doc.documentElement;

/** The body's own class and language, for the wrapper that stands in for it. */
export function wrap(/** @type {Element} */ body, /** @type {string} */ html) {
  const cls = escapeAttribute(["body", body.getAttribute("class") ?? ""].join(" ").trim());
  const lang =
    body.getAttribute("xml:lang") ??
    body.getAttribute("lang") ??
    body.ownerDocument.documentElement?.getAttribute("xml:lang") ??
    body.ownerDocument.documentElement?.getAttribute("lang");
  const dir = body.getAttribute("dir") ?? body.ownerDocument.documentElement?.getAttribute("dir");
  return `<div class="${cls}"${lang ? ` lang="${escapeAttribute(lang)}"` : ""}${dir ? ` dir="${escapeAttribute(dir)}"` : ""}>${html}</div>`;
}
