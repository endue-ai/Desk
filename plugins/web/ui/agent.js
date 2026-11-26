// Read saved source without drawing it, opening its links or resolving its resources.

/** @typedef {import("./formats.js").Model} Model */
/** @typedef {import("./formats.js").Entry} Entry */
/** @typedef {import("./formats.js").Outline} Outline */
/** @typedef {{ from?: number, chars?: number }} Range */

const SOURCE = "saved-web-content";
const DEFAULT_CHARS = 4000;
const MAX_CHARS = 20000;
const ENTRY_PAGE = 25;
const OMIT =
  "head,title,script,style,noscript,template,iframe,object,embed,[hidden],[aria-hidden=true],input[type=hidden]";
const BLOCKS =
  "address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,p,pre,section,table,tr";

/**
 * A template has an inert document: saved markup never becomes part of the plugin page.
 * @param {import("./formats.js").PageInput} page
 */
function pageText({ text, mime }) {
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(mime)) return text;
  const template = document.createElement("template");
  template.innerHTML = text;
  for (const element of template.content.querySelectorAll(OMIT)) element.remove();
  for (const element of template.content.querySelectorAll("[style]")) {
    const style = /** @type {HTMLElement} */ (element).style;
    if (style?.display === "none" || style?.visibility === "hidden") element.remove();
  }
  for (const element of template.content.querySelectorAll(BLOCKS)) element.append("\n");
  return (template.content.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** @param {string} text @param {Range} range */
function part(text, { from = 0, chars = DEFAULT_CHARS }) {
  const limit = Math.min(MAX_CHARS, Math.max(1, chars));
  let length = 0;
  let content = "";
  for (const character of text) {
    if (length >= from && length < from + limit) content += character;
    length++;
  }
  const more = from + limit;
  return { text: content, from, length, ...(more < length ? { more } : {}) };
}

/** @param {Outline[]} outlines @returns {Generator<string>} */
function* outlineLines(outlines) {
  for (const { text, feed, page, children } of outlines) {
    yield [text, feed, page].filter(Boolean).join(" — ");
    yield* outlineLines(children);
  }
}

/** @param {Entry} entry @param {number} index */
function entrySummary({ title, link, date, author }, index) {
  return { index, title, link, date, author };
}

/** @param {Model} model @param {Range} range */
export function readSaved(model, range = {}) {
  const file = { source: SOURCE, kind: model.kind, format: model.format };
  switch (model.kind) {
    case "page":
      return { ...file, ...part(pageText(model.page), range) };
    case "card":
      return { ...file, title: model.title, url: model.url, path: model.path };
    case "entries": {
      const from = range.from ?? 0;
      const end = Math.min(model.entries.length, from + ENTRY_PAGE);
      return {
        ...file,
        title: model.title,
        length: model.entries.length,
        entries: model.entries
          .slice(from, end)
          .map((entry, offset) => entrySummary(entry, from + offset)),
        ...(end < model.entries.length ? { more: end } : {}),
      };
    }
    case "outline":
      return {
        ...file,
        title: model.title,
        ...part([...outlineLines(model.outlines)].join("\n"), range),
      };
    case "details":
      return { ...file, reason: model.reason };
  }
}

/** @param {Model} model @param {number} index */
export function readEntry(model, index) {
  const entry = model.kind === "entries" && Number.isSafeInteger(index) && model.entries[index];
  if (!entry) throw new Error("The open Web file has no entry at that index.");
  const text = entry.page ? pageText(entry.page) : (entry.text ?? "");
  return { source: SOURCE, ...entrySummary(entry, index), ...part(text, { chars: MAX_CHARS }) };
}
