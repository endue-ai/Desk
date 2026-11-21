// The plugin's built-in commands (endue.database.*, in plugin.json), each answered through
// answer.js: a failure goes to the status line and ends the request with the same words; a cancel
// ends it quietly. A feature answers its own (features/). No DOM.

import { formatUri, loadConnections } from "./connections.js";
import { engineOf } from "./engines/index.js";
import { formatDuration } from "./format.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   answer: import("./answer.js").Answer,
 *   view: import("./database.js").View,
 *   manager: ReturnType<typeof import("./manage.js").createManager>,
 *   consoles: ReturnType<typeof import("./consoles.js").createConsoles>,
 *   explorer: ReturnType<typeof import("./explorer.js").createExplorer>,
 *   tools: ReturnType<typeof import("./tools.js").createTools>,
 *   execute: import("./catalog.js").Execute,
 *   cancel(): void,
 *   pick(title: string, items: { id: string, label: string }[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 * }} Deps
 */

/** @param {Deps} deps */
export function registerCommands(deps) {
  const { answer, view, manager, consoles, explorer, tools } = deps;
  const said = async (/** @type {Promise<unknown>} */ done) => {
    const text = await done;
    if (typeof text === "string") view.say(text);
    return text;
  };
  /** Open a connection's console, from a name, an id or a pick; with none yet, the form. */
  const openConsole = async (/** @type {string | undefined} */ ref) => {
    if (manager.list().length === 0 && !ref) {
      manager.create();
      return null;
    }
    const conn = await manager.choose(ref, "Database: open which connection?");
    if (!conn) return null;
    await consoles.open(conn);
    view.focus("editor");
    return conn.name;
  };

  answer("endue.database.open", ({ connection }) => openConsole(connection));
  answer("endue.database.console", ({ connection }) => openConsole(connection));
  answer("endue.database.new-connection", (fields) => manager.create(fields));
  answer("endue.database.import-uri", ({ uri }) => manager.importUri(uri));
  answer("endue.database.edit-connection", ({ connection }) => manager.edit(connection));
  answer("endue.database.duplicate-connection", ({ connection }) => manager.duplicate(connection));
  answer("endue.database.remove-connection", ({ connection }) => manager.remove(connection));
  answer("endue.database.disconnect", ({ connection }) => manager.disconnect(connection));
  answer("endue.database.test-connection", async ({ connection }) => {
    const conn = await manager.choose(connection, "Database: test which connection?");
    if (!conn) return undefined;
    const done = await deps.execute(conn, engineOf(conn.engine).versionSql, { catalog: true });
    const error = done.result.error ?? done.result.statements[0]?.error;
    if (error) throw new Error(`${conn.name}: ${error.message}`);
    const version = done.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
    view.say(`${conn.name}: connected in ${formatDuration(done.result.ms)}, ${version}`);
    return version;
  });
  answer("endue.database.copy-uri", async ({ connection }) => {
    const conn = await manager.choose(connection, "Database: copy which connection's URI?");
    if (!conn) return undefined;
    const uri = formatUri(conn);
    view.say(view.copy(uri) ? `Copied ${uri}` : uri);
    return uri;
  });
  answer("endue.database.run", () => consoles.run("statement"));
  answer("endue.database.run-all", () => consoles.run("all"));
  answer("endue.database.run-transaction", () => consoles.run("all", "transaction"));
  answer("endue.database.dry-run", () => consoles.run("all", "dry-run"));
  answer("endue.database.explain", () => consoles.explain(false));
  answer("endue.database.explain-analyze", () => consoles.explain(true));
  answer("endue.database.format", () => said(Promise.resolve(consoles.format())));
  answer("endue.database.more", () => consoles.more());
  answer("endue.database.next-page", () => consoles.page({ delta: 1 }));
  answer("endue.database.previous-page", () => consoles.page({ delta: -1 }));
  answer("endue.database.cancel", () => {
    deps.cancel();
    view.say("Cancelling…");
  });
  answer("endue.database.open-table", async ({ connection, schema, table }) => {
    const conn = await manager.choose(connection, "Database: which connection?");
    if (!conn || typeof table !== "string")
      throw new Error("Open a table from the explorer, or name connection, schema and table.");
    await consoles.open(conn, { schema: typeof schema === "string" ? schema : "", name: table });
    view.focus("grid");
  });
  answer("endue.database.refresh", async ({ connection }) => {
    const conn = connection ? manager.get(connection) : undefined;
    explorer.refresh(conn?.id, undefined);
    manager.replace(await loadConnections(deps.bridge));
  });
  answer("endue.database.filter-explorer", async ({ text }) => {
    const typed =
      typeof text === "string"
        ? text
        : await deps.pick(
            "Database: show objects whose name holds",
            [],
            true,
            explorer.filtering() || "orders",
          );
    if (typed === undefined) return undefined;
    explorer.filter(typed);
    view.focus("explorer");
    return typed;
  });
  answer("endue.database.ddl", (args) => tools.ddl(args));
  answer("endue.database.history", ({ query }) => tools.history(query));
  answer("endue.database.star", ({ name }) => tools.star(name));
  answer("endue.database.starred", () => tools.starred());
  answer("endue.database.unstar", ({ name }) => tools.unstar(name));
  answer("endue.database.copy", ({ format }) => tools.copy(format));
  answer("endue.database.export", ({ format }) => tools.exportTo(format));
  answer("endue.database.clients", () => tools.checkClients());
  answer("endue.database.add-row", () => consoles.edits.addRow());
  answer("endue.database.submit-changes", () => said(consoles.edits.submit()));
  answer("endue.database.revert-changes", () => {
    const dropped = consoles.edits.revert(undefined);
    view.say(
      dropped
        ? `Reverted ${dropped} pending change${dropped === 1 ? "" : "s"}.`
        : "No pending changes.",
    );
    return dropped;
  });
  answer("endue.database.preview-changes", () => {
    const sql = consoles.edits.preview();
    view.preview(sql);
    return sql;
  });
}
