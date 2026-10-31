// The parts of the surface that are not a page: the entries list (feed items, WARC records, MAFF
// pages), a link file's card, an OPML outline and a file's details. Each is built from text with
// textContent and attributes only: nothing here is parsed as markup.

/**
 * @typedef {import("./formats.js").Entry} Entry
 * @typedef {import("./formats.js").Card} Card
 * @typedef {import("./formats.js").Outline} Outline
 */

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A date for people, from the ISO string the model keeps. */
export const shownDate = (/** @type {string | undefined} */ iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : when.format(date);
};

/** @param {Document} doc @param {string} tag @param {string} [className] @param {string} [text] */
const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The list of entries, one button each; Up and Down (Home, End) move between them and select.
 * @param {Document} doc @param {HTMLElement} list @param {Entry[]} entries @param {(index: number) => void} select
 */
export function renderEntries(doc, list, entries, select) {
  const buttons = entries.map((entry, index) => {
    const item = el(doc, "li");
    const button = /** @type {HTMLButtonElement} */ (el(doc, "button", "entry"));
    button.type = "button";
    button.dataset.index = String(index);
    const meta = [shownDate(entry.date), entry.author, entry.detail].filter(Boolean).join(" · ");
    button.append(el(doc, "span", "entry-title", entry.title));
    if (meta) button.append(el(doc, "span", "entry-meta", meta));
    button.addEventListener("click", () => select(index));
    item.append(button);
    return item;
  });
  list.replaceChildren(...buttons);
  list.onkeydown = (event) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    const step = keys[/** @type {keyof typeof keys} */ (event.key)];
    const at = Number(/** @type {HTMLElement} */ (event.target).dataset?.index);
    if (step === undefined || Number.isNaN(at) || event.metaKey || event.ctrlKey || event.altKey)
      return;
    event.preventDefault();
    const next = Math.max(
      0,
      Math.min(
        entries.length - 1,
        Number.isFinite(step) ? at + step : step < 0 ? 0 : entries.length - 1,
      ),
    );
    select(next);
    /** @type {HTMLElement | null} */ (list.querySelector(`[data-index="${next}"]`))?.focus();
  };
}

/** Mark the selected entry. */
export function markEntry(/** @type {HTMLElement} */ list, /** @type {number} */ index) {
  for (const button of list.querySelectorAll("button.entry")) {
    const on = button.getAttribute("data-index") === String(index);
    button.setAttribute("aria-current", on ? "true" : "false");
  }
}

/**
 * A link file's card: its title, its target as selectable text, its fields, and a button that
 * opens a local target.
 * @param {Document} doc @param {HTMLElement} section @param {Card} card @param {(path: string) => void} open
 */
export function renderCard(doc, section, card, open) {
  const title = el(doc, "h2", "", card.title);
  title.id = "card-title";
  const parts = [title];
  if (card.url) parts.push(el(doc, "p", "card-target", card.url));
  else if (card.path) parts.push(el(doc, "p", "card-target", card.path));
  const list = el(doc, "dl", "fields");
  for (const [name, value] of card.fields)
    list.append(el(doc, "dt", "", name), el(doc, "dd", "", value));
  parts.push(list);
  if (card.path) {
    const path = card.path;
    const button = /** @type {HTMLButtonElement} */ (
      el(doc, "button", "open", `Open ${path.slice(path.lastIndexOf("/") + 1)}`)
    );
    button.type = "button";
    button.addEventListener("click", () => open(path));
    parts.push(button);
  } else if (card.url && !/^file:/i.test(card.url))
    parts.push(
      el(doc, "p", "note", "Opening a browser is not available yet: copy the address to open it."),
    );
  section.replaceChildren(...parts);
}

/** An OPML outline as nested lists, with each outline's feed and page addresses. */
export function renderOutline(
  /** @type {Document} */ doc,
  /** @type {HTMLElement} */ section,
  /** @type {string | undefined} */ title,
  /** @type {Outline[]} */ outlines,
) {
  const list = (/** @type {Outline[]} */ items) => {
    const ul = el(doc, "ul");
    for (const item of items) {
      const li = el(doc, "li");
      li.append(el(doc, "span", "outline-text", item.text));
      if (item.feed) li.append(el(doc, "span", "outline-url", `Feed: ${item.feed}`));
      if (item.page) li.append(el(doc, "span", "outline-url", `Page: ${item.page}`));
      if (item.children.length) li.append(list(item.children));
      ul.append(li);
    }
    return ul;
  };
  const heading = el(doc, "h2", "", title || "Outline");
  section.replaceChildren(
    heading,
    outlines.length ? list(outlines) : el(doc, "p", "", "The outline is empty."),
  );
}

/** The details of a file Web cannot show: its name, size, detected format and why. */
export function renderDetails(
  /** @type {Document} */ doc,
  /** @type {HTMLElement} */ section,
  /** @type {{ name: string, size: number, format: string, reason: string }} */ file,
) {
  const list = el(doc, "dl", "fields");
  const size =
    file.size < 1024
      ? `${file.size} bytes`
      : file.size < 1048576
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / 1048576).toFixed(1)} MB`;
  for (const [name, value] of [
    ["Name", file.name],
    ["Size", size],
    ["Format", file.format],
  ])
    list.append(el(doc, "dt", "", name), el(doc, "dd", "", value));
  section.replaceChildren(
    el(doc, "h2", "", "This file cannot be shown"),
    list,
    el(doc, "p", "reason", file.reason),
  );
}
