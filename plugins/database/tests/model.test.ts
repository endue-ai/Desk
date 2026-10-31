// The pure parts around a run: connections and URIs, the clients' versions, result formats and
// sorting, what a run shows, the history's filter, the keys.
import { describe, expect, it } from "vitest";
import { oneExpression, tableSql } from "../ui/catalog.js";
import { compareVersions, parseVersion, searchPath, tooOld } from "../ui/clients.js";
import { formatUri, normalize, parseUri } from "../ui/connections.js";
import type { Execution } from "../ui/execute.js";
import { keepable } from "../ui/history.js";
import { actionFor } from "../ui/keys.js";
import { formatRows, numericColumns, sortRows } from "../ui/results.js";
import { fromValues } from "../ui/settings.js";
import { classify } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";
import { show } from "../ui/tabs.js";

describe("connections", () => {
  it("reads URIs of every engine, the password apart", () => {
    expect(
      parseUri(
        "postgresql://me:p%40ss@db.example:6543/app?sslmode=verify-full&sslrootcert=/ca.pem",
      ),
    ).toEqual({
      fields: {
        engine: "postgresql",
        host: "db.example",
        port: 6543,
        database: "app",
        user: "me",
        ssl: "verify-full",
        sslCa: "/ca.pem",
      },
      password: "p@ss",
    });
    expect(parseUri("mariadb://root@[::1]/shop?ssl-mode=REQUIRED").fields).toMatchObject({
      engine: "mysql",
      host: "::1",
      ssl: "require",
    });
    expect(parseUri("sqlite:~/data/app.db")).toEqual({
      fields: { engine: "sqlite", file: "~/data/app.db" },
    });
    expect(parseUri("sqlite:///var/db/app.sqlite").fields).toEqual({
      engine: "sqlite",
      file: "/var/db/app.sqlite",
    });
    expect(() => parseUri("redis://localhost")).toThrow(/postgres:\/\//u);
  });

  it("writes a URI back without a password", () => {
    const conn = normalize({
      ...parseUri("postgres://me:secret@db/app?sslmode=require").fields,
      id: "c-1",
    });
    expect(formatUri(conn)).toBe("postgresql://me@db/app?sslmode=require");
  });

  it("checks fields and keeps only the known ones", () => {
    const conn = normalize({
      engine: "mysql",
      host: "db",
      port: "3307" as unknown as number,
      id: "c-1",
      password: "x",
    } as never);
    expect(conn).toMatchObject({
      name: "db",
      port: 3307,
      ssl: "default",
      tag: "none",
      readOnly: false,
    });
    expect(Object.keys(conn)).not.toContain("password");
    expect(() => normalize({ engine: "postgresql", host: "a b", id: "c-1" })).toThrow(
      "Host: no spaces.",
    );
    expect(() => normalize({ engine: "postgresql", port: 70000, id: "c-1" })).toThrow(/Port/u);
    expect(() => normalize({ engine: "sqlite", file: "x.db", id: "c-1" })).toThrow(/full path/u);
    const taken = normalize({ engine: "sqlite", file: "/a.db", name: "A", id: "c-1" });
    expect(() =>
      normalize({ engine: "sqlite", file: "/b.db", name: "a", id: "c-2" }, [taken]),
    ).toThrow(/taken/u);
  });
});

describe("clients", () => {
  it("tells each client and version from --version", () => {
    expect(parseVersion("psql (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)")).toEqual({
      flavor: "postgresql",
      version: "17.6",
    });
    expect(
      parseVersion("mysql  Ver 8.4.13 for Linux on aarch64 (MySQL Community Server - GPL)"),
    ).toEqual({ flavor: "mysql", version: "8.4.13" });
    expect(
      parseVersion("mysql  Ver 15.1 Distrib 10.11.19-MariaDB, for debian-linux-gnu (aarch64)"),
    ).toEqual({ flavor: "mariadb", version: "10.11.19" });
    expect(
      parseVersion("mariadb from 11.8.9-MariaDB, client 15.2 for debian-linux-gnu (aarch64)"),
    ).toEqual({ flavor: "mariadb", version: "11.8.9" });
    expect(parseVersion("3.50.6 2025-09-22 18:50:24 9cc5")).toEqual({
      flavor: "sqlite",
      version: "3.50.6",
    });
  });

  it("says a client that is too old, and searches the install folders after the settings' own", () => {
    expect(compareVersions("3.37.2", "3.37")).toBe(1);
    expect(tooOld({ command: "psql", flavor: "postgresql", version: "12.9" })).toMatch(
      /13 or newer/u,
    );
    expect(tooOld({ command: "sqlite3", flavor: "sqlite", version: "3.43.2" })).toBe("");
    expect(searchPath("mac", ["/opt/pg/bin"]).split(":").slice(0, 3)).toEqual([
      "/opt/pg/bin",
      "/opt/homebrew/bin",
      "/opt/homebrew/opt/libpq/bin",
    ]);
  });

  it("reads the settings, keeping defaults for values of the wrong kind or range", () => {
    expect(
      fromValues({
        "endue.database.max-rows": 0,
        "endue.database.timeout-seconds": 30,
        "endue.database.confirm": "no",
        "endue.database.path": ["/x"],
      }),
    ).toMatchObject({
      maxRows: 500,
      timeoutSeconds: 30,
      confirm: true,
      path: ["/x"],
    });
  });
});

describe("results", () => {
  const set = {
    columns: ["id", "name", "note"],
    rows: [
      ["10", "b", null],
      ["9", "a", "x\ty"],
      ["11", null, ""],
    ],
    truncated: false,
  };

  it("sorts numbers by value and puts NULL last either way", () => {
    expect(numericColumns(set)).toEqual([true, false, false]);
    expect(sortRows(set, 0, "asc").map((r) => r[0])).toEqual(["9", "10", "11"]);
    expect(sortRows(set, 1, "desc").map((r) => r[1])).toEqual(["b", "a", null]);
  });

  it("keeps NULL apart in every format", () => {
    expect(formatRows(set, "tsv")).toBe("10\tb\t\\N\n9\ta\tx\\ty\n11\t\\N\t");
    expect(formatRows(set, "csv")).toBe('id,name,note\r\n10,b,\r\n9,a,x\ty\r\n11,,""');
    expect(JSON.parse(formatRows(set, "json"))).toEqual([
      { id: 10, name: "b", note: null },
      { id: 9, name: "a", note: "x\ty" },
      { id: 11, name: null, note: "" },
    ]);
    expect(formatRows(set, "markdown").split("\n")[2]).toBe("| 10 | b | NULL |");
    expect(
      formatRows(set, "insert", { dialect: "mysql", table: "`t`", rows: [["1", "it's\\", null]] }),
    ).toBe("INSERT INTO `t` (`id`, `name`, `note`) VALUES (1, 'it''s\\\\', NULL);");
  });
});

describe("show", () => {
  it("opens the first result, or the messages when something failed", () => {
    const statements = split("select 1;\nselec 2", "postgresql");
    const execution = {
      statements,
      classes: statements.map((s) => classify(s, "postgresql")),
      mode: "run",
      result: {
        ms: 4,
        notices: [],
        statements: [
          {
            index: 0,
            ran: true,
            sets: [{ columns: ["?column?"], rows: [["1"]], truncated: false }],
            affected: null,
            warnings: 0,
            notices: [],
          },
          {
            index: 1,
            ran: true,
            sets: [],
            affected: null,
            warnings: 0,
            notices: [],
            error: { kind: "sql", message: "syntax error", code: "42601", position: 0 },
          },
        ],
      },
    } as unknown as Execution;
    const shown = show(execution);
    expect(shown.tabs.map((t) => t.label)).toEqual(["1", "Messages"]);
    expect(shown.open).toBe(1);
    expect(shown.error).toEqual({ statement: 1, offset: 10 });
    expect(shown.summary).toBe("Failed: 2 of 2 statements ran in 4 ms");
    expect(shown.tabs[1]?.lines?.map((l) => l.text)).toEqual([
      "1. SELECT: 1 row",
      "2. Error 42601: syntax error",
    ]);
  });
});

describe("the rest", () => {
  it("never keeps statements that carry a password in the history", () => {
    expect(keepable("ALTER USER app WITH PASSWORD 'x'")).toBe(false);
    expect(keepable("CREATE USER 'a'@'%' IDENTIFIED BY 'x'")).toBe(false);
    expect(keepable("select * from passwords_reset_log")).toBe(true);
  });

  it("takes only its own chords from the desk", () => {
    expect(actionFor("editor", { key: "Enter", mod: true, shift: false, alt: false })).toBe("run");
    expect(actionFor("editor", { key: "Enter", mod: true, shift: true, alt: false })).toBe(
      "runAll",
    );
    expect(actionFor("editor", { key: "s", mod: true, shift: false, alt: false })).toBeUndefined();
    expect(
      actionFor("editor", { key: "Escape", mod: false, shift: false, alt: false }),
    ).toBeUndefined();
    expect(
      actionFor(
        "editor",
        { key: "Escape", mod: false, shift: false, alt: false },
        { running: true },
      ),
    ).toBe("cancel");
    expect(actionFor("grid", { key: "s", mod: false, shift: false, alt: false })).toBe("sort");
  });

  it("lets a table's filter be one expression only", () => {
    expect(oneExpression("id > 1 and name = 'a;b'")).toBe(true);
    expect(oneExpression("1=1; drop table t")).toBe(false);
    expect(oneExpression("1=1) or (1=1")).toBe(false);
    expect(oneExpression("1=1 -- ")).toBe(false);
    const conn = normalize({ engine: "postgresql", host: "db", id: "c-1" });
    const page = {
      schema: "app",
      table: "orders",
      where: "paid",
      order: "id desc",
      limit: 50,
      offset: 100,
    };
    expect(tableSql(conn, page)).toEqual({
      page: 'SELECT * FROM "app"."orders" WHERE paid ORDER BY id desc LIMIT 50 OFFSET 100',
      count: 'SELECT count(*) FROM "app"."orders" WHERE paid',
    });
  });
});
