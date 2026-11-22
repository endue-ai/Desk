// Qualify every name (PG-33), as before and after pairs over the shop's schema with the parse
// worker's resolver in this thread: schemas before relations and routines, FROM items before a
// query's columns; what cannot take a qualifier, or could be either of two, stays as written.
import { beforeAll, describe, expect, it } from "vitest";
import { qualifyNames } from "../ui/refactor/qualify.js";
import type { Name } from "../ui/sql/parse/scope.js";
import { shopResolver } from "./navigate-fixture";

let resolve: (sql: string) => Name[];
beforeAll(async () => {
  ({ resolve } = await shopResolver());
});

const qualified = (sql: string) => qualifyNames(sql, resolve(sql));

describe("qualify every name", () => {
  it("relations, routines and a query's columns", () => {
    expect(
      qualified("select name, o.total from people join orders o on person = people.id").text,
    ).toBe(
      "select people.name, o.total from public.people join public.orders o on o.person = people.id",
    );
    expect(qualified("select t.x from (select 1 as x) t where x > 0").text).toBe(
      "select t.x from (select 1 as x) t where t.x > 0",
    );
  });

  it("a CTE's columns under its name, pg_catalog's routines bare, a routine of the schema qualified", () => {
    expect(
      qualified("with t as (select id from people) select count(id), touch() from t").text,
    ).toBe(
      "with t as (select people.id from public.people) select count(t.id), public.touch() from t",
    );
  });

  it("the columns a DML statement writes stay as written, and USING lists", () => {
    expect(qualified("insert into orders (id, person) select id, id from people").text).toBe(
      "insert into public.orders (id, person) select id, id from public.people",
    );
    expect(qualified("select name from people join orders using (id)").text).toBe(
      "select people.name from public.people join public.orders using (id)",
    );
  });

  it("an output name is left, and a column of a table read twice is counted, not guessed", () => {
    const done = qualified("select a.name n, id from people a, people b order by n");
    expect(done.text).toBe("select a.name n, id from public.people a, public.people b order by n");
    expect(done.unsure).toBe(1);
  });
});
