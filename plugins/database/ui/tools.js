// What the plugin does around a console's results and the explorer: copy and export a result as a
// format, the history and starred queries of a connection, an object's DDL, exact row counts, and
// finding the clients again. Each asks through the palette when an argument is missing. No DOM.

import { tableName } from "./catalog.js";
import { engineOf } from "./engines/index.js";
import { oneLine } from "./execute.js";
import { exportResult } from "./export.js";
import { addHistory, readHistory, readSaved, removeSaved, saveQuery } from "./history.js";
import { FORMATS, formatRows } from "./results.js";
import { RELATIONS } from "./schema/common.js";
import { layout } from "./schema/diagram.js";
import { loadSettings } from "./settings.js";
import { split, statementAt } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./results.js").Format} Format
 * @typedef {{ id: string, label: string, detail?: string }} Item
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   view: import("./database.js").View,
 *   pick(title: string, items: Item[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   manager: ReturnType<typeof import("./manage.js").createManager>,
 *   consoles: ReturnType<typeof import("./consoles.js").createConsoles>,
 *   catalog: ReturnType<typeof import("./catalog.js").createCatalog>,
 *   explorer: ReturnType<typeof import("./explorer.js").createExplorer>,
 *   clients: { get(engine: import("./engines/common.js").EngineId): Promise<import("./clients.js").Client>, reset(): void },
 *   settings(): import("./settings.js").Settings,
 *   reload(settings: import("./settings.js").Settings): void,
 * }} Deps
 */

/** @param {Deps} deps */
export function createTools(deps) {
  const { bridge, view, pick, manager, consoles, catalog, explorer } = deps;

  /** The result tab on screen, with what the SQL formats need to write it. */
  const shownResult = () => {
    const shown = consoles.current();
    const tab = shown?.shown?.tabs[shown.tab];
    if (!shown || !tab?.set) throw new Error("No result here: run a query first.");
    const conn = manager.get(shown.connection);
    const target = shown.edit?.target;
    const table = shown.table
      ? { schema: shown.table.schema, name: shown.table.name }
      : target
        ? { schema: target.schema, name: target.name }
        : undefined;
    /** @type {import("./results.js").FormatOptions} */
    const options = {
      ...(conn ? { dialect: engineOf(conn.engine).dialect } : {}),
      table: table && conn ? tableName(conn, table.schema, table.name) : "t",
      ...(target ? { types: target.columns.map((c) => c.type), key: target.key } : {}),
    };
    return {
      shown,
      set: tab.set,
      options,
      name: table ? `${table.schema ? `${table.schema}.` : ""}${table.name}` : "result",
    };
  };

  /** A format named or picked. @returns {Promise<Format | undefined>} */
  const formatOf = async (
    /** @type {string | undefined} */ format,
    /** @type {string} */ title,
  ) => {
    const chosen =
      format ??
      (await pick(
        title,
        FORMATS.map((id) => ({ id, label: label(id) })),
      ));
    if (!chosen) return undefined;
    if (!FORMATS.includes(/** @type {never} */ (chosen)))
      throw new Error(`${title}: pick ${FORMATS.join(", ")}.`);
    return /** @type {Format} */ (chosen);
  };

  /** The selection's rows and columns, when the grid has one. */
  const picked = () => {
    const selection = view.selection();
    if (!selection?.sorted) return {};
    return {
      rows: selection.rows
        ? selection.rows.map((i) => /** @type {(string | null)[]} */ (selection.sorted?.[i]))
        : selection.sorted,
      ...(selection.columns ? { columns: selection.columns } : {}),
    };
  };

  /** The connection of the console on screen. */
  const here = () => {
    const shown = consoles.current();
    const conn = shown ? manager.get(shown.connection) : undefined;
    if (!shown || !conn) throw new Error("Open a console first.");
    return { shown, conn };
  };

  /** The statement at the caret, or the selection, of the console on screen. */
  const statementHere = () => {
    const { conn } = here();
    const { text, start, end } = view.editor();
    if (start !== end) return text.slice(start, end).trim();
    const statement = statementAt(split(text, engineOf(conn.engine).dialect), start, text);
    if (!statement) throw new Error("No statement at the caret.");
    return statement.text;
  };

  /** The object a DDL request names: an explorer row, or the arguments. */
  const objectOf = async (/** @type {Node | Record<string, unknown>} */ ref) => {
    if ("kind" in ref && (ref.object || ref.part)) {
      const conn = manager.get(String(ref.connection));
      if (!conn) throw new Error("That connection is gone.");
      return {
        conn,
        object: /** @type {NonNullable<Node["object"] | Node["part"]>} */ (ref.part ?? ref.object),
      };
    }
    const conn = await manager.choose(
      /** @type {string | undefined} */ (ref.connection),
      "Database: which connection?",
    );
    if (!conn || typeof ref.name !== "string" || typeof ref.schema !== "string")
      throw new Error("Pick an object in the explorer (d), or name connection, schema and name.");
    const objects = await catalog.objects(conn, ref.schema);
    const object = objects.find((o) => o.name === ref.name && (!ref.kind || o.kind === ref.kind));
    if (!object) throw new Error(`No ${ref.kind ?? "object"} ${ref.schema}.${ref.name} was found.`);
    return { conn, object };
  };

  return {
    /** Copy the result on screen (or the grid's selection) as a format. */
    async copy(/** @type {string | undefined} */ format) {
      const { set, options } = shownResult();
      const chosen = await formatOf(format, "Database: copy the result as");
      if (!chosen) return undefined;
      const text = formatRows(set, chosen, { ...options, ...picked() });
      view.say(
        view.copy(text)
          ? `Copied as ${label(chosen)}.`
          : "The clipboard refused: select the grid and press Mod+C.",
      );
      return text;
    },
    /** Export the result on screen (or the grid's selection) to a file in ~/Downloads. */
    async exportTo(/** @type {string | undefined} */ format) {
      const { set, options, name } = shownResult();
      const chosen = await formatOf(format, "Database: export the result as");
      if (!chosen) return undefined;
      const done = await exportResult(bridge, {
        set,
        format: chosen,
        name,
        options: { ...options, ...picked() },
      });
      const more = set.truncated ? " (the rows loaded; load more rows first for the rest)" : "";
      view.say(`Exported ${done.rows} rows to ${done.path}${more}.`);
      void deps.commands.run("desk.files.reveal", { path: done.path }).catch(() => {});
      return done.path;
    },
    /** Pick an earlier statement of this connection (searching for `query`) into the editor. */
    async history(/** @type {string | undefined} */ query) {
      const { shown } = here();
      if (shown.kind !== "console") throw new Error("History goes into a console: open one first.");
      const saved = new Set((await readSaved(bridge, shown.connection)).map((s) => s.sql));
      const entries = (await readHistory(bridge, shown.connection)).filter(
        (e) => !query || e.sql.toLowerCase().includes(query.toLowerCase()),
      );
      if (entries.length === 0)
        throw new Error(
          query ? `No statement holds ${query}.` : "Nothing ran on this connection yet.",
        );
      const items = entries.map((e, i) => ({
        id: String(i),
        label: `${saved.has(e.sql) ? "★ " : ""}${oneLine(e.sql)}`,
        detail: `${e.at.slice(0, 16).replace("T", " ")} · ${e.ok ? "" : "failed: "}${e.summary}`,
      }));
      const chosen = await pick("Database: history", items);
      const entry = chosen === undefined ? undefined : entries[Number(chosen)];
      if (entry) view.insert(entry.sql);
      return entry?.sql;
    },
    /** Star the statement at the caret (or the selection) under a name. */
    async star(/** @type {string | undefined} */ name) {
      const { shown } = here();
      const sql = statementHere();
      const given =
        name ?? (await pick("Database: star the query as", [], true, oneLine(sql).slice(0, 60)));
      if (!given) return undefined;
      const kept = await saveQuery(bridge, shown.connection, { name: given, sql });
      view.say(`Starred ${kept}.`);
      return kept;
    },
    /** Pick a starred query into the editor. */
    async starred() {
      const { shown } = here();
      const list = await readSaved(bridge, shown.connection);
      if (list.length === 0)
        throw new Error("No starred queries here yet: star one with Database: star the query.");
      const chosen = await pick(
        "Database: starred queries",
        list.map((s, i) => ({ id: String(i), label: `★ ${s.name}`, detail: oneLine(s.sql) })),
      );
      const entry = chosen === undefined ? undefined : list[Number(chosen)];
      if (entry) view.insert(entry.sql);
      return entry?.sql;
    },
    /** Unstar a query. */
    async unstar(/** @type {string | undefined} */ name) {
      const { shown } = here();
      const list = await readSaved(bridge, shown.connection);
      const chosen =
        name ??
        (await pick(
          "Database: unstar which query?",
          list.map((s) => ({ id: s.name, label: s.name, detail: oneLine(s.sql) })),
        ));
      if (!chosen) return undefined;
      await removeSaved(bridge, shown.connection, chosen);
      view.say(`Unstarred ${chosen}.`);
      return chosen;
    },
    /** Open an object's DDL in a view of its own. */
    async ddl(/** @type {Node | Record<string, unknown>} */ ref) {
      const { conn, object } = await objectOf(ref);
      const text = await catalog.ddl(conn, object);
      const title =
        "table" in object ? `${object.table}.${object.name}` : `${object.schema}.${object.name}`;
      await consoles.openText(conn, title, text);
      return text;
    },
    /** Draw a schema's ER diagram from its foreign keys. */
    async diagram(/** @type {Node | Record<string, unknown>} */ ref) {
      const conn =
        "kind" in ref && typeof ref.connection === "string"
          ? manager.get(ref.connection)
          : await manager.choose(
              /** @type {string | undefined} */ (ref.connection),
              "Database: diagram of which connection?",
            );
      const schema = typeof ref.schema === "string" ? ref.schema : undefined;
      if (!conn || schema === undefined)
        throw new Error("Pick a schema in the explorer (r), or name connection and schema.");
      const diagram = await catalog.diagram(conn, schema);
      await consoles.openDiagram(conn, schema, layout(diagram));
      view.say(`${diagram.tables.length} tables, ${diagram.links.length} foreign keys.`);
      return { tables: diagram.tables.length, links: diagram.links.length };
    },
    /** Count a table's rows, or every table's of a folder or schema, exactly. */
    async countRows(/** @type {Node[]} */ rows, /** @type {Node} */ at) {
      const conn = manager.get(at.connection);
      if (!conn) return undefined;
      const tables =
        at.kind === "table"
          ? [at]
          : rows.filter((r) => r.kind === "table" && r.key.startsWith(`${at.key}\u0000`));
      const names = tables.flatMap((t) =>
        t.object && RELATIONS.has(t.object.kind) && t.object.kind !== "view" ? [t] : [],
      );
      if (names.length === 0)
        throw new Error("Open a table, or a folder of tables, to count their rows.");
      const counts = await catalog.count(
        conn,
        at.schema ?? "",
        names.map((t) => t.label),
      );
      explorer.counted(names.map((t, i) => [t.key, counts[i] ?? null]));
      view.say(`Counted ${names.length} table${names.length === 1 ? "" : "s"}.`);
      return counts;
    },
    /** Find each engine's client again and say what was found. */
    async checkClients() {
      deps.reload(await loadSettings(bridge));
      deps.clients.reset();
      const lines = await Promise.all(
        /** @type {const} */ (["postgresql", "mysql", "sqlite"]).map((engine) =>
          deps.clients.get(engine).then(
            (c) => `${c.command} ${c.version} (${c.flavor})`,
            (error) => (error instanceof Error ? error.message : String(error)),
          ),
        ),
      );
      view.say(lines.join(" · "));
      return lines;
    },
    addHistory,
  };
}

/** A format's name as people say it. */
function label(/** @type {string} */ format) {
  return format === "insert"
    ? "SQL INSERT"
    : format === "update"
      ? "SQL UPDATE"
      : format === "markdown"
        ? "Markdown"
        : format.toUpperCase();
}
