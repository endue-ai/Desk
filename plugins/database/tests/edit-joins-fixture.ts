// A join of the shop's orders and people (links-fixture.ts) on the fixture's PostgreSQL connection,
// for editing a result by its columns' origins (PG-45, #472): the scripted server answers the join
// with each column's table OID and column number (an expression has none), and the catalog read of
// those tables by OID (ui/edit/origins.js): their columns, primary keys and the foreign key from
// orders to people. Every other statement goes to `script`. The runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) uses it. Fixture data only.
import type { Answer, Script } from "./clients";

/** The join the e2e runs in a console of fixture-pg. */
export const JOIN_SQL =
  "select o.id, o.total, p.id as pid, p.name, o.total * 2 as twice from orders o join people p on p.id = o.person order by o.id";

const ORDERS = 26001;
const PEOPLE = 26002;

const JOIN: Answer = {
  rows: [
    ["id", "total", "pid", "name", "twice"],
    ["1", "12.00", "1", "Ada", "24.00"],
    ["2", "30.00", "2", "Bob", "60.00"],
    ["3", "7.50", "1", "Ada", "15.00"],
  ],
  types: [23, 1700, 23, 25, 1700],
  origins: [
    [ORDERS, 1],
    [ORDERS, 3],
    [PEOPLE, 1],
    [PEOPLE, 2],
    [0, 0],
  ],
};

const column = (attnum: number, name: string, type: string, notNull: boolean) =>
  [attnum, name, type, notNull, null, true] as const;
/** The catalog's rows of the origins read, by OID. */
const RELATIONS: Record<number, (string | null)[]> = {
  [ORDERS]: [
    String(ORDERS),
    "public",
    "orders",
    "r",
    "28",
    JSON.stringify([
      column(1, "id", "integer", true),
      column(2, "person", "integer", true),
      column(3, "total", "numeric(8,2)", false),
    ]),
    JSON.stringify([[true, "orders_pkey", [1]]]),
    JSON.stringify([PEOPLE]),
  ],
  [PEOPLE]: [
    String(PEOPLE),
    "public",
    "people",
    "r",
    "28",
    JSON.stringify([
      column(1, "id", "integer", true),
      column(2, "name", "text", true),
      column(3, "joined", "timestamp with time zone", false),
    ]),
    JSON.stringify([[true, "people_pkey", [1]]]),
    "null",
  ],
};
const HEAD = ["oid", "nspname", "relname", "relkind", "updatable", "columns", "keys", "references"];

/** `script` with the join and the origins read answered on the shop's database. */
export function editJoinsScript(script: Script): Script {
  return (sql, who) => {
    const text = sql.trim();
    if (who.database === "shop" && text.startsWith(JOIN_SQL)) return JOIN;
    if (
      who.database === "shop" &&
      /^SELECT c\.oid, n\.nspname, c\.relname, c\.relkind::text/u.test(text)
    ) {
      const oids = (/WHERE c\.oid IN \(([\d, ]+)\)/u.exec(text)?.[1] ?? "").split(", ").map(Number);
      return { rows: [HEAD, ...oids.flatMap((oid) => (RELATIONS[oid] ? [RELATIONS[oid]] : []))] };
    }
    return script(sql, who);
  };
}
