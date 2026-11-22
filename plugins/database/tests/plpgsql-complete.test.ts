// Completion inside a PL/pgSQL body (PG-35, ADR 0343), in the parse worker's service over the real
// grammar and the shop model of complete-fixture.ts: the variables in reach and the parameters, a
// `%ROWTYPE` record's fields after its name and a dot, the schema's names in the SQL inside, and
// PL/pgSQL's words where a statement starts. Another language's body offers nothing, and what is
// offered outside a body is unchanged.
import { describe, expect, it } from "vitest";
import { createService } from "../ui/sql/parse/worker.js";
import { COMPLETE_MODEL } from "./complete-fixture";
import { loadRaw } from "./problems-fixture";

type Item = { label: string; kind: string; detail: string; insert: string };
type Completion = { from: number; to: number; items: Item[] };

async function service(model: unknown = COMPLETE_MODEL) {
  const s = createService(await loadRaw());
  if (model) s.answer({ type: "model", key: 1, model } as never);
  let id = 0;
  /** The completion at `|`, the whole text sent as the statement around the caret. */
  return (sql: string) => {
    const caret = sql.indexOf("|");
    const text = sql.replace("|", "");
    const reply = s.answer({
      id: ++id,
      type: "complete",
      doc: "d",
      sql: text,
      caret,
      offset: 0,
      ...(model ? { model: 1 } : {}),
    } as never) as { result: Completion } | { error: string };
    if ("error" in reply) throw new Error(reply.error);
    return { ...reply.result, word: text.slice(reply.result.from, reply.result.to) };
  };
}

const fn = (body: string) =>
  [
    "create function f(cust int, label text) returns int language plpgsql as $$",
    "declare",
    "  amount numeric;",
    "  o orders%rowtype;",
    "  who customers.name%type;",
    "begin",
    body,
    "  declare later int; begin later := 1; end;",
    "end $$;",
  ].join("\n");

const labels = (found: Completion, kind?: string) =>
  found.items.filter((i) => !kind || i.kind === kind).map((i) => i.label);

describe("completion inside a PL/pgSQL body", () => {
  it("offers the variables in reach and the parameters", async () => {
    const at = await service();
    const found = at(fn("  if am| > 0 then return 1; end if;"));
    expect(found.word).toBe("am");
    expect(found.items[0]).toMatchObject({
      label: "amount",
      kind: "variable",
      detail: "numeric · variable",
    });
    const all = at(fn("  return |;"));
    expect(labels(all, "variable")).toEqual(expect.arrayContaining(["amount", "o", "who"]));
    expect(labels(all, "variable")).not.toContain("later");
    expect(labels(all, "parameter")).toEqual(["cust", "label"]);
    expect(all.items.find((i) => i.label === "who")?.detail).toBe("text · variable");
  });

  it("offers a %ROWTYPE record's fields after its name and a dot", async () => {
    const at = await service();
    const found = at(fn("  amount := o.|;"));
    expect(labels(found).sort()).toEqual(["customer_id", "id", "note", "placed_at", "total"]);
    expect(found.items.find((i) => i.label === "total")?.detail).toBe("numeric(10,2) · o");
  });

  it("completes the SQL inside from the schema", async () => {
    const at = await service();
    expect(labels(at(fn("  select * into o from ord| where id = cust;")), "table")).toEqual(
      expect.arrayContaining(["orders", "order_items"]),
    );
    expect(labels(at(fn("  select tot| into amount from orders where id = cust;")))[0]).toBe(
      "total",
    );
    expect(labels(at(fn("  perform 1 from customers where na|;")))[0]).toBe("name");
    expect(labels(at(fn("  return query select | from products;")), "column")).toEqual([
      "id",
      "name",
      "price",
    ]);
    const loop = at(
      fn("  for o in select * from orders where customer_id = cu| loop null; end loop;"),
    );
    expect(labels(loop).slice(0, 2)).toEqual(["customer_id", "cust"]);
    // Where INTO's targets go, the variables.
    expect(labels(at(fn("  select total into am| from orders;")))[0]).toBe("amount");
  });

  it("offers PL/pgSQL's words where a statement starts", async () => {
    const at = await service();
    const found = at(fn("  rai|"));
    expect(found.word).toBe("rai");
    expect(found.items[0]).toMatchObject({ label: "RAISE", kind: "keyword" });
    expect(labels(at(fn("  |")))).toEqual(
      expect.arrayContaining(["PERFORM", "RETURN", "amount", "cust"]),
    );
  });

  it("offers the variables without a schema cache", async () => {
    const at = await service(null);
    expect(labels(at(fn("  return am|;")))[0]).toBe("amount");
  });

  it("offers nothing in another language's body, a string or a comment, and is unchanged outside", async () => {
    const at = await service();
    expect(labels(at("create function g() returns int language sql as $$ select am| $$;"))).toEqual(
      [],
    );
    expect(labels(at(fn("  raise notice 'am|';")))).toEqual([]);
    expect(labels(at(fn("  -- am|")))).toEqual([]);
    expect(labels(at("select tot| from orders"))[0]).toBe("total");
  });
});
