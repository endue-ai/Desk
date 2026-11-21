// Backup and restore against a real PostgreSQL, through the plugin's commands and the real pg_dump,
// pg_restore and psql (PG-62). It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch
// database it may write in, for example postgresql://postgres:pw@db/scratch, as a role that may
// create databases. A schema of its own is backed up in the custom, directory and plain formats
// and restored into a fresh database (made and dropped here): the row counts and a checksum of the
// rows match the source. A restore into a read-only connection is refused before pg_restore runs.
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { LogState } from "../ui/features/backup/job.js";
import { type Handlers, type Mounted, mount } from "./harness";
import { clientVersion } from "./node-bridge";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const SCHEMA = "endue_backup_live";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: "" };
const SOURCE = String((fields as { database?: string }).database ?? "");
const FRESH = `${SOURCE}_restore_live`;
/** Where the backups go: a folder of its own, made when the tests run and removed after. */
let folder = "";

/** psql as the URI's role, on the scratch database or another one, unaligned. */
const admin = (sql: string, database = SOURCE) => {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  const done = spawnSync(
    "psql",
    ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", url.toString(), "-c", sql],
    { encoding: "utf8" },
  );
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout.trim();
};

/** What the restore is checked by: each table's row count and an md5 of its rows in key order. */
const fingerprint = (database: string) =>
  admin(
    `SELECT format('%s %s', count(*), md5(string_agg(i::text, '|' ORDER BY i.id))) FROM ${SCHEMA}.items i
     UNION ALL
     SELECT format('%s %s', count(*), md5(string_agg(o::text, '|' ORDER BY o.id))) FROM ${SCHEMA}.orders o`,
    database,
  );

/** The desk's fs.* on this machine's files, the way the core serves them to the plugin. */
const files: Handlers = {
  "fs.stat": ({ path }) => {
    const stat = statSync(path);
    return { kind: stat.isDirectory() ? "dir" : "file", size: stat.size, readOnly: false } as never;
  },
  "fs.list": ({ path }) =>
    ({
      entries: readdirSync(path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? "dir" : "file",
        size: e.isFile() ? statSync(join(path, e.name)).size : 0,
      })),
    }) as never,
  "fs.write": async ({ path, content }) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return { bytesWritten: content.length } as never;
  },
  "fs.read": ({ path, offset, length }) => {
    const size = statSync(path).size;
    const from = Math.min(offset ?? 0, size);
    const buffer = Buffer.alloc(Math.min(length ?? size, size - from));
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, from);
    } finally {
      closeSync(fd);
    }
    return { content: buffer.toString("base64"), encoding: "base64", size } as never;
  },
};

/** The plugin with the scratch database, the fresh one, and the fresh one read-only. */
async function plugin(answers: {
  backup?: Record<string, unknown>;
  restore?: Record<string, unknown>;
}) {
  const base = { ...fields, engine: "postgresql" as const };
  const connections = [
    normalize({ ...base, id: "c-src", name: "source" }),
    normalize({ ...base, database: FRESH, id: "c-fresh", name: "fresh" }),
    normalize({ ...base, database: FRESH, id: "c-ro", name: "locked", readOnly: true }),
  ];
  const procs = realProcs();
  const spawnReal = procs.handlers["proc.spawn"] as unknown as (
    params: object,
    caller?: string,
  ) => unknown;
  const handlers = {
    ...procs.handlers,
    ...files,
    "perm.request": () => ({ granted: true }),
    // The password reaches each program as the person's typed one would, never through the store.
    "proc.spawn": (params: { env?: object }, caller?: string) =>
      spawnReal(
        { ...params, env: { ...params.env, ...(password ? { PGPASSWORD: password } : {}) } },
        caller,
      ),
  } as unknown as Handlers;
  const m = await mount({
    store: { connections },
    handlers,
    pick: () => "yes",
    dialog: (type, model) => {
      const form = model as { options: Record<string, unknown> };
      return type === "backup" ? { ...form.options, ...answers.backup } : answers.restore;
    },
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}
const logOf = (m: Mounted) => (m.shown() as unknown as { backup: LogState }).backup;

/** Back the schema up in `format` to `path`, then restore it into a fresh database. */
async function roundTrip(format: string, path: string, restore: Record<string, unknown> = {}) {
  const m = await plugin({
    // As the form answers: jobs for a directory, INSERTs checked when plain is chosen.
    backup: {
      format,
      scope: "schemas",
      schemas: [SCHEMA],
      noOwner: true,
      ...(format === "directory" ? { jobs: 2 } : {}),
      ...(format === "plain" ? { inserts: true } : {}),
    },
    restore: { connection: "c-fresh", options: { noOwner: true, ...restore }, chosen: null },
  });
  const backedUp = (await m.host.command("endue.database.backup", {
    connection: "source",
    path,
  })) as {
    status: string;
  };
  expect(backedUp.status).toBe("done");
  await m.settle();
  expect(logOf(m).done).toBe(2);
  admin(`DROP DATABASE IF EXISTS ${FRESH}`);
  admin(`CREATE DATABASE ${FRESH}`);
  const restored = await m.host.command("endue.database.restore", { path });
  await m.settle();
  return { m, restored };
}

describe.skipIf(!uri || !clientVersion("pg_dump"))(
  "backup and restore on a real PostgreSQL",
  () => {
    beforeAll(() => {
      folder = mkdtempSync(join(tmpdir(), "endue-backup-live-"));
    });
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      admin(`DROP DATABASE IF EXISTS ${FRESH}`);
      admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    });

    it("backs up a scratch database in custom and plain format, restores each into a fresh database, and the row counts and checksum match", async () => {
      admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      admin(`CREATE SCHEMA ${SCHEMA}`);
      admin(
        `CREATE TABLE ${SCHEMA}.items (id int PRIMARY KEY, name text NOT NULL, price numeric(10,2), at timestamptz)`,
      );
      admin(
        `CREATE TABLE ${SCHEMA}.orders (id int PRIMARY KEY, item int REFERENCES ${SCHEMA}.items, note text)`,
      );
      admin(
        `INSERT INTO ${SCHEMA}.items SELECT n, 'item ' || n || E' it''s\\n' || chr(44032 + n % 50), n * 1.25, timestamptz '2026-11-21 00:00+00' + n * interval '1 minute' FROM generate_series(1, 3000) n`,
      );
      admin(
        `INSERT INTO ${SCHEMA}.orders SELECT n, 1 + n % 3000, CASE WHEN n % 7 = 0 THEN NULL ELSE 'note ' || n END FROM generate_series(1, 1500) n`,
      );
      const source = fingerprint(SOURCE);
      expect(source.split("\n").map((l) => l.split(" ")[0])).toEqual(["3000", "1500"]);

      // Custom, then restored with pg_restore in two jobs.
      const custom = await roundTrip("custom", join(folder, "live.dump"), { jobs: 2 });
      expect(custom.restored).toMatchObject({ status: "done", connection: "fresh" });
      expect(logOf(custom.m).command).toContain("--jobs=2");
      expect(logOf(custom.m).command).not.toContain(password || "\u0000");
      expect(fingerprint(FRESH)).toBe(source);

      // Directory, made by pg_dump at the path the save dialog gave, in two jobs.
      const directory = await roundTrip("directory", join(folder, "live-dir"));
      expect(statSync(join(folder, "live-dir", "toc.dat")).isFile()).toBe(true);
      expect(directory.restored).toMatchObject({ status: "done" });
      expect(fingerprint(FRESH)).toBe(source);

      // Plain, with INSERTs, run as a script through run-file: pg_dump's guard lines and all.
      const plain = await roundTrip("plain", join(folder, "live.sql"));
      expect(String(plain.restored)).toMatch(/^live\.sql: done, [\d,]+ statements in /u);
      expect(fingerprint(FRESH)).toBe(source);
    }, 120_000);

    it("refuses a restore into a read-only connection before pg_restore runs", async () => {
      const m = await plugin({ restore: { connection: "c-ro", options: {}, chosen: null } });
      await expect(
        m.host.command("endue.database.restore", { path: join(folder, "live.dump") }),
      ).rejects.toThrow("locked is read-only: nothing is restored into it.");
      // No log panel opened: pg_restore only listed the archive.
      expect(m.shown()?.backup).toBeUndefined();
    });
  },
);
