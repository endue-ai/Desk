// The server overview (PG-72): Database: server overview reads a PostgreSQL connection's sizes,
// unused, duplicate and invalid indexes, sequential scans, dead rows and vacuum, transaction id
// age, cache hits, heaviest statements, long transactions, replication, slots and changed settings
// (read.js, sections.js) into one panel per connection (panel.js), drawn again by Refresh. A
// section opens in the connection's console as a normal result (copy, export), and a heavy
// statement opens there unrun. It only reads, and keeps nothing across a restart. No DOM here.

import { engineOf } from "../../engines/index.js";
import { oneLine } from "../../execute.js";
import { keepable } from "../../history.js";
import { agentsOf } from "../audit/agents.js";
import { MASK, namesOf } from "../audit/mask.js";
import { formatValue } from "./format.js";
import { overviewView } from "./panel.js";
import { readOverview } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./read.js").OverviewState} OverviewState
 */

const TYPE = "overview";
const HIDDEN = "<insufficient privilege>";

/** The agent reads the same sections without opening a panel or returning server statement text. */
async function forAgent(/** @type {Deps} */ deps, /** @type {unknown} */ ref) {
  const conn = typeof ref === "string" ? deps.manager.get(ref) : undefined;
  if (conn?.engine !== "postgresql")
    throw new Error("Name a PostgreSQL connection for the overview.");
  const access = await agentsOf(deps.bridge)?.access.of(conn.id);
  if (access?.closed) throw new Error(`${conn.name} is closed to agents.`);
  const sensitive = namesOf(access?.sensitive ?? []);
  const quiet = (
    /** @type {Connection} */ c,
    /** @type {string} */ sql,
    /** @type {import("../../execute.js").ExecuteOptions} */ opts,
  ) =>
    deps.execute(c, sql, {
      ...opts,
      interactive: false,
      permissionsReviewed: true,
      maxRows: Math.min(opts?.maxRows ?? 100, 100),
    });
  const result = await readOverview(quiet, { ...conn, readOnly: true });
  const server = result.server;
  return {
    connection: conn.id,
    server: server
      ? { version: server.version, database: server.database, standby: server.standby }
      : null,
    sections: result.sections.map(({ id, names = [], rows = [], failed }) => ({
      id,
      columns: names,
      rows: rows.map((row) =>
        row.map((value, index) => {
          const name = (names[index] ?? "").toLowerCase();
          return sensitive.has(name) ||
            /query|statement|sql/u.test(name) ||
            (value !== null && !keepable(value))
            ? MASK
            : (value?.slice(0, 1000) ?? null);
        }),
      ),
      ...(failed ? { unavailable: true } : {}),
    })),
  };
}

/** @param {Deps} deps */
function createOverview(deps) {
  const { consoles, manager, view } = deps;
  /** @type {Set<string>} */
  const reading = new Set();
  const bufferOf = (/** @type {string} */ id) =>
    consoles.list().find((b) => b.kind === TYPE && b.connection === id);

  /** A connection named, else the one whose overview is on screen, else one picked. */
  const target = async (/** @type {unknown} */ ref, shownFirst = true) => {
    if (typeof ref === "string" && ref) return manager.choose(ref, "");
    if (!shownFirst) return manager.choose(undefined, "Database: overview of which connection?");
    const shown = consoles.current();
    const conn = shown?.kind === TYPE ? manager.get(shown.connection) : undefined;
    return conn ?? manager.choose(undefined, "Database: overview of which connection?");
  };

  /** Read a connection's overview into its panel, opening the panel the first time. */
  const read = async (/** @type {unknown} */ ref, shownFirst = true) => {
    const conn = await target(ref, shownFirst);
    if (!conn) return undefined;
    if (conn.engine !== "postgresql")
      throw new Error(
        `The overview reads PostgreSQL's statistics: ${conn.name} is a ${engineOf(conn.engine).title} connection.`,
      );
    if (reading.has(conn.id)) return `The overview of ${conn.name} is being read.`;
    reading.add(conn.id);
    const { failed: _, ...before } = /** @type {OverviewState} */ (
      bufferOf(conn.id)?.[TYPE] ?? {
        connection: conn.id,
        name: conn.name,
        server: null,
        sections: [],
        at: Date.now(),
      }
    );
    const shown = await consoles.openPanel(conn, TYPE, `overview: ${conn.name}`, {
      ...before,
      reading: true,
    });
    try {
      const state = await readOverview(deps.execute, conn);
      consoles.updatePanel(shown.id, state);
      const failed = state.sections.filter((s) => s.failed).length;
      const said = `Read ${state.sections.length - failed} of ${state.sections.length} sections of ${conn.name}${
        failed ? `; ${failed} could not be read.` : "."
      }`;
      deps.say(said);
      return said;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consoles.updatePanel(shown.id, { ...before, reading: false, failed: message });
      throw error;
    } finally {
      reading.delete(conn.id);
    }
  };

  /** The overview a command means, read already. */
  const overviewOf = async (/** @type {unknown} */ ref) => {
    const conn = await target(ref);
    if (!conn) return undefined;
    const state = /** @type {OverviewState | undefined} */ (bufferOf(conn.id)?.[TYPE]);
    if (!state?.server)
      throw new Error(`Read the overview of ${conn.name} first (Database: server overview).`);
    return { conn, state };
  };

  /** Run a section's SQL in the connection's console: its rows come back as a result. */
  const result = async (/** @type {unknown} */ ref, /** @type {unknown} */ id) => {
    const found = await overviewOf(ref);
    if (!found) return undefined;
    const { conn, state } = found;
    const runnable = state.sections.filter((s) => s.sql && !s.missing);
    const named = typeof id === "string" && id ? id.toLowerCase() : "";
    let section = named
      ? state.sections.find((s) => s.id === named || s.title.toLowerCase() === named)
      : undefined;
    if (named && !section) throw new Error(`The overview has no section ${id}.`);
    if (!section) {
      const picked = await deps.pick(
        "Database: open which section in the console?",
        runnable.map((s) => ({ id: s.id, label: s.title, detail: s.source })),
      );
      section = runnable.find((s) => s.id === picked);
      if (!section) return undefined;
    }
    if (!section.sql || section.missing)
      throw new Error(`${section.title} runs nothing: ${section.missing ?? "it has no SQL."}`);
    await consoles.open(conn);
    const text = `${section.sql};`;
    view.insert(text);
    const { end } = view.editor();
    view.select(Math.max(0, end - text.length), end);
    return consoles.run("statement");
  };

  /** Put one of the heaviest statements in the connection's console, unrun. */
  const statement = async (/** @type {unknown} */ ref, /** @type {unknown} */ index) => {
    const found = await overviewOf(ref);
    if (!found) return undefined;
    const { conn, state } = found;
    const section = state.sections.find((s) => s.id === "statements");
    const rows = section?.rows ?? [];
    if (!section || rows.length === 0)
      throw new Error(section?.missing ?? section?.failed ?? "pg_stat_statements listed nothing.");
    const names = section.names ?? [];
    const col = (/** @type {string} */ key, /** @type {(string | null)[]} */ row) =>
      row[names.indexOf(key)] ?? null;
    let at = typeof index === "number" || typeof index === "string" ? Number(index) : Number.NaN;
    if (Number.isNaN(at)) {
      const picked = await deps.pick(
        "Database: open which statement in the console?",
        rows.map((row, i) => ({
          id: String(i),
          label: oneLine(col("query", row) ?? ""),
          detail: `${formatValue("ms", col("total_ms", row))} in all, ${formatValue("count", col("calls", row))} calls`,
        })),
      );
      if (picked === undefined) return undefined;
      at = Number(picked);
    }
    const text = rows[at] ? col("query", /** @type {(string | null)[]} */ (rows[at])) : null;
    if (!text) throw new Error(`The list has no statement ${at + 1}.`);
    if (text === HIDDEN)
      throw new Error(
        `Statement ${at + 1} is another role's: ${state.server?.role ?? "this role"} may not read its text. A member of pg_read_all_stats may.`,
      );
    await consoles.open(conn);
    view.insert(text.trimEnd().endsWith(";") ? text : `${text.trimEnd()};`);
    const said = `Statement ${at + 1} is in the console of ${conn.name}${
      /\$\d/u.test(text) ? ": its parameters are asked for when it runs." : "."
    }`;
    deps.say(said);
    return said;
  };

  return { read, result, statement };
}

/** One overview a deps, shared by the commands and the actions. */
const made = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  if (!made.has(deps)) made.set(deps, createOverview(deps));
  return /** @type {ReturnType<typeof createOverview>} */ (made.get(deps));
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "overview",
  commands: (deps) => ({
    "endue.database.overview": ({ connection }, invocation) =>
      /^(agent|mcp):/u.test(invocation?.caller ?? "")
        ? forAgent(deps, connection)
        : of(deps).read(connection, false),
    "endue.database.refresh-overview": ({ connection }) => of(deps).read(connection),
    "endue.database.overview-result": ({ connection, section }) =>
      of(deps).result(connection, section),
    "endue.database.overview-statement": ({ connection, index }) =>
      of(deps).statement(connection, index),
  }),
  actions: (deps) => ({
    overviewRefresh: (/** @type {string} */ connection) => of(deps).read(connection),
    overviewResult: (/** @type {string} */ connection, /** @type {string} */ id) =>
      of(deps).result(connection, id),
    overviewStatement: (/** @type {string} */ connection, /** @type {number} */ index) =>
      of(deps).statement(connection, index),
  }),
  panels: {
    [TYPE]: {
      label: "Server overview",
      render: (doc, /** @type {OverviewState} */ state, act, buffer) =>
        overviewView(doc, state, act, buffer),
    },
  },
  styles: [new URL("./overview.css", import.meta.url).href],
};
