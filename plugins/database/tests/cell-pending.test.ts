// Typed cell editors (PG-40, #467) on the pending-changes model (ADR 0115): DEFAULT is a pending
// value of its own, apart from NULL; each kind's value becomes its literal, with a cast where the type
// needs one; a fixed column refuses an edit with the reason; a statement the server refuses names
// the cell its error points at.
import { describe, expect, it } from "vitest";
import { typesOf } from "../ui/cell-editors/pg-types.js";
import { attachEditors } from "../ui/cell-editors/resolve.js";
import { literalFor } from "../ui/cell-editors/values.js";
import { cellAt, editCell, emptyChanges, planChanges, targetOf } from "../ui/edit/pending.js";
import { submitChanges } from "../ui/edit/submit.js";
import { DEFAULT, isDefault } from "../ui/edit/values.js";
import { lite } from "./scripted";

const columns = [
  ["id", "integer", "int4", "N"],
  ["flag", "boolean", "bool", "B"],
  ["mood", "mood", "mood", "E"],
  ["j", "jsonb", "jsonb", "U"],
  ["ints", "integer[]", "_int4", "A"],
  ["bytes", "bytea", "bytea", "U"],
  ["at", "timestamp with time zone", "timestamptz", "D"],
  ["n", "integer", "int4", "N"],
  ["code", "character varying(4)", "varchar", "S"],
  ["twice", "integer", "int4", "N"],
];
const set = {
  columns: columns.map(([name]) => name as string),
  rows: [["1", "t", "ok", '{"a": 1}', "{1,2}", "\\x01", "2026-11-21 10:00:00+00", "5", "ab", "2"]],
  truncated: false,
};
const types = typesOf(
  columns.map(([name, type, base, category]) => [
    name ?? "",
    type ?? "",
    base ?? "",
    category ?? "",
    name === "ints" ? "int4" : "",
    name === "ints" ? "N" : "",
    name === "mood" ? "{sad,ok}" : "{}",
    name === "id" ? "NO" : "YES",
    name === "n" || name === "twice" ? "YES" : "NO",
    name === "twice" ? "s" : "",
    "",
    "UTC",
  ]),
);
const table = columns.map(([name, type]) => ({
  name: name ?? "",
  type: type ?? "",
  nullable: name !== "id",
  default: name === "n" ? "42" : null,
  primary: name === "id",
}));

function target(dialect: "postgresql" | "sqlite" = "postgresql") {
  const made = targetOf(dialect, { schema: "public", name: "t" }, set.columns, table);
  if (!made.target) throw new Error(made.reason);
  return attachEditors(made.target, table, dialect === "postgresql" ? types : new Map());
}
const col = (name: string) => set.columns.indexOf(name);

describe("DEFAULT, NULL and typed literals on the pending-changes model", () => {
  it("keeps DEFAULT apart from NULL and from the text 'DEFAULT'", () => {
    const t = target();
    const changes = emptyChanges();
    editCell(changes, t, set, 0, col("n"), DEFAULT);
    editCell(changes, t, set, 0, col("code"), "DEFAULT");
    editCell(changes, t, set, 0, col("flag"), null);
    expect(isDefault(cellAt(changes, set, 0, col("n")).value)).toBe(true);
    expect(isDefault(cellAt(changes, set, 0, col("code")).value)).toBe(false);
    expect(String(cellAt(changes, set, 0, col("n")).value)).toBe("DEFAULT");
    expect(planChanges(t, set, changes).map((c) => c.sql)).toEqual([
      `UPDATE "public"."t" SET "flag" = NULL, "n" = DEFAULT, "code" = 'DEFAULT' WHERE "id" = 1`,
    ]);
  });

  it("leaves a DEFAULT out of an INSERT, and refuses it on SQLite's rows", () => {
    const t = target();
    const changes = emptyChanges();
    changes.inserts.push(t.columns.map(() => undefined));
    editCell(changes, t, set, 1, col("id"), "2");
    editCell(changes, t, set, 1, col("n"), DEFAULT);
    expect(planChanges(t, set, changes).map((c) => c.sql)).toEqual([
      `INSERT INTO "public"."t" ("id") VALUES (2)`,
    ]);
    const lt = target("sqlite");
    expect(() => editCell(emptyChanges(), lt, set, 0, col("n"), DEFAULT)).toThrow(
      /SQLite cannot set a column to DEFAULT in an UPDATE/u,
    );
  });

  it("writes each kind's literal, with a cast where the type needs one", () => {
    const t = target();
    const editor = (name: string) => t.columns[col(name)]?.editor;
    expect(literalFor("postgresql", "t", editor("flag"))).toBe("TRUE");
    expect(literalFor("postgresql", "f", editor("flag"))).toBe("FALSE");
    expect(literalFor("postgresql", "sad", editor("mood"))).toBe("'sad'::mood");
    expect(literalFor("postgresql", '{"a": "it\'s"}', editor("j"))).toBe(`'{"a": "it''s"}'::jsonb`);
    expect(literalFor("postgresql", "{1,2,3}", editor("ints"))).toBe("'{1,2,3}'::integer[]");
    expect(literalFor("postgresql", "\\x0102", editor("bytes"))).toBe("E'\\\\x0102'::bytea");
    expect(literalFor("postgresql", "2026-11-21 10:00+09", editor("at"))).toBe(
      "'2026-11-21 10:00+09'::timestamp with time zone",
    );
    expect(literalFor("postgresql", "42", editor("n"))).toBe("42");
    expect(literalFor("postgresql", "NaN", { ...editor("n"), integer: "" } as never)).toBe("'NaN'");
    // A cast to varchar(4) would cut a longer value instead of refusing it.
    expect(literalFor("postgresql", "abcdef", editor("code"))).toBe("'abcdef'");
    expect(literalFor("postgresql", null, editor("mood"))).toBe("NULL");
    expect(literalFor("postgresql", DEFAULT, editor("mood"))).toBe("DEFAULT");
    expect(literalFor("mysql", "x", undefined, "text")).toBe("'x'");

    const changes = emptyChanges();
    editCell(changes, t, set, 0, col("mood"), "sad");
    editCell(changes, t, set, 0, col("ints"), "{3}");
    expect(planChanges(t, set, changes)[0]?.sql).toBe(
      `UPDATE "public"."t" SET "mood" = 'sad'::mood, "ints" = '{3}'::integer[] WHERE "id" = 1`,
    );
  });

  it("refuses an edit of a generated column and says why", () => {
    const t = target();
    expect(() => editCell(emptyChanges(), t, set, 0, col("twice"), "3")).toThrow(
      /twice is generated .*the server computes it/u,
    );
  });

  it("names the row and the column a refused statement points at", async () => {
    const t = target();
    const changes = emptyChanges();
    editCell(changes, t, set, 0, col("flag"), "f");
    editCell(changes, t, set, 0, col("mood"), "nope");
    const [change] = planChanges(t, set, changes);
    const sql = change?.sql ?? "";
    const position = sql.indexOf("'nope'");
    const execute = async () => ({
      at: 1,
      result: {
        statements: [
          {
            index: 0,
            ran: true,
            sets: [],
            affected: null,
            warnings: 0,
            notices: [],
            error: {
              kind: "sql",
              message: 'invalid input value for enum mood: "nope"',
              position,
            },
          },
        ],
        notices: [],
        ms: 1,
      },
    });
    const conn = lite({ engine: "postgresql", file: "", host: "db", name: "Shop" });
    const done = await submitChanges({ execute: execute as never, conn, target: t, set, changes });
    expect(done.ok).toBe(false);
    expect(done.message).toBe(
      'Rolled back, nothing was changed: row 1 (update), column mood: invalid input value for enum mood: "nope"',
    );
    expect(done.cell).toEqual({ row: 0, col: col("mood") });
  });
});
