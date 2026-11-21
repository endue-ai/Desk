// The grid and a paste (PG-43): the browser's paste event on the focused grid (Mod+V, so the page
// reads the clipboard without asking) hands its text to the controller's pasteText (features/
// paste/), never while a cell's field has the focus; where a paste, a fill or a clear lands (the
// block's corners, the rows in screen order, the shown columns); the clipboard read for the
// palette's command; and the text read into rows (edit/paste-text.js): in the frame, or in a worker
// of its own (paste-worker.js, started with the SDK's startWorker as the grid's worker is) when it is
// over 16 KiB, a few thousand cells.

import { copiedHere } from "../clipboard.js";
import { readPaste } from "../edit/paste-text.js";

/**
 * @typedef {import("./rows-client.js").StartWorker} StartWorker
 * @typedef {import("../edit/paste-text.js").Pasted} Pasted
 * @typedef {import("./screen.js").GridState} GridState
 */

export const IN_WORKER = 16 * 1024;

/**
 * Text read into rows, by the worker past `threshold` characters.
 * @param {StartWorker | undefined} startWorker
 */
export function createPasteReader(startWorker, threshold = IN_WORKER) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(value: Pasted): void, reject(error: unknown): void }>} */
  const pending = new Map();
  const started = () => {
    if (worker || !startWorker) return worker;
    try {
      worker = startWorker(new URL("./paste-worker.js", import.meta.url), {
        name: "Database paste",
      });
    } catch {
      return undefined;
    }
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      pending.delete(data.id);
      if ("error" in data) entry?.reject(new Error(data.error));
      else entry?.resolve({ rows: data.rows, format: data.format });
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error("The paste's worker stopped."));
      pending.clear();
      worker = undefined;
    };
    return worker;
  };
  return {
    /** @returns {Pasted | Promise<Pasted>} */
    read(/** @type {string} */ text, /** @type {boolean} */ ours) {
      const to = text.length > threshold ? started() : undefined;
      if (!to) return readPaste(text, { ours });
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        to.postMessage({ id, text, ours });
      });
    },
  };
}

/**
 * The paste event of the focused grid, and the grid's operations a paste, a fill or a clear asks for
 * by name (features/paste/ through view.grid): `cells`, `readPaste` ({ text }), `clipboard`.
 * @param {Document} doc
 * @param {{
 *   grid: HTMLElement, st: GridState, block(): { top: number, bottom: number, left: number, right: number },
 *   editing(): boolean, act(action: string, ...args: unknown[]): unknown, startWorker?: StartWorker,
 * }} g
 */
export function createGridPaste(doc, g) {
  const reader = createPasteReader(g.startWorker);
  doc.addEventListener("paste", (event) => {
    if (!g.grid.contains(doc.activeElement) || g.editing() || !g.st.tab?.set) return;
    event.preventDefault();
    g.act("pasteText", event.clipboardData?.getData("text/plain") ?? "");
  });
  /** @type {Record<string, (args: Record<string, unknown>) => unknown>} */
  const ops = {
    cells: () =>
      g.st.record
        ? "Leave the record view (t) first: a paste, a fill or a clear works on the grid's rows."
        : { order: [...g.st.order], columns: [...g.st.layout.visible], ...g.block() },
    readPaste: ({ text }) => reader.read(String(text ?? ""), copiedHere(String(text ?? ""))),
    clipboard: async () => {
      const clipboard = doc.defaultView?.navigator?.clipboard;
      const refused =
        "The clipboard cannot be read here: put the cursor in the grid and press Mod+V.";
      if (typeof clipboard?.readText !== "function") return refused;
      return clipboard.readText().then(
        (text) => ({ text }),
        () => refused,
      );
    },
  };
  return {
    /** One of the operations above by name; undefined for any other. */
    command: (/** @type {string} */ op, /** @type {Record<string, unknown>} */ args) =>
      Object.hasOwn(ops, op) ? ops[op]?.(args) : undefined,
  };
}
