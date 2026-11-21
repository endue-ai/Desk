// PG-50's kinds of the shop catalog's public schema (pg-catalog.ts) as PostgreSQL 17 answers their
// readers (ui/schema/pg/): types of every kind, an aggregate, an operator, a collation and a text
// search configuration; a partitioned table's partitions, a table that inherits, a policy and a
// rule. The database level is pg-level-fixture.ts. Fixture data only.
import type { PgRows, PgTable } from "./pg-catalog";

const j = (value: unknown) => JSON.stringify(value);

/** public's rows of the three per-schema readers. */
export function shopKinds(): PgRows {
  return {
    types: [
      [
        "four",
        "b",
        j({
          input: "four_in",
          output: "four_out",
          receive: null,
          send: null,
          typmodIn: null,
          typmodOut: null,
          analyze: null,
          subscript: null,
          length: 4,
          byValue: true,
          align: "i",
          storage: "p",
          category: "U",
          preferred: false,
          default: null,
          element: null,
          delimiter: ",",
          collatable: false,
        }),
        "app",
        "16409",
        "",
      ],
      ["mood", "e", j(["sad", "ok", "so so"]), "app", "16410", "How it went"],
      [
        "pair",
        "c",
        j([
          ["x", "integer", null],
          ["Y z", "text", '"C"'],
        ]),
        "app",
        "16411",
        "",
      ],
      [
        "positive",
        "d",
        j({
          base: "numeric(10,2)",
          default: "1",
          notNull: true,
          collation: null,
          checks: [["positive_check", "CHECK (VALUE > 0::numeric)"]],
        }),
        "app",
        "16412",
        "",
      ],
      [
        "span",
        "r",
        j({
          subtype: "integer",
          opclass: null,
          collation: null,
          canonical: null,
          subdiff: null,
          multirange: "span_multirange",
        }),
        "app",
        "16413",
        "",
      ],
    ],
    objects: [
      [
        "aggregate",
        "total",
        "integer",
        j({
          kind: "n",
          direct: 0,
          sfunc: "add_int",
          stype: "integer",
          sspace: 0,
          finalModify: "r",
          initcond: "0",
          mfinalModify: "r",
          parallel: "u",
        }),
        "app",
        "16420",
        "Sums",
      ],
      [
        "collation",
        "plain",
        "",
        j({
          provider: "c",
          deterministic: true,
          collate: "C",
          ctype: "C",
          locale: null,
          rules: null,
        }),
        "app",
        "16421",
        "",
      ],
      [
        "operator",
        "###",
        "integer, integer",
        j({
          function: "add_int",
          left: "integer",
          right: "integer",
          result: "integer",
          commutator: ["public", "###"],
          negator: null,
          restrict: null,
          join: null,
          hashes: false,
          merges: false,
        }),
        "app",
        "16422",
        "",
      ],
      [
        "text search configuration",
        "words",
        "",
        j({
          parser: ["pg_catalog", "default"],
          maps: [
            ["asciiword", ["english_stem"]],
            ["word", ["english_stem"]],
            ["email", ["simple"]],
          ],
        }),
        "app",
        "16423",
        "",
      ],
    ],
    "table parts": [
      [
        "events",
        "partition",
        "events_2026",
        "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
        j({ schema: "public", parent: ["public", "events"], key: "LIST (id)", foreign: false }),
      ],
      [
        "events",
        "partition",
        "events_2026_one",
        "FOR VALUES IN (1)",
        j({ schema: "public", parent: ["public", "events_2026"], key: null, foreign: false }),
      ],
      [
        "events",
        "partition",
        "events_rest",
        "DEFAULT",
        j({ schema: "public", parent: ["public", "events"], key: null, foreign: false }),
      ],
      ["people_archive", "inherits", "people", "public.people", j({ schema: "public", seq: 1 })],
      [
        "people",
        "policy",
        "own_rows",
        "select",
        j({
          cmd: "r",
          permissive: true,
          roles: ["app"],
          using: "(id > 0)",
          check: null,
          comment: null,
        }),
      ],
      [
        "people",
        "rule",
        "no_delete",
        "on delete · instead",
        j({
          def: "CREATE RULE no_delete AS\n    ON DELETE TO people DO INSTEAD NOTHING;",
          comment: null,
        }),
      ],
    ],
  };
}

/** The partitioned table public's partitions hang under, and a table that inherits people. */
export const MORE_TABLES: PgTable[] = [
  {
    name: "events",
    kind: "p",
    columns: [
      ["id", "integer", ""],
      ["at", "date", "n"],
    ],
  },
  {
    name: "people_archive",
    estimate: "0",
    columns: [
      ["id", "integer", "n"],
      ["name", "text", "n"],
      ["joined", "timestamp with time zone", ""],
    ],
  },
];
