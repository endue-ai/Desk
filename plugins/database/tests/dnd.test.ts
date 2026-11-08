// Drag and drop on the Database surface (#550, ADR 0119): a dropped .sql file opens in a console, a
// .csv or .json file starts an import into a table (a column mapping, a preview, one transaction),
// selected rows drag out as db/rows, SQL INSERT and TSV, and a table drags its qualified name.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { autoMap, importStatements, parseCsv, readTable } from "../ui/import.js";
import { mount, SAVED, type Script } from "./harness";

const NOTES = SAVED.slice(0, 1);
const paths = (...list: string[]) => [
  { type: "desk/paths" as const, paths: list.map((path) => ({ path, kind: "file" as const })) },
];
const sqliteRuns = (spawned: Array<{ command: string; args: string[] }>) =>
  spawned.filter((s) => s.command === "sqlite3" && s.args[0] !== "--version");

/** SQLite's catalog for one table, `people (id INTEGER PRIMARY KEY, name TEXT, joined TEXT)`. */
const catalog: Script = (sql) => {
  if (sql.includes("FROM sqlite_master"))
    return {
      rows: [
        ["n", "k", "d", "e", "i"],
        ["people", "table", "", "", ""],
      ],
    };
  if (sql.includes("pragma_table_info"))
    return {
      rows: [
        ["name", "type", "nullable", "default", "primary"],
        ["id", "INTEGER", "NO", "", "YES"],
        ["name", "TEXT", "YES", "", "NO"],
        ["joined", "TEXT", "YES", "", "NO"],
      ],
    };
  if (sql.startsWith("SELECT * FROM"))
    return {
      rows: [
        ["id", "name"],
        ["1", "milk"],
        ["2", "it's"],
      ],
    };
  return sql.startsWith("INSERT") ? { changes: 2 } : {};
};

const PEOPLE = 'Name,ID,Email\r\nAnn,1,ann@example.com\r\n"O\'Brien, Pat",2,\r\n';

async function database(
  options: { files?: Record<string, string>; script?: Script; two?: boolean; pick?: string } = {},
) {
  const files: Record<string, string> = { "/Users/me/people.csv": PEOPLE, ...options.files };
  const m = await mount({
    store: { connections: options.two ? SAVED : NOTES },
    script: options.script ?? catalog,
    ...(options.pick ? { pick: () => options.pick as string } : {}),
    handlers: {
      "fs.read": ({ path }) => {
        const content = files[path];
        if (content === undefined) throw new StubError("not_found", `no file ${path}`);
        return { content, encoding: "utf8" };
      },
    },
  });
  const drop = async (items: Array<{ type: string } & Record<string, unknown>>, over?: unknown) => {
    const done = await m.host.dnd.drop({ items: items as never, over, from: "endue.explorer" });
    await m.settle();
    return done;
  };
  return { ...m, drop, latest: () => m.view.imports.at(-1) as Record<string, unknown> | null };
}

describe("reading a dropped file", () => {
  it("reads CSV as databases write it: quotes, CRLF, a BOM, NULL apart from ''", () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, ""y""",\r\n2,"",z\n')).toEqual({
      delimiter: ",",
      rows: [
        ["a", "b", "c"],
        ["1", 'x, "y"', null],
        ["2", "", "z"],
      ],
    });
    expect(parseCsv("a;b\n1;2\n").delimiter).toBe(";");
    expect(parseCsv('a\tb\n"multi\nline"\t2\n', "\t").rows[1]).toEqual(["multi\nline", "2"]);
  });

  it("reads JSON rows: objects by key, numbers and booleans as text, null as NULL", () => {
    expect(
      readTable(
        '[{"id": 3, "name": "Cy", "ok": true}, {"id": 4, "tags": ["a"], "name": null}]',
        "json",
      ),
    ).toEqual({
      columns: ["id", "name", "ok", "tags"],
      rows: [
        ["3", "Cy", "true", null],
        ["4", null, null, '["a"]'],
      ],
    });
    expect(() => readTable('{"id": 1}', "json")).toThrow(/an array of rows/);
  });

  it("maps the file's columns to the table's by name, and writes multi-row INSERTs", () => {
    const columns = [
      { name: "id", type: "INTEGER" },
      { name: "full_name", type: "TEXT" },
    ];
    expect(autoMap(["ID", "Full Name", "email"], columns)).toEqual(["id", "full_name", null]);
    const statements = importStatements({
      dialect: "sqlite",
      table: '"people"',
      columns,
      mapping: ["id", "full_name", null],
      rows: [
        ["1", "Ann", "a@x"],
        ["2", "it's", null],
        ["3", null, null],
      ],
      batch: 2,
    });
    expect(statements).toEqual([
      `INSERT INTO "people" ("id", "full_name") VALUES (1, 'Ann'), (2, 'it''s')`,
      `INSERT INTO "people" ("id", "full_name") VALUES (3, NULL)`,
    ]);
  });
});

describe("dropping on the Database surface", () => {
  it("takes paths and text", async () => {
    const { host } = await database();
    expect(host.dnd.accepts).toEqual(["desk/paths", "desk/text", "text/plain"]);
    expect(await host.dnd.hover({ items: paths("/Users/me/q.sql") })).toBe("copy");
    expect(await host.dnd.hover({ items: [{ type: "desk/text", text: "select 1" }] })).toBe("copy");
  });

  it("opens a dropped .sql file in a console, reading it under its own grant", async () => {
    let refused = 0;
    const asked: unknown[] = [];
    const m = await mount({
      store: { connections: SAVED },
      pick: () => "c-lite",
      handlers: {
        "fs.read": ({ path, scope }) => {
          if (refused++ === 0) throw new StubError("permission_denied", "no", scope);
          return { content: `-- ${path}\nselect 1;\n`, encoding: "utf8" };
        },
        "perm.request": (params) => {
          asked.push(params);
          return { granted: true };
        },
      },
    });
    const done = await m.host.dnd.drop({ items: paths("/Users/me/report.sql") });
    await m.settle();
    expect(done).toBe("copy");
    const scope = { permission: "fs:read", paths: ["/Users/me/report.sql"] };
    expect(asked).toEqual([{ permission: scope, reason: "To open report.sql in Database" }]);
    expect(m.shown()).toMatchObject({ kind: "console", connection: "c-lite" });
    expect(m.view.inserted).toEqual(["-- /Users/me/report.sql\nselect 1;\n"]);
  });

  it("puts dropped SQL text into the console on screen", async () => {
    const { host, view, drop } = await database();
    await host.command("endue.database.console", { connection: "Notes" });
    expect(await drop([{ type: "desk/text", text: "select * from people;" }])).toBe("copy");
    expect(view.inserted).toEqual(["select * from people;"]);
  });

  it("refuses a file it cannot do anything with, and says what it takes", async () => {
    const { drop, view } = await database();
    expect(await drop(paths("/Users/me/photo.png"))).toBe("none");
    expect(view.said.at(-1)).toMatch(/drop a \.sql file, a \.csv or \.json file/);
  });
});

describe("importing a dropped CSV file", () => {
  it("maps its columns by name, previews the rows, then imports them in one transaction", async () => {
    const m = await database();
    expect(await m.drop(paths("/Users/me/people.csv"))).toBe("copy");
    expect(m.latest()).toMatchObject({
      file: "people.csv",
      format: "csv",
      header: true,
      connection: "c-lite",
      table: "people",
      tables: ["people"],
      fileColumns: ["Name", "ID", "Email"],
      mapping: ["name", "id", null],
      rows: 2,
      preview: {
        columns: ["id", "name"],
        rows: [
          ["1", "Ann"],
          ["2", "O'Brien, Pat"],
        ],
      },
    });
    m.app.importChange({ map: [2, "joined"] });
    await m.settle();
    expect(m.latest()).toMatchObject({
      mapping: ["name", "id", "joined"],
      preview: {
        columns: ["id", "name", "joined"],
        rows: [
          ["1", "Ann", "ann@example.com"],
          ["2", "O'Brien, Pat", null],
        ],
      },
    });
    await m.app.importRun();
    await m.settle();
    const run = sqliteRuns(m.clients.spawned).at(-1)?.args ?? [];
    const insert = `INSERT INTO "people" ("id", "name", "joined") VALUES (1, 'Ann', 'ann@example.com'), (2, 'O''Brien, Pat', NULL)`;
    expect(run.slice(run.indexOf("BEGIN"))).toEqual([
      "BEGIN",
      insert,
      expect.stringMatching(/^SELECT total_changes\(\)/),
      "COMMIT",
    ]);
    expect(m.latest()).toBeNull();
    expect(m.view.said.at(-1)).toBe("Imported 2 rows into people in one transaction.");
  });

  it("imports into the table it was dropped on, and reads the first line as data when asked", async () => {
    const m = await database({ files: { "/Users/me/rows.csv": "7,Gil\n8,Hana\n" } });
    const table = {
      parentNode: m.view.dropTarget,
      target: { connection: "c-lite", schema: "main", table: "people" },
    };
    await m.drop(paths("/Users/me/rows.csv"), table);
    m.app.importChange({ header: false });
    await m.settle();
    expect(m.latest()).toMatchObject({
      table: "people",
      header: false,
      fileColumns: ["column 1", "column 2"],
      rows: 2,
    });
    m.app.importChange({ map: [0, "id"] });
    m.app.importChange({ map: [1, "name"] });
    await m.settle();
    expect(m.latest()).toMatchObject({
      preview: {
        rows: [
          ["7", "Gil"],
          ["8", "Hana"],
        ],
      },
    });
  });

  it("keeps nothing when a row fails, and says which", async () => {
    const failing: Script = (sql, env) =>
      sql.startsWith("INSERT")
        ? { error: "UNIQUE constraint failed: people.id" }
        : catalog(sql, env);
    const m = await database({ script: failing });
    await m.drop(paths("/Users/me/people.csv"));
    await m.app.importRun();
    await m.settle();
    expect(m.view.said.at(-1)).toBe(
      "Rolled back, nothing was imported: UNIQUE constraint failed: people.id",
    );
    expect(m.latest()).toMatchObject({
      problem: "Rolled back, nothing was imported: UNIQUE constraint failed: people.id",
    });
  });

  it("refuses to import with no column mapped", async () => {
    const m = await database({ files: { "/Users/me/other.csv": "x,y\n1,2\n" } });
    await m.drop(paths("/Users/me/other.csv"));
    expect(m.latest()).toMatchObject({
      mapping: [null, null],
      problem: "Map at least one column to the table.",
    });
    await m.app.importRun();
    expect(sqliteRuns(m.clients.spawned).some((r) => r.args.includes("BEGIN"))).toBe(false);
  });
});

describe("dragging out of the Database surface", () => {
  it("drags the selected rows as db/rows, SQL INSERT and TSV", async () => {
    const m = await database();
    await m.host.command("endue.database.open-table", {
      connection: "Notes",
      schema: "main",
      table: "people",
    });
    await m.settle();
    m.view.selection = () => ({
      tab: 0,
      sorted: [
        ["1", "milk"],
        ["2", "it's"],
      ],
      rows: [0, 1],
      columns: [0, 1],
    });
    const drag = m.app.rowsDrag({ row: 1, col: 0 });
    expect(drag).toEqual({
      items: [
        {
          type: "desk/json",
          kind: "db/rows",
          value: {
            connection: "Notes",
            engine: "sqlite",
            schema: "main",
            table: "people",
            columns: ["id", "name"],
            rows: [
              ["1", "milk"],
              ["2", "it's"],
            ],
          },
        },
        {
          type: "desk/text",
          text: `INSERT INTO "people" ("id", "name") VALUES (1, 'milk');\nINSERT INTO "people" ("id", "name") VALUES (2, 'it''s');`,
        },
        { type: "text/plain", text: "1\tmilk\n2\tit's" },
      ],
      effectAllowed: ["copy"],
      image: { label: "2 rows", detail: "people" },
    });
    // A press outside the selection drags the whole row under it.
    m.view.selection = () => ({
      tab: 0,
      sorted: [
        ["1", "milk"],
        ["2", "it's"],
      ],
    });
    expect(m.app.rowsDrag({ row: 0, col: 1 })?.items[2]).toEqual({
      type: "text/plain",
      text: "1\tmilk",
    });
  });

  it("drags a table by its qualified name, quoted only where SQL needs it", async () => {
    const m = await database({ two: true });
    const node = (connection: string, schema: string, table: string) =>
      ({
        kind: "table",
        connection,
        schema,
        table,
        key: "k",
        label: table,
        detail: "",
        level: 3,
        expandable: true,
        expanded: false,
      }) as never;
    expect(m.app.tableDrag(node("c-lite", "main", "people"))).toEqual({
      items: [{ type: "desk/text", text: "people" }],
      effectAllowed: ["copy", "link"],
      image: { label: "people", detail: "Notes" },
    });
    expect(m.app.tableDrag(node("c-prod", "public", "Order Items"))?.items).toEqual([
      { type: "desk/text", text: 'public."Order Items"' },
    ]);
    expect(m.app.tableDrag(node("c-prod", "sales", "order"))?.items).toEqual([
      { type: "desk/text", text: 'sales."order"' },
    ]);
  });
});
