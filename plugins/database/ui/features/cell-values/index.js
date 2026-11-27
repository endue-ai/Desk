// A cell's value from outside the grid's keys (PG-40): bytes loaded from a file the person picks
// (dialog.open, which asks for nothing, then fs.read as base64 under that file's own scope: the
// manifest's fs:read /**) and saved to one in ~/Downloads (fs.write as base64 under the manifest's
// one fs:write, as an export is), and DEFAULT set on the cursor's cell. The bytes editor calls the
// actions cellFileLoad and cellFileSave; the palette's commands work on the cursor's cell.

import { DEFAULT } from "../../edit/values.js";
import { EXPORT_FOLDER, exportName } from "../../export.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ run(id: string, args?: unknown): Promise<unknown> }} Commands
 */

/** The most a file may hold to become a cell's value: its hex literal must fit one client argument. */
export const MAX_FILE = 256 * 1024;
const HEX = /^(?:\\x|0x)([0-9a-fA-F]*)$/u;

const toHex = (/** @type {string} */ base64) =>
  [...atob(base64)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const toBase64 = (/** @type {string} */ hex) =>
  btoa(
    (hex.match(/../gu) ?? [])
      .map((pair) => String.fromCharCode(Number.parseInt(pair, 16)))
      .join(""),
  );
const fileName = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Ask for a file and read its bytes as PostgreSQL's hex; undefined when the person cancels.
 * @param {Bridge} bridge
 * @returns {Promise<{ hex: string, name: string, size: number } | undefined>}
 */
export async function loadBytes(bridge) {
  const picked = await bridge.call("dialog.open", {
    title: t("features.cellValues.index.loadBytesFromAFile"),
  });
  const path = picked.cancelled ? undefined : picked.paths[0];
  if (!path) return undefined;
  const name = fileName(path);
  const scope = { permission: /** @type {const} */ ("fs:read"), paths: [path] };
  const read = await bridge.call("fs.read", {
    path,
    encoding: "base64",
    length: MAX_FILE + 1,
    scope,
  });
  const size = read.size ?? 0;
  if (size > MAX_FILE)
    throw new Error(
      t("features.cellValues.index.isKibAValueLoadedFrom", {
        name: String(name),
        value: String(Math.round(size / 1024)),
        value2: String(MAX_FILE / 1024),
      }),
    );
  return { hex: `\\x${toHex(read.content)}`, name, size };
}

/**
 * Write bytes (hex, \x or 0x) into ~/Downloads as <name>-<time>.bin and show the file; answers its path.
 * @param {Bridge} bridge
 * @param {Commands} commands
 * @param {string} value
 * @param {string} name What the file is named after: the column.
 */
export async function saveBytes(bridge, commands, value, name, at = new Date()) {
  const hex = HEX.exec(value ?? "");
  if (!hex || (hex[1] ?? "").length % 2)
    throw new Error(t("features.cellValues.index.sValueIsNotBytesNothing", { name: String(name) }));
  const path = `${EXPORT_FOLDER}/${exportName(name, "tsv", at).replace(/\.tsv$/u, ".bin")}`;
  const scope = { permission: /** @type {const} */ ("fs:write"), paths: [`${EXPORT_FOLDER}/**`] };
  const content = toBase64(hex[1] ?? "");
  await bridge.call("fs.write", { path, content, encoding: "base64", createDirs: true, scope });
  await commands.run("desk.files.reveal", { path }).catch(() => undefined);
  return path;
}

/** The cursor's cell, when it can change. */
const changing = (/** @type {Deps} */ deps) => {
  const cell = deps.view.cell();
  if (!cell) throw new Error(t("features.cellValues.index.putTheCursorOnACell"));
  if (!cell.editable)
    throw new Error(
      cell.reason || t("features.cellValues.index.cannotChangeHere", { name: String(cell.name) }),
    );
  return cell;
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "cell-values",
  commands: (deps) => ({
    "endue.database.set-default": async () => {
      const cell = changing(deps);
      if (!cell.editor?.hasDefault)
        throw new Error(t("features.cellValues.index.hasNoDefault", { name: String(cell.name) }));
      await deps.consoles.edits.editCell(cell.row, cell.col, DEFAULT);
    },
    "endue.database.cell-file-load": async () => {
      const cell = changing(deps);
      if (cell.editor?.kind !== "bytes")
        throw new Error(
          t("features.cellValues.index.holdsNoBytesItIsNot", { name: String(cell.name) }),
        );
      const loaded = await loadBytes(deps.bridge);
      if (!loaded) return;
      const value =
        cell.editor.prefix === "0x" ? `0x${loaded.hex.slice(2).toUpperCase()}` : loaded.hex;
      await deps.consoles.edits.editCell(cell.row, cell.col, value);
      deps.say(
        t("features.cellValues.index.loadedByteIntoPendingUntilSubmit", {
          name: String(loaded.name),
          size: String(loaded.size),
          value: String(loaded.size === 1 ? "" : t("features.cellValues.index.s")),
          name2: String(cell.name),
        }),
      );
    },
    "endue.database.cell-file-save": async () => {
      const cell = deps.view.cell();
      if (!cell) throw new Error(t("features.cellValues.index.putTheCursorOnACell"));
      const path = await saveBytes(deps.bridge, deps.commands, cell.value ?? "", cell.name);
      deps.say(
        t("features.cellValues.index.savedSBytesTo", {
          name: String(cell.name),
          path: String(path),
        }),
      );
    },
  }),
  actions: (deps) => ({
    cellFileLoad: () => loadBytes(deps.bridge),
    cellFileSave: async (/** @type {string} */ value, /** @type {string} */ name) => {
      const path = await saveBytes(deps.bridge, deps.commands, value, name);
      deps.say(
        t("features.cellValues.index.savedSBytesTo", { name: String(name), path: String(path) }),
      );
      return path;
    },
  }),
};
