// Database: export every row and export tables to a folder (PG-64) on the SDK's test host with a
// scripted PostgreSQL server: one read-only snapshot on a session of the export's own, the COPY of
// the statement (the server's CSV when it is the file, else its text format rewritten), a temporary
// file renamed at the end, the panel's rows and bytes, Cancel leaving nothing, a folder of gzipped
// files, and what is refused before anything runs.
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import type { JobState } from "../ui/features/export-all/jobs.js";
import { BEGIN } from "../ui/features/export-all/snapshot.js";
import { type Mounted, mount, SAVED } from "./harness";
import { PG, run } from "./session-helpers";

type Params = Record<string, unknown>;
const ITEMS = [
  ["id", "name"],
  ["1", "ada"],
  ["2", 'say "hi"'],
  ["3", null],
];
const CSV = 'id,name\n1,ada\n2,"say ""hi"""\n3,\n';
const TEXT = '1\tada\n2\tsay "hi"\n3\t\\N\n';

function server(sql: string) {
  if (sql.startsWith("START TRANSACTION")) return {};
  if (sql.startsWith("SELECT current_setting")) return { rows: [["current_setting"], ["170000"]] };
  if (/AS endue_export LIMIT 0$/u.test(sql)) return { rows: [["id", "name"]], types: [23, 25] };
  if (sql.startsWith("SELECT oid::int4"))
    return {
      rows: [
        ["oid", "format_type"],
        ["23", "integer"],
        ["25", "text"],
      ],
    };
  if (sql.startsWith("SELECT c.relname")) return { rows: [["relname"], ["items"], ["orders"]] };
  if (/^COPY \(\n.*\n\) TO STDOUT WITH \(FORMAT csv/su.test(sql))
    return { copy: { direction: "out" as const, data: CSV } };
  if (/^COPY \(\n.*\n\) TO STDOUT(?: WITH \(FORMAT text.*)?$/su.test(sql))
    return { copy: { direction: "out" as const, data: TEXT } };
  if (sql === "select * from items") return { rows: ITEMS };
  return {};
}

async function exporter(
  answers: { save?: string; folder?: string; onWrite?: (m: Mounted) => void } = {},
) {
  const files: Record<string, Buffer> = {};
  const calls: Params[] = [];
  let m: Mounted | undefined;
  m = await mount({
    store: { connections: [PG, ...SAVED.filter((c) => c.engine === "sqlite")] },
    script: server,
    handlers: {
      "dialog.save": (params) => {
        calls.push({ dialog: "save", ...params });
        return answers.save ? { cancelled: false, path: answers.save } : { cancelled: true };
      },
      "dialog.open": (params) => {
        calls.push({ dialog: "open", ...params });
        return answers.folder
          ? { cancelled: false, paths: [answers.folder] }
          : { cancelled: true, paths: [] };
      },
      "fs.write": ({ path, content, encoding, append }) => {
        calls.push({ write: path, append: append === true });
        const bytes = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
        files[path] = append ? Buffer.concat([files[path] ?? Buffer.alloc(0), bytes]) : bytes;
        if (m) answers.onWrite?.(m);
        return { bytesWritten: bytes.length };
      },
      "fs.rename": ({ from, to }) => {
        calls.push({ rename: from, to });
        if (to in files) throw new StubError("already_exists", "there");
        files[to] = files[from] as Buffer;
        delete files[from];
        return { crossedDevices: false };
      },
      "fs.trash": ({ path }) => {
        calls.push({ trash: path });
        delete files[path];
        return {};
      },
    },
  });
  await m.host.command("endue.database.console", { connection: PG.name });
  return { m, files, calls };
}

const panel = (m: Mounted) =>
  m.view.consoles
    .map((c) => c.model?.["export-all"] as JobState | undefined)
    .filter(Boolean)
    .at(-1);
const exportSession = (m: Mounted) =>
  m.sessions().find((s) => s[0]?.startsWith("START TRANSACTION")) ?? [];

describe("Database: export every row to a file", () => {
  it("export every row of a console's result", async () => {
    const { m, files, calls } = await exporter({ save: "~/Downloads/items.csv" });
    await run(m, "select * from items");
    const done = (await m.host.command("endue.database.export-all", {
      format: "csv",
      options: { lineEnding: "lf" },
    })) as { rows: number; files: { path: string; direct: boolean }[] };
    await m.settle();
    expect(done.files[0]).toMatchObject({ path: "~/Downloads/items.csv", direct: true });
    expect(files["~/Downloads/items.csv"]?.toString("utf8")).toBe(CSV);
    expect(Object.keys(files)).toEqual(["~/Downloads/items.csv"]);
    expect(calls.filter((c) => "write" in c)).toEqual([
      { write: "~/Downloads/.items.csv.partial", append: false },
    ]);
    expect(calls.find((c) => "rename" in c)).toEqual({
      rename: "~/Downloads/.items.csv.partial",
      to: "~/Downloads/items.csv",
    });
    const ran = exportSession(m);
    expect(ran[0]).toBe(BEGIN);
    expect(ran).toContain(
      "COPY (\nselect * from items\n) TO STDOUT WITH (FORMAT csv, DELIMITER ',', NULL '', HEADER)",
    );
    expect(ran.at(-1)).toBe("ROLLBACK");
    // The console's own session ran the console's statement and nothing of the export.
    expect(m.sessions().find((s) => s.includes("select * from items"))).not.toContain(BEGIN);
    expect(panel(m)).toMatchObject({
      status: "done",
      files: [{ status: "done", rows: 3, bytes: CSV.length }],
    });

    // JSON goes through the text format and the plugin's writer.
    const json = await exporter({ save: "~/Downloads/items.json" });
    await run(json.m, "select * from items");
    await json.m.host.command("endue.database.export-all", { format: "json" });
    expect(JSON.parse(json.files["~/Downloads/items.json"]?.toString("utf8") ?? "")).toEqual([
      { id: 1, name: "ada" },
      { id: 2, name: 'say "hi"' },
      { id: 3, name: null },
    ]);
    expect(exportSession(json.m)).toContain("COPY (\nselect * from items\n) TO STDOUT");
  });

  it("cancel leaves no file", async () => {
    let cancelled = false;
    const { m, files, calls } = await exporter({
      save: "~/Downloads/items.tsv",
      onWrite: (mounted) => {
        if (cancelled) return;
        cancelled = true;
        void mounted.host.command("endue.database.export-cancel");
      },
    });
    await run(m, "select * from items");
    await expect(m.host.command("endue.database.export-all", { format: "tsv" })).rejects.toThrow();
    await m.settle();
    expect(cancelled).toBe(true);
    expect(files).toEqual({});
    expect(calls.some((c) => "rename" in c)).toBe(false);
    expect(calls.filter((c) => "trash" in c)).toEqual([
      { trash: "~/Downloads/.items.tsv.partial" },
    ]);
    expect(panel(m)).toMatchObject({ status: "cancelled", files: [{ status: "cancelled" }] });
    expect(exportSession(m).at(-1)).toBe("ROLLBACK");
  });

  it("several tables to a folder, one file each, compressed when asked", async () => {
    const { m, files, calls } = await exporter({ folder: "~/Exports" });
    files["~/Exports/items.csv.gz"] = Buffer.from("kept");
    const done = (await m.host.command("endue.database.export-tables", {
      connection: PG.name,
      schema: "public",
      format: "csv",
      options: { lineEnding: "lf" },
      compress: true,
    })) as { files: { path: string }[] };
    expect(calls[0]).toMatchObject({ dialog: "open", kind: "folders" });
    expect(done.files.map((f) => f.path)).toEqual([
      "~/Exports/items-2.csv.gz",
      "~/Exports/orders.csv.gz",
    ]);
    expect(files["~/Exports/items.csv.gz"]?.toString()).toBe("kept");
    expect(gunzipSync(files["~/Exports/orders.csv.gz"] as Buffer).toString("utf8")).toBe(CSV);
    const ran = exportSession(m);
    expect(ran[0]).toBe(BEGIN);
    expect(ran.filter((s) => s.startsWith("COPY"))).toHaveLength(2);
    expect(ran.at(-1)).toBe("ROLLBACK");
  });

  it("refuses what COPY cannot run", async () => {
    const { m, calls } = await exporter({ save: "~/Downloads/x.csv" });
    await expect(
      m.host.command("endue.database.export-all", {
        connection: "Notes",
        sql: "select 1",
        format: "csv",
      }),
    ).rejects.toThrow("Exporting every row streams through PostgreSQL's COPY: Notes is SQLite.");
    await expect(
      m.host.command("endue.database.export-all", {
        sql: "with d as (delete from items returning *) select * from d",
        format: "csv",
      }),
    ).rejects.toThrow("Only a read exports every row");
    await expect(
      m.host.command("endue.database.export-all", { sql: "select 1; select 2", format: "csv" }),
    ).rejects.toThrow("Export every row takes one statement");
    expect(calls).toEqual([]);
    expect(m.sessions().some((s) => s.includes(BEGIN))).toBe(false);
  });
});
