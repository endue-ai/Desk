// The activity panels' controller: one panel per PostgreSQL connection, read when it opens, on a
// refresh (the person's, a command's or the panel's period; one read at a time per panel) and
// after a cancel or an end, keeping the person's filters, sort, selection and period across reads.
// A cancel or an end reads the server first, so the question shows the statement the session runs
// now. index.js's commands and actions call it. No DOM.

import { engineOf } from "../../engines/index.js";
import { oneLine } from "../../execute.js";
import { DEFAULT_VIEW, isBackground, PERIODS, SORT_KEYS, saidOf, summaryOf } from "./model.js";
import { createReader } from "./read.js";
import { nothingToCancel, refusal, stop } from "./signal.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Read} Read
 * @typedef {import("./signal.js").How} How
 * @typedef {{
 *   read: Read | null, error: string, reading: boolean,
 *   filters: import("./model.js").Filters, sort: import("./model.js").Sort,
 *   selected: number | null, whole: boolean, period: number, paused: boolean,
 *   conn: { name: string, readOnly: boolean, tag: string },
 * }} ActivityState
 *   `whole` shows the selected session's whole statement; `conn` is what the panel says of it.
 */

export const TYPE = "activity";

const about = (/** @type {Connection} */ c) => ({ name: c.name, readOnly: c.readOnly, tag: c.tag });
/** @returns {ActivityState} */
const fresh = (/** @type {Connection} */ conn) => ({
  read: null,
  error: "",
  reading: false,
  ...structuredClone(DEFAULT_VIEW),
  selected: null,
  whole: false,
  period: 5,
  paused: false,
  conn: about(conn),
});
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** A process id from a caller, or undefined when none is named. */
function pidOf(/** @type {unknown} */ value) {
  if (value === undefined || value === null || value === "") return undefined;
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("A session is named by its process id, a whole number.");
  return pid;
}

/**
 * The process ids of the plugin's sessions on this desk to a connection's server (db.list), so
 * the view marks them; none when the list cannot be had.
 * @param {Deps["bridge"]} bridge
 * @param {Connection} conn
 */
async function mineOf(bridge, conn) {
  const host = (conn.host || "localhost").toLowerCase();
  const port = conn.port ?? 5432;
  try {
    const listed = /** @type {{ sessions?: { host: string, port: number, pid: number }[] }} */ (
      await bridge.call("db.list", {})
    );
    return (listed.sessions ?? [])
      .filter((s) => s.host.toLowerCase() === host && s.port === port)
      .map((s) => s.pid);
  } catch {
    return [];
  }
}

/** @param {Deps} deps */
export function createActivity(deps) {
  const reader = createReader({
    execute: deps.execute,
    mine: (conn) => mineOf(deps.bridge, conn),
  });
  /** @type {Map<string, Promise<Read | null>>} */
  const inFlight = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  const update = (/** @type {string} */ id, /** @type {Partial<ActivityState>} */ patch) => {
    const found = panelOf(id);
    if (found) deps.consoles.updatePanel(id, { ...found[TYPE], ...patch });
  };

  const postgres = (/** @type {Connection} */ conn) => {
    if (conn.engine !== "postgresql")
      throw new Error(
        `${conn.name} is ${engineOf(conn.engine).title}: sessions and locks are read from PostgreSQL connections.`,
      );
    return conn;
  };
  /** The connection named, else the one on screen, the only one or one picked. */
  const choose = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref !== "") {
      const conn = deps.manager.get(ref);
      if (!conn) throw new Error(`No connection is named ${ref}.`);
      return postgres(conn);
    }
    const shown = deps.consoles.current();
    const here = shown ? deps.manager.get(shown.connection) : undefined;
    if (here?.engine === "postgresql") return here;
    const list = deps.manager.list().filter((c) => c.engine === "postgresql");
    if (list.length === 0)
      throw new Error("No PostgreSQL connection yet: add one with Database: new connection.");
    if (list.length === 1) return list[0];
    const items = list.map((c) => ({
      id: c.id,
      label: c.name,
      ...(c.tag !== "none" ? { detail: c.tag } : {}),
    }));
    const picked = await deps.pick("Database: server activity of which connection?", items);
    return picked ? deps.manager.get(picked) : undefined;
  };

  /** Read a panel's connection again; `again` waits for a read in flight and reads once more. */
  const refresh = async (/** @type {string} */ id, again = false) => {
    const running = inFlight.get(id);
    if (running && !again) return running;
    if (running) await running;
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!found || !conn) return null;
    const work = (async () => {
      update(id, { reading: true, conn: about(conn) });
      try {
        const read = await reader.read(conn);
        update(id, { read, error: "", reading: false });
        return read;
      } catch (error) {
        update(id, { error: words(error), reading: false });
        return null;
      }
    })();
    inFlight.set(id, work);
    try {
      return await work;
    } finally {
      if (inFlight.get(id) === work) inFlight.delete(id);
    }
  };

  /** Open (or show again) a connection's panel, read it, and answer what it shows. */
  const open = async (/** @type {Record<string, unknown>} */ args) => {
    const conn = await choose(args.connection);
    if (!conn) return undefined;
    const name = `${TYPE}: ${conn.name}`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    const state = kept ? { ...kept, conn: about(conn) } : fresh(conn);
    const panel = await deps.consoles.openPanel(conn, TYPE, name, state);
    const read = await refresh(panel.id, true);
    if (!read) throw new Error(panelOf(panel.id)?.[TYPE].error || "Not read.");
    deps.say(saidOf(conn.name, read));
    return summaryOf(read);
  };

  /** Pick a session to cancel or end from a fresh read. */
  const pickSession = async (
    /** @type {How} */ how,
    /** @type {Connection} */ conn,
    /** @type {Read} */ read,
  ) => {
    const can = read.sessions.filter(
      (s) => s.own !== "view" && !isBackground(s) && (how === "end" || !nothingToCancel(s)),
    );
    if (can.length === 0)
      throw new Error(
        how === "cancel"
          ? `No session on ${conn.name} runs a statement now.`
          : `No other session on ${conn.name}.`,
      );
    const items = can.map((s) => {
      const detail = s.hidden ? "statement hidden" : oneLine(s.query ?? "");
      const label = `${s.pid} · ${s.user ?? "another role"} · ${s.application || "no application"} · ${s.state ?? "state hidden"}`;
      return { id: String(s.pid), label, ...(detail ? { detail } : {}) };
    });
    const title =
      how === "cancel"
        ? "Database: cancel the statement of which session?"
        : "Database: end which session?";
    const picked = await deps.pick(title, items);
    return picked === undefined ? undefined : pidOf(picked);
  };

  /** Cancel or end a session of a connection: the one named, selected on screen, or picked. */
  const stopSession = async (
    /** @type {How} */ how,
    /** @type {Record<string, unknown>} */ args,
    /** @type {Connection} */ from = undefined,
  ) => {
    const conn = from ?? (await choose(args.connection));
    if (!conn) return undefined;
    const refused = refusal(conn);
    if (refused) throw new Error(refused);
    let pid = pidOf(args.pid);
    const shown = deps.consoles.current();
    if (pid === undefined && shown?.kind === TYPE && shown.connection === conn.id)
      pid = shown[TYPE].selected ?? undefined;
    const read = await reader.read(conn);
    pid ??= await pickSession(how, conn, read);
    if (pid === undefined) return undefined;
    const session = read.sessions.find((s) => s.pid === pid);
    if (!session) throw new Error(`No session ${pid} on ${conn.name}: it may have ended.`);
    deps.say(await stop(deps, how, conn, session, read.version));
    for (const panel of panels().filter((b) => b.connection === conn.id))
      await refresh(panel.id, true);
    return { pid, done: how === "cancel" ? "cancelled" : "ended" };
  };

  /** Change what a panel shows (filters, sort, selection, period, pause); nothing is read. */
  const view = (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
    const found = panelOf(id);
    if (!found) return;
    /** @type {ActivityState} */
    const now = found[TYPE];
    const next = { ...now };
    if (patch.filters) {
      const { idle, own, system, database } = patch.filters;
      next.filters = {
        ...now.filters,
        ...(typeof idle === "boolean" ? { idle } : {}),
        ...(typeof own === "boolean" ? { own } : {}),
        ...(typeof system === "boolean" ? { system } : {}),
        ...(typeof database === "string" ? { database } : {}),
      };
    }
    if (patch.sort) {
      if (!SORT_KEYS.includes(patch.sort.key))
        throw new Error(`No column sorts by ${patch.sort.key}.`);
      next.sort = { key: patch.sort.key, desc: patch.sort.desc === true };
    }
    if ("selected" in patch) {
      next.selected = patch.selected === null ? null : (pidOf(patch.selected) ?? null);
      if (next.selected !== now.selected) next.whole = false;
    }
    if ("whole" in patch) next.whole = patch.whole === true;
    if ("period" in patch) {
      if (!PERIODS.includes(patch.period))
        throw new Error(
          `The activity refreshes every ${PERIODS.slice(0, -1).join(", ")} or ${PERIODS.at(-1)} seconds.`,
        );
      next.period = patch.period;
    }
    if ("paused" in patch) next.paused = patch.paused === true;
    deps.consoles.updatePanel(id, next);
  };

  /** A refresh by command: the panel on screen, else the connection's panel, opened. */
  const refreshCommand = async (/** @type {Record<string, unknown>} */ args) => {
    const shown = deps.consoles.current();
    if (args.connection || shown?.kind !== TYPE) return open(args);
    const read = await refresh(shown.id, true);
    if (!read) throw new Error(panelOf(shown.id)?.[TYPE].error || "Not read.");
    return summaryOf(read);
  };

  /** Cancel or end from a panel: its connection, the session named. */
  const stopFrom = (
    /** @type {string} */ id,
    /** @type {How} */ how,
    /** @type {unknown} */ pid,
  ) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!conn) throw new Error("This panel's connection was removed.");
    return stopSession(how, { pid }, conn);
  };

  return { open, refresh, refreshCommand, view, stopSession, stopFrom };
}
