// A name's card (PG-32) from the shop's schema cache alone: a table's kind, columns with types,
// keys, comment and row estimate; a function's signature, result and comment; a column's type,
// default and comment; a type's kind; an alias's is its relation's. Drawn, it is a status a screen
// reader reads.
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { cardOf, MAX_COLUMNS } from "../ui/navigate/card.js";
import { renderCard } from "../ui/navigate/card-view.js";
import { t } from "../ui/strings/index.js";
import { shopView } from "./navigate-fixture";
import { shop } from "./pg-catalog";

let view: Awaited<ReturnType<typeof shopView>>;
beforeAll(async () => {
  view = await shopView();
});

describe("a name's card", () => {
  it("of a table: kind, comment, estimate, columns with types and keys", () => {
    const card = cardOf(view, {
      kind: "relation",
      schema: "public",
      name: "people",
      relkind: "table",
    });
    expect(card).toMatchObject({
      kind: "table · RLS on",
      title: "public.people",
      comment: "Who buys",
      estimate: 4,
      keys: ["PRIMARY KEY (id)"],
    });
    expect(card?.columns).toEqual([
      {
        name: "id",
        type: "integer",
        key: "primary key",
        default: "nextval('people_id_seq'::regclass)",
      },
      { name: "name", type: "text", comment: "Full name" },
      { name: "joined", type: "timestamp with time zone", default: "now()" },
    ]);
    const orders = cardOf(view, {
      kind: "relation",
      schema: "public",
      name: "orders",
      relkind: "table",
    });
    expect(orders?.columns?.[1]).toEqual({ name: "person", type: "integer", key: "→ people.id" });
    expect(orders?.keys).toEqual([
      "FOREIGN KEY (person) REFERENCES people(id)",
      "PRIMARY KEY (id)",
    ]);
    expect(
      cardOf(view, { kind: "relation", schema: "public", name: "gone", relkind: "" }),
    ).toBeNull();
  });

  it("of a routine, a column, a type, a schema and an alias", () => {
    expect(cardOf(view, { kind: "function", schema: "public", name: "touch" })).toEqual({
      kind: "function",
      title: "public.touch",
      signatures: [{ text: "touch() → trigger", comment: "Sets updated" }],
    });
    expect(
      cardOf(view, { kind: "column", schema: "public", table: "people", name: "name" }),
    ).toEqual({
      kind: "column",
      title: "public.people.name",
      type: "text",
      notNull: true,
      comment: "Full name",
    });
    expect(
      cardOf(view, { kind: "column", schema: "public", table: "people", name: "joined" }),
    ).toMatchObject({ default: "now()" });
    expect(cardOf(view, { kind: "type", schema: "public", name: "positive" })).toMatchObject({
      kind: "type",
      detail: "domain of numeric(10,2)",
    });
    expect(cardOf(view, { kind: "schema", name: "sales" })).toMatchObject({ kind: "schema" });
    const alias = cardOf(view, {
      kind: "alias",
      name: "p",
      of: { kind: "relation", schema: "public", name: "people", relkind: "table" },
    });
    expect(alias).toMatchObject({ title: "p: public.people", estimate: 4 });
  });

  it("counts the columns past the first ones", async () => {
    const wide = shop();
    const columns = Array.from({ length: MAX_COLUMNS + 3 }, (_, i) => [`c${i}`, "integer", ""]);
    wide.public?.tables?.push({ name: "wide", columns });
    const card = cardOf(await shopView(() => wide), {
      kind: "relation",
      schema: "public",
      name: "wide",
      relkind: "table",
    });
    expect(card?.columns).toHaveLength(MAX_COLUMNS);
    expect(card?.more).toBe(3);
  });

  it("is drawn as a status with its columns", () => {
    const card = cardOf(view, {
      kind: "relation",
      schema: "public",
      name: "people",
      relkind: "table",
    });
    const el = renderCard(document, card as never);
    expect(el.getAttribute("role")).toBe("status");
    expect(el.querySelector(".nav-card-title")?.textContent).toBe("public.people");
    expect(el.textContent).toContain(t("card.estimate", { count: 4 }));
    expect([...el.querySelectorAll(".nav-card-col")].map((c) => c.textContent)).toEqual([
      "id",
      "name",
      "joined",
    ]);
  });
});
