// A file written under a temporary name and renamed at the end (PG-64): the bytes go to
// `.<name>.partial` beside the chosen path (the first write makes it, the rest append: fs.write
// `append`, ADR 0356), so the chosen path holds nothing until the last byte is in. Then fs.rename,
// which never overwrites: a file already at the chosen path (the save dialog asked first) goes to the
// OS trash just before. Discarded (a cancel, a failure), the temporary file goes to the trash too:
// the bridge has no delete for good. Same folder, so the rename never crosses volumes. No DOM.

import { withGrant, writeScope } from "../console-files.js";
import { baseName } from "../console-list.js";
import { t } from "../strings/index.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ permission: "fs:write", paths: string[] }} WriteScope
 * @typedef {{ content: string, encoding: "utf8" | "base64" }} Piece
 */

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** The temporary name beside a path: `.<name>.partial` in the same folder. */
export function partialOf(/** @type {string} */ path) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return `${path.slice(0, cut + 1)}.${path.slice(cut + 1)}.partial`;
}

/** A path with `-<n>` before its extensions: `items.csv.gz` → `items-2.csv.gz`. */
export function numbered(/** @type {string} */ path, /** @type {number} */ n) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const base = path.slice(cut);
  const dot = base.indexOf(".", 1);
  const stem = dot < 0 ? base : base.slice(0, dot);
  return `${path.slice(0, cut)}${stem}-${n}${dot < 0 ? "" : base.slice(dot)}`;
}

/**
 * @param {Bridge} bridge
 * @param {string} path The chosen path.
 * @param {{ scope?: WriteScope, replace?: boolean }} [options] `scope` covers both names (a folder
 *   export's grant); without it the chosen path is the dialog's grant and the temporary one is
 *   asked for once. `replace: false` keeps a file already there and takes the next free name
 *   (`items-2.csv`) instead.
 */
export function partialFile(bridge, path, options = {}) {
  const temp = partialOf(path);
  const name = baseName(path);
  const tempScope = options.scope ?? writeScope(temp);
  const pathScope = options.scope ?? writeScope(path);
  let started = false;
  let discarded = false;
  /** The last write, which a discard waits for. @type {Promise<unknown> | undefined} */
  let pending;
  const write = (/** @type {Piece} */ piece) =>
    withGrant(
      bridge,
      tempScope,
      () =>
        bridge.call("fs.write", {
          path: temp,
          content: piece.content,
          encoding: piece.encoding,
          scope: tempScope,
          ...(started ? { append: true } : {}),
        }),
      `To write ${name} under a temporary name until its last row is in`,
    );
  const rename = (to = path) =>
    bridge.call("fs.rename", {
      from: temp,
      to,
      scope: pathScope,
      ...(options.scope ? {} : { fromScope: tempScope }),
    });
  return {
    path,
    temp,
    /** Append a piece of the file. */
    async write(/** @type {Piece} */ piece) {
      if (discarded) throw new Error(t("copy.partial.wasDiscarded", { name: String(name) }));
      pending = write(piece);
      await pending;
      started = true;
    },
    /** Every byte is in: the file takes the chosen name (or the next free one); answers it. */
    async finish() {
      if (!started) await write({ content: "", encoding: "utf8" });
      started = true;
      for (let n = 1; n <= 100; n++) {
        const to = n === 1 ? path : numbered(path, n);
        try {
          await rename(to);
          return to;
        } catch (error) {
          if (codeOf(error) !== "already_exists")
            throw new Error(
              t("copy.partial.couldNotName", {
                value: String(baseName(to)),
                value2: String(codeOf(error)),
              }),
            );
          if (options.replace === false) continue;
        }
        await bridge.call("fs.trash", { path, scope: pathScope }).catch((again) => {
          throw new Error(
            t("copy.partial.couldNotReplace", { name: String(name), value: String(codeOf(again)) }),
          );
        });
        await rename().catch((again) => {
          throw new Error(
            t("copy.partial.couldNotName2", { name: String(name), value: String(codeOf(again)) }),
          );
        });
        return path;
      }
      throw new Error(t("copy.partial.couldNotNameAHundredFiles", { name: String(name) }));
    },
    /** Nothing of it stays at either name: the temporary file goes to the trash. */
    async discard() {
      discarded = true;
      const wrote = pending
        ? await pending.then(
            () => true,
            () => started,
          )
        : started;
      if (!wrote) return;
      await bridge.call("fs.trash", { path: temp, scope: tempScope }).catch(() => {});
    },
  };
}
