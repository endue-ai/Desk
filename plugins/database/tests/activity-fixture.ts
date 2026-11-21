// A scripted PostgreSQL server for the activity view (ui/features/activity/): a saved connection and
// what the scripted server answers to the view's reads (the version, pg_stat_activity, pg_locks) and to
// pg_cancel_backend and pg_terminate_backend, which change what the next read sees. Session 4242
// holds a row in a transaction and sleeps, 4243 waits for its transaction, 4244 waits for 4243 on
// the row; 4250 is the session reading the view, 4251 another of the plugin's, 4260 another role's
// whose statement is hidden, 4100 a background process, 4300 idle in a transaction. As on a real
// server, a cancelled statement fails its transaction, which lets go of its locks, and an ended
// session is gone; who waited for either has its lock. The unit tests and the runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node.
import type { Connection } from "../ui/engines/common.js";
import type { Answer, Script } from "./clients";

/** The saved PostgreSQL connection the fixture page adds after the SQLite one. */
export const ACTIVITY_CONNECTION: Connection = {
  id: "c-warehouse",
  name: "warehouse",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "warehouse",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

const HIDDEN = "<insufficient privilege>";
const SESSION_HEAD = [
  ...["pid", "leader_pid", "usename", "datname", "application_name", "client", "client_port"],
  ...["backend_type", "state", "wait_event_type", "wait_event", "state_ms", "xact_ms", "query_ms"],
  ...["blocked_by", "query"],
];
const LOCK_HEAD = [
  ...["pid", "locktype", "mode", "granted", "datname", "relation", "page", "tuple"],
  ...["virtualxid", "transactionid", "objid", "wait_ms"],
];

/** The sessions as pg_stat_activity answers them ("" is NULL, as the psql path printed it). */
// biome-ignore format: one session a line, as the view reads them
const SESSIONS = [
  ["4100", "", "", "", "", "", "", "autovacuum launcher", "", "Activity", "AutoVacuumMain", "", "", "", "", ""],
  ["4242", "", "alice", "warehouse", "billing", "10.0.0.5", "50412", "client backend", "active", "Timeout", "PgSleep", "60000", "95000", "60000", "", "SELECT pg_sleep(600)"],
  ["4243", "", "bob", "warehouse", "reports", "10.0.0.7", "50500", "client backend", "active", "Lock", "transactionid", "30000", "30000", "30000", "4242", "UPDATE orders SET total = total + 1 WHERE id = 1"],
  ["4244", "", "carol", "warehouse", "reports", "10.0.0.7", "50501", "client backend", "active", "Lock", "tuple", "12000", "12000", "12000", "4243", "UPDATE orders SET total = 0 WHERE id = 1"],
  ["4250", "", "app", "warehouse", "endue Desk", "", "-1", "client backend", "active", "", "", "0", "0", "0", "", "SELECT a.pid FROM pg_catalog.pg_stat_activity a"],
  ["4251", "", "app", "warehouse", "endue Desk", "127.0.0.1", "50600", "client backend", "idle", "Client", "ClientRead", "300000", "", "310000", "", "select * from orders"],
  ["4260", "", "dave", "archive", "", "", "", "", "", "", "", "", "", "", "", HIDDEN],
  ["4300", "", "alice", "warehouse", "billing", "10.0.0.5", "50413", "client backend", "idle in transaction", "Client", "ClientRead", "200000", "250000", "200000", "", "UPDATE stock SET n = n - 1 WHERE item = 7"],
];

// biome-ignore format: one lock a line, as pg_locks reads them
const LOCKS = [
  ["4243", "transactionid", "ShareLock", "f", "", "", "", "", "", "731", "", "30000"],
  ["4244", "tuple", "ExclusiveLock", "f", "warehouse", "orders", "0", "1", "", "", "", "12000"],
  ["4242", "transactionid", "ExclusiveLock", "t", "", "", "", "", "", "731", "", ""],
  ["4243", "tuple", "ExclusiveLock", "t", "warehouse", "orders", "0", "1", "", "", "", ""],
  ["4242", "relation", "RowExclusiveLock", "t", "warehouse", "orders", "", "", "", "", "", ""],
  ["4243", "relation", "RowExclusiveLock", "t", "warehouse", "orders", "", "", "", "", "", ""],
  ["4244", "relation", "RowExclusiveLock", "t", "warehouse", "orders", "", "", "", "", "", ""],
  ["4250", "virtualxid", "ExclusiveLock", "t", "", "", "", "", "5/12", "", "", ""],
  ["4300", "relation", "RowExclusiveLock", "t", "warehouse", "stock", "", "", "", "", "", ""],
];

/** The rows a read gets, without their header rows: the head, the sessions, the locks. */
export const activityRows = (version = 170006) => ({
  head: [String(version), `${Math.floor(version / 10000)}.${version % 100}`, "4250", "warehouse"],
  sessions: SESSIONS.map((row) => [...row]),
  locks: LOCKS.map((row) => [...row]),
});

export interface ActivityServer {
  script: Script;
  /** Every statement that signalled a session, in order. */
  signals: string[];
}

/**
 * The scripted server; `version` is server_version_num, `refuse` makes every signal fail as for a
 * role without pg_signal_backend. Anything else goes to `fallback`.
 */
export function activityServer(
  fallback: Script = () => ({}),
  options: { version?: number; refuse?: boolean } = {},
): ActivityServer {
  const version = options.version ?? 170006;
  const cancelled = new Set<string>();
  const ended = new Set<string>();
  const signals: string[] = [];

  /** Who no longer holds anything: a failed transaction's locks and an ended session's are gone. */
  const released = () => new Set([...cancelled, ...ended]);
  const sessions = () =>
    SESSIONS.filter((row) => !ended.has(row[0] ?? "")).map((row) => {
      const next = [...row];
      if (cancelled.has(next[0] ?? "")) next.splice(8, 3, "idle in transaction (aborted)", "", "");
      const blockers = (next[14] ?? "").split(" ").filter(Boolean);
      const left = blockers.filter((pid) => !released().has(pid));
      if (blockers.length && !left.length) next.splice(9, 2, "", "");
      next[14] = left.join(" ");
      return next;
    });
  const locks = () =>
    LOCKS.filter((row) => !released().has(row[0] ?? "") || row[1] === "virtualxid").map((row) => {
      const waiter = sessions().find((s) => s[0] === row[0]);
      return row[3] === "f" && waiter && !waiter[14]
        ? [...row.slice(0, 3), "t", ...row.slice(4, 11), ""]
        : row;
    });

  const script: Script = (sql, env) => {
    const text = sql.trim();
    if (text.startsWith("SELECT current_setting('server_version_num')"))
      return { rows: [["version", "server", "pid", "database"], activityRows(version).head] };
    if (/FROM pg_catalog\.pg_stat_activity a/u.test(text))
      return { rows: [SESSION_HEAD, ...sessions()] };
    if (/FROM pg_catalog\.pg_locks l/u.test(text)) return { rows: [LOCK_HEAD, ...locks()] };
    const signal = /pg_catalog\.pg_(cancel|terminate)_backend\((\d+)/u.exec(text);
    if (signal) {
      signals.push(text);
      return answerSignal(signal[1] === "cancel" ? cancelled : ended, signal[2] ?? "", options);
    }
    return fallback(sql, env);
  };
  return { script, signals };
}

function answerSignal(into: Set<string>, pid: string, options: { refuse?: boolean }): Answer {
  if (options.refuse) return { error: "permission denied to cancel query" };
  const there = SESSIONS.some((row) => row[0] === pid);
  if (there) into.add(pid);
  return { rows: [["signalled"], [there ? "t" : "f"]] };
}
