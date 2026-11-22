// A PostgreSQL server of several databases (PG-13): the shop (pg-catalog.ts) as the connection's
// own, `analytics` with a schema of its own, `template1` (a template, listed only with the
// system-schemas setting) and `locked`, which refuses every statement as a server refuses a
// database the role may not use. The server reader's statement (ui/schema/pg/server.js) also lists
// them, in the columns PostgreSQL 17 gives them. It answers on the stub's sessions by the database
// each one opened (clients.ts scriptedDb), for the unit tests and the runtime e2e page
// (packages/runtime/e2e/fixture/database.ts, its fixture-pg connection) alike; it needs no Node.
// Fixture data only.
import type { Script } from "./clients";
import { answer, catalogScript, kindOf, type PgCatalog, shop } from "./pg-catalog";

/** kind, name, detail, extra, owner, oid, comment: as the server reader answers each database. */
export const DATABASE_ROWS = [
  ["database", "analytics", "", "{}", "app", "16500", "Reports"],
  ["database", "locked", "", "{}", "app", "16501", ""],
  ["database", "shop", "", "{}", "app", "16502", ""],
  ["database", "template1", "template", "{}", "postgres", "1", ""],
];

/** What `locked` answers to anything, as PostgreSQL refuses a database without CONNECT. */
export const REFUSED = 'permission denied for database "locked"';

/** The analytics database: one schema, metrics, with one table. */
export function analytics(): PgCatalog {
  return {
    "": { mark: "7:700", rows: { database: [], server: [] } },
    metrics: {
      mark: "20.1:100",
      tables: [
        {
          name: "visits",
          estimate: "12",
          columns: [
            ["id", "bigint", "np"],
            ["page", "text", "n"],
          ],
          constraints: [["p", "visits_pkey", "PRIMARY KEY (id)", ["id"]]],
        },
      ],
    },
  };
}

/** The rows of analytics' metrics.visits, its page and its count. */
const VISITS = [
  ["id", "page"],
  ["1", "/"],
  ["2", "/pricing"],
  ["3", "/docs"],
];
const visits = (sql: string) => {
  if (/^SELECT \* FROM "metrics"\."visits"/u.test(sql)) return VISITS;
  if (/^SELECT count\(\*\) FROM "metrics"\."visits"/u.test(sql))
    return [["count"], [String(VISITS.length - 1)]];
  return undefined;
};

/** The server's databases whose server reader lists them all. */
const LISTING = new Set(["analytics", "shop"]);

/**
 * `script` on the server of these databases: `analytics` answered from its model (and its table's
 * rows), `locked` refused, and the server reader on shop or analytics listing them all. Any other
 * database, and whatever the model does not answer, is `script`'s.
 */
export function withDatabases(script: Script, model: () => PgCatalog = analytics): Script {
  let made: PgCatalog | undefined;
  return (sql, who) => {
    const database = who.database ?? "";
    if (database === "locked")
      return { error: REFUSED, code: "42501", detail: "User does not have CONNECT privilege." };
    made ??= model();
    const rows = database === "analytics" ? (answer(made, sql) ?? visits(sql.trim())) : undefined;
    const answered = rows ? { rows } : script(sql, who);
    if (answered === "auth" || !answered.rows) return answered;
    if (!LISTING.has(database) || kindOf(sql) !== "server") return answered;
    const body = [...answered.rows.slice(1), ...DATABASE_ROWS.map((row) => ["", ...row])];
    return { ...answered, rows: [Array.from({ length: 8 }, (_, i) => `c${i}`), ...body] };
  };
}

/** The unit tests' server: the shop's catalog, then `other`, on the server of these databases. */
export const databasesScript = (other: Script = () => ({})) =>
  withDatabases(catalogScript(shop, other));
