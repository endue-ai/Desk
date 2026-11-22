// Routine bodies rewritten for a rename (PG-33), as before and after pairs: a place changes only
// when it can name nothing else; a name in a string, a variable of the same name, an unknown
// qualifier, another overload and another language are listed to check by hand with their line.
import { describe, expect, it } from "vitest";
import { type Rename, rewriteBody } from "../ui/refactor/bodies.js";

const column: Rename = {
  kind: "column",
  relkind: "table",
  schema: "public",
  table: "people",
  name: "name",
  to: "full_name",
};
const table: Rename = {
  kind: "relation",
  relkind: "table",
  schema: "public",
  name: "people",
  to: "buyers",
};
const plpgsql = { language: "plpgsql" };

describe("a column's rename in a body", () => {
  it("qualified by its table, an alias, or bare where nothing else could hold it", () => {
    const body = `BEGIN
  UPDATE people SET name = upper(name) WHERE people.name <> ''; -- name stays here
  SELECT p.name INTO v FROM public.people p;
END`;
    const done = rewriteBody(body, column, plpgsql);
    expect(done.text).toBe(`BEGIN
  UPDATE people SET full_name = upper(full_name) WHERE people.full_name <> ''; -- name stays here
  SELECT p.full_name INTO v FROM public.people p;
END`);
    expect(done.places).toBe(4);
    expect(done.hand).toEqual([]);
  });

  it("NEW and OLD in the table's own trigger function", () => {
    const body = "BEGIN NEW.name := trim(OLD.name); RETURN NEW; END";
    expect(rewriteBody(body, column, { ...plpgsql, triggers: ["public.people"] }).text).toBe(
      "BEGIN NEW.full_name := trim(OLD.full_name); RETURN NEW; END",
    );
    expect(rewriteBody(body, column, { ...plpgsql, triggers: ["public.orders"] }).places).toBe(0);
    expect(
      rewriteBody(body, column, { ...plpgsql, triggers: ["public.people", "public.orders"] }).hand,
    ).toEqual([{ line: 1, why: "a trigger function of more than one table" }]);
  });

  it("lists dynamic SQL, a variable of the same name, an unknown qualifier and another holder", () => {
    const body = `DECLARE
  name text;
BEGIN
  EXECUTE 'select name from people';
  SELECT name INTO name FROM people;
  RETURN r.name;
END`;
    const done = rewriteBody(body, column, plpgsql);
    expect(done.places).toBe(0);
    expect(done.hand).toEqual([
      { line: 4, why: "the name is in a string (dynamic SQL?)" },
      { line: 5, why: "a variable or parameter has the same name" },
      { line: 6, why: "r.name: what r is cannot be told" },
    ]);
    const both = rewriteBody("SELECT name FROM people JOIN staff USING (id)", column, {
      language: "sql",
      holders: ["staff"],
    });
    expect(both.hand).toEqual([{ line: 1, why: "staff has a column of the same name" }]);
  });

  it("leaves another table's column of the same name", () => {
    const body = "SELECT s.name FROM staff s; SELECT name FROM staff";
    expect(rewriteBody(body, column, { language: "sql" })).toEqual({
      text: body,
      places: 0,
      hand: [],
    });
  });
});

describe("other objects' renames in a body", () => {
  it("a table, bare, qualified by its schema, and as a qualifier", () => {
    const body =
      "SELECT people.id FROM public.people JOIN other.people o ON true; INSERT INTO people VALUES (1)";
    expect(rewriteBody(body, table, { language: "sql" }).text).toBe(
      "SELECT buyers.id FROM public.buyers JOIN other.people o ON true; INSERT INTO buyers VALUES (1)",
    );
    expect(
      rewriteBody("SELECT 1 FROM people", table, { language: "sql", elsewhere: true }).hand,
    ).toEqual([{ line: 1, why: "another schema has an object of the same name" }]);
  });

  it("a sequence, and its name in nextval's string", () => {
    const seq: Rename = {
      kind: "relation",
      relkind: "sequence",
      schema: "public",
      name: "ids",
      to: "next_ids",
    };
    expect(
      rewriteBody(
        "BEGIN RETURN nextval('public.ids') + nextval('ids'::regclass); END",
        seq,
        plpgsql,
      ).text,
    ).toBe("BEGIN RETURN nextval('public.next_ids') + nextval('next_ids'::regclass); END");
  });

  it("a function's calls; another overload is checked by hand", () => {
    const fn: Rename = {
      kind: "function",
      routine: "function",
      schema: "public",
      name: "touch",
      args: "",
      overloads: 1,
      to: "stamp",
    };
    expect(
      rewriteBody("BEGIN PERFORM touch(); PERFORM public.touch(); touch := 1; END", fn, plpgsql)
        .text,
    ).toBe("BEGIN PERFORM stamp(); PERFORM public.stamp(); touch := 1; END");
    expect(
      rewriteBody("BEGIN PERFORM touch(); END", { ...fn, overloads: 2 }, plpgsql).hand,
    ).toEqual([{ line: 1, why: "another overload has the same name" }]);
  });

  it("a type and a schema", () => {
    const type: Rename = {
      kind: "type",
      domain: false,
      schema: "public",
      name: "mood",
      to: "feeling",
    };
    expect(
      rewriteBody("DECLARE m mood; BEGIN m := 'ok'::public.mood; END", type, plpgsql).text,
    ).toBe("DECLARE m feeling; BEGIN m := 'ok'::public.feeling; END");
    const schema: Rename = { kind: "schema", name: "sales", to: "deals" };
    expect(
      rewriteBody("SELECT sales.leads.id FROM sales.leads", schema, { language: "sql" }).text,
    ).toBe("SELECT deals.leads.id FROM deals.leads");
  });

  it("another language's body is listed, not read", () => {
    expect(
      rewriteBody("return plpy.execute('select name from people')", column, {
        language: "plpython3u",
      }),
    ).toEqual({
      text: "return plpy.execute('select name from people')",
      places: 0,
      hand: [{ line: 1, why: "a plpython3u body: it is not read" }],
    });
  });
});
