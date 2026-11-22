// From a name in a PostgreSQL console to what it means (PG-32). The statement around the caret is
// bound by the parse worker's resolver (sql/parse/, PG-05) over the schema cache's model (the one
// completion and the problems check use), with the server's default search path. Go to definition
// moves the caret to a CTE, an alias or an output name the statement defines, and opens an object's
// DDL (tools.ddl, as Database: show an object's DDL does); the card says what the cache holds of
// it; find usages asks the server's dependency catalog, scans the routine bodies it does not
// record, and resolves the connection's open consoles, then lists them all in a panel. Nothing but
// find usages asks the server anything. No DOM.
import { problemModel } from "../diagnose/model.js";
import { sqlParser } from "../sql/parse/client.js";
import { cardOf } from "./card.js";
import { findUsages } from "./find.js";
import { aimAt, definitionOf } from "./target.js";

/**
 * @typedef {import("../feature-host.js").Deps} Deps
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {import("./target.js").Hit} Hit
 * @typedef {import("./usages.js").Usage} Usage
 * @typedef {{ text: string, caret: number, offset: number }} Window
 *   The statement around the caret (`caret` in it), starting at `offset` in the console.
 * @typedef {"definition" | "card" | "usages"} What
 * @typedef {{ move?: { from: number, to: number }, card?: import("./card.js").Card,
 *   from?: number, to?: number }} Answer
 *   Offsets in the console: where the caret goes, or where the name the card is of is.
 */

export const PANEL = "usages";

/**
 * The schemas an unqualified type name is looked for in: the search path with `$user` as the user,
 * as sql/parse/scope.js's effectivePath walks it (not imported: that module is the parse worker's,
 * and the page must not load the parser's modules).
 */
export const typePath = (/** @type {string[]} */ searchPath, /** @type {string} */ user) =>
  searchPath.flatMap((s) => (s === "$user" ? (user ? [user] : []) : [s]));
/** The server's default search path; a role's or a database's own is not known until a session says. */
const SEARCH_PATH = ["$user", "public"];
const NOT_PG = "Go to definition, the card and usages read PostgreSQL consoles.";
const NOTHING = "Put the caret on a name the schema holds, a CTE or an alias.";

/** What an aim is called on the status line and in the panel's title. */
export function labelOf(/** @type {Aim} */ aim) {
  if (aim.kind === "column") return `${aim.schema}.${aim.table}.${aim.name}`;
  if (aim.kind === "relation" || aim.kind === "function" || aim.kind === "type")
    return `${aim.schema}.${aim.name}`;
  return aim.name;
}

/**
 * @param {Pick<Deps, "consoles" | "manager" | "catalog" | "tools" | "execute" | "say" | "pick" | "view" | "startWorker">} deps
 * @param {() => ReturnType<typeof sqlParser>} [parser]
 */
export function createNavigator(deps, parser = sqlParser) {
  /** The console on screen, its PostgreSQL connection, its cache and model; a reason otherwise. */
  const here = async () => {
    const shown = deps.consoles.current();
    const conn = shown ? deps.manager.get(shown.connection) : undefined;
    if (!shown || !conn || (shown.kind !== "console" && shown.kind !== "ddl")) return NOTHING;
    if (conn.engine !== "postgresql") return NOT_PG;
    await deps.catalog.cache.open(conn, true).catch(() => undefined);
    const view = deps.catalog.cache.view(conn);
    const model = problemModel(conn.id, view);
    const sql = parser();
    if (!view || !model || !sql) return "The schema of this connection is not read yet.";
    const options = { searchPath: [...SEARCH_PATH], user: conn.user };
    const resolve = (/** @type {string} */ text) => sql.resolve(text, model, options);
    return { shown, conn, view, model, resolve, path: typePath(SEARCH_PATH, conn.user ?? "") };
  };

  /** The aim at the window's caret, with what it was read from. */
  const hitAt = async (/** @type {Window} */ w) => {
    const at = await here();
    if (typeof at === "string") return at;
    const { names } = await at.resolve(w.text);
    const typeIn = (/** @type {string | undefined} */ schema, /** @type {string} */ name) =>
      (schema ? [schema] : at.path).find((s) =>
        at.view.objects(s)?.some((o) => o.kind === "type" && o.name === name),
      ) ?? null;
    const hit = aimAt(names, w.text, w.caret, typeIn);
    return hit ? { ...at, names, hit } : NOTHING;
  };

  /** Open an object's DDL view, a column's table's, a routine's overload picked when it has more. */
  const openDdl = async (
    /** @type {import("../engines/common.js").Connection} */ conn,
    /** @type {import("../schema-cache/view.js").CacheView} */ view,
    /** @type {Aim} */ aim,
  ) => {
    const run = (/** @type {Record<string, unknown>} */ args) =>
      deps.tools.ddl({ connection: conn.id, ...args });
    if (aim.kind === "relation")
      return run({ schema: aim.schema, name: aim.name, kind: aim.relkind || undefined });
    if (aim.kind === "column") return run({ schema: aim.schema, name: aim.table });
    if (aim.kind === "type") return run({ schema: aim.schema, name: aim.name, kind: "type" });
    if (aim.kind === "function") {
      const overloads = (view.routines(aim.schema) ?? []).filter((r) => r.name === aim.name);
      let chosen = overloads[0];
      if (overloads.length > 1) {
        const id = await deps.pick(
          `Database: which ${aim.name}?`,
          overloads.map((r, i) => ({
            id: String(i),
            label: `${r.name}(${r.args})`,
            detail: r.result,
          })),
        );
        if (id === undefined) return undefined;
        chosen = overloads[Number(id)];
      }
      if (!chosen) throw new Error(`The schema cache does not hold ${labelOf(aim)}.`);
      return run({ schema: aim.schema, name: `${chosen.name}(${chosen.args})`, kind: chosen.kind });
    }
    deps.say(`${labelOf(aim)} is a schema: it has no definition to open.`);
    return undefined;
  };

  return {
    /**
     * @param {What} what
     * @param {Window} w
     * @returns {Promise<Answer | null>}
     */
    async run(what, w) {
      const found = await hitAt(w);
      if (typeof found === "string") {
        if (what !== "card") deps.say(found);
        return null;
      }
      const { hit, names, conn, view } = found;
      const span = { from: w.offset + hit.from, to: w.offset + hit.to };
      if (what === "card") {
        const card = cardOf(view, hit.aim);
        return card ? { card, ...span } : null;
      }
      if (what === "definition") {
        const place = definitionOf(w.text, names, hit);
        if (place) return { move: { from: w.offset + place.from, to: w.offset + place.to } };
        await openDdl(conn, view, hit.aim);
        return {};
      }
      const { shown } = found;
      if (hit.aim.kind === "cte" || hit.aim.kind === "alias" || hit.aim.kind === "output") {
        deps.say(`${hit.aim.name} is defined in this statement: F12 goes to it.`);
        return null;
      }
      const state = {
        connection: conn.id,
        of: labelOf(hit.aim),
        kind: hit.aim.kind,
        status: "reading",
        items: /** @type {Usage[]} */ ([]),
        capped: false,
      };
      const consoles = deps.consoles.consoles().filter((c) => c.connection === shown.connection);
      const reading = findUsages(
        { execute: deps.execute, startWorker: deps.startWorker, resolve: found.resolve },
        conn,
        hit.aim,
        consoles,
      );
      const panel = await deps.consoles.openPanel(conn, PANEL, `usages: ${state.of}`, state);
      try {
        const done = await reading;
        deps.consoles.updatePanel(panel.id, { ...state, ...done, status: "done" });
        deps.say(`${done.items.length} usage${done.items.length === 1 ? "" : "s"} of ${state.of}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.consoles.updatePanel(panel.id, { ...state, status: "error", error: message });
      }
      return {};
    },

    /** A usage picked in the panel: its console with the name selected, or the object's DDL. */
    async open(/** @type {string} */ connection, /** @type {Usage} */ usage) {
      if (usage.console) {
        if (!deps.consoles.show(usage.console)) throw new Error("That console was closed.");
        deps.view.select(usage.from ?? 0, usage.to ?? 0);
        return undefined;
      }
      const conn = deps.manager.get(connection);
      if (!conn) throw new Error("That connection is gone.");
      const ddl = (/** @type {Record<string, unknown>} */ args) =>
        deps.tools.ddl({ connection: conn.id, schema: usage.schema, ...args });
      if (usage.kind === "function" || usage.kind === "procedure")
        return ddl({ name: `${usage.name}(${usage.detail ?? ""})`, kind: usage.kind });
      if (usage.kind === "view" || usage.kind === "materialized view")
        return ddl({ name: usage.name, kind: usage.kind });
      if (usage.table) return ddl({ name: usage.table });
      return ddl({ name: usage.name });
    },
  };
}
