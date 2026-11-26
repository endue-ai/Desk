// Export a result to a file (DB-16, PG-61): the person chooses the place in the desk's save dialog
// (dialog.save), which starts in the folder of the last export and grants that one path, so an
// export is written nowhere the person did not choose, an agent's included. The suggested name is
// the table (or "result") and the time, so a quick Save never overwrites an earlier export. The
// file is written in the format and with the options chosen (export/), in a worker when it is large.
// A refused write asks the desk once for that path (withGrant).

import { withGrant, writeScope } from "./console-files.js";
import { writeFile } from "./export/client.js";
import { EXPORT_FORMATS, EXTENSIONS, isExportFormat, LABELS, optionsOf } from "./export/options.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./export/options.js").ExportFormat} Format
 * @typedef {import("./results.js").FormatOptions} FormatOptions
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./export/file.js").Part} Part
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ path: string, format: Format, rows: number, bytes: number, partial: boolean }} Exported
 *   `partial`: the server had more rows than the result holds.
 */

/** Where a cell's bytes are saved (features/cell-values/): the manifest declares it. */
export const EXPORT_FOLDER = "~/Downloads";
/** The store key of the folder the last export went to. */
export const FOLDER_KEY = "export-folder";

/**
 * A file name for an export: the name made safe for every file system, the local time to the
 * second, and the format's extension.
 * @param {string} base
 * @param {Format} format
 * @param {Date} at
 */
export function exportName(base, format, at) {
  const safe =
    base
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-")
      .replace(/\s+/gu, "-")
      .replace(/-{2,}/gu, "-")
      .replace(/^[.-]+|[.-]+$/gu, "")
      .slice(0, 80) || "result";
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${safe}-${stamp}.${EXTENSIONS[format]}`;
}

/** The folder a path is in. */
const folderOf = (/** @type {string} */ path) => {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "";
};

/**
 * Write a result (or `parts`, an .xlsx's sheets) where the person chooses; answers what was written,
 * or undefined when the save dialog was cancelled.
 * @param {Bridge} bridge
 * @param {{
 *   set: ResultSet, format: Format, name: string, options?: FormatOptions,
 *   settings?: Record<string, unknown>, parts?: Part[], at?: Date,
 *   startWorker?: import("./export/client.js").StartWorker,
 * }} input `options` the result's dialect, table, types and selection; `settings` the format's
 *   export options (export/options.js).
 * @returns {Promise<Exported | undefined>}
 */
export async function exportResult(bridge, input) {
  const { set, format, name, options = {}, at = new Date() } = input;
  if (!isExportFormat(format))
    throw new Error(
      t("export.exportAsPick", {
        format: String(format),
        value: String(EXPORT_FORMATS.join(", ")),
      }),
    );
  const settings = optionsOf(format, input.settings);
  const parts = input.parts ?? [{ name, set, base: options }];
  const kept = await bridge.call("store.get", { key: FOLDER_KEY }).catch(() => ({}));
  const folder = typeof kept?.value === "string" ? kept.value : "";
  const chosen = await bridge.call("dialog.save", {
    title: t("export.exportTheResult"),
    suggestedName: exportName(name, format, at),
    ...(folder ? { startIn: folder } : {}),
    filters: [{ name: LABELS[format], extensions: [EXTENSIONS[format]] }],
  });
  if (chosen.cancelled || !chosen.path) return undefined;
  const path = chosen.path;
  const file = await writeFile({ format, options: settings, parts }, input.startWorker);
  const scope = writeScope(path);
  await withGrant(
    bridge,
    scope,
    () => bridge.call("fs.write", { path, content: file.content, encoding: file.encoding, scope }),
    `To export ${name} to ${path}`,
  );
  const where = folderOf(path);
  if (where) await bridge.call("store.set", { key: FOLDER_KEY, value: where }).catch(() => {});
  return {
    path,
    format,
    rows: file.rows,
    bytes: file.bytes,
    partial: parts.some((p) => p.set.truncated),
  };
}
