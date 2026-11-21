// A cell's value from outside the grid's keys (PG-40): bytes loaded from a file the person picks
// (dialog.open, which asks for nothing, then fs.read as base64 under that file's own scope: the
// manifest's fs:read /**) and saved to one in ~/Downloads (fs.write as base64 under the manifest's
// one fs:write, as an export is), and DEFAULT set on the cursor's cell. The bytes editor calls the
// actions cellFileLoad and cellFileSave; the palette's commands work on the cursor's cell.

import { DEFAULT } from "../../edit/values.js";
import { EXPORT_FOLDER, exportName } from "../../export.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ run(id: string, args?: unknown): Promise<unknown> }} Commands
 */

/** The most a file may hold to become a cell's value: its hex literal must fit one psql argument. */
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
  const picked = await bridge.call("dialog.open", { title: "Load bytes from a file" });
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
      `${name} is ${Math.round(size / 1024)} KiB: a value loaded from a file is ${MAX_FILE / 1024} KiB at most.`,
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
    throw new Error(`${name}'s value is not bytes: nothing to save.`);
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
  if (!cell) throw new Error("Put the cursor on a cell of a result first.");
  if (!cell.editable) throw new Error(cell.reason || `${cell.name} cannot change here.`);
  return cell;
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "cell-values",
  commands: (deps) => ({
    "endue.database.set-default": async () => {
      const cell = changing(deps);
      if (!cell.editor?.hasDefault) throw new Error(`${cell.name} has no default.`);
      await deps.consoles.edits.editCell(cell.row, cell.col, DEFAULT);
    },
    "endue.database.cell-file-load": async () => {
      const cell = changing(deps);
      if (cell.editor?.kind !== "bytes")
        throw new Error(`${cell.name} holds no bytes: it is not bytes to load.`);
      const loaded = await loadBytes(deps.bridge);
      if (!loaded) return;
      const value =
        cell.editor.prefix === "0x" ? `0x${loaded.hex.slice(2).toUpperCase()}` : loaded.hex;
      await deps.consoles.edits.editCell(cell.row, cell.col, value);
      deps.say(
        `Loaded ${loaded.name} (${loaded.size} byte${loaded.size === 1 ? "" : "s"}) into ${cell.name}: pending until Submit.`,
      );
    },
    "endue.database.cell-file-save": async () => {
      const cell = deps.view.cell();
      if (!cell) throw new Error("Put the cursor on a cell of a result first.");
      const path = await saveBytes(deps.bridge, deps.commands, cell.value ?? "", cell.name);
      deps.say(`Saved ${cell.name}'s bytes to ${path}.`);
    },
  }),
  actions: (deps) => ({
    cellFileLoad: () => loadBytes(deps.bridge),
    cellFileSave: async (/** @type {string} */ value, /** @type {string} */ name) => {
      const path = await saveBytes(deps.bridge, deps.commands, value, name);
      deps.say(`Saved ${name}'s bytes to ${path}.`);
      return path;
    },
  }),
};
