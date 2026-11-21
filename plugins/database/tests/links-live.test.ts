// Following foreign keys on a real PostgreSQL through the plugin's commands (PG-41, #468), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database: a key of one column and one of two
// followed to the referenced row, the rows pointing at a row counted and opened, a key pointing at
// its own table followed twice and walked back, and the referenced table searched over two pages
// when a key cell is edited, the picked key submitted and read back. The keys come from the schema
// cache and, for a schema it leaves out, from pg_constraint. On the desk core's sessions
// (core-bridge.ts), no psql. Fixture data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

const SETUP = `drop schema if exists fk468 cascade;
drop schema if exists fk468_more cascade;
create schema fk468;
create schema fk468_more;
create table fk468.people (id int primary key, name text not null);
insert into fk468.people select i, case i when 1 then 'Ada' when 2 then 'Bob' else 'P' || lpad(i::text, 2, '0') end from generate_series(1, 60) i;
create table fk468.orders (id int primary key, person int references fk468.people (id), total numeric(10,2));
insert into fk468.orders values (1, 1, 12), (2, 2, 30), (3, 1, 7.5);
create table fk468.lines (order_id int references fk468.orders (id), line int, item text, primary key (order_id, line));
insert into fk468.lines values (1, 1, 'pen'), (1, 2, 'ink'), (2, 1, 'pad');
create table fk468.notes (id int primary key, order_id int, line int, body text, foreign key (order_id, line) references fk468.lines (order_id, line));
insert into fk468.notes values (1, 1, 2, 'Blue ink'), (2, 2, 1, 'Ruled');
create table fk468.staff (id int primary key, name text, boss int references fk468.staff (id));
insert into fk468.staff values (1, 'Ada', null), (2, 'Bob', 1), (3, 'Cy', 2);
create table fk468_more.old_orders (id int primary key, person int references fk468.people (id));
insert into fk468_more.old_orders values (9, 1)`;

describe.skipIf(!uri)("foreign keys followed on a real PostgreSQL", () => {
  let m: Awaited<ReturnType<typeof mount>>;
  let answers: Array<(items: Array<{ id: string; label: string }>) => string> = [];
  const rows = () => m.shown()?.shown?.tabs[0]?.set?.rows;
  const open = async (table: string, schema = "fk468") => {
    await m.host.command("endue.database.open-table", { connection: "Links", schema, table });
    await m.settle();
  };
  const cursor = (row: number, col: number) => {
    m.view.cell = () => {
      const set = m.shown()?.shown?.tabs[0]?.set;
      return {
        row,
        col,
        value: set?.rows[row]?.[col] ?? null,
        name: set?.columns[col] ?? "",
      } as never;
    };
  };

  beforeAll(async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-links", name: "Links" });
    const procs = realProcs(password ? { password } : {});
    m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      // A run of several statements asks first: yes, unless a test queued its own answer.
      pick: ({ items }) => answers.shift()?.(items) ?? "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Links" });
    m.view.text = SETUP;
    await m.host.command("endue.database.run-all");
    // The cache reads both schemas as they are now.
    await m.host.command("endue.database.reload-schema", { connection: "Links" });
  });
  afterAll(async () => {
    if (m) {
      await m.host.command("endue.database.console", { connection: "Links" }).catch(() => {});
      m.view.text =
        "drop schema if exists fk468 cascade;\ndrop schema if exists fk468_more cascade";
      await m.host.command("endue.database.run-all").catch(() => {});
    }
  });

  it("follows a key of one column and one of two to the referenced row", async () => {
    await open("orders");
    cursor(0, 1);
    expect(await m.host.command("endue.database.follow-key")).toBe(
      "fk468.people where id = 1: b goes back.",
    );
    await m.settle();
    expect(rows()).toEqual([["1", "Ada"]]);
    await open("notes");
    cursor(0, 2);
    await m.host.command("endue.database.follow-key");
    await m.settle();
    expect(rows()).toEqual([["1", "2", "ink"]]);
    expect(await m.host.command("endue.database.go-back")).toBe("Back to fk468.notes.");
  });

  it("counts the rows that point at a row, from another schema too, and opens them", async () => {
    let listed: string[] = [];
    let counted: string[] = [];
    answers = [
      (items) => {
        listed = items.map((i) => i.label);
        return items.find((i) => i.label === "Count the rows of each")?.id ?? "";
      },
      (items) => {
        counted = items.map((i) => `${i.label}: ${(i as { detail?: string }).detail}`);
        return items.find((i) => i.label === "fk468.orders (person)")?.id ?? "";
      },
    ];
    await open("people");
    cursor(0, 0);
    await m.host.command("endue.database.referencing-rows");
    await m.settle();
    expect(listed).toEqual([
      "Count the rows of each",
      "fk468.orders (person)",
      "fk468_more.old_orders (person)",
    ]);
    expect(counted).toEqual([
      "fk468.orders (person): 2 rows",
      "fk468_more.old_orders (person): 1 row",
    ]);
    expect(rows()).toEqual([
      ["1", "1", "12.00"],
      ["3", "1", "7.50"],
    ]);
  });

  it("follows a key that points at its own table twice and walks back", async () => {
    await open("staff");
    cursor(2, 2);
    await m.host.command("endue.database.follow-key");
    await m.settle();
    cursor(0, 2);
    await m.host.command("endue.database.follow-key");
    await m.settle();
    expect(rows()).toEqual([["1", "Ada", null]]);
    await m.host.command("endue.database.go-back");
    await m.settle();
    expect(rows()).toEqual([["2", "Bob", "1"]]);
    await m.host.command("endue.database.go-back");
    await m.settle();
    expect(rows()).toHaveLength(3);
  });

  it("searches the referenced table over two pages, and the picked key is submitted", async () => {
    let second: string[] = [];
    answers = [
      (items) => {
        expect(items).toHaveLength(51);
        return items.find((i) => i.label.startsWith("More rows"))?.id ?? "";
      },
      (items) => {
        second = items.map((i) => i.label);
        return items.find((i) => i.label === "55 · P55")?.id ?? "";
      },
    ];
    await open("orders");
    // The view is the one the rows pointing at Ada opened: all its rows again (the grid's chips).
    await m.app.page?.({ filters: [] });
    await m.settle();
    expect(rows()?.[1]?.[0]).toBe("2");
    cursor(1, 1);
    expect(await m.host.command("endue.database.pick-key")).toBe(
      "person = 55 (P55): pending until Submit.",
    );
    expect(second).toHaveLength(10);
    await m.host.command("endue.database.submit-changes");
    await m.settle();
    await m.host.command("endue.database.console", { connection: "Links" });
    m.view.text = "select person from fk468.orders where id = 2";
    await m.host.command("endue.database.run");
    expect(m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows).toEqual([["55"]]);
  });

  it("reads a key from pg_constraint when the cache leaves its schema out", async () => {
    await m.host.command("endue.database.choose-schemas", {
      connection: "Links",
      schema: "fk468_more",
    });
    await open("old_orders", "fk468_more");
    cursor(0, 1);
    expect(await m.host.command("endue.database.follow-key")).toBe(
      "fk468.people where id = 1: b goes back.",
    );
    await m.settle();
    expect(rows()).toEqual([["1", "Ada"]]);
  });
});
