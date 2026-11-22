// A scripted PostgreSQL server for the schema comparison (ui/features/compare-schema/): two schemas,
// `dev` and `prod`, answered to the comparison's reads (read-sql.js, each named by its opening
// comment) in the columns PostgreSQL 17 gives them, and the DDL a run sends recorded. dev is prod a
// step ahead: an enum value, a column, a check, a table, a view's query. The unit tests and the
// runtime e2e page share it; it needs no Node. Fixture data only.
import type { Answer, Script } from "./clients";
import { CASTS, column, METHODS, ROLES, TYPES } from "./table-design-fixture";

type Row = (string | null)[];
export interface SchemaRows {
  tables: Record<
    string,
    { oid: string; table: Row; columns: Row[]; constraints: Row[]; indexes: Row[] }
  >;
  views: Row[];
  sequences: Row[];
  routines: Row[];
  types: Row[];
  triggers: Row[];
}

const con = (
  oid: string,
  type: string,
  name: string,
  cols: string,
  expr: string,
  def: string,
  ref: [string, string, string] = ["", "", "[]"],
): Row => [oid, type, name, cols, expr, ...ref, "a", "a", "false", def, "false"];

const FN = (schema: string) =>
  `CREATE OR REPLACE FUNCTION ${schema}.total_of(p integer)\n RETURNS numeric\n LANGUAGE sql\nAS $function$ select sum(total) from ${schema}.orders where person = p $function$\n`;

/** prod: people, orders, a sequence, an enum, a view, a function and a trigger. */
export function prodRows(schema = "prod"): SchemaRows {
  const peopleCols = [
    column(1, "id", "integer", {
      notNull: true,
      expression: `nextval('${schema}.people_id_seq'::regclass)`,
    }),
    column(2, "name", "text", { notNull: true }),
    column(3, "joined", "timestamp with time zone", { expression: "now()" }),
  ];
  return {
    tables: {
      people: {
        oid: "20001",
        table: ["20001", "r", "app", "Who buys", "", "false"],
        columns: peopleCols,
        constraints: [con("20010", "p", "people_pkey", "[1]", "", "PRIMARY KEY (id)")],
        indexes: [
          [
            "20011",
            "people_name",
            "btree",
            "false",
            '[[2,""]]',
            "",
            "false",
            `CREATE INDEX people_name ON ${schema}.people USING btree (name)`,
          ],
        ],
      },
      orders: {
        oid: "20002",
        table: ["20002", "r", "app", "", "", "false"],
        columns: [
          column(1, "id", "integer", { notNull: true, identity: "a" }),
          column(2, "person", "integer"),
          column(3, "total", "numeric", { length: "10,2" }),
        ],
        constraints: [
          con(
            "20020",
            "c",
            "orders_total_check",
            "[3]",
            "total >= 0::numeric",
            "CHECK (total >= 0::numeric)",
          ),
          con(
            "20021",
            "f",
            "orders_person_fkey",
            "[2]",
            "",
            "FOREIGN KEY (person) REFERENCES people(id)",
            [schema, "people", '["id"]'],
          ),
          con("20022", "p", "orders_pkey", "[1]", "", "PRIMARY KEY (id)"),
        ],
        indexes: [],
      },
    },
    views: [
      ["big_orders", "v", " SELECT id,\n    total\n   FROM orders\n  WHERE total > 100::numeric;"],
    ],
    sequences: [["people_id_seq", "integer", "1", "1", "1", "2147483647", "1", "false"]],
    routines: [["total_of", "p integer", "f", FN(schema)]],
    types: [["mood", "e", '["sad","ok"]', "", "false", "[]"]],
    triggers: [],
  };
}

/** dev: prod with glad, people.email, a stricter check, tags, and big orders past 500. */
export function devRows(schema = "dev"): SchemaRows {
  const rows = prodRows(schema);
  const people = rows.tables.people;
  const orders = rows.tables.orders;
  if (!people || !orders) throw new Error("fixture");
  people.columns.push(column(4, "email", "text", { comment: "Where receipts go" }));
  orders.constraints[0] = con(
    "20020",
    "c",
    "orders_total_check",
    "[3]",
    "total > 0::numeric",
    "CHECK (total > 0::numeric)",
  );
  rows.tables.tags = {
    oid: "20003",
    table: ["20003", "r", "app", "", "", "false"],
    columns: [
      column(1, "id", "integer", { notNull: true }),
      column(2, "person", "integer"),
      column(3, "label", "text", { notNull: true }),
    ],
    constraints: [
      con(
        "20030",
        "f",
        "tags_person_fkey",
        "[2]",
        "",
        "FOREIGN KEY (person) REFERENCES people(id)",
        [schema, "people", '["id"]'],
      ),
      con("20031", "p", "tags_pkey", "[1]", "", "PRIMARY KEY (id)"),
    ],
    indexes: [],
  };
  rows.views = [
    ["big_orders", "v", " SELECT id,\n    total\n   FROM orders\n  WHERE total > 500::numeric;"],
  ];
  rows.types = [["mood", "e", '["sad","ok","glad"]', "", "false", "[]"]];
  return rows;
}

const header = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const answer = (list: Row[], n = list[0]?.length ?? 1): Answer => ({ rows: [header(n), ...list] });

/** The comparison's read a statement is (its opening comment), and the schema it names. */
export function readOf(sql: string) {
  const key = /^\/\* schema-compare (\S+) \*\//u.exec(sql.trim())?.[1];
  const schema = /nspname = '((?:[^']|'')*)'/u.exec(sql)?.[1]?.replaceAll("''", "'") ?? "";
  return key ? { key, schema } : undefined;
}

/** One read's rows of a schema. */
export function readRows(key: string, s: SchemaRows | undefined): Answer {
  const tables = Object.entries(s?.tables ?? {});
  const own = (rows: (t: SchemaRows["tables"][string]) => Row[], n: number) =>
    answer(
      tables.flatMap(([, t]) => rows(t).map((r) => [...r, t.oid])),
      n + 1,
    );
  switch (key) {
    case "server.version":
      return answer([["170006"]], 1);
    case "server.types":
      return answer(TYPES, 7);
    case "server.casts":
      return answer(CASTS, 3);
    case "server.roles":
      return answer(
        ROLES.map((r) => [r]),
        1,
      );
    case "server.methods":
      return answer(
        METHODS.map((m) => [m]),
        1,
      );
    case "tables":
      return answer(
        tables.map(([name, t]) => [t.oid, name]),
        2,
      );
    case "table.table":
      return own((t) => [t.table], 6);
    case "table.columns":
      return own((t) => t.columns, 16);
    case "table.constraints":
      return own((t) => t.constraints, 13);
    case "table.indexes":
      return own((t) => t.indexes, 8);
    case "views":
      return answer(s?.views ?? [], 3);
    case "sequences":
      return answer(s?.sequences ?? [], 8);
    case "routines":
      return answer(s?.routines ?? [], 4);
    case "types":
      return answer(s?.types ?? [], 6);
    case "triggers":
      return answer(s?.triggers ?? [], 3);
    default:
      return { error: `no read ${key}`, code: "42601" };
  }
}

/**
 * The scripted server: the comparison's reads of `schemas`, and the DDL a run sends recorded in
 * `ran`; `other` answers the rest.
 */
export function schemaCompareServer(
  other: Script = () => ({}),
  schemas: Record<string, SchemaRows> = { dev: devRows(), prod: prodRows() },
) {
  const ran: string[] = [];
  const script: Script = (sql, who) => {
    const read = readOf(sql);
    if (read && who.database) return readRows(read.key, schemas[read.schema]);
    const text = sql.trim();
    if (/^(--[^\n]*\n)*\s*(ALTER|CREATE|COMMENT|DROP|SET LOCAL)\b/u.test(text)) ran.push(text);
    return other(sql, who);
  };
  return { script, ran, schemas };
}
