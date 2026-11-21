// The explorer's operations on objects through the plugin (PG-52, ui/features/objects/): each
// kind's menu, a drop that lists what depends on the object and takes CASCADE only as a choice, the
// guards (a read-only connection refused before the dialog, a production one asked with its tag
// named, a command waiting on the person's answer), the schema cache read again after a change,
// a source edited in a console and applied in one transaction with an error's line selected, and
// generated SQL, over the scripted shop (pg-catalog.ts, objects-fixture.ts).
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import type { OperationModel } from "../ui/features/objects/models.js";
import { fixtureScript } from "./fixtures";
import { type Mounted, mount, SAVED } from "./harness";
import { objectsServer } from "./objects-fixture";
import { catalogScript, type PgCatalog, shop } from "./pg-catalog";

const [NOTES, SHOP] = SAVED as [Connection, Connection];
const DEV: Connection = { ...SHOP, id: "c-dev", name: "Dev", tag: "none" };
const LOCKED: Connection = { ...SHOP, id: "c-locked", name: "Locked", tag: "none", readOnly: true };

/** Run with what the dialog shows: its fields' values and the choices on. */
const asShown = (model: OperationModel) => ({
  values: Object.fromEntries(model.fields.map((f) => [f.name, f.value])),
  choices: model.choices.filter((c) => c.checked).map((c) => c.name),
});

type Asked = { title: string; items: Array<{ id: string; label: string; detail?: string }> };

/** The shop with a materialized view in sales, and the plugin over it. */
async function mounted(answer: (model: OperationModel) => unknown = asShown) {
  const model: PgCatalog = shop();
  model.sales?.tables?.push({
    name: "daily",
    kind: "m",
    columns: [
      ["person", "integer"],
      ["total", "numeric"],
    ],
  });
  const server = objectsServer(catalogScript(() => model, fixtureScript));
  const state = { menu: "", confirm: "yes" };
  const m = await mount({
    store: { connections: [DEV, SHOP, LOCKED, NOTES] },
    script: (sql, env) => {
      if (/^ALTER TABLE "public"\."people" RENAME TO "persons"$/u.test(sql.trim())) {
        const people = model.public?.tables?.find((t) => t.name === "people");
        if (people) people.name = "persons";
        (model.public as { mark: string }).mark = "10.4:400";
      }
      return server.script(sql, env);
    },
    pick: (asked: Asked) => (asked.title.startsWith("Run ") ? state.confirm : state.menu),
    dialog: (_type, given) => answer(given as OperationModel),
  });
  const selected: Array<[number, number]> = [];
  m.view.select = (start, end) => void selected.push([start, end]);
  return { m, server, model, state, selected };
}

const row = (m: Mounted, label: string, kind?: string, connection?: string) =>
  m.view.trees
    .at(-1)
    ?.find(
      (r) =>
        r.label === label &&
        (!kind || r.kind === kind) &&
        (!connection || r.connection === connection),
    );
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 80 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}
/** Open explorer rows by label, one after the other; answers the last. */
const open = (m: Mounted, ...labels: string[]) => openIn(m, undefined, ...labels);
/** The same, among one connection's rows. */
async function openIn(m: Mounted, connection: string | undefined, ...labels: string[]) {
  let last: Node | undefined;
  for (const label of labels) {
    await until(m, () => row(m, label, undefined, connection));
    last = row(m, label, undefined, connection) as Node;
    m.app.toggle(last, true);
    await m.settle();
  }
  return last as Node;
}
/** One of the feature's actions, as the view calls it by name. */
const action = (m: Mounted, name: string) => {
  const fn = (m.app as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`no action ${name}`);
  return fn as (...args: unknown[]) => Promise<unknown>;
};
const dialogs = (m: Mounted) => m.view.dialogs.map((d) => d.model as OperationModel);
/** Each PostgreSQL run's statements (a session each), in order. */
const runs = (m: Mounted) => m.sessions();

describe("the objects feature", () => {
  it("offers each kind what its engine can do to it, from a row's menu or a command", async () => {
    const { m, state } = await mounted();
    const orders = await open(m, "Dev", "public", "Tables", "orders");
    await action(m, "objectMenu")(orders);
    const labels = (asked?: Asked) => asked?.items.map((i) => i.label);
    expect(m.picks.at(-1)?.title).toBe("Database: table public.orders");
    expect(labels(m.picks.at(-1))).toEqual([
      "Rename…",
      "Move to another schema…",
      "Change the owner…",
      "Comment…",
      "Truncate…",
      "Drop…",
      "Generate SELECT",
      "Generate INSERT",
      "Generate UPDATE",
      "Generate DELETE",
    ]);
    const view = await open(m, "Views", "big_orders");
    await action(m, "objectMenu")(view);
    expect(labels(m.picks.at(-1))?.slice(0, 2)).toEqual(["Edit the source", "Rename…"]);
    await open(m, "Routines");
    await action(m, "objectMenu")(row(m, "touch()") as Node);
    expect(labels(m.picks.at(-1))).toEqual([
      "Edit the source",
      "Rename…",
      "Move to another schema…",
      "Change the owner…",
      "Comment…",
      "Drop…",
      "Generate a call",
    ]);
    await open(m, "people", "Triggers");
    await action(m, "objectMenu")(row(m, "people_touch", "part") as Node);
    expect(labels(m.picks.at(-1))).toEqual([
      "Edit the source",
      "Enable or disable…",
      "Rename…",
      "Comment…",
      "Drop…",
    ]);
    expect(m.view.dialogs).toEqual([]);

    state.menu = "comment";
    await m.host.command("endue.database.object-actions", {
      connection: "Dev",
      schema: "public",
      name: "people",
    });
    expect(dialogs(m).at(-1)).toMatchObject({
      op: "comment",
      title: "Comment table public.people",
    });
    expect(dialogs(m).at(-1)?.fields[0]).toMatchObject({ name: "comment", value: "Who buys" });

    await openIn(m, NOTES.id, "Notes", "main", "Tables", "people");
    state.menu = "";
    await action(m, "objectMenu")(row(m, "people", "table", NOTES.id) as Node);
    expect(labels(m.picks.at(-1))).toEqual([
      "Rename…",
      "Truncate…",
      "Drop…",
      "Generate SELECT",
      "Generate INSERT",
      "Generate UPDATE",
      "Generate DELETE",
    ]);
    await expect(
      m.host.command("endue.database.edit-source", {
        connection: "Notes",
        schema: "main",
        name: "people",
      }),
    ).rejects.toThrow("Edit the source is not on SQLite for a table: d shows its DDL.");
  });

  it("lists what depends on an object before a drop and adds CASCADE only when chosen", async () => {
    let choices: string[] = [];
    const { m, server } = await mounted(() => ({ values: {}, choices }));
    await open(m, "Dev", "public", "Tables", "orders");
    const ask = m.host.command("endue.database.drop-object", {
      connection: "Dev",
      schema: "public",
      name: "orders",
    });
    await expect(ask).rejects.toThrow(
      /Not run: cannot drop table orders because other objects depend on it/u,
    );
    const asked = dialogs(m).at(-1);
    expect(m.view.dialogs.at(-1)?.type).toBe("object-operation");
    expect(asked).toMatchObject({
      op: "drop",
      title: "Drop table public.orders",
      danger: true,
      run: "Drop",
    });
    expect(asked?.where).toBe("Dev · PostgreSQL");
    expect(asked?.dependents?.blocking).toEqual([{ kind: "view", name: "public.big_orders" }]);
    expect(asked?.dependents?.along.map((d) => d.name)).toEqual([
      "orders_person_fkey on public.orders",
      "orders_pkey on public.orders",
      "orders_total_check on public.orders",
    ]);
    expect(asked?.choices).toEqual([
      expect.objectContaining({ name: "cascade", label: "CASCADE", checked: false }),
    ]);
    expect(server.ran).toEqual(['DROP TABLE "public"."orders"']);

    choices = ["cascade"];
    m.view.said.length = 0;
    await m.host.command("endue.database.drop-object", {
      connection: "Dev",
      schema: "public",
      name: "orders",
    });
    expect(server.ran.at(-1)).toBe('DROP TABLE "public"."orders" CASCADE');
    expect(m.view.said.at(-1)).toBe("Dropped table public.orders.");
    // A command's cascade only ticks the choice the person still sees.
    await m.host.command("endue.database.drop-object", {
      connection: "Dev",
      schema: "public",
      name: "big_orders",
      cascade: true,
    });
    expect(dialogs(m).at(-1)?.choices[0]?.checked).toBe(true);
  });

  it("refuses a read-only connection before the dialog, names production, and runs nothing unanswered", async () => {
    const { m, server, state } = await mounted(() => undefined);
    await expect(
      m.host.command("endue.database.rename-object", {
        connection: "Locked",
        schema: "public",
        name: "people",
        to: "x",
      }),
    ).rejects.toThrow("Locked is read-only: objects are not changed from here.");
    expect(m.view.dialogs).toEqual([]);

    await expect(
      m.host.command("endue.database.truncate-table", {
        connection: "Dev",
        schema: "public",
        name: "people",
      }),
    ).rejects.toThrow("Not run.");
    expect(dialogs(m).at(-1)?.op).toBe("truncate");
    expect(server.ran).toEqual([]);

    const { m: p, server: prod } = await mounted();
    const before = p.picks.length;
    state.confirm = "no";
    await p.host.command("endue.database.comment-object", {
      connection: "Shop",
      schema: "public",
      name: "orders",
      comment: "Paid ones",
    });
    const confirm = p.picks.slice(before).find((a) => a.title.startsWith("Run "));
    expect(confirm?.title).toBe("Run this statement on Shop?");
    expect(confirm?.items[0]).toMatchObject({ id: "yes", detail: "Shop is tagged production." });
    expect(prod.ran).toEqual([`COMMENT ON TABLE "public"."orders" IS 'Paid ones'`]);
    expect(dialogs(p).at(-1)?.tag).toBe("production");
  });

  it("writes each operation's statement and reads the schema cache again after it", async () => {
    const { m, server } = await mounted();
    await open(m, "Dev", "public", "Tables", "people");
    const reads = runs(m).length;
    await m.host.command("endue.database.rename-object", {
      connection: "Dev",
      schema: "public",
      name: "people",
      to: "persons",
    });
    expect(server.ran.at(-1)).toBe('ALTER TABLE "public"."people" RENAME TO "persons"');
    await until(m, () => row(m, "persons"));
    expect(runs(m).length).toBeGreaterThan(reads + 1);

    await m.host.command("endue.database.truncate-table", {
      connection: "Dev",
      schema: "public",
      name: "orders",
      restartIdentity: true,
    });
    await m.host.command("endue.database.move-object", {
      connection: "Dev",
      schema: "public",
      name: "big_orders",
      to: "sales",
    });
    await m.host.command("endue.database.change-owner", {
      connection: "Dev",
      schema: "public",
      name: "big_orders",
      to: "reports",
    });
    await m.host.command("endue.database.refresh-materialized-view", {
      connection: "Dev",
      schema: "sales",
      name: "daily",
    });
    await m.host.command("endue.database.enable-trigger", {
      connection: "Dev",
      schema: "public",
      table: "persons",
      kind: "trigger",
      name: "people_touch",
      enabled: false,
    });
    await m.host.command("endue.database.comment-object", {
      connection: "Dev",
      schema: "public",
      name: "touch",
      comment: "",
    });
    expect(server.ran.slice(1)).toEqual([
      'TRUNCATE TABLE "public"."orders" RESTART IDENTITY',
      'ALTER VIEW "public"."big_orders" SET SCHEMA "sales"',
      'ALTER VIEW "public"."big_orders" OWNER TO "reports"',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY "sales"."daily"',
      'ALTER TABLE "public"."persons" DISABLE TRIGGER "people_touch"',
      'COMMENT ON FUNCTION "public"."touch"() IS NULL',
    ]);
    const truncate = dialogs(m).find((d) => d.op === "truncate");
    expect(truncate?.notes[0]).toBe("About 2 rows (the server's estimate) go.");

    await m.host.command("endue.database.console", { connection: "Dev" });
    await m.host.command("endue.database.generate-sql", {
      connection: "Dev",
      schema: "public",
      name: "orders",
      statement: "update",
    });
    expect(m.view.inserted.at(-1)).toBe(
      'UPDATE "public"."orders"\nSET "person" = :person,\n    "total" = :total\nWHERE "id" = :id;\n',
    );
    await m.host.command("endue.database.generate-sql", {
      connection: "Dev",
      schema: "public",
      name: "refund",
    });
    expect(m.view.inserted.at(-1)).toBe('CALL "public"."refund"(:order_id, :done);\n');
  });

  it("edits a source in a console and applies it in one transaction, an error selecting its line", async () => {
    const { m, server, selected } = await mounted();
    const view = await open(m, "Dev", "public", "Views", "big_orders");
    await action(m, "editSource")(view);
    const opened = m.shown();
    expect(opened?.name).toMatch(/source · view public\.big_orders/u);
    expect(m.view.text).toBe(
      'CREATE OR REPLACE VIEW "public"."big_orders" AS\nSELECT id,\n    total\n   FROM orders\n  WHERE total > 100::numeric;\n',
    );
    m.view.text =
      'CREATE OR REPLACE VIEW "public"."big_orders" AS\nSELECT id, total\nFROM orders WHERE total > 500;\n';
    await action(m, "applySource")();
    expect(dialogs(m).at(-1)).toMatchObject({
      op: "apply",
      run: "Apply",
      title: "Apply the source of view public.big_orders",
    });
    expect(server.ran.at(-1)).toBe(m.view.text.trim().replace(/;$/u, ""));
    // One transaction: the session that applied it began with BEGIN and ended with COMMIT.
    const applied = runs(m).find((sqls) =>
      sqls.some((x) => x.startsWith("CREATE OR REPLACE VIEW")),
    );
    expect([applied?.[0], applied?.at(-1)]).toEqual(["BEGIN", "COMMIT"]);
    expect(m.view.said.at(-1)).toBe("Applied the source of view public.big_orders.");

    m.view.text =
      'CREATE OR REPLACE VIEW "public"."big_orders" AS\nSELECT id, total\nFORM orders;\n';
    await action(m, "applySource")();
    expect(m.view.said.at(-1)).toBe('Not applied: syntax error at or near "FORM" (line 3)');
    const from = m.view.text.indexOf("FORM");
    expect(selected.at(-1)).toEqual([from, m.view.text.indexOf("\n", from)]);

    await open(m, "Routines");
    await action(m, "editSource")(row(m, "touch()") as Node);
    expect(m.view.text).toMatch(/^CREATE OR REPLACE FUNCTION public\.touch\(\)/u);
    expect(m.shown()?.name).toMatch(/source · function public\.touch\(\)/u);
    await open(m, "Tables", "people", "Triggers");
    await action(m, "editSource")(row(m, "people_touch", "part") as Node);
    expect(m.shown()?.name).toMatch(/source · function public\.touch\(\)/u);
    expect(m.view.said.at(-1)).toMatch(/is open here with its edits/u);

    await open(m, "sales", "Materialized views", "daily");
    await action(m, "editSource")(row(m, "daily") as Node);
    await action(m, "applySource")();
    expect(server.ran.slice(-2)).toEqual([
      'DROP MATERIALIZED VIEW "sales"."daily"',
      expect.stringMatching(/^CREATE MATERIALIZED VIEW "sales"\."daily" AS/u),
    ]);
    expect(dialogs(m).at(-1)?.notes).toContain("Its grants are not kept: grant them again after.");
  });
});
