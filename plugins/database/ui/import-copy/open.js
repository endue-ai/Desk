// The import's wiring (PG-60, ADR 0363): the importer with what COPY needs of the plugin, and
// Database: import a file into a table (features/import-file/), where the file the command names,
// or one the person picks in the open dialog, opens the import wizard exactly as a drop of it does
// (dropped.js): by COPY on a PostgreSQL connection, by INSERT on another engine.

import { createImporter } from "../importer.js";
import { textOf } from "./start.js";

/**
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   drop(item: import("../drops.js").Dropped, into?: import("../importer.js").Into & { format?: import("./wizard.js").CopyFormat }): Promise<unknown>,
 *   manager?: Pick<import("../feature-host.js").Deps["manager"], "get">,
 * }} Deps
 */

/**
 * Open the import of `args.path`, else of a file the person picks; null when they cancel.
 * @param {Deps} deps
 * @param {{ path?: unknown, connection?: unknown, schema?: unknown, table?: unknown, format?: unknown }} args
 * @param {boolean} [agent]
 */
export async function importFile(deps, args, agent = false) {
  let path = typeof args.path === "string" ? args.path : "";
  const connection = typeof args.connection === "string" ? args.connection : undefined;
  const schema = typeof args.schema === "string" ? args.schema : undefined;
  const table = typeof args.table === "string" ? args.table : undefined;
  const format = ["csv", "tsv", "json", "jsonl", "xlsx"].includes(String(args.format))
    ? /** @type {import("./wizard.js").CopyFormat} */ (args.format)
    : undefined;
  if (agent && connection && !deps.manager?.get(connection))
    throw new Error(`No connection is named ${connection}.`);
  if (!path || agent) {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const picked = await deps.bridge.call("dialog.open", {
      title: path
        ? `Database: choose ${path.slice(slash + 1).slice(0, 100)} to import`
        : "Database: import which file into a table?",
      ...(slash > 0 ? { startIn: path.slice(0, slash) } : {}),
      ...(agent
        ? {
            filters: [
              { name: "Tabular data", extensions: ["csv", "tsv", "json", "jsonl", "xlsx"] },
            ],
          }
        : {}),
    });
    path = picked.cancelled ? "" : (picked.paths[0] ?? "");
  }
  if (!path) return null;
  await deps.drop({ kind: "file", path }, { connection, schema, table, format });
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
