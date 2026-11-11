// A fixture SQLite database for endue.database behind proc.spawn, as the browser stub serves it: a
// saved connection, two tables (people, orders) whose catalog and rows the scripted sqlite3 answers,
// and the proc.* handlers that emit each run's output as desk-core does. The runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) uses them; nothing here needs Node.
import type { BridgeEvent, StubHandlers } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import { type Script, scriptedReply } from "./clients";

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
const ORDERS = [
  ["id", "person", "total"],
  ["1", "1", "12"],
  ["2", "2", "30"],
];
const TABLES: Record<string, string[][]> = { people: PEOPLE, orders: ORDERS };

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
export const fixtureScript: Script = (sql) => {
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
  const from = /^select \* from "?(\w+)"?/iu.exec(text);
  if (from) return { rows: rowsOf(from[1]) };
  const count = /^SELECT count\(\*\) FROM "?(\w+)"?/iu.exec(text);
  if (count) return { rows: [["count"], [String(Math.max(0, rowsOf(count[1]).length - 1))]] };
  return {};
};

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
