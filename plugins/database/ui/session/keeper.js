// The PostgreSQL sessions consoles and table views keep (PG-02, ADR 0320). Each owner, a console or
// a table view, has its own, opened at its first run and kept, so a SET, a temporary table, a
// prepared statement and an open transaction last from one run to the next; runs of one owner go one
// at a time. The keeper follows each session's transaction state from the pages, hears db.closed (a
// session the server or the network ended is lost: said, and opened again at the next run with
// nothing run again), closes one no run used for the person's minutes (never one in a transaction),
// keeps under the limits (per connection, and twelve in all, the core's sixteen less four for short
// runs), letting a table view's idle session go first, closes what the person closes, and takes back
// a console's session when the frame wakes. After the computer slept, a session is checked before
// its next run (wake.js, PG-105, ADR 0355): one that does not answer is lost, and a run whose open
// transaction went with it does not run. No DOM.

import { t } from "../strings/index.js";
import { lostLine, SLEPT, SLEPT_REFUSED } from "./lost-words.js";
import { KEPT_MAX } from "./slots.js";
import { monotonic, probe, slept } from "./wake.js";
import { closedWhy, idleWhy, modelOf, newSession } from "./words.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").DbError} DbError
 * @typedef {import("@endue-ai/bridge").DbTransaction} Transaction
 * @typedef {import("./words.js").Gone} Gone
 * @typedef {{ owner: string, kind: "console" | "table" }} Owner
 * @typedef {{
 *   owner: string, kind: Owner["kind"], connection: string, sessionId: string, pid: number,
 *   transaction: Transaction, running: boolean, used: number, at: number, mono: number,
 *   timeoutMs: number, timer?: unknown,
 * }} Entry
 *   `at` is when a run last ended (`mono` the same on the monotonic clock); `timeoutMs` the
 *   statement timeout the session has.
 * @typedef {{ owner: string, sessionId: string, connection: string, timeoutMs: number }} Kept
 *   What the surface state keeps of a console's session, to take it back when the frame wakes.
 * @typedef {{
 *   call(method: string, params: Record<string, unknown>): Promise<any>,
 *   slots: ReturnType<typeof import("./slots.js").createSlots>,
 *   onState(owner: string): void,
 *   onLost(owner: string, line: (label: string) => string, gone: Gone): void,
 *   idleMs(): number, limit(): number, now(): number, monotonic?(): number,
 *   setTimer(fn: () => void, ms: number): unknown, clearTimer(timer: unknown): void,
 *   holds?(owner: string): boolean, ended?(owner: string): void,
 * }} Deps
 *   `monotonic` is a clock a sleep does not move (performance.now by default); `holds` keeps an
 *   owner's session the idle timer would close (one that listens, PG-25); `ended` hears an owner's
 *   session go, before `onLost`.
 * @typedef {{ sessionId: string, pid: number } | { error: DbError }} Opened
 */

/** @param {Deps} deps */
export function createKeeper(deps) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  /** Owners by session id. @type {Map<string, string>} */
  const owners = new Map();
  /** How each owner's last session ended without the person. @type {Map<string, Gone>} */
  const gone = new Map();
  /** Each owner's turn: the work that runs or waits. @type {Map<string, Promise<unknown>>} */
  const turns = new Map();
  /** Sessions signing in, by connection. @type {Map<string, number>} */
  const opening = new Map();
  let tick = 0;
  const mono = deps.monotonic ?? monotonic;
  /** Mark an entry used now, on both clocks. */
  const touch = (/** @type {Entry} */ entry) => {
    entry.at = deps.now();
    entry.mono = mono();
  };

  /** Forget an entry: its slot goes back, its timer stops. */
  const drop = (/** @type {Entry} */ entry) => {
    if (entries.get(entry.owner) !== entry) return false;
    entries.delete(entry.owner);
    owners.delete(entry.sessionId);
    deps.clearTimer(entry.timer);
    deps.slots.give("kept");
    deps.ended?.(entry.owner);
    return true;
  };
  /** End an entry's session: the person's close (no `why`), or the idle timer's. */
  const shut = (/** @type {Entry} */ entry, /** @type {string} */ why) => {
    if (!drop(entry)) return;
    if (why) gone.set(entry.owner, { why, transaction: "idle", lost: false });
    else gone.delete(entry.owner);
    void deps.call("db.close", { sessionId: entry.sessionId }).catch(() => {});
    deps.onState(entry.owner);
  };
  /** A session that ended without the person: lost, said, and new at the next run. */
  const lose = (
    /** @type {Entry} */ entry,
    /** @type {string} */ why,
    /** @type {string} */ reason,
  ) => {
    if (!drop(entry)) return;
    /** @type {Gone} */
    const was = { why, transaction: entry.transaction, lost: true, reason };
    gone.set(entry.owner, was);
    deps.onState(entry.owner);
    deps.onLost(entry.owner, (label) => lostLine(label, was), was);
  };
  /**
   * After a sleep, whether the entry's session still answers; one that does not is closed and lost.
   * @returns {Promise<boolean>}
   */
  const awake = async (/** @type {Entry} */ entry) => {
    if (!slept({ wall: entry.at, mono: entry.mono }, { wall: deps.now(), mono: mono() }))
      return true;
    const checked = await probe(deps.call, entry.sessionId, deps);
    if (entries.get(entry.owner) !== entry) return false;
    touch(entry);
    if (checked.alive) {
      if (checked.transaction) entry.transaction = checked.transaction;
      return true;
    }
    void deps.call("db.close", { sessionId: entry.sessionId }).catch(() => {});
    lose(entry, SLEPT, "slept");
    return false;
  };

  const arm = (/** @type {Entry} */ entry, ms = deps.idleMs()) => {
    deps.clearTimer(entry.timer);
    entry.timer = ms > 0 ? deps.setTimer(() => idle(entry), ms) : undefined;
  };
  /** The idle timer: closed once no run used it for the setting's time, outside a transaction. */
  const idle = (/** @type {Entry} */ entry) => {
    const ms = deps.idleMs();
    if (entries.get(entry.owner) !== entry || ms <= 0) return;
    const left = entry.at + ms - deps.now();
    const busy =
      entry.running ||
      entry.transaction !== "idle" ||
      turns.has(entry.owner) ||
      deps.holds?.(entry.owner) === true;
    if (busy || left > 0) arm(entry, left > 0 ? left : ms);
    else shut(entry, idleWhy(ms));
  };

  /** Let the least recently used idle table view's session of those `test` takes go. */
  const reclaim = (/** @type {(e: Entry) => boolean} */ test) => {
    const [oldest] = [...entries.values()]
      .filter((e) => test(e) && e.kind === "table" && e.transaction === "idle")
      .filter((e) => !e.running && !turns.has(e.owner))
      .sort((a, b) => a.used - b.used);
    if (oldest) shut(oldest, "");
    return Boolean(oldest);
  };
  const signing = () => [...opening.values()].reduce((sum, n) => sum + n, 0);
  /** Room for one more session of `conn`, or the sentence why there is none. */
  const room = (/** @type {Connection} */ conn) => {
    const limit = deps.limit();
    const mine = (/** @type {Entry} */ e) => e.connection === conn.id;
    const held = [...entries.values()].filter(mine).length + (opening.get(conn.id) ?? 0);
    if (held >= limit && !reclaim(mine))
      return t("session.keeper.keepsSessionOpenItsLimitSessions", {
        name: String(conn.name),
        limit: String(limit),
        value: String(limit === 1 ? "" : t("session.keeper.s")),
      });
    if (entries.size + signing() >= KEPT_MAX && !reclaim(() => true))
      return t("session.keeper.thePluginKeepsPostgresqlSessionsOpen", {
        KEPT_MAX: String(KEPT_MAX),
      });
    return undefined;
  };

  /**
   * The owner's session, or one opened now with the notice a new one carries.
   * @param {Owner} who @param {Connection} conn @param {number} timeoutMs @param {() => Promise<Opened>} open
   * @returns {Promise<{ entry: Entry, notes: string[] } | { error: DbError }>}
   */
  const acquire = async (who, conn, timeoutMs, open) => {
    const had = entries.get(who.owner);
    if (had?.connection === conn.id) {
      const held = had.transaction !== "idle";
      if (await awake(had)) {
        had.used = ++tick;
        return { entry: had, notes: [] };
      }
      // Its transaction went with it: this run was meant to run inside it, so it does not.
      if (held) return { error: { kind: "client", message: SLEPT_REFUSED } };
    }
    if (had) shut(had, "");
    const full = room(conn);
    if (full) return { error: { kind: "client", message: full } };
    opening.set(conn.id, (opening.get(conn.id) ?? 0) + 1);
    /** @type {Opened} */
    let opened;
    try {
      await deps.slots.take("kept");
      opened = await open().catch((error) => ({
        error: /** @type {DbError} */ ({ kind: "client", message: String(error) }),
      }));
    } finally {
      opening.set(conn.id, (opening.get(conn.id) ?? 1) - 1);
    }
    if ("error" in opened) {
      deps.slots.give("kept");
      return opened;
    }
    /** @type {Entry} */
    const entry = {
      ...who,
      connection: conn.id,
      sessionId: opened.sessionId,
      pid: opened.pid,
      transaction: "idle",
      running: false,
      used: ++tick,
      at: deps.now(),
      mono: mono(),
      timeoutMs,
    };
    entries.set(who.owner, entry);
    owners.set(entry.sessionId, who.owner);
    const was = gone.get(who.owner);
    gone.delete(who.owner);
    return { entry, notes: was ? [newSession(was)] : [] };
  };

  return {
    /**
     * Run `work` on `who`'s session, one run at a time per owner, opening it first when it has none.
     * @template T
     * @param {Owner} who @param {Connection} conn @param {number} timeoutMs
     * @param {() => Promise<Opened>} open
     * @param {(entry: Entry, notes: string[]) => Promise<T>} work
     * @returns {Promise<{ done: T } | { error: DbError }>}
     */
    async use(who, conn, timeoutMs, open, work) {
      const before = turns.get(who.owner);
      let release = () => {};
      const mine = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const turn = (before ?? Promise.resolve()).then(() => mine);
      turns.set(who.owner, turn);
      try {
        await before;
        const got = await acquire(who, conn, timeoutMs, open);
        if ("error" in got) return got;
        const { entry, notes } = got;
        entry.running = true;
        deps.onState(who.owner);
        try {
          return { done: await work(entry, notes) };
        } finally {
          entry.running = false;
          touch(entry);
          if (entries.get(who.owner) === entry) arm(entry);
          deps.onState(who.owner);
        }
      } finally {
        release();
        if (turns.get(who.owner) === turn) turns.delete(who.owner);
      }
    },
    /** db.closed: a session the plugin still keeps is lost. */
    closed(/** @type {import("@endue-ai/bridge").DbClosedData} */ data) {
      const entry = entries.get(owners.get(data.sessionId) ?? "");
      if (entry) lose(entry, closedWhy(data), data.reason);
    },
    /** A run found its session gone (`why`): lost, as db.closed would say. */
    lost(/** @type {string} */ sessionId, /** @type {string} */ why) {
      const entry = entries.get(owners.get(sessionId) ?? "");
      if (entry) lose(entry, why, "run");
    },
    /** Close the sessions `test` takes: a console's, a connection's. Their transactions roll back. */
    close(/** @type {(entry: Entry) => boolean} */ test) {
      for (const entry of [...entries.values()]) if (test(entry)) shut(entry, "");
    },
    /** An owner that is gone (its buffer closed): its session closes and its words go. */
    forget(/** @type {string} */ owner) {
      const entry = entries.get(owner);
      if (entry) shut(entry, "");
      gone.delete(owner);
    },
    /** The sessions `test` takes that are in a transaction, open or failed. */
    inTransaction: (/** @type {(entry: Entry) => boolean} */ test) =>
      [...entries.values()].filter((e) => test(e) && e.transaction !== "idle"),
    /** The owner of a kept session. */
    ownerOf: (/** @type {string} */ sessionId) => owners.get(sessionId),
    /** What the header shows for an owner. */
    state: (/** @type {string} */ owner) => modelOf(entries.get(owner), gone.get(owner)),
    /** The consoles' sessions, for the surface state. @returns {Kept[]} */
    kept: () =>
      [...entries.values()]
        .filter((e) => e.kind === "console")
        .map(({ owner, sessionId, connection, timeoutMs }) => ({
          owner,
          sessionId,
          connection,
          timeoutMs,
        })),
    /**
     * A frame that wakes (ADR 0134): each session db.list holds that the kept state names for an
     * owner still there (`known`) is that owner's again; any other, but this frame's own, is closed.
     * @param {Kept[]} saved
     * @param {import("@endue-ai/bridge").DbSessionInfo[]} listed
     * @param {(owner: string, connection: string) => Connection | undefined} known
     * @param {Set<string>} own the sessions this frame opened
     */
    async adopt(saved, listed, known, own) {
      for (const info of listed) {
        if (own.has(info.sessionId) || owners.has(info.sessionId)) continue;
        const kept = saved.find((k) => k.sessionId === info.sessionId);
        const conn = kept ? known(kept.owner, kept.connection) : undefined;
        if (!kept || !conn || info.running || entries.has(kept.owner) || entries.size >= KEPT_MAX) {
          void deps.call("db.close", { sessionId: info.sessionId }).catch(() => {});
          continue;
        }
        await deps.slots.take("kept");
        /** @type {Entry} */
        const entry = {
          owner: kept.owner,
          kind: "console",
          connection: conn.id,
          sessionId: info.sessionId,
          pid: info.pid,
          transaction: info.transaction,
          running: false,
          used: ++tick,
          at: deps.now(),
          mono: mono(),
          timeoutMs: kept.timeoutMs,
        };
        entries.set(entry.owner, entry);
        owners.set(entry.sessionId, entry.owner);
        arm(entry);
        deps.onState(entry.owner);
      }
    },
  };
}
