// A scripted PostgreSQL server for the value search (ui/features/search/): a saved connection whose
// database is `ledger`, its schema cache's answers (pg-catalog.ts) for two schemas of tables of mixed
// columns, and answers to the search's own statements: the version, a regular expression tried
// once, EXPLAIN (by an index or read in full, per table), and each table's search, whose rows are the
// table's rows where a searched column's text passes `find` (by default: holds "4242"), shaped as the
// statement's select list asks (its key, then each column's text where it matched), and a table's
// page filtered as a hit opens it. One table is refused (no permission), one passes its statement
// timeout, one is past the size limit. Every other database's statement goes to the script behind
// it. Fixture data only; it needs no Node.
import type { Connection } from "../ui/engines/common.js";
import type { Answer, Script } from "./clients";
import { catalogScript, type PgCatalog } from "./pg-catalog";

/** The saved PostgreSQL connection the fixture page adds last. */
export const SEARCH_CONNECTION: Connection = {
  id: "c-ledger",
  name: "ledger",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "ledger",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

export interface LedgerTable {
  name: string;
  estimate?: string;
  /** name, type, flags (n not null, p primary key) */
  columns: string[][];
  /** the rows, a value per column ("" is NULL) */
  rows?: string[][];
  /** each row's ctid, for a table without a primary key */
  ctids?: string[];
  plan?: "index" | "full";
  /** the server refuses it: permission denied */
  deny?: boolean;
  /** its search passes the statement timeout */
  slow?: boolean;
}

// biome-ignore format: one table a line where it fits, as the search reads them
export const LEDGER: Record<string, LedgerTable[]> = {
  public: [
    { name: "audit_log", estimate: "5000000", columns: [["id", "bigint", "np"], ["line", "text", ""]] },
    {
      name: "customers",
      estimate: "3",
      plan: "full",
      columns: [["id", "integer", "np"], ["name", "text", "n"], ["email", "character varying(120)", ""], ["note", "text", ""], ["joined", "date", ""]],
      rows: [
        ["1", "Ada", "ada@example.com", "called about order 4242", "2026-01-05"],
        ["2", "Grace", "grace@example.com", "", "2026-02-11"],
        ["3", "Linus", "4242@example.com", "", "2026-03-01"],
      ],
    },
    {
      name: "events",
      plan: "full",
      columns: [["at", "timestamp with time zone", ""], ["payload", "jsonb", ""]],
      rows: [
        ["2026-11-20 10:00:00+00", '{"order": 4242, "kind": "refund"}'],
        ["2026-11-20 11:00:00+00", '{"order": 17}'],
      ],
      ctids: ["(0,1)", "(0,2)"],
    },
    { name: "flags", columns: [["active", "boolean", ""], ["seen", "boolean", ""]] },
    {
      name: "orders",
      estimate: "5",
      plan: "index",
      columns: [["id", "integer", "np"], ["customer", "integer", ""], ["total", "numeric(10,2)", ""], ["ref", "uuid", ""], ["placed", "date", ""]],
      rows: [
        ["4242", "1", "19.99", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "2026-11-01"],
        ["4243", "3", "5.00", "16fd2706-8baf-433b-82eb-8c7fada847da", "2026-11-02"],
      ],
    },
    { name: "secrets", estimate: "1", deny: true, columns: [["id", "integer", "np"], ["token", "text", ""]] },
  ],
  sales: [
    { name: "big_log", estimate: "80000", slow: true, columns: [["id", "bigint", "np"], ["line", "text", ""]] },
    {
      name: "invoices",
      estimate: "2",
      plan: "index",
      columns: [["id", "integer", "np"], ["number", "integer", ""], ["memo", "text", ""]],
      rows: [
        ["1", "4242", "paid"],
        ["2", "4300", "late"],
      ],
    },
  ],
};

/** The schema cache's view of the ledger. */
export function ledgerCatalog(): PgCatalog {
  const out: PgCatalog = {};
  for (const [schema, tables] of Object.entries(LEDGER))
    out[schema] = {
      mark: `${schema.length}.1:1`,
      tables: tables.map((t) => ({
        name: t.name,
        ...(t.estimate ? { estimate: t.estimate } : {}),
        columns: t.columns,
      })),
    };
  return out;
}

/** The columns as the catalog answers them, for tests that run the search without the plugin. */
export function ledgerColumns(schema: string, table: string) {
  const t = LEDGER[schema]?.find((x) => x.name === table);
  return (t?.columns ?? []).map(([name = "", type = "", flags = ""]) => ({
    name,
    type,
    nullable: !flags.includes("n"),
    default: null,
    primary: flags.includes("p"),
  }));
}

const unquote = (name: string) => name.slice(1, -1).replaceAll('""', '"');
const NAME = /"(?:[^"]|"")*"/gu;

export interface SearchServerOptions {
  /** Whether a cell's text is a match; by default, whether it holds 4242. */
  find?: (text: string) => boolean;
  /** Called with schema.table when a table's search is answered. */
  onSearch?: (table: string) => void;
  /** The regular expression tried first fails with this. */
  badRegex?: string;
}

/** The answer to one table's search, shaped as its select list asks. */
function searched(sql: string, find: (text: string) => boolean): Answer | undefined {
  const head =
    /^SELECT ([\s\S]*?) FROM ("(?:[^"]|"")*")\.("(?:[^"]|"")*") WHERE [\s\S]* LIMIT (\d+)$/u.exec(
      sql,
    );
  if (!head) return undefined;
  const [, list = "", schema = "", name = "", limit = "0"] = head;
  const table = LEDGER[unquote(schema)]?.find((t) => t.name === unquote(name));
  if (!table) return { error: `relation ${schema}.${name} does not exist` };
  if (table.deny) return { error: `permission denied for table ${table.name}` };
  if (table.slow) return { error: "canceling statement due to statement timeout" };
  const at = list.indexOf("CASE WHEN");
  const keys =
    (at < 0 ? list : list.slice(0, at)).match(
      /"(?:[^"]|"")*"|ctid::text|tableoid::regclass::text/gu,
    ) ?? [];
  const columns = [...list.matchAll(/THEN '=' \|\| left\(("(?:[^"]|"")*")::text, 120\) END/gu)].map(
    (m) => unquote(m[1] ?? '""'),
  );
  const index = (column: string) => table.columns.findIndex(([n]) => n === column);
  const rows = (table.rows ?? []).flatMap((row, r) => {
    const cells = columns.map((c) => {
      const v = row[index(c)] ?? "";
      return v !== "" && find(v) ? `=${v.slice(0, 120)}` : "";
    });
    if (cells.every((v) => v === "")) return [];
    const key = keys.map((k) =>
      k === "ctid::text"
        ? (table.ctids?.[r] ?? "")
        : k.startsWith("tableoid")
          ? `${unquote(schema)}.${table.name}`
          : (row[index(unquote(k))] ?? ""),
    );
    return [[...key, ...cells]];
  });
  const header = [...keys.map((k) => k.replace(NAME, (n) => unquote(n))), ...columns.map((c) => c)];
  return { rows: [header, ...rows.slice(0, Number(limit))] };
}

/** A table's page, filtered as a hit opens it: by its key, its ctid, or a column's match. */
function paged(sql: string, find: (text: string) => boolean): Answer | undefined {
  const page =
    /^SELECT \* FROM ("(?:[^"]|"")*")\.("(?:[^"]|"")*")(?: WHERE ([\s\S]*?))?(?: ORDER BY [\s\S]*)? LIMIT (\d+) OFFSET (\d+)$/u.exec(
      sql,
    );
  if (!page) return undefined;
  const [, schema = "", name = "", where = "", limit = "0", offset = "0"] = page;
  const table = LEDGER[unquote(schema)]?.find((t) => t.name === unquote(name));
  if (!table) return undefined;
  const at = (column: string) => table.columns.findIndex(([n]) => n === column);
  const tests = where ? where.split(" AND ") : [];
  const rows = (table.rows ?? []).filter((row, r) =>
    tests.every((test) => {
      const ctid = /^ctid = '([^']*)'::tid$/u.exec(test);
      if (ctid) return table.ctids?.[r] === ctid[1];
      const key = /^("(?:[^"]|"")*") = '((?:[^']|'')*)'$/u.exec(test);
      if (key) return row[at(unquote(key[1] ?? '""'))] === (key[2] ?? "").replaceAll("''", "'");
      const column = /^("(?:[^"]|"")*")/u.exec(test)?.[1];
      return column ? find(row[at(unquote(column))] ?? "") : true;
    }),
  );
  const shown = rows.slice(Number(offset), Number(offset) + Number(limit));
  return { rows: [table.columns.map(([n = ""]) => n), ...shown] };
}

/** The search's server in front of another script, for the ledger's database only. */
export function searchServer(base: Script = () => ({}), options: SearchServerOptions = {}): Script {
  const find = options.find ?? ((text: string) => text.includes("4242"));
  const catalog = catalogScript(ledgerCatalog);
  return (sql, env) => {
    if (env.PGDATABASE !== SEARCH_CONNECTION.database) return base(sql, env);
    const text = sql.trim();
    if (text === "SELECT current_setting('server_version_num')")
      return { rows: [["current_setting"], ["170006"]] };
    if (/^SELECT '' ~\*? /u.test(text))
      return options.badRegex ? { error: options.badRegex } : { rows: [["?column?"], ["f"]] };
    if (/^(?:BEGIN READ ONLY|SET LOCAL statement_timeout = \d+|COMMIT)$/u.test(text)) return {};
    if (text.startsWith("EXPLAIN SELECT ")) {
      const name = /FROM "(?:[^"]|"")*"\."((?:[^"]|"")*)"/u.exec(text)?.[1] ?? "";
      const table = Object.values(LEDGER)
        .flat()
        .find((t) => t.name === name);
      const scan =
        table?.plan === "index"
          ? `  ->  Bitmap Index Scan on ${name}_pkey`
          : `  ->  Seq Scan on ${name}`;
      return { rows: [["QUERY PLAN"], ["Limit  (cost=0.00..1.05 rows=1 width=64)"], [scan]] };
    }
    const opened = text.startsWith("SELECT * ") ? paged(text, find) : undefined;
    if (opened) return opened;
    const hit = text.startsWith("SELECT ") ? searched(text, find) : undefined;
    if (hit) {
      const table = /FROM "((?:[^"]|"")*)"\."((?:[^"]|"")*)"/u.exec(text);
      options.onSearch?.(`${table?.[1]}.${table?.[2]}`);
      return hit;
    }
    return catalog(sql, env);
  };
}
