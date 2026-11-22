// Signature help (PG-31, ADR 0327): inside a call, the function's overloads from the schema cache
// (through the search path, or the schema written) or the built-in ones, the argument at the caret,
// and the first overload that takes that many arguments; outside a call, none. Each case runs the
// parse worker's service in process over complete-fixture.ts's schema.
import { describe, expect, it } from "vitest";
import { completer } from "./complete-fixture";

describe("signature help", () => {
  it("shows the overloads of the function the caret is in, and the argument it is at", async () => {
    const c = await completer();
    const first = c.at("select add(|) from orders", { want: "signature" }).signature;
    expect(first).toMatchObject({ name: "add", at: 10, arg: 0, active: 0 });
    expect(first?.overloads.map((o) => o.label)).toEqual([
      "add(a integer, b integer) → integer",
      "add(a numeric, b numeric) → numeric",
    ]);
    expect(c.at("select add(1, |) from orders", { want: "signature" }).signature).toMatchObject({
      arg: 1,
    });
    // Nested calls: the innermost the caret is in.
    expect(
      c.at("select add(1, coalesce(note, |)) from orders", { want: "signature" }).signature,
    ).toMatchObject({ name: "coalesce", arg: 1 });
    // A schema written finds its own; a comment comes with the overload.
    const own = c.at("select * from public.customer_orders(|)", { want: "signature" }).signature;
    expect(own?.overloads).toEqual([
      {
        label: "customer_orders(c integer) → TABLE(id integer, total numeric)",
        args: ["c integer"],
        result: "TABLE(id integer, total numeric)",
        comment: "Orders of a customer",
      },
    ]);
  });

  it("built-in functions have theirs, the overload that takes the arguments typed is shown first", async () => {
    const c = await completer();
    const series = c.at("select * from generate_series(1, 10, |)", { want: "signature" }).signature;
    expect(series?.overloads.length).toBeGreaterThan(1);
    expect(series?.overloads[series.active]?.args).toHaveLength(3);
    const upper = c.at("select upper(|)", { want: "signature" }).signature;
    expect(upper?.overloads[0]?.label).toMatch(/^upper\(/u);
  });

  it("outside a call, in a string, or after a word that is not a function, there is none", async () => {
    const c = await completer();
    for (const sql of [
      "select | from orders",
      "select 'add(|' from orders",
      "select * from orders where id in (|)",
      "insert into orders (|",
      "select (|1 + 2)",
    ])
      expect([sql, c.at(sql, { want: "signature" }).signature ?? null]).toEqual([sql, null]);
  });

  it("the argument a call is at ranks the columns of its type first", async () => {
    const c = await completer();
    const found = c.at("select upper(|) from orders o", { want: "items" });
    const columns = found.items.filter((i) => i.kind === "column").map((i) => i.label);
    expect(columns[0]).toBe("note");
  });
});
