// The import wizard on a PostgreSQL connection (PG-60), on the SDK's test host with a scripted
// server: a dropped CSV opens with its first bytes only, a new table's columns and types inferred
// from them, and Import runs BEGIN, CREATE TABLE, COPY ... FROM STDIN and COMMIT on a session of
// its own that closes after; the options read the file again; a read-only connection refuses, a
// production one asks once; the server's check copies the first rows into a temporary table and
// rolls back; a SQLite connection keeps the INSERT import.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { ImportModel } from "../ui/importer.js";
import { mount, type Script } from "./harness";
import { closed, made, PG, ranOn } from "./session-helpers";

/** The scripted server: a COPY ... FROM STDIN waits for its rows, as the server's does. */
const COPYING: Script = (sql) =>
  /^COPY/u.test(sql) ? { copy: { direction: "in", columns: 4 } } : {};

const SALES =
  "Order ID,Name,Price,Day\n1,Ann,9.50,2026-11-23\n2,Bo,10,2026-11-24\n3,Cy,,2026-11-25\n";

/** A host whose files answer ranged reads as base64, keeping each read's length. */
async function wizard(
  options: {
    conn?: Connection;
    script?: Script;
    files?: Record<string, string>;
    confirm?: boolean;
  } = {},
) {
  const files: Record<string, string> = { "~/data/sales.csv": SALES, ...options.files };
  const reads: number[] = [];
  const asked: string[] = [];
  const m = await mount({
    store: { connections: [options.conn ?? PG] },
    script: options.script ?? COPYING,
    pick: ({ title }) => {
      asked.push(title);
      return options.confirm === false ? "no" : "yes";
    },
    handlers: {
      "fs.read": ({ path, offset = 0, length, encoding }) => {
        const bytes = new TextEncoder().encode(files[path] ?? "");
        const part = bytes.subarray(offset, length === undefined ? undefined : offset + length);
        reads.push(part.length);
        if (encoding !== "base64")
          return { content: new TextDecoder().decode(part), encoding: "utf8", size: bytes.length };
        return {
          content: btoa(String.fromCharCode(...part)),
          encoding: "base64",
          size: bytes.length,
        };
      },
    },
  });
  await m.app.drop({ kind: "file", path: "~/data/sales.csv" }, undefined);
  await m.settle();
  const latest = () => m.view.imports.at(-1) as ImportModel | null;
  return { m, latest, reads, asked };
}

const ranAll = (m: Awaited<ReturnType<typeof wizard>>["m"]) =>
  made(m, "db.run").map((p) => String(p.sql));
/** What the session that ran BEGIN ran, from BEGIN on. */
const ranByImport = (m: Awaited<ReturnType<typeof wizard>>["m"]) => {
  const session = made(m, "db.run").find((p) => p.sql === "BEGIN")?.sessionId as string;
  const ran = ranOn(m, session).map(String);
  return ran.slice(ran.indexOf("BEGIN"));
};

describe("the import wizard on PostgreSQL", () => {
  it("opens on the file's first bytes, into a new table whose columns are inferred", async () => {
    const { latest, reads } = await wizard();
    expect(reads.every((n) => n <= 1024 * 1024)).toBe(true);
    expect(latest()).toMatchObject({
      fileColumns: ["Order ID", "Name", "Price", "Day"],
      problem: "",
      copy: {
        target: "new",
        newTable: "sales",
        newColumns: [
          { name: "order_id", type: "integer" },
          { name: "name", type: "text" },
          { name: "price", type: "numeric" },
          { name: "day", type: "date" },
        ],
        onError: "stop",
        batch: 0,
      },
    });
    expect(latest()?.sql).toBe(
      'CREATE TABLE "public"."sales" (\n  "order_id" integer,\n  "name" text,\n  "price" numeric,\n  "day" date\n);\nCOPY "public"."sales" ("order_id", "name", "price", "day") FROM STDIN',
    );
  });

  it("imports by COPY in one transaction on a session of its own, closed after", async () => {
    const { m } = await wizard();
    m.app.importChange({ column: [1, { name: "" }] });
    m.app.importChange({ column: [0, { type: "bigint" }] });
    await m.settle();
    await m.app.importRun();
    await m.settle();
    expect(ranByImport(m)).toEqual([
      "BEGIN",
      'CREATE TABLE "public"."sales" (\n  "order_id" bigint,\n  "price" numeric,\n  "day" date\n)',
      'COPY "public"."sales" ("order_id", "price", "day") FROM STDIN',
      "COMMIT",
    ]);
    const sent = made(m, "db.copy")
      .map((p) => String(p.data ?? ""))
      .join("");
    expect(sent).toBe("1\t9.50\t2026-11-23\n2\t10\t2026-11-24\n3\t\\N\t2026-11-25\n");
    expect(m.view.said.at(-1)).toBe("Imported 3 rows into sales by COPY in one transaction.");
    expect(m.view.imports.at(-1)).toBeNull();
    const session = made(m, "db.run").find((p) => p.sql === "BEGIN")?.sessionId;
    expect(closed(m)).toContain(session);
  });

  it("reads the file again with other options, and sets the date order and batches", async () => {
    const { m, latest } = await wizard({ files: { "~/data/sales.csv": "x;y\n1;23/11/2026\n" } });
    m.app.importChange({ options: { delimiter: ";", dateOrder: "DMY" } });
    m.app.importChange({ batch: 1000 });
    await m.settle();
    expect(latest()).toMatchObject({
      fileColumns: ["x", "y"],
      copy: {
        newColumns: [
          { name: "x", type: "integer" },
          { name: "y", type: "date" },
        ],
        batch: 1000,
      },
    });
    await m.app.importRun();
    await m.settle();
    expect(ranAll(m)).toContain("SET LOCAL DateStyle = 'ISO, DMY'");
    expect(m.view.said.at(-1)).toBe("Imported 1 row into sales by COPY in 1 batches.");
  });

  it("refuses on a read-only connection and asks once on a production one", async () => {
    const ro = await wizard({ conn: { ...PG, readOnly: true } });
    await ro.m.app.importRun();
    await ro.m.settle();
    expect(ro.latest()?.problem).toBe("Shop is read-only: an import changes it.");
    expect(ranAll(ro.m)).not.toContain("BEGIN");
    const prod = await wizard({ conn: { ...PG, tag: "production" }, confirm: false });
    await prod.m.app.importRun();
    await prod.m.settle();
    expect(prod.asked).toEqual(["Import sales.csv on Shop?"]);
    expect(ranAll(prod.m)).not.toContain("BEGIN");
  });

  it("checks the first rows on the server in a transaction that rolls back", async () => {
    const script: Script = (sql) =>
      sql.startsWith("SELECT") && sql.includes("desk_import_check")
        ? {
            rows: [
              ["order_id", "name"],
              ["1", "Ann"],
            ],
          }
        : COPYING(sql, undefined as never);
    const { m, latest } = await wizard({ script });
    await m.app.importCheck();
    await m.settle();
    expect(ranByImport(m)).toEqual([
      "BEGIN",
      'CREATE TEMPORARY TABLE desk_import_check (\n  "order_id" integer,\n  "name" text,\n  "price" numeric,\n  "day" date\n)',
      'COPY desk_import_check ("order_id", "name", "price", "day") FROM STDIN',
      'SELECT "order_id", "name", "price", "day" FROM desk_import_check',
      "ROLLBACK",
    ]);
    expect(latest()?.copy?.server).toEqual({ columns: ["order_id", "name"], rows: [["1", "Ann"]] });
  });
});
