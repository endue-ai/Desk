// Two schemas compared through the plugin (PG-53, ui/features/compare-schema/): the panel with its
// progress and Cancel, the script that never runs by itself and runs only through the guards
// (read-only, production, dangerous), a console handed the script, and a schema dumped to a folder
// and saved as a snapshot, then compared against each; over the scripted server of
// compare-schema-fixture.ts and files in memory.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { SchemaState } from "../ui/features/compare-schema/controller.js";
import { schemaCompareServer } from "./compare-schema-fixture";
import { type Mounted, mount, SAVED } from "./harness";

const [, SHOP] = SAVED as [Connection, Connection];
const DEV: Connection = { ...SHOP, id: "c-dev", name: "Dev", tag: "none" };
const LOCKED: Connection = { ...SHOP, id: "c-locked", name: "Locked", tag: "none", readOnly: true };
type Asked = { title: string; items: Array<{ id: string; label: string; detail?: string }> };

async function mounted() {
  const server = schemaCompareServer();
  const files: Record<string, string> = {};
  const state = {
    confirm: "yes",
    asked: [] as Asked[],
    folder: "/work/schema",
    snapshot: "/work/prod.schema.json",
    onRead: (_key: string) => {},
  };
  const m = await mount({
    store: { connections: [DEV, SHOP, LOCKED] },
    script: (sql, who) => {
      const key = /^\/\* schema-compare (\S+)/u.exec(sql.trim())?.[1];
      if (key) state.onRead(key);
      return server.script(sql, who);
    },
    pick: (asked: Asked) => {
      if (!asked.title.startsWith("Run ")) return "";
      state.asked.push(asked);
      return state.confirm;
    },
    handlers: {
      "dialog.open": ({ kind }) => ({
        cancelled: false,
        paths: [kind === "folders" ? state.folder : state.snapshot],
      }),
      "dialog.save": () => ({ cancelled: false, path: state.snapshot }),
      "fs.list": ({ path }) => {
        const prefix = `${path.replace(/\/+$/u, "")}/`;
        const names = new Map<string, "file" | "dir">();
        for (const p of Object.keys(files))
          if (p.startsWith(prefix)) {
            const [first, ...rest] = p.slice(prefix.length).split("/");
            names.set(first ?? "", rest.length ? "dir" : "file");
          }
        return { entries: [...names].map(([name, kind]) => ({ name, kind })) };
      },
      "fs.read": ({ path }) => ({
        content: files[path] ?? "",
        encoding: "utf8" as const,
        size: (files[path] ?? "").length,
      }),
      "fs.write": ({ path, content }) => {
        files[path] = content;
        return { bytesWritten: content.length };
      },
      "fs.trash": ({ path }) => {
        delete files[path];
        return {};
      },
    },
  });
  return { m, server, files, state };
}

const panel = (m: Mounted) => m.shown() as unknown as { id: string; schemaCompare: SchemaState };
const act = (m: Mounted, name: string) =>
  (m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name] as (
    ...args: unknown[]
  ) => Promise<unknown>;
const compare = (m: Mounted, left: object, right: object) =>
  m.host.command("endue.database.compare-schemas", { left, right }) as Promise<
    Record<string, unknown>
  >;
const drawn = (m: Mounted) =>
  m.view.consoles
    .map((c) => (c.model as unknown as { schemaCompare?: SchemaState } | null)?.schemaCompare)
    .filter((s): s is SchemaState => Boolean(s));

describe("two schemas compared in the plugin", () => {
  it("compares two schemas of a connection in a panel, with progress and Cancel", async () => {
    const { m, state } = await mounted();
    const got = await compare(
      m,
      { connection: "Dev", schema: "dev" },
      { connection: "Dev", schema: "prod" },
    );
    expect(got).toMatchObject({
      left: "Dev · dev",
      right: "Dev · prod",
      onlyLeft: 1,
      onlyRight: 0,
      differ: 4,
    });
    const s = panel(m).schemaCompare;
    expect(s).toMatchObject({ status: "done", target: "right", same: 2 });
    expect(s.chosen).toEqual(s.items.map((i) => i.key));
    expect(s.script?.text).toContain('CREATE TABLE "prod"."tags"');
    expect(
      drawn(m).some((d) => d.status === "reading" && d.progress.what.startsWith("Dev · dev")),
    ).toBe(true);
    expect(drawn(m).some((d) => d.status === "comparing")).toBe(true);

    // Cancel while the right side is read: nothing is compared.
    state.onRead = (key) => {
      if (key === "views" && panel(m).schemaCompare.progress.what.startsWith("Dev · prod"))
        void act(m, "schemaCompareCancel")(panel(m).id);
    };
    await expect(m.host.command("endue.database.schema-compare-refresh")).rejects.toThrow(
      "Not compared.",
    );
    expect(panel(m).schemaCompare).toMatchObject({
      status: "cancelled",
      items: [],
      error: "Cancelled: nothing was compared.",
    });
    await expect(m.host.command("endue.database.schema-compare-run")).rejects.toThrow(
      "Compare first",
    );
  });

  it("the script never runs by itself and runs only through the guards", async () => {
    const { m, server, state } = await mounted();
    await compare(
      m,
      { connection: "Dev", schema: "dev" },
      { connection: "Locked", schema: "prod" },
    );
    expect(server.ran).toEqual([]);
    expect(panel(m).schemaCompare.refused).toBe(
      "Locked is read-only: the panel shows the script and runs nothing.",
    );
    await expect(m.host.command("endue.database.schema-compare-run")).rejects.toThrow(
      "Locked is read-only",
    );
    expect(server.ran).toEqual([]);

    await compare(m, { connection: "Dev", schema: "dev" }, { connection: "Shop", schema: "prod" });
    state.confirm = "no";
    await expect(m.host.command("endue.database.schema-compare-run")).rejects.toThrow("Not run.");
    const reasons = (state.asked.at(-1)?.items ?? []).map((i) => i.detail ?? i.label).join("\n");
    expect(reasons).toContain("Shop is tagged production.");
    expect(server.ran).toEqual([]);
    expect(panel(m).schemaCompare.run).toBeNull();

    // Prod made like dev on Dev: nothing dangerous is asked, one transaction runs.
    await compare(m, { connection: "Dev", schema: "dev" }, { connection: "Dev", schema: "prod" });
    state.confirm = "yes";
    const asked = state.asked.length;
    const done = (await m.host.command("endue.database.schema-compare-dry-run")) as {
      ok: boolean;
      message: string;
    };
    expect(done).toMatchObject({
      ok: true,
      message: expect.stringContaining("The dry run went through and rolled back"),
    });
    expect(state.asked).toHaveLength(asked);
    const ran = m.sessions().at(-1) ?? [];
    expect(ran[0]).toBe("BEGIN");
    expect(ran.at(-1)).toBe("ROLLBACK");
    expect(ran).toContain('SET LOCAL search_path TO "prod", "public"');

    // The other way, dev made like prod: dropping a table and a column is asked as dangerous.
    await act(m, "schemaCompareDirection")(panel(m).id);
    expect(panel(m).schemaCompare.script?.text).toContain('DROP TABLE "dev"."tags"');
    // An enum's value cannot go: the script holds, and Run waits until the type is left out.
    expect(panel(m).schemaCompare.refused).toContain("Type dev.mood loses glad");
    await expect(m.host.command("endue.database.schema-compare-run")).rejects.toThrow("loses glad");
    await act(m, "schemaCompareChoose")(panel(m).id, ["type mood"], false);
    expect(panel(m).schemaCompare.refused).toBe("");
    state.confirm = "no";
    await expect(m.host.command("endue.database.schema-compare-run")).rejects.toThrow("Not run.");
    const dangerous = (state.asked.at(-1)?.items ?? []).map((i) => i.detail ?? i.label).join("\n");
    expect(dangerous).toMatch(/DROP/u);

    // Only the chosen objects: the table left out, its drop is not in the script.
    await act(m, "schemaCompareChoose")(panel(m).id, ["table tags"], false);
    const script = panel(m).schemaCompare.script?.text ?? "";
    expect(script).not.toContain("tags");
    const text = (await m.host.command("endue.database.schema-compare-console")) as string;
    expect(text).toBe(script);
    expect(script).not.toContain("SET DEFAULT");
    expect(m.view.said.at(-1)).toBe("The script is in a console: Database: run all runs it there.");
  });

  it("dumps a schema to a folder and saves a snapshot, then compares against them", async () => {
    const { m, files, state } = await mounted();
    files["/work/schema/tables/stale.sql"] = "CREATE TABLE stale (id int);\n";
    files["/work/schema/notes.sql"] = "-- kept: not a kind's folder\n";
    const dumped = (await m.host.command("endue.database.dump-schema", {
      connection: "Dev",
      schema: "prod",
    })) as { files: string[]; trashed: string[] };
    expect(dumped.files).toEqual([
      "functions/total_of(integer).sql",
      "sequences/people_id_seq.sql",
      "tables/orders.sql",
      "tables/people.sql",
      "types/mood.sql",
      "views/big_orders.sql",
    ]);
    expect(dumped.trashed).toEqual(["tables/stale.sql"]);
    expect(Object.keys(files).sort()).toEqual([
      "/work/schema/functions/total_of(integer).sql",
      "/work/schema/notes.sql",
      "/work/schema/sequences/people_id_seq.sql",
      "/work/schema/tables/orders.sql",
      "/work/schema/tables/people.sql",
      "/work/schema/types/mood.sql",
      "/work/schema/views/big_orders.sql",
    ]);
    delete files["/work/schema/notes.sql"];
    const saved = (await m.host.command("endue.database.save-schema-snapshot", {
      connection: "Dev",
      schema: "prod",
    })) as { path: string };
    expect(saved).toEqual({ path: state.snapshot, objects: 6 });
    expect(JSON.parse(files[state.snapshot] ?? "{}")).toMatchObject({
      format: "endue.database.schema",
      version: 1,
      schema: "prod",
      from: "Dev",
    });

    // prod against its folder and its snapshot: the same; dev against the folder differs.
    expect(
      await compare(m, { connection: "Dev", schema: "prod" }, { folder: state.folder }),
    ).toMatchObject({ onlyLeft: 0, onlyRight: 0, differ: 0 });
    expect(
      await compare(m, { snapshot: state.snapshot }, { connection: "Dev", schema: "prod" }),
    ).toMatchObject({ differ: 0, onlyLeft: 0 });
    const dev = await compare(m, { connection: "Dev", schema: "dev" }, { folder: state.folder });
    expect(dev).toMatchObject({ onlyLeft: 1, differ: 4 });
    expect(panel(m).schemaCompare.target).toBe("left");
    expect(panel(m).schemaCompare.refused).toContain("Type dev.mood loses glad");
    await act(m, "schemaCompareDirection")(panel(m).id);
    expect(panel(m).schemaCompare.refused).toBe(
      "schema (folder) is not a connection's schema: open the script in a console to keep it.",
    );
  });
});
