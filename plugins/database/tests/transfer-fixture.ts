// A copy between two scripted PostgreSQL databases (PG-63): `shop` holds public.items (an id with
// its key, a name with an index) and answers the catalog reads and its rows as COPY's text; the
// target `archive` has an empty public schema, takes BEGIN, the structure, COPY ... FROM STDIN and
// COMMIT, and refuses the statements `fail` names. The runtime page answers through transferServer:
// a read of public.items, and any statement on `archive`, before the page's other answers. Fixture
// data only.
import type { Connection } from "../ui/engines/common.js";
import { ddlQueries } from "../ui/schema/postgres.js";
import { foreignKeysSql } from "../ui/transfer/read.js";
import type { Answer, Script } from "./clients";
import { PG } from "./session-helpers";

export const ARCHIVE: Connection = { ...PG, id: "c-archive", name: "Archive", database: "archive" };
export const LOCKED: Connection = { ...PG, id: "c-locked", name: "Locked", readOnly: true };
export const ITEMS = "1\tpen\n2\tink\n3\tpaper\n";

const SOURCE: [RegExp, Answer][] = [
  [
    /^SELECT a\.attname/u,
    {
      rows: [
        ["n", "t", "nn", "d", "i", "g", "c"],
        ["id", "integer", "YES", null, "", "", null],
        ["name", "text", "NO", null, "", "", null],
      ],
    },
  ],
  [
    /^SELECT CASE k\.contype/u,
    {
      rows: [
        ["k", "n", "d", "e"],
        ["primary key", "items_pkey", "PRIMARY KEY (id)", ""],
      ],
    },
  ],
  [
    /^SELECT 'index'/u,
    {
      rows: [
        ["k", "n", "d", "e"],
        [
          "index",
          "items_pkey",
          "CREATE UNIQUE INDEX items_pkey ON public.items USING btree (id)",
          "constraint",
        ],
        [
          "index",
          "items_name_idx",
          "CREATE INDEX items_name_idx ON public.items USING btree (name)",
          "",
        ],
      ],
    },
  ],
  [/^SELECT 'trigger'/u, { rows: [["k", "n", "d", "e"]] }],
  [
    /^SELECT c\.relkind::text/u,
    {
      rows: [
        ["k", "p", "c", "pk", "s", "r", "f"],
        ["r", "p", null, null, null, null, null],
      ],
    },
  ],
  [/^SELECT k\.conname/u, { rows: [["n", "d", "s", "t", "r"]] }],
  [
    /^COPY \(SELECT "id", "name" FROM "public"\."items"\) TO STDOUT/u,
    { copy: { direction: "out", data: ITEMS } },
  ],
];
const TARGET: [RegExp, Answer][] = [
  [/^SELECT t FROM unnest/u, { rows: [["t"]] }],
  [/^SELECT n\.nspname FROM/u, { rows: [["n"], ["public"]] }],
  [/^SELECT n\.nspname, c\.relname/u, { rows: [["s", "t", "n", "y", "g"]] }],
  [/^COPY .* FROM STDIN/u, { copy: { direction: "in", columns: 2 } }],
];

/** The two databases; `fail` makes the target refuse a statement that matches it. */
export function transferScript(fail?: RegExp): Script {
  return (sql, who) => {
    if (
      /^SELECT current_setting\('server_version_num'\), current_setting\('server_version'\)$/u.test(
        sql,
      )
    )
      return {
        rows: [["n", "v"], who.database === "archive" ? ["150004", "15.4"] : ["170002", "17.2"]],
      };
    if (who.database === "archive" && fail?.test(sql))
      return { error: 'relation "public.items" already exists', code: "42P07" };
    const answers = who.database === "archive" ? TARGET : SOURCE;
    return answers.find(([pattern]) => pattern.test(sql))?.[1] ?? {};
  };
}

/** The statements a copy of public.items sends to `shop`, exactly as read.js and plan.js write them. */
const ASKED = new Set([
  ...ddlQueries({
    schema: "public",
    name: "items",
    kind: "table",
    detail: "",
    rows: null,
    ident: "",
  } as never),
  foreignKeysSql("public", "items"),
  'COPY (SELECT "id", "name" FROM "public"."items") TO STDOUT',
  "SELECT current_setting('server_version_num'), current_setting('server_version')",
]);

/** The runtime page's copy (PG-63): the `archive` database, and shop's statements of a copy of
 * public.items; any other statement goes to `inner`. */
export function transferServer(inner: Script): Script {
  const own = transferScript();
  return (sql, who, bound) =>
    who.database === "archive" || (who.database === "shop" && ASKED.has(sql.trim()))
      ? own(sql, who, bound)
      : inner(sql, who, bound);
}
