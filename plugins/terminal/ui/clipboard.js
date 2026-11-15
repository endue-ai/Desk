// What programs copy with OSC 52 (`52;Pc;Pd`, xterm's selection data): neovim, tmux, helix and
// programs over ssh put base64 text there. The terminal puts it on the clipboard through the
// webview's own copy, a copy event it fills, as its Mod+C does: no Clipboard API until the bridge
// has clipboard permissions (TERM-I03). A query (`?`) is never answered, so a program may write
// the clipboard but never read it; `endue.terminal.program-copy: false` turns it off (issue 319).

/** The OSC code programs copy with. */
export const OSC_COPY = 52;

/** The selections xterm names: clipboard, primary, secondary, select, cut buffers 0 to 7. */
const SELECTIONS = /^[cpqs0-7]*$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

/** The text an OSC 52 payload copies, or null: a query, a clear, or anything but base64 text. */
export function copied(/** @type {string} */ data) {
  const at = data.indexOf(";");
  if (at < 0 || !SELECTIONS.test(data.slice(0, at))) return null;
  const payload = data.slice(at + 1).replace(/\s+/gu, "");
  if (!BASE64.test(payload)) return null;
  let bytes;
  try {
    bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const text = new TextDecoder().decode(bytes);
  return text === "" ? null : text;
}

/**
 * Put `text` on the clipboard: the webview copies, and the copy event carries `text` instead of
 * the selection. False when the webview refused, as Chromium does without a recent key or click.
 * @param {Pick<Document, "addEventListener" | "removeEventListener" | "execCommand">} doc
 * @param {string} text
 */
export function writeClipboard(doc, text) {
  const fill = (/** @type {ClipboardEvent} */ event) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    // Before xterm's own copy handler, which would put the selection there.
    event.stopImmediatePropagation();
  };
  doc.addEventListener("copy", /** @type {EventListener} */ (fill), true);
  try {
    return doc.execCommand("copy");
  } finally {
    doc.removeEventListener("copy", /** @type {EventListener} */ (fill), true);
  }
}

/**
 * The view's answer to OSC 52: copy, and say on the status line what was copied or how to copy.
 * @param {{
 *   doc: Parameters<typeof writeClipboard>[0], say(text: string): void,
 *   title(id: string): string, enabled(): boolean, chord: string,
 * }} deps
 */
export function createProgramCopy(deps) {
  return (/** @type {string} */ id, /** @type {string} */ data) => {
    if (!deps.enabled()) return;
    const text = copied(data);
    if (text === null) return;
    const who = deps.title(id);
    if (!writeClipboard(deps.doc, text)) {
      deps.say(`The desk did not let ${who} copy: select the text and press ${deps.chord}.`);
      return;
    }
    const count = [...text].length;
    deps.say(`${who} copied ${count} ${count === 1 ? "character" : "characters"}.`);
  };
}
