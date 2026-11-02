// A page drawn safely: parsed into an inert document, its resources gathered, sanitized into fresh
// nodes of the plugin's document under <web-html> and <web-body>, with its cleaned sheets first.
// The view puts the result in a shadow root; nothing on the page runs or reaches the network. A
// page over 2 MB is parsed a slice at a time (document.write into an inert document, where the
// browser parses as it goes). Copying goes a slice at a time too, with progress and a signal that
// stops it, and stops after the first 30,000 elements: the rest is copied as the page is scrolled
// to it, so the browser never lays out a whole huge page at once.
import { isImageData } from "./bytes.js";
import { BUDGET, collect } from "./resources.js";
import { basePolicy, sanitizeSteps } from "./sanitize.js";

export { BUDGET };

/**
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./resources.js").Left} Left
 * @typedef {{ root: DocumentFragment, title: string, left: Left, empty: boolean }} PreparedPage
 * @typedef {{ root: DocumentFragment, title: string, left: Left, fill(): Promise<boolean>,
 *   more(): Promise<void>, all(): Promise<void>, done(): boolean }} StartedPage
 *   fill copies the first part of the page into root's body, once, and answers whether it shows
 *   nothing; more copies the next part, all the rest; done tells whether all of it is copied.
 * @typedef {{ signal?: AbortSignal, budget?: number, sliceOver?: number, first?: number,
 *   progress?(label: string, value: number | null, max: number, detail: string): void }} PageOptions
 *   first: the elements copied before the page counts as drawn (30,000).
 */

/** Pages longer than this (in characters) are parsed a slice at a time. */
export const SLICE_OVER = 2 * 1024 * 1024;
const SLICE = 256 * 1024;
const FIRST = 30000;
/** Copying work per task, in milliseconds, before the browser gets a turn to lay out and paint. */
const WORK = 15;

/** The browser's defaults the page builds on, for the wrappers that stand in for html and body. */
const BASE_CSS = `web-html { display: flow-root; min-height: 100%; color: #000; color-scheme: light; font: 16px "Times New Roman", Times, serif; text-align: start; }
web-body { display: block; margin: 8px; }
.web-frame { display: block; margin: 4px 0; padding: 8px; border: 1px dashed #888; color: #555;
  font: 13px system-ui, sans-serif; }`;

/**
 * Give the event loop a turn: a message, which hidden pages do not throttle as they do timers.
 * @returns {Promise<void>}
 */
const pause = () =>
  new Promise((go) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      go();
    };
    channel.port2.postMessage(null);
  });

/** Parse as the page says: XHTML as XML (HTML when it is not well-formed), the rest as HTML. */
export function parse(/** @type {string} */ text, /** @type {string} */ mime) {
  const parser = new DOMParser();
  if (mime === "application/xhtml+xml") {
    const doc = parser.parseFromString(text, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length === 0 && doc.documentElement) return doc;
  }
  return parser.parseFromString(text, "text/html");
}

/** Whether this engine parses document.write a part at a time (browsers do; jsdom does not). */
let incremental;
function writesInParts(/** @type {Document} */ target) {
  if (incremental === undefined) {
    try {
      const doc = target.implementation.createHTMLDocument("");
      doc.open();
      doc.write("<p>a");
      doc.write("b</p>");
      doc.close();
      incremental = doc.body?.textContent === "ab";
    } catch {
      incremental = false;
    }
  }
  return incremental;
}

const count = (/** @type {number} */ n) => n.toLocaleString("en-US");

/**
 * Parse as parse() does, a slice at a time when the text is long: the parser keeps its state
 * between writes, so the tree is the one DOMParser builds. Slices never split a surrogate pair or
 * a CR LF.
 * @param {string} text @param {string} mime @param {Document} target @param {PageOptions} options
 */
async function parseSlowly(text, mime, target, options) {
  const { signal, progress } = options;
  if (text.length <= (options.sliceOver ?? SLICE_OVER)) return parse(text, mime);
  if (mime !== "text/html" || !writesInParts(target)) {
    progress?.("Parsing", null, 1, "");
    await pause();
    return parse(text, mime);
  }
  const doc = target.implementation.createHTMLDocument("");
  doc.open();
  for (let at = 0; at < text.length; ) {
    signal?.throwIfAborted();
    let end = Math.min(text.length, at + SLICE);
    while (end < text.length && /[\uD800-\uDBFF\r]/.test(text[end - 1] ?? "")) end++;
    doc.write(text.slice(at, end));
    at = end;
    progress?.("Parsing", at, text.length, `${count(at)} of ${count(text.length)} characters`);
    await pause();
  }
  doc.close();
  signal?.throwIfAborted();
  return doc;
}

/** Whether a copied body shows nothing: no text but white space, and no picture or control. */
function blank(/** @type {Element} */ body) {
  const doc = /** @type {Document} */ (body.ownerDocument);
  const texts = doc.createTreeWalker(body, 4);
  for (let node = texts.nextNode(); node; node = texts.nextNode())
    if (/** @type {Text} */ (node).data.trim()) return false;
  return !body.querySelector("img, svg, input, button, select, textarea, video, hr, table");
}

/** The colour a legacy attribute (bgcolor, text) names, when it is only a colour. */
const colour = (/** @type {string | null} */ value) =>
  value && /^#?[0-9a-z]{1,20}$/i.test(value.trim()) ? value.trim() : undefined;

/**
 * The page whole: parsed, its resources gathered, and copied.
 * @param {PageInput} input
 * @param {Document} target the plugin's document
 * @param {PageOptions} [options]
 * @returns {Promise<PreparedPage>}
 */
export async function preparePage(input, target, options = {}) {
  const { root, title, left, fill, all } = await startPage(input, target, options);
  const empty = await fill();
  await all();
  return { root, title, left, empty };
}

/**
 * The page parsed, its resources gathered and its sheets and wrappers built; fill() copies it in.
 * The view shows the wrappers first, so a large page appears and fills in while it is copied.
 * @param {PageInput} input
 * @param {Document} target the plugin's document
 * @param {PageOptions} [options]
 * @returns {Promise<StartedPage>}
 */
export async function startPage(input, target, options = {}) {
  const { signal, progress } = options;
  const doc = await parseSlowly(input.text, input.mime, target, options);
  const collected = await collect(doc, input.resolver, options.budget);
  signal?.throwIfAborted();
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
  const source = content === doc.documentElement && !doc.body ? { childNodes: [content] } : content;
  const total = content.getElementsByTagName("*").length;
  const first = options.first ?? FIRST;
  const steps = sanitizeSteps(source, target, body, policy);
  let copied = 0;
  let finished = false;
  /** @type {Promise<void>} */
  let queue = Promise.resolve();
  /** Copy until `until` elements are copied (or all), a few milliseconds of work per task. */
  const pull = (/** @type {number} */ until, report = false) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        let since = performance.now();
        while (!finished && copied < until) {
          const step = steps.next();
          if (step.done) finished = true;
          else copied = step.value;
          if (report) signal?.throwIfAborted();
          if (finished || performance.now() - since < WORK) continue;
          const done = Math.min(copied, total);
          if (report)
            progress?.("Drawing", done, total, `${count(done)} of ${count(total)} elements`);
          await pause();
          since = performance.now();
        }
      });
    return queue;
  };
  /** @type {Promise<boolean> | undefined} */
  let filling;
  const fill = () => {
    filling ??= pull(first, true).then(() => {
      signal?.throwIfAborted();
      return blank(body);
    });
    return filling;
  };
  const more = () => pull(copied + first / 2);
  const all = () => pull(Infinity);
  const done = () => finished;
  return { root, title: doc.title?.trim() ?? "", left: collected.left, fill, more, all, done };
}
