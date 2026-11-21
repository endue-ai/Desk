// The explorer's operations on a real PostgreSQL through the plugin's commands (PG-52), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database (as in live.test.ts): each operation
// on a scratch schema and read back, a drop refused while others depend on the table and done with
// CASCADE, and a view's, a function's and a materialized view's source edited, applied in one
// transaction and read back, a broken one rolled back with its line said.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { OperationModel } from "../ui/features/objects/models.js";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
const OWNER = "t476_owner";

const SETUP = `drop schema if exists obj476 cascade;
drop schema if exists obj476_archive cascade;
do $$ begin if not exists (select from pg_roles where rolname = '${OWNER}') then create role ${OWNER} nologin; end if; end $$;
create schema obj476;
create schema obj476_archive;
create table obj476.people (id serial primary key, name text not null);
insert into obj476.people (name) values ('Ana'), ('Ben');
create table obj476.orders (id int generated always as identity primary key, person int references obj476.people (id), total numeric not null);
insert into obj476.orders (person, total) values (1, 120), (2, 30);
analyze obj476.orders;
create view obj476.big_orders as select id, total from obj476.orders where total > 100;
create view obj476.bigger as select id from obj476.big_orders;
create materialized view obj476.totals as select person, sum(total) as total from obj476.orders group by person;
create unique index totals_person on obj476.totals (person);
comment on materialized view obj476.totals is 'Per person';
create function obj476.add(a integer, b integer) returns integer language sql as 'select a + b';
create function obj476.touch() returns trigger language plpgsql as $$ begin new.name := trim(new.name); return new; end $$;
create trigger people_touch before update on obj476.people for each row execute function obj476.touch()`;

/** Run with what the dialog shows, `on` choices added. */
const asShown =
  (on: string[] = []) =>
  (_type: string, given: unknown) => {
    const model = given as OperationModel;
    return {
      values: Object.fromEntries(model.fields.map((f) => [f.name, f.value])),
      choices: [...model.choices.filter((c) => c.checked).map((c) => c.name), ...on],
    };
  };

describe.skipIf(!uri)("objects changed on a real PostgreSQL", () => {
  const saved = process.env.PGPASSWORD;
  let m: Awaited<ReturnType<typeof mount>>;
  const at = { connection: "Objects", schema: "obj476" };
  /** Run SQL in the connection's console and give back the first cell of the last result. */
  const value = async (sql: string) => {
    await m.host.command("endue.database.console", { connection: "Objects" });
    m.view.text = sql;
    await m.host.command("endue.database.run");
    return m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0];
  };
  const model = () => m.view.dialogs.at(-1)?.model as OperationModel;

  beforeAll(async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-objects", name: "Objects" });
    if (password) process.env.PGPASSWORD = password;
    const procs = realProcs();
    m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Objects" });
    m.view.text = SETUP;
    await m.host.command("endue.database.run-all");
  });
  afterAll(async () => {
    if (m) {
      await m.host.command("endue.database.console", { connection: "Objects" }).catch(() => {});
      m.view.text = `drop schema if exists obj476 cascade;\ndrop schema if exists obj476_archive cascade;\ndrop role if exists ${OWNER}`;
      await m.host.command("endue.database.run-all").catch(() => {});
    }
    if (saved === undefined) delete process.env.PGPASSWORD;
    else process.env.PGPASSWORD = saved;
  });

  it("renames, moves, comments, gives away, truncates, refreshes and disables, read back each time", async () => {
    m.view.answerDialog = asShown();
    await m.host.command("endue.database.rename-object", { ...at, name: "add", to: "Plus" });
    expect(await value(`select 'obj476."Plus"(integer, integer)'::regprocedure::text`)).toBe(
      'obj476."Plus"(integer,integer)',
    );
    await m.host.command("endue.database.comment-object", {
      ...at,
      name: "people",
      comment: "Who buys, it's said",
    });
    expect(await value("select obj_description('obj476.people'::regclass, 'pg_class')")).toBe(
      "Who buys, it's said",
    );
    await m.host.command("endue.database.change-owner", { ...at, name: "big_orders", to: OWNER });
    expect(model().fields[0]?.list).toContain(OWNER);
    expect(
      await value(
        "select viewowner from pg_views where schemaname = 'obj476' and viewname = 'big_orders'",
      ),
    ).toBe(OWNER);
    await m.host.command("endue.database.comment-object", {
      ...at,
      table: "people",
      kind: "trigger",
      name: "people_touch",
      comment: "Trims names",
    });
    await m.host.command("endue.database.enable-trigger", {
      ...at,
      table: "people",
      kind: "trigger",
      name: "people_touch",
    });
    expect(
      await value(
        "select tgenabled::text from pg_trigger where tgrelid = 'obj476.people'::regclass and tgname = 'people_touch'",
      ),
    ).toBe("D");
    await m.host.command("endue.database.refresh-materialized-view", { ...at, name: "totals" });
    expect(m.view.said.some((s) => s === "Refreshed materialized view obj476.totals.")).toBe(true);

    await m.host.command("endue.database.move-object", {
      ...at,
      name: "bigger",
      to: "obj476_archive",
    });
    expect(
      await value(
        "select count(*) from pg_views where schemaname = 'obj476_archive' and viewname = 'bigger'",
      ),
    ).toBe("1");

    await m.host.command("endue.database.truncate-table", {
      ...at,
      name: "orders",
      restartIdentity: true,
    });
    expect(model().notes).toContain("About 2 rows (the server's estimate) go.");
    await value("insert into obj476.orders (person, total) values (1, 5)");
    expect(await value("select min(id) from obj476.orders")).toBe("1");
  });

  it("lists what depends on a table, refuses a plain DROP and drops it with CASCADE", async () => {
    m.view.answerDialog = asShown();
    await expect(
      m.host.command("endue.database.drop-object", { ...at, name: "people" }),
    ).rejects.toThrow(
      /Not run: cannot drop table obj476\.people because other objects depend on it/u,
    );
    const listed = model().dependents;
    expect(listed?.blocking).toEqual([
      { kind: "table constraint", name: "orders_person_fkey on obj476.orders" },
    ]);
    expect(listed?.along.map((d) => d.name)).toEqual(
      expect.arrayContaining([
        "obj476.people_id_seq",
        "people_pkey on obj476.people",
        "people_touch on obj476.people",
      ]),
    );
    expect(await value("select to_regclass('obj476.people') is not null")).toBe("t");

    m.view.answerDialog = asShown(["cascade"]);
    await m.host.command("endue.database.drop-object", { ...at, name: "people" });
    expect(await value("select to_regclass('obj476.people') is null")).toBe("t");
    expect(
      await value(
        "select count(*) from pg_constraint where conrelid = 'obj476.orders'::regclass and contype = 'f'",
      ),
    ).toBe("0");
  });

  it("edits a view's, a function's and a materialized view's source, applied and read back", async () => {
    m.view.answerDialog = asShown();
    const text = await m.host.command("endue.database.edit-source", { ...at, name: "big_orders" });
    expect(text).toMatch(/^CREATE OR REPLACE VIEW "obj476"\."big_orders" AS\n/u);
    m.view.text = `${String(text).replace(/;\n$/u, "")}\n  AND total < 1000;\n`;
    await m.host.command("endue.database.apply-source");
    expect(await value("select pg_get_viewdef('obj476.big_orders'::regclass, true)")).toMatch(
      /total < 1000/u,
    );

    const fn = await m.host.command("endue.database.edit-source", { ...at, name: "Plus" });
    expect(fn).toMatch(/^CREATE OR REPLACE FUNCTION obj476\."Plus"\(a integer, b integer\)/u);
    m.view.text = String(fn).replace("select a + b", "select a + b + 100");
    await m.host.command("endue.database.apply-source");
    expect(await value('select obj476."Plus"(2, 3)')).toBe("105");

    const broken = await m.host.command("endue.database.edit-source", { ...at, name: "Plus" });
    const lines = String(broken).split("\n");
    m.view.text = [lines[0], "RETURNS integr", ...lines.slice(2)].join("\n");
    await expect(m.host.command("endue.database.apply-source")).rejects.toThrow(
      /^.*Not applied: .*integr/u,
    );
    expect(await value('select obj476."Plus"(2, 3)')).toBe("105");

    const totals = await m.host.command("endue.database.edit-source", { ...at, name: "totals" });
    expect(totals).toMatch(/COMMENT ON MATERIALIZED VIEW "obj476"\."totals" IS 'Per person';/u);
    m.view.text = String(totals).replace(
      "sum(total) AS total",
      "sum(total) AS total, count(*) AS n",
    );
    await m.host.command("endue.database.apply-source");
    expect(
      await value(
        "select count(*) from pg_attribute where attrelid = 'obj476.totals'::regclass and attname = 'n'",
      ),
    ).toBe("1");
    expect(
      await value(
        "select count(*) from pg_indexes where schemaname = 'obj476' and indexname = 'totals_person'",
      ),
    ).toBe("1");
    expect(await value("select obj_description('obj476.totals'::regclass, 'pg_class')")).toBe(
      "Per person",
    );
  });
});
