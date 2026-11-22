// The table form against a real PostgreSQL, through the plugin's commands on the core's sessions.
// It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database it may write in, for
// example postgresql://postgres:pw@db/scratch. In a schema of its own: a table created from the
// form (identity, varchar, a default, a generated column, an array, a primary key, unique, check,
// a foreign key, a partial and an expression index, comments, an owner) and its DDL compared with
// the server's; read back into the form as it was written; then changed (a rename, a type made
// wider, NOT NULL, a default, a column dropped with its index, a new column, a constraint renamed,
// a CONCURRENTLY index) and compared again; a dry run and a failing step that leave it as it was;
// a partitioned table; and a read-only connection that runs nothing.
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import type { DesignState } from "../ui/features/table-design/controller.js";
import {
  addColumn,
  addPart,
  dropColumn,
  removePart,
  setColumn,
  setPart,
  setPartition,
  setTable,
  toggleKey,
} from "../ui/features/table-design/edits.js";
import type { Design } from "../ui/features/table-design/model.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const S = "endue_table_live";
const live = liveSessions(uri, "table-design");
const admin = async (sql: string) => String(await live.admin(sql));
// Roles are the server's, not the database's: this one is named for this database's runs.
const OWNER = `t475_${(uri ? new URL(uri).pathname.slice(1) : "x").replace(/\W/gu, "_")}_owner`;

async function setUp() {
  await live.end();
  await admin(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await admin(`DROP ROLE IF EXISTS ${OWNER}`);
  await admin(`CREATE ROLE ${OWNER} NOLOGIN`);
  await admin(`CREATE SCHEMA ${S}`);
  await admin(`CREATE TABLE ${S}.people (id integer PRIMARY KEY, name text NOT NULL)`);
}

/** The table's DDL as the server writes it: columns, constraints, indexes and comments. */
async function ddl(name: string) {
  const rel = `'${S}."${name}"'::regclass`;
  const columns =
    await admin(`SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
      || CASE a.attidentity WHEN 'a' THEN ' ALWAYS IDENTITY' WHEN 'd' THEN ' BY DEFAULT IDENTITY' ELSE '' END
      || CASE WHEN a.attgenerated = 's' THEN ' AS ' || pg_get_expr(d.adbin, d.adrelid)
         ELSE coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') END
      || coalesce(' -- ' || col_description(a.attrelid, a.attnum), ''), E'\\n' ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ${rel} AND a.attnum > 0 AND NOT a.attisdropped`);
  const constraints =
    await admin(`SELECT coalesce(string_agg(conname || ': ' || pg_get_constraintdef(oid), E'\\n' ORDER BY conname), '')
    FROM pg_constraint WHERE conrelid = ${rel} AND contype <> 'n'`);
  const indexes =
    await admin(`SELECT coalesce(string_agg(pg_get_indexdef(i.indexrelid), E'\\n' ORDER BY c.relname), '')
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = ${rel} AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)`);
  const table =
    await admin(`SELECT pg_get_userbyid(relowner) || coalesce(' -- ' || obj_description(oid, 'pg_class'), '')
    || coalesce(' PARTITION BY ' || pg_get_partkeydef(oid), '') FROM pg_class WHERE oid = ${rel}`);
  return {
    table,
    columns: columns.split("\n"),
    constraints: constraints.split("\n"),
    indexes: indexes.split("\n"),
  };
}

async function plugin() {
  const { fields, password } = parseUri(uri);
  const conn = (id: string, name: string, more: Partial<Connection> = {}) =>
    normalize({ ...fields, id, name, ...more });
  const procs = realProcs(password ? { password } : {});
  const store = {
    connections: [conn("c-live", "live"), conn("c-live-ro", "live-ro", { readOnly: true })],
  };
  const m = await mount({ store, handlers: procs.handlers, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  return m;
}
const form = (m: Mounted) =>
  (m.shown() as unknown as { id: string; tableDesign: DesignState }) ?? { id: "" };
const design = (m: Mounted) => form(m).tableDesign.design as Design;
const edit = async (m: Mounted, next: Design) => {
  const acts = m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  await acts.tableDesignEdit?.(form(m).id, { design: next });
};
const named = (d: Design, name: string) => d.columns.find((c) => c.name === name)?.id ?? "";
type Ran = { ok: boolean; message: string; script: string };
const run = (m: Mounted, dry = false) =>
  m.host.command(`endue.database.table-design-${dry ? "dry-run" : "run"}`) as Promise<Ran>;

afterAll(async () => {
  if (!uri) return;
  await live.end();
  await admin(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await admin(`DROP ROLE IF EXISTS ${OWNER}`);
});

describe.skipIf(!uri)("the table form on a real PostgreSQL", () => {
  it("creates a table from the form, its DDL as written, and reads it back as it was designed", async () => {
    await setUp();
    const m = await plugin();
    await m.host.command("endue.database.create-table", {
      connection: "live",
      schema: S,
      name: "Orders",
      columns: [
        { name: "id", type: "bigint", identity: "always" },
        { name: "code", type: "varchar(12)", notNull: true, comment: "Shown on the receipt" },
        { name: "person", type: "integer" },
        { name: "qty", type: "integer", default: "1", notNull: true },
        { name: "price", type: "numeric(10,2)" },
        { name: "tags", type: "text[]" },
        { name: "placed", type: "timestamptz", default: "now()" },
      ],
      primaryKey: ["id"],
      comment: "What was bought",
      owner: OWNER,
    });
    let d = design(m);
    d = addColumn(d, { name: "total", type: "numeric", generated: "qty * price" }).design;
    d = addPart(d, "uniques", { name: "orders_code_key", columns: [named(d, "code")] }).design;
    d = addPart(d, "checks", { name: "qty_positive", expression: "qty > 0" }).design;
    d = addPart(d, "foreignKeys", {
      columns: [named(d, "person")],
      refSchema: S,
      refTable: "people",
      refColumns: ["id"],
      onDelete: "SET NULL",
    }).design;
    d = addPart(d, "indexes", {
      name: "orders_open",
      keys: [{ column: named(d, "placed"), expression: "" }],
      where: "qty > 1",
    }).design;
    d = addPart(d, "indexes", {
      name: "orders_code_lower",
      keys: [{ column: "", expression: "lower((code)::text)" }],
    }).design;
    await edit(m, d);
    const done = await run(m);
    expect(done).toMatchObject({ ok: true, message: "Done: 6 steps ran." });

    expect(await ddl("Orders")).toEqual({
      table: `${OWNER} -- What was bought`,
      columns: [
        "id bigint NOT NULL ALWAYS IDENTITY",
        "code character varying(12) NOT NULL -- Shown on the receipt",
        "person integer",
        "qty integer NOT NULL DEFAULT 1",
        "price numeric(10,2)",
        "tags text[]",
        "placed timestamp with time zone DEFAULT now()",
        "total numeric AS ((qty)::numeric * price)",
      ],
      constraints: [
        "Orders_person_fkey: FOREIGN KEY (person) REFERENCES endue_table_live.people(id) ON DELETE SET NULL",
        "Orders_pkey: PRIMARY KEY (id)",
        "orders_code_key: UNIQUE (code)",
        "qty_positive: CHECK ((qty > 0))",
      ],
      indexes: [
        `CREATE INDEX orders_code_lower ON ${S}."Orders" USING btree (lower((code)::text))`,
        `CREATE INDEX orders_open ON ${S}."Orders" USING btree (placed) WHERE (qty > 1)`,
      ],
    });

    // The new table's own form, read from the server: nothing to change.
    expect(form(m).tableDesign).toMatchObject({
      mode: "change",
      target: { schema: S, name: "Orders" },
    });
    const read = design(m);
    expect(
      read.columns.map((c) => [c.name, c.type, c.length, c.array, c.nullable, c.identity]),
    ).toEqual([
      ["id", "bigint", "", false, false, "always"],
      ["code", "character varying", "12", false, false, ""],
      ["person", "integer", "", false, true, ""],
      ["qty", "integer", "", false, false, ""],
      ["price", "numeric", "10,2", false, true, ""],
      ["tags", "text", "", true, true, ""],
      ["placed", "timestamp with time zone", "", false, true, ""],
      ["total", "numeric", "", false, true, ""],
    ]);
    // The server's own text of the expression: what the form compares edits with.
    expect(read.columns.at(-1)?.generated).toBe("qty::numeric * price");
    expect(read.foreignKeys[0]).toMatchObject({
      refSchema: S,
      refTable: "people",
      refColumns: ["id"],
      onDelete: "SET NULL",
    });
    expect(read.indexes.map((i) => [i.name, i.where, i.keys])).toEqual([
      ["orders_code_lower", "", [{ column: "", expression: "lower(code::text)" }]],
      ["orders_open", "qty > 1", [{ column: named(read, "placed"), expression: "" }]],
    ]);
    expect(form(m).tableDesign.read?.original).toEqual(read);
    await expect(m.host.command("endue.database.table-design-run")).rejects.toThrow(
      "Nothing changes yet",
    );
  });

  it("changes the table as the form says, a dry run and a failing step leaving it as it was", async () => {
    const m = await plugin();
    await admin(`INSERT INTO ${S}.people VALUES (1, 'Ann')`);
    await admin(
      `INSERT INTO ${S}."Orders" (code, person, qty, price) VALUES ('A1', 1, 2, 5), ('B2', NULL, 1, 3)`,
    );
    await m.host.command("endue.database.change-table", {
      connection: "live",
      schema: S,
      name: "Orders",
    });
    const before = await ddl("Orders");
    let d = design(m);
    d = setTable(d, { name: "orders" });
    d = setColumn(d, named(d, "code"), { name: "Code", length: "40" });
    d = setColumn(d, named(d, "person"), { type: "bigint" });
    // A generated column holds price: its type stays, its default changes.
    d = setColumn(d, named(d, "price"), { default: "0" });
    d = dropColumn(d, named(d, "tags"));
    d = removePart(d, "indexes", d.indexes.find((i) => i.name === "orders_open")?.id ?? "");
    d = dropColumn(d, named(d, "placed"));
    d = addColumn(d, { name: "note", type: "text", default: "''", nullable: false }).design;
    d = setPart(d, "checks", d.checks[0]?.id ?? "", { name: "orders_qty_positive" });
    d = addPart(d, "indexes", {
      name: "orders_person",
      keys: [{ column: named(d, "person"), expression: "" }],
      concurrently: true,
    }).design;
    await edit(m, d);

    const dry = await run(m, true);
    expect(dry.message).toBe(
      "The dry run went through and rolled back: 9 steps would apply. The CONCURRENTLY indexes are not part of a dry run.",
    );
    expect(await ddl("Orders")).toEqual(before);

    // A step the server refuses: the transaction rolls back, nothing changed.
    await edit(m, setColumn(d, named(d, "person"), { nullable: false }));
    const failed = await run(m);
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(
      /^Step \d+ failed: column "person" of relation "orders" contains null values.* Nothing was changed: the transaction rolled back\.$/u,
    );
    expect(await ddl("Orders")).toEqual(before);

    await edit(m, d);
    const done = await run(m);
    expect(done).toMatchObject({ ok: true, message: "Done: 10 steps ran." });
    expect(done.script).toContain('RENAME TO "orders"');
    expect(done.script).not.toMatch(/DROP COLUMN "code"|ADD COLUMN "Code"/u);
    expect(await ddl("orders")).toEqual({
      table: `${OWNER} -- What was bought`,
      columns: [
        "id bigint NOT NULL ALWAYS IDENTITY",
        "Code character varying(40) NOT NULL -- Shown on the receipt",
        "person bigint",
        "qty integer NOT NULL DEFAULT 1",
        "price numeric(10,2) DEFAULT 0",
        "total numeric AS ((qty)::numeric * price)",
        "note text NOT NULL DEFAULT ''::text",
      ],
      constraints: [
        "Orders_person_fkey: FOREIGN KEY (person) REFERENCES endue_table_live.people(id) ON DELETE SET NULL",
        "Orders_pkey: PRIMARY KEY (id)",
        'orders_code_key: UNIQUE ("Code")',
        "orders_qty_positive: CHECK ((qty > 0))",
      ],
      indexes: [
        `CREATE INDEX orders_code_lower ON ${S}.orders USING btree (lower(("Code")::text))`,
        `CREATE INDEX orders_person ON ${S}.orders USING btree (person)`,
      ],
    });
    expect(
      await admin(
        `SELECT string_agg("Code" || ':' || coalesce(person::text, '-'), ',' ORDER BY id) FROM ${S}.orders`,
      ),
    ).toBe("A1:1,B2:-");
    // Read again from the server: the form is as the table now is.
    expect(form(m).tableDesign.target).toEqual({ schema: S, name: "orders" });
    expect(design(m).columns.map((c) => c.name)).toEqual([
      "id",
      "Code",
      "person",
      "qty",
      "price",
      "total",
      "note",
    ]);
  });

  it("creates a partitioned table, and a read-only connection runs nothing", async () => {
    const m = await plugin();
    await m.host.command("endue.database.create-table", {
      connection: "live",
      schema: S,
      name: "events",
      columns: [
        { name: "day", type: "date", notNull: true },
        { name: "id", type: "bigint", notNull: true },
      ],
      primaryKey: ["id", "day"],
    });
    let d = design(m);
    d = setPartition(d, { by: "range", keys: [{ column: named(d, "day"), expression: "" }] });
    await edit(m, d);
    expect(await run(m)).toMatchObject({ ok: true });
    expect((await ddl("events")).table).toBe(
      "postgres PARTITION BY RANGE (day)".replace("postgres", await admin("SELECT current_user")),
    );

    await m.host.command("endue.database.change-table", {
      connection: "live-ro",
      schema: S,
      name: "orders",
    });
    await edit(
      m,
      toggleKey(dropColumn(design(m), named(design(m), "note")), named(design(m), "id"), false),
    );
    await expect(run(m)).rejects.toThrow("live-ro is read-only");
    await expect(run(m, true)).rejects.toThrow("live-ro is read-only");
    expect((await ddl("orders")).columns).toHaveLength(7);
  });
});
