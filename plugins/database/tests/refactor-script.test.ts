// The script of an object's rename (PG-33): the ALTER of each kind, and the whole script made from
// the server's rows (read-sql.js's statements): one transaction, the rewritten bodies first with
// function bodies unchecked, the ALTER last, and a header that says what was rewritten, what follows
// the rename by itself and what to check by hand.
import { describe, expect, it } from "vitest";
import type { Rename } from "../ui/refactor/bodies.js";
import { factsOf, partsOf, renameOf } from "../ui/refactor/object.js";
import { renameReadSql } from "../ui/refactor/read-sql.js";
import { alterOf, renameScript } from "../ui/refactor/script.js";

const rel = (relkind: string): Rename => ({
  kind: "relation",
  relkind,
  schema: "public",
  name: "t",
  to: "u",
});

describe("the ALTER of each kind", () => {
  it("relations by their kind, a column, a routine with its arguments, a type, a domain, a schema", () => {
    expect(alterOf(rel("table"))).toBe("ALTER TABLE public.t RENAME TO u;");
    expect(alterOf(rel("partitioned table"))).toBe("ALTER TABLE public.t RENAME TO u;");
    expect(alterOf(rel("view"))).toBe("ALTER VIEW public.t RENAME TO u;");
    expect(alterOf(rel("materialized view"))).toBe("ALTER MATERIALIZED VIEW public.t RENAME TO u;");
    expect(alterOf(rel("sequence"))).toBe("ALTER SEQUENCE public.t RENAME TO u;");
    expect(alterOf(rel("foreign table"))).toBe("ALTER FOREIGN TABLE public.t RENAME TO u;");
    expect(
      alterOf({
        kind: "column",
        relkind: "view",
        schema: "public",
        table: "v",
        name: "a",
        to: "Big",
      }),
    ).toBe('ALTER VIEW public.v RENAME COLUMN a TO "Big";');
    expect(
      alterOf({
        kind: "function",
        routine: "procedure",
        schema: "public",
        name: "refund",
        args: "order_id integer",
        overloads: 1,
        to: "pay_back",
      }),
    ).toBe("ALTER PROCEDURE public.refund(order_id integer) RENAME TO pay_back;");
    expect(
      alterOf({ kind: "type", domain: false, schema: "public", name: "mood", to: "feeling" }),
    ).toBe("ALTER TYPE public.mood RENAME TO feeling;");
    expect(
      alterOf({ kind: "type", domain: true, schema: "public", name: "email", to: "mail" }),
    ).toBe("ALTER DOMAIN public.email RENAME TO mail;");
    expect(alterOf({ kind: "schema", name: "sales", to: "select" })).toBe(
      'ALTER SCHEMA sales RENAME TO "select";',
    );
  });
});

describe("the whole script", () => {
  const aim = { kind: "column" as const, schema: "public", table: "people", name: "name" };
  const facts = factsOf([["r", "0", "", "[]"]]);
  const bodies = [
    [
      "public",
      "shout",
      "",
      "function",
      "plpgsql",
      " BEGIN UPDATE people SET name = upper(name); EXECUTE 'select name from people'; END ",
      "CREATE OR REPLACE FUNCTION public.shout()\n RETURNS void\n LANGUAGE plpgsql\nAS $function$ BEGIN UPDATE people SET name = upper(name); EXECUTE 'select name from people'; END $function$\n",
      "[]",
      "[]",
      "",
    ],
  ];
  const catalog = [
    ["policy", "public", "own_rows", "people", ""],
    ["view", "public", "named", "", ""],
  ];

  it("reads the facts, the bodies and the dependency catalog in one read", () => {
    const sql = renameReadSql(aim);
    expect(sql.split(";\n").length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("pg_get_functiondef(p.oid)");
    expect(sql).toContain("FROM pg_depend d JOIN target t");
  });

  it("rewrites the bodies before the ALTER, in one transaction, and says what it did", () => {
    if (!facts) throw new Error("no facts");
    const r = renameOf(aim, facts, "full_name");
    const parts = partsOf(r, facts, bodies, catalog);
    expect(renameScript(r, parts)).toBe(`-- Rename public.people.name to full_name. Nothing has run.
-- Read it, then run it in this console: one transaction, under the connection's guards.
--
-- Rewritten here (1): routine bodies the server keeps as text.
--   function public.shout(): 2 places
-- Follow the rename by themselves (2): the server records them by reference.
--   policy public.own_rows on people
--   view public.named
--   A view keeps name as the name of its own column: rename that too if callers read it.
-- Check by hand (1): what cannot be proven safe.
--   function public.shout(), line 1: the name is in a string (dynamic SQL?)

BEGIN;
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shout()
 RETURNS void
 LANGUAGE plpgsql
AS $function$ BEGIN UPDATE people SET full_name = upper(full_name); EXECUTE 'select name from people'; END $function$;

ALTER TABLE public.people RENAME COLUMN name TO full_name;
COMMIT;
`);
  });

  it("a function with overloads is the one chosen, and a schema's settings are checked by hand", () => {
    const f = factsOf([["f", "0", "", '[["a integer","f"],["a text","f"]]']]);
    if (!f) throw new Error("no facts");
    const r = renameOf({ kind: "function", schema: "public", name: "g" }, f, "h", 1);
    expect(alterOf(r)).toBe("ALTER FUNCTION public.g(a text) RENAME TO h;");
    const s = renameOf({ kind: "schema", name: "sales" }, f, "deals");
    const parts = partsOf(
      s,
      f,
      [
        [
          "public",
          "k",
          "",
          "function",
          "sql",
          "select 1",
          "x",
          "[]",
          "[]",
          "search_path=sales, public",
        ],
      ],
      [],
    );
    expect(parts.checks).toEqual([
      {
        label: "function public.k()",
        why: "its settings name the schema (search_path=sales, public)",
      },
    ]);
  });
});
