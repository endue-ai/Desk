// Renaming a name the statement defines itself (PG-33), as before and after pairs over the shop's
// schema with the parse worker's resolver in this thread: a CTE from its use or its definition, an
// alias written or not, an output name with or without AS, a SQL routine's parameter; strings and
// comments keep the old name; a taken name is refused; a name that needs quotes gets them.
import { beforeAll, describe, expect, it } from "vitest";
import { renameLocal, targetAt } from "../ui/refactor/local.js";
import type { Name } from "../ui/sql/parse/scope.js";
import { marked, shopResolver } from "./navigate-fixture";

let resolve: (sql: string) => Name[];
beforeAll(async () => {
  ({ resolve } = await shopResolver());
});

/** The text after renaming what the caret (`|`) is on. */
function renamed(text: string, to: string) {
  const { text: sql, caret } = marked(text);
  const names = resolve(sql);
  const target = targetAt(sql, names, caret);
  if (!target || !("local" in target)) throw new Error(`no local name: ${JSON.stringify(target)}`);
  const done = renameLocal(sql, names, target.local, to);
  return typeof done === "string" ? done : done.text;
}

describe("rename a name the statement defines", () => {
  it("a CTE: its definition and every use, from either", () => {
    const before =
      "with t| as (select id from people) select t.id, 't' from t join t u on true -- t";
    expect(renamed(before, "picked")).toBe(
      "with picked as (select id from people) select picked.id, 't' from picked join picked u on true -- t",
    );
    expect(renamed("with t as (select 1 as x) select x from t|", "one")).toBe(
      "with one as (select 1 as x) select x from one",
    );
  });

  it("an alias: written, and a FROM item without one, which gains it", () => {
    expect(renamed("select p|.name from people p where p.id = 1 and 'p.id' <> ''", "who")).toBe(
      "select who.name from people who where who.id = 1 and 'p.id' <> ''",
    );
    expect(renamed("select people|.name from people where people.id = 1", "who")).toBe(
      "select who.name from people AS who where who.id = 1",
    );
    expect(renamed("select o.id from orders o|", "ord")).toBe("select ord.id from orders ord");
  });

  it("an output name, with AS or without", () => {
    expect(renamed("select name as n from people order by n|", "who")).toBe(
      "select name as who from people order by who",
    );
    expect(renamed("select upper(name) up from people order by up|", "loud")).toBe(
      "select upper(name) loud from people order by loud",
    );
  });

  it("a SQL routine's parameter, in its list and its body", () => {
    expect(
      renamed("create function f(p| int, q int) returns int language sql return p + q", "a"),
    ).toBe("create function f(a int, q int) returns int language sql return a + q");
  });

  it("refuses a taken name and quotes one that needs it", () => {
    expect(renamed("with a as (select 1), b| as (select 2) select * from a, b", "a")).toBe(
      "a is already a CTE of this statement.",
    );
    expect(renamed("with t| as (select 1) select * from t", "Big One")).toBe(
      'with "Big One" as (select 1) select * from "Big One"',
    );
  });

  it("an object of the schema is not a local name", () => {
    const { text, caret } = marked("select na|me from people");
    expect(targetAt(text, resolve(text), caret)).toEqual({
      object: { kind: "column", schema: "public", table: "people", name: "name" },
    });
  });
});
