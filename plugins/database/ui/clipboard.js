// Text onto the clipboard, with an HTML table beside it when there is one (a block: a spreadsheet
// pastes the table as cells). Chromium lets a page write the clipboard only while the page has the
// focus and a key or a press in it is a few seconds old; the desk gives a plugin's page that press
// when the person runs its command, or answers its question, in the palette (ADR 0318). The
// palette has the focus until it closes and gives it back, so a page without the focus waits for it
// a moment. Then the Clipboard API, which carries both types; else the copy command on a hidden
// textarea, which carries the text only. The grid's last Mod+C is remembered, so a paste of that
// text is read as the grid's own copy (PG-43: its escapes and \N, edit/paste-text.js) and any other
// text as a spreadsheet's.
import { el } from "./dom.js";

let last = "";
const lines = (/** @type {string} */ text) => text.replace(/\r\n/gu, "\n").replace(/\n$/u, "");

/** How long a copy waits for the page to have the focus back (the palette closing gives it). */
export const FOCUS_WAIT_MS = 1500;

/** Remember the text the grid's Mod+C put on the clipboard (grid/pointer.js). */
export function remember(/** @type {string} */ text) {
  last = lines(text);
}

/** Whether a paste is the grid's last copy (a line break at its end or CRLF aside). */
export const copiedHere = (/** @type {string} */ text) => text !== "" && lines(text) === last;

/**
 * @param {Document} doc
 * @param {string} text
 * @param {string} [html] An HTML table of the same cells.
 * @returns {Promise<boolean>} false when the clipboard refused both ways
 */
export async function copyText(doc, text, html) {
  await focused(doc, FOCUS_WAIT_MS);
  const win = doc.defaultView;
  const clipboard = win?.navigator?.clipboard;
  try {
    const Item = /** @type {typeof ClipboardItem | undefined} */ (
      /** @type {any} */ (win)?.ClipboardItem
    );
    if (html !== undefined && Item && typeof clipboard?.write === "function") {
      const blob = (/** @type {string} */ body, /** @type {string} */ type) =>
        new Blob([body], { type });
      await clipboard.write([
        new Item({ "text/plain": blob(text, "text/plain"), "text/html": blob(html, "text/html") }),
      ]);
      return true;
    }
    if (typeof clipboard?.writeText === "function") {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no focus, no press, the desk said no): try the copy command.
  }
  // The copy command takes the textarea's text only: a block copied this way pastes as text.
  return copyCommand(doc, text);
}

/** Resolve once `doc` has the focus, or after `ms`; at once when it has it. */
function focused(/** @type {Document} */ doc, /** @type {number} */ ms) {
  const win = doc.defaultView;
  if (!win || typeof doc.hasFocus !== "function" || doc.hasFocus()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      win.clearTimeout(timer);
      win.removeEventListener("focus", done);
      resolve(undefined);
    };
    const timer = win.setTimeout(done, ms);
    win.addEventListener("focus", done);
  });
}

/** The copy command on a hidden textarea holding the text; false when it was refused. */
function copyCommand(/** @type {Document} */ doc, /** @type {string} */ text) {
  const scratch = /** @type {HTMLTextAreaElement} */ (
    el(doc, "textarea", { class: "offscreen", "aria-hidden": "true" })
  );
  scratch.value = text;
  doc.body.append(scratch);
  scratch.select();
  let done = false;
  try {
    done = doc.execCommand("copy");
  } catch {
    done = false;
  }
  scratch.remove();
  return done;
}
