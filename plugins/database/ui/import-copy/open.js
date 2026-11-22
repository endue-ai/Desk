// The import's wiring (PG-60, ADR 0363): the importer with what COPY needs of the plugin, and
// Database: import a file into a table (features/import-file/), where the file the command names,
// or one the person picks in the open dialog, opens the import wizard exactly as a drop of it does
// (dropped.js): by COPY on a PostgreSQL connection, by INSERT on another engine.

import { createImporter } from "../importer.js";
import { textOf } from "./start.js";

/**
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   drop(item: import("../drops.js").Dropped): Promise<unknown>,
 * }} Deps
 */

/**
 * Open the import of `args.path`, else of a file the person picks; null when they cancel.
 * @param {Deps} deps
 * @param {{ path?: unknown }} args
 */
export async function importFile(deps, args) {
  let path = typeof args.path === "string" ? args.path : "";
  if (!path) {
    const picked = await deps.bridge.call("dialog.open", {
      title: "Database: import which file into a table?",
    });
    path = picked.cancelled ? "" : (picked.paths[0] ?? "");
  }
  if (!path) return null;
  await deps.drop({ kind: "file", path });
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The importer (importer.js), with what it needs of the plugin for COPY: sessions of its own that
 * close after it, the file's read grant, and its worker.
 * @param {Omit<import("../importer.js").Deps, "current" | "copies" | "readText"> & {
 *   consoles: { current(): ReturnType<import("../importer.js").Deps["current"]> },
 *   bridge: import("./start.js").Deps["bridge"],
 *   confirm: import("./start.js").Deps["confirm"],
 *   held: { pg: { forget(owner: string): void } },
 * }} deps
 * @param {() => import("../settings.js").Settings} settings
 * @param {import("./start.js").Deps["startWorker"]} [startWorker]
 */
export function importerFor(deps, settings, startWorker) {
  const { consoles, bridge, confirm, held, execute, ...rest } = deps;
  return createImporter({
    ...rest,
    execute,
    current: () => consoles.current(),
    copies: {
      bridge,
      execute: (conn, sql, opts) => execute(conn, sql, opts),
      confirm,
      settings,
      forget: (owner) => held.pg.forget(owner),
      ...(startWorker ? { startWorker } : {}),
    },
    readText: (path) => textOf(bridge, path),
  });
}
