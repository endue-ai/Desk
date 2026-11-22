// An object's usages (PG-32): the dependency catalog's rows become `catalog` usages; routine bodies
// the catalog does not record and the open consoles (a bound .sql file named by its path) are read
// as `parsed`, a name in a string or a comment left out and a routine the catalog lists not
// repeated; the panel lists both and opens a row; a cut list says so.
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { findUsages } from "../ui/navigate/find.js";
import { mentionsOf } from "../ui/navigate/mentions.js";
import { answer } from "../ui/navigate/mentions-worker.js";
import { bodiesOf, catalogUsages } from "../ui/navigate/usages.js";
import { usagesPanel } from "../ui/navigate/usages-panel.js";
import { BODIES_MAX, CATALOG_MAX, usagesSql } from "../ui/navigate/usages-sql.js";
import { shopResolver } from "./navigate-fixture";
import { PG } from "./schema-cache-helpers";

const people = { kind: "relation", schema: "public", name: "people", relkind: "table" } as const;
const PLPGSQL = [
  "BEGIN",
  "  -- people is named in this comment only",
  "  RAISE NOTICE 'people';",
  "  UPDATE people SET name = upper(name);",
  "  PERFORM 1 FROM public.people, other.people;",
  "END",
].join("\n");

let resolve: Awaited<ReturnType<typeof shopResolver>>["resolve"];
beforeAll(async () => {
  resolve = (await shopResolver()).resolve;
});

describe("usages", () => {
  it("are asked of the server for objects only, capped one row past the limit", () => {
    const sql = usagesSql(people) ?? "";
    expect(sql).toContain("FROM pg_depend d JOIN target t");
    for (const kind of [
      "pg_rewrite",
      "pg_proc",
      "pg_trigger",
      "pg_constraint",
      "pg_policy",
      "pg_attrdef",
    ])
      expect(sql).toContain(`'${kind}'::regclass`);
    expect(sql).toContain(`LIMIT ${CATALOG_MAX + 1}`);
    expect(sql).toContain(`LIMIT ${BODIES_MAX + 1}`);
    expect(sql).toContain("NOT g.tgisinternal");
    expect(usagesSql({ kind: "column", schema: "public", table: "it's", name: "x" })).toContain(
      "'it''s'",
    );
    expect(usagesSql({ kind: "cte", name: "t", at: 5 })).toBeNull();
  });

  it("in a body are names the lexer reads, not strings or comments or another schema's", () => {
    const found = mentionsOf(PLPGSQL, people);
    expect(found.count).toBe(2);
    expect(found.places.map((p) => p.line)).toEqual([4, 5]);
    expect(mentionsOf('SELECT * FROM "People"', people).count).toBe(0);
    expect(mentionsOf('SELECT * FROM "people"', people).count).toBe(1);
    expect(answer({ texts: [PLPGSQL, "select 1"], aim: people })).toEqual({
      found: [found, { places: [], count: 0 }],
    });
  });

  it("from the catalog and from parsed source, each saying which", async () => {
    const catalog = [
      ["view", "public", "big_orders", "", ""],
      ["function", "public", "count_people", "", ""],
      ["trigger", "public", "people_touch", "people", ""],
      [
        "foreign key",
        "public",
        "orders_person_fkey",
        "orders",
        "FOREIGN KEY (person) REFERENCES people(id)",
      ],
      ["policy", "public", "own_rows", "people", ""],
    ];
    const bodies = [
      ["public", "count_people", "", "function", "sql", ""],
      ["public", "rename_all", "", "procedure", "plpgsql", PLPGSQL],
      ["public", "noise", "", "function", "plpgsql", "BEGIN RAISE NOTICE 'people'; END"],
    ];
    const ran: string[] = [];
    const execute = async (_conn: unknown, sql: string, options: unknown) => {
      ran.push(sql);
      expect(options).toMatchObject({ catalog: true });
      return {
        result: { statements: [catalog, bodies].map((rows) => ({ sets: [{ rows }] })) },
      } as never;
    };
    const text = "select p.name\nfrom people p;\nselect * from orders";
    const consoles = [
      { id: "b1", name: "Shop", kind: "console", text, file: { path: "~/q/report.sql" } },
      { id: "b2", name: "Shop", kind: "console", text: "select 1", number: 2 },
      { id: "b3", name: "Shop", kind: "ddl", text: "CREATE TABLE people ()" },
    ];
    const found = await findUsages(
      { execute, resolve: async (t) => ({ names: resolve(t) }) },
      PG,
      people,
      consoles,
    );
    expect(ran).toHaveLength(1);
    expect(found.capped).toBe(false);
    expect(found.items.map((u) => [u.source, u.kind, u.name])).toEqual([
      ["catalog", "view", "big_orders"],
      ["catalog", "function", "count_people"],
      ["catalog", "trigger", "people_touch"],
      ["catalog", "foreign key", "orders_person_fkey"],
      ["catalog", "policy", "own_rows"],
      ["parsed", "procedure", "rename_all"],
      ["parsed", "console", "Shop"],
    ]);
    expect(found.items[5]).toMatchObject({ count: 2, line: 4 });
    expect(found.items[6]).toMatchObject({
      console: "b1",
      file: "~/q/report.sql",
      from: text.indexOf("people p"),
      to: text.indexOf("people p") + 6,
      line: 2,
      detail: "from people p;",
    });
  });

  it("are not listed twice when the catalog records a routine", () => {
    const listed = catalogUsages([["function", "public", "f", "", "a integer"]]);
    const left = bodiesOf(
      [
        ["public", "f", "a integer", "function", "sql", "x"],
        ["public", "f", "", "function", "sql", "y"],
      ],
      listed,
    );
    expect(left.map((b) => b.source)).toEqual(["y"]);
  });

  it("are listed by where they were found and open on a click", () => {
    const opened: unknown[] = [];
    const state = {
      connection: PG.id,
      of: "public.people",
      kind: "relation",
      status: "done" as const,
      capped: true,
      items: catalogUsages([["view", "public", "big_orders", "", ""]]).concat([
        {
          source: "parsed",
          kind: "console",
          name: "Shop",
          console: "b1",
          from: 5,
          to: 11,
          line: 2,
          detail: "from people",
        },
      ]),
    };
    const panel = usagesPanel(
      document,
      state,
      (name, ...args) => void opened.push([name, ...args]),
    );
    const summary = panel.el.querySelector("[data-part=summary]")?.textContent ?? "";
    expect(summary).toContain(
      "2 usages of public.people: 1 from the dependency catalog, 1 from parsed source.",
    );
    expect(summary).toContain("cut at its limit");
    const sources = [...panel.el.querySelectorAll(".usage-source")].map((s) => s.textContent);
    expect(sources).toEqual(["catalog", "parsed"]);
    (panel.el.querySelectorAll<HTMLButtonElement>("[data-usage]")[1] as HTMLButtonElement).click();
    expect(opened).toEqual([["navigateOpen", PG.id, state.items[1]]]);
    panel.update({ ...state, status: "reading", items: [] });
    expect(panel.el.textContent).toContain("Reading the usages of public.people");
  });
});
