// What the name at the caret stands for (PG-32): the parse worker's resolver over the shop's cached
// schema names a table, a view, a column, a procedure, a sequence and (by the word, the resolver
// binds no types) a type; on an alias, a CTE, a CTE's column and an ORDER BY output name, where the
// statement defines it.
import { beforeAll, describe, expect, it } from "vitest";
import { aimAt, definitionOf, matches } from "../ui/navigate/target.js";
import { marked, shopResolver } from "./navigate-fixture";

let at: (text: string) => (NonNullable<ReturnType<typeof aimAt>> & { text: string }) | null;
let resolve: Awaited<ReturnType<typeof shopResolver>>["resolve"];

beforeAll(async () => {
  const shop = await shopResolver();
  resolve = shop.resolve;
  const typeIn = (schema: string | undefined, name: string) =>
    (schema ? [schema] : ["public"]).find((s) =>
      shop.view.objects(s)?.some((o) => o.kind === "type" && o.name === name),
    ) ?? null;
  at = (marked_: string) => {
    const { text, caret } = marked(marked_);
    const hit = aimAt(resolve(text), text, caret, typeIn);
    return hit && { ...hit, text };
  };
});

/** Where the definition of the name at the caret is, as the text there. */
function definedAt(marked_: string) {
  const hit = at(marked_);
  if (!hit) return null;
  const place = definitionOf(hit.text, resolve(hit.text), hit);
  return place && { at: place.from, text: hit.text.slice(place.from, place.to) };
}

describe("the name at the caret", () => {
  it("names the schema's objects", () => {
    expect(at("select * from peo|ple")?.aim).toEqual({
      kind: "relation",
      schema: "public",
      name: "people",
      relkind: "table",
    });
    expect(at("select id from big_orders|")?.aim).toMatchObject({
      name: "big_orders",
      relkind: "view",
    });
    expect(at("select na|me from people")?.aim).toEqual({
      kind: "column",
      schema: "public",
      table: "people",
      name: "name",
    });
    expect(at("call ref|und(1)")?.aim).toEqual({
      kind: "function",
      schema: "public",
      name: "refund",
    });
    expect(at("select last_value from people_id_seq|")?.aim).toMatchObject({ relkind: "sequence" });
    expect(at("select 1::posi|tive")?.aim).toEqual({
      kind: "type",
      schema: "public",
      name: "positive",
    });
    expect(at("select 1::public.posi|tive")?.aim).toMatchObject({ kind: "type", name: "positive" });
    expect(at("select | 1")).toBeNull();
  });

  it("says where the name at the caret is written", () => {
    const hit = at("select p.name from peo|ple p");
    expect(hit?.text.slice(hit.from, hit.to)).toBe("people");
  });

  it("finds where an alias, a CTE and an output name are defined", () => {
    expect(definedAt("select p|.name from people p")).toEqual({ at: 26, text: "p" });
    expect(definedAt("select pp|.name from people as pp")?.text).toBe("pp");
    expect(definedAt("select o.total from people p join orders o| on o.person = p.id")).toBeNull();
    const join = "select p.name from people p join orders o on o|.person = p.id";
    expect(definedAt(join)).toEqual({ at: join.indexOf("orders o") + 7, text: "o" });
    expect(definedAt("select people|.name from people")).toEqual({ at: 24, text: "people" });
    expect(definedAt("with t as (select 1 as x) select * from t|")).toEqual({ at: 5, text: "t" });
    expect(definedAt("with t as (select 1 as x) select x| from t")).toEqual({ at: 5, text: "t" });
    const output = "select name as n from people order by n|";
    expect(definedAt(output)).toEqual({ at: output.indexOf("n from"), text: "n" });
    const sub = "select s|.id from (select id from people) s";
    expect(definedAt(sub)).toEqual({ at: sub.length - 2, text: "s" });
  });

  it("tells which resolved names stand for an object", () => {
    const text =
      "select p.name, o.person from people p join orders o on o.person = p.id where people_id_seq is null";
    const names = resolve(text);
    const person = { kind: "column", schema: "public", table: "orders", name: "person" } as const;
    expect(
      names
        .filter((n) => matches(person, n))
        .map((n) => n.start.offset)
        .sort((a, b) => a - b),
    ).toEqual([text.indexOf("person"), text.indexOf("o.person =") + 2]);
    const people = {
      kind: "relation",
      schema: "public",
      name: "people",
      relkind: "table",
    } as const;
    expect(names.filter((n) => matches(people, n))).toHaveLength(1);
  });
});
