// A PostgreSQL table view's rows in a fixed order (#564): its primary key's columns in the key's
// order, ctid for a table without one, nothing for a view, and the person's own order once they
// sort or type one. The rows read again after Submit come back in the order they had, where a read
// without ORDER BY would put the edited row last (PostgreSQL writes it anew at the table's end).
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { type Answer, mount } from "./harness";

const LAB: Connection = {
  id: "c-lab",
  name: "lab",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "lab",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

/** relkind and the primary key's columns, quoted, in the key's order, by table. */
const RELATIONS: Record<string, [string, string]> = {
  orders: ["r", '"shop_id", "id"'],
  log: ["r", ""],
  totals: ["v", ""],
  snapshot: ["m", ""],
};

function script(sql: string): Answer {
  const text = sql.trim();
  const order = /^SELECT c\.relkind, [\s\S]*c\.relname = '(\w+)'/u.exec(text);
  if (order) {
    const [kind, key] = RELATIONS[order[1] ?? ""] ?? ["", ""];
    return kind
      ? {
          rows: [
            ["relkind", "key"],
            [kind, key],
          ],
        }
      : { rows: [["relkind", "key"]] };
  }
  if (/^SELECT a\.attname, pg_catalog\.format_type/u.test(text))
    return {
      rows: [
        ["attname", "format_type", "nullable", "default", "primary"],
        ["shop_id", "integer", "NO", "", "YES"],
        ["id", "integer", "NO", "", "YES"],
        ["note", "text", "YES", "", "NO"],
      ],
    };
  if (/^SELECT \* FROM "public"\./u.test(text))
    return {
      rows: [
        ["shop_id", "id", "note"],
        ["1", "1", "a"],
        ["1", "2", "b"],
      ],
    };
  if (/^UPDATE /u.test(text)) return { changes: 1 };
  return {};
}

const pages = (m: Awaited<ReturnType<typeof mount>>) =>
  m
    .sessions()
    .flat()
    .filter((sql) => /^SELECT \* FROM "public"\./u.test(sql));

async function opened(table: string) {
  const m = await mount({ store: { connections: [LAB] }, script });
  await m.host.command("endue.database.open-table", {
    connection: "lab",
    schema: "public",
    table,
  });
  await m.settle();
  return m;
}

describe("a PostgreSQL table view's order", () => {
  it("reads its rows by its primary key, the key's columns in the key's order", async () => {
    const m = await opened("orders");
    expect(pages(m).at(-1)).toBe(
      'SELECT * FROM "public"."orders" ORDER BY "shop_id", "id" LIMIT 500 OFFSET 0',
    );
    // The next page keeps it; the Order by field stays empty, as the person has not sorted.
    m.app.page({ delta: 1 });
    await m.settle();
    expect(pages(m).at(-1)).toBe(
      'SELECT * FROM "public"."orders" ORDER BY "shop_id", "id" LIMIT 500 OFFSET 500',
    );
    expect(m.shown()?.table?.order).toBe("");
  });

  it("reads by ctid when the table has no primary key, a materialized view too", async () => {
    expect(pages(await opened("log")).at(-1)).toBe(
      'SELECT * FROM "public"."log" ORDER BY ctid LIMIT 500 OFFSET 0',
    );
    expect(pages(await opened("snapshot")).at(-1)).toBe(
      'SELECT * FROM "public"."snapshot" ORDER BY ctid LIMIT 500 OFFSET 0',
    );
  });

  it("reads a view as it is", async () => {
    expect(pages(await opened("totals")).at(-1)).toBe(
      'SELECT * FROM "public"."totals" LIMIT 500 OFFSET 0',
    );
  });

  it("reads by the person's order once they sort or type one", async () => {
    const m = await opened("orders");
    m.app.page({ sort: [{ key: "note", name: "note", direction: "desc" }] });
    await m.settle();
    expect(pages(m).at(-1)).toBe(
      'SELECT * FROM "public"."orders" ORDER BY "note" DESC LIMIT 500 OFFSET 0',
    );
    m.app.page({ where: "", order: "id desc" });
    await m.settle();
    expect(pages(m).at(-1)).toBe(
      'SELECT * FROM "public"."orders" ORDER BY id desc LIMIT 500 OFFSET 0',
    );
    // An empty order is the key's again.
    m.app.page({ where: "", order: "" });
    await m.settle();
    expect(pages(m).at(-1)).toBe(
      'SELECT * FROM "public"."orders" ORDER BY "shop_id", "id" LIMIT 500 OFFSET 0',
    );
  });

  it("reads the rows again after Submit in the same order, the key looked up once", async () => {
    const m = await opened("orders");
    await m.app.editCell(0, 2, "changed");
    await m.settle();
    expect(m.shown()?.edit).toMatchObject({ status: "ready", count: 1 });
    await m.host.command("endue.database.submit-changes");
    await m.settle();
    const all = m.sessions().flat();
    expect(all.some((sql) => /^UPDATE "public"\."orders"/u.test(sql))).toBe(true);
    expect(pages(m)).toEqual([
      'SELECT * FROM "public"."orders" ORDER BY "shop_id", "id" LIMIT 500 OFFSET 0',
      'SELECT * FROM "public"."orders" ORDER BY "shop_id", "id" LIMIT 500 OFFSET 0',
    ]);
    expect(all.filter((sql) => /^SELECT c\.relkind, /u.test(sql))).toHaveLength(1);
  });

  it("leaves SQLite's table views as they read", async () => {
    const m = await mount({
      store: {
        connections: [
          {
            ...LAB,
            id: "c-n",
            name: "Notes",
            engine: "sqlite",
            host: "",
            port: null,
            file: "~/notes.db",
          },
        ],
      },
      script: () => ({ rows: [["id"], ["1"]] }),
    });
    await m.host.command("endue.database.open-table", {
      connection: "Notes",
      schema: "main",
      table: "notes",
    });
    await m.settle();
    const sqls = m.clients.spawned.filter((s) => s.command === "sqlite3").flatMap((s) => s.args);
    expect(sqls).toContain('SELECT * FROM "notes" LIMIT 500 OFFSET 0');
  });
});
