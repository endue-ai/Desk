// Extract a subquery into a CTE and inline a CTE used once (PG-33), as before and after pairs over
// the shop's schema with the parse worker's resolver in this thread; what would change the result
// is refused with why.
import { beforeAll, describe, expect, it } from "vitest";
import { extractCte, inlineCte } from "../ui/refactor/cte.js";
import type { Name } from "../ui/sql/parse/scope.js";
import { marked, shopResolver } from "./navigate-fixture";

let resolve: (sql: string) => Name[];
beforeAll(async () => {
  ({ resolve } = await shopResolver());
});

const extracted = (text: string, name?: string) => {
  const { text: sql, caret } = marked(text);
  const done = extractCte(sql, resolve(sql), caret, name);
  return typeof done === "string" ? done : done.text;
};
const inlined = (text: string, cte: string) => {
  const done = inlineCte(text, resolve(text), text.indexOf(cte));
  return typeof done === "string" ? done : done.text;
};

describe("extract a subquery into a CTE", () => {
  it("a FROM subquery without a WITH list gets one", () => {
    expect(extracted("select s.id from (select id from pe|ople) s where s.id > 1")).toBe(
      "WITH s AS (select id from people)\nselect s.id from s where s.id > 1",
    );
  });

  it("after an existing WITH list, with the alias's column names", () => {
    expect(
      extracted("with a as (select 1) select * from a, (select id from or|ders) as o(n)"),
    ).toBe("with a as (select 1),\no(n) AS (select id from orders) select * from a, o");
  });

  it("before the CTE whose body holds it", () => {
    expect(extracted("with a as (select * from (select 1 as x|) s) select * from a")).toBe(
      "with s AS (select 1 as x),\na as (select * from s) select * from a",
    );
  });

  it("a subquery without an alias takes the name given", () => {
    expect(extracted("select * from (select 1|)", "one")).toBe(
      "WITH one AS (select 1)\nselect * from one",
    );
    expect(extracted("select * from (select 1|)")).toBe(
      "Name the subquery: give it an alias first.",
    );
  });

  it("refuses LATERAL, a nested subquery and a condition's subquery", () => {
    expect(extracted("select * from people p, lateral (select p.id + 1|) x")).toContain("LATERAL");
    expect(extracted("select (select x from (select 1 as x|) s) from people")).toContain(
      "statement's own FROM list",
    );
    expect(extracted("select * from people where id in (select 1|)")).toBe(
      "Put the caret in a subquery of a FROM list.",
    );
  });
});

describe("inline a CTE used once", () => {
  it("under its own name, and the WITH goes with its only entry", () => {
    expect(inlined("with t as (select id from people) select t.id from t", "t as")).toBe(
      "select t.id from (select id from people) AS t",
    );
  });

  it("under the use's alias, the other entries kept", () => {
    expect(
      inlined("with a as (select 1 as x), b as (select 2 as y) select * from a, b z", "b as"),
    ).toBe("with a as (select 1 as x) select * from a, (select 2 as y) z");
    expect(
      inlined("with a as (select 1 as x), b as (select x from a) select * from b", "a as"),
    ).toBe("with b as (select x from (select 1 as x) AS a) select * from b");
  });

  it("refuses what would change the result", () => {
    expect(inlined("with t as (select 1) select * from t, t u", "t as")).toContain("used 2 times");
    expect(inlined("with recursive t as (select 1) select * from t", "t as")).toContain(
      "RECURSIVE",
    );
    expect(inlined("with t as materialized (select 1) select * from t", "t as")).toContain(
      "MATERIALIZED",
    );
    expect(
      inlined("with t as (delete from orders returning id) select * from t", "t as"),
    ).toContain("writes data");
    expect(inlined("with t as (select 1) select 2", "t as")).toContain("used nowhere");
  });
});
