// A scripted PostgreSQL server for the maintenance form (ui/features/maintenance/) on the activity
// fixture's connection `warehouse`: the version, the tablespaces, schema public's tables (orders
// with 30,000 dead rows and three indexes, stock, the materialized view daily_totals) with their
// sizes and statistics, what VACUUM, ANALYZE, REINDEX and CLUSTER change in them (VERBOSE answers
// INFO lines), a progress row while `progress` is set, and the cancel of the run's session while
// `running` is. The unit tests and the runtime e2e page (packages/runtime/e2e/fixture/database.ts)
// share it; it needs no Node.
import type { Answer, Script } from "./clients";

/** When the fixture's runs happened, as the server's to_char shows it. */
export const RAN_AT = "2026-11-21 10:15:00";

interface Table {
  name: string;
  relkind: string;
  live: number;
  dead: number;
  table: number;
  lastVacuum: string;
  lastAutovacuum: string;
  lastAnalyze: string;
  lastAutoanalyze: string;
  indexes: Array<{
    name: string;
    primary: boolean;
    method: string;
    bytes: number;
    clustered: boolean;
  }>;
}

const MB = 1024 * 1024;
const tables = (): Table[] => [
  {
    name: "daily_totals",
    relkind: "m",
    ...{ live: 365, dead: 0, table: 40960, lastVacuum: "", lastAutovacuum: "" },
    ...{ lastAnalyze: "", lastAutoanalyze: "2026-11-20 03:12:50", indexes: [] },
  },
  {
    name: "orders",
    relkind: "r",
    ...{ live: 120000, dead: 30000, table: 12 * MB, lastVacuum: "" },
    ...{
      lastAutovacuum: "2026-11-20 03:12:44",
      lastAnalyze: "",
      lastAutoanalyze: "2026-11-20 03:12:45",
    },
    indexes: [
      { name: "orders_customer_idx", primary: false, method: "btree", bytes: MB, clustered: false },
      { name: "orders_note_trgm", primary: false, method: "gin", bytes: MB / 2, clustered: false },
      { name: "orders_pkey", primary: true, method: "btree", bytes: 2.5 * MB, clustered: false },
    ],
  },
  {
    name: "stock",
    relkind: "r",
    ...{ live: 500, dead: 20, table: 73728, lastVacuum: "2026-11-19 22:00:00", lastAutovacuum: "" },
    ...{ lastAnalyze: "", lastAutoanalyze: "" },
    indexes: [
      { name: "stock_pkey", primary: true, method: "btree", bytes: 32768, clustered: false },
    ],
  },
];

const indexBytes = (t: Table) => t.indexes.reduce((n, i) => n + i.bytes, 0);
const sum = (list: Table[], f: (t: Table) => number) => String(list.reduce((n, t) => n + f(t), 0));
const latest = (list: Table[], f: (t: Table) => string) =>
  list.map(f).filter(Boolean).sort().at(-1) ?? "";

export interface MaintenanceServer {
  script: Script;
  /** Every VACUUM, ANALYZE, REINDEX and CLUSTER statement, in order. */
  ran: string[];
  /** Every cancel sent to the run's session. */
  cancels: string[];
  /** While set, a progress read finds the run's session with this row (progressSql's columns). */
  progress: string[] | null;
  /** Whether a cancel finds the run's session. */
  running: boolean;
}

/**
 * The scripted server; `version` is server_version_num and `recovery` makes it a standby. Anything
 * else goes to `fallback` (the activity view's script on the e2e page).
 */
export function maintenanceServer(
  fallback: Script = () => ({}),
  options: { version?: number; recovery?: boolean } = {},
): MaintenanceServer {
  const version = options.version ?? 170006;
  const server = `${Math.floor(version / 10000)}.${version % 100}`;
  const list = tables();
  const find = (name: string) => list.find((t) => t.name === name);
  const named = (text: string, column: string) =>
    new RegExp(`${column} = '([^']+)'`, "u").exec(text)?.[1] ?? "";
  const ownerOf = (index: string) => list.find((t) => t.indexes.some((i) => i.name === index));

  const statsRow = (t: Table) => [
    ...[
      t.relkind,
      String(t.live),
      String(t.dead),
      String(t.table + indexBytes(t)),
      String(t.table),
    ],
    ...[String(indexBytes(t)), t.lastVacuum, t.lastAutovacuum, t.lastAnalyze, t.lastAutoanalyze],
    ...["1", t.name],
  ];
  const sums = (of: Table[], total: string) => [
    ...["", sum(of, (t) => t.live), sum(of, (t) => t.dead), total],
    ...[sum(of, (t) => t.table), sum(of, indexBytes)],
    ...[latest(of, (t) => t.lastVacuum), latest(of, (t) => t.lastAutovacuum)],
    ...[
      latest(of, (t) => t.lastAnalyze),
      latest(of, (t) => t.lastAutoanalyze),
      String(of.length),
      "",
    ],
  ];

  /** What a statement does to the tables it names (all of them when it names none). */
  const apply = (text: string): Answer => {
    const verb = /^(\w+)/u.exec(text)?.[1] ?? "";
    const index = /INDEX(?: CONCURRENTLY)? public\.(\w+)$/u.exec(text)?.[1];
    const hit = index
      ? list.filter((t) => t === ownerOf(index))
      : list.filter((t) => new RegExp(`public\\.${t.name}\\b`, "u").test(text));
    const targets = hit.length ? hit : list;
    const notices: string[] = [];
    const verbose = /VERBOSE/u.test(text);
    for (const t of targets) {
      if (verb === "VACUUM") {
        if (verbose) notices.push(`INFO:  vacuuming "warehouse.public.${t.name}"`);
        if (/FULL/u.test(text)) t.table = Math.round((t.table * t.live) / (t.live + t.dead || 1));
        else t.lastVacuum = RAN_AT;
        if (verbose)
          notices.push(
            `tuples: ${t.dead} removed, ${t.live} remain, 0 are dead but not yet removable`,
          );
        t.dead = 0;
        if (/ANALYZE/u.test(text)) t.lastAnalyze = RAN_AT;
      } else if (verb === "ANALYZE") {
        if (verbose) notices.push(`INFO:  analyzing "public.${t.name}"`);
        t.lastAnalyze = RAN_AT;
      } else if (verb === "REINDEX") {
        for (const i of t.indexes)
          if (!index || i.name === index) {
            if (verbose) notices.push(`INFO:  index "${i.name}" was reindexed`);
            i.bytes = Math.round(i.bytes * 0.8);
          }
      } else if (verb === "CLUSTER") {
        const using = /USING (\w+)$/u.exec(text)?.[1];
        if (verbose)
          notices.push(`INFO:  clustering "public.${t.name}" using index scan on "${using}"`);
        for (const i of t.indexes) i.clustered = i.name === using;
        t.table = Math.round((t.table * t.live) / (t.live + t.dead || 1));
      }
    }
    return { changes: 0, notices };
  };

  const done: MaintenanceServer = {
    ran: [],
    cancels: [],
    progress: null,
    running: false,
    script: (sql, env) => {
      const text = sql.trim();
      if (text.startsWith("SET lock_timeout")) return {};
      if (text.startsWith("SELECT current_database(), current_setting('server_version_num')"))
        return {
          rows: [
            ["current_database", "server_version_num", "server_version", "pg_is_in_recovery"],
            ["warehouse", String(version), server, options.recovery ? "t" : "f"],
          ],
        };
      // The form's own statement only: the schema cache reads pg_tablespace too (PG-50).
      if (text.startsWith("SELECT spcname FROM pg_catalog.pg_tablespace"))
        return { rows: [["spcname"], ["fast"], ["pg_default"]] };
      if (text.startsWith("SELECT c.relkind, s.n_live_tup")) {
        const t = /i\.relname = /u.test(text)
          ? ownerOf(named(text, "i.relname"))
          : find(named(text, "c.relname"));
        return { rows: [["stats"], ...(t ? [statsRow(t)] : [])] };
      }
      if (text.startsWith("SELECT NULL, sum(s.n_live_tup)") && /pg_database_size/u.test(text))
        return { rows: [["stats"], sums(list, String(50 * MB))] };
      if (text.startsWith("SELECT NULL, sum(s.n_live_tup)"))
        return {
          rows: [
            ["stats"],
            sums(
              list,
              sum(list, (t) => t.table + indexBytes(t)),
            ),
          ],
        };
      if (text.startsWith("SELECT i.relname, x.indisclustered")) {
        const t = /i\.relname = /u.test(text)
          ? ownerOf(named(text, "i.relname"))
          : find(named(text, "c.relname"));
        const rows = (t?.indexes ?? []).map((i) => [
          ...[i.name, i.clustered ? "t" : "f", i.primary ? "t" : "f", "t", i.method, "f"],
          String(i.bytes),
        ]);
        return { rows: [["index"], ...rows] };
      }
      if (text.startsWith("SELECT c.relname FROM pg_catalog.pg_class c"))
        return { rows: [["relname"], ...list.map((t) => [t.name])] };
      if (/^(VACUUM|ANALYZE|REINDEX|CLUSTER)\b/u.test(text)) {
        done.ran.push(text);
        return apply(text);
      }
      if (/FROM pg_catalog\.pg_stat_progress_vacuum|pg_stat_progress_vacuum v/u.test(text))
        return { rows: [["progress"], ...(done.progress ? [done.progress] : [])] };
      if (/pg_cancel_backend\(a\.pid\)/u.test(text)) {
        done.cancels.push(text);
        return { rows: [["pg_cancel_backend"], ...(done.running ? [["t"]] : [])] };
      }
      return fallback(sql, env);
    },
  };
  return done;
}
