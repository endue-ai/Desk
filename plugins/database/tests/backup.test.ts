// Backup and restore through the plugin's commands on the SDK's test host (PG-62, ADR 0313), with
// the scripted pg_dump and pg_restore of backup-fixture.ts: the programs found and checked against
// the server, the forms, the dialogs and the grants, the programs' argument lists and environment,
// the log panel as the lines come, Cancel, and the restore's guards.
import { describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import type { Connection } from "../ui/engines/common.js";
import type { LogState } from "../ui/features/backup/job.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { asked, held, type Seen, start, WAREHOUSE } from "./backup-harness";

const log = (state: unknown) => state as { backup: LogState };
const runs = (m: { clients: { spawned: Seen[] } }, name: string) =>
  m.clients.spawned.filter((s) => s.command.endsWith(name) && s.args[0] !== "--version");

describe("finding the programs", () => {
  it("finds pg_dump by name, by its setting, on the path setting, and says how to install it when missing", async () => {
    const asked: Array<{ command: string; path?: string }> = [];
    const bridge = {
      onEvent: (listener: (event: unknown) => void) => {
        bridge.emit = listener;
        return () => {};
      },
      emit: (_event: unknown) => {},
      call: async (method: string, params: { command: string; env?: Record<string, string> }) => {
        if (method !== "proc.spawn") return {};
        asked.push({
          command: params.command,
          ...(params.env?.PATH ? { path: params.env.PATH } : {}),
        });
        if (!params.env?.PATH && params.command === "pg_dump")
          throw Object.assign(new Error("no"), { code: "not_found" });
        if (params.command === "pg_restore")
          throw Object.assign(new Error("no"), { code: "not_found" });
        const procId = `p-${asked.length}`;
        setTimeout(() => {
          const data = {
            procId,
            stream: "stdout",
            data: "pg_dump (PostgreSQL) 18.1\n",
            encoding: "utf8",
          };
          bridge.emit({ event: "proc.output", data });
          bridge.emit({ event: "proc.exit", data: { procId, code: 0 } });
        }, 0);
        return { procId };
      },
    };
    let settings = fromValues({ "endue.database.path": ["/opt/pg/bin"] });
    const runner = createRunner(bridge as never, { searchPath: () => "/opt/pg/bin:/usr/bin" });
    const clients = createClients(runner, () => settings);
    expect(await clients.program("pg_dump")).toEqual({
      command: "pg_dump",
      flavor: "postgresql",
      version: "18.1",
    });
    expect(asked).toEqual([
      { command: "pg_dump" },
      { command: "pg_dump", path: "/opt/pg/bin:/usr/bin" },
    ]);
    await expect(clients.program("pg_restore")).rejects.toThrow(
      "pg_restore was not found. Install it, or set its path in the settings. Install pg_restore: brew install libpq, or apt install postgresql-client.",
    );
    settings = fromValues({ "endue.database.pg-dump": "/usr/lib/postgresql/18/bin/pg_dump" });
    clients.reset();
    expect((await clients.program("pg_dump")).command).toBe("/usr/lib/postgresql/18/bin/pg_dump");

    // Through the plugin: the setting names the program pg_dump runs as.
    const { m } = await start({ settings: { "pg-dump": "/opt/pg/bin/pg_dump" } });
    await m.host.command("endue.database.backup", { connection: "warehouse" });
    expect(runs(m, "pg_dump")[0]?.command).toBe("/opt/pg/bin/pg_dump");
  });

  it("refuses a pg_dump older than the server's major version with a plain sentence before anything runs", async () => {
    const { m } = await start({ server: "180001" });
    await expect(
      m.host.command("endue.database.backup", { connection: "warehouse" }),
    ).rejects.toThrow(
      "pg_dump 17.6 is older than warehouse's server (PostgreSQL 18): pg_dump 18 or newer is needed. Install it, or name it in the setting endue.database.pg-dump.",
    );
    expect(m.view.dialogs).toEqual([]);
    expect(runs(m, "pg_dump")).toEqual([]);
  });
});

describe("backing up", () => {
  it("backs up: the form, the save dialog, the grant asked with perm.request, pg_dump spawned with its argument list and the connection in PG* variables, the typed password only in the spawned process's environment", async () => {
    const { m, calls } = await start({ password: "pw-4821" });
    const running = m.host.command("endue.database.backup", { connection: "warehouse" });
    await m.settle();
    m.app.password("pw-4821");
    await running;
    const [form] = m.view.dialogs;
    expect(form?.type).toBe("backup");
    expect(form?.model).toMatchObject({
      connection: "warehouse",
      database: "warehouse",
      server: "PostgreSQL 17",
      program: { command: "pg_dump", version: "17.6" },
      schemas: ["public", "sales"],
      path: "",
      options: { format: "custom", scope: "database" },
    });
    expect(JSON.stringify(form?.model)).not.toContain("pw-4821");
    const save = calls.find((c) => c.method === "dialog.save");
    expect(save?.params).toMatchObject({
      suggestedName: expect.stringMatching(/^warehouse-\d{4}-\d\d-\d\d-\d{4}\.dump$/u),
    });
    const [path] = asked(m, "fs:write");
    expect(path?.permission).toEqual({
      permission: "fs:write",
      paths: [expect.stringMatching(/^~\/Backups\/warehouse-/u)],
    });
    const [dump] = runs(m, "pg_dump");
    expect(dump?.args).toEqual([
      "--format=custom",
      "--verbose",
      "--no-password",
      '--schema="sales"',
      "--strict-names",
      "--no-owner",
      expect.stringMatching(/^--file=\.\/Backups\/warehouse-.*\.dump$/u),
    ]);
    expect(dump?.env).toMatchObject({
      PGHOST: "db.example",
      PGDATABASE: "warehouse",
      PGUSER: "app",
      PGPASSWORD: "pw-4821",
    });
    expect(dump?.args.join(" ")).not.toContain("pw-4821");
    const state = log(m.shown()).backup;
    expect(state.command).not.toContain("pw-4821");
    expect(state.command).toContain("PGHOST=db.example");
    expect(state.password).toBe(
      "The password typed this session goes in PGPASSWORD of the program's environment only.",
    );
    expect(state.status).toBe("done");
    expect(state.result).toMatch(
      /^Wrote the file ~\/Backups\/warehouse-.*\.dump \(47 KiB\) in \d+\.\d s, with 1 table's rows\.$/u,
    );
    expect(m.view.said.at(-1)).toBe(state.result);
  });

  it("the log panel shows the verbose lines as they come and ends with what was written and its size", async () => {
    const programs = held();
    const { m } = await start({ handlers: programs.handlers, format: "directory" });
    programs.attach(m);
    const running = m.host.command("endue.database.backup", { connection: "warehouse" });
    const proc = await programs.next();
    programs.say(proc, "pg_dump: reading schemas\npg_dump: dumping contents of ");
    await programs.wait();
    expect(log(m.shown()).backup).toMatchObject({
      status: "running",
      lines: ["pg_dump: reading schemas"],
      done: 0,
    });
    programs.say(proc, 'table "public.orders"\n');
    await programs.wait();
    expect(log(m.shown()).backup).toMatchObject({
      done: 1,
      lines: ["pg_dump: reading schemas", 'pg_dump: dumping contents of table "public.orders"'],
    });
    // Two parallel jobs writing at once, as pg_dump 18 was seen to: one's pieces land in the
    // other's line; both are counted.
    programs.say(
      proc,
      'pg_dump:pg_dump: dumping contents of table "public.customers"\n dumping contents of table "sales.items"\n',
    );
    programs.exit(proc, 0);
    await running;
    expect(log(m.shown()).backup.done).toBe(3);
    expect(log(m.shown()).backup.result).toMatch(
      /^Wrote the folder ~\/Backups\/warehouse-[\d-]+ \(1\.5 MiB\) in .*, with 3 tables' rows\.$/u,
    );
  });

  it("Cancel stops the program (SIGINT, then SIGKILL)", async () => {
    const programs = held({ endOn: "kill" });
    const { m } = await start({ handlers: programs.handlers });
    programs.attach(m);
    const running = m.host.command("endue.database.backup", { connection: "warehouse" });
    await programs.next();
    const id = m.shown()?.id as string;
    await (m.app as unknown as Record<string, (id: string) => unknown>).backupCancel?.(id);
    await programs.wait();
    expect(programs.signals).toEqual(["int"]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await running;
    expect(programs.signals).toEqual(["int", "kill"]);
    expect(log(m.shown()).backup).toMatchObject({ status: "cancelled" });
    expect(log(m.shown()).backup.result).toMatch(
      /^Cancelled: what pg_dump wrote so far stays in ~\/Backups\/.*; it is not a whole backup\.$/u,
    );
    await expect(m.host.command("endue.database.backup-cancel", {})).rejects.toThrow(
      "No backup or restore is running.",
    );
  });
});

describe("restoring", () => {
  it("restores: the archive's entries listed, the chosen ones passed as a list file", async () => {
    const { m, calls } = await start({
      restore: {
        connection: "c-wh",
        options: { clean: true, ifExists: true },
        chosen: [218, 3432],
      },
    });
    await m.host.command("endue.database.restore", { path: "~/Backups/warehouse.dump" });
    expect(asked(m, "fs:read")[0]).toMatchObject({
      permission: { permission: "fs:read", paths: ["~/Backups/warehouse.dump"] },
    });
    expect(runs(m, "pg_restore")[0]?.args).toEqual(["--list", "./Backups/warehouse.dump"]);
    const model = m.view.dialogs[0]?.model as {
      format: string;
      entries: unknown[];
      database: string;
      connections: Connection[];
    };
    expect(model).toMatchObject({
      format: "custom",
      database: "warehouse",
      by: "17.6",
      from: "17.6",
    });
    expect(model.entries).toHaveLength(9);
    expect(model.connections.map((c) => c.name)).toEqual(["warehouse", "Shop", "locked"]);
    const written = calls.find((c) => c.method === "fs.write")?.params as {
      path: string;
      content: string;
    };
    expect(written.path).toBe("~/.endue/database/restore/c-wh.list");
    expect(written.content.split("\n").slice(1, 3)).toEqual([
      "218; 1259 16384 TABLE public orders app",
      "3432; 0 16384 TABLE DATA public orders app",
    ]);
    expect(runs(m, "pg_restore")[1]?.args).toEqual([
      "--verbose",
      "--no-password",
      "--dbname=warehouse",
      "--clean",
      "--if-exists",
      "--use-list=./.endue/database/restore/c-wh.list",
      "./Backups/warehouse.dump",
    ]);
    expect(log(m.shown()).backup).toMatchObject({
      status: "done",
      done: 2,
      total: 2,
      noun: "entries",
    });
    expect(log(m.shown()).backup.result).toMatch(
      /^Restored warehouse\.dump into warehouse in .* s: 2 entries\.$/u,
    );
  });

  it("a restore is refused on a read-only connection", async () => {
    const { m } = await start({ restore: { connection: "c-ro" } });
    await expect(
      m.host.command("endue.database.restore", { path: "~/Backups/warehouse.dump" }),
    ).rejects.toThrow("locked is read-only: nothing is restored into it.");
    expect(runs(m, "pg_restore").map((r) => r.args[0])).toEqual(["--list"]);
  });

  it("a restore on production is asked first, the environment named", async () => {
    const { m } = await start({
      restore: { connection: "c-prod", options: { clean: true } },
      pick: () => "no",
    });
    await expect(
      m.host.command("endue.database.restore", { path: "~/Backups/warehouse.dump" }),
    ).rejects.toThrow("Not restored.");
    const asked = m.picks.at(-1);
    expect(asked?.title).toBe("Restore warehouse.dump into Shop?");
    const items = asked?.items as Array<{ label: string; detail?: string }> | undefined;
    expect(items?.map((i) => i.detail ?? i.label)).toEqual([
      "Shop is tagged production.",
      "Into the database shop on db.example.",
      "Clean drops each object in the dump before making it again.",
      "No",
    ]);
    expect(runs(m, "pg_restore").map((r) => r.args[0])).toEqual(["--list"]);
  });

  it("an agent's request opens the form and runs nothing until the person submits it", async () => {
    const { m } = await start({ restore: undefined, backup: undefined });
    const asked = {
      path: "~/Backups/warehouse.dump",
      connection: "warehouse",
      clean: true,
      jobs: 2,
    };
    await expect(m.host.command("endue.database.restore", asked)).rejects.toThrow("Not restored.");
    await expect(
      m.host.command("endue.database.backup", {
        connection: "warehouse",
        format: "plain",
        path: "~/Backups/w.sql",
      }),
    ).rejects.toThrow("Not backed up.");
    expect(m.view.dialogs.map((d) => d.type)).toEqual(["restore", "backup"]);
    expect(m.view.dialogs[0]?.model).toMatchObject({
      connection: "c-wh",
      options: { clean: true, jobs: 2 },
    });
    expect(m.view.dialogs[1]?.model).toMatchObject({
      path: "~/Backups/w.sql",
      options: { format: "plain", inserts: true },
    });
    expect(runs(m, "pg_restore").map((r) => r.args[0])).toEqual(["--list"]);
    expect(runs(m, "pg_dump")).toEqual([]);
  });

  it("a plain SQL file is restored as a script through run-file", async () => {
    const { m } = await start({ restore: { connection: "c-wh" } });
    const said = await m.host.command("endue.database.restore", {
      path: "~/Backups/plain-warehouse.dump",
    });
    expect(m.view.dialogs[0]?.model).toMatchObject({ format: "plain", entries: [] });
    expect(said).toMatch(/^plain-warehouse\.dump: done, 2 statements in /u);
    const ran = m.sessions().flat();
    expect(ran.some((sql) => sql.includes("INSERT INTO public.orders VALUES (1, 'a')"))).toBe(true);
    expect(ran.join("\n")).not.toContain("\\restrict");
    // A .sql file is a script without asking pg_restore.
    await m.host.command("endue.database.restore", { path: "~/Backups/w.sql" });
    expect(runs(m, "pg_restore").map((r) => r.args.at(-1))).toEqual([
      "./Backups/plain-warehouse.dump",
    ]);
    expect(WAREHOUSE.readOnly).toBe(false);
  });
});
