// Export and import of connections (PG-15, ADR 0332). Export: the person ticks connections in a
// dialog, picks a place in the save dialog (dialog.save, which grants that file), and the file is
// written without a password. Import: the open dialog (dialog.open, which grants the file it
// picks), the file read and checked (file.js, service.js), a preview of what is added, changed or
// skipped, and nothing kept until the person confirms it. Nothing in a file is run. No DOM.

import { withGrant, writeScope } from "../../console-files.js";
import { engineOf } from "../../engines/index.js";
import { fileText, MAX_BYTES, readFile } from "./file.js";
import { applyImport, planImport } from "./plan.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ connections: { id: string, name: string, detail: string }[], ticked: string[] }} ExportModel
 * @typedef {{
 *   file: string, kind: "connections" | "service", version: number, exported: string,
 *   local: Connection[], rows: import("./plan.js").Row[],
 * }} ImportModel
 */

const baseName = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1) || path;
const plural = (/** @type {number} */ n, /** @type {string} */ word) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a connection is, after its name: engine, group, environment. */
export const detailOf = (/** @type {Connection} */ c) =>
  [engineOf(c.engine).title, c.group, c.tag !== "none" ? c.tag : ""].filter(Boolean).join(" · ");

/**
 * @param {Deps} deps
 * @param {{ connections?: unknown }} args Names or ids to tick; all when absent.
 */
export async function exportConnections(deps, args, at = new Date()) {
  const list = deps.manager.list();
  if (list.length === 0)
    throw new Error("No connections to export yet: add one with Database: new connection.");
  const wanted = Array.isArray(args.connections)
    ? args.connections.flatMap((ref) => deps.manager.get(String(ref))?.id ?? [])
    : list.map((c) => c.id);
  /** @type {ExportModel} */
  const model = {
    connections: list.map((c) => ({ id: c.id, name: c.name, detail: detailOf(c) })),
    ticked: wanted,
  };
  const answer = /** @type {{ ids?: string[] } | undefined} */ (
    await deps.dialog("connectionsExport", model)
  );
  const ids = new Set(answer?.ids ?? []);
  const chosen = list.filter((c) => ids.has(c.id));
  if (chosen.length === 0) throw deps.cancelled("Not exported.");
  const picked = await deps.bridge.call("dialog.save", {
    title: "Export connections",
    suggestedName: `connections-${at.toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Connections", extensions: ["json"] }],
  });
  if (picked.cancelled || !picked.path) throw deps.cancelled("Not exported.");
  const path = picked.path;
  const content = fileText(chosen, at);
  const scope = writeScope(path);
  await withGrant(
    deps.bridge,
    /** @type {any} */ (scope),
    () =>
      deps.bridge.call("fs.write", {
        path,
        content,
        encoding: "utf8",
        scope: /** @type {any} */ (scope),
      }),
    `To export connections to ${path}`,
  );
  deps.say(`Exported ${plural(chosen.length, "connection")} to ${path}, without passwords.`);
  return { path, count: chosen.length };
}

/** The file's text, read under the grant the open dialog gave; refused past MAX_BYTES. */
async function readText(/** @type {Deps} */ deps, /** @type {string} */ path) {
  const scope = /** @type {const} */ ({ permission: "fs:read", paths: [path] });
  const read = await withGrant(
    deps.bridge,
    /** @type {any} */ (scope),
    () => deps.bridge.call("fs.read", { path, encoding: "utf8", length: MAX_BYTES + 1, scope }),
    `To import connections from ${baseName(path)}`,
  );
  const size = read.size ?? new TextEncoder().encode(read.content).length;
  if (size > MAX_BYTES)
    throw new Error(
      `${baseName(path)} cannot be imported: it is ${Math.ceil(size / 1024)} KiB, and a connections file is ${MAX_BYTES / 1024} KiB at most.`,
    );
  return read.content;
}

/** @param {Deps} deps */
export async function importConnections(deps) {
  const picked = await deps.bridge.call("dialog.open", {
    title: "Import connections from which file?",
  });
  const path = picked.cancelled ? undefined : picked.paths[0];
  if (!path) throw deps.cancelled("Not imported.");
  const name = baseName(path);
  const text = await readText(deps, path);
  let file;
  try {
    file = readFile(text);
  } catch (error) {
    throw new Error(
      `${name} cannot be imported: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (file.entries.length === 0) throw new Error(`${name} holds no connections.`);
  const rows = planImport(deps.manager.list(), file.entries);
  /** @type {ImportModel} */
  const model = {
    file: name,
    kind: file.kind,
    version: file.version,
    exported: file.exported,
    local: deps.manager.list(),
    rows,
  };
  const answer = /** @type {{ ticked?: number[] } | undefined} */ (
    await deps.dialog("connectionsImport", model)
  );
  if (!answer) throw deps.cancelled("Not imported.");
  const kept = applyImport(deps.manager.list(), rows, answer.ticked ?? []);
  if (kept.length === 0) throw deps.cancelled("Nothing imported.");
  await deps.manager.adopt(kept.map((k) => k.conn));
  const changed = kept.filter((k) => rows[k.index]?.kind === "change").length;
  const added = kept.length - changed;
  const skipped = rows.length - kept.length;
  const parts = [
    added ? `${added} added` : "",
    changed ? `${changed} changed` : "",
    skipped ? `${skipped} skipped` : "",
  ].filter(Boolean);
  deps.say(`Imported from ${name}: ${parts.join(", ")}.`);
  return { added, changed, skipped };
}
