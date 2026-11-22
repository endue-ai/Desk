// Backup and restore's argument lists (PG-62, ADR 0313): pg_dump's and pg_restore's options each an
// argument of their own, the connection in PG* variables, the password only in the spawned
// process's environment and never in the command line shown.
import { describe, expect, it } from "vitest";
import {
  argPath,
  commandLine,
  connectionEnv,
  dbnameArg,
  dumpArgs,
  dumpOptions,
  restoreArgs,
  restoreOptions,
  suggestedName,
} from "../ui/features/backup/args.js";
import { SAVED } from "./harness";

const SHOP = SAVED[1] as NonNullable<(typeof SAVED)[1]>;
const dump = (raw: Record<string, unknown>, major = 17, path = "~/Backups/shop.dump") =>
  dumpArgs(dumpOptions(raw, major), path, major);

describe("pg_dump's arguments", () => {
  it("builds pg_dump's argument list for each format and option", () => {
    expect(dump({})).toEqual([
      "--format=custom",
      "--verbose",
      "--no-password",
      "--file=./Backups/shop.dump",
    ]);
    expect(
      dump({ format: "directory", jobs: 4, method: "zstd", level: 3 }, 17, "/Volumes/USB/d"),
    ).toEqual([
      "--format=directory",
      "--verbose",
      "--no-password",
      "--compress=zstd:3",
      "--jobs=4",
      "--file=/Volumes/USB/d",
    ]);
    // Jobs are the directory format's; compression is custom's and directory's; INSERTs are plain's.
    expect(dump({ format: "tar", jobs: 4, method: "gzip", inserts: true })).toEqual([
      "--format=tar",
      "--verbose",
      "--no-password",
      "--file=./Backups/shop.dump",
    ]);
    expect(dump({ format: "plain" }, 17, "~/s.sql")).toEqual([
      "--format=plain",
      "--verbose",
      "--no-password",
      "--inserts",
      "--file=./s.sql",
    ]);
    expect(dump({ format: "plain", inserts: false }, 17, "~/s.sql")).not.toContain("--inserts");
    expect(
      dump({
        scope: "schemas",
        schemas: ["public", 'My "odd" schema'],
        content: "schema",
        noOwner: true,
        noPrivileges: true,
      }),
    ).toEqual([
      "--format=custom",
      "--verbose",
      "--no-password",
      '--schema="public"',
      '--schema="My ""odd"" schema"',
      "--strict-names",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--file=./Backups/shop.dump",
    ]);
    expect(dump({ scope: "tables", tables: "public.orders, sales.*", content: "data" })).toEqual([
      "--format=custom",
      "--verbose",
      "--no-password",
      "--table=public.orders",
      "--table=sales.*",
      "--strict-names",
      "--data-only",
      "--file=./Backups/shop.dump",
    ]);
  });

  it("writes compression as each pg_dump reads it, and refuses what one cannot", () => {
    expect(dump({ method: "none" })).toContain("--compress=none");
    expect(dump({ method: "gzip" })).toContain("--compress=gzip");
    expect(dump({ method: "gzip", level: 9 }, 15)).toContain("--compress=9");
    expect(dump({ method: "none" }, 15)).toContain("--compress=0");
    expect(() => dump({ method: "lz4" }, 15)).toThrow(
      "lz4 compression needs pg_dump 16 or newer; this one is 15.",
    );
    expect(() => dump({ method: "gzip", level: 12 })).toThrow(
      "A gzip level is a whole number from 1 to 9.",
    );
    expect(() => dump({ format: "directory", jobs: 0 })).toThrow(
      "Jobs are a whole number from 1 to 32.",
    );
    expect(() => dump({ scope: "schemas", schemas: [] })).toThrow("Choose a schema to back up.");
    expect(() => dump({ scope: "tables", tables: " , " })).toThrow("Name a table to back up.");
  });

  it("passes a path under the home folder from the home folder the program starts in", () => {
    expect(argPath("~/Backups/a.dump")).toBe("./Backups/a.dump");
    expect(argPath("~/-odd")).toBe("./-odd");
    expect(argPath("~")).toBe(".");
    expect(argPath("/Volumes/USB/a.dump")).toBe("/Volumes/USB/a.dump");
    expect(argPath("C:/Backups/a.dump")).toBe("C:/Backups/a.dump");
    expect(suggestedName("shop", "custom", new Date(2026, 10, 21, 9, 5))).toBe(
      "shop-2026-11-21-0905.dump",
    );
    expect(suggestedName("my db", "directory", new Date(2026, 10, 21, 9, 5))).toBe(
      "my_db-2026-11-21-0905",
    );
  });
});

describe("pg_restore's arguments", () => {
  const restore = (
    raw: Record<string, unknown>,
    format: "custom" | "directory" | "tar" = "custom",
  ) => restoreArgs(restoreOptions(raw, format), { path: "~/Backups/shop.dump", database: "shop" });

  it("builds pg_restore's", () => {
    expect(restore({})).toEqual([
      "--verbose",
      "--no-password",
      "--dbname=shop",
      "./Backups/shop.dump",
    ]);
    expect(
      restore({
        clean: true,
        ifExists: true,
        create: true,
        content: "data",
        noOwner: true,
        noPrivileges: true,
        jobs: 4,
      }),
    ).toEqual([
      "--verbose",
      "--no-password",
      "--dbname=shop",
      "--clean",
      "--if-exists",
      "--create",
      "--data-only",
      "--no-owner",
      "--no-privileges",
      "--jobs=4",
      "./Backups/shop.dump",
    ]);
    // If-exists needs clean; a tar archive restores in one job; a single transaction alone.
    expect(restore({ ifExists: true })).not.toContain("--if-exists");
    expect(restore({ jobs: 4 }, "tar")).not.toContain("--jobs=4");
    expect(restore({ singleTransaction: true })).toContain("--single-transaction");
    expect(() => restore({ singleTransaction: true, jobs: 2 })).toThrow(
      "A single transaction runs in one job: set jobs to 1, or leave it off.",
    );
    expect(() => restore({ singleTransaction: true, create: true })).toThrow(
      "pg_restore cannot create the database inside a single transaction.",
    );
    const listed = restoreArgs(restoreOptions({}, "custom"), {
      path: "/Volumes/USB/shop.dump",
      database: "shop",
      list: "~/.endue/database/restore/c-prod.list",
    });
    expect(listed.slice(-2)).toEqual([
      "--use-list=./.endue/database/restore/c-prod.list",
      "/Volumes/USB/shop.dump",
    ]);
  });

  it("names only the database in --dbname, whatever it is called", () => {
    expect(dbnameArg("shop")).toBe("--dbname=shop");
    expect(dbnameArg("host=elsewhere")).toBe("--dbname=dbname='host=elsewhere'");
    expect(dbnameArg("postgresql://x/y")).toBe("--dbname=dbname='postgresql://x/y'");
    expect(dbnameArg("it's=\\")).toBe("--dbname=dbname='it\\'s=\\\\'");
  });
});

describe("the command line shown", () => {
  it("shows the exact command line without the password", () => {
    const env = connectionEnv(SHOP, "s3cret pass");
    expect(env).toMatchObject({
      PGHOST: "db.example",
      PGPORT: "5432",
      PGDATABASE: "shop",
      PGUSER: "app",
      PGPASSWORD: "s3cret pass",
      PGSSLMODE: "require",
      PGAPPNAME: "endue Desk",
    });
    expect(connectionEnv(SHOP, undefined)).not.toHaveProperty("PGPASSWORD");
    const line = commandLine("pg_dump", dump({ scope: "tables", tables: "public.my table" }), env);
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("PGPASSWORD");
    expect(line).toBe(
      "PGHOST=db.example PGPORT=5432 PGDATABASE=shop PGUSER=app PGSSLMODE=require PGCONNECT_TIMEOUT=10 PGAPPNAME='endue Desk' LC_ALL=C " +
        "pg_dump --format=custom --verbose --no-password '--table=public.my table' --strict-names --file=./Backups/shop.dump",
    );
    expect(commandLine("/opt/pg bin/pg_dump", ["--file=./it's"], {})).toBe(
      "'/opt/pg bin/pg_dump' '--file=./it'\\''s'",
    );
  });
});

describe("certificate paths under the home folder (#661)", () => {
  const CERTS = {
    ...SHOP,
    sslCa: "~/certs/ca.pem",
    sslCert: "~/certs/client.crt",
    sslKey: "~/certs/client.key",
  };

  it("hands each of the three variables a path the program reads from the home folder it starts in", () => {
    expect(connectionEnv(CERTS, undefined)).toMatchObject({
      PGSSLROOTCERT: "./certs/ca.pem",
      PGSSLCERT: "./certs/client.crt",
      PGSSLKEY: "./certs/client.key",
    });
    const typed = { ...SHOP, sslCa: "/etc/ssl/ca.pem", sslCert: "C:\\certs\\c.crt", sslKey: "/k" };
    expect(connectionEnv(typed, undefined)).toMatchObject({
      PGSSLROOTCERT: "/etc/ssl/ca.pem",
      PGSSLCERT: "C:\\certs\\c.crt",
      PGSSLKEY: "/k",
    });
  });

  it("the command line shown names the resolved paths, on POSIX and in PowerShell", () => {
    const env = connectionEnv(CERTS, undefined);
    const posix = commandLine("pg_dump", ["--file=./a.dump"], env);
    const windows = commandLine("pg_dump.exe", ["--file=./a.dump"], env, "windows");
    for (const line of [posix, windows]) {
      expect(line).not.toContain("~/");
      expect(line).toContain("./certs/ca.pem");
      expect(line).toContain("./certs/client.crt");
      expect(line).toContain("./certs/client.key");
    }
    expect(posix).toContain("PGSSLROOTCERT=./certs/ca.pem PGSSLCERT=./certs/client.crt");
    expect(windows).toContain("$env:PGSSLKEY='./certs/client.key'; ");
  });
});
