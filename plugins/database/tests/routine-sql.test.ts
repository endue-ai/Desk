// The calls a routine's form writes (ui/features/routines/call.js), the routine read from pg_proc
// rows (read.js) and the guard its volatility decides (guard.js), without a server.
import { describe, expect, it } from "vitest";
import { callOf, type Entry, literalOf } from "../ui/features/routines/call.js";
import {
  canRollBack,
  natureOf,
  questionOf,
  refusalOf,
  uncallable,
  writes,
} from "../ui/features/routines/guard.js";
import {
  argsSql,
  factsSql,
  listSql,
  type Routine,
  routineOf,
} from "../ui/features/routines/read.js";
import { ROUTINES } from "./routine-fixture";

type Fixture = (typeof ROUTINES)[number];
const factsOf = (f: Fixture) => [
  ...[f.oid, "public", f.name, f.prokind, f.volatility, f.set ? "t" : "f", f.identity],
  ...[f.result, f.language, ...f.returns, f.controls ? "t" : "f", "170006", "UTC"],
];
const fixture = (name: string, oid?: string) => {
  const f = ROUTINES.find((r) => r.name === name && (!oid || r.oid === oid));
  if (!f) throw new Error(name);
  return routineOf(factsOf(f), f.args);
};
/** A routine of its own: kind, volatility and argument rows as argsSql answers them. */
const made = (
  name: string,
  args: string[][],
  more: Partial<
    Record<"prokind" | "volatility" | "set" | "typtype" | "typname" | "schema", string>
  > = {},
) =>
  routineOf(
    [
      ...["1", more.schema ?? "public", name, more.prokind ?? "f", more.volatility ?? "v"],
      ...[more.set ?? "f", "", "", "plpgsql", more.typtype ?? "b", more.typname ?? "int4", "f"],
      ...["170006", "UTC"],
    ],
    args,
  );
const arg = (
  n: string,
  name: string,
  mode: string,
  type: string,
  base: string,
  cat: string,
  def = "",
) => [...[n, name, mode, type, "b", base, base, cat, "", "", "{}", def]];
const int = (n: string, name: string, def = "", mode = "i") =>
  arg(n, name, mode, "integer", "int4", "N", def);
const text = (n: string, name: string, def = "") => arg(n, name, "i", "text", "text", "S", def);
const v = (value: string): Entry => ({ choice: "value", value });
const NULL: Entry = { choice: "null", value: "" };
const DEFAULT: Entry = { choice: "default", value: "" };
const sql = (r: Routine, entries: Array<Entry | undefined>) => callOf(r, entries);

describe("the call", () => {
  it("writes SELECT for a scalar function, SELECT * FROM for a set-returning, table or OUT function, and CALL for a procedure", () => {
    expect(sql(fixture("add_tax"), [v("100")])).toEqual({
      sql: "SELECT public.add_tax(amount => 100::numeric)",
      problem: "",
    });
    expect(sql(fixture("recent_orders"), [v("2026-11-01")]).sql).toBe(
      "SELECT * FROM public.recent_orders(since => '2026-11-01'::date)",
    );
    const outs = made("bounds", [int("1", "v"), int("2", "lo", "", "o"), int("3", "hi", "", "o")], {
      typtype: "p",
      typname: "record",
    });
    expect(sql(outs, [v("4")]).sql).toBe("SELECT * FROM public.bounds(v => 4::integer)");
    expect(sql(made("one_row", [], { typtype: "c", typname: "orders" }), []).sql).toBe(
      "SELECT * FROM public.one_row()",
    );
    expect(sql(made("bare", [], { typtype: "p", typname: "record" }), []).sql).toBe(
      "SELECT public.bare()",
    );
    expect(sql(made("many", [], { set: "t", typname: "int4" }), []).sql).toBe(
      "SELECT * FROM public.many()",
    );
    expect(sql(fixture("restock"), [v("widget"), undefined, v("3")]).sql).toBe(
      "CALL public.restock(item => 'widget'::text, note => NULL::text, qty => 3::integer)",
    );
    // Names are quoted only where SQL must read them so.
    const odd = made("Order Totals", [int("1", "limit"), int("2", "Per Day")], { schema: "Sales" });
    expect(sql(odd, [v("1"), v("2")]).sql).toBe(
      'SELECT "Sales"."Order Totals"("limit" => 1::integer, "Per Day" => 2::integer)',
    );
    // A long call puts each argument on its line.
    const wide = made("monthly_report", [
      text("1", "region"),
      text("2", "category"),
      int("3", "year"),
      int("4", "month"),
    ]);
    expect(sql(wide, [v("north-east"), v("hardware"), v("2026"), v("11")]).sql).toBe(
      [
        "SELECT public.monthly_report(",
        "    region => 'north-east'::text,",
        "    category => 'hardware'::text,",
        "    year => 2026::integer,",
        "    month => 11::integer",
        ")",
      ].join("\n"),
    );
  });

  it("uses named notation when the arguments have names, positional when they have none, and mixed when only the first ones lack one", () => {
    const mixed = made("pad", [int("1", ""), text("2", "fill", "' '::text")]);
    expect(sql(mixed, [v("1"), v("y")]).sql).toBe(
      "SELECT public.pad(1::integer, fill => 'y'::text)",
    );
    expect(sql(mixed, [v("1"), DEFAULT]).sql).toBe("SELECT public.pad(1::integer)");
    const plain = made("pair", [int("1", ""), text("2", "")]);
    expect(sql(plain, [v("1"), v("a")]).sql).toBe("SELECT public.pair(1::integer, 'a'::text)");
    // An unnamed one after a named one: every argument goes by its place.
    const after = made("after", [int("1", "a"), int("2", "")]);
    expect(sql(after, [v("1"), v("2")]).sql).toBe("SELECT public.after(1::integer, 2::integer)");
  });

  it("quotes and types every literal by the argument's type", () => {
    const one = (row: string[], entry: Entry, extra: Record<string, string> = {}) => {
      const [a] = made("f", [row]).args;
      if (!a) throw new Error("no argument");
      return literalOf({ ...a, ...extra } as typeof a, entry, "x");
    };
    expect(one(text("1", "x"), v("it's"))).toEqual({ sql: "'it''s'::text" });
    expect(one(text("1", "x"), v("a\\b"))).toEqual({ sql: "E'a\\\\b'::text" });
    expect(one(int("1", "x"), v("42"))).toEqual({ sql: "42::integer" });
    expect(one(int("1", "x"), v("-5"))).toEqual({ sql: "'-5'::integer" });
    expect(one(arg("1", "x", "i", "numeric", "numeric", "N"), v("1.5e3"))).toEqual({
      sql: "'1.5e3'::numeric",
    });
    expect(one(arg("1", "x", "i", "boolean", "bool", "B"), v("yes"))).toEqual({ sql: "TRUE" });
    const flag = ["1", "x", "i", "public.flag", "d", "flag", "bool", "B", "", "", "{}", ""];
    expect(one(flag, v("off"))).toEqual({ sql: "FALSE::public.flag" });
    expect(one(arg("1", "x", "i", "date", "date", "D"), v("2026-11-21"))).toEqual({
      sql: "'2026-11-21'::date",
    });
    expect(one(arg("1", "x", "i", "jsonb", "jsonb", "U"), v('{"a": 1}'))).toEqual({
      sql: `'{"a": 1}'::jsonb`,
    });
    const ints = ["1", "x", "i", "integer[]", "b", "_int4", "_int4", "A", "int4", "N", "{}", ""];
    expect(one(ints, v("{1,2}"))).toEqual({ sql: "'{1,2}'::integer[]" });
    expect(one(ints, v("{1,x}"))).toEqual({
      error: expect.stringMatching(/^x: The array's element 2: x is not a whole number/u),
    });
    const status = [
      ...["1", "x", "i", "order_status", "e", "order_status", "order_status", "E"],
      ...["", "", "{new,paid}", ""],
    ];
    expect(one(status, v("paid"))).toEqual({ sql: "'paid'::order_status" });
    expect(one(status, v("lost"))).toEqual({
      error: "x: lost is not a label of order_status: it is one of new, paid.",
    });
    const positive = [
      "1",
      "x",
      "i",
      "positive_int",
      "d",
      "positive_int",
      "int4",
      "N",
      "",
      "",
      "{}",
      "",
    ];
    expect(one(positive, v("7"))).toEqual({ sql: "7::positive_int" });
    expect(one(int("1", "x"), NULL)).toEqual({ sql: "NULL::integer" });
    expect(one(int("1", "x"), v("abc"))).toEqual({
      error:
        "x: abc is not a whole number: integer holds whole numbers from -2147483648 to 2147483647.",
    });
    const any = [
      "1",
      "x",
      "i",
      "anyelement",
      "p",
      "anyelement",
      "anyelement",
      "P",
      "",
      "",
      "{}",
      "",
    ];
    expect(one(any, v("5"))).toEqual({ sql: "'5'::text" });
    expect(one(any, { ...v("5"), cast: "integer" })).toEqual({ sql: "'5'::integer" });
    expect(one(any, { ...v("5"), cast: "numeric(10, 2)" })).toEqual({ sql: "'5'::numeric(10, 2)" });
    expect(one(any, { ...v("5"), cast: "int); DROP TABLE t; --" })).toEqual({
      error: "x: int); DROP TABLE t; -- is not a type name, as text, integer or public.mood.",
    });
  });

  it("leaves an argument with a default out", () => {
    const named = made("f", [int("1", "a", "1"), int("2", "b", "2"), int("3", "c", "3")]);
    expect(sql(named, [DEFAULT, v("5"), DEFAULT]).sql).toBe("SELECT public.f(b => 5::integer)");
    const unnamed = made("g", [int("1", "", "1"), int("2", "", "2")]);
    expect(sql(unnamed, [v("4"), DEFAULT]).sql).toBe("SELECT public.g(4::integer)");
    expect(sql(unnamed, [DEFAULT, DEFAULT]).sql).toBe("SELECT public.g()");
    expect(sql(unnamed, [DEFAULT, v("5")]).problem).toBe(
      "$1 is left to its default, so $2 after it must be too: an argument without a name is given by its place.",
    );
    const none = made("h", [int("1", "a")]);
    expect(sql(none, [DEFAULT]).problem).toBe("a has no default: give it a value or NULL.");
    // Untouched, an argument with a default is DEFAULT and one without is empty.
    expect(sql(named, []).sql).toBe("SELECT public.f()");
    expect(sql(none, []).problem).toBe(
      "a: Nothing is not a whole number: integer holds whole numbers from -2147483648 to 2147483647.",
    );
  });

  it("writes VARIADIC as an array of its elements, by name or by position", () => {
    expect(sql(fixture("total_of"), [v("{1,2,3}")]).sql).toBe(
      "SELECT public.total_of(VARIADIC amounts => '{1,2,3}'::integer[])",
    );
    expect(sql(fixture("total_of"), [NULL]).sql).toBe(
      "SELECT public.total_of(VARIADIC amounts => NULL::integer[])",
    );
    const list = ["2", "", "v", "text[]", "b", "_text", "_text", "A", "text", "S", "{}", ""];
    const unnamed = made("joined", [text("1", ""), list]);
    expect(sql(unnamed, [v(","), v("{a,b}")]).sql).toBe(
      "SELECT public.joined(','::text, VARIADIC '{a,b}'::text[])",
    );
    const any = ["1", "parts", "v", '"any"', "p", "any", "any", "P", "", "", "{}", ""];
    const loose = made("loose", [any]);
    expect(sql(loose, [v("{x,y}")]).sql).toBe(
      "SELECT public.loose(VARIADIC parts => '{x,y}'::text[])",
    );
    expect(sql(loose, [{ ...v("{1,2}"), cast: "integer" }]).problem).toBe(
      "parts is VARIADIC: name an array type, as text[] or integer[].",
    );
  });

  it("passes a procedure's OUT arguments as NULL and leaves a function's OUT and TABLE ones out", () => {
    const restock = fixture("restock");
    expect(sql(restock, [v("bolt"), v("ignored"), DEFAULT]).sql).toBe(
      "CALL public.restock(item => 'bolt'::text, note => NULL::text)",
    );
    expect(sql(fixture("recent_orders"), [v("2026-11-01"), v("new"), v("1"), v("2")]).sql).toBe(
      "SELECT * FROM public.recent_orders(since => '2026-11-01'::date, status => 'new'::order_status)",
    );
  });
});

describe("reading a routine", () => {
  it("reads pg_proc rows into a routine", () => {
    const recent = fixture("recent_orders");
    expect(recent).toMatchObject({
      oid: "9004",
      schema: "public",
      name: "recent_orders",
      kind: "function",
      volatility: "s",
      returnsSet: true,
      result: "TABLE(id integer, total numeric)",
      controls: false,
      version: 170006,
    });
    expect(recent.args.map((a) => [a.name, a.mode, a.type, a.default, a.editor.kind])).toEqual([
      ["since", "i", "date", null, "date"],
      ["status", "i", "order_status", "'paid'::order_status", "enum"],
      ["id", "t", "integer", null, "number"],
      ["total", "t", "numeric", null, "number"],
    ]);
    expect(recent.args[1]?.editor.labels).toEqual(["new", "paid", "shipped"]);
    const total = fixture("total_of").args[0];
    expect(total?.editor).toMatchObject({
      kind: "array",
      element: { kind: "number", integer: "int4" },
    });
    expect(fixture("add_tax").args[1]?.default).toBe("0.2");
    expect(fixture("restock")).toMatchObject({ kind: "procedure", controls: false });
    expect(fixture("nightly_close")).toMatchObject({ kind: "procedure", controls: true });
    // The queries: names and an oid only as quoted literals or digits.
    expect(listSql({ schema: "it's", name: "f" })).toContain(
      "n.nspname = 'it''s' AND p.proname = 'f'",
    );
    expect(listSql({})).toContain("n.nspname !~ '^pg_'");
    expect(listSql({ system: true })).not.toContain("n.nspname !~");
    expect(factsSql("9004")).toMatch(/WHERE p\.oid = 9004$/u);
    expect(factsSql("9004")).toContain("p.prosrc ~* E'\\\\m(commit|rollback)\\\\M'");
    expect(argsSql("9004")).toContain(
      "pg_catalog.pg_get_function_arg_default(p.oid, a.n::integer)",
    );
    expect(() => argsSql("1; DROP")).toThrow("This routine has no catalog id.");
  });
});

describe("the guard", () => {
  const prod = { name: "prod", readOnly: false, tag: "production" as const };
  const locked = { name: "locked", readOnly: true, tag: "none" as const };
  const dev = { name: "dev", readOnly: false, tag: "development" as const };
  const how = { rollback: false, agent: false, confirm: true };

  it("decides the guard by volatility", () => {
    const immutable = fixture("add_tax");
    const stable = fixture("recent_orders");
    const volatile = fixture("archive_orders");
    const proc = fixture("restock");
    const commits = fixture("nightly_close");
    expect([immutable, stable, volatile, proc].map(writes)).toEqual([false, false, true, true]);
    expect(natureOf(stable)).toBe("STABLE: it only reads, so it runs as a read.");
    expect(natureOf(volatile)).toBe("VOLATILE: it may change data, so it runs as a write.");
    expect(natureOf(commits)).toMatch(
      /runs alone, outside a transaction block, and cannot be rolled back\.$/u,
    );
    expect([immutable, volatile, proc, commits].map(canRollBack)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(refusalOf(locked, immutable)).toBe("");
    expect(refusalOf(locked, volatile)).toBe(
      "locked is read-only: public.archive_orders is VOLATILE, so it may change data; it does not run there, not even rolled back.",
    );
    expect(refusalOf(locked, proc)).toMatch(
      /^locked is read-only: public\.restock is a procedure/u,
    );
    const call = "SELECT public.archive_orders(before => '2026-01-01'::date)";
    expect(questionOf(prod, volatile, call, how)).toEqual({
      title: "Run this statement on prod?",
      reasons: [
        "prod is tagged production.",
        "public.archive_orders is VOLATILE: it may change data.",
        call,
      ],
    });
    expect(questionOf(prod, volatile, call, { ...how, confirm: false })).toBeNull();
    expect(questionOf(prod, volatile, call, { ...how, rollback: true })).toBeNull();
    expect(questionOf(dev, volatile, call, how)).toBeNull();
    expect(questionOf(prod, immutable, call, { ...how, agent: true })).toBeNull();
    expect(
      questionOf(dev, volatile, call, { ...how, agent: true, rollback: true })?.reasons,
    ).toEqual([
      "An agent asks to run public.archive_orders.",
      "public.archive_orders is VOLATILE: it may change data.",
      "It runs in a transaction rolled back at the end.",
      call,
    ]);
    // A procedure's CALL is a write by its verb: the executor asks for it.
    expect(questionOf(prod, proc, "CALL public.restock()", { ...how, agent: true })).toBeNull();
    expect(
      questionOf(dev, proc, "CALL public.restock()", { ...how, agent: true, rollback: true }),
    ).not.toBeNull();
    // What cannot be called.
    expect(uncallable(fixture("audit_trigger"))).toBe(
      "public.audit_trigger is a trigger function: its trigger runs it, not a call.",
    );
    expect(uncallable(made("sum_of", [], { prokind: "a" }))).toBe(
      "public.sum_of is an aggregate: it runs over the rows of a query.",
    );
    const internal = ["1", "", "i", "internal", "p", "internal", "internal", "P", "", "", "{}", ""];
    expect(uncallable(made("handler", [internal]))).toBe(
      "public.handler takes internal: only the server calls it.",
    );
    expect(refusalOf(dev, fixture("audit_trigger"))).toMatch(/trigger function/u);
  });
});
