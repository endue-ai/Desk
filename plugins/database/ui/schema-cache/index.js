// The schema cache (PG-06, ADR 0285): a PostgreSQL connection's schemas, relations, columns, keys,
// foreign keys, indexes, triggers, routine signatures and comments, read in one pass of a bounded
// number of statements (pass.js), kept in the plugin's store (store.js) and read back at the next
// start. The first use in a session answers from the store at once and checks each schema's
// fingerprint behind it; a DDL statement run from the plugin checks again; only the schemas whose
// fingerprint moved are read. An explicit reload reads every chosen schema. One pass at a time per
// connection; requests made meanwhile run once after it. Other engines are not cached. No DOM.

import { DATABASE, isSystem, marksSql, POSTGRES_KINDS, signature } from "./kinds.js";
import { staleReferences } from "./model.js";
import { Cancelled, runPass } from "./pass.js";
import { clear, persist, restore } from "./store.js";
import { isChosen, readAtText, viewOf } from "./view.js";

export { DATABASE, isSystem, readAtText };

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../execute.js").Execution} Execution
 * @typedef {import("./kinds.js").Kind} Kind
 * @typedef {import("./view.js").Status} Status
 * @typedef {import("./view.js").CacheView} CacheView
 * @typedef {{ all?: boolean, schemas?: string[], quiet?: boolean }} Request
 *   `all` reads every chosen schema; `schemas` those whatever their fingerprint; `quiet` never asks
 *   for a password.
 * @typedef {{ statements: number, read: string[], database?: true }} Report
 *   `read` names the schemas read; `database` is there when the database level was read too.
 * @typedef {import("./view.js").Held & {
 *   conn: Connection, where: string, kinds: readonly Kind[], check: "" | "done" | "failed" | "quiet",
 *   error: Error | null, opened: boolean, restoring: Promise<void> | null,
 *   running: Promise<Report> | null, waiting: { request: Request, done: Promise<Report> } | null,
 *   generation: number, written: (string | null)[], saving: Promise<void>,
 * }} Entry
 */

/** @type {Partial<Record<import("../engines/common.js").EngineId, readonly Kind[]>>} */
const KINDS = { postgresql: POSTGRES_KINDS };

/** What tells two servers apart in the store: never a password. */
export const whereOf = (/** @type {Connection} */ conn) =>
  [conn.engine, conn.host, conn.port ?? "", conn.database, conn.user].join("|");

/** Whether a DDL statement of a run (not a dry run) ran without an error. */
export const ranDdl = (/** @type {Execution} */ execution) =>
  execution.mode !== "dry-run" &&
  execution.result.statements.some(
    (s) => s.ran && !s.error && execution.classes[s.index]?.kind === "ddl",
  );

/** What is kept first past the cap: the database level, the default schema, then by name. */
const rank = (/** @type {string} */ name) => (name === DATABASE ? 0 : name === "public" ? 1 : 2);
const keepOrder = (/** @type {{ name: string }} */ a, /** @type {{ name: string }} */ b) =>
  rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {{
 *   execute: import("./pass.js").Execute,
 *   store: import("./store.js").Store,
 *   systemSchemas(): boolean,
 *   changed(connection: string): void,
 *   now?(): number,
 * }} deps `changed` is called when a connection's cache or its status changes.
 */
export function createSchemaCache(deps) {
  const now = deps.now ?? (() => Date.now());
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  const cached = (/** @type {Connection} */ conn) => KINDS[conn.engine] !== undefined;

  /** The connection's entry, a fresh one when it now points at another server. */
  const entryOf = (/** @type {Connection} */ conn) => {
    const where = whereOf(conn);
    let entry = entries.get(conn.id);
    if (!entry || entry.where !== where) {
      entry = {
        conn,
        where,
        kinds: KINDS[conn.engine] ?? [],
        schemas: new Map(),
        all: [],
        chosen: null,
        over: new Set(),
        readAt: null,
        status: { state: "idle" },
        note: "",
        check: "",
        error: null,
        opened: false,
        restoring: null,
        running: null,
        waiting: null,
        generation: 0,
        written: [],
        saving: Promise.resolve(),
      };
      entries.set(conn.id, entry);
    }
    entry.conn = conn;
    return entry;
  };
  const tell = (/** @type {Entry} */ entry) => deps.changed(entry.conn.id);

  /** The entry with what the store kept, read once. */
  const restored = async (/** @type {Connection} */ conn) => {
    const entry = entryOf(conn);
    entry.restoring ??= restore(deps.store, conn.id, {
      where: entry.where,
      kinds: signature(entry.kinds),
    }).then(
      (kept) => {
        if (!kept || entries.get(conn.id) !== entry) return;
        entry.chosen = kept.chosen;
        entry.all = kept.all;
        entry.readAt = kept.readAt;
        entry.written = kept.written;
        for (const schema of kept.schemas)
          if (!entry.schemas.has(schema.name)) entry.schemas.set(schema.name, schema);
        tell(entry);
      },
      () => {},
    );
    await entry.restoring;
    return entry;
  };

  /** Write the entry to the store, after any write before it. */
  const save = (/** @type {Entry} */ entry) => {
    entry.saving = entry.saving
      .then(async () => {
        if (entries.get(entry.conn.id) !== entry) return;
        const done = await persist(deps.store, entry.conn.id, {
          where: entry.where,
          kinds: signature(entry.kinds),
          chosen: entry.chosen,
          all: entry.all,
          readAt: entry.readAt,
          schemas: [...entry.schemas.values()].sort(keepOrder),
          written: entry.written,
        });
        entry.written = done.written;
        entry.over = new Set(done.over);
        entry.note = "";
      })
      .catch((error) => {
        entry.note = `Not kept: ${messageOf(error)}`;
      });
    return entry.saving;
  };

  /** One pass: marks, then the kinds of the schemas the request and the marks call for. */
  const pass = async (
    /** @type {Entry} */ entry,
    /** @type {Request} */ request,
    generation = 0,
  ) => {
    const set = (/** @type {Status} */ status) => {
      entry.status = status;
      tell(entry);
    };
    /** @type {import("./pass.js").PassRun} */
    const run = {
      execute: deps.execute,
      conn: entry.conn,
      kinds: entry.kinds,
      marksSql: marksSql(entry.kinds),
      quiet: request.quiet === true,
      progress: (p) => set({ state: "reading", ...p }),
      stopped: () => generation !== entry.generation,
    };
    try {
      let result = await runPass(run, (listed) =>
        listed
          .filter((s) => isChosen(entry.chosen, s.name, s.system))
          .filter(
            (s) =>
              request.all ||
              request.schemas?.includes(s.name) ||
              entry.schemas.get(s.name)?.mark !== s.mark,
          )
          .map((s) => s.name),
      );
      const readAt = now();
      /** @type {Entry["schemas"]} */
      let next = new Map();
      const merge = (/** @type {import("./pass.js").PassResult} */ done) => {
        /** @type {Entry["schemas"]} */
        const merged = new Map();
        for (const s of done.listed) {
          if (!isChosen(entry.chosen, s.name, s.system)) continue;
          const data = done.read.get(s.name);
          const old = next.get(s.name) ?? entry.schemas.get(s.name);
          if (data) merged.set(s.name, { name: s.name, mark: s.mark, readAt, data });
          else if (old) merged.set(s.name, old);
        }
        next = merged;
      };
      merge(result);
      const listedNow = new Set(result.listed.map((s) => s.name));
      const gone = new Set(entry.all.map(([name]) => name).filter((name) => !listedNow.has(name)));
      const again = staleReferences(next, new Set(result.read.keys()), gone);
      if (again.length > 0) {
        const first = result;
        result = await runPass(run, (listed) =>
          listed.filter((s) => again.includes(s.name)).map((s) => s.name),
        );
        merge(result);
        result = {
          listed: result.listed,
          read: new Map([...first.read, ...result.read]),
          statements: first.statements + result.statements,
        };
      }
      entry.schemas = next;
      entry.all = result.listed.map((s) => [s.name, s.system ? "s" : ""]);
      entry.readAt = readAt;
      entry.check = "done";
      entry.error = null;
      await save(entry);
      set({ state: "idle" });
      const names = [...result.read.keys()];
      return {
        statements: result.statements,
        read: names.filter((name) => name !== DATABASE),
        ...(result.read.has(DATABASE) ? { database: /** @type {const} */ (true) } : {}),
      };
    } catch (error) {
      entry.check = request.quiet ? "quiet" : "failed";
      entry.error = error instanceof Error ? error : new Error(messageOf(error));
      if (error instanceof Cancelled) set({ state: "cancelled", message: "Cancelled." });
      else set({ state: "error", message: messageOf(error) });
      throw error;
    }
  };

  /**
   * Read again what the request asks: once the pass going on ends, merged with any other request
   * made meanwhile.
   * @param {Connection} conn
   * @param {Request} [request]
   * @returns {Promise<Report>}
   */
  const refresh = (conn, request = {}) => {
    const entry = entryOf(conn);
    const { waiting } = entry;
    if (waiting) {
      const was = waiting.request;
      waiting.request = {
        all: was.all || request.all,
        ...(was.schemas || request.schemas
          ? { schemas: [...(was.schemas ?? []), ...(request.schemas ?? [])] }
          : {}),
        quiet: was.quiet === true && request.quiet === true,
      };
      return waiting.done;
    }
    const generation = entry.generation;
    const before = entry.running?.catch(() => {}) ?? restored(conn);
    /** @type {{ request: Request, done: Promise<Report> }} */
    const job = { request, done: Promise.resolve({ statements: 0, read: [] }) };
    job.done = before.then(() => {
      if (entry.waiting === job) entry.waiting = null;
      return pass(entry, job.request, generation);
    });
    if (entry.running) entry.waiting = job;
    entry.running = job.done;
    job.done.then(
      () => {
        if (entry.running === job.done) entry.running = null;
      },
      () => {
        if (entry.running === job.done) entry.running = null;
      },
    );
    return job.done;
  };

  return {
    /** Whether a connection's engine is cached (PostgreSQL). */
    cached,
    /**
     * Have the connection's cache in memory: from the store, else from a first pass. The first use
     * in a session also checks the fingerprints, behind the answer when the store held one.
     */
    async open(/** @type {Connection} */ conn, quiet = false) {
      const entry = await restored(conn);
      entry.opened = true;
      const start = entry.check === "" || (entry.check === "quiet" && !quiet);
      const job = start && !entry.running ? refresh(conn, { quiet }) : entry.running;
      if (entry.schemas.size > 0 || entry.all.length > 0) {
        job?.catch(() => {});
        return;
      }
      if (!job) {
        if (entry.error) throw entry.error;
        return;
      }
      try {
        await job;
      } catch (error) {
        // A quiet pass could not ask for a password; this one may.
        if (quiet || entry.check !== "quiet") throw error;
        await refresh(conn, {});
      }
    },
    refresh,
    /** A run of the plugin's own: when a DDL statement in it ran, check the fingerprints. */
    ran(/** @type {Connection} */ conn, /** @type {Execution} */ execution) {
      const entry = entries.get(conn.id);
      if (!entry?.opened || !ranDdl(execution)) return false;
      refresh(conn, { quiet: true }).catch(() => {});
      return true;
    },
    /** Read only these schemas (null: every one but the system ones) from now on. */
    async choose(/** @type {Connection} */ conn, /** @type {string[] | null} */ schemas) {
      const entry = await restored(conn);
      entry.chosen = schemas ? [...new Set(schemas)].sort() : null;
      await save(entry);
      return refresh(conn, {});
    },
    /** Stop the passes going on (of one connection, or of all) before their next statement. */
    cancel(/** @type {string | undefined} */ connection) {
      for (const [id, entry] of entries)
        if ((connection === undefined || id === connection) && entry.running) entry.generation++;
    },
    /** A connection was removed: forget its cache here and in the store. */
    async drop(/** @type {string} */ connection) {
      const entry = entries.get(connection);
      if (entry) entry.generation++;
      entries.delete(connection);
      await clear(deps.store, connection);
    },
    /** What the cache answers now, or undefined when the connection is not cached here. */
    view(/** @type {Connection} */ conn) {
      if (!cached(conn)) return undefined;
      const entry = entries.get(conn.id);
      if (!entry || entry.where !== whereOf(conn)) return undefined;
      return viewOf(entry, deps.systemSchemas());
    },
    /** Resolves once no pass of the connection runs or waits. */
    async settled(/** @type {Connection} */ conn) {
      const entry = entries.get(conn.id);
      while (entry?.running) await entry.running.catch(() => {});
    },
    /** Every cached connection read this session. */
    opened: () => [...entries.values()].filter((e) => e.opened).map((e) => e.conn),
  };
}
