// The agents' tools and audit list (ui/features/audit/) on a scripted PostgreSQL server: a table of
// people with an email column to mask, its statistics, the server's sessions, EXPLAIN, a check by
// PREPARE, and writes the server refuses on a read-only session as PostgreSQL does. `asAgent` calls a
// command as another caller (an agent of the brain, by default) and resolves with its answer.
import manifest from "../plugin.json";
import type { Connection } from "../ui/engines/common.js";
import type { Script } from "./clients";
import { type Handlers, type Mounted, mount, SAVED } from "./harness";

export const SHOP: Connection = {
  id: "c-shop",
  name: "shop",
  engine: "postgresql",
  host: "db.test",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "staging",
  readOnly: false,
};
export const NOTES = SAVED[0] as Connection;

const PEOPLE = [
  ["id", "name", "email"],
  ["1", "Ada", "ada@example.test"],
  ["2", "Bob", "bob@example.test"],
  ["3", "Cy", "cy@example.test"],
];
const TABLE_HEAD = [
  "estimated_rows",
  "total_bytes",
  "table_bytes",
  "seq_scan",
  "idx_scan",
  "n_live_tup",
  "n_dead_tup",
  "n_mod_since_analyze",
  "last_vacuum",
  "last_autovacuum",
  "last_analyze",
  "last_autoanalyze",
];
const STATS = [
  [
    "attname",
    "null_frac",
    "avg_width",
    "n_distinct",
    "correlation",
    "most_common_vals",
    "most_common_freqs",
    "histogram_bounds",
  ],
  ["email", "0", "17", "-1", "0.5", "{ada@example.test,bob@example.test}", "{0.5,0.5}", null],
  ["id", "0", "4", "-1", "1", null, null, "{1,2,3}"],
];
const SESSIONS = [
  [
    "pid",
    "user",
    "database",
    "application_name",
    "client",
    "backend_type",
    "state",
    "wait_event_type",
    "wait_event",
    "backend_start",
    "xact_start",
    "query_start",
    "query",
  ],
  [
    "4242",
    "app",
    "shop",
    "reports",
    "10.0.0.9",
    "client backend",
    "active",
    null,
    null,
    "2026-11-22 09:00:00+00",
    null,
    "2026-11-22 09:01:00+00",
    "SELECT count(*) FROM orders",
  ],
];

/** What each statement saw: its text and who ran it (readOnly "on" for a read-only session). */
export type Seen = Array<{ sql: string; who: Record<string, string>; describe?: true }>;

/** The scripted server; every statement it answers is pushed to `seen`. */
export function auditScript(seen: Seen): Script {
  return (sql, who, bound) => {
    seen.push({ sql, who, ...(bound?.describe ? { describe: true } : {}) });
    // A check (db.describe, ADR 0353): what the statement takes and answers, or the server's error.
    if (bound?.describe)
      return /nosuch/u.test(sql)
        ? { error: 'relation "nosuch" does not exist', code: "42P01", position: 15 }
        : /^insert/iu.test(sql)
          ? { paramTypes: [] }
          : { rows: [["id"]], types: [23] };
    const sample = /^SELECT \* FROM "public"\."people" LIMIT (\d+) OFFSET 0$/u.exec(sql);
    if (sample) return { rows: PEOPLE.slice(0, Number(sample[1]) + 1) };
    if (/^SELECT \* FROM "public"\."nosuch"/u.test(sql))
      return { error: 'relation "public.nosuch" does not exist', code: "42P01" };
    if (/^select (id, name, email|\*) from people/iu.test(sql)) return { rows: PEOPLE };
    if (/^select id, upper\(email\)/iu.test(sql))
      return { rows: PEOPLE.map((r, i) => [r[0] ?? "", i ? (r[2] ?? "").toUpperCase() : "upper"]) };
    if (/^select id from people where email/iu.test(sql)) return { rows: [["id"], ["1"]] };
    if (/FROM sqlite_master WHERE type IN \('table', 'view'\)/u.test(sql))
      return {
        rows: [
          ["name", "type", "detail", "estimate", "ident"],
          ["notes", "table", "", "", ""],
        ],
      };
    if (/^SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name = 'notes'/u.test(sql))
      return { rows: [["sql"], ["CREATE TABLE notes (id integer primary key, body text)"]] };
    if (/FROM pg_class c JOIN pg_namespace/u.test(sql))
      return /'people'/u.test(sql)
        ? {
            rows: [
              TABLE_HEAD,
              [
                "3",
                "16384",
                "8192",
                "4",
                "0",
                "3",
                "0",
                "0",
                null,
                null,
                null,
                "2026-11-22 08:00:00+00",
              ],
            ],
          }
        : { rows: [TABLE_HEAD] };
    if (/FROM pg_stats/u.test(sql)) return { rows: STATS };
    if (/FROM pg_stat_activity/u.test(sql)) return { rows: SESSIONS };
    if (/^EXPLAIN \((ANALYZE, BUFFERS, )?FORMAT TEXT\) /u.test(sql))
      return { rows: [["QUERY PLAN"], ["Seq Scan on people  (cost=0.00..1.03 rows=3 width=40)"]] };
    if (/format_type/u.test(sql))
      return {
        rows: [
          ["oid", "format_type"],
          ["23", "integer"],
        ],
      };
    if (/nextval/u.test(sql) && who.readOnly === "on")
      return { error: "cannot execute nextval() in a read-only transaction", code: "25006" };
    if (/^(insert|update|delete)/iu.test(sql))
      return who.readOnly === "on"
        ? { error: "cannot execute INSERT in a read-only transaction", code: "25006" }
        : { changes: 1 };
    return { rows: [["?column?"], ["1"]] };
  };
}

/** The plugin with shop and Notes, the server scripted, the person answering `pick`. */
export async function auditMount(
  options: {
    pick?: () => string;
    settings?: Record<string, unknown>;
    store?: Record<string, unknown>;
    handlers?: Handlers;
  } = {},
) {
  const seen: Seen = [];
  const m = await mount({
    store: { connections: [SHOP, NOTES], ...options.store },
    grants: [{ permission: "db:connect", hosts: ["db.test:5432"] }],
    script: auditScript(seen),
    pick: options.pick ?? (() => "yes"),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.handlers ? { handlers: options.handlers } : {}),
  });
  return { m, seen };
}

type Answered = {
  invocationId: string;
  result?: unknown;
  error?: { code: string; message: string };
};

type Declared = {
  id: string;
  title: string;
  keywords?: string[];
  description?: string;
  args?: Record<string, unknown>;
  agent?: boolean;
  readOnly?: boolean;
};

/** Register a command of the manifest with the test host's registry, as the desk does at load. */
export async function register(m: Mounted, id: string) {
  const declared = (manifest.contributes.commands as Declared[]).find((c) => c.id === id);
  const { args, ...rest } = declared ?? { id, title: id };
  await m.host
    .call("cmd.register", { ...rest, ...(args ? { argsSchema: args } : {}) }, "endue.database")
    .catch(() => {});
}

/** Invoke a command as `caller` and resolve with its answer, or reject with its failure. */
export async function asAgent(
  m: Mounted,
  id: string,
  args: Record<string, unknown> = {},
  caller = "agent:helper",
): Promise<unknown> {
  await register(m, id);
  const scope = { permission: "cmd:invoke" as const, ids: [id] };
  const { invocationId } = await m.host.call("cmd.invoke", { id, args, scope }, caller);
  for (let i = 0; i < 100; i++) {
    await m.settle();
    const call = m.host.calls.find(
      (c) => c.method === "cmd.answer" && (c.params as Answered).invocationId === invocationId,
    );
    if (!call) continue;
    const answered = call.params as Answered;
    if (answered.error)
      throw Object.assign(new Error(answered.error.message), { code: answered.error.code });
    return answered.result;
  }
  throw new Error(`${id} was not answered`);
}

/** The audit list the store keeps for a connection. */
export const auditOf = (m: Mounted, id = SHOP.id) =>
  (m.store[`agent-audit:${id}`] ?? []) as Array<Record<string, unknown>>;
