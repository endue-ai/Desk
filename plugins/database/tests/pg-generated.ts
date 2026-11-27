// The SQL the plugin writes itself for PostgreSQL, as it sends it: what the explorer runs, the DDL
// of each kind of object, a table's page and count, a paged console SELECT, a grid's edits, an
// import and an EXPLAIN. With the corpus's scripts, the fixtures the tests that read whole scripts
// share (the splitter against the parser, Format SQL's layout).
import { tableSql } from "../ui/catalog.js";
import {
  addRow,
  deleteRows,
  editCell,
  emptyChanges,
  planChanges,
  targetOf,
} from "../ui/edit/pending.js";
import { engineOf } from "../ui/engines/index.js";
import { explainSql } from "../ui/explain/plan.js";
import { importStatements } from "../ui/import.js";
import { pagedSql } from "../ui/pages.js";
import { schemaOf } from "../ui/schema/index.js";
import { split } from "../ui/sql/split.js";
import { SCRIPTS } from "./pg-corpus";

const pg = schemaOf("postgresql");
const object = (kind: string, name: string, fields: Record<string, unknown> = {}) =>
  ({ schema: "app", name, kind, detail: "", rows: null, ident: "", ...fields }) as never;

/** What the explorer runs, joined as the catalog sends it (one client run, `;\n` between). */
const catalog = [
  engineOf("postgresql").catalog.schemas(false),
  engineOf("postgresql").catalog.columns("app", "people"),
  ...pg.objects("app"),
  ...pg.parts("app", "people"),
  ...pg.ddlQueries(object("table", "people")),
  ...pg.ddlQueries(object("materialized view", "totals")),
  ...pg.ddlQueries(object("sequence", "people_id_seq")),
  ...pg.ddlQueries(object("function", "touch()", { ident: "16384" })),
].join(";\n");

/** The DDL the explorer shows, from rows shaped like the server's. */
const ddl = [
  pg.ddl(object("table", "people"), [
    [
      ["id", "bigint", "YES", null, "a", "", null],
      ["name", "text", "NO", "'it''s; fine'::text", "", "", "Their name; as written"],
      ["net", "numeric", "NO", "(total / 1.2)", "", "s", null],
    ],
    [["primary key", "people_pkey", "PRIMARY KEY (id)", ""]],
    [
      [
        "index",
        "people_name_idx",
        "CREATE INDEX people_name_idx ON app.people USING btree (name)",
        "",
      ],
    ],
    [
      [
        "trigger",
        "people_touch",
        "CREATE TRIGGER people_touch BEFORE UPDATE ON app.people FOR EACH ROW EXECUTE FUNCTION app.touch()",
        "",
      ],
    ],
    [["r", "p", "Everyone; once", null, null]],
  ]),
  pg.ddl(object("view", "adults"), [
    [[" SELECT people.id\n   FROM app.people\n  WHERE people.id > 18;"]],
  ]),
  pg.ddl(object("sequence", "people_id_seq"), [
    [["bigint", "1", "1", "1", "9223372036854775807", "1", "NO"]],
  ]),
  pg.ddl(object("function", "touch()"), [
    [
      [
        "CREATE OR REPLACE FUNCTION app.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ BEGIN NEW.at := now(); RETURN NEW; END; $function$\n",
      ],
    ],
  ]),
].join("\n");

const conn = { engine: "postgresql" } as never;
const page = tableSql(conn, {
  schema: "app",
  table: "people",
  where: "name <> ';'",
  order: "id desc",
  limit: 50,
  offset: 100,
});
const [console] = split("select * from people -- every one\n", "postgresql");
const paged = console && pagedSql(console, "postgresql", 50, 100);

const set = {
  columns: ["id", "name"],
  rows: [
    ["1", "a;b"],
    ["2", "c"],
  ] as (string | null)[][],
  truncated: false,
};
const made = targetOf("postgresql", { schema: "app", name: "people" }, set.columns, [
  { name: "id", type: "integer", primary: true },
  { name: "name", type: "text", primary: false },
]);
if (!made.target) throw new Error(made.reason);
const changes = emptyChanges();
editCell(changes, made.target, set, 0, 1, "it's; new");
editCell(changes, made.target, set, addRow(changes, made.target, set), 0, "3");
deleteRows(changes, made.target, set, [1]);
const edits = planChanges(made.target, set, changes).map((c) => c.sql);

const imports = importStatements({
  dialect: "postgresql",
  table: '"app"."people"',
  columns: [
    { name: "id", type: "integer" },
    { name: "name", type: "text" },
  ],
  mapping: ["id", "name"],
  rows: Array.from({ length: 7 }, (_, i) => [String(i), `row ${i}; with a \\ and a '`]),
  batch: 3,
});

/** [name, script]: each corpus script, then the plugin's own SQL. */
export const FIXTURES: Array<[string, string]> = [
  ...SCRIPTS.map((sql, i): [string, string] => [`script ${i}`, sql]),
  ["catalog", catalog],
  ["ddl", ddl],
  ["page", `${page.page};\n${page.count}`],
  ["paged console", paged?.text ?? ""],
  ["edits", ["BEGIN", ...edits, "COMMIT"].join(";\n")],
  ["import", imports.join(";\n")],
  ["explain", explainSql("postgresql", "", "select * from people where name = ';'", true)],
];
