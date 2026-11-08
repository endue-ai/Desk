// Export a result to a file (DB-16): in the first slice, into the folder the manifest declares for
// it, ~/Downloads (fs:write on ${home}/Downloads/**), under a name made of the table (or "result")
// and the time, so an export never overwrites an earlier one. The desk keeps no save dialog a
// plugin can open yet; an arbitrary path waits for a narrow fs:write request (D3). When the grant
// is missing the desk is asked once (perm.request), as the clients are.

import { FORMATS, formatRows } from "./results.js";

/**
 * @typedef {import("./results.js").Format} Format
 * @typedef {import("./results.js").FormatOptions} FormatOptions
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

export const EXPORT_FOLDER = "~/Downloads";
export const EXTENSIONS = /** @type {Record<Format, string>} */ ({
  tsv: "tsv",
  csv: "csv",
  json: "json",
  markdown: "md",
  insert: "sql",
  update: "sql",
});

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

/**
 * Write a result as a format into the export folder; answers the path.
 * @param {Bridge} bridge
 * @param {{ set: ResultSet, format: Format, name: string, options?: FormatOptions, at?: Date }} input
 */
export async function exportResult(bridge, { set, format, name, options = {}, at = new Date() }) {
  if (!FORMATS.includes(format))
    throw new Error(`Export as ${format}: pick ${FORMATS.join(", ")}.`);
  const text = formatRows(set, format, options);
  // A CSV or TSV file ends with a line break, as spreadsheets and COPY ... FROM expect.
  const content =
    format === "csv" ? `${text}\r\n` : text.endsWith("\n") || text === "" ? text : `${text}\n`;
  const path = `${EXPORT_FOLDER}/${exportName(name, format, at)}`;
  const scope = { permission: /** @type {const} */ ("fs:write"), paths: [`${EXPORT_FOLDER}/**`] };
  const write = () =>
    bridge.call("fs.write", { path, content, encoding: "utf8", createDirs: true, scope });
  try {
    await write();
  } catch (error) {
    if (codeOf(error) !== "permission_denied")
      throw new Error(`Could not write ${path}: ${codeOf(error)}.`);
    const decision = await bridge
      .call("perm.request", { permission: scope, reason: `To export ${name} to ${path}` })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw new Error(`Not allowed to write ${path}.`);
    await write().catch((again) => {
      throw new Error(`Could not write ${path}: ${codeOf(again)}.`);
    });
  }
  return {
    path,
    rows: (options.rows ?? set.rows).length,
    bytes: new TextEncoder().encode(content).length,
  };
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
