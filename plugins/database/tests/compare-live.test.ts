// Two results compared on a real PostgreSQL through the plugin's commands (PG-26, #459), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database: a result pinned, its table changed
// from another console (a price updated, a row deleted, one inserted), then the read run again and
// compared with before, keyed by the primary key the catalog names, and the pinned result compared
// with the new one by row position. On the desk core's sessions (core-bridge.ts), no psql. Fixture
// data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
const READ = "select id, item, price from cmp459.stock order by id";
const SETUP = `drop schema if exists cmp459 cascade;
create schema cmp459;
create table cmp459.stock (id int primary key, item text not null, price numeric(6,2));
insert into cmp459.stock values (1, 'pen', 2.50), (2, 'ink', 4.00), (3, 'pad', 3.20), (4, 'clip', null)`;
const CHANGE = `update cmp459.stock set price = 4.40 where id = 2;
delete from cmp459.stock where id = 3;
insert into cmp459.stock values (5, 'tape', 1.90)`;

describe.skipIf(!uri)("two results compared on a real PostgreSQL", () => {
  let m: Awaited<ReturnType<typeof mount>>;
  const type = (text: string) => {
    m.view.text = text;
    m.view.caret = text.length;
    m.app.edited(text);
  };

  beforeAll(async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-compare", name: "Compare" });
    const procs = realProcs(password ? { password } : {});
    m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      // A run of several statements asks first: yes.
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Compare" });
    type(SETUP);
    await m.host.command("endue.database.run-all");
    await m.settle();
  });
  afterAll(async () => {
    if (!m) return;
    await m.host.command("endue.database.console", { connection: "Compare" }).catch(() => {});
    type("drop schema if exists cmp459 cascade");
    await m.host.command("endue.database.run-all").catch(() => {});
  });

  it("pins a read, changes its table elsewhere, then runs it again and compares by the primary key", async () => {
    type(READ);
    await m.host.command("endue.database.run");
    await m.settle();
    expect(await m.host.command("endue.database.pin-result")).toMatch(
      /^Pinned select id, item, price… · /u,
    );
    // The table changes from a console of its own.
    await m.host.command("endue.database.new-console", { connection: "Compare" });
    type(CHANGE);
    await m.host.command("endue.database.run-all");
    await m.settle();
    await m.host.command("endue.database.consoles", { console: "Compare" });
    await m.settle();

    expect(await m.host.command("endue.database.run-again-and-compare")).toBe(
      "Compared by the primary key (id): 1 changed, 1 added, 1 removed, 2 the same.",
    );
    await m.settle();
    const state = m.shown()?.compare;
    expect(state?.by).toBe("key");
    expect(
      state?.rows.map((r: { change: string; at: string; cells: number[] }) => [
        r.change,
        r.at,
        r.cells,
      ]),
    ).toEqual([
      ["changed", "2", [2]],
      ["added", "5", []],
      ["removed", "3", []],
    ]);
    expect(state?.rows[0]?.before?.[2]).toBe("4.00");
    expect(state?.rows[0]?.after?.[2]).toBe("4.40");

    // The pinned read against the new one, by row position.
    await m.host.command("endue.database.consoles", { console: "Compare" });
    await m.settle();
    expect(await m.host.command("endue.database.compare-results", { key: "position" })).toBe(
      "Compared by row position: 3 changed, 0 added, 0 removed, 1 the same.",
    );
  });
});
