// The two side panels: the outline (headings of levels 1 to 6, each a button that scrolls to it)
// and the comments (author, date and text; selecting one highlights its range in the page).
import { plainText } from "../model.js";

/**
 * @typedef {import("../model.js").Paragraph} Paragraph
 * @typedef {{ id: string, level: number, text: string }} Heading
 */

/** The headings of a document, each with the element id the page view gives it. */
export function headingsOf(/** @type {import("../model.js").DocModel} */ model) {
  /** @type {Map<Paragraph, string>} */
  const ids = new Map();
  /** @type {Heading[]} */
  const list = [];
  for (const section of model.sections)
    for (const block of section.blocks) {
      if (block.type !== "paragraph" || !block.level || block.level > 6) continue;
      const text = plainText([block]).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const id = `docs-h${list.length + 1}`;
      ids.set(block, id);
      list.push({
        id,
        level: block.level,
        text: (block.marker ? `${block.marker} ` : "") + text.slice(0, 160),
      });
    }
  return { ids, list };
}

/**
 * @param {Document} doc
 * @param {HTMLElement} listEl
 * @param {HTMLElement} empty
 * @param {(id: string) => void} go
 */
export function renderOutline(doc, listEl, empty, go) {
  return (/** @type {Heading[]} */ headings) => {
    listEl.replaceChildren(
      ...headings.map((h) => {
        const li = doc.createElement("li");
        li.dataset.level = String(h.level);
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = h.text;
        button.addEventListener("click", () => go(h.id));
        li.append(button);
        return li;
      }),
    );
    empty.hidden = headings.length > 0;
  };
}

const formatDate = (/** @type {string} */ iso) => {
  const time = Date.parse(iso);
  if (!iso || Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    time,
  );
};

/**
 * @param {Document} doc
 * @param {HTMLElement} listEl
 * @param {(id: string | null) => void} select
 */
export function renderComments(doc, listEl, select) {
  /** @type {HTMLButtonElement[]} */
  let buttons = [];
  const mark = (/** @type {string | null} */ id) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.comment === id));
  };
  const render = (/** @type {import("../model.js").Comment[]} */ comments) => {
    buttons = comments.map((c) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "comment";
      button.dataset.comment = c.id;
      button.setAttribute("aria-pressed", "false");
      const head = doc.createElement("span");
      head.className = "comment-head";
      const author = doc.createElement("strong");
      author.textContent = c.author || "Unknown author";
      head.append(author);
      if (c.date) {
        const time = doc.createElement("time");
        time.dateTime = c.date;
        time.textContent = formatDate(c.date);
        head.append(" ", time);
      }
      const body = doc.createElement("span");
      body.className = "comment-text";
      body.textContent = plainText(c.blocks);
      button.append(head, body);
      button.addEventListener("click", () => {
        const on = button.getAttribute("aria-pressed") !== "true";
        select(on ? c.id : null);
      });
      return button;
    });
    listEl.replaceChildren(
      ...buttons.map((b) => {
        const li = doc.createElement("li");
        li.append(b);
        return li;
      }),
    );
  };
  return { render, mark };
}
