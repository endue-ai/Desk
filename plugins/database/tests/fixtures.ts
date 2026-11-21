// A fixture SQLite database for endue.database behind proc.spawn, as the browser stub serves it: a
// saved connection, three tables (people, orders, staff) whose catalog and rows the scripted sqlite3
// answers, with a table view's WHERE and ORDER BY,
// a PostgreSQL catalog (pg-catalog.ts's shop) the scripted psql answers to the schema cache, a
// PostgreSQL connection whose scripted psql answers for one table of typed columns (fixtures-pg.ts),
// and the proc.* handlers that emit each run's output as desk-core does. The runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) uses them; nothing here needs Node.
import type { BridgeEvent, StubHandlers } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import { type Script, scriptedReply } from "./clients";
import { pgFixtureScript } from "./fixtures-pg";
import { catalogScript, shop } from "./pg-catalog";

export { FIXTURE_PG_CONNECTION } from "./fixtures-pg";

/** The saved connection the fixture page starts with. */
export const FIXTURE_CONNECTION: Connection = {
  id: "c-fixture",
  name: "fixture",
  engine: "sqlite",
  host: "",
  port: null,
  database: "",
  user: "",
  ssl: "default",
  sslCa: "",
  file: "~/fixture.db",
  tag: "none",
  readOnly: false,
};

const PEOPLE = [
  ["id", "name", "note"],
  ["1", "Ada", "first"],
  ["2", "Bob", "second"],
  ["3", "Cy", "third"],
  ["4", "Dee", "fourth"],
];
/** The people again with a team each, so a sort by two columns has ties to break (#469). */
const STAFF = [
  ["id", "name", "note", "team"],
  ["1", "Ada", "first", "red"],
  ["2", "Bob", "second", "blue"],
  ["3", "Cy", "third", "red"],
  ["4", "Dee", "fourth", "blue"],
];
const ORDERS = [
  ["id", "person", "total"],
  ["1", "1", "12"],
  ["2", "2", "30"],
];
const TABLES: Record<string, string[][]> = { people: PEOPLE, orders: ORDERS, staff: STAFF };

/** name, type, nullable, default, primary: as the SQLite catalog query reads them. */
const columnsOf = (rows: string[][]) => [
  ["name", "type", "nullable", "default", "primary"],
  ...(rows[0] ?? []).map((name, i) => [
    name,
    i === 0 ? "INTEGER" : "TEXT",
    i === 0 ? "NO" : "YES",
    "",
    i === 0 ? "YES" : "NO",
  ]),
];

/** A table's rows, the first naming its columns; none for a table that is not there. */
const rowsOf = (name = "") => TABLES[name.toLowerCase()] ?? [];

/** The scripted sqlite3's answers: the catalog, each table's rows, its count. */
const sqliteScript: Script = (sql) => {
  const text = sql.trim();
  if (text === "SELECT 'main'") return { rows: [["'main'"], ["main"]] };
  if (/FROM sqlite_master WHERE type IN \('table', 'view'\)/u.test(text))
    return {
      rows: [
        ["name", "type", "detail", "estimate", "ident"],
        ...Object.keys(TABLES)
          .sort()
          .map((name) => [name, "table", "", "", ""]),
      ],
    };
  const info = /pragma_table_info\('(\w+)'\)/u.exec(text);
  if (info && /^SELECT name, type/u.test(text)) return { rows: columnsOf(rowsOf(info[1])) };
  const page = PAGE.exec(text);
  if (page)
    return { rows: pageOf(rowsOf(page[1]), page[2] ?? "", page[3] ?? "", page[4], page[5]) };
  const from = /^select \* from "?(\w+)"?/iu.exec(text);
  if (from) return { rows: rowsOf(from[1]) };
  const count = /^SELECT count\(\*\) FROM "?(\w+)"?(?: WHERE (.+))?$/iu.exec(text);
  if (count)
    return { rows: [["count"], [String(pageOf(rowsOf(count[1]), count[2] ?? "", "").length - 1)]] };
  return {};
};

/** A table view's page: SELECT * FROM "t" [WHERE …] [ORDER BY …] LIMIT n OFFSET m. */
const PAGE =
  /^SELECT \* FROM "(\w+)"(?: WHERE (.+?))?(?: ORDER BY (.+?))? LIMIT (\d+) OFFSET (\d+)$/u;
const COMPARE = /^"?(\w+)"? (=|<>|>|<) (?:'((?:[^']|'')*)'|(-?[\d.]+))$/u;
const IS_NULL = /^"?(\w+)"? IS (NOT )?NULL$/u;
const LIKE = /^"?(\w+)"? LIKE '((?:[^']|'')*)' ESCAPE '!'$/u;
const byValue = (a: string, b: string) =>
  /^-?[\d.]+$/u.test(a) && /^-?[\d.]+$/u.test(b) ? Number(a) - Number(b) : a.localeCompare(b);

/** Whether a row holds one condition the grid writes (see ui/grid/filters.js); others hold. */
function holds(head: string[], row: string[], condition: string) {
  const bare = condition.replace(/^\((.*)\)$/u, "$1");
  const at = (name = "") => row[head.indexOf(name)];
  const compare = COMPARE.exec(bare);
  if (compare) {
    const value = at(compare[1]);
    const by =
      value === undefined
        ? 0
        : byValue(value, (compare[3] ?? compare[4] ?? "").replaceAll("''", "'"));
    return { "=": by === 0, "<>": by !== 0, ">": by > 0, "<": by < 0 }[compare[2] ?? "="];
  }
  if (IS_NULL.test(bare)) return Boolean(IS_NULL.exec(bare)?.[2]);
  const like = LIKE.exec(bare);
  if (like) {
    const needle = (like[2] ?? "").replace(/^%|%$/gu, "").replace(/!(.)/gu, "$1");
    return (at(like[1]) ?? "").toLowerCase().includes(needle.toLowerCase());
  }
  return true;
}

/** The rows a page asks for, the header first, as the scripted server filters and orders them. */
function pageOf(rows: string[][], where: string, order: string, limit = "500", offset = "0") {
  const [head = [], ...body] = rows;
  const kept = body.filter((row) => where.split(" AND ").every((c) => !c || holds(head, row, c)));
  const keys = order
    ? order.split(", ").map((key) => /^"?(\w+)"?(?: (ASC|DESC))?$/u.exec(key))
    : [];
  kept.sort((a, b) => {
    for (const key of keys) {
      const c = head.indexOf(key?.[1] ?? "");
      const by = byValue(a[c] ?? "", b[c] ?? "");
      if (by) return key?.[2] === "DESC" ? -by : by;
    }
    return 0;
  });
  return [head, ...kept.slice(Number(offset), Number(offset) + Number(limit))];
}

const SHOP = shop();
/** The scripted clients' answers: the schema cache's PostgreSQL catalog, then the SQLite fixture. */
export const fixtureScript: Script = catalogScript(
  () => SHOP,
  (sql, env) => (env.PGDATABASE ? pgFixtureScript(sql) : sqliteScript(sql, env)),
);

/** proc.spawn and proc.kill over the scripted clients; each run's output is emitted a tick later. */
export function procHandlers(script: Script, emit: (event: BridgeEvent) => void): StubHandlers {
  let n = 0;
  return {
    "proc.spawn": ({ command, args = [], env = {} }) => {
      const procId = `p-${++n}`;
      const reply = scriptedReply(command, args, script, env as Record<string, string>);
      setTimeout(() => {
        for (const stream of ["stdout", "stderr"] as const)
          if (reply[stream])
            emit({
              event: "proc.output",
              data: { procId, stream, data: reply[stream], encoding: "utf8" },
            });
        emit({ event: "proc.exit", data: { procId, code: reply.code } });
      }, 0);
      return { procId, pid: 100 + n };
    },
    "proc.kill": () => ({}),
  };
}
