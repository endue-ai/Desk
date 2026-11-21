// The table form through the plugin (PG-51, ui/features/table-design/): opened from the explorer's
// row menu (a table's first entry, a schema's New table) and from the palette, filled by an agent's
// create-table without running anything, the script run in one transaction (BEGIN, the steps,
// COMMIT) with CONCURRENTLY after it, a dry run rolled back, the guards of ADR 0312 (a read-only
// connection reads and gets no Run, a production one asked with its tag, a dropped column asked as
// dangerous), a failing step named, the explorer read again, and the script opened in a console;
// over the scripted shop (pg-catalog.ts, table-design-fixture.ts).
import { describe, expect, it } from "vitest";
import plugin from "../plugin.json";
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import type { DesignState } from "../ui/features/table-design/controller.js";
import { addColumn, addPart, dropColumn, setColumn } from "../ui/features/table-design/edits.js";
import type { Design } from "../ui/features/table-design/model.js";
import { fixtureScript } from "./fixtures";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, type PgCatalog, shop } from "./pg-catalog";
import { column, tableDesignServer } from "./table-design-fixture";

const [NOTES, SHOP] = SAVED as [Connection, Connection];
const DEV: Connection = { ...SHOP, id: "c-dev", name: "Dev", tag: "none" };
const LOCKED: Connection = { ...SHOP, id: "c-locked", name: "Locked", tag: "none", readOnly: true };
type Asked = { title: string; items: Array<{ id: string; label: string; detail?: string }> };

/** The plugin over the shop; `state.fail` makes the server refuse a statement that matches it. */
async function mounted() {
  const model: PgCatalog = shop();
  const state = {
    menu: "",
    confirm: "yes",
    fail: /^$/u,
    asked: [] as Asked[],
    /** The next palette questions' answers, in order, before `menu`. */
    answers: [] as string[],
  };
  const server = tableDesignServer(catalogScript(() => model, fixtureScript));
  const m = await mount({
    store: { connections: [DEV, SHOP, LOCKED, NOTES] },
    script: (sql, env) => {
      const text = sql.trim();
      if (env.database && state.fail.test(text))
        return { error: 'column "note" of relation "people" contains null values', code: "23502" };
      if (/ALTER TABLE "public"\."people" RENAME TO "persons"$/u.test(text)) {
        const people = model.public?.tables?.find((t) => t.name === "people");
        if (people) people.name = "persons";
        (model.public as { mark: string }).mark = "10.4:400";
      }
      if (/CREATE TABLE "public"\."events"/u.test(text))
        server.tables["public.events"] = {
          table: ["16500", "r", "app", "", "", "false"],
          columns: [column(1, "id", "bigint", { notNull: true, identity: "a" })],
          constraints: [],
          indexes: [],
        };
      return server.script(sql, env);
    },
    pick: (asked: Asked) => {
      if (!asked.title.startsWith("Run ")) return state.answers.shift() ?? state.menu;
      state.asked.push(asked);
      return state.confirm;
    },
  });
  return { m, server, model, state };
}

const row = (m: Mounted, label: string, kind?: string) =>
  m.view.trees.at(-1)?.find((r) => r.label === label && (!kind || r.kind === kind));
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 80 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}
async function open(m: Mounted, ...labels: string[]) {
  let last: Node | undefined;
  for (const label of labels) {
    await until(m, () => row(m, label));
    last = row(m, label) as Node;
    m.app.toggle(last, true);
    await m.settle();
  }
  return last as Node;
}
const act = (m: Mounted, name: string) => {
  const fn = (m.app as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`no action ${name}`);
  return fn as (...args: unknown[]) => Promise<unknown>;
};
const form = (m: Mounted) =>
  m.shown() as unknown as { id: string; name: string; tableDesign: DesignState };
const design = (m: Mounted) => form(m).tableDesign.design as Design;
const edit = (m: Mounted, next: Design) => act(m, "tableDesignEdit")(form(m).id, { design: next });
/** The statements of the last PostgreSQL sessions that ran DDL or a transaction's own words. */
const written = (m: Mounted) =>
  m
    .sessions()
    .flat()
    .filter((sql) =>
      /^(BEGIN|COMMIT|ROLLBACK)$|^(--[^\n]*\n)*(ALTER|CREATE|COMMENT|DROP)\b/u.test(sql),
    );

describe("the table form", () => {
  it("opens from a table's and a schema's menu and from the palette, PostgreSQL only", async () => {
    const { m, state } = await mounted();
    const orders = await open(m, "Dev", "public", "Tables", "orders");
    state.menu = "change-table";
    await act(m, "objectMenu")(orders);
    expect(m.picks.at(-1)?.items[0]).toEqual({
      id: "change-table",
      label: "Change the table's design…",
    });
    expect(form(m).name).toBe("table: Dev · public.orders");
    expect(design(m).columns.map((c) => c.name)).toEqual(["id", "person", "total"]);
    expect(form(m).tableDesign).toMatchObject({ mode: "change", reading: false, error: "" });
    expect(m.view.said.at(-1)).toBe(
      "public.orders on Dev: change its design, the script shows what runs.",
    );

    state.menu = "create-table";
    await act(m, "objectMenu")(row(m, "public", "schema") as Node);
    expect(m.picks.at(-1)?.items[0]).toEqual({ id: "create-table", label: "New table…" });
    expect(form(m)).toMatchObject({ name: "table: Dev · new table in public" });
    expect(form(m).tableDesign).toMatchObject({
      mode: "create",
      design: { schema: "public", columns: [] },
    });

    state.menu = "";
    state.answers = ["c-dev", "public", "people"];
    const before = m.picks.length;
    await m.host.command("endue.database.change-table");
    expect(m.picks.slice(before).map((p) => p.title)).toEqual([
      "Database: which connection?",
      "Database: in which schema?",
      "Database: which table of public?",
    ]);
    expect(form(m).name).toBe("table: Dev · public.people");

    await expect(
      m.host.command("endue.database.create-table", { connection: "Notes", schema: "main" }),
    ).rejects.toThrow("The table form is PostgreSQL's");
    await expect(
      m.host.command("endue.database.change-table", {
        connection: "Dev",
        schema: "public",
        name: "big_orders",
      }),
    ).rejects.toThrow("public.big_orders is not a table: the form changes tables.");
  });

  it("is filled by an agent's create-table, runs nothing, and creates the table when the person runs it", async () => {
    const { m, server } = await mounted();
    const answer = await m.host.command("endue.database.create-table", {
      connection: "Dev",
      schema: "public",
      name: "events",
      columns: [
        { name: "id", type: "int8", identity: "always" },
        { name: "kind", type: "varchar(20)", notNull: true, default: "'click'" },
      ],
      primaryKey: ["id"],
      comment: "What happened",
    });
    expect(answer).toMatchObject({
      table: "a new table in public",
      run: "The person reads the script in the form and runs it there.",
    });
    const script = (answer as { script: string }).script;
    expect(script).toContain(
      'CREATE TABLE "public"."events" (\n    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,\n    "kind" character varying(20) DEFAULT \'click\' NOT NULL,\n    PRIMARY KEY ("id")\n);',
    );
    expect(server.ran).toEqual([]);
    // An agent fills the form; only the person runs it (ADR 0312).
    const ours = plugin.contributes.commands.filter((c) =>
      /^endue\.database\.(create-table|change-table|table-design-)/u.test(c.id),
    );
    expect(ours.filter((c) => (c as { agent?: boolean }).agent).map((c) => c.id)).toEqual([
      "endue.database.create-table",
      "endue.database.change-table",
    ]);

    await act(m, "tableDesignRun")(form(m).id);
    expect(written(m)).toEqual([
      "BEGIN",
      'CREATE TABLE "public"."events" (\n    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,\n    "kind" character varying(20) DEFAULT \'click\' NOT NULL,\n    PRIMARY KEY ("id")\n)',
      `COMMENT ON TABLE "public"."events" IS 'What happened'`,
      "COMMIT",
    ]);
    expect(m.view.said).toContain("Created public.events.");
    // The new table's own form opens, read from the server.
    expect(form(m).name).toBe("table: Dev · public.events");
    expect(design(m).columns.map((c) => c.name)).toEqual(["id"]);
  });

  it("runs a change in one transaction, CONCURRENTLY after it, and a dry run rolls back", async () => {
    const { m, state } = await mounted();
    await m.host.command("endue.database.change-table", {
      connection: "Dev",
      schema: "public",
      name: "people",
    });
    let next = setColumn(design(m), "c2", { name: "full_name" });
    next = addColumn(next, { name: "note", type: "text" }).design;
    next = addPart(next, "indexes", {
      name: "people_joined",
      keys: [{ column: "c3", expression: "" }],
      concurrently: true,
    }).design;
    await edit(m, next);
    const answer = await act(m, "tableDesignDryRun")(form(m).id);
    expect(answer).toMatchObject({ ok: true });
    expect(form(m).tableDesign.run).toMatchObject({
      status: "done",
      dry: true,
      message:
        "The dry run went through and rolled back: 2 steps would apply. The CONCURRENTLY indexes are not part of a dry run.",
    });
    expect(written(m)).toEqual([
      "BEGIN",
      'ALTER TABLE "public"."people" RENAME COLUMN "name" TO "full_name"',
      'ALTER TABLE "public"."people" ADD COLUMN "note" text',
      "ROLLBACK",
    ]);
    expect(state.asked).toEqual([]);

    const sessions = m.sessions().length;
    await act(m, "tableDesignRun")(form(m).id);
    const ran = m
      .sessions()
      .slice(sessions)
      .flat()
      .filter((s) => !s.startsWith("SELECT"));
    expect(ran).toEqual([
      "BEGIN",
      'ALTER TABLE "public"."people" RENAME COLUMN "name" TO "full_name"',
      'ALTER TABLE "public"."people" ADD COLUMN "note" text',
      "COMMIT",
      '-- CONCURRENTLY: runs after the transaction, on its own, while writes go on; if it fails, an invalid index is left to drop.\nCREATE INDEX CONCURRENTLY "people_joined" ON "public"."people" USING "btree" ("joined")',
    ]);
    // BEGIN ... COMMIT on one session; the CONCURRENTLY index on a session of its own after it.
    const own = m
      .sessions()
      .slice(sessions)
      .map((s) => s.filter((x) => !x.startsWith("SELECT")));
    expect(own.find((s) => s.includes("BEGIN"))).toEqual(ran.slice(0, 4));
    expect(own.find((s) => s.some((x) => x.includes("CONCURRENTLY")))).not.toContain("BEGIN");
    expect(m.view.said).toContain("Changed public.people.");
    // Read again: the server's design (the fixture's, as it was) replaces the edits.
    expect(form(m).tableDesign.run).toMatchObject({
      status: "done",
      message: "Done: 3 steps ran.",
    });
  });

  it("guards as the object operations do: read-only, production, dangerous, a failing step", async () => {
    const { m, state, server } = await mounted();
    const locked = await m.host.command("endue.database.change-table", {
      connection: "Locked",
      schema: "public",
      name: "people",
    });
    expect(locked).toMatchObject({
      refused: "Locked is read-only: the form shows the script and runs nothing.",
    });
    await edit(m, dropColumn(design(m), "c3"));
    // The palette's run commands are refused in words; the form's buttons are not drawn.
    await expect(m.host.command("endue.database.table-design-run")).rejects.toThrow(
      "Locked is read-only",
    );
    await expect(m.host.command("endue.database.table-design-dry-run")).rejects.toThrow(
      "Locked is read-only",
    );
    await act(m, "tableDesignRun")(form(m).id);
    expect(m.view.said.at(-1)).toBe(
      "Locked is read-only: the form shows the script and runs nothing.",
    );
    expect(server.ran).toEqual([]);

    await m.host.command("endue.database.change-table", {
      connection: "Shop",
      schema: "public",
      name: "people",
    });
    await edit(m, dropColumn(design(m), "c3"));
    state.confirm = "no";
    await expect(m.host.command("endue.database.table-design-run")).rejects.toThrow("Not run.");
    expect(form(m).tableDesign.run).toBeNull();
    const reasons = (state.asked.at(-1)?.items ?? [])
      .filter((i) => i.id !== "no")
      .map((i) => i.detail ?? i.label);
    expect(reasons.join("\n")).toContain("Shop is tagged production.");
    expect(reasons.join("\n")).toContain("ALTER ... DROP removes part of it for good.");
    expect(server.ran).toEqual([]);

    // On Dev nothing is asked for steps that are not dangerous; a failing step is named.
    await m.host.command("endue.database.change-table", {
      connection: "Dev",
      schema: "public",
      name: "people",
    });
    state.confirm = "yes";
    let next = addColumn(design(m), { name: "note", type: "text", nullable: false }).design;
    next = setColumn(next, "c2", { comment: "Name" });
    await edit(m, next);
    state.fail = /ADD COLUMN "note"/u;
    const asked = state.asked.length;
    const failed = await act(m, "tableDesignRun")(form(m).id);
    expect(failed).toMatchObject({ ok: false });
    expect(state.asked).toHaveLength(asked);
    expect(form(m).tableDesign.run).toMatchObject({
      status: "failed",
      step: 0,
      message:
        'Step 1 failed: column "note" of relation "people" contains null values. Nothing was changed: the transaction rolled back.',
    });
    expect(written(m).at(-1)).toBe("ROLLBACK");
  });

  it("reads the explorer again after a change and opens the script in a console", async () => {
    const { m } = await mounted();
    await open(m, "Dev", "public", "Tables", "people");
    await m.host.command("endue.database.change-table", {
      connection: "Dev",
      schema: "public",
      name: "people",
    });
    await edit(m, { ...design(m), name: "persons" });
    const text = await act(m, "tableDesignConsole")(form(m).id);
    expect(text).toBe('BEGIN;\n\nALTER TABLE "public"."people" RENAME TO "persons";\n\nCOMMIT;\n');
    expect(m.shown()).toMatchObject({ kind: "console", name: "db: Dev · table · public.people" });
    expect(m.view.text).toBe(text);
    expect(m.view.said.at(-1)).toBe("The script is in a console: Database: run all runs it there.");

    // Opened again, the form is as it was left; run, the explorer reads what changed.
    await m.host.command("endue.database.change-table", {
      connection: "Dev",
      schema: "public",
      name: "people",
    });
    expect(design(m).name).toBe("persons");
    await act(m, "tableDesignRun")(form(m).id);
    await until(m, () => row(m, "persons"));
    expect(form(m).tableDesign.target).toEqual({ schema: "public", name: "persons" });

    await m.host.command("endue.database.create-table", { connection: "Dev", schema: "public" });
    await expect(m.host.command("endue.database.table-design-console")).resolves.toContain(
      "CREATE TABLE",
    );
  });
});
