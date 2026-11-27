// The statement's completion in the parse worker (PG-31, ADR 0327): PostgreSQL's grammar and the
// resolver find what is in scope at the caret, the schema model says what each name holds, and the
// problems check's state says what the script did before. Each case runs the worker's service in
// process over complete-fixture.ts's schema.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ident } from "../ui/editor/complete.js";
import { PG_RESERVED } from "../ui/editor/words.js";
import { completer, labelsOf } from "./complete-fixture";
import { loadRaw } from "./problems-fixture";

describe("joins from foreign keys", () => {
  it("after JOIN, tables a foreign key links to the tables in scope come first, and accepting one writes the ON condition", async () => {
    const c = await completer();
    const found = c.at("select * from orders o join |");
    const joins = found.items.filter((i) => i.kind === "join");
    expect(found.items.slice(0, joins.length)).toEqual(joins);
    expect(joins.map((i) => i.insert)).toEqual([
      "customers on customers.id = o.customer_id",
      "order_items on order_items.order_id = o.id",
    ]);
    expect(joins[0]).toMatchObject({
      label: "customers",
      detail: "on customers.id = o.customer_id",
    });
    // The plain tables follow; typed letters narrow both, and the keywords keep the case typed.
    expect(labelsOf(found, "table")).toContain("products");
    const typed = c.at("SELECT * FROM orders o JOIN cu|");
    expect(typed.items[0]).toMatchObject({
      kind: "join",
      insert: "customers ON customers.id = o.customer_id",
    });
    expect([typed.from, typed.to]).toEqual([28, 30]);

    // A key of two columns; a key to the table itself gets an alias, both ways.
    expect(c.at("select * from shipments s join |").items[0]?.insert).toBe(
      "order_items on order_items.order_id = s.order_id and order_items.line = s.line",
    );
    expect(
      c
        .at("select * from employees join |")
        .items.filter((i) => i.kind === "join")
        .map((i) => i.insert),
    ).toEqual([
      "employees e on e.id = employees.manager_id",
      "employees e on e.manager_id = employees.id",
    ]);
    // Every table before the JOIN counts; CROSS and NATURAL joins take no condition.
    const second = c.at(
      "select * from customers c join orders o on o.customer_id = c.id left join |",
    );
    // A table already in FROM is not offered again through the key that links it there.
    expect(second.items.filter((i) => i.kind === "join").map((i) => i.label)).toEqual([
      "order_items",
    ]);
    expect(labelsOf(c.at("select * from orders o cross join |"), "join")).toEqual([]);
    expect(labelsOf(c.at("select * from orders o natural join |"), "join")).toEqual([]);
  });
});

describe("column lists", () => {
  it("INSERT INTO t ( offers the column list with a matching VALUES row, and VALUES ( a row for the columns listed", async () => {
    const c = await completer();
    const found = c.at("insert into orders (|");
    expect(found.items.slice(0, 2)).toMatchObject([
      {
        kind: "columns",
        label: "id, customer_id, total, placed_at, note",
        snippet: true,
        insert:
          "id, customer_id, total, placed_at, note) values (${id}, ${customer_id}, ${total}, ${placed_at}, ${note})",
      },
      {
        kind: "columns",
        label: "customer_id, total, note",
        detail: "the columns without a default",
        insert: "customer_id, total, note) values (${customer_id}, ${total}, ${note})",
      },
    ]);
    expect(labelsOf(found, "column")).toEqual(["customer_id", "id", "note", "placed_at", "total"]);
    // Once a column is written, the others; then VALUES ( a row for those listed, or for all.
    expect(c.at("insert into orders (customer_id, |").items.map((i) => i.label)).toEqual([
      "id",
      "note",
      "placed_at",
      "total",
    ]);
    expect(c.at("INSERT INTO orders (customer_id, total) VALUES (|").items[0]).toMatchObject({
      kind: "columns",
      label: "customer_id, total",
      insert: "${customer_id}, ${total})",
    });
    expect(c.at("insert into customers values (|").items[0]?.insert).toBe(
      "${id}, ${name}, ${email})",
    );
    // A name that needs quoting is quoted in the list and named plainly in its tab stop.
    expect(c.at('insert into "Odd Table" (|').items[0]?.insert).toBe(
      'id, "Weird Col", "user", between) values (${id}, ${Weird Col}, ${user}, ${between})',
    );
  });

  it("SELECT * expands to the columns of what it reads on request", async () => {
    const c = await completer();
    const one = c.at("select *| from orders");
    expect(one.items).toHaveLength(1);
    expect(one.items[0]).toMatchObject({
      kind: "expand",
      insert: "id, customer_id, total, placed_at, note",
      range: { from: 7, to: 8 },
    });
    expect(
      c.at("select *| from orders o join customers c on c.id = o.customer_id").items[0]?.insert,
    ).toBe("o.id, o.customer_id, o.total, o.placed_at, o.note, c.id, c.name, c.email");
    expect(c.at("select c.*| from orders o join customers c on true").items[0]).toMatchObject({
      insert: "c.id, c.name, c.email",
      range: { from: 7, to: 10 },
    });
    expect(c.at("with t as (select id, total from orders) select *| from t").items[0]?.insert).toBe(
      "id, total",
    );
    expect(c.at("select * |from (select id, name from customers) s").items[0]?.insert).toBe(
      "id, name",
    );
    expect(c.at('select *| from "Odd Table"').items[0]?.insert).toBe(
      'id, "Weird Col", "user", between',
    );
    // A product is not a star.
    expect(labelsOf(c.at("select 2 *| 3"), "expand")).toEqual([]);
  });
});

describe("what the statement has in scope", () => {
  it("CTEs, subquery aliases and the columns of set-returning functions are offered", async () => {
    const c = await completer();
    const ctes = c.at("with recent as (select id, total from orders) select * from |");
    expect(ctes.items[0]).toMatchObject({ label: "recent", kind: "cte" });
    const of = (sql: string) => labelsOf(c.at(sql), "column");
    expect(of("with recent as (select id, total from orders) select r.| from recent r")).toEqual([
      "id",
      "total",
    ]);
    expect(of("select s.| from (select id, name as who from customers) s")).toEqual(["id", "who"]);
    expect(of("select f.| from customer_orders(1) f")).toEqual(["id", "total"]);
    expect(of("select a.| from all_orders() a")).toEqual([
      "customer_id",
      "id",
      "note",
      "placed_at",
      "total",
    ]);
    expect(of("select g.| from generate_series(1, 10) g")).toEqual(["g"]);
    expect(of("select | from generate_series(1, 3) as n")).toEqual(["n"]);
    expect(of("select x.| from orders o, lateral (select o.total * 2 as twice) x")).toEqual([
      "twice",
    ]);
    // Inside a correlated subquery its own FROM comes first, then the levels around it.
    const nested = c.at(
      "select * from customers c where exists (select 1 from orders o where o.customer_id = c.id and |)",
    );
    const details = nested.items.filter((i) => i.kind === "column").map((i) => i.detail);
    expect(details.slice(0, 5).every((d) => d.endsWith("· o"))).toBe(true);
    expect(details.slice(5).every((d) => d.endsWith("· c"))).toBe(true);
    // A statement that does not parse yet still has its FROM read.
    expect(of("select o.| from orders o where")).toContain("customer_id");
    expect(of("select o.| from orders o join")).toContain("customer_id");
  });

  it("a name that needs quoting is quoted", async () => {
    const c = await completer();
    const inserts = c.at('select | from "Odd Table"').items.filter((i) => i.kind === "column");
    expect(inserts.map((i) => i.insert)).toEqual(["between", "id", '"user"', '"Weird Col"']);
    expect(c.at("select * from Odd|").items[0]?.insert).toBe('"Odd Table"');
    // Exactly the words PostgreSQL's scanner reserves (type and function names, and reserved).
    const raw = await loadRaw();
    const wasm = readFileSync(new URL("../ui/vendor/libpg-query.wasm", import.meta.url));
    const reserved = [...new Set(wasm.toString("latin1").match(/[a-z_]{2,30}/gu))].filter((w) => {
      const scanned = raw.scan(w);
      return (
        "tokens" in scanned &&
        scanned.tokens.length === 1 &&
        (scanned.tokens[0]?.keywordKind ?? 0) >= 3
      );
    });
    expect([...PG_RESERVED].sort()).toEqual(reserved.sort());
    for (const word of reserved) expect(ident("postgresql", word)).toBe(`"${word}"`);
    for (const word of ["between", "name", "text", "value", "year", "position"])
      expect(ident("postgresql", word)).toBe(word);
  });

  it("the statement's scope ranks first, then the type an operand, an argument, a SET or a VALUES slot expects", async () => {
    const c = await completer();
    const kinds = c.at("select | from orders o").items.map((i) => i.kind);
    const first = (kind: string) => kinds.indexOf(kind);
    expect(first("column")).toBe(0);
    expect(first("alias")).toBeGreaterThan(kinds.lastIndexOf("column"));
    expect(first("function")).toBeGreaterThan(first("alias"));
    expect(first("keyword")).toBeGreaterThan(first("function"));

    const typed = (sql: string) =>
      c
        .at(sql)
        .items.filter((i) => i.kind === "column")
        .map((i) => `${i.label} ${i.detail}`);
    expect(
      typed("select * from orders o join customers c on o.customer_id = |").slice(0, 4),
    ).toEqual([
      "customer_id integer · o",
      "id integer · o",
      "id integer · c",
      "total numeric(10,2) · o",
    ]);
    expect(typed("update orders set note = |")[0]).toBe("note text · orders");
    expect(typed("select add(|) from orders")[0]).toMatch(/^customer_id integer/u);
    expect(typed("insert into orders (note, total) values ('x', |)").length).toBe(0);
  });

  it("a candidate shows its type and its comment", async () => {
    const c = await completer();
    const name = c.at("select na| from customers").items[0];
    expect(name).toMatchObject({ label: "name", detail: "text · customers", info: "Full name" });
    expect(c.at("select * from custom|").items[0]).toMatchObject({
      label: "customers",
      detail: "table · public",
      info: "Who buys",
    });
    expect(c.at("select customer_o|").items[0]).toMatchObject({
      label: "customer_orders",
      kind: "function",
      detail: "(c integer) → TABLE(id integer, total numeric)",
      info: "Orders of a customer",
    });
  });

  it("what the script did before the statement counts, read from the problems check's state", async () => {
    const c = await completer();
    const script =
      "set search_path to app;\ncreate table made (a int, b text);\nselect | from people, made";
    c.check(script.replace("|", ""));
    c.parsed.length = 0;
    const found = c.at(script);
    expect(
      found.items.filter((i) => i.kind === "column").map((i) => `${i.label} ${i.detail}`),
    ).toEqual(["a made", "b made", "email text · people", "id integer · people"]);
    // Only the statement at the caret was parsed for it, never the ones before.
    expect(
      c.parsed.every((text) => !text.includes("search_path") && !text.includes("create")),
    ).toBe(true);
    // Another console has its own state: the default path, no table made.
    expect(labelsOf(c.at(script, { doc: "other" }), "column")).toEqual([]);
  });
});
