// A console's COPY through standard input or output (PG-23): COPY ... TO STDOUT asks where to save
// (dialog.save, which grants that one path) and COPY ... FROM STDIN for the file to read
// (dialog.open, which grants the file chosen); the console's bar shows the bytes as they go, a
// share of the file for COPY in, with Cancel, which cancels the console's run. No DOM.

import { sizeText as size } from "../console-files.js";
import { baseName } from "../console-list.js";
import { wordsOf } from "../sql/lexer.js";
import { t as messageText } from "../strings/index.js";
import { fileSink, fileSource } from "./files.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ label: string, value?: number, max?: number, detail: string }} Bar
 * @typedef {{ copying?(bar: Bar | null): void }} View
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("./statement.js").Direction} Direction
 * @typedef {import("./stream.js").Copy} Copy
 * @typedef {import("./stream.js").Progress} Progress
 */

/** The file name a COPY out suggests: its table (or `copy`) and its format's extension. */
export function copyName(/** @type {Statement} */ statement) {
  const words = wordsOf(statement.tokens);
  const tokens = statement.tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  // The table's own name, after any schema: `public."My Items"` names `My Items`.
  let base = "copy";
  for (let at = 1; tokens[at]?.type === "name" || tokens[at]?.type === "word"; at += 2) {
    const text = /** @type {{ text: string, type: string }} */ (tokens[at]);
    base = text.type === "name" ? text.text.slice(1, -1).replaceAll('""', '"') : text.text;
    if (tokens[at + 1]?.text !== ".") break;
  }
  const kind = words.includes("BINARY") ? "bin" : words.includes("CSV") ? "csv" : "txt";
  const safe = base.replace(/[\\/:*?"<>|\s]+/gu, "-").replace(/^-+|-+$/gu, "") || "copy";
  return `${safe}.${kind}`;
}

/**
 * What the console's bar shows for a COPY's progress.
 * @param {Direction} direction
 * @param {string} name
 * @param {Progress} progress
 * @returns {Bar}
 */
export function barOf(direction, name, progress) {
  const { bytes, total } = progress;
  // Nothing moved yet reads as nothing, not as the smallest size sizeText names.
  const sizeText = (/** @type {number} */ n) => (n === 0 ? "0 KiB" : size(n));
  if (direction === "out")
    return {
      label: messageText("copy.console.copyTo", { name: String(name) }),
      detail: messageText("copy.console.written", { value: String(sizeText(bytes)) }),
    };
  const of = total ? ` of ${sizeText(total)}` : "";
  return {
    label: messageText("copy.console.copyFrom", { name: String(name) }),
    ...(total ? { value: bytes, max: total } : {}),
    detail: messageText("copy.console.sent", { value: String(sizeText(bytes)), of: String(of) }),
  };
}

/**
 * The console's asker: the file of a COPY through standard input or output, or undefined when the
 * person cancels the dialog.
 * @param {Bridge} bridge
 * @param {View} view
 */
export function createConsoleCopies(bridge, view) {
  /** The progress hook that draws the bar, and hides it at the end. */
  const shown = (
    /** @type {Direction} */ direction,
    /** @type {string} */ name,
    /** @type {number | undefined} */ total,
  ) => {
    view.copying?.(
      barOf(direction, name, total === undefined ? { bytes: 0 } : { bytes: 0, total }),
    );
    return (/** @type {Progress | null} */ p) =>
      view.copying?.(p ? barOf(direction, name, p) : null);
  };
  return {
    /**
     * @param {import("../engines/common.js").Connection} conn
     * @param {Statement} statement
     * @param {Direction} direction
     * @returns {Promise<Copy | undefined>}
     */
    async ask(conn, statement, direction) {
      if (direction === "out") {
        const chosen = await bridge.call("dialog.save", {
          title: messageText("copy.console.saveTheRowsOfTheCopy", { name: String(conn.name) }),
          suggestedName: copyName(statement),
        });
        if (chosen.cancelled || !chosen.path) return undefined;
        const name = baseName(chosen.path);
        return {
          sink: fileSink(bridge, chosen.path),
          name,
          progress: shown("out", name, undefined),
        };
      }
      const chosen = await bridge.call("dialog.open", {
        title: messageText("copy.console.theFileWhoseRowsTheCopy", { name: String(conn.name) }),
      });
      const path = chosen.cancelled ? undefined : chosen.paths?.[0];
      if (!path) return undefined;
      const name = baseName(path);
      const source = await fileSource(bridge, path);
      return { source, name, progress: shown("in", name, source.size) };
    },
  };
}
