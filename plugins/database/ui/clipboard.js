// Text onto the clipboard. The Clipboard API first: it needs no key or click in this page, so a
// command run from the palette copies too, where the desk lets the page write the clipboard (D1).
// Else the copy command on a hidden textarea, which a key or a click in the page allows.
import { el } from "./dom.js";

/**
 * @param {Document} doc
 * @param {string} text
 * @returns {Promise<boolean>} false when the clipboard refused both ways
 */
export async function copyText(doc, text) {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, the page not focused): try the copy command.
    }
  }
  return copyCommand(doc, text);
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
