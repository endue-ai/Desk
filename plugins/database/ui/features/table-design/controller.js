// The table form's controller (PG-51): one panel per PostgreSQL connection and table (or new table in
// a schema), the server's facts and the table's design read when it opens and on Read again, the
// form's edits kept as the person makes them, what a foreign key may reference read as it is picked
// (from the schema cache through catalog.js), the run (runs.js), the script opened in a console,
// and what the palette and agents are answered. A new table once created opens its own form. No DOM.

import { addColumn, setTable, toggleKey, typeFrom } from "./edits.js";
import { blank } from "./model.js";
import { readForm } from "./read.js";
import { createRuns, refusalOf } from "./runs.js";
import { scriptOf } from "./script.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./read.js").Read} Read
 * @typedef {"columns" | "keys" | "foreign" | "indexes" | "table"} Tab
 * @typedef {{ schemas: string[], tables: Record<string, string[]>, columns: Record<string, string[]> }} Refs
 *   What a foreign key may reference: schemas, a schema's tables, a table's columns (`schema.table`).
 * @typedef {{
 *   conn: { name: string, readOnly: boolean, tag: string }, mode: "create" | "change",
 *   target: { schema: string, name: string }, read: Read | null, design: Design | null,
 *   reading: boolean, error: string, tab: Tab, selected: Record<string, string>,
 *   refs: Refs, run: import("./runs.js").Run | null,
 * }} DesignState
 *   `target` is the table as the server names it (a new table's schema, and no name);
 *   `selected` the item each tab shows.
 */

export const TYPE = "tableDesign";
const about = (/** @type {Connection} */ c) => ({ name: c.name, readOnly: c.readOnly, tag: c.tag });
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** A panel's name: one per connection and table. */
const nameOf = (
  /** @type {Connection} */ conn,
  /** @type {DesignState["target"]} */ t,
  create = false,
) =>
  create
    ? `table: ${conn.name} · new table in ${t.schema}`
    : `table: ${conn.name} · ${t.schema}.${t.name}`;

/** What the form shows, as the palette and agents read it. */
export function answerOf(/** @type {DesignState} */ s) {
  const table =
    s.mode === "create"
      ? `a new table in ${s.target.schema}`
      : `${s.target.schema}.${s.target.name}`;
  if (!s.read || !s.design) return { table, error: s.error };
  const script = scriptOf(s.read.original, s.design, s.read.facts);
  const refused = refusalOf(s);
  return {
    table,
    script: script.text,
    ...(script.problems.length ? { problems: script.problems } : {}),
    ...(refused ? { refused } : {}),
    run: "The person reads the script in the form and runs it there.",
  };
}

/** A command's design arguments on a design: name, comment, owner, columns, primary key. */
export function filled(
  /** @type {Design} */ design,
  /** @type {Record<string, any>} */ args,
  /** @type {Read} */ read,
) {
  let d = design;
  for (const key of /** @type {const} */ (["name", "comment", "owner"]))
    if (typeof args[key] === "string") d = setTable(d, { [key]: args[key] });
  const columns = Array.isArray(args.columns) ? args.columns : [];
  for (const c of columns) {
    if (!c || typeof c.name !== "string") continue;
    const typed = typeFrom(read.facts.types, typeof c.type === "string" ? c.type : "");
    const made = addColumn(d, {
      name: c.name,
      ...typed,
      ...(typeof c.length === "string" ? { length: c.length } : {}),
      nullable: c.notNull !== true,
      default: typeof c.default === "string" ? c.default : "",
      identity: c.identity === "always" || c.identity === "by default" ? c.identity : "",
      comment: typeof c.comment === "string" ? c.comment : "",
    });
    d = made.design;
    if (made.design.columns.at(-1)?.identity)
      d = {
        ...d,
        columns: d.columns.map((x) => (x.id === made.id ? { ...x, nullable: false } : x)),
      };
  }
  const key = Array.isArray(args.primaryKey) ? args.primaryKey : [];
  for (const name of key) {
    const column = d.columns.find((c) => c.name === name);
    if (column) d = toggleKey(d, column.id, true);
  }
  return d;
}

/** @param {Deps} deps */
export function createTableDesign(deps) {
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  /** @returns {DesignState | undefined} */
  const stateOf = (/** @type {string} */ id) => panelOf(id)?.[TYPE];
  const update = (/** @type {string} */ id, /** @type {Partial<DesignState>} */ patch) => {
    const now = stateOf(id);
    if (now) deps.consoles.updatePanel(id, { ...now, ...patch });
  };
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!found || !conn) throw new Error("This form's connection was removed.");
    return { conn, state: /** @type {DesignState} */ (found[TYPE]) };
  };
  const runs = createRuns({ execute: deps.execute, stateOf, update, connOf });

  /** Read the server again; a table's design comes back as the server has it. */
  const refresh = async (/** @type {string} */ id) => {
    const { conn, state } = connOf(id);
    if (state.run?.status === "running")
      throw new Error("The script is running: read again after it.");
    update(id, { reading: true, error: "", conn: about(conn) });
    try {
      const table = state.mode === "change" ? state.target : null;
      const read = await readForm(deps, conn, table);
      const design = read.original ?? stateOf(id)?.design ?? blank(state.target.schema);
      update(id, { read, design, reading: false });
      await refs(id, design.schema).catch(() => {});
      return read;
    } catch (error) {
      update(id, { reading: false, error: words(error) });
      return null;
    }
  };

  /** What a foreign key may reference: the schemas, a schema's tables, a table's columns. */
  const refs = async (
    /** @type {string} */ id,
    /** @type {string} */ schema,
    /** @type {string} */ table = "",
  ) => {
    const { conn, state } = connOf(id);
    const now = state.refs;
    const schemas = now.schemas.length ? now.schemas : await deps.catalog.schemas(conn);
    const tables = { ...now.tables };
    if (schema && !tables[schema])
      tables[schema] = (await deps.catalog.objects(conn, schema))
        .filter((o) => o.kind === "table")
        .map((o) => o.name);
    const columns = { ...now.columns };
    const key = `${schema}.${table}`;
    if (table && !columns[key])
      columns[key] = (await deps.catalog.columns(conn, schema, table)).map((c) => c.name);
    update(id, { refs: { schemas, tables, columns } });
  };

  /** Open (or show again) a form, read it, fill it from a command's arguments, answer it. */
  const openFor = async (
    /** @type {Connection} */ conn,
    /** @type {"create" | "change"} */ mode,
    /** @type {DesignState["target"]} */ target,
    /** @type {Record<string, any>} */ args = {},
  ) => {
    if (conn.engine !== "postgresql")
      throw new Error(
        "The table form is PostgreSQL's: on MySQL and SQLite, write the CREATE or ALTER in a console.",
      );
    const name = nameOf(conn, target, mode === "create");
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    /** @type {DesignState} */
    const base = kept ?? {
      conn: about(conn),
      mode,
      target,
      read: null,
      design: null,
      reading: false,
      error: "",
      tab: "columns",
      selected: {},
      refs: { schemas: [], tables: {}, columns: {} },
      run: null,
    };
    const panel = await deps.consoles.openPanel(conn, TYPE, name, { ...base, conn: about(conn) });
    const read = kept?.read ?? (await refresh(panel.id));
    const now = /** @type {DesignState} */ (stateOf(panel.id));
    if (!read || !now.design) throw new Error(now.error || "Not read.");
    const given =
      Object.keys(args).some((k) => ["columns", "primaryKey", "comment", "owner"].includes(k)) ||
      (mode === "create" && typeof args.name === "string");
    if (given) update(panel.id, { design: filled(now.design, args, read), run: null });
    deps.say(
      mode === "create"
        ? `A new table in ${target.schema} on ${conn.name}: its script shows as the form fills.`
        : `${target.schema}.${target.name} on ${conn.name}: change its design, the script shows what runs.`,
    );
    return answerOf(/** @type {DesignState} */ (stateOf(panel.id)));
  };

  /** Run a form's script; a new table created opens its own form. */
  const run = async (/** @type {string} */ id, dry = false) => {
    const done = await runs.run(id, { dry });
    const { conn, state } = connOf(id);
    if (done.ok && !dry) {
      const design = /** @type {Design} */ (state.design);
      if (state.mode === "create") {
        deps.say(`Created ${design.schema}.${design.name}.`);
        // Its own form, to change it next; a read that fails says why and leaves this one.
        await openFor(conn, "change", { schema: design.schema, name: design.name }).catch((e) =>
          deps.say(`Created ${design.schema}.${design.name}; its form did not open: ${words(e)}`),
        );
      } else {
        const target = { schema: design.schema, name: design.name };
        update(id, { target });
        await refresh(id);
        deps.say(`Changed ${target.schema}.${target.name}.`);
      }
    } else deps.say(done.message);
    return done;
  };

  /** Open the form's script in a console of its own. */
  const toConsole = async (/** @type {string} */ id) => {
    const { conn, state } = connOf(id);
    if (!state.read || !state.design) throw new Error(state.error || "The table is not read yet.");
    const { text } = scriptOf(state.read.original, state.design, state.read.facts);
    if (!text) throw new Error("The script is empty: nothing changes yet.");
    await deps.consoles.openNew(conn);
    const label =
      state.mode === "create"
        ? `new table in ${state.target.schema}`
        : `${state.target.schema}.${state.target.name}`;
    await deps.consoles.rename(`table · ${label}`);
    const now = deps.view.editor().text;
    deps.view.replace(0, now.length, text);
    deps.consoles.edited(text);
    deps.view.select(0, 0);
    deps.say("The script is in a console: Database: run all runs it there.");
    return text;
  };

  /** The form on screen, for the palette's commands. */
  const shown = () => {
    const here = deps.consoles.current();
    if (here?.kind !== TYPE)
      throw new Error(
        "No table form on screen: open one with Database: create a table or change a table.",
      );
    return here.id;
  };

  return {
    openFor,
    refresh,
    refs,
    run,
    toConsole,
    shown,
    stateOf,
    /** Keep the form's edits (and which tab and item it shows). */
    edit(
      /** @type {string} */ id,
      /** @type {Partial<Pick<DesignState, "design" | "tab" | "selected">>} */ patch,
    ) {
      const { state } = connOf(id);
      if (state.run?.status === "running") throw new Error("The script is running: wait for it.");
      update(id, { ...patch, ...(patch.design ? { run: null } : {}) });
    },
  };
}
